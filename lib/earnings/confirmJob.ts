/**
 * Feed polling and confirmed-date recording. Server-only.
 *
 *   pollFeeds()          — fetch every wire feed, stage new items in feed_items
 *   processFeedItems()   — parse pending items; attach matches to a company's
 *                          upcoming quarter and record a confirmed event
 *
 * Both are idempotent: items are unique per (feed, guid), and
 * record_earnings_event() ignores re-observations of the same fact.
 */

import { query, withTransaction } from "./db";
import { FEEDS, type FeedItem, fetchFeed } from "./wires";
import { fetchPrnConferenceCalls } from "./wireArchives";

// Feeds that are advisory streams by construction (EDGAR's pre-filtered 8-K
// search, PR Newswire's Conference Call Announcements category): a title-level
// regex miss is still worth a model call. A plain keyword search is not —
// GlobeNewswire's "earnings conference call" results are mostly results
// releases, and the regex already rejects those correctly.
export const ARCHIVE_FEEDS = new Set(["edgar-fts", "prn-calls"]);
import { type ParsedAdvisory, dateMentioned, parseAdvisory } from "./confirm";
import { getDayInfo } from "@/lib/tradingDays";
import { parseISO } from "./fiscal";
import { llmAvailable, parseAdvisoryWithModel } from "./llmParse";
import { displayName } from "./format";

export type FeedStats = { feeds: number; feedErrors: number; newItems: number };
export type ProcessStats = { processed: number; matched: number; confirmed: number; ignored: number; failed: number; llmCalls: number; llmMatched: number };

// Regex outcomes worth a model call: the title had scheduling language but a
// piece was missing. "results already reported" and the non-earnings reasons
// are deliberate rejections and are never sent.
const LLM_WORTHY = new Set(["no quarter token", "no future date found"]);
const LLM_MAX_PER_RUN = 40;
const LLM_MAX_ATTEMPTS = 2;

/* ---------------------------------------------
   POLL
----------------------------------------------*/

/**
 * Stage items for a feed. Oldest first, so ids ascend chronologically and a
 * later correction ("updates the time of its call") is processed after — and
 * therefore supersedes — the original announcement.
 */
export async function stageItems(feedKey: string, items: FeedItem[]): Promise<number> {
  if (items.length === 0) return 0;
  const sorted = items.slice().sort((a, b) => (a.publishedAt ?? "").localeCompare(b.publishedAt ?? ""));
  const inserted = await query<{ id: number }>(
    `insert into feed_items (feed, guid, title, link, published_at)
     select * from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::timestamptz[])
     on conflict (feed, guid) do nothing
     returning id`,
    [
      sorted.map(() => feedKey),
      sorted.map((i) => i.guid.slice(0, 500)),
      sorted.map((i) => i.title.slice(0, 1000)),
      sorted.map((i) => i.link),
      sorted.map((i) => i.publishedAt),
    ]
  );
  if (inserted.length) {
    const byGuid = new Map(sorted.map((i) => [i.guid.slice(0, 500), i.description.slice(0, 4000)]));
    const rows = await query<{ id: number; guid: string }>(`select id, guid from feed_items where id = any($1::bigint[])`, [
      inserted.map((r) => r.id),
    ]);
    await query(
      `update feed_items f set parsed = jsonb_build_object('description', t.description)
         from unnest($1::bigint[], $2::text[]) as t(id, description)
        where f.id = t.id`,
      [rows.map((r) => r.id), rows.map((r) => byGuid.get(r.guid) ?? "")]
    );
  }
  return inserted.length;
}

export async function pollFeeds(opts: { includeLists?: boolean } = {}): Promise<FeedStats> {
  const stats: FeedStats = { feeds: 0, feedErrors: 0, newItems: 0 };

  // PR Newswire's "Conference Call Announcements" category has no RSS feed;
  // its listing page is the advisory stream itself.
  if (opts.includeLists) {
    stats.feeds += 1;
    try {
      stats.newItems += await stageItems("prn-calls", await fetchPrnConferenceCalls(1, 100));
    } catch (err) {
      stats.feedErrors += 1;
      console.error("[feeds] prn-calls:", (err as Error).message);
    }
  }

  for (const feed of FEEDS) {
    stats.feeds += 1;
    try {
      const items = await fetchFeed(feed);
      if (items.length === 0) continue;
      stats.newItems += await stageItems(feed.key, items);
    } catch (err) {
      stats.feedErrors += 1;
      console.error(`[feeds] ${feed.key}:`, (err as Error).message);
    }
  }
  return stats;
}

/* ---------------------------------------------
   ATTACH A PARSED ADVISORY TO A COMPANY + QUARTER
----------------------------------------------*/

type Candidate = {
  cik: number;
  ticker: string;
  fiscal_year: number;
  fiscal_quarter: number;
  period_end: string;
  report_form: string | null;
  event_date: string;
  status: string;
};

async function resolveCik(parsed: ParsedAdvisory): Promise<{ cik: number; ticker: string } | null> {
  if (parsed.tickers.length) {
    const rows = await query<{ cik: number; ticker: string }>(
      `select cik, ticker from companies
        where active and (upper(ticker) = any($1::text[]) or tickers && $1::text[])
        order by (upper(ticker) = any($1::text[])) desc limit 2`,
      [parsed.tickers]
    );
    if (rows.length === 1) return rows[0];
    if (rows.length > 1 && rows.every((r) => r.cik === rows[0].cik)) return rows[0];
    if (rows.length > 1) return null; // ambiguous
  }
  if (parsed.companyName) {
    // Conservative name match: normalized exact match, must be unique.
    const norm = (s: string) =>
      displayName(s)
        .toLowerCase()
        .replace(/[.,'’"]/g, "")
        .replace(/\b(inc|incorporated|corp|corporation|co|company|ltd|limited|plc|llc|lp|holdings?|group|the)\b/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
    const target = norm(parsed.companyName);
    if (target.length < 3) return null;
    const rows = await query<{ cik: number; ticker: string; name: string }>(
      `select cik, ticker, name from companies where active and name ilike $1`,
      [`%${parsed.companyName.split(" ")[0]}%`]
    );
    const hits = rows.filter((r) => norm(r.name) === target);
    if (hits.length === 1) return { cik: hits[0].cik, ticker: hits[0].ticker };
  }
  return null;
}

async function chooseQuarter(cik: number, parsed: ParsedAdvisory): Promise<Candidate | null> {
  const candidates = await query<Candidate>(
    `select cik, ticker, fiscal_year, fiscal_quarter, period_end::text, report_form, event_date::text, status
       from earnings_current
      where cik = $1 and status in ('estimated','confirmed')
        and event_date >= (now() at time zone 'America/New_York')::date - 14
      order by event_date asc`,
    [cik]
  );
  if (candidates.length === 0) return null;

  // The announced date must fall in the quarter's reporting window.
  const inWindow = candidates.filter((c) => {
    const days = Math.round((Date.parse(parsed.date) - Date.parse(c.period_end)) / 86_400_000);
    return days >= 1 && days <= 120;
  });
  if (inWindow.length === 0) return null;

  if (parsed.quarter) {
    const byQ = inWindow.filter((c) => c.fiscal_quarter === parsed.quarter);
    if (byQ.length === 1) return byQ[0];
    if (byQ.length > 1 && parsed.fiscalYear) {
      const byFy = byQ.filter((c) => c.fiscal_year === parsed.fiscalYear);
      if (byFy.length === 1) return byFy[0];
    }
    if (byQ.length > 1) return byQ[0];
    // Quarter token disagrees with our labeling (fiscal vs calendar naming);
    // fall through to the nearest candidate only if there is exactly one.
  }
  return inWindow.length === 1 ? inWindow[0] : inWindow[0];
}

/* ---------------------------------------------
   PROCESS
----------------------------------------------*/

export async function processFeedItems(limit = 200, llmMaxPerRun = LLM_MAX_PER_RUN): Promise<ProcessStats> {
  const stats: ProcessStats = { processed: 0, matched: 0, confirmed: 0, ignored: 0, failed: 0, llmCalls: 0, llmMatched: 0 };
  const pending = await query<{ id: number; feed: string; title: string; link: string | null; published_at: string | null; parsed: { description?: string; llmAttempts?: number; cik?: number } | null }>(
    `select id, feed, title, link, published_at::text, parsed from feed_items
      where parse_status = 'pending' order by id asc limit $1`,
    [limit]
  );

  for (const item of pending) {
    stats.processed += 1;
    const published = item.published_at ? new Date(item.published_at).toISOString() : new Date().toISOString();
    const description = item.parsed?.description ?? "";
    let outcome = parseAdvisory(item.title, description, published);
    let method: "regex" | "llm" = "regex";

    // Fallback: a scheduling-shaped headline the regex couldn't finish.
    const fromEdgar = item.feed === "edgar-fts";
    const fromArchive = ARCHIVE_FEEDS.has(item.feed);
    const worthModel = !outcome.ok && (LLM_WORTHY.has(outcome.reason) || (fromArchive && outcome.reason === "no scheduling language in title"));
    if (!outcome.ok && worthModel && llmAvailable() && stats.llmCalls < llmMaxPerRun) {
      const attempts = (item.parsed?.llmAttempts ?? 0) + 1;
      stats.llmCalls += 1;
      const llm = await parseAdvisoryWithModel(item.title, description, published);
      if (llm.ok) {
        outcome = llm;
        method = "llm";
        stats.llmMatched += 1;
      } else if (llm.retryable && attempts < LLM_MAX_ATTEMPTS) {
        // Leave pending for the next run, remembering the attempt.
        await query(`update feed_items set parsed = coalesce(parsed, '{}'::jsonb) || $2::jsonb where id = $1`, [
          item.id,
          JSON.stringify({ llmAttempts: attempts }),
        ]);
        continue;
      } else {
        outcome = { ok: false, reason: `${outcome.reason}; ${llm.reason}` };
      }
    }

    // Sanity guards on any parsed date: companies report on trading days, and a
    // model-supplied date must be stated literally in the text (no "early
    // November" → November 1).
    if (outcome.ok) {
      const d = outcome.parsed.date;
      if (!getDayInfo(parseISO(d)).isTradingDay) {
        outcome = { ok: false, reason: `date ${d} is not a trading day (${method})` };
      } else if (method === "llm" && !dateMentioned(`${item.title} ${description}`, d)) {
        outcome = { ok: false, reason: `llm date ${d} not stated in text` };
      }
    }

    if (!outcome.ok) {
      // Only scheduling-shaped headlines are worth keeping for review.
      const review = outcome.reason !== "no scheduling language in title" && outcome.reason !== "not about earnings/results";
      await query(`update feed_items set parse_status = $2, parsed = coalesce(parsed, '{}'::jsonb) || $3::jsonb where id = $1`, [
        item.id,
        review ? "failed" : "ignored",
        JSON.stringify({ reason: outcome.reason }),
      ]);
      if (review) stats.failed += 1;
      else stats.ignored += 1;
      continue;
    }

    stats.matched += 1;
    const parsed = outcome.parsed;
    const company = item.parsed?.cik
      ? (await query<{ cik: number; ticker: string }>(`select cik, ticker from companies where cik = $1 and active`, [item.parsed.cik]))[0] ?? null
      : await resolveCik(parsed);
    const target = company ? await chooseQuarter(company.cik, parsed) : null;

    if (!company || !target) {
      await query(`update feed_items set parse_status = 'failed', parsed = $2 where id = $1`, [
        item.id,
        JSON.stringify({ reason: company ? "no matching upcoming quarter" : "company not resolved", method, parsed, description }),
      ]);
      stats.failed += 1;
      continue;
    }

    await withTransaction(async (client) => {
      await client.query(
        `select record_earnings_event($1,$2,$3::smallint,$4::smallint,$5::date,$6,$7::date,$8,'confirmed',$10,
                                      null,null,null,false,$9,null,'high',0::smallint,false,null)`,
        [
          company.cik,
          company.ticker,
          target.fiscal_year,
          target.fiscal_quarter,
          target.period_end,
          target.report_form,
          parsed.date,
          parsed.timeOfDay,
          item.link,
          fromEdgar ? "edgar-fts" : "wire-rss",
        ]
      );
      await client.query(`update feed_items set parse_status = 'matched', parsed = $2 where id = $1`, [
        item.id,
        JSON.stringify({ method, parsed, cik: company.cik, ticker: company.ticker, fiscalYear: target.fiscal_year, quarter: target.fiscal_quarter, description }),
      ]);
    });
    stats.confirmed += 1;
  }
  return stats;
}

/** Tickers whose events changed in the last processing pass, for revalidation */
export async function recentlyConfirmedTickers(sinceISO: string): Promise<string[]> {
  const rows = await query<{ ticker: string }>(
    `select distinct ticker from earnings_events
      where status = 'confirmed' and source_type = 'wire-rss' and created_at >= $1::timestamptz`,
    [sinceISO]
  );
  return rows.map((r) => r.ticker);
}
