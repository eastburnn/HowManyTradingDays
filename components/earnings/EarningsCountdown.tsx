"use client";

import { useEffect, useState } from "react";
import { countTradingDaysBetween, stripTime } from "@/lib/tradingDays";
import { parseISODate } from "@/lib/earnings/format";

type Props = {
  /** Target date (for a window, the window's start) */
  eventDate: string;
  /** Window end, when showing a range instead of a single date */
  windowEnd?: string;
  /** Server-rendered values so crawlers and first paint see real numbers */
  initial: { tradingDays: number; calendarDays: number; tradingDaysEnd?: number; calendarDaysEnd?: number };
};

function compute(eventDate: string) {
  const today = stripTime(new Date());
  const target = parseISODate(eventDate);
  if (target < today) return { tradingDays: 0, calendarDays: 0 };
  const r = countTradingDaysBetween(today, target);
  return { tradingDays: r.tradingDays, calendarDays: r.calendarDays };
}

function fmt(n: number): string {
  return n % 1 === 0 ? n.toFixed(0) : n.toFixed(1);
}

export default function EarningsCountdown({ eventDate, windowEnd, initial }: Props) {
  const [counts, setCounts] = useState(initial);

  // Recompute in the browser: the server-rendered page may be up to a day old,
  // and the count drops at 4 p.m. ET when today's session closes.
  useEffect(() => {
    const update = () => {
      const start = compute(eventDate);
      if (windowEnd) {
        const end = compute(windowEnd);
        setCounts({ ...start, tradingDaysEnd: end.tradingDays, calendarDaysEnd: end.calendarDays });
      } else {
        setCounts(start);
      }
    };
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, [eventDate, windowEnd]);

  const isRange = windowEnd !== undefined && counts.tradingDaysEnd !== undefined;

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="flex flex-col items-center rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-4 gap-1">
        <span className="text-4xl sm:text-5xl font-semibold tabular-nums text-blue-200">
          {isRange ? `${fmt(counts.tradingDays)}–${fmt(counts.tradingDaysEnd!)}` : fmt(counts.tradingDays)}
        </span>
        <span className="text-xs text-slate-400 text-center">trading days</span>
      </div>
      <div className="flex flex-col items-center rounded-xl border border-slate-700 bg-slate-800/40 px-4 py-4 gap-1">
        <span className="text-4xl sm:text-5xl font-semibold tabular-nums text-slate-200">
          {isRange ? `${counts.calendarDays}–${counts.calendarDaysEnd}` : counts.calendarDays}
        </span>
        <span className="text-xs text-slate-400 text-center">calendar days</span>
      </div>
    </div>
  );
}
