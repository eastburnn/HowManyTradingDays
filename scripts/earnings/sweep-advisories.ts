/**
 * Sweep EDGAR full-text search for earnings-date advisories filed in the
 * last N days, stage them, and run the confirmation pipeline over everything
 * pending (regex first, model fallback). Writes to the live database through
 * the same append-only path as the scheduled jobs.
 *
 *   npx tsx --env-file=.env.local scripts/earnings/sweep-advisories.ts --days 45
 */

import { searchEdgarAdvisories, stageEdgarAdvisories } from "@/lib/earnings/edgarAdvisories";
import { processFeedItems } from "@/lib/earnings/confirmJob";
import { todayET } from "@/lib/earnings/ingest";
import { addDaysISO } from "@/lib/earnings/format";
import { closePool, query } from "@/lib/earnings/db";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

(async () => {
  const days = Number(arg("days", "45"));
  const end = todayET();
  const start = addDaysISO(end, -days);
  const [run] = await query<{ id: number }>(`insert into job_runs (job, stats) values ('advisory-sweep', $1) returning id`, [{ start, end }]);

  console.error(`Searching EDGAR full-text for advisories filed ${start} → ${end} …`);
  const candidates = await searchEdgarAdvisories(start, end);
  console.error(`  ${candidates.length} candidate documents (7.01/8.01, no 2.02)`);
  const staged = await stageEdgarAdvisories(candidates);
  console.error(`  ${staged} new documents staged (in universe) and fetched`);

  const total = { processed: 0, matched: 0, confirmed: 0, ignored: 0, failed: 0, llmCalls: 0, llmMatched: 0, pageReads: 0 };
  for (let pass = 0; pass < 20; pass++) {
    const s = await processFeedItems(200, 400, 200);
    if (s.processed === 0) break;
    for (const k of Object.keys(total) as (keyof typeof total)[]) total[k] += s[k];
    console.error(`  pass ${pass + 1}: ${JSON.stringify(s)}`);
  }

  await query(`update job_runs set finished_at = now(), status = 'ok', stats = $2 where id = $1`, [run.id, JSON.stringify({ start, end, candidates: candidates.length, staged, ...total })]);
  console.log(JSON.stringify({ start, end, candidates: candidates.length, staged, ...total }, null, 2));
  await closePool();
})().catch(async (err) => {
  console.error(err);
  await closePool();
  process.exit(1);
});
