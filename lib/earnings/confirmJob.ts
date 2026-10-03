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
import { fetchPrnConferenceCalls, fetchReleaseOpening } from "./wireArchives";

// Feeds that are advisory streams by construction (EDGAR's pre-filtered 8-K
// search, PR Newswire's Conference Call Announcements category): a title-level
// regex miss is still worth a model call. A plain keyword search is not —
// GlobeNewswire's "earnings conference call" results are mostly results
// releases, and the regex already rejects those correctly.
export const ARCHIVE_FEEDS = new Set(["edgar-fts", "prn-calls"]);
import { type ParsedAdvisory, dateMentioned, parseAdvisory, parseTickers } from "./confirm";
import { getDayInfo } from "@/lib/tradingDays";
import { parseISO } from "./fiscal";
import { llmAvailable, parseAdvisoryWithModel } from "./llmParse";
import { displayName } from "./format";
import { todayET } from "./ingest";

export type FeedStats = { feeds: number; feedErrors: number; newItems: number };
export type ProcessStats = { processed: number; matched: number; confirmed: number; ignored: number; failed: number; llmCalls: number; llmMatched: number; pageReads: number };

// Regex outcomes worth a model call: the title had scheduling language but a
// piece was missing. "results already reported" and the non-earnings reasons
// are deliberate rejections and are never sent.
const LLM_WORTHY = new Set(["no quarter token", "no future date found"]);
const LLM_MAX_PER_RUN = 40;
const LLM_MAX_ATTEMPTS = 2;

// Parse failures where the wire's summary was simply too short: the release
// page itself (PR Newswire and GlobeNewswire permit reading it) usually holds
// the missing date, quarter or ticker. One read per item, bounded per run.
const PAGE_WORTHY = new Set(["no future date found", "no quarter token"]);
const PAGE_MAX_PER_RUN = 10;
const PAGE_HOSTS = new Set(["www.prnewswire.com", "www.globenewswire.com"]);

/** Wire release pages, and a company's own pages when the item came from its IR feed */
function pageReadable(link: string | null, feed: string): link is string {
  if (!link) return false;
  try {
    return PAGE_HOSTS.has(new URL(link).hostname) || feed.startsWith("ir-");
  } catch {
    return false;
  }
}

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
    const byGuid = new Map(sorted.map((i) => [i.guid.slice(0, 500), i]));
    const rows = await query<{ id: number; guid: string }>(`select id, guid from feed_items where id = any($1::bigint[])`, [
      inserted.map((r) => r.id),
    ]);
    // A feed that belongs to one company (its IR site) pins the company, so
    // name/ticker resolution is never needed for its items.
    await query(
      `update feed_items f set parsed = jsonb_strip_nulls(jsonb_build_object('description', t.description, 'cik', t.cik))
         from unnest($1::bigint[], $2::text[], $3::int[]) as t(id, description, cik)
        where f.id = t.id`,
      [rows.map((r) => r.id), rows.map((r) => byGuid.get(r.guid)?.description.slice(0, 4000) ?? ""), rows.map((r) => byGuid.get(r.guid)?.cik ?? null)]
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
  id: number;
  cik: number;
  ticker: string;
  fiscal_year: number;
  fiscal_quarter: number;
  period_end: string;
  report_form: string | null;
  event_date: string;
  status: string;
  /** The period's 10-Q/10-K is on file (a "reported" row is then settled) */
  has_report: boolean;
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
    // Conservative name match on normalized names, and it must be unique:
    // exact first ("Bank of Marin Bancorp"), then the announced name as the
    // whole-word prefix of exactly one SEC registrant name ("Verizon" for
    // VERIZON COMMUNICATIONS INC, "Digital Realty" for DIGITAL REALTY TRUST).
    const norm = (s: string) =>
      displayName(s)
        .toLowerCase()
        .replace(/[.,'’"]/g, "")
        .replace(/\b(inc|incorporated|corp|corporation|co|company|ltd|limited|plc|llc|lp|holdings?|group|the)\b/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
    const target = norm(parsed.companyName);
    const firstWord = target.split(" ")[0] ?? "";
    if (target.length < 3 || firstWord.length < 2) return null;
    const rows = await query<{ cik: number; ticker: string; name: string }>(
      `select cik, ticker, name from companies where active and name ilike $1`,
      [`%${firstWord}%`]
    );
    const keyed = rows.map((r) => ({ cik: r.cik, ticker: r.ticker, key: norm(r.name) }));
    const exact = keyed.filter((r) => r.key === target);
    if (exact.length === 1) return { cik: exact[0].cik, ticker: exact[0].ticker };
    if (exact.length > 1) return null; // two registrants share the name
    const prefix = keyed.filter((r) => r.key.startsWith(`${target} `));
    if (prefix.length === 1) return { cik: prefix[0].cik, ticker: prefix[0].ticker };
  }
  return null;
}

async function chooseQuarter(cik: number, parsed: ParsedAdvisory): Promise<Candidate | null> {
  const rows = await query<Candidate>(
    `select e.id, e.cik, e.ticker, e.fiscal_year, e.fiscal_quarter, e.period_end::text, e.report_form,
            e.event_date::text, e.status,
            exists (select 1 from filings f
                     where f.cik = e.cik and f.form in ('10-Q','10-K','10-QT','10-KT')
                       and f.report_date = e.period_end) as has_report
       from earnings_current e
      where e.cik = $1
        and ((e.status in ('estimated','confirmed')
              and e.event_date >= (now() at time zone 'America/New_York')::date - 14)
             or (e.status = 'reported'
                 and e.event_date >= (now() at time zone 'America/New_York')::date - 45))
      order by e.event_date asc`,
    [cik]
  );
  // A quarter marked "reported" from an 8-K, with no 10-Q/10-K on file yet,
  // while the company announces a LATER date for it: the 8-K was a
  // preliminary (a delivery report, a revenue pre-announcement), and the
  // announcement wins. Settled quarters are never candidates.
  const candidates = rows.filter((c) => c.status !== "reported" || (!c.has_report && parsed.date > c.event_date));
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

export async function processFeedItems(
  limit = 200,
  llmMaxPerRun = LLM_MAX_PER_RUN,
  pageMaxPerRun = PAGE_MAX_PER_RUN
): Promise<ProcessStats> {
  const stats: ProcessStats = { processed: 0, matched: 0, confirmed: 0, ignored: 0, failed: 0, llmCalls: 0, llmMatched: 0, pageReads: 0 };
  const pending = await query<{ id: number; feed: string; title: string; link: string | null; published_at: string | null; parsed: { description?: string; llmAttempts?: number; quarterRetries?: number; cik?: number } | null }>(
    `select id, feed, title, link, published_at::text, parsed from feed_items
      where parse_status = 'pending'
        and (parsed->>'retryAfter' is null or (parsed->>'retryAfter')::timestamptz <= now())
      order by id asc limit $1`,
    [limit]
  );

  for (const item of pending) {
    stats.processed += 1;
    const published = item.published_at ? new Date(item.published_at).toISOString() : new Date().toISOString();
    let description = item.parsed?.description ?? "";
    let outcome = parseAdvisory(item.title, description, published);
    let method: "regex" | "llm" = "regex";

    // The release page, read at most once per item and only when the wire's
    // summary left a piece missing.
    let page: string | null = null;
    const readPage = async (): Promise<string> => {
      if (page !== null) return page;
      page = "";
      if (!pageReadable(item.link, item.feed) || stats.pageReads >= pageMaxPerRun) return page;
      stats.pageReads += 1;
      try {
        page = await fetchReleaseOpening(item.link);
      } catch (err) {
        console.error(`[advisories] could not read ${item.link}:`, (err as Error).message);
      }
      return page;
    };
    if (!outcome.ok && PAGE_WORTHY.has(outcome.reason)) {
      const opening = await readPage();
      if (opening) {
        description = `${description} ${opening}`.slice(0, 6000);
        outcome = parseAdvisory(item.title, description, published);
      }
    }

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

    // Sanity guards on any parsed date: companies report on trading days, a
    // model-supplied date must be stated literally in the text (no "early
    // November" → November 1), and a date that has already passed by the time
    // the item is processed (backfills of old listings) is stale — if the
    // company kept it, the 8-K has superseded everything; if it didn't, the
    // announcement must not pin an overdue company to a date it missed.
    if (outcome.ok) {
      const d = outcome.parsed.date;
      if (!getDayInfo(parseISO(d)).isTradingDay) {
        outcome = { ok: false, reason: `date ${d} is not a trading day (${method})` };
      } else if (method === "llm" && !dateMentioned(`${item.title} ${description}`, d)) {
        outcome = { ok: false, reason: `llm date ${d} not stated in text` };
      } else if (d < todayET()) {
        outcome = { ok: false, reason: `date ${d} had passed when processed` };
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
    let company = item.parsed?.cik
      ? (await query<{ cik: number; ticker: string }>(`select cik, ticker from companies where cik = $1 and active`, [item.parsed.cik]))[0] ?? null
      : await resolveCik(parsed);
    if (!company && !item.parsed?.cik) {
      // The "(NYSE: XYZ)" mention is usually in the first paragraph, which
      // the feed summary may have cut off.
      const opening = await readPage();
      const extra = opening ? parseTickers(opening).filter((t) => !parsed.tickers.includes(t)) : [];
      if (extra.length) company = await resolveCik({ ...parsed, tickers: [...parsed.tickers, ...extra] });
    }
    const target = company ? await chooseQuarter(company.cik, parsed) : null;

    if (company && !target && parsed.date >= todayET() && !item.parsed?.quarterRetries) {
      // The company is known but no quarter fits — usually its estimates are
      // missing or stale (a new listing, a quarter not yet rolled forward).
      // Ask for a refresh and retry once after it has had time to run.
      await query(`update companies set refresh_requested_at = coalesce(refresh_requested_at, now()) where cik = $1`, [company.cik]);
      await query(`update feed_items set parsed = coalesce(parsed, '{}'::jsonb) || $2::jsonb where id = $1`, [
        item.id,
        JSON.stringify({
          quarterRetries: 1,
          retryAfter: new Date(Date.now() + 20 * 60_000).toISOString(),
          cik: company.cik,
          method,
          parsed,
          description,
        }),
      ]);
      continue;
    }

    if (!company || !target) {
      await query(`update feed_items set parse_status = 'failed', parsed = $2 where id = $1`, [
        item.id,
        JSON.stringify({ reason: company ? "no matching upcoming quarter" : "company not resolved", method, parsed, description }),
      ]);
      stats.failed += 1;
      continue;
    }

    // An events feed names the date but not the hour; keep the time of day
    // the company's pattern already gave the quarter.
    if (parsed.timeOfDay === "unknown" && item.feed === "ir-events") {
      const cur = await query<{ time_of_day: ParsedAdvisory["timeOfDay"] }>(
        `select time_of_day from earnings_events where id = $1`,
        [target.id]
      );
      if (cur[0]?.time_of_day && cur[0].time_of_day !== "unknown") parsed.timeOfDay = cur[0].time_of_day;
    }

    await withTransaction(async (client) => {
      const sourceType = fromEdgar ? "edgar-fts" : item.feed.startsWith("ir-") ? "ir-site" : "wire-rss";
      if (target.status === "reported") {
        // Overriding a preliminary-8-K "reported" row: the write function
        // never lets a confirmation replace a report, so supersede it here,
        // leaving the row in place for the audit trail.
        const { rows: inserted } = await client.query<{ id: number }>(
          `insert into earnings_events (cik, ticker, fiscal_year, fiscal_quarter, period_end, report_form, event_date,
                                        time_of_day, status, source_type, source_url, confidence, window_days)
           values ($1,$2,$3::smallint,$4::smallint,$5::date,$6,$7::date,$8,'confirmed',$9,$10,'high',0::smallint)
           returning id`,
          [company.cik, company.ticker, target.fiscal_year, target.fiscal_quarter, target.period_end, target.report_form, parsed.date, parsed.timeOfDay, sourceType, item.link]
        );
        await client.query(
          `update earnings_events set superseded_by = $2, superseded_at = now() where id = $1 and superseded_by is null`,
          [target.id, inserted[0].id]
        );
      } else {
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
            sourceType,
          ]
        );
      }
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
      where status = 'confirmed' and source_type in ('wire-rss','edgar-fts','ir-site') and created_at >= $1::timestamptz`,
    [sinceISO]
  );
  return rows.map((r) => r.ticker);
}
