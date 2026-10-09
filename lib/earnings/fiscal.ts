/**
 * Fiscal-calendar logic: turns a company's raw EDGAR filing history into
 * labeled earnings observations (fiscal quarter, period end, release date,
 * time of day), and predicts future period ends — including 52/53-week
 * fiscal calendars that drift year to year.
 */

import type { EdgarFiling, FilerCategory } from "./edgar";
import { addDays, stripTime, toISODate } from "@/lib/tradingDays";

export type TimeOfDay = "premarket" | "postmarket" | "during-market" | "unknown";

export type ReportForm = "10-Q" | "10-K";

export type EarningsObservation = {
  fiscalYear: number; // year in which the fiscal year ends
  quarter: 1 | 2 | 3 | 4;
  periodEnd: string; // YYYY-MM-DD
  releaseDate: string; // YYYY-MM-DD (8-K Item 2.02 event date)
  timeOfDay: TimeOfDay;
  reportForm: ReportForm; // the periodic report the release preceded
  reportFiledDate: string; // when that 10-Q/10-K was filed
  releaseAccession: string;
  acceptanceDateTime: string | null;
  /** No earnings 8-K: the results came out with the periodic report itself */
  viaPeriodicReport?: boolean;
};

/* ---------------------------------------------
   DATE HELPERS (ISO strings in, ISO strings out)
----------------------------------------------*/

export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function daysBetween(fromISO: string, toISO: string): number {
  return Math.round((parseISO(toISO).getTime() - parseISO(fromISO).getTime()) / 86_400_000);
}

export function addDaysISO(iso: string, days: number): string {
  return toISODate(addDays(parseISO(iso), days));
}

export function isMonthEnd(iso: string): boolean {
  const d = parseISO(iso);
  return addDays(d, 1).getMonth() !== d.getMonth();
}

/* ---------------------------------------------
   TIME OF DAY FROM 8-K ACCEPTANCE TIMESTAMP
----------------------------------------------*/

/**
 * EDGAR acceptance is a proxy for when the release went out: companies
 * furnish the 8-K within minutes to hours of the press release.
 *
 * Measured on real 8-K Item 2.02 filings: ~24% are accepted the same morning
 * before 9 a.m. (premarket releases), ~50% the same day after 4 p.m.
 * (postmarket), and ~8% the morning AFTER the event date — a post-close
 * release filed before the next open, so a lag of one day means postmarket
 * regardless of the clock. Two or more days of lag is too ambiguous to call.
 */
export function timeOfDayFromAcceptance(
  acceptanceISO: string | null,
  eventDateISO: string | null
): TimeOfDay {
  if (!acceptanceISO) return "unknown";
  const d = new Date(acceptanceISO);
  if (Number.isNaN(d.getTime())) return "unknown";
  const et = new Date(d.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const acceptedOn = toISODate(et);
  const lagDays = eventDateISO ? daysBetween(eventDateISO, acceptedOn) : 0;

  if (lagDays === 1) return "postmarket";
  // Filed the evening before the event date: a morning release furnished
  // ahead of time (PepsiCo's pattern).
  if (lagDays === -1) return "premarket";
  if (lagDays !== 0) return "unknown";

  const minutes = et.getHours() * 60 + et.getMinutes();
  if (minutes < 9 * 60 + 30) return "premarket";
  if (minutes >= 16 * 60) return "postmarket";
  return "during-market";
}

/* ---------------------------------------------
   FILING DEADLINES (calendar days after period end)
----------------------------------------------*/

export function filingDeadlineDays(form: ReportForm, category: FilerCategory): number {
  if (form === "10-Q") {
    return category === "large-accelerated" || category === "accelerated" ? 40 : 45;
  }
  if (category === "large-accelerated") return 60;
  if (category === "accelerated") return 75;
  return 90;
}

/* ---------------------------------------------
   BUILD OBSERVATIONS FROM FILINGS
----------------------------------------------*/

/** An 8-K 2.02 sooner than this after quarter end is not that quarter's release */
export const MIN_DAYS_AFTER_PERIOD_END = 5;

/** Form 8-K is due four business days after its event: a week at most, with a weekend and a holiday */
const MAX_EVENT_TO_FILING_DAYS = 7;

/** Items that say nothing of a second, earlier event: the release, its Regulation FD twin, and the exhibit list */
const RELEASE_ITEMS = new Set(["2.02", "7.01", "9.01"]);

/**
 * The day an 8-K's results came out. Normally that is its "date of report"
 * (the event date), and the filing follows within four business days. When
 * the filing trails the report date by more than that, the report date is
 * kept only if nothing explains it better than a late filing:
 *
 *   - dated as of the quarter it covers (Community Trust Bancorp files on
 *     July 15 with a report date of June 30);
 *   - dated by an earlier event reported in the same 8-K (Uber's August 6
 *     release carried a July 28 date for an Item 8.01 matter);
 *   - the wrong year typed (Wabtec's July 2019 release, dated July 2018).
 *
 * In those cases the release went out with the filing, so the filing date
 * stands in. `periodEnds` are the company's fiscal period ends.
 */
export function releaseDateOf(
  f: Pick<EdgarFiling, "reportDate" | "filingDate" | "items">,
  periodEnds?: ReadonlySet<string>
): string {
  if (!f.reportDate) return f.filingDate;
  const lag = daysBetween(f.reportDate, f.filingDate);
  if (lag < -1) return f.filingDate;
  if (lag <= MAX_EVENT_TO_FILING_DAYS) return f.reportDate;
  // "As of" dates are loose: a 52/53-week filer's May 30 quarter gets a May 31 report date
  const asOfPeriodEnd = periodEnds ? [...periodEnds].some((end) => Math.abs(daysBetween(end, f.reportDate!)) < MIN_DAYS_AFTER_PERIOD_END) : false;
  const otherEvent = f.items.some((i) => !RELEASE_ITEMS.has(i));
  const yearsOff = Math.round(lag / 365.25);
  const wrongYear = yearsOff >= 1 && Math.abs(lag - yearsOff * 365.25) <= 4;
  return asOfPeriodEnd || otherEvent || wrongYear ? f.filingDate : f.reportDate;
}

type PeriodReport = {
  form: ReportForm;
  periodEnd: string;
  filedDate: string;
  accession: string;
  acceptanceDateTime: string | null;
};

type Release = {
  date: string;
  accession: string;
  acceptanceDateTime: string | null;
  /** Furnished under Item 7.01/8.01 rather than 2.02 (see ObservationOptions.resultsAccessions) */
  otherItem: boolean;
};

// Transition reports (10-KT / 10-QT) cover a stub period after a fiscal
// year-end change; treat them like their regular counterparts.
const PERIOD_FORMS: Record<string, ReportForm> = {
  "10-Q": "10-Q",
  "10-K": "10-K",
  "10-QT": "10-Q",
  "10-KT": "10-K",
};

/**
 * The fiscal year end a period rolls up to, from the company's declared
 * year end (EDGAR's "MMDD"): the first occurrence on or after the period
 * end, allowing a week of slack so a 52/53-week year end that drifts a few
 * days past its nominal date still counts as that year's Q4.
 */
function projectedFiscalYearEnd(periodEnd: string, mmdd: string): string | null {
  if (!/^\d{4}$/.test(mmdd)) return null;
  const month = Number(mmdd.slice(0, 2));
  const day = Number(mmdd.slice(2, 4));
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const year = parseISO(periodEnd).getFullYear();
  for (const y of [year - 1, year, year + 1]) {
    const candidate = toISODate(new Date(y, month - 1, day));
    if (daysBetween(periodEnd, candidate) >= -7) return candidate;
  }
  return null;
}

/**
 * Assign a fiscal quarter to a period end given the fiscal-year-end date it
 * rolls up to. Uses day distance (not month arithmetic) so 52/53-week
 * calendars whose period ends straddle a month boundary still resolve.
 */
function quarterFor(periodEnd: string, fiscalYearEnd: string): 1 | 2 | 3 | 4 | null {
  const q = 4 - Math.round(daysBetween(periodEnd, fiscalYearEnd) / 91.3);
  return q >= 1 && q <= 4 ? (q as 1 | 2 | 3 | 4) : null;
}

export type FiscalPeriod = PeriodReport & {
  fiscalYear: number;
  quarter: 1 | 2 | 3 | 4;
};

/**
 * Every 10-Q/10-K period in the filing history, labeled with its fiscal year
 * and quarter, oldest first. Up to the latest 10-K, fiscal year ends are the
 * actual 10-K period ends. After it, the company's declared year end
 * (`fiscalYearEndMMDD`, from EDGAR) is used, so a change of fiscal year is
 * reflected as soon as the company declares it, not a year later.
 */
export function listFiscalPeriods(filings: EdgarFiling[], fiscalYearEndMMDD?: string | null): FiscalPeriod[] {
  // Deduped by period end (keep the earliest filing of each)
  const periodsByEnd = new Map<string, PeriodReport>();
  for (const f of filings) {
    const form = PERIOD_FORMS[f.form];
    if (!form || !f.reportDate) continue;
    const existing = periodsByEnd.get(f.reportDate);
    if (!existing || f.filingDate < existing.filedDate) {
      periodsByEnd.set(f.reportDate, {
        form,
        periodEnd: f.reportDate,
        filedDate: f.filingDate,
        accession: f.accession,
        acceptanceDateTime: f.acceptanceDateTime,
      });
    }
  }
  const periods = [...periodsByEnd.values()].sort((a, b) => (a.periodEnd < b.periodEnd ? -1 : 1));

  const fiscalYearEnds = periods.filter((p) => p.form === "10-K").map((p) => p.periodEnd);
  const lastFYE = fiscalYearEnds[fiscalYearEnds.length - 1];

  const out: FiscalPeriod[] = [];
  for (const period of periods) {
    let fye = fiscalYearEnds.find((e) => e >= period.periodEnd);
    if (!fye) {
      // Periods after the latest 10-K: use the declared year end, else roll
      // the last 10-K's year end forward until it covers this period.
      fye = fiscalYearEndMMDD ? projectedFiscalYearEnd(period.periodEnd, fiscalYearEndMMDD) ?? undefined : undefined;
      if (!fye) {
        if (!lastFYE) continue;
        const projected = parseISO(lastFYE);
        do projected.setFullYear(projected.getFullYear() + 1);
        while (daysBetween(period.periodEnd, toISODate(projected)) < -7);
        fye = toISODate(projected);
      }
    }
    const quarter = period.form === "10-K" ? 4 : quarterFor(period.periodEnd, fye);
    if (!quarter) continue;
    out.push({ ...period, fiscalYear: parseISO(fye).getFullYear(), quarter });
  }
  return out;
}

export type ObservationOptions = {
  /**
   * When a period has no earnings 8-K at all, take the periodic report's own
   * filing date as the release date. Some companies (Highwoods, Federal
   * Signal) publish results with the 10-Q/10-K itself, which exempts them
   * from Item 2.02; without this they would have no history to estimate from.
   */
  periodicFallback?: boolean;
  /**
   * 8-Ks without Item 2.02 that are known to carry a results release. Urban
   * Outfitters furnishes its quarterly release under Item 8.01 two weeks
   * ahead of the 10-Q; item codes alone cannot tell that from a dividend
   * notice, so the caller verifies the exhibit (resultsReleases.ts).
   */
  resultsAccessions?: ReadonlySet<string>;
};

export function buildObservations(
  filings: EdgarFiling[],
  fiscalYearEndMMDD?: string | null,
  opts: ObservationOptions = {}
): EarningsObservation[] {
  const periods = listFiscalPeriods(filings, fiscalYearEndMMDD);
  if (periods.length === 0) return [];

  // Earnings releases: 8-K Item 2.02, plus any 8-K verified to carry results.
  const periodEnds = new Set(periods.map((p) => p.periodEnd));
  const releases: Release[] = [];
  for (const f of filings) {
    if (f.form !== "8-K") continue;
    const item202 = f.items.includes("2.02");
    if (!item202 && !opts.resultsAccessions?.has(f.accession)) continue;
    releases.push({ date: releaseDateOf(f, periodEnds), accession: f.accession, acceptanceDateTime: f.acceptanceDateTime, otherItem: !item202 });
  }
  releases.sort((a, b) => (a.date < b.date ? -1 : 1));

  const observations: EarningsObservation[] = [];

  for (const period of periods) {
    // The release is the 8-K 2.02 closest to the periodic report's filing date,
    // searched from a few days after the period end (anything sooner is a
    // preliminary) to three days after the report. "Closest to the report"
    // skips preliminary 2.02s (e.g. early revenue updates) in favor of the
    // actual results release.
    const windowStart = addDaysISO(period.periodEnd, MIN_DAYS_AFTER_PERIOD_END);
    const windowEnd = addDaysISO(period.filedDate, 3);
    let best: Release | null = null;
    let bestDistance = Infinity;
    for (const r of releases) {
      if (r.date < windowStart) continue;
      if (r.date > windowEnd) break;
      // Results furnished under another item never trail the report itself
      if (r.otherItem && r.date > period.filedDate) continue;
      const distance = Math.abs(daysBetween(r.date, period.filedDate));
      if (distance < bestDistance || (distance === bestDistance && r.date <= period.filedDate)) {
        best = r;
        bestDistance = distance;
      }
    }
    if (!best) {
      if (!opts.periodicFallback) continue;
      observations.push({
        fiscalYear: period.fiscalYear,
        quarter: period.quarter,
        periodEnd: period.periodEnd,
        releaseDate: period.filedDate,
        timeOfDay: timeOfDayFromAcceptance(period.acceptanceDateTime, period.filedDate),
        reportForm: period.form,
        reportFiledDate: period.filedDate,
        releaseAccession: period.accession,
        acceptanceDateTime: period.acceptanceDateTime,
        viaPeriodicReport: true,
      });
      continue;
    }

    observations.push({
      fiscalYear: period.fiscalYear,
      quarter: period.quarter,
      periodEnd: period.periodEnd,
      releaseDate: best.date,
      timeOfDay: timeOfDayFromAcceptance(best.acceptanceDateTime, best.date),
      reportForm: period.form,
      reportFiledDate: period.filedDate,
      releaseAccession: best.accession,
      acceptanceDateTime: best.acceptanceDateTime,
    });
  }

  return observations;
}

/* ---------------------------------------------
   PREDICT THE NEXT PERIOD END
----------------------------------------------*/

/**
 * Given the same fiscal quarter's period end in the prior year, predict this
 * year's. Month-end calendars repeat the calendar date; 52/53-week calendars
 * advance 364 days, or 371 when that lands too early against the anniversary.
 */
export function predictPeriodEnd(priorYearPeriodEnd: string): string {
  if (isMonthEnd(priorYearPeriodEnd)) {
    const d = parseISO(priorYearPeriodEnd);
    // Last day of the same month next year
    return toISODate(new Date(d.getFullYear() + 1, d.getMonth() + 1, 0));
  }
  const anniversary = parseISO(priorYearPeriodEnd);
  anniversary.setFullYear(anniversary.getFullYear() + 1);
  const plus52 = addDays(parseISO(priorYearPeriodEnd), 364);
  const plus53 = addDays(parseISO(priorYearPeriodEnd), 371);
  const gap52 = Math.abs(plus52.getTime() - anniversary.getTime());
  const gap53 = Math.abs(plus53.getTime() - anniversary.getTime());
  return toISODate(stripTime(gap53 < gap52 ? plus53 : plus52));
}
