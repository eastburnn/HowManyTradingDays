"use client";

import { useState, useMemo } from "react";
import { domine } from "../fonts";
import CalendarPicker from "@/components/CalendarPicker";
import Breadcrumbs from "@/components/Breadcrumbs";

/* ---------------------------------------------
   DATE + HOLIDAY UTILITIES (shared logic)
----------------------------------------------*/

type HolidayType = "closed" | "half-day";

type Holiday = {
  date: Date;
  name: string;
  type: HolidayType;
  closeTime?: string;
};

function stripTime(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function toISODate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDisplayDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function addDays(d: Date, days: number): Date {
  const copy = new Date(d.getTime());
  copy.setDate(copy.getDate() + days);
  return copy;
}

function nthWeekdayOfMonth(
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

function lastWeekdayOfMonth(
  year: number,
  monthIndex: number,
  weekday: number
): Date {
  const last = new Date(year, monthIndex + 1, 0);
  const d = last.getDay();
  const offset = (d - weekday + 7) % 7;
  return new Date(year, monthIndex + 1, 0 - offset);
}

function easterSunday(year: number): Date {
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

function observedFixedHoliday(
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

function getEasternTime() {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York" })
  );
}

function isAfterMarketCloseET() {
  const nowET = getEasternTime();
  const close = new Date(nowET);
  close.setHours(16, 0, 0, 0);
  return nowET > close;
}

function getUsStockMarketHolidays(year: number): Holiday[] {
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

  // Half days
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

function countTradingDaysBetween(from: Date, to: Date) {
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
   QUICK-SELECT OPTIONS
----------------------------------------------*/

function getQuickSelectOptions(today: Date) {
  const year = today.getFullYear();
  const month = today.getMonth();

  const options: { label: string; isoDate: string }[] = [];

  // End of current month
  const endOfMonth = new Date(year, month + 1, 0);
  options.push({
    label: `End of ${endOfMonth.toLocaleDateString("en-US", { month: "long" })}`,
    isoDate: toISODate(endOfMonth),
  });

  // End of next month
  const endOfNextMonth = new Date(year, month + 2, 0);
  options.push({
    label: `End of ${endOfNextMonth.toLocaleDateString("en-US", { month: "long" })}`,
    isoDate: toISODate(endOfNextMonth),
  });

  // Upcoming full and half-day holidays in current year, sorted by date
  const holidays = getUsStockMarketHolidays(year);
  const upcomingHolidays = holidays
    .filter((h) => h.date >= today)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  for (const h of upcomingHolidays) {
    options.push({ label: h.name, isoDate: toISODate(h.date) });
  }

  return options;
}

/* ---------------------------------------------
   PAGE COMPONENT
----------------------------------------------*/

export default function CalculatorPage() {
  const today = useMemo(() => stripTime(new Date()), []);
  const todayISO = toISODate(today);

  const [selectedDate, setSelectedDate] = useState<string>("");

  const quickOptions = useMemo(() => getQuickSelectOptions(today), [today]);

  const result = useMemo(() => {
    if (!selectedDate) return null;
    const [y, m, d] = selectedDate.split("-").map(Number);
    const targetDate = new Date(y, m - 1, d);
    if (targetDate < today) return null;
    return countTradingDaysBetween(today, targetDate);
  }, [selectedDate, today]);

  return (
    <main className="flex-1 flex items-center justify-center px-4">
      <div className="max-w-xl w-full flex flex-col items-center gap-10 py-12">

        <Breadcrumbs crumbs={[{ label: "Home", href: "/" }, { label: "Calculator" }]} />

        {/* HEADER */}
        <header className="text-center space-y-2 -mt-4">
          <h1 className={`${domine.className} text-3xl sm:text-4xl font-semibold tracking-tight`}>
            Trading Days Calculator
          </h1>
          <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
            Select a target date to see how many U.S. stock market trading days and calendar days remain from today.
          </p>
        </header>

        {/* DATE PICKER */}
        <section className="w-full">
          <div className="w-full rounded-2xl border border-slate-800 bg-slate-900/70 shadow-xl p-6 sm:p-8 flex flex-col gap-5">
            <div className="flex flex-col gap-3">
              <label className="text-xs uppercase tracking-[0.2em] text-slate-400">
                Target Date
              </label>
              <CalendarPicker
                value={selectedDate}
                minDate={todayISO}
                onChange={setSelectedDate}
              />
            </div>

            {/* RESULTS — always visible; hyphens when no date selected */}
            <div className="flex flex-col gap-4 pt-2 border-t border-slate-800">
              <p className="text-xs text-slate-400 text-center">
                {result && selectedDate
                  ? <>From today through <span className="text-slate-200 font-medium">{formatDisplayDate(selectedDate)}</span></>
                  : <span className="text-slate-600">Select a date above to see the count</span>
                }
              </p>

              <div className="grid grid-cols-2 gap-3">
                {/* Trading Days */}
                <div className={`flex flex-col items-center rounded-xl border px-4 py-4 gap-1 transition-colors duration-200 ${result ? "border-blue-500/30 bg-blue-500/10" : "border-slate-800 bg-slate-800/20"}`}>
                  <span className={`text-4xl sm:text-5xl font-semibold tabular-nums transition-colors duration-200 ${result ? "text-blue-200" : "text-slate-700"}`}>
                    {result
                      ? (result.tradingDays % 1 === 0 ? result.tradingDays.toFixed(0) : result.tradingDays.toFixed(1))
                      : "–"}
                  </span>
                  <span className="text-xs text-slate-400 text-center">trading days</span>
                  <div className="flex gap-3 text-[10px] text-slate-500 mt-1 h-3">
                    {result && (
                      <>
                        <span>{result.fullDays} full</span>
                        {result.halfDays > 0 && <span>· {result.halfDays} half</span>}
                      </>
                    )}
                  </div>
                </div>

                {/* Calendar Days */}
                <div className={`flex flex-col items-center rounded-xl border px-4 py-4 gap-1 transition-colors duration-200 ${result ? "border-slate-700 bg-slate-800/40" : "border-slate-800 bg-slate-800/20"}`}>
                  <span className={`text-4xl sm:text-5xl font-semibold tabular-nums transition-colors duration-200 ${result ? "text-slate-200" : "text-slate-700"}`}>
                    {result ? result.calendarDays : "–"}
                  </span>
                  <span className="text-xs text-slate-400 text-center">calendar days</span>
                  <div className="flex gap-3 text-[10px] text-slate-500 mt-1 h-3">
                    {result && (
                      <>
                        <span>{Math.floor(result.calendarDays / 7)} weeks</span>
                        {result.calendarDays % 7 > 0 && <span>· {result.calendarDays % 7} days</span>}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* QUICK SELECT */}
        <section className="w-full">
          <h2 className="text-sm font-medium text-slate-200 mb-3">Quick select</h2>
          <div className="flex flex-wrap gap-2">
            {quickOptions.map((opt) => (
              <button
                key={opt.isoDate}
                onClick={() => setSelectedDate(opt.isoDate)}
                className={`
                  rounded-lg border px-3 py-1.5 text-xs font-medium transition-all duration-150
                  ${selectedDate === opt.isoDate
                    ? "border-blue-500/60 bg-blue-500/20 text-blue-200"
                    : "border-slate-700 bg-slate-800/40 text-slate-300 hover:border-slate-600 hover:bg-slate-700/40 hover:text-slate-100"
                  }
                `}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </section>

        {/* NOTE */}
        <p className="text-[10px] text-slate-500 text-center leading-relaxed -mt-4">
          Counts weekdays only · excludes full-day NYSE/Nasdaq holidays · early-close days count as 0.5 ·
          if today&apos;s market is already closed (after 4 pm ET), today is not included
        </p>

      </div>
    </main>
  );
}
