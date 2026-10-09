/**
 * Catching the moment a company reports.
 *
 * The daily SEC form index (jobs.ts) only arrives in the evening, so on its
 * own a page would say "confirmed" for most of a day after the results were
 * out. Three faster signals feed the refresh queue instead:
 *
 *   1. Expected reporters: every company whose date is yesterday, today or
 *      tomorrow has its SEC filing list re-read directly (one small request
 *      each). A new earnings 8-K or periodic report queues a refresh.
 *   2. The SEC's live "latest filings" feed: every 8-K within a minute or
 *      two of acceptance, with its item codes, so an Item 2.02 (results)
 *      from any active company queues a refresh, expected or not.
 *   3. Results headlines on the wires, IR feeds and alert emails (handled in
 *      confirmJob.ts) queue a refresh too, and if the 8-K is not on file yet
 *      the release itself records the report (settleResultsHeadlines).
 *
 * refreshFlagged() then works the queue within a small time budget so the
 * five-minute feeds job can turn a filing into a "reported" page quickly.
 */

import { query } from "./db";
import { SEC_USER_AGENT, fetchEdgarJson, padCik } from "./edgar";
import { refreshCompany, todayET } from "./ingest";
import { addDaysISO } from "./format";

/* ---------------------------------------------
   1. EXPECTED REPORTERS
----------------------------------------------*/

type RecentFilings = { filings: { recent: { accessionNumber: string[]; form: string[]; filingDate: string[]; items: string[] } } };

const REPORT_FORMS = new Set(["10-Q", "10-K"]);
const isEarningsFiling = (form: string, items: string) => (form === "8-K" && /\b2\.02\b/.test(items)) || REPORT_FORMS.has(form);

/**
 * Re-read the SEC filing list of every company expected to report around
 * today; queue a refresh for any whose earnings filing has arrived but is
 * not on file yet. Returns the number queued.
 */
export async function checkExpectedReporters(today = todayET(), opts: { maxCompanies?: number; deadline?: number } = {}): Promise<{ checked: number; queued: number }> {
  const from = addDaysISO(today, -1);
  const to = addDaysISO(today, 1);
  const expected = await query<{ cik: number; event_date: string }>(
    `select e.cik, e.event_date::text
       from earnings_current e join companies c on c.cik = e.cik
      where c.active and c.refresh_requested_at is null
        and e.status in ('estimated', 'confirmed')
        and e.event_date between $1::date and $2::date
      order by e.event_date, e.cik
      limit $3`,
    [from, to, opts.maxCompanies ?? 400]
  );
  let queued = 0;
  let checked = 0;
  for (const row of expected) {
    if (opts.deadline && Date.now() > opts.deadline) break;
    checked += 1;
    let recent: RecentFilings["filings"]["recent"];
    try {
      recent = (await fetchEdgarJson<RecentFilings>(`https://data.sec.gov/submissions/CIK${padCik(row.cik)}.json`, {})).filings.recent;
    } catch (err) {
      console.error(`[report-watch] submissions for CIK ${row.cik}:`, (err as Error).message);
      continue;
    }
    const since = addDaysISO(row.event_date, -1);
    const candidates: string[] = [];
    for (let i = 0; i < recent.form.length && recent.filingDate[i] >= since; i++) {
      if (isEarningsFiling(recent.form[i], recent.items[i] ?? "")) candidates.push(recent.accessionNumber[i]);
    }
    if (!candidates.length) continue;
    const known = await query<{ accession: string }>(`select accession from filings where accession = any($1::text[])`, [candidates]);
    if (known.length === candidates.length) continue;
    await query(`update companies set refresh_requested_at = coalesce(refresh_requested_at, now()) where cik = $1`, [row.cik]);
    queued += 1;
  }
  return { checked, queued };
}

/* ---------------------------------------------
   2. THE SEC'S LIVE 8-K FEED
----------------------------------------------*/

const LIVE_FEED = "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&count=100&output=atom";
const SEEN_KEY = "live_8k_seen";
const SEEN_MAX = 600;

type LiveEntry = { cik: number; accession: string; items: string };

function parseLiveFeed(xml: string): LiveEntry[] {
  const out: LiveEntry[] = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const entry = m[1];
    const cik = entry.match(/\((\d{10})\)/)?.[1];
    const accession = entry.match(/accession-number=(\d{10}-\d{2}-\d{6})/)?.[1];
    if (!cik || !accession) continue;
    const items = [...entry.matchAll(/Item (\d+\.\d+)/g)].map((x) => x[1]).join(",");
    out.push({ cik: Number(cik), accession, items });
  }
  return out;
}

/**
 * Read the newest 8-Ks on EDGAR (two pages, 200 filings) and queue a refresh
 * for any active company whose results 8-K is new to us.
 */
export async function watchLiveFilings(): Promise<{ entries: number; results: number; queued: number }> {
  const seenRow = await query<{ value: string[] }>(`select value from pipeline_state where key = $1`, [SEEN_KEY]).catch(() => []);
  const seen = new Set<string>(seenRow[0]?.value ?? []);
  const entries: LiveEntry[] = [];
  for (const start of [0, 100]) {
    const res = await fetch(`${LIVE_FEED}&start=${start}`, { headers: { "User-Agent": SEC_USER_AGENT, Accept: "application/atom+xml" }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`live 8-K feed ${res.status}`);
    entries.push(...parseLiveFeed(await res.text()));
  }
  const results = entries.filter((e) => /\b2\.02\b/.test(e.items) && !seen.has(e.accession));
  let queued = 0;
  if (results.length) {
    const known = new Set((await query<{ accession: string }>(`select accession from filings where accession = any($1::text[])`, [results.map((r) => r.accession)])).map((r) => r.accession));
    const fresh = results.filter((r) => !known.has(r.accession));
    if (fresh.length) {
      const flagged = await query<{ cik: number }>(
        `update companies set refresh_requested_at = coalesce(refresh_requested_at, now())
          where active and cik = any($1::int[]) returning cik`,
        [[...new Set(fresh.map((r) => r.cik))]]
      );
      queued = flagged.length;
    }
  }
  const nextSeen = [...seen, ...results.map((r) => r.accession)].slice(-SEEN_MAX);
  await query(
    `insert into pipeline_state (key, value) values ($1, $2::jsonb)
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [SEEN_KEY, JSON.stringify(nextSeen)]
  ).catch((err) => console.error("[report-watch] state:", (err as Error).message));
  return { entries: entries.length, results: results.length, queued };
}

/* ---------------------------------------------
   3. RESULTS HEADLINES WITHOUT AN 8-K YET
----------------------------------------------*/

/**
 * A results headline (see confirmJob.ts) queued a refresh; if the company's
 * expected quarter is still not "reported" afterwards, the release itself
 * is the evidence: record the report from it, dated the day it went out.
 * Returns the number recorded.
 */
export async function settleResultsHeadlines(): Promise<number> {
  const rows = await query<{ id: number; cik: number; ticker: string; link: string | null; feed: string; reported_on: string; tod: string }>(
    `select f.id, (f.parsed->>'cik')::int as cik, c.ticker, f.link, f.feed,
            (f.parsed->>'resultsDate') as reported_on, coalesce(f.parsed->>'timeOfDay', 'unknown') as tod
       from feed_items f join companies c on c.cik = (f.parsed->>'cik')::int
      where f.parsed->>'resultsHeadline' = 'pending'
        and f.published_at > now() - interval '3 days'
      order by f.id limit 50`
  );
  let recorded = 0;
  for (const r of rows) {
    // Settled by the refresh (the 8-K was there)?
    const settled = await query<{ n: number }>(
      `select count(*)::int as n from earnings_current where cik = $1 and status = 'reported' and event_date between $2::date - 2 and $2::date + 1`,
      [r.cik, r.reported_on]
    );
    if (settled[0].n > 0) {
      await query(`update feed_items set parsed = parsed || '{"resultsHeadline":"settled by filing"}'::jsonb where id = $1`, [r.id]);
      continue;
    }
    // The quarter it must be: the nearest estimated/confirmed date within a week of the release
    const target = await query<{ fiscal_year: number; fiscal_quarter: number; period_end: string; report_form: string | null }>(
      `select fiscal_year, fiscal_quarter, period_end::text, report_form from earnings_current
        where cik = $1 and status in ('estimated', 'confirmed') and abs(event_date - $2::date) <= 7
        order by abs(event_date - $2::date) limit 1`,
      [r.cik, r.reported_on]
    );
    if (!target[0]) {
      await query(`update feed_items set parsed = parsed || '{"resultsHeadline":"no matching quarter"}'::jsonb where id = $1`, [r.id]);
      continue;
    }
    const t = target[0];
    const sourceType = r.feed === "ir-email" ? "ir-email" : r.feed.startsWith("ir-") ? "ir-site" : "wire-rss";
    await query(
      `select record_earnings_event($1,$2,$3::smallint,$4::smallint,$5::date,$6,$7::date,$8,'reported',$10,
                                    null,null,null,false,$9,null,null,null,false,null)`,
      [r.cik, r.ticker, t.fiscal_year, t.fiscal_quarter, t.period_end, t.report_form, r.reported_on, r.tod, r.link, sourceType]
    );
    await query(`update feed_items set parsed = parsed || '{"resultsHeadline":"recorded from release"}'::jsonb where id = $1`, [r.id]);
    recorded += 1;
  }
  return recorded;
}

/* ---------------------------------------------
   THE QUEUE, WITHIN A BUDGET
----------------------------------------------*/

/** Refresh queued companies until the limit or the deadline; returns the tickers touched. */
export async function refreshFlagged(limit: number, deadline: number, today = todayET()): Promise<{ refreshed: number; failed: number; tickers: string[] }> {
  const batch = await query<{ cik: number; ticker: string }>(
    `select cik, ticker from companies where refresh_requested_at is not null order by refresh_requested_at asc limit $1`,
    [limit]
  );
  const out = { refreshed: 0, failed: 0, tickers: [] as string[] };
  let cursor = 0;
  const worker = async () => {
    while (cursor < batch.length && Date.now() < deadline) {
      const { cik, ticker } = batch[cursor++];
      try {
        const r = await refreshCompany(cik, { today });
        out.refreshed += 1;
        out.tickers.push(r.ticker);
        if (r.ticker !== ticker) out.tickers.push(ticker);
      } catch (err) {
        out.failed += 1;
        console.error(`[report-watch] refresh ${ticker} failed:`, (err as Error).message);
        await query(`update companies set refresh_requested_at = null, last_refreshed_at = now() where cik = $1`, [cik]).catch(() => {});
      }
    }
  };
  await Promise.all(Array.from({ length: 3 }, worker));
  return out;
}
