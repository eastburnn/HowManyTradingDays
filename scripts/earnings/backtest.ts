/**
 * Earnings estimator backtest / calibration tool.
 *
 * Samples NYSE/Nasdaq quarterly reporters from EDGAR, trains the estimator on
 * every release up to TRAIN_END, predicts every release after it, and reports
 * hit rates (exact, ±1, ±3, ±7 days) by filer category and method — including
 * the production-faithful variant that must also predict the period end.
 *
 *   npx tsx scripts/earnings/backtest.ts --n 500 --train-end 2025-12-31
 *
 * Re-run each quarter; the SD buckets at the bottom are what set the
 * confidence thresholds and badge copy on the site.
 */

import { promises as fs } from "fs";
import path from "path";
import {
  type EdgarCompany,
  fetchCompany,
  fetchExchangeListings,
  isQuarterlyReporter,
} from "@/lib/earnings/edgar";
import { type EarningsObservation, buildObservations, daysBetween, predictPeriodEnd } from "@/lib/earnings/fiscal";
import { type EstimateMethod, estimateReleaseDate } from "@/lib/earnings/estimator";

/* ---------------------------------------------
   ARGS
----------------------------------------------*/

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const TARGET_N = Number(arg("n", "500"));
const TRAIN_END = arg("train-end", "2025-12-31");
const SEED = Number(arg("seed", "42"));
const CACHE_DIR = arg("cache", path.join(process.cwd(), ".cache", "edgar"));
const OUT_FILE = arg("out", path.join(process.cwd(), ".cache", "backtest-results.json"));
const CONCURRENCY = 6;
// Each variant is a method plus a recency window; the report ranks them.
type Variant = { label: string; method?: EstimateMethod; maxYears?: number; decay?: number };
const VARIANTS: Variant[] = [
  { label: "DEFAULT (per-category)" },
  { label: "nth-weekday (6y, .7)", method: "nth-weekday", maxYears: 6, decay: 0.7 },
  { label: "raw-offset (6y, .7)", method: "raw-offset", maxYears: 6, decay: 0.7 },
  { label: "offset-snap (6y, .7)", method: "offset-snap", maxYears: 6, decay: 0.7 },
  { label: "offset-snap (6y, .6)", method: "offset-snap", decay: 0.6 },
  { label: "offset-snap (6y, .65)", method: "offset-snap", decay: 0.65 },
  { label: "offset-snap (3y, .7)", method: "offset-snap", maxYears: 3, decay: 0.7 },
  { label: "offset-snap (4y, .7)", method: "offset-snap", maxYears: 4, decay: 0.7 },
  { label: "last-year", method: "last-year" },
];
const METHODS = VARIANTS.map((v) => v.label);

/* ---------------------------------------------
   SEEDED SHUFFLE
----------------------------------------------*/

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], seed: number): T[] {
  const rand = mulberry32(seed);
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---------------------------------------------
   SAMPLE THE UNIVERSE
----------------------------------------------*/

async function sampleCompanies(): Promise<EdgarCompany[]> {
  const listings = await fetchExchangeListings({ cacheDir: CACHE_DIR });
  const listed = listings.filter((l) => l.exchange === "NYSE" || l.exchange === "Nasdaq");
  const uniqueCiks = [...new Set(listed.map((l) => l.cik))];
  const order = shuffle(uniqueCiks, SEED);
  process.stderr.write(`Universe: ${uniqueCiks.length} NYSE/Nasdaq CIKs; sampling until ${TARGET_N} qualify\n`);

  const kept: EdgarCompany[] = [];
  let cursor = 0;
  let fetched = 0;
  let rejected = 0;

  async function worker() {
    while (kept.length < TARGET_N && cursor < order.length) {
      const cik = order[cursor++];
      try {
        const company = await fetchCompany(cik, { cacheDir: CACHE_DIR, sinceDate: "2015-01-01" });
        fetched += 1;
        if (isQuarterlyReporter(company)) kept.push(company);
        else rejected += 1;
      } catch (err) {
        rejected += 1;
        process.stderr.write(`  ! CIK ${cik}: ${(err as Error).message}\n`);
      }
      if (fetched % 50 === 0) {
        process.stderr.write(`  fetched ${fetched}, kept ${kept.length}, rejected ${rejected}\n`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  process.stderr.write(`Sampled ${kept.length} quarterly reporters (${fetched} fetched, ${rejected} rejected)\n`);
  return kept.slice(0, TARGET_N);
}

/* ---------------------------------------------
   RUN PREDICTIONS
----------------------------------------------*/

type VariantResult = {
  actualPE: number | null; // error in days when the real period end is known
  predictedPE: number | null; // error in days, production-faithful
  sdDays: number;
  historyCount: number;
  clamped: boolean;
  timeOfDay: string | null;
};

type Prediction = {
  cik: number;
  ticker: string;
  category: string;
  quarter: number;
  fiscalYear: number;
  actualPeriodEnd: string;
  predictedPeriodEnd: string | null;
  actualRelease: string;
  actualTimeOfDay: string;
  results: Record<string, VariantResult>; // keyed by variant label
};

function runPredictions(companies: EdgarCompany[]): Prediction[] {
  const predictions: Prediction[] = [];

  for (const company of companies) {
    const observations = buildObservations(company.filings, company.fiscalYearEnd);
    const train = observations.filter((o) => o.releaseDate <= TRAIN_END);
    const test = observations.filter((o) => o.releaseDate > TRAIN_END);
    if (test.length === 0) continue;

    for (const t of test) {
      const history = train.filter((o) => o.quarter === t.quarter);
      if (history.length === 0) continue;

      // Production-faithful period end: roll the most recent same-quarter
      // period end forward year by year.
      const latest = history.reduce((a, b) => (a.fiscalYear > b.fiscalYear ? a : b));
      let predictedPE: string | null = latest.periodEnd;
      for (let y = latest.fiscalYear; y < t.fiscalYear; y++) predictedPE = predictPeriodEnd(predictedPE);
      if (t.fiscalYear - latest.fiscalYear > 3) predictedPE = null; // too stale to roll forward

      const results: Record<string, VariantResult> = {};

      for (const v of VARIANTS) {
        const base = {
          history,
          reportForm: t.reportForm,
          category: company.category,
          method: v.method,
          maxYears: v.maxYears,
          decay: v.decay,
        };
        const withActual = estimateReleaseDate({ ...base, periodEnd: t.periodEnd });
        const withPredicted = predictedPE ? estimateReleaseDate({ ...base, periodEnd: predictedPE }) : null;
        const ref = withPredicted ?? withActual;
        results[v.label] = {
          actualPE: withActual ? daysBetween(t.releaseDate, withActual.date) : null,
          predictedPE: withPredicted ? daysBetween(t.releaseDate, withPredicted.date) : null,
          sdDays: ref?.sdDays ?? 0,
          historyCount: ref?.observations ?? 0,
          clamped: ref?.clampedToDeadline ?? false,
          timeOfDay: ref?.timeOfDay ?? null,
        };
      }

      predictions.push({
        cik: company.cik,
        ticker: company.tickers[0] ?? String(company.cik),
        category: company.category,
        quarter: t.quarter,
        fiscalYear: t.fiscalYear,
        actualPeriodEnd: t.periodEnd,
        predictedPeriodEnd: predictedPE,
        actualRelease: t.releaseDate,
        actualTimeOfDay: t.timeOfDay,
        results,
      });
    }
  }
  return predictions;
}

/* ---------------------------------------------
   REPORT
----------------------------------------------*/

function pct(n: number, d: number): string {
  return d === 0 ? "   –  " : `${((100 * n) / d).toFixed(1).padStart(5)}%`;
}

function bucketLine(label: string, errs: number[]): string {
  const n = errs.length;
  const abs = errs.map(Math.abs);
  const within = (k: number) => abs.filter((e) => e <= k).length;
  const sorted = abs.slice().sort((a, b) => a - b);
  const median = n ? sorted[Math.floor(n / 2)] : 0;
  return (
    `${label.padEnd(34)} n=${String(n).padStart(5)}  exact ${pct(within(0), n)}  ±1 ${pct(within(1), n)}  ` +
    `±3 ${pct(within(3), n)}  ±7 ${pct(within(7), n)}  med|err| ${median}d`
  );
}

function within3Rate(predictions: Prediction[], label: string, key: "predictedPE" | "actualPE"): number {
  const errs = predictions.map((p) => p.results[label][key]).filter((e): e is number => e !== null);
  return errs.length ? errs.filter((e) => Math.abs(e) <= 3).length / errs.length : 0;
}

function report(predictions: Prediction[]): string {
  const lines: string[] = [];
  const categories = ["large-accelerated", "accelerated", "non-accelerated", "unknown"];
  const keys = ["predictedPE", "actualPE"] as const;

  lines.push(`Backtest: trained through ${TRAIN_END}, tested on releases after it`);
  lines.push(`Predictions: ${predictions.length} from ${new Set(predictions.map((p) => p.cik)).size} companies\n`);

  for (const key of keys) {
    lines.push(
      key === "predictedPE"
        ? "=== PRODUCTION-FAITHFUL (period end also predicted) ==="
        : "=== ESTIMATOR ONLY (actual period end known) ==="
    );
    for (const label of METHODS) {
      lines.push(`--- ${label}`);
      for (const cat of categories) {
        const errs = predictions
          .filter((p) => p.category === cat && p.results[label][key] !== null)
          .map((p) => p.results[label][key] as number);
        if (errs.length) lines.push(bucketLine(`  ${cat}`, errs));
      }
      const all = predictions
        .filter((p) => p.results[label][key] !== null)
        .map((p) => p.results[label][key] as number);
      lines.push(bucketLine("  ALL", all));
    }
    lines.push("");
  }

  // Period-end predictor accuracy on its own
  const peErrs = predictions
    .filter((p) => p.predictedPeriodEnd)
    .map((p) => daysBetween(p.actualPeriodEnd, p.predictedPeriodEnd!));
  lines.push("=== PERIOD-END PREDICTOR ===");
  lines.push(bucketLine("  all quarters", peErrs));
  lines.push("");

  // Calibration on the best production-faithful variant (by ±3 across all)
  const best = METHODS.slice().sort(
    (a, b) => within3Rate(predictions, b, "predictedPE") - within3Rate(predictions, a, "predictedPE")
  )[0];
  lines.push(`=== CALIBRATION (best variant: ${best}, production-faithful) ===`);
  const faithful = predictions.filter((p) => p.results[best].predictedPE !== null);
  const err = (p: Prediction) => p.results[best].predictedPE as number;
  const r = (p: Prediction) => p.results[best];
  for (const [label, test] of [
    ["history ≥4 & SD ≤5  (spec's rule)", (p: Prediction) => r(p).historyCount >= 4 && r(p).sdDays <= 5],
    ["history ≥2 & SD ≤5", (p: Prediction) => r(p).historyCount >= 2 && r(p).sdDays <= 5],
    ["SD ≤2", (p: Prediction) => r(p).sdDays <= 2],
    ["SD 2–5", (p: Prediction) => r(p).sdDays > 2 && r(p).sdDays <= 5],
    ["SD 5–10", (p: Prediction) => r(p).sdDays > 5 && r(p).sdDays <= 10],
    ["SD >10", (p: Prediction) => r(p).sdDays > 10],
    ["history = 1", (p: Prediction) => r(p).historyCount === 1],
    ["history = 2", (p: Prediction) => r(p).historyCount === 2],
    ["history ≥ 3", (p: Prediction) => r(p).historyCount >= 3],
    ["clamped to deadline", (p: Prediction) => r(p).clamped],
    ["not clamped", (p: Prediction) => !r(p).clamped],
    ["Q4 (10-K) only", (p: Prediction) => p.quarter === 4],
    ["Q1–Q3 only", (p: Prediction) => p.quarter !== 4],
  ] as const) {
    const subset = faithful.filter(test);
    lines.push(bucketLine(`  ${label}`, subset.map(err)) + `  (coverage ${pct(subset.length, faithful.length)})`);
  }
  lines.push("");

  // SD of the "offset-snap (6y, .7)" variant is the long-history error bar;
  // show how the best variant's accuracy varies with it, for badge copy.
  const longLabel = "offset-snap (6y, .7)";
  if (METHODS.includes(longLabel)) {
    lines.push(`=== ACCURACY OF ${best} BY LONG-HISTORY SD (${longLabel}) ===`);
    for (const [label, test] of [
      ["SD ≤1", (p: Prediction) => p.results[longLabel].sdDays <= 1],
      ["SD 1–2", (p: Prediction) => p.results[longLabel].sdDays > 1 && p.results[longLabel].sdDays <= 2],
      ["SD 2–4", (p: Prediction) => p.results[longLabel].sdDays > 2 && p.results[longLabel].sdDays <= 4],
      ["SD 4–7", (p: Prediction) => p.results[longLabel].sdDays > 4 && p.results[longLabel].sdDays <= 7],
      ["SD >7", (p: Prediction) => p.results[longLabel].sdDays > 7],
    ] as const) {
      const subset = faithful.filter(test);
      lines.push(bucketLine(`  ${label}`, subset.map(err)) + `  (coverage ${pct(subset.length, faithful.length)})`);
    }
    lines.push("");
  }

  // Time of day
  const todKnown = faithful.filter((p) => p.actualTimeOfDay !== "unknown" && r(p).timeOfDay);
  const todHit = todKnown.filter((p) => p.actualTimeOfDay === r(p).timeOfDay).length;
  const todDist = new Map<string, number>();
  for (const p of predictions) todDist.set(p.actualTimeOfDay, (todDist.get(p.actualTimeOfDay) ?? 0) + 1);
  lines.push("=== TIME OF DAY ===");
  lines.push(`  actual distribution: ${[...todDist.entries()].map(([k, v]) => `${k} ${v}`).join(", ")}`);
  lines.push(`  predicted correctly: ${pct(todHit, todKnown.length)} of ${todKnown.length}`);

  return lines.join("\n");
}

/* ---------------------------------------------
   MAIN
----------------------------------------------*/

async function main() {
  const companies = await sampleCompanies();
  const predictions = runPredictions(companies);
  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify({ trainEnd: TRAIN_END, seed: SEED, predictions }, null, 1));
  console.log(report(predictions));
  console.log(`\nRaw predictions written to ${OUT_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
