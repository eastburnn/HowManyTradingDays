"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { domine } from "../fonts";
import CalendarPicker from "@/components/CalendarPicker";
import Breadcrumbs from "@/components/Breadcrumbs";
import {
  stripTime,
  toISODate,
  getUsStockMarketHolidays,
  countTradingDaysBetween,
} from "@/lib/tradingDays";

/* ---------------------------------------------
   DATE + HOLIDAY UTILITIES (shared logic)
----------------------------------------------*/

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

        {/* CTA LINKS */}
        <div className="w-full grid grid-cols-1 sm:grid-cols-3 gap-3 border-t border-slate-800 pt-6">
          <Link
            href="/"
            className="group flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3 hover:border-slate-700 hover:bg-slate-900/70 transition-all duration-150"
          >
            <div className="flex items-center gap-2.5">
              <svg className="w-4 h-4 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2" />
              </svg>
              <span className="text-sm font-medium text-slate-100">Live Counter</span>
            </div>
            <svg className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-400 transition-colors" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </Link>

          <Link
            href="/trading-days-in-a-year"
            className="group flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3 hover:border-slate-700 hover:bg-slate-900/70 transition-all duration-150"
          >
            <div className="flex items-center gap-2.5">
              <svg className="w-4 h-4 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="text-sm font-medium text-slate-100">Days in a Year</span>
            </div>
            <svg className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-400 transition-colors" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </Link>

          <Link
            href="/about"
            className="group flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3 hover:border-slate-700 hover:bg-slate-900/70 transition-all duration-150"
          >
            <div className="flex items-center gap-2.5">
              <svg className="w-4 h-4 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 16v-4m0-4h.01" />
              </svg>
              <span className="text-sm font-medium text-slate-100">About</span>
            </div>
            <svg className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-400 transition-colors" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>

      </div>
    </main>
  );
}
