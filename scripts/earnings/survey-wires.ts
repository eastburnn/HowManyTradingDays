/**
 * Which companies announce their earnings dates on the two wires we can
 * read? Walks PR Newswire's Conference Call Announcements listing and
 * GlobeNewswire keyword search back to --since (default: four months, one
 * full earnings season), resolves each advisory to a company, and writes a
 * per-company tally plus the list of large filers seen on neither wire.
 * Read-only: nothing is staged or confirmed.
 *
 *   npx tsx --env-file=.env.local scripts/earnings/survey-wires.ts --since 2026-06-01 --out /tmp/wire-survey.json
 */

import { writeFileSync } from "node:fs";
import { fetchGnwSearch, fetchPrnConferenceCalls } from "@/lib/earnings/wireArchives";
import { resolveCik } from "@/lib/earnings/confirmJob";
import { parseAdvisory, parseTickers } from "@/lib/earnings/confirm";
import { todayET } from "@/lib/earnings/ingest";
import { addDaysISO } from "@/lib/earnings/format";
import { closePool, query } from "@/lib/earnings/db";
import type { FeedItem } from "@/lib/earnings/wires";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const SINCE = arg("since", addDaysISO(todayET(), -120));
const OUT = arg("out", "wire-survey.json");
const MAX_PAGES = 200;
const GNW_KEYWORDS = [
  "earnings conference call",
  "earnings release date",
  "to host conference call",
  "to report second quarter",
  "to announce second quarter",
  "to report third quarter",
  "to announce third quarter",
  "to report fiscal",
  "to announce fiscal",
  "financial results conference call",
  "quarterly results conference call",
];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function collect(label: string, fetchPage: (page: number) => Promise<FeedItem[]>): Promise<FeedItem[]> {
  const all: FeedItem[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    let items: FeedItem[] = [];
    try {
      items = await fetchPage(page);
    } catch (err) {
      process.stderr.write(`  ${label} page ${page}: ${(err as Error).message}\n`);
      break;
    }
    if (items.length === 0) break;
    all.push(...items);
    const oldest = items.map((i) => i.publishedAt ?? "").filter(Boolean).sort()[0] ?? "";
    if (page % 5 === 0 || oldest.slice(0, 10) < SINCE) process.stderr.write(`  ${label} page ${page}: ${all.length} items, oldest ${oldest.slice(0, 10)}\n`);
    if (oldest && oldest.slice(0, 10) < SINCE) break;
    await sleep(700);
  }
  return all.filter((i) => !i.publishedAt || i.publishedAt.slice(0, 10) >= SINCE);
}

/** The company an advisory is about: the parser's reading when it parses, else the headline's subject. */
async function companyOf(item: FeedItem): Promise<{ cik: number; ticker: string } | null> {
  const outcome = parseAdvisory(item.title, item.description ?? "", item.publishedAt ?? todayET(), { maxDaysAhead: 400 });
  if (outcome.ok) {
    const hit = await resolveCik(outcome.parsed);
    if (hit) return hit;
  }
  const subject = item.title.split(/\s+(?:to|will|announces|schedules|sets|plans|reports|invites|hosts)\s+/i)[0]?.trim() ?? "";
  const tickers = parseTickers(`${item.title} ${item.description ?? ""}`);
  return resolveCik({ companyName: subject, tickers } as Parameters<typeof resolveCik>[0]);
}

(async () => {
  process.stderr.write(`Surveying wire advisories since ${SINCE}\n`);
  const prn = await collect("prn-calls", (p) => fetchPrnConferenceCalls(p, 100));
  const gnw = new Map<string, FeedItem>();
  for (const kw of GNW_KEYWORDS) {
    for (const it of await collect(`gnw "${kw}"`, (p) => fetchGnwSearch(kw, p))) gnw.set(it.guid, it);
  }
  process.stderr.write(`Collected ${prn.length} PR Newswire and ${gnw.size} GlobeNewswire items\n`);

  type Tally = { ticker: string; prn: number; gnw: number; lastSeen: string };
  const byCik = new Map<number, Tally>();
  let unresolved = 0;
  const note = async (wire: "prn" | "gnw", items: FeedItem[]) => {
    for (const it of items) {
      const hit = await companyOf(it);
      if (!hit) {
        unresolved += 1;
        continue;
      }
      const t = byCik.get(hit.cik) ?? { ticker: hit.ticker, prn: 0, gnw: 0, lastSeen: "" };
      t[wire] += 1;
      const d = (it.publishedAt ?? "").slice(0, 10);
      if (d > t.lastSeen) t.lastSeen = d;
      byCik.set(hit.cik, t);
    }
  };
  await note("prn", prn);
  await note("gnw", [...gnw.values()]);

  const companies = await query<{ cik: number; ticker: string; filer_category: string | null; has_feed: boolean; blocked: boolean }>(
    `select co.cik, co.ticker, co.filer_category,
            exists (select 1 from ir_sources s where s.cik = co.cik and s.platform in ('q4','investis','rss')) as has_feed,
            exists (select 1 from ir_sources s where s.cik = co.cik and s.platform = 'blocked') as blocked
       from companies co where co.active`
  );
  const onWires = new Set(byCik.keys());
  const summary = {
    since: SINCE,
    prnItems: prn.length,
    gnwItems: gnw.size,
    unresolvedItems: unresolved,
    companiesOnWires: byCik.size,
    bySize: {} as Record<string, { companies: number; onWires: number; withFeed: number; onWiresOrFeed: number; neither: number }>,
    neitherLarge: [] as string[],
  };
  for (const c of companies) {
    const size = c.filer_category ?? "unknown";
    const s = (summary.bySize[size] ??= { companies: 0, onWires: 0, withFeed: 0, onWiresOrFeed: 0, neither: 0 });
    const wire = onWires.has(c.cik);
    s.companies += 1;
    if (wire) s.onWires += 1;
    if (c.has_feed) s.withFeed += 1;
    if (wire || c.has_feed) s.onWiresOrFeed += 1;
    else {
      s.neither += 1;
      if (size === "large-accelerated") summary.neitherLarge.push(c.ticker + (c.blocked ? "*" : ""));
    }
  }
  summary.neitherLarge.sort();
  writeFileSync(OUT, JSON.stringify({ summary, companies: Object.fromEntries([...byCik.entries()]) }, null, 1));
  console.log(JSON.stringify({ ...summary, neitherLarge: `${summary.neitherLarge.length} tickers (in the file)` }, null, 1));
  await closePool();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
