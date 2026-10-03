import Link from "next/link";
import { type CalendarEvent, tradingDaysAwayLabel } from "@/lib/earnings/calendar";
import { addDaysISO, formatLongDate, formatMediumDate, parseISODate, timeOfDayLabel } from "@/lib/earnings/format";
import { getDayInfo } from "@/lib/tradingDays";
import StatusBadge from "./StatusBadge";

/**
 * The calendar list: events grouped by week, then by day, each day a
 * collapsible panel of company rows. Pure presentation — rendered on the
 * server for the first 30 days and in the browser for anything loaded after.
 */

/** Monday-start week key for a date */
export function weekStart(iso: string): string {
  const d = parseISODate(iso);
  return addDaysISO(iso, -((d.getDay() + 6) % 7));
}

export function groupByWeekAndDay(rows: CalendarEvent[]): Map<string, Map<string, CalendarEvent[]>> {
  const weeks = new Map<string, Map<string, CalendarEvent[]>>();
  for (const r of rows) {
    const wk = weekStart(r.date);
    if (!weeks.has(wk)) weeks.set(wk, new Map());
    const days = weeks.get(wk)!;
    if (!days.has(r.date)) days.set(r.date, []);
    days.get(r.date)!.push(r);
  }
  return weeks;
}

export function CompanyRow({ e }: { e: CalendarEvent }) {
  return (
    <li>
      <Link
        href={`/earnings/${e.ticker.toLowerCase()}`}
        className="flex items-center justify-between gap-3 px-4 py-2 hover:bg-slate-900/70 transition-colors"
      >
        <span className="min-w-0 flex items-baseline gap-2">
          <span className="text-sm font-semibold text-slate-100 whitespace-nowrap">{e.ticker}</span>
          <span className="text-xs text-slate-400 truncate">{e.name}</span>
        </span>
        <span className="flex items-center gap-2 shrink-0">
          <span className="hidden sm:inline text-[10px] uppercase tracking-wide text-slate-500">{timeOfDayLabel(e.timeOfDay)}</span>
          <StatusBadge status={e.status} confidence={e.confidence} />
        </span>
      </Link>
    </li>
  );
}

type Props = {
  rows: CalendarEvent[];
  today: string;
  /** Trading days from today to each date, computed where the clock is trusted */
  distances: Record<string, number>;
  /** Days on or before this date render expanded */
  expandUntil: string;
};

export default function CalendarGroups({ rows, today, distances, expandUntil }: Props) {
  const weeks = groupByWeekAndDay(rows);
  return (
    <>
      {[...weeks.entries()].map(([wk, days]) => {
        const weekTotal = [...days.values()].reduce((n, items) => n + items.length, 0);
        return (
          <div key={wk} className="space-y-2">
            <div className="flex items-baseline justify-between border-b border-slate-800 pb-1">
              <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">
                Week of {formatMediumDate(wk)}
              </h3>
              <span className="text-[11px] text-slate-600">{weekTotal}</span>
            </div>

            {[...days.entries()].map(([date, items]) => {
              const info = getDayInfo(parseISODate(date));
              const distance = tradingDaysAwayLabel(date, today, distances[date]);
              return (
                <details key={date} open={date <= expandUntil} className="group rounded-xl border border-slate-800 bg-slate-900/40">
                  <summary className="cursor-pointer list-none flex items-baseline justify-between px-4 py-2.5 group-open:border-b group-open:border-slate-800">
                    <div>
                      <p className="text-sm font-medium text-slate-100">{formatLongDate(date)}</p>
                      <p className="text-[11px] text-slate-500">
                        {distance}
                        {info.isEarlyClose ? " · early close" : ""}
                      </p>
                    </div>
                    <span className="text-xs text-slate-500">
                      {items.length}
                      <span className="ml-1.5 inline-block text-slate-600 transition-transform group-open:rotate-90">›</span>
                    </span>
                  </summary>
                  <ul className="divide-y divide-slate-800">
                    {items.map((e) => (
                      <CompanyRow key={e.id} e={e} />
                    ))}
                  </ul>
                </details>
              );
            })}
          </div>
        );
      })}
    </>
  );
}
