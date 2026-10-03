/**
 * Read models for the earnings pages. Server-only.
 */

import { query } from "./db";
import type { RangeRow } from "./calendar";
import type { ConfidenceTier } from "./estimator";
import type { TimeOfDay } from "./fiscal";

export type EventStatus = "estimated" | "confirmed" | "reported";

export type EarningsEvent = {
  id: number;
  cik: number;
  ticker: string;
  fiscalYear: number;
  fiscalQuarter: 1 | 2 | 3 | 4;
  periodEnd: string;
  reportForm: "10-Q" | "10-K" | null;
  eventDate: string;
  timeOfDay: TimeOfDay;
  status: EventStatus;
  method: string | null;
  historyCount: number | null;
  sdDays: number | null;
  clampedToDeadline: boolean;
  confidence: ConfidenceTier | null;
  windowDays: number | null;
  overdue: boolean;
  originalEstimate: string | null;
  sourceType: string;
  sourceUrl: string | null;
  firstSeenAt: string;
  lastVerifiedAt: string;
};

export type Company = {
  cik: number;
  ticker: string;
  tickers: string[];
  name: string;
  exchange: string | null;
  filerCategory: string;
  fiscalYearEnd: string | null;
  is5253Week: boolean;
  sicDescription: string | null;
  active: boolean;
  indexed: boolean;
  lastRefreshedAt: string | null;
};

export type CompanyEarnings = {
  company: Company;
  /** Future estimated/confirmed events, soonest first */
  upcoming: EarningsEvent[];
  /** Most recent reported release */
  lastReported: EarningsEvent | null;
  /** Reported releases, newest first (up to 8) */
  history: EarningsEvent[];
};

/** Event column list; pass an alias when the query joins other tables. */
function eventColumns(alias = ""): string {
  const p = alias ? alias + "." : "";
  return `
  ${p}id, ${p}cik, ${p}ticker, ${p}fiscal_year as "fiscalYear", ${p}fiscal_quarter as "fiscalQuarter",
  ${p}period_end::text as "periodEnd", ${p}report_form as "reportForm", ${p}event_date::text as "eventDate",
  ${p}time_of_day as "timeOfDay", ${p}status, ${p}method, ${p}history_count as "historyCount",
  ${p}sd_days::float as "sdDays", ${p}clamped_to_deadline as "clampedToDeadline", ${p}confidence,
  ${p}window_days as "windowDays", ${p}overdue, ${p}original_estimate::text as "originalEstimate",
  ${p}source_type as "sourceType", ${p}source_url as "sourceUrl",
  ${p}first_seen_at::text as "firstSeenAt", ${p}last_verified_at::text as "lastVerifiedAt"
`;
}

const COMPANY_COLUMNS = `
  cik, ticker, tickers, name, exchange, filer_category as "filerCategory",
  fiscal_year_end as "fiscalYearEnd", is_52_53_week as "is5253Week",
  sic_description as "sicDescription", active, indexed,
  last_refreshed_at::text as "lastRefreshedAt"
`;

/** Resolve any listed symbol (including secondary share classes) to its company */
export async function getCompanyByTicker(ticker: string): Promise<Company | null> {
  const t = ticker.toUpperCase();
  const rows = await query<Company>(
    `select ${COMPANY_COLUMNS} from companies
      where upper(ticker) = $1 or $1 = any(tickers)
      order by (upper(ticker) = $1) desc
      limit 1`,
    [t]
  );
  return rows[0] ?? null;
}

export async function getCompanyEarnings(ticker: string): Promise<CompanyEarnings | null> {
  const company = await getCompanyByTicker(ticker);
  if (!company || !company.active) return null;

  const [upcoming, history] = await Promise.all([
    query<EarningsEvent>(
      `select ${eventColumns()} from earnings_current
        where cik = $1 and status in ('estimated','confirmed')
          and event_date >= (now() at time zone 'America/New_York')::date
          and not (status = 'estimated' and overdue and estimate_is_stale(period_end, report_form))
        order by event_date asc, id desc`,
      [company.cik]
    ),
    query<EarningsEvent>(
      `select ${eventColumns()} from earnings_current
        where cik = $1 and status = 'reported'
        order by event_date desc
        limit 8`,
      [company.cik]
    ),
  ]);

  return { company, upcoming, lastReported: history[0] ?? null, history };
}

/**
 * Every current event — estimated, confirmed or reported — dated within a
 * range, soonest first then by company name. Feeds the calendar page, its
 * "show more" extension and the month view.
 */
export async function getEventsInRange(fromISO: string, toISO: string, limit = 10000): Promise<RangeRow[]> {
  return query<RangeRow>(
    `select e.id, e.ticker, c.name, e.event_date::text as "eventDate", e.time_of_day as "timeOfDay",
            e.status, e.confidence, e.overdue, e.original_estimate::text as "originalEstimate",
            c.filer_category as "filerCategory"
       from earnings_current e
       join companies c on c.cik = e.cik
      where e.event_date between $1::date and $2::date and c.active
        -- an estimate in the past is a quarter that went unreported, not a date,
        -- and a stale overdue estimate is a delinquent filer's, not "any day now"
        and not (e.status = 'estimated' and e.event_date < (now() at time zone 'America/New_York')::date)
        and not (e.status = 'estimated' and e.overdue and estimate_is_stale(e.period_end, e.report_form))
      order by e.event_date asc, c.name asc
      limit $3`,
    [fromISO, toISO, limit]
  );
}

/** Earliest and latest event dates we hold, for the month view's bounds */
export async function getEventDateBounds(): Promise<{ min: string; max: string } | null> {
  const [row] = await query<{ min: string | null; max: string | null }>(
    `select min(event_date)::text as min, max(event_date)::text as max from earnings_current`
  );
  return row?.min && row.max ? { min: row.min, max: row.max } : null;
}

export type EstimateAccuracy = {
  /** Single-date estimates (high and medium confidence): how many landed within ±3 and ±7 days */
  estimated: { checked: number; within3: number; within7: number };
  /** Window estimates (low confidence): right when the actual date fell inside the window */
  window: { checked: number; inside: number };
};

/**
 * How past estimates fared once the real date arrived. For every quarter
 * where a confirmed or reported date replaced an estimate, the last estimate
 * that was on display is compared with the actual date.
 */
export async function getEstimateAccuracy(): Promise<EstimateAccuracy> {
  const rows = await query<{ tier: "estimated" | "window"; checked: number; within3: number; within7: number; inside: number }>(
    `with truth as (
       select cik, fiscal_year, fiscal_quarter, event_date, created_at
         from earnings_events
        where status in ('confirmed','reported') and superseded_by is null
     ),
     last_estimate as (
       select distinct on (e.cik, e.fiscal_year, e.fiscal_quarter)
              e.cik, e.fiscal_year, e.fiscal_quarter, e.event_date, e.confidence, e.window_days
         from earnings_events e
         join truth t on t.cik = e.cik and t.fiscal_year = e.fiscal_year and t.fiscal_quarter = e.fiscal_quarter
        where e.status = 'estimated' and e.created_at < t.created_at
        order by e.cik, e.fiscal_year, e.fiscal_quarter, e.created_at desc
     )
     select case when l.confidence = 'low' then 'window' else 'estimated' end as tier,
            count(*)::int as checked,
            sum((abs(t.event_date - l.event_date) <= 3)::int)::int as within3,
            sum((abs(t.event_date - l.event_date) <= 7)::int)::int as within7,
            sum((abs(t.event_date - l.event_date) <= coalesce(l.window_days, 3))::int)::int as inside
       from last_estimate l
       join truth t on t.cik = l.cik and t.fiscal_year = l.fiscal_year and t.fiscal_quarter = l.fiscal_quarter
      group by 1`
  );
  const out: EstimateAccuracy = { estimated: { checked: 0, within3: 0, within7: 0 }, window: { checked: 0, inside: 0 } };
  for (const r of rows) {
    if (r.tier === "window") out.window = { checked: r.checked, inside: r.inside };
    else out.estimated = { checked: r.checked, within3: r.within3, within7: r.within7 };
  }
  return out;
}

/** Tickers eligible for the sitemap / static generation */
export async function getIndexedTickers(): Promise<{ ticker: string; lastRefreshedAt: string | null }[]> {
  return query(
    `select ticker, last_refreshed_at::text as "lastRefreshedAt"
       from companies where active and indexed order by ticker`
  );
}

/* ---------------------------------------------
   TYPEAHEAD SEARCH
----------------------------------------------*/

export type SearchHit = {
  ticker: string;
  name: string;
  nextDate: string | null;
  status: "estimated" | "confirmed" | null;
  confidence: string | null;
  overdue: boolean | null;
};

/**
 * Match active companies by ticker prefix (primary or secondary symbols) or
 * by company-name substring. Exact ticker first, then ticker prefix, then
 * name-starts-with, then name-word-starts-with; large caps ahead of small.
 */
export async function searchCompanies(q: string, limit = 8): Promise<SearchHit[]> {
  const raw = q.trim();
  if (!raw) return [];
  const like = raw.replace(/[\\%_]/g, (c) => `\\${c}`);
  // Spelling-insensitive name key: 'jp morgan' should find 'JPMORGAN CHASE & CO'
  const compact = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  return query<SearchHit>(
    `select c.ticker, c.name, n.event_date::text as "nextDate", n.status, n.confidence, n.overdue
       from companies c
       left join earnings_next n on n.cik = c.cik
      where c.active and (
            upper(c.ticker) like upper($1) || '%'
         or exists (select 1 from unnest(c.tickers) t where t like upper($1) || '%')
         or ($3 and c.name ilike '%' || $1 || '%')
         or ($3 and regexp_replace(lower(c.name), '[^a-z0-9]', '', 'g') like '%' || $4 || '%')
      )
      order by (upper(c.ticker) = upper($1)) desc,
               (upper(c.ticker) like upper($1) || '%') desc,
               c.indexed desc,
               (c.name ilike $1 || '%') desc,
               (c.name ilike '% ' || $1 || '%') desc,
               (c.filer_category = 'large-accelerated') desc,
               (c.filer_category = 'accelerated') desc,
               length(c.name) asc
      limit $2`,
    [like, limit, raw.length >= 2, compact]
  );
}
