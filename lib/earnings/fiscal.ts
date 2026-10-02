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

type PeriodReport = {
  form: ReportForm;
  periodEnd: string;
  filedDate: string;
};

type Release = {
  date: string;
  accession: string;
  acceptanceDateTime: string | null;
};

const PERIOD_FORMS: Record<string, ReportForm> = { "10-Q": "10-Q", "10-K": "10-K" };

/**
 * Assign a fiscal quarter to a period end given the fiscal-year-end date it
 * rolls up to. Uses day distance (not month arithmetic) so 52/53-week
 * calendars whose period ends straddle a month boundary still resolve.
 */
function quarterFor(periodEnd: string, fiscalYearEnd: string): 1 | 2 | 3 | 4 | null {
  const q = 4 - Math.round(daysBetween(periodEnd, fiscalYearEnd) / 91.3);
  return q >= 1 && q <= 4 ? (q as 1 | 2 | 3 | 4) : null;
}

export type FiscalPeriod = {
  form: ReportForm;
  periodEnd: string;
  filedDate: string;
  fiscalYear: number;
  quarter: 1 | 2 | 3 | 4;
};

/**
 * Every 10-Q/10-K period in the filing history, labeled with its fiscal year
 * and quarter, oldest first. Fiscal year ends are the 10-K period ends; a
 * period belongs to the first fiscal year end on or after it.
 */
export function listFiscalPeriods(filings: EdgarFiling[]): FiscalPeriod[] {
  // Deduped by period end (keep the earliest filing of each)
  const periodsByEnd = new Map<string, PeriodReport>();
  for (const f of filings) {
    const form = PERIOD_FORMS[f.form];
    if (!form || !f.reportDate) continue;
    const existing = periodsByEnd.get(f.reportDate);
    if (!existing || f.filingDate < existing.filedDate) {
      periodsByEnd.set(f.reportDate, { form, periodEnd: f.reportDate, filedDate: f.filingDate });
    }
  }
  const periods = [...periodsByEnd.values()].sort((a, b) => (a.periodEnd < b.periodEnd ? -1 : 1));

  const fiscalYearEnds = periods.filter((p) => p.form === "10-K").map((p) => p.periodEnd);
  const lastFYE = fiscalYearEnds[fiscalYearEnds.length - 1];

  const out: FiscalPeriod[] = [];
  for (const period of periods) {
    let fye = fiscalYearEnds.find((e) => e >= period.periodEnd);
    if (!fye) {
      // Periods after the latest 10-K: project the FYE forward a year
      if (!lastFYE) continue;
      const projected = parseISO(lastFYE);
      projected.setFullYear(projected.getFullYear() + 1);
      fye = toISODate(projected);
    }
    const quarter = period.form === "10-K" ? 4 : quarterFor(period.periodEnd, fye);
    if (!quarter) continue;
    out.push({ ...period, fiscalYear: parseISO(fye).getFullYear(), quarter });
  }
  return out;
}

export function buildObservations(filings: EdgarFiling[]): EarningsObservation[] {
  const periods = listFiscalPeriods(filings);
  if (periods.length === 0) return [];

  // Earnings releases: 8-K Item 2.02. The 8-K's reportDate is the event date.
  const releases: Release[] = [];
  for (const f of filings) {
    if (f.form !== "8-K" || !f.items.includes("2.02")) continue;
    const date = f.reportDate ?? f.filingDate;
    releases.push({ date, accession: f.accession, acceptanceDateTime: f.acceptanceDateTime });
  }
  releases.sort((a, b) => (a.date < b.date ? -1 : 1));

  const observations: EarningsObservation[] = [];

  for (const period of periods) {
    // The release is the 8-K 2.02 closest to the periodic report's filing date,
    // searched from just after the period end to three days after the report.
    // "Closest to the report" skips preliminary 2.02s (e.g. early revenue
    // updates) in favor of the actual results release.
    const windowStart = period.periodEnd;
    const windowEnd = addDaysISO(period.filedDate, 3);
    let best: Release | null = null;
    let bestDistance = Infinity;
    for (const r of releases) {
      if (r.date <= windowStart) continue;
      if (r.date > windowEnd) break;
      const distance = Math.abs(daysBetween(r.date, period.filedDate));
      if (distance < bestDistance || (distance === bestDistance && r.date <= period.filedDate)) {
        best = r;
        bestDistance = distance;
      }
    }
    if (!best) continue;

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
