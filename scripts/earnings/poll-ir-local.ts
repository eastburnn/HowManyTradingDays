/**
 * Poll IR feeds from this machine. Investor-site platforms behind Cloudflare
 * (most Q4 sites) refuse the server's datacenter address but answer a home
 * connection, so this reads the feeds the scheduled job cannot, staging
 * exactly what pollIrSourcesBatch would. Safe to run any time.
 *
 *   npx tsx --env-file=.env.local scripts/earnings/poll-ir-local.ts [--blocked-set|--failing-only] [--concurrency 6]
 *
 * --blocked-set: the Q4-hosted feeds plus any feed the server last failed on
 * (what the launch agent on Chris's Mac runs every two hours while awake).
 */
import { closePool, query } from "@/lib/earnings/db";
import { type IrSource, readIrSource } from "@/lib/earnings/irSites";
import { stageItems } from "@/lib/earnings/confirmJob";
import { todayET } from "@/lib/earnings/ingest";

const FAILING_ONLY = process.argv.includes("--failing-only");
const BLOCKED_SET = process.argv.includes("--blocked-set");
const i = process.argv.indexOf("--concurrency");
const CONCURRENCY = i >= 0 ? Number(process.argv[i + 1]) : 6;

(async () => {
  const today = todayET();
  const due = await query<IrSource & { consecutive_failures: number }>(
    `select cik, host, platform, events_url, releases_url, consecutive_failures from ir_sources
      where platform in ('q4','investis','rss')
        ${FAILING_ONLY ? "and consecutive_failures >= 1" : BLOCKED_SET ? "and (platform = 'q4' or consecutive_failures >= 1)" : ""}
      order by consecutive_failures desc, last_polled_at asc nulls first`
  );
  console.log(`${due.length} feeds, concurrency ${CONCURRENCY}`);
  const tally = { polled: 0, ok: 0, failed: 0, events: 0, releases: 0 };
  let next = 0;
  const worker = async () => {
    while (next < due.length) {
      const src = due[next++];
      const r = await readIrSource(src, today);
      const ev = await stageItems("ir-events", r.events);
      const rel = await stageItems("ir-releases", r.releases);
      const ok = r.fetched > 0 && r.failed === 0;
      tally.polled += 1; tally.events += ev; tally.releases += rel; if (ok) tally.ok += 1; else tally.failed += 1;
      await query(
        `update ir_sources set last_polled_at = now(), last_status = $2,
                consecutive_failures = case when $3 then 0 else consecutive_failures + 1 end where cik = $1`,
        [src.cik, ok ? "ok (local)" : `failed ${r.failed}/${r.fetched || 1} (local)`, ok]
      );
      if (tally.polled % 100 === 0) console.log(`  ${tally.polled}/${due.length}`, JSON.stringify(tally));
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log("done", JSON.stringify(tally));
  await closePool();
})();
