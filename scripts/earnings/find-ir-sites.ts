/**
 * Find investor-relations sites (and any RSS feed on them) the way a person
 * would (the logic lives in lib/earnings/irSites.ts, findViaInvestorLink, and
 * the scheduled discovery uses it too; this script runs it in bulk, from a
 * network the bot-walled sites accept): read the company's latest earnings release for its corporate
 * domain, open the corporate home page, follow its "Investors" link, then
 * look on that page for a feed (a <link rel=alternate>, an "RSS" link, or
 * the platforms' predictable feed addresses). The subdomain guessing the
 * scheduled discovery does (investors.<name>.com) misses sites like
 * investorvalero.com or ralphlauren.com/investors; this pass covers those.
 *
 * Records what it finds in ir_sources: a feed (platform rss/q4/investis), or
 * at least the IR host (platform none), which lets inbound IR emails be
 * matched to the company by sender domain.
 *
 *   npx tsx --env-file=.env.local scripts/earnings/find-ir-sites.ts --tickers VLO,RL --dry
 *   npx tsx --env-file=.env.local scripts/earnings/find-ir-sites.ts --limit 500 --concurrency 6
 *
 * Without --tickers it takes active companies with no feed, hostless first.
 */

import { closePool, query } from "@/lib/earnings/db";
import { type InvestorLinkResult, findViaInvestorLink, recordIrSource } from "@/lib/earnings/irSites";
import { latestReleaseText } from "@/lib/earnings/jobs";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const DRY = process.argv.includes("--dry");
const TICKERS = arg("tickers", "").split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
const LIMIT = Number(arg("limit", "400"));
const CONCURRENCY = Number(arg("concurrency", "6"));

async function findFor(c: { cik: number; ticker: string; name: string }): Promise<InvestorLinkResult> {
  const text = await latestReleaseText(c.cik).catch(() => "");
  return findViaInvestorLink(text, { name: c.name, ticker: c.ticker });
}

(async () => {
  const targets = TICKERS.length
    ? await query<{ cik: number; ticker: string; name: string }>(`select cik, ticker, name from companies where ticker = any($1)`, [TICKERS])
    : await query<{ cik: number; ticker: string; name: string }>(
        `select c.cik, c.ticker, c.name from companies c left join ir_sources s on s.cik = c.cik
          where c.active and (s.cik is null or s.platform in ('none', 'blocked'))
            and exists (select 1 from earnings_current e where e.cik = c.cik and e.status = 'reported' and e.source_type = 'edgar-8k' and e.source_accession is not null)
          order by s.discovered_at asc nulls first, c.ticker limit $1`,
        [LIMIT]
      );
  console.log(`${targets.length} companies${DRY ? " (dry run)" : ""}, concurrency ${CONCURRENCY}`);
  const tally = { rss: 0, q4: 0, investis: 0, none: 0, blocked: 0, hostFound: 0 };
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < targets.length) {
      const c = targets[next++];
      const out = await findFor(c).catch((e) => ({ host: null, platform: "none" as const, events_url: null, releases_url: null, how: `error: ${(e as Error).message.slice(0, 60)}` }));
      tally[out.platform] += 1;
      if (out.host) tally.hostFound += 1;
      console.log(`${c.ticker.padEnd(6)} ${out.platform.padEnd(8)} ${(out.host ?? "-").padEnd(36)} ${out.releases_url ?? ""}  [${out.how}]`);
      if (!DRY) {
        // Always recorded (discovered_at moves forward), so a company with
        // nothing findable is not picked up again by the next chunk. A feed
        // already on file is kept (recordIrSource never downgrades).
        await recordIrSource({ cik: c.cik, host: out.host, platform: out.platform, events_url: out.events_url, releases_url: out.releases_url });
      }
      done += 1;
      if (done % 25 === 0) console.log(`  ${done}/${targets.length}: ${JSON.stringify(tally)}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`done: ${JSON.stringify(tally)}`);
  await closePool();
})().catch(async (e) => {
  console.error(e);
  await closePool();
  process.exit(1);
});
