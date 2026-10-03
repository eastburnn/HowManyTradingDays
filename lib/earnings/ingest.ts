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
  timeOfDayFromAcceptance,
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

/** An 8-K 2.02 sooner than this after quarter end is not that quarter's release */
const MIN_DAYS_AFTER_PERIOD_END = 5;

/**
 * An estimate whose quarter ended this long ago without a filing is stale:
 * a month past the longest SEC deadline (45 days for a 10-Q, 90 for a 10-K).
 * The company is delinquent, not "expected any day"; the quarter stays
 * unestimated until its filing arrives and the calendar looks ahead instead.
 * Mirrors estimate_is_stale() in the database.
 */
const STALE_AFTER_DAYS: Record<ReportForm, number> = { "10-Q": 75, "10-K": 120 };

export function isStaleEstimate(periodEnd: string, reportForm: ReportForm, today: string): boolean {
  return today > addDaysISO(periodEnd, STALE_AFTER_DAYS[reportForm]);
}

/**
 * Quarterly filers that have no earnings releases to fall back to the 10-Q
 * date for: commodity and crypto trusts (SIC 6221) and blank-check companies
 * (6770). Their periodic reports are filings, not results announcements.
 */
const NO_RELEASE_SICS = new Set(["6221", "6770"]);

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
  lastKnown: FiscalPeriod,
  fiscalYearEndMMDD?: string | null
): string {
  // Month-end calendars come straight from the declared year end. That also
  // survives a change of fiscal year end, where prior-year labels belong to
  // the old calendar (USBC's "Q3" ended in June under its old September year
  // end and ends in September now; IGC's Dec 2024 and Sep 2025 periods are
  // both "FY2025 Q3").
  const declared = declaredQuarterEnd(target, fiscalYearEndMMDD);
  if (declared && usesMonthEndCalendar(periods)) return declared;

  // 52/53-week calendars: roll the latest matching prior-year period forward.
  const priorYear = [...periods]
    .reverse()
    .find((p) => p.quarter === target.quarter && p.fiscalYear === target.fiscalYear - 1);
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

/** Every 10-K so far ended on a month end (a 52/53-week filer's never does) */
function usesMonthEndCalendar(periods: FiscalPeriod[]): boolean {
  const tenKs = periods.filter((p) => p.form === "10-K");
  return tenKs.length > 0 && tenKs.every((p) => isMonthEnd(p.periodEnd));
}

/**
 * The quarter's end on a declared month-end fiscal calendar ("MMDD" from
 * EDGAR), or null when the declared value is not a month end ("0927": a
 * 52/53-week filer's nominal date) or malformed.
 */
function declaredQuarterEnd(target: { fiscalYear: number; quarter: number }, mmdd?: string | null): string | null {
  if (!mmdd || !/^\d{4}$/.test(mmdd)) return null;
  const month = Number(mmdd.slice(0, 2));
  const day = Number(mmdd.slice(2));
  if (month < 1 || month > 12) return null;
  if (day < new Date(2001, month, 0).getDate()) return null;
  const endMonthIndex = month - 1 - 3 * (4 - target.quarter);
  return toISODate(new Date(target.fiscalYear, endMonthIndex + 1, 0));
}

/* ---------------------------------------------
   LISTED SYMBOLS
----------------------------------------------*/

/**
 * Preferred shares ("CMS-PB", "ETI-P"), warrants ("EONR-WT", "LUCYW"), units
 * ("-U"), rights ("-R"). Share classes ("BRK-B", "MOG-A") are common stock.
 */
const DERIVATIVE_SUFFIX = /-(P[A-Z]?|W[ST]?|UN?|RT?)$/;

function isDerivativeSymbol(symbol: string, all: string[]): boolean {
  return DERIVATIVE_SUFFIX.test(symbol) || (/[WUR]$/.test(symbol) && all.some((o) => o !== symbol && symbol.startsWith(o)));
}

/**
 * The company's common-stock symbol: the first listed symbol that is not a
 * derivative security. Null for registrants with only preferred shares
 * listed (Consumers Energy) or no symbol at all (debt-only filers like
 * Qwest) — they file 10-Qs but have no earnings date of their own.
 */
function commonSymbol(company: EdgarCompany, listing: RefreshOptions["listing"]): string | null {
  const symbols = [...new Set([listing?.ticker, ...company.tickers].filter((t): t is string => Boolean(t)).map((t) => t.toUpperCase()))];
  return symbols.find((s) => !isDerivativeSymbol(s, symbols)) ?? null;
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
  const ticker = commonSymbol(company, listing) ?? (listing?.ticker ?? company.tickers[0] ?? String(company.cik)).toUpperCase();
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
  overdue?: boolean;
  originalEstimate?: string | null;
};

async function recordEvent(client: PoolClient, e: EventRow): Promise<void> {
  await client.query(
    `select record_earnings_event($1,$2,$3::smallint,$4::smallint,$5::date,$6,$7::date,$8,$9,$10,$11,$12::smallint,$13,$14,$15,$16,$17,$18::smallint,$19,$20::date)`,
    [
      e.cik, e.ticker, e.fiscalYear, e.quarter, e.periodEnd, e.reportForm, e.eventDate, e.timeOfDay,
      e.status, e.sourceType, e.method ?? null, e.historyCount ?? null, e.sdDays ?? null,
      e.clamped ?? false, e.sourceUrl ?? null, e.sourceAccession ?? null,
      e.confidence ?? null, e.windowDays ?? null, e.overdue ?? false, e.originalEstimate ?? null,
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

/**
 * An earnings release (8-K Item 2.02) filed after the latest periodic report
 * belongs to the quarter that hasn't had its 10-Q/10-K filed yet — the
 * normal state for every company in the days to weeks between its press
 * release and its periodic report. Without this, that quarter would look
 * unreported and its estimate would sit "overdue" at today.
 */
export type UnmatchedRelease = {
  fiscalYear: number;
  quarter: 1 | 2 | 3 | 4;
  periodEnd: string;
  reportForm: ReportForm;
  releaseDate: string;
  timeOfDay: EarningsObservation["timeOfDay"];
  accession: string;
};

export function findUnmatchedRelease(
  company: EdgarCompany,
  periods: FiscalPeriod[],
  observations: EarningsObservation[]
): UnmatchedRelease | null {
  if (periods.length === 0) return null;
  const last = periods[periods.length - 1];
  const lastRelease = observations.reduce((m, o) => (o.releaseDate > m ? o.releaseDate : m), "");
  const target = nextQuarter(last.fiscalYear, last.quarter);
  const periodEnd = targetPeriodEnd(target, periods, last, company.fiscalYearEnd);

  // Latest 2.02 strictly after the last periodic report was filed, after the
  // last matched release, and a plausible interval after the target quarter
  // ended. A 2.02 one to four days after quarter end is a preliminary (a
  // delivery report, a revenue pre-announcement): no company closes its books
  // that fast, and across 60,000 observed releases none was that early.
  const earliest = addDaysISO(periodEnd, MIN_DAYS_AFTER_PERIOD_END);
  let best: EdgarFiling | null = null;
  for (const f of company.filings) {
    if (f.form !== "8-K" || !f.items.includes("2.02")) continue;
    const date = f.reportDate ?? f.filingDate;
    if (date <= last.filedDate || date <= lastRelease || date < earliest) continue;
    if (!best || date > (best.reportDate ?? best.filingDate)) best = f;
  }
  if (!best) return null;

  const releaseDate = best.reportDate ?? best.filingDate;
  return {
    ...target,
    periodEnd,
    reportForm: target.quarter === 4 ? "10-K" : "10-Q",
    releaseDate,
    timeOfDay: timeOfDayFromAcceptance(best.acceptanceDateTime, releaseDate),
    accession: best.accession,
  };
}

export function estimateUpcoming(
  company: EdgarCompany,
  periods: FiscalPeriod[],
  observations: EarningsObservation[],
  today: string,
  unmatched: UnmatchedRelease | null = null
): UpcomingEstimate[] {
  if (periods.length === 0) return [];
  const last = periods[periods.length - 1];
  const out: UpcomingEstimate[] = [];

  // Start after the last reported quarter — which is the unmatched release's
  // quarter when one exists, otherwise the last periodic report's.
  let target = unmatched
    ? nextQuarter(unmatched.fiscalYear, unmatched.quarter)
    : nextQuarter(last.fiscalYear, last.quarter);
  // Two estimates, skipping stale quarters (a delinquent filer's unreported
  // Q2 must not crowd out its Q3), with a bound on how far to look.
  for (let i = 0; out.length < ESTIMATE_QUARTERS_AHEAD && i < ESTIMATE_QUARTERS_AHEAD + 3; i++) {
    const reportForm: ReportForm = target.quarter === 4 ? "10-K" : "10-Q";
    const periodEnd = targetPeriodEnd(target, periods, last, company.fiscalYearEnd);
    if (isStaleEstimate(periodEnd, reportForm, today)) {
      target = nextQuarter(target.fiscalYear, target.quarter);
      continue;
    }

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
      // trading day so it keeps surfacing, keep the original date, and flag
      // it so pages say "expected any day" rather than "reports today".
      if (estimate.date < today) {
        estimate = {
          ...estimate,
          originalDate: estimate.date,
          date: nextTradingDayOnOrAfter(today),
          confidence: "low" as ConfidenceTier,
          windowDays: 14,
          overdue: true,
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
  const active = isQuarterlyReporter(company) && commonSymbol(company, opts.listing) !== null;
  const periods = active ? listFiscalPeriods(company.filings, company.fiscalYearEnd) : [];
  const observations = active
    ? buildObservations(company.filings, company.fiscalYearEnd, {
        periodicFallback: !NO_RELEASE_SICS.has(company.sic ?? ""),
      })
    : [];
  const unmatched = active ? findUnmatchedRelease(company, periods, observations) : null;
  const upcoming = active ? estimateUpcoming(company, periods, observations, today, unmatched) : [];

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
        sourceType: o.viaPeriodicReport ? "edgar-periodic" : "edgar-8k",
        sourceUrl: filingUrl(company.cik, o.releaseAccession),
        sourceAccession: o.releaseAccession,
      });
    }

    if (unmatched) {
      await recordEvent(client, {
        cik: company.cik,
        ticker,
        fiscalYear: unmatched.fiscalYear,
        quarter: unmatched.quarter,
        periodEnd: unmatched.periodEnd,
        reportForm: unmatched.reportForm,
        eventDate: unmatched.releaseDate,
        timeOfDay: unmatched.timeOfDay,
        status: "reported",
        sourceType: "edgar-8k",
        sourceUrl: filingUrl(company.cik, unmatched.accession),
        sourceAccession: unmatched.accession,
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
        overdue: u.estimate.overdue ?? false,
        originalEstimate: u.estimate.originalDate ?? null,
      });
    }

    return {
      cik: company.cik,
      ticker,
      active,
      filings,
      reported: reportedRows.length + (unmatched ? 1 : 0),
      estimated: upcoming.length,
    };
  });
}
