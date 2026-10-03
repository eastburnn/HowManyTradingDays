/**
 * The scheduled "tick": one bounded, idempotent unit of pipeline work,
 * invoked every 15 minutes by pg_cron via /api/jobs/tick.
 *
 * Each tick:
 *   1. ingests any EDGAR daily form indexes not yet processed, flagging
 *      companies in our universe that filed something relevant;
 *   2. flags companies whose estimated date has slipped into the past
 *      (the stale-estimate watchdog);
 *   3. refreshes flagged companies first, then the stalest ones, until the
 *      time budget runs out (a rolling full refresh, roughly weekly);
 *   4. revalidates the pages of every company it touched.
 *
 * Everything is resumable: a tick that is cut off or doubled leaves the
 * database consistent and the next tick simply continues.
 */

import { revalidatePath } from "next/cache";
import { query } from "./db";
import { SEC_USER_AGENT, fetchExchangeListings } from "./edgar";
import { refreshCompany, todayET } from "./ingest";
import { addDays, getDayInfo, toISODate } from "@/lib/tradingDays";
import { parseISO } from "./fiscal";
import { type FeedStats, type ProcessStats, pollFeeds, processFeedItems, recentlyConfirmedTickers } from "./confirmJob";
import { searchEdgarAdvisories, stageEdgarAdvisories } from "./edgarAdvisories";

const RELEVANT_FORMS = new Set(["8-K", "10-Q", "10-K", "NT 10-Q", "NT 10-K"]);
const STALE_AFTER_DAYS = 7; // every active company refreshes at least this often
const REFRESH_CONCURRENCY = 4;
const DAILY_INDEX_LOOKBACK_DAYS = 10; // how far back to backfill missed index days

export type TickStats = {
  indexDaysProcessed: string[];
  indexFilingsMatched: number;
  overdueFlagged: number;
  refreshed: number;
  refreshFailed: number;
  revalidated: number;
  feeds: FeedStats | null;
  advisories: ProcessStats | null;
  edgarAdvisories: { candidates: number; staged: number } | null;
  listings: { missing: number; deactivated: string[]; reactivated: string[] } | null;
  budgetMs: number;
  elapsedMs: number;
};

/* ---------------------------------------------
   PIPELINE STATE
----------------------------------------------*/

async function getState<T>(key: string): Promise<T | null> {
  const rows = await query<{ value: T }>(`select value from pipeline_state where key = $1`, [key]);
  return rows[0]?.value ?? null;
}

async function setState(key: string, value: unknown): Promise<void> {
  await query(
    `insert into pipeline_state (key, value) values ($1, $2)
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [key, JSON.stringify(value)]
  );
}

/* ---------------------------------------------
   1. EDGAR DAILY FORM INDEX
----------------------------------------------*/

function quarterOf(iso: string): number {
  return Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1;
}

/**
 * Fetch one day's form index. Returns null when the SEC hasn't published it
 * (weekends, federal holidays, or not yet available for today).
 */
async function fetchDailyFormIndex(iso: string): Promise<{ form: string; cik: number }[] | null> {
  const url = `https://www.sec.gov/Archives/edgar/daily-index/${iso.slice(0, 4)}/QTR${quarterOf(iso)}/form.${iso.replace(/-/g, "")}.idx`;
  const res = await fetch(url, { headers: { "User-Agent": SEC_USER_AGENT } });
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) throw new Error(`daily index ${iso}: HTTP ${res.status}`);
  const text = await res.text();

  // Fixed-width body after a dashed separator line:
  // Form Type | Company Name | CIK | Date Filed | File Name
  const out: { form: string; cik: number }[] = [];
  let inBody = false;
  for (const line of text.split("\n")) {
    if (!inBody) {
      if (line.startsWith("----")) inBody = true;
      continue;
    }
    const form = line.slice(0, 12).trim();
    if (!RELEVANT_FORMS.has(form)) continue;
    const m = line.slice(12).match(/\s(\d{1,10})\s+\d{4}-?\d{2}-?\d{2}\s/);
    if (m) out.push({ form, cik: Number(m[1]) });
  }
  return out;
}

async function ingestDailyIndexes(today: string, stats: TickStats): Promise<void> {
  const processed = new Set<string>((await getState<string[]>("daily_index_done")) ?? []);
  const start = toISODate(addDays(parseISO(today), -DAILY_INDEX_LOOKBACK_DAYS));

  for (let d = parseISO(start); toISODate(d) <= today; d = addDays(d, 1)) {
    const iso = toISODate(d);
    if (processed.has(iso)) continue;
    const dow = d.getDay();
    if (dow === 0 || dow === 6) {
      processed.add(iso);
      continue;
    }
    const rows = await fetchDailyFormIndex(iso);
    if (rows === null) {
      // Not published (yet). Mark past market holidays done; keep waiting on
      // recent business days — the SEC posts the index with a lag.
      if (!getDayInfo(d).isTradingDay && iso < today) processed.add(iso);
      continue;
    }
    const ciks = [...new Set(rows.map((r) => r.cik))];
    if (ciks.length) {
      // Inactive companies are flagged too: a filing from one that stopped
      // reporting (or was deactivated by the listing sweep) is how it comes back.
      const flagged = await query<{ cik: number }>(
        `update companies set refresh_requested_at = coalesce(refresh_requested_at, now())
          where cik = any($1::int[])
          returning cik`,
        [ciks]
      );
      stats.indexFilingsMatched += flagged.length;
    }
    processed.add(iso);
    stats.indexDaysProcessed.push(iso);
  }

  // Keep the done-set bounded to the lookback window
  await setState("daily_index_done", [...processed].filter((iso) => iso >= start).sort());
}

/* ---------------------------------------------
   2. STALE-ESTIMATE WATCHDOG
----------------------------------------------*/

async function flagOverdueEstimates(today: string, stats: TickStats): Promise<void> {
  const rows = await query<{ cik: number }>(
    `update companies c set refresh_requested_at = now()
      where c.active and c.refresh_requested_at is null
        and exists (
          select 1 from earnings_events e
           where e.cik = c.cik and e.superseded_by is null
             and e.status = 'estimated' and e.event_date < $1::date
             and not estimate_is_stale(e.period_end, e.report_form)
        )
      returning c.cik`,
    [today]
  );
  stats.overdueFlagged = rows.length;
}

/* ---------------------------------------------
   2c. LISTING SWEEP (once a day)
----------------------------------------------*/

/**
 * Companies whose primary symbol has vanished from the SEC's exchange list —
 * acquired, delisted, gone dark, or left with only notes and warrants
 * listed — leave the calendar after missing two daily sweeps (one glitchy
 * file must not deactivate anyone). A symbol that reappears reactivates the
 * company. A renamed symbol is harmless: the refresh adopts EDGAR's new
 * ticker before the second sweep. Only companies this sweep deactivated are
 * ever reactivated by it (listing_missing_since marks them).
 */
async function sweepListingsDaily(today: string, stats: TickStats): Promise<void> {
  const last = await getState<string>("listing_sweep_last_day");
  if (last === today) return;
  const tickers = [...new Set((await fetchExchangeListings()).map((l) => l.ticker.toUpperCase()))];
  if (tickers.length < 1000) throw new Error(`exchange list looks truncated (${tickers.length} symbols)`);

  const missing = await query<{ cik: number }>(
    `update companies set listing_missing_since = coalesce(listing_missing_since, now()), refresh_requested_at = coalesce(refresh_requested_at, now())
      where active and not (upper(ticker) = any($1::text[])) returning cik`,
    [tickers]
  );
  const reactivated = await query<{ ticker: string }>(
    `update companies set active = true, listing_missing_since = null, refresh_requested_at = coalesce(refresh_requested_at, now())
      where not active and listing_missing_since is not null and upper(ticker) = any($1::text[]) returning ticker`,
    [tickers]
  );
  await query(`update companies set listing_missing_since = null where active and listing_missing_since is not null and upper(ticker) = any($1::text[])`, [tickers]);
  const deactivated = await query<{ ticker: string }>(
    `update companies set active = false
      where active and listing_missing_since < now() - interval '36 hours' returning ticker`
  );
  stats.listings = { missing: missing.length, deactivated: deactivated.map((r) => r.ticker), reactivated: reactivated.map((r) => r.ticker) };
  await setState("listing_sweep_last_day", today);
}

/* ---------------------------------------------
   2b. EDGAR FULL-TEXT ADVISORY SWEEP (once a day)
----------------------------------------------*/

const EDGAR_SWEEP_LOOKBACK_DAYS = 4; // overlap covers EDGAR's indexing lag and a missed day

async function sweepEdgarAdvisoriesDaily(today: string, stats: TickStats): Promise<void> {
  const last = await getState<string>("edgar_fts_last_day");
  if (last === today) return;
  const start = toISODate(addDays(parseISO(today), -EDGAR_SWEEP_LOOKBACK_DAYS));
  const candidates = await searchEdgarAdvisories(start, today);
  const staged = await stageEdgarAdvisories(candidates);
  stats.edgarAdvisories = { candidates: candidates.length, staged };
  await setState("edgar_fts_last_day", today);
}

/* ---------------------------------------------
   3. REFRESH BATCH (requested first, then stalest)
----------------------------------------------*/

async function nextBatch(limit: number): Promise<{ cik: number; ticker: string }[]> {
  // Explicit requests are honored for inactive companies too (a new filing
  // or a relisting is how one returns); the rolling refresh is active-only.
  return query(
    `select cik, ticker from companies
      where refresh_requested_at is not null
         or (active and (last_refreshed_at is null
                         or last_refreshed_at < now() - ($2 || ' days')::interval))
      order by refresh_requested_at asc nulls last, last_refreshed_at asc nulls first
      limit $1`,
    [limit, STALE_AFTER_DAYS]
  );
}

async function refreshBatch(deadline: number, today: string, stats: TickStats, touched: Set<string>): Promise<void> {
  // Pull a generous batch; the time budget, not the batch size, ends the loop.
  const batch = await nextBatch(400);
  let cursor = 0;

  async function worker() {
    while (cursor < batch.length && Date.now() < deadline) {
      const { cik, ticker } = batch[cursor++];
      try {
        const r = await refreshCompany(cik, { today });
        stats.refreshed += 1;
        touched.add(r.ticker);
        if (r.ticker !== ticker) touched.add(ticker);
      } catch (err) {
        stats.refreshFailed += 1;
        console.error(`[tick] refresh ${ticker} (CIK ${cik}) failed:`, (err as Error).message);
        // Push it back so one bad company can't block the queue
        await query(`update companies set refresh_requested_at = null, last_refreshed_at = now() where cik = $1`, [cik]).catch(() => {});
      }
    }
  }
  await Promise.all(Array.from({ length: REFRESH_CONCURRENCY }, worker));
}

/* ---------------------------------------------
   RUN
----------------------------------------------*/

export async function runTick(budgetMs: number): Promise<TickStats> {
  const started = Date.now();
  const deadline = started + budgetMs;
  const today = todayET();
  const stats: TickStats = {
    indexDaysProcessed: [],
    indexFilingsMatched: 0,
    overdueFlagged: 0,
    refreshed: 0,
    refreshFailed: 0,
    revalidated: 0,
    feeds: null,
    advisories: null,
    edgarAdvisories: null,
    listings: null,
    budgetMs,
    elapsedMs: 0,
  };

  const [run] = await query<{ id: number }>(`insert into job_runs (job) values ('tick') returning id`);
  const touched = new Set<string>();

  try {
    await ingestDailyIndexes(today, stats);
    await flagOverdueEstimates(today, stats);
    try {
      await sweepListingsDaily(today, stats);
    } catch (err) {
      console.error("[tick] listing sweep failed:", (err as Error).message);
    }
    const feedsStarted = new Date().toISOString();
    try {
      await sweepEdgarAdvisoriesDaily(today, stats);
    } catch (err) {
      console.error("[tick] EDGAR advisory sweep failed:", (err as Error).message);
    }
    stats.feeds = await pollFeeds({ includeLists: true });
    stats.advisories = await processFeedItems();
    for (const t of await recentlyConfirmedTickers(feedsStarted)) touched.add(t);
    await refreshBatch(deadline, today, stats, touched);

    for (const ticker of touched) {
      try {
        revalidatePath(`/earnings/${ticker.toLowerCase()}`);
        stats.revalidated += 1;
      } catch {
        // revalidation is best-effort; ISR will catch up within a day
      }
    }
    if (touched.size) {
      try {
        revalidatePath("/earnings");
      } catch {}
    }

    stats.elapsedMs = Date.now() - started;
    await query(`update job_runs set finished_at = now(), status = 'ok', stats = $2 where id = $1`, [
      run.id,
      JSON.stringify(stats),
    ]);
  } catch (err) {
    stats.elapsedMs = Date.now() - started;
    await query(`update job_runs set finished_at = now(), status = 'error', stats = $2, error = $3 where id = $1`, [
      run.id,
      JSON.stringify(stats),
      (err as Error).message,
    ]).catch(() => {});
    throw err;
  }
  return stats;
}

/* ---------------------------------------------
   HEALTH
----------------------------------------------*/

export type Health = {
  ok: boolean;
  problems: string[];
  lastOkTick: string | null;
  lastIndexDay: string | null;
  overdueEstimates: number;
  activeCompanies: number;
  withUpcoming: number;
  filingsLast24h: number;
  feedItemsLast6h: number;
  advisoriesConfirmedLast7d: number;
};

export async function checkHealth(): Promise<Health> {
  const today = todayET();
  const [row] = await query<{
    last_ok_tick: string | null;
    overdue: string;
    active: string;
    with_upcoming: string;
    filings_24h: string;
    feed_items_6h: string;
    confirmed_7d: string;
  }>(`
    select
      (select max(finished_at)::text from job_runs where job = 'tick' and status = 'ok') as last_ok_tick,
      (select count(*) from earnings_current where status = 'estimated' and event_date < $1::date
         and not estimate_is_stale(period_end, report_form)) as overdue,
      (select count(*) from companies where active) as active,
      (select count(*) from earnings_next) as with_upcoming,
      (select count(*) from filings where created_at > now() - interval '24 hours') as filings_24h,
      (select count(*) from feed_items where fetched_at > now() - interval '6 hours') as feed_items_6h,
      (select count(*) from earnings_events where status = 'confirmed' and source_type in ('wire-rss','edgar-fts') and created_at > now() - interval '7 days') as confirmed_7d
  `, [today]);
  const done = (await getState<string[]>("daily_index_done")) ?? [];
  const lastIndexDay = done.length ? done[done.length - 1] : null;

  const problems: string[] = [];
  const lastOk = row.last_ok_tick ? new Date(row.last_ok_tick) : null;
  if (!lastOk || Date.now() - lastOk.getTime() > 2 * 3600_000) problems.push("no successful tick in the last 2 hours");

  // The index for business day D is expected by D+1; allow weekends/holidays.
  if (lastIndexDay) {
    let expected = parseISO(today);
    expected = addDays(expected, -1);
    while (!getDayInfo(expected).isTradingDay) expected = addDays(expected, -1);
    expected = addDays(expected, -1); // one extra day of slack for SEC posting lag
    if (lastIndexDay < toISODate(expected)) problems.push(`daily index stalled at ${lastIndexDay}`);
  } else {
    problems.push("daily index never processed");
  }

  const active = Number(row.active);
  const overdue = Number(row.overdue);
  if (active > 0 && overdue > Math.max(20, active * 0.02)) problems.push(`${overdue} overdue estimates`);
  if (getDayInfo(parseISO(today)).isTradingDay && Number(row.filings_24h) === 0 && lastOk) {
    const etHour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }).format(new Date()));
    if (etHour >= 12) problems.push("no new filings ingested in 24 hours");
  }

  // Wires publish around the clock on business days; silence means the poller died.
  if (lastOk && getDayInfo(parseISO(today)).isTradingDay && Number(row.feed_items_6h) === 0) {
    problems.push("no wire feed items fetched in 6 hours");
  }

  return {
    ok: problems.length === 0,
    problems,
    lastOkTick: row.last_ok_tick,
    lastIndexDay,
    overdueEstimates: overdue,
    activeCompanies: active,
    withUpcoming: Number(row.with_upcoming),
    filingsLast24h: Number(row.filings_24h),
    feedItemsLast6h: Number(row.feed_items_6h),
    advisoriesConfirmedLast7d: Number(row.confirmed_7d),
  };
}

/* ---------------------------------------------
   FEEDS-ONLY RUN (every 5 minutes)
----------------------------------------------*/

export type FeedRunStats = { feeds: FeedStats; advisories: ProcessStats; revalidated: number; elapsedMs: number };

export async function runFeeds(): Promise<FeedRunStats> {
  const started = Date.now();
  const startedISO = new Date(started).toISOString();
  const [run] = await query<{ id: number }>(`insert into job_runs (job) values ('feeds') returning id`);
  try {
    const feeds = await pollFeeds();
    const advisories = await processFeedItems();
    let revalidated = 0;
    for (const ticker of await recentlyConfirmedTickers(startedISO)) {
      try {
        revalidatePath(`/earnings/${ticker.toLowerCase()}`);
        revalidated += 1;
      } catch {}
    }
    if (revalidated) {
      try {
        revalidatePath("/earnings");
      } catch {}
    }
    const stats: FeedRunStats = { feeds, advisories, revalidated, elapsedMs: Date.now() - started };
    await query(`update job_runs set finished_at = now(), status = 'ok', stats = $2 where id = $1`, [run.id, JSON.stringify(stats)]);
    return stats;
  } catch (err) {
    await query(`update job_runs set finished_at = now(), status = 'error', error = $2 where id = $1`, [run.id, (err as Error).message]).catch(() => {});
    throw err;
  }
}
