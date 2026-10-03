/**
 * Read models for the earnings pages. Server-only.
 */

import { query } from "./db";
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

export type UpcomingRow = EarningsEvent & { name: string };

/** Upcoming events across the universe within a date range, soonest first */
export async function getUpcomingEvents(fromISO: string, toISO: string, limit = 500): Promise<UpcomingRow[]> {
  return query<UpcomingRow>(
    `select ${eventColumns("e")}, c.name
       from earnings_next e
       join companies c on c.cik = e.cik
      where e.event_date between $1::date and $2::date and c.active
      order by e.event_date asc, c.name asc
      limit $3`,
    [fromISO, toISO, limit]
  );
}

/** Tickers eligible for the sitemap / static generation */
export async function getIndexedTickers(): Promise<{ ticker: string; lastRefreshedAt: string | null }[]> {
  return query(
    `select ticker, last_refreshed_at::text as "lastRefreshedAt"
       from companies where active and indexed order by ticker`
  );
}
