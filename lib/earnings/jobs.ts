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
 *
 * Two rules keep this from needing a person:
 *
 *   - Every step is isolated. One step failing (the SEC answering 503 for a
 *     daily index, a feed timing out) is recorded and the rest of the tick
 *     still runs; the health check reports a step that keeps failing.
 *   - A change to the pipeline's logic applies itself. Each tick compares the
 *     deployed logic fingerprints with the ones that last ran (logicHash.ts);
 *     when they differ it starts a flush: every company is refreshed again
 *     and recently ignored feed items go back through the parser, behind the
 *     live work, without anyone running a backfill.
 */

import { revalidatePath } from "next/cache";
import { query } from "./db";
import { SEC_USER_AGENT, fetchExchangeListings } from "./edgar";
import { refreshCompany, todayET } from "./ingest";
import { addDays, getDayInfo, toISODate } from "@/lib/tradingDays";
import { parseISO } from "./fiscal";
import { type FeedStats, type ProcessStats, pollFeeds, processFeedItems, recentlyConfirmedTickers } from "./confirmJob";
import { searchEdgarAdvisories, stageEdgarAdvisories } from "./edgarAdvisories";
import { type IrSource, discoverIrSource, readIrSource } from "./irSites";
import { checkExpectedReporters, refreshFlagged, settleResultsHeadlines, watchLiveFilings } from "./reportWatch";
import { stageItems } from "./confirmJob";
import { type LogicVersions, computeLogicVersions } from "./logicHash";

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
  reportWatch?: { expected: { checked: number; queued: number }; live: { entries: number; results: number; queued: number } };
  resultsRecorded?: number;
  revalidated: number;
  feeds: FeedStats | null;
  advisories: ProcessStats | null;
  edgarAdvisories: { candidates: number; staged: number } | null;
  listings: { missing: number; deactivated: string[]; reactivated: string[] } | null;
  irDiscovered: { checked: number; found: string[] } | null;
  /** The logic flush in progress, if any (see syncLogicFlush) */
  logicFlush: LogicFlushStatus | null;
  /** Steps that failed this tick; the tick itself still completed */
  stepErrors: string[];
  budgetMs: number;
  elapsedMs: number;
};

/** Record a failed step without ending the run */
function stepError(stats: { stepErrors: string[] }, step: string, err: unknown): void {
  const message = (err as Error)?.message ?? String(err);
  console.error(`[jobs] step "${step}" failed:`, message);
  stats.stepErrors.push(`${step}: ${message.slice(0, 160)}`);
}

/** Run one step of a job; a failure is recorded and the job carries on */
async function runStep<T>(stats: { stepErrors: string[] }, step: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    stepError(stats, step, err);
    return undefined;
  }
}

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
   0. LOGIC FLUSH (a logic change applies itself)
----------------------------------------------*/

type LogicFlushState = {
  company: { version: string; startedAt: string | null; finishedAt?: string | null };
  feeds: { version: string; startedAt: string | null; requeued?: number };
};

export type LogicFlushStatus = LogicFlushState & {
  /** Active companies not yet refreshed since the company flush began */
  companiesPending: number;
  /** Feed items waiting to go back through the parser */
  feedItemsPending: number;
};

const LOGIC_FLUSH_KEY = "logic_flush";
/** Feed items taken per run; the time window given to processFeedItems is the real limit */
const FEED_ITEMS_PER_RUN = 1500;
/** Ignored and failed feed items are kept this long (the feed-items-cleanup job), so this is all there is to redo */
const FEED_REPROCESS_DAYS = 30;

/** The logic fingerprints of the code that is running */
export function deployedLogic(): LogicVersions | null {
  const company = process.env.EARNINGS_LOGIC_COMPANY;
  const feeds = process.env.EARNINGS_LOGIC_FEEDS;
  if (company && feeds) return { company, feeds };
  try {
    return computeLogicVersions(); // scripts and local runs: straight from the source on disk
  } catch {
    return null;
  }
}

/**
 * Only the production deployment may start a flush. A local run or a preview
 * build shares the database and would otherwise flip the recorded version
 * back and forth with production. EARNINGS_FLUSH=1 opts a run in (tests).
 */
function mayStartFlush(): boolean {
  return process.env.VERCEL_ENV === "production" || process.env.EARNINGS_FLUSH === "1";
}

/** Put recently ignored and failed feed items back in the parser's queue; returns how many */
async function requeueFeedItems(version: string): Promise<number> {
  // Results headlines have already done their work (queued a refresh, or
  // recorded the report); matched items are confirmations and stay as they are.
  const rows = await query<{ id: number }>(
    `update feed_items
        set parse_status = 'pending',
            parsed = (coalesce(parsed, '{}'::jsonb) - 'retryAfter') || jsonb_build_object('reprocess', $1::text)
      where parse_status in ('ignored', 'failed')
        and fetched_at > now() - ($2 || ' days')::interval
        and not (coalesce(parsed, '{}'::jsonb) ? 'resultsHeadline')
      returning id`,
    [version, FEED_REPROCESS_DAYS]
  );
  return rows.length;
}

async function logicFlushStatus(state: LogicFlushState): Promise<LogicFlushStatus> {
  const [row] = await query<{ companies: string; items: string }>(
    `select
       (select count(*) from companies where active and $1::timestamptz is not null and last_refreshed_at < $1::timestamptz) as companies,
       (select count(*) from feed_items where parse_status = 'pending' and parsed ? 'reprocess') as items`,
    [state.company.startedAt]
  );
  return { ...state, companiesPending: Number(row.companies), feedItemsPending: Number(row.items) };
}

/**
 * Compare the running code's logic fingerprints with the ones that last ran
 * and start a flush for whichever changed. The refresh batch and the feed
 * parser do the actual work over the following ticks.
 */
export async function syncLogicFlush(): Promise<LogicFlushStatus | null> {
  const deployed = deployedLogic();
  if (!deployed) return null;
  let state = await getState<LogicFlushState>(LOGIC_FLUSH_KEY);
  const now = new Date().toISOString();

  if (!state) {
    // First sight of the fingerprints: start tracking, nothing to redo.
    state = { company: { version: deployed.company, startedAt: null }, feeds: { version: deployed.feeds, startedAt: null } };
    if (mayStartFlush()) await setState(LOGIC_FLUSH_KEY, state);
    return logicFlushStatus(state);
  }

  if (mayStartFlush()) {
    let changed = false;
    if (state.company.version !== deployed.company) {
      state = { ...state, company: { version: deployed.company, startedAt: now, finishedAt: null } };
      changed = true;
      console.log(`[jobs] company logic changed to ${deployed.company}: refreshing every company`);
    }
    if (state.feeds.version !== deployed.feeds) {
      const requeued = await requeueFeedItems(deployed.feeds);
      state = { ...state, feeds: { version: deployed.feeds, startedAt: now, requeued } };
      changed = true;
      console.log(`[jobs] feed logic changed to ${deployed.feeds}: ${requeued} feed items back in the queue`);
    }
    if (changed) await setState(LOGIC_FLUSH_KEY, state);
  }

  const status = await logicFlushStatus(state);
  if (mayStartFlush() && state.company.startedAt && !state.company.finishedAt && status.companiesPending === 0) {
    state = { ...state, company: { ...state.company, finishedAt: now } };
    await setState(LOGIC_FLUSH_KEY, state);
    return { ...status, ...state };
  }
  return status;
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
    let rows: Awaited<ReturnType<typeof fetchDailyFormIndex>>;
    try {
      rows = await fetchDailyFormIndex(iso);
    } catch (err) {
      // The SEC answers 503 now and then. Leave the day unprocessed (the next
      // tick asks again) and carry on with the other days and the other steps.
      stepError(stats, "daily index", err);
      continue;
    }
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
             and e.status in ('estimated', 'confirmed') and e.event_date < $1::date
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
   2d. INVESTOR-RELATIONS SITES
----------------------------------------------*/

const IR_DISCOVER_PER_TICK = 20;
const IR_POLL_PER_RUN = 15;
const IR_POLL_INTERVAL_HOURS = 20;

/** Text of a company's latest earnings release exhibit on EDGAR, for IR-host discovery */
export async function latestReleaseText(cik: number): Promise<string> {
  const [row] = await query<{ accession: string | null }>(
    `select source_accession as accession from earnings_current
      where cik = $1 and status = 'reported' and source_type = 'edgar-8k' and source_accession is not null
      order by event_date desc limit 1`,
    [cik]
  );
  if (!row?.accession) return "";
  const folder = `https://www.sec.gov/Archives/edgar/data/${cik}/${row.accession.replace(/-/g, "")}/`;
  const index = await (await fetch(folder, { headers: { "User-Agent": SEC_USER_AGENT } })).text();
  const docs = [...index.matchAll(/href="(\/Archives\/edgar\/data\/[^"]+\.(?:htm|txt))"/gi)].map((m) => m[1]).filter((h) => !/index/i.test(h));
  const exhibit = docs.find((d) => /ex[-_]?99|99-?1|exhibit/i.test(d)) ?? docs[0];
  if (!exhibit) return "";
  await new Promise((r) => setTimeout(r, 150)); // stay well under EDGAR's request rate
  const html = await (await fetch(`https://www.sec.gov${exhibit}`, { headers: { "User-Agent": SEC_USER_AGENT } })).text();
  return html.replace(/<[^>]+>/g, " ").slice(0, 60_000);
}

/** Find IR feeds for companies not yet looked at (largest first), a few per tick */
async function discoverIrSourcesBatch(deadline: number, stats: TickStats): Promise<void> {
  const todo = await query<{ cik: number; ticker: string; name: string }>(
    `select c.cik, c.ticker, c.name from companies c
      where c.active and not exists (select 1 from ir_sources s where s.cik = c.cik and s.discovered_at > now() - interval '30 days')
      order by (c.filer_category = 'large-accelerated') desc, (c.filer_category = 'accelerated') desc, c.indexed desc, c.ticker
      limit $1`,
    [IR_DISCOVER_PER_TICK]
  );
  const found: string[] = [];
  for (const c of todo) {
    if (Date.now() > deadline) break;
    try {
      // The investor-link search stops opening pages 20 seconds before the tick's budget ends
      const src = await discoverIrSource(c.cik, await latestReleaseText(c.cik), { name: c.name, ticker: c.ticker }, deadline - 20_000);
      if (src.platform === "q4" || src.platform === "investis" || src.platform === "rss") found.push(`${c.ticker}:${src.platform}`);
    } catch (err) {
      console.error(`[tick] IR discovery ${c.ticker}:`, (err as Error).message);
    }
  }
  stats.irDiscovered = { checked: todo.length, found };
}

/** Read the feeds of the companies least recently read (daily each), staging what they carry */
export async function pollIrSourcesBatch(limit = IR_POLL_PER_RUN): Promise<{ polled: number; staged: number; failed: number }> {
  const today = todayET();
  const due = await query<IrSource>(
    `select cik, host, platform, events_url, releases_url from ir_sources
      where platform in ('q4','investis','rss')
        and (last_polled_at is null or last_polled_at < now() - ($2 || ' hours')::interval)
      order by last_polled_at asc nulls first limit $1`,
    [limit, IR_POLL_INTERVAL_HOURS]
  );
  let staged = 0;
  let failed = 0;
  for (const src of due) {
    const r = await readIrSource(src, today);
    staged += await stageItems("ir-events", r.events);
    staged += await stageItems("ir-releases", r.releases);
    const ok = r.fetched > 0 && r.failed === 0;
    if (!ok) failed += 1;
    await query(
      `update ir_sources set last_polled_at = now(), last_status = $2,
              consecutive_failures = case when $3 then 0 else consecutive_failures + 1 end
        where cik = $1`,
      [src.cik, ok ? "ok" : `failed ${r.failed}/${r.fetched || 1}`, ok]
    );
  }
  return { polled: due.length, staged, failed };
}

/* ---------------------------------------------
   3. REFRESH BATCH (requested first, then stalest)
----------------------------------------------*/

export async function nextBatch(limit: number, flushStartedAt: string | null): Promise<{ cik: number; ticker: string }[]> {
  // Explicit requests are honored for inactive companies too (a new filing
  // or a relisting is how one returns); the rolling refresh is active-only.
  // During a logic flush every company not refreshed since it began is due,
  // still behind the explicit requests so a company that has just reported
  // never waits for the flush.
  return query(
    `select cik, ticker from companies
      where refresh_requested_at is not null
         or (active and (last_refreshed_at is null
                         or last_refreshed_at < now() - ($2 || ' days')::interval
                         or ($3::timestamptz is not null and last_refreshed_at < $3::timestamptz)))
      order by refresh_requested_at asc nulls last, last_refreshed_at asc nulls first
      limit $1`,
    [limit, STALE_AFTER_DAYS, flushStartedAt]
  );
}

async function refreshBatch(deadline: number, today: string, stats: TickStats, touched: Set<string>): Promise<void> {
  // Pull a generous batch; the time budget, not the batch size, ends the loop.
  const batch = await nextBatch(400, stats.logicFlush?.company.startedAt ?? null);
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
    irDiscovered: null,
    logicFlush: null,
    stepErrors: [],
    budgetMs,
    elapsedMs: 0,
  };

  const [run] = await query<{ id: number }>(`insert into job_runs (job) values ('tick') returning id`);
  const touched = new Set<string>();

  try {
    // Each step stands alone: a failure is recorded in stats.stepErrors and
    // the steps after it still run.
    stats.logicFlush = (await runStep(stats, "logic flush", () => syncLogicFlush())) ?? null;
    await runStep(stats, "daily index", () => ingestDailyIndexes(today, stats));
    await runStep(stats, "overdue estimates", () => flagOverdueEstimates(today, stats));
    await runStep(stats, "listing sweep", () => sweepListingsDaily(today, stats));
    const feedsStarted = new Date().toISOString();
    await runStep(stats, "EDGAR advisory sweep", () => sweepEdgarAdvisoriesDaily(today, stats));
    stats.feeds = (await runStep(stats, "wire feeds", () => pollFeeds({ includeLists: true }))) ?? null;
    // Bounded by time, not by count: new items are few and come first; what is
    // left of the window works through any reprocess queue.
    stats.advisories = (await runStep(stats, "feed parsing", () => processFeedItems(FEED_ITEMS_PER_RUN, undefined, undefined, started + 70_000))) ?? null;
    await runStep(stats, "confirmed tickers", async () => {
      for (const t of await recentlyConfirmedTickers(feedsStarted)) touched.add(t);
    });
    // Companies that have just reported go to the front of the refresh queue
    await runStep(stats, "report watch", async () => {
      stats.reportWatch = { expected: await checkExpectedReporters(today, { deadline: deadline - 120_000 }), live: await watchLiveFilings() };
    });
    await runStep(stats, "refresh batch", () => refreshBatch(deadline - 45_000, today, stats, touched));
    await runStep(stats, "results headlines", async () => {
      stats.resultsRecorded = await settleResultsHeadlines();
    });
    // IR-site discovery takes what is left of the budget (a few companies per tick)
    await runStep(stats, "IR discovery", () => discoverIrSourcesBatch(deadline, stats));

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
  contactFailedLast24h: number;
  irEmailsLast7d: number;
  /** Investor feeds only the Mac poller can read (bot-walled from the server), and how many it read in the last 48 hours */
  walledFeeds: number;
  walledFeedsFresh: number;
  /** A logic flush in progress: what is still to redo */
  logicFlush: { company: string; feeds: string; companiesPending: number; feedItemsPending: number; companyStartedAt: string | null; feedsStartedAt: string | null } | null;
};

/** A tick step counts as failing when it failed in most of the recent ticks */
const STEP_FAIL_WINDOW = 8;
const STEP_FAIL_THRESHOLD = 6;
/** The Mac poller runs every two hours while the Mac is awake; two days of silence is a problem */
const WALLED_FEED_SILENCE_HOURS = 48;
/** A flush should finish in a few hours (companies) or half a day (feed items) */
const COMPANY_FLUSH_MAX_HOURS = 12;
const FEED_FLUSH_MAX_HOURS = 36;

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
    contact_failed_24h: string;
    ir_emails_7d: string;
    walled: string;
    walled_fresh: string;
    ir_email_ever: string;
  }>(`
    select
      (select max(finished_at)::text from job_runs where job = 'tick' and status = 'ok') as last_ok_tick,
      (select count(*) from earnings_current where status = 'estimated' and event_date < $1::date
         and not estimate_is_stale(period_end, report_form)) as overdue,
      (select count(*) from companies where active) as active,
      (select count(*) from earnings_next) as with_upcoming,
      (select count(*) from filings where created_at > now() - interval '24 hours') as filings_24h,
      (select count(*) from feed_items where fetched_at > now() - interval '6 hours') as feed_items_6h,
      (select count(*) from earnings_events where status = 'confirmed' and source_type in ('wire-rss','edgar-fts','ir-site','ir-email') and created_at > now() - interval '7 days') as confirmed_7d,
      (select count(*) from contact_messages where status = 'failed' and created_at > now() - interval '24 hours') as contact_failed_24h,
      (select count(*) from feed_items where feed = 'ir-email' and fetched_at > now() - interval '7 days') as ir_emails_7d,
      (select count(*) from ir_sources where platform in ('q4','investis','rss') and (platform = 'q4' or last_status like '%(local)%' or consecutive_failures >= 1)) as walled,
      (select count(*) from ir_sources where platform in ('q4','investis','rss') and (platform = 'q4' or last_status like '%(local)%' or consecutive_failures >= 1)
          and last_status like 'ok%' and last_polled_at > now() - ($2 || ' hours')::interval) as walled_fresh,
      (select count(*) from earnings_events where source_type = 'ir-email') as ir_email_ever
  `, [today, WALLED_FEED_SILENCE_HOURS]);
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

  // A contact message that could not be emailed is waiting in the database.
  if (Number(row.contact_failed_24h) > 0) problems.push(`${row.contact_failed_24h} contact message(s) failed to send`);

  // A step that keeps failing: each tick finishes without it, so nothing else would say so.
  const recent = await query<{ errs: string[] | null }>(
    `select stats->'stepErrors' as errs from job_runs where job = 'tick' and status = 'ok' and stats ? 'stepErrors' order by id desc limit $1`,
    [STEP_FAIL_WINDOW]
  );
  if (recent.length >= STEP_FAIL_WINDOW) {
    const counts = new Map<string, number>();
    for (const r of recent) for (const step of new Set((r.errs ?? []).map((e) => e.split(":")[0]))) counts.set(step, (counts.get(step) ?? 0) + 1);
    for (const [step, n] of counts) if (n >= STEP_FAIL_THRESHOLD) problems.push(`tick step "${step}" failed in ${n} of the last ${STEP_FAIL_WINDOW} ticks`);
  }

  // Investor feeds the server cannot read are polled from the Mac. If most of
  // them have gone unread for two days, the Mac poller has stopped.
  const walled = Number(row.walled);
  const walledFresh = Number(row.walled_fresh);
  if (walled >= 50 && walledFresh < walled / 2) {
    problems.push(`Mac feed poller silent: ${walled - walledFresh} of ${walled} bot-walled investor feeds not read in ${WALLED_FEED_SILENCE_HOURS} hours`);
  }

  // Alert emails: once any have ever confirmed a date, a week of silence means the inbound path broke.
  if (Number(row.ir_email_ever) > 0 && Number(row.ir_emails_7d) === 0) problems.push("no investor alert emails received in 7 days");

  // A logic flush that is not finishing.
  let logicFlush: Health["logicFlush"] = null;
  const flushState = await getState<LogicFlushState>(LOGIC_FLUSH_KEY);
  if (flushState) {
    const f = await logicFlushStatus(flushState);
    logicFlush = {
      company: f.company.version,
      feeds: f.feeds.version,
      companiesPending: f.companiesPending,
      feedItemsPending: f.feedItemsPending,
      companyStartedAt: f.company.startedAt,
      feedsStartedAt: f.feeds.startedAt,
    };
    const hoursSince = (iso: string | null) => (iso ? (Date.now() - new Date(iso).getTime()) / 3600_000 : 0);
    if (f.companiesPending > 0 && hoursSince(f.company.startedAt) > COMPANY_FLUSH_MAX_HOURS) {
      problems.push(`logic flush stalled: ${f.companiesPending} companies not refreshed ${Math.round(hoursSince(f.company.startedAt))} hours after a logic change`);
    }
    if (f.feedItemsPending > 0 && hoursSince(f.feeds.startedAt) > FEED_FLUSH_MAX_HOURS) {
      problems.push(`feed reprocessing stalled: ${f.feedItemsPending} items still queued ${Math.round(hoursSince(f.feeds.startedAt))} hours after a parser change`);
    }
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
    contactFailedLast24h: Number(row.contact_failed_24h),
    irEmailsLast7d: Number(row.ir_emails_7d),
    walledFeeds: walled,
    walledFeedsFresh: walledFresh,
    logicFlush,
  };
}

/* ---------------------------------------------
   FEEDS-ONLY RUN (every 5 minutes)
----------------------------------------------*/

export type FeedRunStats = {
  feeds: FeedStats;
  irSites: { polled: number; staged: number; failed: number } | null;
  advisories: ProcessStats;
  reportWatch: { expected: { checked: number; queued: number }; live: { entries: number; results: number; queued: number }; refreshed: number; refreshFailed: number; resultsRecorded: number } | null;
  /** Steps that failed this run; the run itself still completed */
  stepErrors: string[];
  revalidated: number;
  elapsedMs: number;
};

export async function runFeeds(): Promise<FeedRunStats> {
  const started = Date.now();
  const startedISO = new Date(started).toISOString();
  const [run] = await query<{ id: number }>(`insert into job_runs (job) values ('feeds') returning id`);
  const errors = { stepErrors: [] as string[] };
  const NO_FEEDS: FeedStats = { feeds: 0, feedErrors: 0, newItems: 0 };
  const NO_ADVISORIES: ProcessStats = { processed: 0, matched: 0, confirmed: 0, ignored: 0, failed: 0, llmCalls: 0, llmMatched: 0, pageReads: 0 };
  try {
    // Each step stands alone, as in the tick.
    const feeds = (await runStep(errors, "wire feeds", () => pollFeeds())) ?? NO_FEEDS;
    const irSites: FeedRunStats["irSites"] = (await runStep(errors, "IR sites", () => pollIrSourcesBatch())) ?? null;
    // Bounded by time so the report watch below always gets its turn.
    const advisories = (await runStep(errors, "feed parsing", () => processFeedItems(FEED_ITEMS_PER_RUN, undefined, undefined, started + 50_000))) ?? NO_ADVISORIES;
    // Just-reported companies: re-read the SEC for expected reporters and the
    // live 8-K feed, refresh whoever is queued, then settle any results
    // headline whose 8-K is still missing. Bounded so the run stays short.
    let reportWatch: FeedRunStats["reportWatch"] = null;
    const touched = new Set<string>();
    await runStep(errors, "report watch", async () => {
      const expected = (await runStep(errors, "expected reporters", () => checkExpectedReporters(todayET(), { deadline: started + 45_000 }))) ?? { checked: 0, queued: 0 };
      const live = (await runStep(errors, "live 8-K feed", () => watchLiveFilings())) ?? { entries: 0, results: 0, queued: 0 };
      const refreshed = await refreshFlagged(25, started + 90_000);
      for (const t of refreshed.tickers) touched.add(t);
      const recorded = (await runStep(errors, "results headlines", () => settleResultsHeadlines())) ?? 0;
      reportWatch = { expected, live, refreshed: refreshed.refreshed, refreshFailed: refreshed.failed, resultsRecorded: recorded };
    });
    let revalidated = 0;
    for (const ticker of touched) {
      try {
        revalidatePath(`/earnings/${ticker.toLowerCase()}`);
        revalidated += 1;
      } catch {}
    }
    for (const ticker of (await runStep(errors, "confirmed tickers", () => recentlyConfirmedTickers(startedISO))) ?? []) {
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
    const stats: FeedRunStats = { feeds, irSites, advisories, reportWatch, stepErrors: errors.stepErrors, revalidated, elapsedMs: Date.now() - started };
    await query(`update job_runs set finished_at = now(), status = 'ok', stats = $2 where id = $1`, [run.id, JSON.stringify(stats)]);
    return stats;
  } catch (err) {
    await query(`update job_runs set finished_at = now(), status = 'error', error = $2 where id = $1`, [run.id, (err as Error).message]).catch(() => {});
    throw err;
  }
}
