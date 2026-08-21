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

  holidays.push({ date: nthWeekdayOfMonth(year, 0, 1, 3), name: "Martin Luther King Jr. Day", type: "closed" });
  holidays.push({ date: nthWeekdayOfMonth(year, 1, 1, 3), name: "Presidents' Day", type: "closed" });

  const easter = easterSunday(year);
  holidays.push({ date: addDays(easter, -2), name: "Good Friday", type: "closed" });

  holidays.push({ date: lastWeekdayOfMonth(year, 4, 1), name: "Memorial Day", type: "closed" });

  const juneteenth = observedFixedHoliday(year, 5, 19);
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
  let fullDays = 0;
  let halfDays = 0;

  let cursor = new Date(start.getTime());
  while (cursor <= end) {
    const iso = toISODate(cursor);
    const dow = cursor.getDay();
    const hInfo = holidayMap.get(iso);

    if (dow !== 0 && dow !== 6) {
      const isToday =
        cursor.getFullYear() === start.getFullYear() &&
        cursor.getMonth() === start.getMonth() &&
        cursor.getDate() === start.getDate();

      if (isToday && afterClose) {
        // skip
      } else {
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
  halfDaySessions: number;
  sessions: number; // weekdays - closedHolidays
  halfDayAdjusted: number; // sessions - halfDaySessions * 0.5
};

export function getYearStats(year: number): YearStats {
  const holidayMap = new Map<string, HolidayType>();
  for (const h of getUsStockMarketHolidays(year)) {
    holidayMap.set(toISODate(h.date), h.type);
  }

  let weekdays = 0;
  let closedHolidays = 0;
  let halfDaySessions = 0;

  let cursor = new Date(year, 0, 1);
  const end = new Date(year, 11, 31);
  while (cursor <= end) {
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) {
      weekdays += 1;
      const type = holidayMap.get(toISODate(cursor));
      if (type === "closed") closedHolidays += 1;
      else if (type === "half-day") halfDaySessions += 1;
    }
    cursor = addDays(cursor, 1);
  }

  const sessions = weekdays - closedHolidays;
  return {
    year,
    weekdays,
    closedHolidays,
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
        const info = holidayMap.get(toISODate(cursor));
        if (info?.type === "closed") {
          closedHolidays += 1;
          holidayNames.push(info.name);
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
