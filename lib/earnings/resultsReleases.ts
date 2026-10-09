/**
 * Results releases furnished without Item 2.02.
 *
 * Item 2.02 is the item for an earnings release, but a minority of companies
 * attach the same press release to an 8-K under Item 7.01 or 8.01 (Urban
 * Outfitters, every quarter since 2017). Those item codes also cover dividend
 * notices, investor decks and deal news, so the codes alone prove nothing:
 * the exhibit has to be read.
 *
 * Only quarters with no Item 2.02 release are looked at, and only 8-Ks with
 * an exhibit filed between the quarter's end and its 10-Q/10-K. Each 8-K is
 * read once; the verdict is kept in pipeline_state (one row per company), so
 * a refresh after the first costs nothing until a new 8-K appears.
 */

import { type EdgarCompany, type EdgarFiling, fetchEdgarText } from "./edgar";
import { documentToText } from "./edgarAdvisories";
import { MIN_DAYS_AFTER_PERIOD_END, addDaysISO, buildObservations, releaseDateOf } from "./fiscal";
import { query } from "./db";

/** 8-Ks read per refresh, newest first; the rest wait for the next one */
const DEFAULT_MAX_CHECKS = 40;

/** A release sits in the first few hundred kilobytes of the submission; attachments follow */
const SUBMISSION_BYTES = 600_000;

/** A company whose recent quarters came this way has its newest 8-Ks read as well */
const RECENT_QUARTERS = 4;

/* ---------------------------------------------
   WHICH 8-Ks ARE WORTH READING
----------------------------------------------*/

function couldCarryResults(f: EdgarFiling): boolean {
  if (f.form !== "8-K" || f.items.includes("2.02")) return false;
  return f.items.includes("9.01") && (f.items.includes("7.01") || f.items.includes("8.01"));
}

/* ---------------------------------------------
   READING THE EXHIBIT
----------------------------------------------*/

const PERIOD =
  /\b(quarter|months|weeks|year|period)s?\s+(ended|ending)\b|\b(first|second|third|fourth)[- ](fiscal\s+)?quarter\b|\bQ[1-4]\b|\b[1-4]Q\b|\bfull[- ]year\b|\byear[- ]end\b|\bfiscal\s+(year\s+)?(20)?\d\d\b|\bquarterly\b/i;
const RESULTS_WORD = /\b(results|earnings|net\s+(income|loss|earnings|sales)|revenues?|sales|EPS)\b/i;
// Verb forms only: "report" and "release" alone are nouns ("Annual Report",
// "this press release") or follow "to"/"will" in a scheduling notice.
const REPORTING_VERB =
  /(?<!\b(annual|quarterly|current|periodic|other|our|its|their|these|such|the|and|press|news|earnings)\s)\b(reports|reported|announces|announced|releases|released|posts|posted|delivers|delivered|pleased\s+to\s+(report|announce))\b/gi;
const FIGURES = /\$\s?\d|\bnet\s+(income|loss|earnings)\b|\bearnings\s+per\b|\bper\s+(diluted\s+|basic\s+|common\s+)?share\b|\bEPS\b/i;

// A notice that results are coming is not the release: "will report second
// quarter results on August 5", "announces third quarter earnings call date".
const ADVISORY =
  /(?<!pleased\s)\b(to|will|plans?\s+to|expects?\s+to|intends?\s+to)\s+(report|announce|release|issue|publish|post)\b|\b(results|earnings)\s+(conference\s+call|call|webcast|announcement|release\s+(date|and|schedule|timing)|date)\b|(?<!to-)\bdates?\s+(for|of)\b|\b(sets?|schedules?|confirms?)\b[^.]{0,40}(?<!to-)\bdate\b|\b(conference\s+call|webcast)\s+(date|schedule|information|details)\b/i;
// Nor is an early look at them.
const PRELIMINARY = /\bpreliminary\b|\bpre-?announce|\bselected\s+(unaudited\s+)?(financial|operating)\b|\b(expected|estimated|anticipated)\b/i;
// News whose sentence merely mentions earnings or a quarter
const OTHER_NEWS = /\b(dividends?|distributions?|acquisitions?|acquires?|merger|offering|spin-?off)\b/i;
const SLIDES = /\binvestor\s+(presentation|day|update)\b/i;

/**
 * True when a press release reads as a results release: within its opening,
 * a headline or sentence that reports results, sales or net income for a
 * stated period and is neither a scheduling notice nor a preliminary look,
 * in a document that goes on to give figures. Tuned to miss a real release
 * sooner than accept anything else: a miss leaves the 10-Q date in place.
 */
export function looksLikeResultsRelease(text: string): boolean {
  // Lines are joined: older filings hard-wrap, so a headline can span three.
  const body = text.replace(/^(\s*(exhibit\s+99(\.\d+)?|for immediate release|press release|news release)\s*)+/i, "").replace(/\s+/g, " ");
  if (/\bpreliminary\b/i.test(body.slice(0, 400))) return false;
  if (SLIDES.test(body.slice(0, 400)) || /\bthis presentation\b/i.test(body.slice(0, 5000))) return false;
  if (!FIGURES.test(body.slice(0, 20_000))) return false;

  const opening = body.slice(0, 2500);
  for (const verb of opening.matchAll(REPORTING_VERB)) {
    // What the verb reports: the rest of its sentence, or of the headline
    const rest = opening.slice(verb.index, verb.index + 240);
    const stop = rest.search(/(?<=[a-z\d)])\.\s+(?=[A-Z"“])/);
    const clause = stop >= 0 ? rest.slice(0, stop) : rest;
    const results = RESULTS_WORD.exec(clause);
    if (!results || !PERIOD.test(clause)) continue;
    if (OTHER_NEWS.test(clause.slice(0, results.index))) continue;
    const context = opening.slice(Math.max(0, verb.index - 30), verb.index) + clause;
    if (ADVISORY.test(context) || PRELIMINARY.test(context)) continue;
    return true;
  }
  return false;
}

/** Text of the press-release exhibits (EX-99.x) in a complete submission file */
export function pressExhibits(submission: string): string[] {
  const out: string[] = [];
  for (const m of submission.matchAll(/<DOCUMENT>\s*<TYPE>([^\s<]+)[\s\S]*?<TEXT>([\s\S]*?)(?:<\/TEXT>|$)/g)) {
    if (!/^EX-99/i.test(m[1])) continue;
    const raw = m[2];
    // Decks and scans arrive as PDF or encoded binary: nothing to read
    if (/^\s*(<PDF>|begin \d{3} )/i.test(raw)) continue;
    out.push(documentToText(raw.slice(0, 200_000)));
    if (out.length === 3) break;
  }
  return out;
}

async function carriesResults(cik: number, accession: string): Promise<boolean> {
  const url = `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replace(/-/g, "")}/${accession}.txt`;
  const submission = await fetchEdgarText(url, SUBMISSION_BYTES);
  return pressExhibits(submission).some(looksLikeResultsRelease);
}

/* ---------------------------------------------
   VERDICTS ON FILE
----------------------------------------------*/

type Verdicts = Record<string, boolean>; // accession -> carries a results release

// Bump the version when looksLikeResultsRelease changes enough to re-read old 8-Ks
const stateKey = (cik: number) => `results_8k:v1:${cik}`;

async function loadVerdicts(cik: number): Promise<Verdicts> {
  const rows = await query<{ value: Verdicts }>(`select value from pipeline_state where key = $1`, [stateKey(cik)]);
  return rows[0]?.value ?? {};
}

async function saveVerdicts(cik: number, verdicts: Verdicts): Promise<void> {
  await query(
    `insert into pipeline_state (key, value) values ($1, $2::jsonb)
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [stateKey(cik), JSON.stringify(verdicts)]
  );
}

/* ---------------------------------------------
   THE COMPANY'S VERIFIED RELEASES
----------------------------------------------*/

export type ResultsReleaseOptions = {
  /** Most 8-Ks to read in this pass (default 40) */
  maxChecks?: number;
};

/**
 * Accessions of this company's 8-Ks that carry a results release without
 * Item 2.02, reading any not yet looked at. Never throws for a document that
 * cannot be read: that 8-K simply stays unverified until the next refresh.
 */
export async function findFurnishedResults(company: EdgarCompany, opts: ResultsReleaseOptions = {}): Promise<Set<string>> {
  // Quarters the item codes leave without a release, and the 8-Ks filed in each one's window
  const quarters = buildObservations(company.filings, company.fiscalYearEnd, { periodicFallback: true });
  const candidates = company.filings.filter(couldCarryResults);
  if (candidates.length === 0) return new Set();

  const periodEnds = new Set(quarters.map((q) => q.periodEnd));
  const inWindow = (f: EdgarFiling, q: (typeof quarters)[number]) => {
    const date = releaseDateOf(f, periodEnds);
    return date >= addDaysISO(q.periodEnd, MIN_DAYS_AFTER_PERIOD_END) && date <= q.reportFiledDate;
  };
  const open = quarters.filter((q) => q.viaPeriodicReport);
  // company.filings is newest first, so the latest quarters are read first
  const wanted = candidates.filter((f) => open.some((q) => inWindow(f, q)));

  const verdicts = await loadVerdicts(company.cik);
  let budget = opts.maxChecks ?? DEFAULT_MAX_CHECKS;
  let changed = false;

  const read = async (filings: EdgarFiling[]) => {
    for (const f of filings) {
      if (f.accession in verdicts) continue;
      if (budget <= 0) return;
      budget -= 1;
      try {
        verdicts[f.accession] = await carriesResults(company.cik, f.accession);
        changed = true;
      } catch (err) {
        console.error(`[results-8k] ${company.tickers[0] ?? company.cik} ${f.accession}:`, (err as Error).message);
      }
    }
  };

  await read(wanted);

  // A company that reports this way has a release out before its 10-Q: read
  // what it has filed since its last periodic report too.
  const recent = open.filter((q) => quarters.indexOf(q) >= quarters.length - RECENT_QUARTERS);
  const reportsThisWay = recent.some((q) => wanted.some((f) => verdicts[f.accession] && inWindow(f, q)));
  if (reportsThisWay) {
    const lastFiled = quarters[quarters.length - 1].reportFiledDate;
    await read(candidates.filter((f) => releaseDateOf(f, periodEnds) > lastFiled));
  }

  if (changed) await saveVerdicts(company.cik, verdicts);
  return new Set(Object.keys(verdicts).filter((a) => verdicts[a]));
}
