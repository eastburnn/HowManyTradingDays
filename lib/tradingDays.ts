/* ---------------------------------------------
   SHARED DATE + HOLIDAY UTILITIES
   Single source of truth for U.S. stock market
   trading-day logic (NYSE/Nasdaq).
----------------------------------------------*/

export type HolidayType = "closed" | "half-day";

export type Holiday = {
  date: Date;
  name: string;
  type: HolidayType;
  closeTime?: string;
};

export function stripTime(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function toISODate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(d: Date, days: number): Date {
  const copy = new Date(d.getTime());
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function nthWeekdayOfMonth(
  year: number,
  monthIndex: number,
  weekday: number,
  nth: number
): Date {
  const firstOfMonth = new Date(year, monthIndex, 1);
  const firstWeekday = firstOfMonth.getDay();
  const offset = (weekday - firstWeekday + 7) % 7;
  const day = 1 + offset + 7 * (nth - 1);
  return new Date(year, monthIndex, day);
}

export function lastWeekdayOfMonth(
  year: number,
  monthIndex: number,
  weekday: number
): Date {
  const last = new Date(year, monthIndex + 1, 0);
  const d = last.getDay();
  const offset = (d - weekday + 7) % 7;
  return new Date(year, monthIndex + 1, 0 - offset);
}

export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

export function observedFixedHoliday(
  year: number,
  monthIndex: number,
  day: number
): Date | null {
  const d = new Date(year, monthIndex, day);
  const dow = d.getDay();
  if (dow === 6) d.setDate(day - 1);
  else if (dow === 0) d.setDate(day + 1);
  if (d.getFullYear() !== year) return null;
  return d;
}

export function getEasternTime() {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York" })
  );
}

export function isAfterMarketCloseET() {
  const nowET = getEasternTime();
  const close = new Date(nowET);
  close.setHours(16, 0, 0, 0); // 4:00 PM ET
  return nowET > close;
}

/* ---------------------------------------------
   HOLIDAYS FOR A GIVEN YEAR
----------------------------------------------*/

export function getUsStockMarketHolidays(year: number): Holiday[] {
  const holidays: Holiday[] = [];

  const newYears = observedFixedHoliday(year, 0, 1);
  if (newYears) holidays.push({ date: newYears, name: "New Year's Day", type: "closed" });

  // NYSE/Nasdaq have observed MLK Day only since 1998
  if (year >= 1998)
    holidays.push({ date: nthWeekdayOfMonth(year, 0, 1, 3), name: "Martin Luther King Jr. Day", type: "closed" });
  holidays.push({ date: nthWeekdayOfMonth(year, 1, 1, 3), name: "Presidents' Day", type: "closed" });

  const easter = easterSunday(year);
  holidays.push({ date: addDays(easter, -2), name: "Good Friday", type: "closed" });

  holidays.push({ date: lastWeekdayOfMonth(year, 4, 1), name: "Memorial Day", type: "closed" });

  // Juneteenth has been a market holiday only since 2022
  const juneteenth = year >= 2022 ? observedFixedHoliday(year, 5, 19) : null;
  if (juneteenth) holidays.push({ date: juneteenth, name: "Juneteenth National Independence Day", type: "closed" });

  const independence = observedFixedHoliday(year, 6, 4);
  if (independence) holidays.push({ date: independence, name: "Independence Day", type: "closed" });

  holidays.push({ date: nthWeekdayOfMonth(year, 8, 1, 1), name: "Labor Day", type: "closed" });

  const thanksgiving = nthWeekdayOfMonth(year, 10, 4, 4);
  holidays.push({ date: thanksgiving, name: "Thanksgiving Day", type: "closed" });

  const christmas = observedFixedHoliday(year, 11, 25);
  if (christmas) holidays.push({ date: christmas, name: "Christmas Day", type: "closed" });

  /* --- Half days --- */

  const july3 = new Date(year, 6, 3);
  if (![0, 6].includes(july3.getDay())) {
    const iso = toISODate(july3);
    if (!holidays.some((h) => toISODate(h.date) === iso))
      holidays.push({ date: july3, name: "Day Before Independence Day (early close)", type: "half-day", closeTime: "13:00" });
  }

  const dayAfterThanksgiving = addDays(thanksgiving, 1);
  if (dayAfterThanksgiving.getDay() === 5)
    holidays.push({ date: dayAfterThanksgiving, name: "Day After Thanksgiving (early close)", type: "half-day", closeTime: "13:00" });

  const christmasEve = new Date(year, 11, 24);
  if (![0, 6].includes(christmasEve.getDay())) {
    const iso = toISODate(christmasEve);
    if (!holidays.some((h) => toISODate(h.date) === iso))
      holidays.push({ date: christmasEve, name: "Christmas Eve (early close)", type: "half-day", closeTime: "13:00" });
  }

  return holidays;
}

/* ---------------------------------------------
   UNSCHEDULED MARKET CLOSURES (1990-present)
   Full-day closures that were not on the
   scheduled holiday calendar.
----------------------------------------------*/

export type UnscheduledClosure = { dateISO: string; reason: string };

export const UNSCHEDULED_CLOSURES: UnscheduledClosure[] = [
  { dateISO: "1994-04-27", reason: "Day of mourning for President Richard Nixon" },
  { dateISO: "2001-09-11", reason: "September 11 attacks" },
  { dateISO: "2001-09-12", reason: "September 11 attacks" },
  { dateISO: "2001-09-13", reason: "September 11 attacks" },
  { dateISO: "2001-09-14", reason: "September 11 attacks" },
  { dateISO: "2004-06-11", reason: "Day of mourning for President Ronald Reagan" },
  { dateISO: "2007-01-02", reason: "Day of mourning for President Gerald Ford" },
  { dateISO: "2012-10-29", reason: "Hurricane Sandy" },
  { dateISO: "2012-10-30", reason: "Hurricane Sandy" },
  { dateISO: "2018-12-05", reason: "Day of mourning for President George H. W. Bush" },
  { dateISO: "2025-01-09", reason: "Day of mourning for President Jimmy Carter" },
];

const CLOSURE_MAP = new Map(UNSCHEDULED_CLOSURES.map((c) => [c.dateISO, c.reason]));

export function getUnscheduledClosureReason(iso: string): string | null {
  return CLOSURE_MAP.get(iso) ?? null;
}

export function getUnscheduledClosuresForYear(year: number): UnscheduledClosure[] {
  return UNSCHEDULED_CLOSURES.filter((c) => c.dateISO.startsWith(String(year) + "-"));
}

/* ---------------------------------------------
   COUNT TRADING DAYS BETWEEN TWO DATES
----------------------------------------------*/

export function countTradingDaysBetween(from: Date, to: Date) {
  const start = stripTime(from);
  const end = stripTime(to);

  if (end < start) return { tradingDays: 0, calendarDays: 0, fullDays: 0, halfDays: 0 };

  const calendarDays = Math.round((end.getTime() - start.getTime()) / 86400000);

  // Build holiday maps for years involved
  const startYear = start.getFullYear();
  const endYear = end.getFullYear();
  const holidayMap = new Map<string, { type: HolidayType }>();

  for (let y = startYear; y <= endYear; y++) {
    for (const h of getUsStockMarketHolidays(y)) {
      holidayMap.set(toISODate(h.date), { type: h.type });
    }
  }

  const afterClose = isAfterMarketCloseET();
  const realToday = stripTime(new Date());
  let fullDays = 0;
  let halfDays = 0;

  let cursor = new Date(start.getTime());
  while (cursor <= end) {
    const iso = toISODate(cursor);
    const dow = cursor.getDay();
    const hInfo = holidayMap.get(iso);

    if (dow !== 0 && dow !== 6) {
      // Skip today only when it's genuinely the current date and the
      // market has already closed — a past start date always counts.
      const isToday =
        cursor.getFullYear() === realToday.getFullYear() &&
        cursor.getMonth() === realToday.getMonth() &&
        cursor.getDate() === realToday.getDate();

      if (isToday && afterClose) {
        // skip
      } else if (!CLOSURE_MAP.has(iso)) {
        if (!hInfo) fullDays += 1;
        else if (hInfo.type === "half-day") halfDays += 1;
      }
    }

    cursor = addDays(cursor, 1);
  }

  return {
    tradingDays: fullDays + halfDays * 0.5,
    calendarDays,
    fullDays,
    halfDays,
  };
}

/* ---------------------------------------------
   FULL-YEAR / PER-MONTH TOTALS
   "Sessions" = every day the market is open,
   counting early-close days as full sessions
   (the standard "~252 trading days" convention).
----------------------------------------------*/

export type YearStats = {
  year: number;
  weekdays: number;
  closedHolidays: number;
  unscheduledClosures: number; // e.g. 9/11, Hurricane Sandy, days of mourning
  halfDaySessions: number;
  sessions: number; // weekdays - closedHolidays - unscheduledClosures
  halfDayAdjusted: number; // sessions - halfDaySessions * 0.5
};

export function getYearStats(year: number): YearStats {
  const holidayMap = new Map<string, HolidayType>();
  for (const h of getUsStockMarketHolidays(year)) {
    holidayMap.set(toISODate(h.date), h.type);
  }

  let weekdays = 0;
  let closedHolidays = 0;
  let unscheduledClosures = 0;
  let halfDaySessions = 0;

  let cursor = new Date(year, 0, 1);
  const end = new Date(year, 11, 31);
  while (cursor <= end) {
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) {
      weekdays += 1;
      const iso = toISODate(cursor);
      const type = holidayMap.get(iso);
      if (type === "closed") closedHolidays += 1;
      else if (CLOSURE_MAP.has(iso)) unscheduledClosures += 1;
      else if (type === "half-day") halfDaySessions += 1;
    }
    cursor = addDays(cursor, 1);
  }

  const sessions = weekdays - closedHolidays - unscheduledClosures;
  return {
    year,
    weekdays,
    closedHolidays,
    unscheduledClosures,
    halfDaySessions,
    sessions,
    halfDayAdjusted: sessions - halfDaySessions * 0.5,
  };
}

export type MonthStats = {
  monthIndex: number; // 0-11
  monthName: string;
  sessions: number;
  closedHolidays: number;
  halfDaySessions: number;
  holidayNames: string[];
};

export function getMonthlyStats(year: number): MonthStats[] {
  const holidayMap = new Map<string, { type: HolidayType; name: string }>();
  for (const h of getUsStockMarketHolidays(year)) {
    holidayMap.set(toISODate(h.date), { type: h.type, name: h.name });
  }

  const months: MonthStats[] = [];

  for (let m = 0; m < 12; m++) {
    let sessions = 0;
    let closedHolidays = 0;
    let halfDaySessions = 0;
    const holidayNames: string[] = [];

    let cursor = new Date(year, m, 1);
    const end = new Date(year, m + 1, 0);
    while (cursor <= end) {
      const dow = cursor.getDay();
      if (dow !== 0 && dow !== 6) {
        const iso = toISODate(cursor);
        const info = holidayMap.get(iso);
        const closureReason = getUnscheduledClosureReason(iso);
        if (info?.type === "closed") {
          closedHolidays += 1;
          holidayNames.push(info.name);
        } else if (closureReason) {
          closedHolidays += 1;
          holidayNames.push(closureReason);
        } else {
          sessions += 1;
          if (info?.type === "half-day") halfDaySessions += 1;
        }
      }
      cursor = addDays(cursor, 1);
    }

    months.push({
      monthIndex: m,
      monthName: new Date(year, m, 1).toLocaleDateString("en-US", { month: "long" }),
      sessions,
      closedHolidays,
      halfDaySessions,
      holidayNames,
    });
  }

  return months;
}

/* ---------------------------------------------
   LIVE MARKET STATUS
----------------------------------------------*/

export type MarketStatus = {
  isOpen: boolean;
  isTradingDay: boolean; // today (ET) is a session day
  isEarlyClose: boolean; // today's session closes at 1 p.m. ET
  reason: string; // "open" | "before-open" | "after-close" | "weekend" | holiday name
  closeTimeET: string; // "16:00" or "13:00" (today's close, if a trading day)
  nextOpenISO: string; // ISO date of the next session day (today if before open)
};

export function getMarketStatus(now: Date = new Date()): MarketStatus {
  const nowET = new Date(
    now.toLocaleString("en-US", { timeZone: "America/New_York" })
  );
  const todayET = stripTime(nowET);
  const iso = toISODate(todayET);
  const dow = todayET.getDay();

  const holidayMap = new Map<string, Holiday>();
  for (const h of getUsStockMarketHolidays(todayET.getFullYear())) {
    holidayMap.set(toISODate(h.date), h);
  }
  // Include next January in case we're at year end
  for (const h of getUsStockMarketHolidays(todayET.getFullYear() + 1)) {
    holidayMap.set(toISODate(h.date), h);
  }

  const todayHoliday = holidayMap.get(iso);
  const isWeekend = dow === 0 || dow === 6;
  const isClosedHoliday = todayHoliday?.type === "closed";
  const isTradingDay = !isWeekend && !isClosedHoliday;
  const isEarlyClose = isTradingDay && todayHoliday?.type === "half-day";
  const closeTimeET = isEarlyClose ? "13:00" : "16:00";

  const minutes = nowET.getHours() * 60 + nowET.getMinutes();
  const openMin = 9 * 60 + 30;
  const closeMin = isEarlyClose ? 13 * 60 : 16 * 60;

  const isOpen = isTradingDay && minutes >= openMin && minutes < closeMin;

  let reason = "open";
  if (isWeekend) reason = "weekend";
  else if (isClosedHoliday) reason = todayHoliday!.name;
  else if (minutes < openMin) reason = "before-open";
  else if (minutes >= closeMin) reason = "after-close";

  // Next session day (today if the market hasn't opened yet)
  let cursor = new Date(todayET.getTime());
  if (!isTradingDay || minutes >= closeMin) cursor = addDays(cursor, 1);
  for (let i = 0; i < 15; i++) {
    const cDow = cursor.getDay();
    const cHol = holidayMap.get(toISODate(cursor));
    if (cDow !== 0 && cDow !== 6 && cHol?.type !== "closed") break;
    cursor = addDays(cursor, 1);
  }

  return {
    isOpen,
    isTradingDay,
    isEarlyClose,
    reason,
    closeTimeET,
    nextOpenISO: toISODate(cursor),
  };
}

/* ---------------------------------------------
   SINGLE-DATE STATUS + TRADING-DAY OFFSETS
----------------------------------------------*/

export type DayInfo = {
  dateISO: string;
  weekday: string;
  isTradingDay: boolean;
  isEarlyClose: boolean;
  holidayName: string | null; // set when the date is a market holiday or early close
};

export function getDayInfo(d: Date): DayInfo {
  const day = stripTime(d);
  const iso = toISODate(day);
  const dow = day.getDay();

  const holiday = getUsStockMarketHolidays(day.getFullYear()).find(
    (h) => toISODate(h.date) === iso
  );

  const isWeekend = dow === 0 || dow === 6;
  const isClosedHoliday = holiday?.type === "closed";
  const closureReason = !isWeekend && !isClosedHoliday ? getUnscheduledClosureReason(iso) : null;

  return {
    dateISO: iso,
    weekday: day.toLocaleDateString("en-US", { weekday: "long" }),
    isTradingDay: !isWeekend && !isClosedHoliday && !closureReason,
    isEarlyClose: !isWeekend && !closureReason && holiday?.type === "half-day",
    holidayName:
      closureReason ??
      (!isWeekend && holiday ? holiday.name.replace(" (early close)", "") : null),
  };
}

/**
 * Move n trading days from `start` (n > 0 forward, n < 0 backward).
 * Counts trading days strictly after/before the start date, so
 * addTradingDays(trade date, 1) gives a T+1 settlement date.
 */
export function addTradingDays(start: Date, n: number): Date {
  let cursor = stripTime(start);
  const step = n >= 0 ? 1 : -1;
  let remaining = Math.abs(n);

  // n === 0: the nearest trading day on or after start
  if (remaining === 0) {
    while (!getDayInfo(cursor).isTradingDay) cursor = addDays(cursor, 1);
    return cursor;
  }

  while (remaining > 0) {
    cursor = addDays(cursor, step);
    if (getDayInfo(cursor).isTradingDay) remaining -= 1;
  }
  return cursor;
}
