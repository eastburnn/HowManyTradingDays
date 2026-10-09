/**
 * Poll IR feeds from this machine. Investor-site platforms behind Cloudflare
 * (most Q4 sites) refuse the server's datacenter address but answer a home
 * connection, so this reads the feeds the scheduled job cannot, staging
 * exactly what pollIrSourcesBatch would. Safe to run any time.
 *
 *   npx tsx --env-file=.env.local scripts/earnings/poll-ir-local.ts [--blocked-set|--failing-only] [--concurrency 6]
 *
 * --blocked-set: the Q4-hosted feeds plus any feed the server last failed on
 * or this machine last read (what the launch agent on Chris's Mac runs every
 * two hours while awake). In this mode the run also re-checks a few companies
 * that still have no feed, looking for their investor site the way a person
 * would: the server is refused by the same bot walls, so this is the only
 * place new feeds on those sites get found. Each company without a feed comes
 * round about every three weeks.
 */
import { closePool, query } from "@/lib/earnings/db";
import { type IrSource, findViaInvestorLink, readIrSource, recordIrSource } from "@/lib/earnings/irSites";
import { stageItems } from "@/lib/earnings/confirmJob";
import { todayET } from "@/lib/earnings/ingest";
import { latestReleaseText } from "@/lib/earnings/jobs";

/** Companies without a feed to re-check per run, and how long before one is due again */
const DISCOVER_PER_RUN = 15;
const DISCOVER_AFTER_DAYS = 21;

const FAILING_ONLY = process.argv.includes("--failing-only");
const BLOCKED_SET = process.argv.includes("--blocked-set");
const i = process.argv.indexOf("--concurrency");
const CONCURRENCY = i >= 0 ? Number(process.argv[i + 1]) : 6;

(async () => {
  const today = todayET();
  const due = await query<IrSource & { consecutive_failures: number }>(
    `select cik, host, platform, events_url, releases_url, consecutive_failures from ir_sources
      where platform in ('q4','investis','rss')
        ${FAILING_ONLY ? "and consecutive_failures >= 1" : BLOCKED_SET ? "and (platform = 'q4' or consecutive_failures >= 1 or last_status like '%(local)%')" : ""}
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

  if (BLOCKED_SET) {
    // Companies that report earnings but still have no feed on file, least recently checked first.
    const todo = await query<{ cik: number; ticker: string; name: string }>(
      `select c.cik, c.ticker, c.name from companies c left join ir_sources s on s.cik = c.cik
        where c.active and (s.cik is null or s.platform in ('none', 'blocked'))
          and (s.discovered_at is null or s.discovered_at < now() - ($2 || ' days')::interval)
          and exists (select 1 from earnings_current e where e.cik = c.cik and e.status = 'reported' and e.source_type = 'edgar-8k')
        order by s.discovered_at asc nulls first, (c.filer_category = 'large-accelerated') desc, c.ticker
        limit $1`,
      [DISCOVER_PER_RUN, DISCOVER_AFTER_DAYS]
    );
    const found: string[] = [];
    for (const c of todo) {
      try {
        const out = await findViaInvestorLink(await latestReleaseText(c.cik).catch(() => ""), { name: c.name, ticker: c.ticker }, Date.now() + 60_000);
        await recordIrSource({ cik: c.cik, host: out.host, platform: out.platform, events_url: out.events_url, releases_url: out.releases_url });
        if (out.platform === "q4" || out.platform === "investis" || out.platform === "rss") found.push(`${c.ticker}:${out.platform}`);
      } catch (err) {
        console.error(`discovery ${c.ticker}:`, (err as Error).message);
      }
    }
    console.log("discovery", JSON.stringify({ checked: todo.length, found }));
  }
  await closePool();
})();
