"use client";

import { useRef } from "react";
import Script from "next/script";
import { domine } from "./fonts";
import ShareButton from "@/components/ShareButton";
import FAQ from "@/components/FAQ";
import FiscalAd from "@/components/FiscalAd";

/* ---------------------------------------------
   DATE + HOLIDAY UTILITIES
----------------------------------------------*/

type HolidayType = "closed" | "half-day";

type Holiday = {
  date: Date;
  name: string;
  type: HolidayType;
  closeTime?: string;
};

type DisplayHoliday = {
  isoDate: string;
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
    weekday: "short",
    month: "short",
    day: "numeric",
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
  close.setHours(16, 0, 0, 0); // 4:00 PM ET
  return nowET > close;
}

function isSameDay(d1: Date, d2: Date): boolean {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

/* ---------------------------------------------
   COMPUTE HOLIDAYS FOR A GIVEN YEAR
----------------------------------------------*/

function getUsStockMarketHolidays(year: number): Holiday[] {
  const holidays: Holiday[] = [];

  const newYears = observedFixedHoliday(year, 0, 1);
  if (newYears)
    holidays.push({
      date: newYears,
      name: "New Year's Day",
      type: "closed",
    });

  holidays.push({
    date: nthWeekdayOfMonth(year, 0, 1, 3),
    name: "Martin Luther King Jr. Day",
    type: "closed",
  });

  holidays.push({
    date: nthWeekdayOfMonth(year, 1, 1, 3),
    name: "Presidents' Day",
    type: "closed",
  });

  const easter = easterSunday(year);
  holidays.push({
    date: addDays(easter, -2),
    name: "Good Friday",
    type: "closed",
  });

  holidays.push({
    date: lastWeekdayOfMonth(year, 4, 1),
    name: "Memorial Day",
    type: "closed",
  });

  const juneteenth = observedFixedHoliday(year, 5, 19);
  if (juneteenth)
    holidays.push({
      date: juneteenth,
      name: "Juneteenth National Independence Day",
      type: "closed",
    });

  const independence = observedFixedHoliday(year, 6, 4);
  if (independence)
    holidays.push({
      date: independence,
      name: "Independence Day",
      type: "closed",
    });

  holidays.push({
    date: nthWeekdayOfMonth(year, 8, 1, 1),
    name: "Labor Day",
    type: "closed",
  });

  const thanksgiving = nthWeekdayOfMonth(year, 10, 4, 4);
  holidays.push({
    date: thanksgiving,
    name: "Thanksgiving Day",
    type: "closed",
  });

  const christmas = observedFixedHoliday(year, 11, 25);
  if (christmas)
    holidays.push({
      date: christmas,
      name: "Christmas Day",
      type: "closed",
    });

  /* --- Half Days --- */

  const july3 = new Date(year, 6, 3);
  if (![0, 6].includes(july3.getDay())) {
    const iso = toISODate(july3);
    if (!holidays.some((h) => toISODate(h.date) === iso))
      holidays.push({
        date: july3,
        name: "Day Before Independence Day (early close)",
        type: "half-day",
        closeTime: "13:00",
      });
  }

  const dayAfterThanksgiving = addDays(thanksgiving, 1);
  if (dayAfterThanksgiving.getDay() === 5)
    holidays.push({
      date: dayAfterThanksgiving,
      name: "Day After Thanksgiving (early close)",
      type: "half-day",
      closeTime: "13:00",
    });

  const christmasEve = new Date(year, 11, 24);
  if (![0, 6].includes(christmasEve.getDay())) {
    const iso = toISODate(christmasEve);
    if (!holidays.some((h) => toISODate(h.date) === iso))
      holidays.push({
        date: christmasEve,
        name: "Christmas Eve (early close)",
        type: "half-day",
        closeTime: "13:00",
      });
  }

  return holidays;
}

/* ---------------------------------------------
   CALCULATE TRADING DAYS & UPCOMING HOLIDAYS
----------------------------------------------*/

function calculateTradingDays(fromDate: Date) {
  const today = stripTime(fromDate);
  const year = today.getFullYear();
  const endOfYear = new Date(year, 11, 31);

  const allHolidays = getUsStockMarketHolidays(year);
  const afterClose = isAfterMarketCloseET();

  const holidayMap = new Map<
    string,
    { type: HolidayType; name: string; closeTime?: string }
  >();

  for (const h of allHolidays) {
    holidayMap.set(toISODate(h.date), {
      type: h.type,
      name: h.name,
      closeTime: h.closeTime,
    });
  }

  let fullDays = 0;
  let halfDays = 0;
  const upcoming: DisplayHoliday[] = [];

  let cursor = new Date(today.getTime());
  while (cursor <= endOfYear) {
    const iso = toISODate(cursor);
    const dow = cursor.getDay();
    const hInfo = holidayMap.get(iso);

    if (hInfo) {
      upcoming.push({
        isoDate: iso,
        name: hInfo.name,
        type: hInfo.type,
        closeTime: hInfo.closeTime,
      });
    }

    if (dow !== 0 && dow !== 6) {
      const isToday = isSameDay(cursor, today);

      // If today is a trading day but the market is already closed (after 4pm ET),
      // skip counting today in the "days remaining" total.
      if (isToday && afterClose) {
        // do not count today
      } else {
        if (!hInfo) fullDays += 1;
        else if (hInfo.type === "half-day") halfDays += 1;
      }
    }

    cursor = addDays(cursor, 1);
  }

  upcoming.sort((a, b) => (a.isoDate < b.isoDate ? -1 : 1));

  return {
    year,
    totalTradingDays: fullDays + halfDays * 0.5,
    fullDays,
    halfDays,
    upcoming,
  };
}

/* ---------------------------------------------
   PAGE COMPONENT
----------------------------------------------*/

export default function HomePage() {
  const now = new Date();
  const { year, totalTradingDays, fullDays, halfDays, upcoming } =
    calculateTradingDays(now);

  const cardRef = useRef<HTMLDivElement | null>(null);


  return (
    <main className="flex-1 flex items-center justify-center px-4">

      <div className="max-w-xl w-full flex flex-col items-center gap-10 py-12">
        {/* TITLE */}
        <header className="text-center space-y-2">
          <h1
            className={`${domine.className} text-3xl sm:text-4xl font-semibold tracking-tight`}
          >
            How Many Trading Days
          </h1>

          {/* Small, keyword-rich helper line for SEO + clarity */}
          <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
            Live countdown of how many U.S. stock market trading days are left in {year}.
            Includes weekdays if it’s before 4pm ET; excludes weekends,
            full holidays, and counts early-close days as 0.5.
          </p>
        </header>

        {/* MAIN CARD */}
        <section className="w-full">
          <div
            ref={cardRef}
            className="w-full rounded-2xl border border-slate-800 bg-slate-900/70 shadow-xl p-8 sm:p-8 flex flex-col items-center gap-3"
          >
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
              Trading Days Left in {year}
            </p>

            <div className="flex flex-col items-center">
              <span className="text-6xl sm:text-7xl font-semibold tabular-nums">
                {totalTradingDays.toFixed(1)}
              </span>
              <span className="text-xs text-slate-400"></span>
            </div>

            <div className="flex gap-4 text-xs text-slate-400 mt-1">
              <div className="flex flex-col items-center">
                <span className="text-sm font-semibold text-slate-100 tabular-nums">
                  {fullDays}
                </span>
                <span>full days</span>
              </div>
              <div className="h-8 w-px bg-slate-800" />
              <div className="flex flex-col items-center">
                <span className="text-sm font-semibold text-slate-100 tabular-nums">
                  {halfDays}
                </span>
                <span>half days</span>
              </div>
            </div>
          </div>
        </section>

        {/* SHARE BUTTON */}
        <div className="w-full flex justify-center -mt-8">
          <ShareButton cardRef={cardRef} />
        </div>

        {/* CALCULATOR CTA */}
        <a
          href="/calculator"
          className="
            group w-full flex items-center justify-between
            rounded-lg border border-slate-800 bg-slate-900/70
            px-4 py-3 -mt-4
            hover:border-slate-700 hover:bg-slate-900
            transition-all duration-150 active:scale-[0.99]
          "
        >
          <div className="flex items-center gap-3">
            <svg className="w-4 h-4 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
              <rect x="4" y="2" width="16" height="20" rx="2" />
              <line x1="8" y1="7" x2="16" y2="7" />
              <line x1="8" y1="11" x2="16" y2="11" />
              <line x1="8" y1="15" x2="12" y2="15" />
            </svg>
            <div className="flex flex-col">
              <span className="text-sm font-medium text-slate-100">Trading Days Calculator</span>
              <span className="text-xs text-slate-500">See how many trading days remain until a specific date</span>
            </div>
          </div>
          <svg className="w-4 h-4 text-slate-600 group-hover:text-slate-400 transition-colors flex-shrink-0 ml-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </a>

        {/* FISCAL.AI AD (directly below live counter, above upcoming holidays) */}
        <aside
          className="w-full -mt-2"
          aria-label="Sponsored content"
        >
          <FiscalAd href="https://fiscal.ai/pricing/?via=welcome" />
        </aside>

        {/* UPCOMING HOLIDAYS */}
        <section className="w-full">
          <h2 className="text-sm font-medium text-slate-200 mb-3">
            Upcoming market holidays &amp; half days
          </h2>

          {upcoming.length === 0 ? (
            <p className="text-xs text-slate-500">
              No remaining NYSE/Nasdaq holidays or half days for the rest of the
              year.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {upcoming.map((h) => (
                <li
                  key={h.isoDate + h.name}
                  className="flex items-start justify-between rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2"
                >
                  <div className="flex flex-col">
                    <span className="font-medium text-slate-100">{h.name}</span>
                    <span className="text-xs text-slate-400">
                      {formatDisplayDate(h.isoDate)}
                    </span>
                  </div>
                  <div className="text-right text-xs">
                    {h.type === "closed" ? (
                      <span className="inline-flex items-center rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-300">
                        Closed
                      </span>
                    ) : (
                      <div className="flex flex-col items-end gap-1">
                        <span className="inline-flex items-center rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200">
                          Half day
                        </span>
                        {h.closeTime && (
                          <span className="text-[10px] text-slate-400">
                            Closes early at {h.closeTime} ET
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-3 text-[10px] text-slate-500 leading-relaxed">
            Calendar is based on standard NYSE/Nasdaq U.S. stock market holidays
            and common 1 p.m. early closes. Weekends are handled automatically
            and not shown here.
          </p>
        </section>

        {/* QUICK ANSWERS */}
        <section className="w-full border-t border-slate-800 pt-8">
          <h2 className="text-base sm:text-lg font-semibold text-slate-100 mb-2">
            Quick Answers
          </h2>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3">
              <h3 className="text-sm font-semibold text-slate-100">
                How many trading days in a year?
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-300">
                Most years have about <span className="font-semibold text-slate-100">252</span> U.S. stock market trading days,
                depending on weekends and holidays.
              </p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3">
              <h3 className="text-sm font-semibold text-slate-100">
                What are the trading days in a year?
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-300">
              Trading days in a year are the weekdays when U.S. stock markets are open, excluding weekends and official market holidays.
              </p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3">
              <h3 className="text-sm font-semibold text-slate-100">
                How many trading days are left in the year?
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-300">
                The live counter at the top of this page shows the exact remaining total for the current year.
              </p>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <FAQ />

      </div>
    </main>
  );
}
