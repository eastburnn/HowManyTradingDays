"use client";

import { useRef } from "react";
import Script from "next/script";
import { domine } from "./fonts";
import ShareButton from "@/components/ShareButton";
import FAQ from "@/components/FAQ";
import FiscalAd from "@/components/FiscalAd";
import MarketStatusCard from "@/components/MarketStatusCard";
import { slugForHolidayName } from "@/lib/holidayPages";
import {
  type HolidayType,
  stripTime,
  toISODate,
  addDays,
  isAfterMarketCloseET,
  getUsStockMarketHolidays,
} from "@/lib/tradingDays";

/* ---------------------------------------------
   DATE + HOLIDAY UTILITIES
----------------------------------------------*/

type DisplayHoliday = {
  isoDate: string;
  name: string;
  type: HolidayType;
  closeTime?: string;
};

function formatDisplayDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function isSameDay(d1: Date, d2: Date): boolean {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
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
            className={`${domine.className} text-3xl sm:text-4xl font-semibold tracking-tight text-balance`}
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

        {/* LIVE MARKET STATUS */}
        <div className="w-full -mt-4">
          <MarketStatusCard />
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
              <span className="text-xs text-slate-500">See trading days remaining until any date</span>
            </div>
          </div>
          <svg className="w-4 h-4 text-slate-600 group-hover:text-slate-400 transition-colors flex-shrink-0 ml-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </a>

        {/* FISCAL.AI AD (directly below live counter, above upcoming holidays) */}
        <aside
          className="w-full -mt-2 -mb-4"
          aria-label="Sponsored content"
        >
          <FiscalAd href="https://fiscal.ai/company/NasdaqGS-GOOGL/?via=welcome" />
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
              {upcoming.map((h) => {
                const slug = slugForHolidayName(h.name);
                return (
                <li key={h.isoDate + h.name}>
                <a
                  href={slug ? `/is-the-stock-market-open/${slug}` : "/stock-market-holidays"}
                  className="group flex items-start justify-between rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 hover:border-slate-700 hover:bg-slate-900/70 transition-all duration-150"
                >
                  <div className="flex flex-col">
                    <span className="font-medium text-slate-100 group-hover:underline decoration-slate-600 underline-offset-2">{h.name}</span>
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
                </a>
                </li>
                );
              })}
            </ul>
          )}

          <p className="mt-3 text-xs">
            <a
              href="/stock-market-holidays"
              className="inline-flex items-center gap-1 font-medium text-blue-300 hover:text-blue-200 transition-colors"
            >
              See the full holiday schedule for this year and next
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </a>
          </p>
        </section>

        {/* QUICK ANSWERS */}
        <section className="w-full border-t border-slate-800 pt-8">
          <h2 className="text-base sm:text-lg font-semibold text-slate-100 mb-2">
            Quick Answers
          </h2>

          <div className="grid gap-3 sm:grid-cols-2">
            <a
              href="/trading-days-in-a-year"
              className="group rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3 hover:border-slate-700 hover:bg-slate-900/70 transition-all duration-150"
            >
              <h3 className="text-sm font-semibold text-slate-100">
                How many trading days in a year?
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-300">
                Most years have about <span className="font-semibold text-slate-100">252</span> U.S. stock market trading days,
                depending on weekends and holidays.
              </p>
              <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-300 group-hover:text-blue-200 transition-colors">
                See the full year-by-year breakdown
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </span>
            </a>

            <a
              href="/trading-days-in-a-year#months"
              className="group rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3 hover:border-slate-700 hover:bg-slate-900/70 transition-all duration-150"
            >
              <h3 className="text-sm font-semibold text-slate-100">
                How many trading days in each month?
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-300">
                Months average about <span className="font-semibold text-slate-100">21</span> trading days,
                ranging from 19 to 23 depending on holidays and weekends.
              </p>
              <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-300 group-hover:text-blue-200 transition-colors">
                See the month-by-month table
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </span>
            </a>
          </div>
        </section>

        {/* FAQ */}
        <FAQ />

      </div>
    </main>
  );
}
