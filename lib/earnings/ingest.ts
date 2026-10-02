/**
 * Company ingestion: one routine, `refreshCompany`, used by the one-time
 * backfill and by every scheduled tick.
 *
 * For a CIK it pulls the EDGAR filing history, upserts the company and the
 * earnings-relevant filings, records every past release as a `reported`
 * event, and records estimates for the next two unreported fiscal quarters —
 * all through record_earnings_event(), so re-running is idempotent and every
 * change leaves an auditable superseded row.
 */

import type { PoolClient } from "pg";
import {
  type EdgarClientOptions,
  type EdgarCompany,
  type EdgarFiling,
  fetchCompany,
  isQuarterlyReporter,
} from "./edgar";
import {
  type EarningsObservation,
  type FiscalPeriod,
  type ReportForm,
  addDaysISO,
  buildObservations,
  filingDeadlineDays,
  isMonthEnd,
  listFiscalPeriods,
  parseISO,
  predictPeriodEnd,
} from "./fiscal";
import { type ConfidenceTier, type Estimate, estimateReleaseDate } from "./estimator";
import { withTransaction } from "./db";
import { addDays, getDayInfo, toISODate } from "@/lib/tradingDays";

/** Filings worth keeping: results releases, periodic reports, and late notices */
const KEEP_FORMS = new Set(["10-Q", "10-K", "NT 10-Q", "NT 10-K"]);
const KEEP_8K_ITEMS = ["2.02"];

/** Reported events are stored for display; this many years back is plenty */
const REPORTED_HISTORY_YEARS = 4;

/** How many unreported quarters ahead to estimate */
const ESTIMATE_QUARTERS_AHEAD = 2;

export type RefreshOptions = EdgarClientOptions & {
  /** Primary listing symbol/exchange from the SEC exchange list, if known */
  listing?: { ticker: string; exchange: string | null };
  /** "Today" in ET as YYYY-MM-DD; defaults to now */
  today?: string;
};

export type RefreshResult = {
  cik: number;
  ticker: string;
  active: boolean;
  filings: number;
  reported: number;
  estimated: number;
};

/* ---------------------------------------------
   HELPERS
----------------------------------------------*/

export function todayET(): string {
  const et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  return toISODate(et);
}

function filingUrl(cik: number, accession: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replace(/-/g, "")}/`;
}

function isRelevantFiling(f: EdgarFiling): boolean {
  if (KEEP_FORMS.has(f.form)) return true;
  return f.form === "8-K" && f.items.some((i) => KEEP_8K_ITEMS.includes(i));
}

function nextTradingDayOnOrAfter(iso: string): string {
  let d = parseISO(iso);
  while (!getDayInfo(d).isTradingDay) d = addDays(d, 1);
  return toISODate(d);
}

function lastTradingDayOnOrBefore(iso: string): string {
  let d = parseISO(iso);
  while (!getDayInfo(d).isTradingDay) d = addDays(d, -1);
  return toISODate(d);
}

/** The (fiscalYear, quarter) that follows a given one */
function nextQuarter(fy: number, q: number): { fiscalYear: number; quarter: 1 | 2 | 3 | 4 } {
  return q === 4 ? { fiscalYear: fy + 1, quarter: 1 } : { fiscalYear: fy, quarter: (q + 1) as 1 | 2 | 3 | 4 };
}

/**
 * Period end for a target quarter: roll last year's same-quarter period end
 * forward (handles 52/53-week calendars); failing that, step a quarter past
 * the most recent known period end.
 */
function targetPeriodEnd(
  target: { fiscalYear: number; quarter: number },
  periods: FiscalPeriod[],
  lastKnown: FiscalPeriod
): string {
  const priorYear = periods.find(
    (p) => p.quarter === target.quarter && p.fiscalYear === target.fiscalYear - 1
  );
  if (priorYear) return predictPeriodEnd(priorYear.periodEnd);

  // Fallback: ~one quarter after the most recent period, keeping month-end alignment
  const quartersAhead =
    (target.fiscalYear - lastKnown.fiscalYear) * 4 + (target.quarter - lastKnown.quarter);
  const base = parseISO(lastKnown.periodEnd);
  if (isMonthEnd(lastKnown.periodEnd)) {
    return toISODate(new Date(base.getFullYear(), base.getMonth() + 3 * quartersAhead + 1, 0));
  }
  return toISODate(addDays(base, 91 * quartersAhead));
}

/* ---------------------------------------------
   DATABASE WRITES
----------------------------------------------*/

async function upsertCompany(
  client: PoolClient,
  company: EdgarCompany,
  active: boolean,
  listing: RefreshOptions["listing"],
  periods: FiscalPeriod[]
): Promise<string> {
  const ticker = (listing?.ticker ?? company.tickers[0] ?? String(company.cik)).toUpperCase();
  const exchange = listing?.exchange ?? company.exchanges[0] ?? null;
  const is5253 = periods.some((p) => p.form === "10-K" && !isMonthEnd(p.periodEnd));

  await client.query(
    `insert into companies
       (cik, ticker, tickers, name, exchange, sic, sic_description, filer_category,
        fiscal_year_end, is_52_53_week, active, refresh_requested_at, last_refreshed_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,null,now())
     on conflict (cik) do update set
       ticker = excluded.ticker,
       tickers = excluded.tickers,
       name = excluded.name,
       exchange = excluded.exchange,
       sic = excluded.sic,
       sic_description = excluded.sic_description,
       filer_category = excluded.filer_category,
       fiscal_year_end = excluded.fiscal_year_end,
       is_52_53_week = excluded.is_52_53_week,
       active = excluded.active,
       refresh_requested_at = null,
       last_refreshed_at = now()`,
    [
      company.cik,
      ticker,
      company.tickers.map((t) => t.toUpperCase()),
      company.name,
      exchange,
      company.sic,
      company.sicDescription,
      company.category,
      company.fiscalYearEnd,
      is5253,
      active,
    ]
  );
  return ticker;
}

async function upsertFilings(client: PoolClient, cik: number, filings: EdgarFiling[]): Promise<number> {
  const rows = filings.filter(isRelevantFiling);
  if (rows.length === 0) return 0;
  // Item lists travel as comma-joined strings: unnest() would flatten a
  // nested text[][] parameter into single elements.
  await client.query(
    `insert into filings (accession, cik, form, items, filing_date, report_date, acceptance_at)
     select t.accession, t.cik, t.form,
            case when t.items_csv = '' then '{}'::text[] else string_to_array(t.items_csv, ',') end,
            t.filing_date, t.report_date, t.acceptance_at
       from unnest($1::text[], $2::int[], $3::text[], $4::text[], $5::date[], $6::date[], $7::timestamptz[])
            as t(accession, cik, form, items_csv, filing_date, report_date, acceptance_at)
     on conflict (accession) do nothing`,
    [
      rows.map((f) => f.accession),
      rows.map(() => cik),
      rows.map((f) => f.form),
      rows.map((f) => f.items.join(",")),
      rows.map((f) => f.filingDate),
      rows.map((f) => f.reportDate),
      rows.map((f) => f.acceptanceDateTime),
    ]
  );
  return rows.length;
}

type EventRow = {
  cik: number;
  ticker: string;
  fiscalYear: number;
  quarter: number;
  periodEnd: string;
  reportForm: ReportForm;
  eventDate: string;
  timeOfDay: string;
  status: "estimated" | "confirmed" | "reported";
  sourceType: string;
  method?: string | null;
  historyCount?: number | null;
  sdDays?: number | null;
  clamped?: boolean;
  sourceUrl?: string | null;
  sourceAccession?: string | null;
  confidence?: ConfidenceTier | null;
  windowDays?: number | null;
};

async function recordEvent(client: PoolClient, e: EventRow): Promise<void> {
  await client.query(
    `select record_earnings_event($1,$2,$3::smallint,$4::smallint,$5::date,$6,$7::date,$8,$9,$10,$11,$12::smallint,$13,$14,$15,$16,$17,$18::smallint)`,
    [
      e.cik, e.ticker, e.fiscalYear, e.quarter, e.periodEnd, e.reportForm, e.eventDate, e.timeOfDay,
      e.status, e.sourceType, e.method ?? null, e.historyCount ?? null, e.sdDays ?? null,
      e.clamped ?? false, e.sourceUrl ?? null, e.sourceAccession ?? null,
      e.confidence ?? null, e.windowDays ?? null,
    ]
  );
}

/* ---------------------------------------------
   ESTIMATES FOR UPCOMING QUARTERS
----------------------------------------------*/

type UpcomingEstimate = {
  fiscalYear: number;
  quarter: 1 | 2 | 3 | 4;
  periodEnd: string;
  reportForm: ReportForm;
  estimate: Estimate;
  sourceType: "estimator" | "edgar-nt";
  sourceAccession: string | null;
};

export function estimateUpcoming(
  company: EdgarCompany,
  periods: FiscalPeriod[],
  observations: EarningsObservation[],
  today: string
): UpcomingEstimate[] {
  if (periods.length === 0) return [];
  const last = periods[periods.length - 1];
  const out: UpcomingEstimate[] = [];

  let target = nextQuarter(last.fiscalYear, last.quarter);
  for (let i = 0; i < ESTIMATE_QUARTERS_AHEAD; i++) {
    const reportForm: ReportForm = target.quarter === 4 ? "10-K" : "10-Q";
    const periodEnd = targetPeriodEnd(target, periods, last);

    // Same-quarter history first; for Q1–Q3 with none, pool the other
    // interim quarters at low confidence rather than show nothing.
    let history = observations.filter((o) => o.quarter === target.quarter);
    let pooled = false;
    if (history.length === 0 && target.quarter !== 4) {
      history = observations.filter((o) => o.quarter !== 4);
      pooled = true;
    }

    let estimate = estimateReleaseDate({ history, periodEnd, reportForm, category: company.category });
    let sourceType: UpcomingEstimate["sourceType"] = "estimator";
    let sourceAccession: string | null = null;

    if (estimate) {
      if (pooled) estimate = { ...estimate, confidence: "low", windowDays: 14 };

      // A late-filing notice (NT 10-Q / NT 10-K) for this period means the
      // deadline moved out 5 or 15 days; the release follows the extension.
      const nt = company.filings.find(
        (f) => (f.form === "NT 10-Q" || f.form === "NT 10-K") && f.reportDate === periodEnd
      );
      if (nt) {
        const extended = addDaysISO(
          periodEnd,
          filingDeadlineDays(reportForm, company.category) + (reportForm === "10-K" ? 15 : 5)
        );
        const date = lastTradingDayOnOrBefore(extended);
        if (date > estimate.date) {
          estimate = { ...estimate, date, confidence: "medium", windowDays: 7, clampedToDeadline: true };
          sourceType = "edgar-nt";
          sourceAccession = nt.accession;
        }
      }

      // An estimate already in the past is overdue: roll it to the next
      // trading day and flag it low so the page never shows a negative count.
      if (estimate.date < today) {
        estimate = {
          ...estimate,
          date: nextTradingDayOnOrAfter(today),
          confidence: "low" as ConfidenceTier,
          windowDays: 14,
        };
      }

      out.push({ ...target, periodEnd, reportForm, estimate, sourceType, sourceAccession });
    }

    target = nextQuarter(target.fiscalYear, target.quarter);
  }
  return out;
}

/* ---------------------------------------------
   REFRESH ONE COMPANY
----------------------------------------------*/

export async function refreshCompany(cik: number, opts: RefreshOptions = {}): Promise<RefreshResult> {
  const today = opts.today ?? todayET();
  const company = await fetchCompany(cik, { cacheDir: opts.cacheDir, refresh: opts.refresh, sinceDate: "2015-01-01" });
  const active = isQuarterlyReporter(company);
  const periods = active ? listFiscalPeriods(company.filings) : [];
  const observations = active ? buildObservations(company.filings) : [];
  const upcoming = active ? estimateUpcoming(company, periods, observations, today) : [];

  const cutoffYear = parseISO(today).getFullYear() - REPORTED_HISTORY_YEARS;
  const reportedRows = observations.filter((o) => o.fiscalYear >= cutoffYear);

  return withTransaction(async (client) => {
    const ticker = await upsertCompany(client, company, active, opts.listing, periods);
    if (!active) {
      return { cik: company.cik, ticker, active, filings: 0, reported: 0, estimated: 0 };
    }

    const filings = await upsertFilings(client, company.cik, company.filings);

    for (const o of reportedRows) {
      await recordEvent(client, {
        cik: company.cik,
        ticker,
        fiscalYear: o.fiscalYear,
        quarter: o.quarter,
        periodEnd: o.periodEnd,
        reportForm: o.reportForm,
        eventDate: o.releaseDate,
        timeOfDay: o.timeOfDay,
        status: "reported",
        sourceType: "edgar-8k",
        sourceUrl: filingUrl(company.cik, o.releaseAccession),
        sourceAccession: o.releaseAccession,
      });
    }

    for (const u of upcoming) {
      await recordEvent(client, {
        cik: company.cik,
        ticker,
        fiscalYear: u.fiscalYear,
        quarter: u.quarter,
        periodEnd: u.periodEnd,
        reportForm: u.reportForm,
        eventDate: u.estimate.date,
        timeOfDay: u.estimate.timeOfDay,
        status: "estimated",
        sourceType: u.sourceType,
        method: u.estimate.method,
        historyCount: u.estimate.observations,
        sdDays: u.estimate.sdDays,
        clamped: u.estimate.clampedToDeadline,
        sourceUrl: u.sourceAccession ? filingUrl(company.cik, u.sourceAccession) : null,
        sourceAccession: u.sourceAccession,
        confidence: u.estimate.confidence,
        windowDays: u.estimate.windowDays,
      });
    }

    return {
      cik: company.cik,
      ticker,
      active,
      filings,
      reported: reportedRows.length,
      estimated: upcoming.length,
    };
  });
}
