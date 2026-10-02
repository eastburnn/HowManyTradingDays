/**
 * One-time (re-runnable) historical backfill of the earnings universe.
 *
 * Walks every NYSE/Nasdaq-listed CIK from the SEC exchange list and runs
 * refreshCompany() on each: companies, filings, reported events, and the
 * next two estimates. Idempotent — re-running only bumps timestamps unless
 * something actually changed.
 *
 *   npx tsx scripts/earnings/backfill.ts [--limit N] [--concurrency 6] [--tickers AAPL,MSFT]
 *
 * Respects the SEC rate limit via the shared EDGAR client; caches raw
 * submissions in .cache/edgar so a re-run doesn't re-download.
 */

import path from "path";
import { fetchExchangeListings } from "@/lib/earnings/edgar";
import { refreshCompany, todayET, type RefreshResult } from "@/lib/earnings/ingest";
import { closePool, query } from "@/lib/earnings/db";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const LIMIT = Number(arg("limit", "0"));
const CONCURRENCY = Number(arg("concurrency", "6"));
const ONLY_TICKERS = arg("tickers", "").split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
const CACHE_DIR = arg("cache", path.join(process.cwd(), ".cache", "edgar"));
const REFRESH = process.argv.includes("--refresh");

async function main() {
  const today = todayET();
  const listings = await fetchExchangeListings({ cacheDir: CACHE_DIR, refresh: REFRESH });

  // Primary listing per CIK = first row the SEC lists (share classes follow)
  const byCik = new Map<number, { ticker: string; exchange: string | null }>();
  for (const l of listings) {
    if (l.exchange !== "NYSE" && l.exchange !== "Nasdaq") continue;
    if (ONLY_TICKERS.length && !ONLY_TICKERS.includes(l.ticker.toUpperCase())) continue;
    if (!byCik.has(l.cik)) byCik.set(l.cik, { ticker: l.ticker, exchange: l.exchange });
  }
  let targets = [...byCik.entries()];
  if (LIMIT > 0) targets = targets.slice(0, LIMIT);
  process.stderr.write(`Backfill: ${targets.length} CIKs, concurrency ${CONCURRENCY}, today ${today}\n`);

  const [run] = await query<{ id: number }>(
    `insert into job_runs (job, stats) values ('backfill', $1) returning id`,
    [{ targets: targets.length }]
  );

  const stats = { done: 0, active: 0, inactive: 0, failed: 0, filings: 0, reported: 0, estimated: 0 };
  const failures: { cik: number; ticker: string; error: string }[] = [];
  let cursor = 0;
  const started = Date.now();

  async function worker() {
    while (cursor < targets.length) {
      const [cik, listing] = targets[cursor++];
      try {
        const r: RefreshResult = await refreshCompany(cik, { listing, cacheDir: CACHE_DIR, refresh: REFRESH, today });
        stats.done += 1;
        if (r.active) {
          stats.active += 1;
          stats.filings += r.filings;
          stats.reported += r.reported;
          stats.estimated += r.estimated;
        } else {
          stats.inactive += 1;
        }
      } catch (err) {
        stats.done += 1;
        stats.failed += 1;
        failures.push({ cik, ticker: listing.ticker, error: (err as Error).message });
        process.stderr.write(`  ! ${listing.ticker} (CIK ${cik}): ${(err as Error).message}\n`);
      }
      if (stats.done % 100 === 0) {
        const mins = ((Date.now() - started) / 60000).toFixed(1);
        process.stderr.write(
          `  ${stats.done}/${targets.length} after ${mins} min — active ${stats.active}, inactive ${stats.inactive}, failed ${stats.failed}, estimates ${stats.estimated}\n`
        );
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  await query(
    `update job_runs set finished_at = now(), status = $2, stats = $3, error = $4 where id = $1`,
    [
      run.id,
      stats.failed === stats.done ? "error" : "ok",
      { ...stats, minutes: Number(((Date.now() - started) / 60000).toFixed(1)), failures: failures.slice(0, 50) },
      failures.length ? `${failures.length} companies failed` : null,
    ]
  );

  console.log(JSON.stringify({ jobRunId: run.id, ...stats, minutes: ((Date.now() - started) / 60000).toFixed(1) }, null, 2));
  await closePool();
}

main().catch(async (err) => {
  console.error(err);
  await closePool();
  process.exit(1);
});
