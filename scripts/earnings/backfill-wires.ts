/**
 * One-time backfill of past earnings-date announcements from the wires'
 * public listing pages (PR Newswire's Conference Call Announcements category
 * and GlobeNewswire keyword search), back to --since. Items go through the
 * same parse → guard → attach pipeline as live feed items; for matches whose
 * summary lacks the ticker, the release page is read once to recover it.
 *
 *   npx tsx --env-file=.env.local scripts/earnings/backfill-wires.ts --since 2026-08-21
 *
 * Polite by construction: one request at a time with a pause, identified
 * User-Agent, headlines/links/summaries only.
 */

import { fetchGnwSearch, fetchPrnConferenceCalls, fetchReleaseOpening } from "@/lib/earnings/wireArchives";
import { processFeedItems, stageItems } from "@/lib/earnings/confirmJob";
import { parseTickers } from "@/lib/earnings/confirm";
import { todayET } from "@/lib/earnings/ingest";
import { addDaysISO } from "@/lib/earnings/format";
import { closePool, query } from "@/lib/earnings/db";
import type { FeedItem } from "@/lib/earnings/wires";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const SINCE = arg("since", addDaysISO(todayET(), -42));
const GNW_KEYWORDS = ["earnings conference call", "to report third quarter", "to announce third quarter", "earnings release date", "to host conference call"];
const MAX_PAGES = 40;

async function collect(label: string, fetchPage: (page: number) => Promise<FeedItem[]>): Promise<FeedItem[]> {
  const all: FeedItem[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const items = await fetchPage(page);
    if (items.length === 0) break;
    all.push(...items);
    const oldest = items.map((i) => i.publishedAt ?? "").filter(Boolean).sort()[0] ?? "";
    process.stderr.write(`  ${label} page ${page}: ${items.length} items, oldest ${oldest.slice(0, 10)}\n`);
    if (oldest && oldest.slice(0, 10) < SINCE) break;
  }
  return all.filter((i) => !i.publishedAt || i.publishedAt.slice(0, 10) >= SINCE);
}

(async () => {
  const [run] = await query<{ id: number }>(`insert into job_runs (job, stats) values ('wire-backfill', $1) returning id`, [{ since: SINCE }]);
  process.stderr.write(`Backfilling wire advisories since ${SINCE}\n`);

  const prn = await collect("prn-calls", (p) => fetchPrnConferenceCalls(p, 100));
  const stagedPrn = await stageItems("prn-calls", prn);

  const gnwSeen = new Map<string, FeedItem>();
  for (const kw of GNW_KEYWORDS) {
    for (const it of await collect(`gnw "${kw}"`, (p) => fetchGnwSearch(kw, p))) gnwSeen.set(it.guid, it);
  }
  const stagedGnw = await stageItems("gnw-search", [...gnwSeen.values()]);
  process.stderr.write(`Staged ${stagedPrn} PR Newswire + ${stagedGnw} GlobeNewswire items (new)\n`);

  const total = { processed: 0, matched: 0, confirmed: 0, ignored: 0, failed: 0, llmCalls: 0, llmMatched: 0 };
  const add = (s: typeof total) => { for (const k of Object.keys(total) as (keyof typeof total)[]) total[k] += s[k]; };
  for (let pass = 0; pass < 40; pass++) {
    const s = await processFeedItems(200, 1000);
    if (s.processed === 0) break;
    add(s);
    process.stderr.write(`  pass ${pass + 1}: ${JSON.stringify(s)}\n`);
  }

  // Second chance for matches whose summary lacked a ticker: read the
  // release opening once, pull the "(NYSE: XYZ)" mention, retry attachment.
  const unresolved = await query<{ id: number; link: string; parsed: { description?: string } }>(
    `select id, link, parsed from feed_items
      where feed in ('prn-calls','gnw-search') and parse_status = 'failed'
        and parsed->>'reason' = 'company not resolved' and link is not null`
  );
  let recovered = 0;
  for (const row of unresolved) {
    try {
      const opening = await fetchReleaseOpening(row.link);
      if (parseTickers(opening).length === 0) continue;
      await query(
        `update feed_items set parse_status = 'pending', parsed = jsonb_build_object('description', $2::text) where id = $1`,
        [row.id, `${row.parsed?.description ?? ""} ${opening}`.slice(0, 6000)]
      );
      recovered += 1;
    } catch (err) {
      process.stderr.write(`  ! ${row.link}: ${(err as Error).message}\n`);
    }
  }
  process.stderr.write(`Recovered tickers for ${recovered} of ${unresolved.length} unresolved matches; re-processing\n`);
  for (let pass = 0; pass < 10; pass++) {
    const s = await processFeedItems(200, 1000);
    if (s.processed === 0) break;
    add(s);
    process.stderr.write(`  pass ${pass + 1}: ${JSON.stringify(s)}\n`);
  }

  const summary = { since: SINCE, prnItems: prn.length, gnwItems: gnwSeen.size, stagedPrn, stagedGnw, recovered, ...total };
  await query(`update job_runs set finished_at = now(), status = 'ok', stats = $2 where id = $1`, [run.id, JSON.stringify(summary)]);
  console.log(JSON.stringify(summary, null, 2));
  await closePool();
})().catch(async (err) => {
  console.error(err);
  await closePool();
  process.exit(1);
});
