/**
 * The SEC's business calendar. EDGAR accepts filings and publishes its daily
 * index on federal business days, which are not the market's: the exchanges
 * trade on Columbus Day and Veterans Day while EDGAR is closed, and on Good
 * Friday it is the other way round. Health checks and the daily-index
 * ingest that ask "should the SEC have produced something today" must use
 * this calendar, or every Columbus Day raises a false alarm.
 */

import { lastWeekdayOfMonth, nthWeekdayOfMonth, observedFixedHoliday, stripTime, toISODate } from "@/lib/tradingDays";

export type SecHoliday = { date: Date; name: string };

export function getSecHolidays(year: number): SecHoliday[] {
  const out: SecHoliday[] = [];
  const fixed = (monthIndex: number, day: number, name: string) => {
    const d = observedFixedHoliday(year, monthIndex, day);
    if (d) out.push({ date: d, name });
  };
  fixed(0, 1, "New Year's Day");
  // Federal offices also close on December 31 when New Year's Day falls on a Saturday
  if (new Date(year + 1, 0, 1).getDay() === 6) out.push({ date: new Date(year, 11, 31), name: "New Year's Day (observed)" });
  out.push({ date: nthWeekdayOfMonth(year, 0, 1, 3), name: "Martin Luther King Jr. Day" });
  out.push({ date: nthWeekdayOfMonth(year, 1, 1, 3), name: "Washington's Birthday" });
  out.push({ date: lastWeekdayOfMonth(year, 4, 1), name: "Memorial Day" });
  if (year >= 2021) fixed(5, 19, "Juneteenth National Independence Day");
  fixed(6, 4, "Independence Day");
  out.push({ date: nthWeekdayOfMonth(year, 8, 1, 1), name: "Labor Day" });
  out.push({ date: nthWeekdayOfMonth(year, 9, 1, 2), name: "Columbus Day" });
  fixed(10, 11, "Veterans Day");
  out.push({ date: nthWeekdayOfMonth(year, 10, 4, 4), name: "Thanksgiving Day" });
  fixed(11, 25, "Christmas Day");
  return out;
}

/** True when EDGAR is open: a weekday that is not a federal holiday */
export function isSecBusinessDay(d: Date): boolean {
  const day = stripTime(d);
  const dow = day.getDay();
  if (dow === 0 || dow === 6) return false;
  const iso = toISODate(day);
  return !getSecHolidays(day.getFullYear()).some((h) => toISODate(h.date) === iso);
}
