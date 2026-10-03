/**
 * Shared shapes and pure helpers for the earnings calendar UI: the compact
 * event the /api/earnings/calendar route returns, month-grid arithmetic, the
 * status-chip vocabulary, and trading-day distances. No database access —
 * safe to import from client components.
 */

import type { ConfidenceTier } from "./estimator";
import type { TimeOfDay } from "./fiscal";
import type { EventStatus } from "./queries";
import { addDaysISO, displayName, parseISODate } from "./format";
import { countTradingDaysBetween, toISODate } from "@/lib/tradingDays";

/** A current event joined with its company, as the database returns it */
export type RangeRow = {
  id: number;
  ticker: string;
  name: string;
  eventDate: string;
  timeOfDay: TimeOfDay;
  status: EventStatus;
  confidence: ConfidenceTier | null;
  overdue: boolean;
  originalEstimate: string | null;
  filerCategory: string;
};

/** The compact form sent to the browser */
export type CalendarEvent = {
  id: number;
  ticker: string;
  name: string;
  date: string;
  timeOfDay: TimeOfDay;
  status: EventStatus;
  confidence: ConfidenceTier | null;
  overdue: boolean;
  large: boolean;
};

/** Longest span one calendar request may cover */
export const MAX_RANGE_DAYS = 100;

export function toCalendarEvent(r: RangeRow): CalendarEvent {
  return {
    id: r.id,
    ticker: r.ticker,
    name: displayName(r.name),
    date: r.eventDate,
    timeOfDay: r.timeOfDay,
    status: r.status,
    confidence: r.confidence,
    overdue: r.overdue,
    large: r.filerCategory === "large-accelerated",
  };
}

/* ---------------------------------------------
   STATUS CHIPS
----------------------------------------------*/

export function statusChip(e: Pick<CalendarEvent, "status" | "confidence">): { label: string; className: string } {
  if (e.status === "reported") return { label: "Reported", className: "border-blue-400/40 bg-blue-400/10 text-blue-200" };
  if (e.status === "confirmed") return { label: "Confirmed", className: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200" };
  if (e.confidence === "low") return { label: "Window", className: "border-slate-600 bg-slate-700/30 text-slate-400" };
  return { label: "Estimated", className: "border-amber-400/40 bg-amber-400/10 text-amber-200" };
}

/* ---------------------------------------------
   MONTH ARITHMETIC (keys are "YYYY-MM")
----------------------------------------------*/

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function monthRange(key: string): { from: string; to: string } {
  const [y, m] = key.split("-").map(Number);
  return { from: `${key}-01`, to: toISODate(new Date(y, m, 0)) };
}

export function shiftMonth(key: string, n: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/** Monday–Friday grid for a month: rows of five ISO dates, null outside the month */
export function weekdayGrid(key: string): (string | null)[][] {
  const { from, to } = monthRange(key);
  const first = parseISODate(from);
  const monday = addDaysISO(from, -((first.getDay() + 6) % 7));
  const weeks: (string | null)[][] = [];
  for (let wk = monday; wk <= to; wk = addDaysISO(wk, 7)) {
    const row: (string | null)[] = [];
    for (let i = 0; i < 5; i++) {
      const d = addDaysISO(wk, i);
      row.push(d >= from && d <= to ? d : null);
    }
    if (row.some(Boolean)) weeks.push(row);
  }
  return weeks;
}

/** The next (dir 1) or previous (dir -1) weekday */
export function stepWeekday(iso: string, dir: 1 | -1): string {
  let d = iso;
  do {
    d = addDaysISO(d, dir);
  } while ([0, 6].includes(parseISODate(d).getDay()));
  return d;
}

/* ---------------------------------------------
   TRADING-DAY DISTANCES
----------------------------------------------*/

/** Trading days from `today` to each distinct event date */
export function computeDistances(events: Pick<CalendarEvent, "date">[], today: string): Record<string, number> {
  const out: Record<string, number> = {};
  const from = parseISODate(today);
  for (const e of events) {
    if (e.date in out) continue;
    out[e.date] = countTradingDaysBetween(from, parseISODate(e.date)).tradingDays;
  }
  return out;
}

export function tradingDaysAwayLabel(date: string, today: string, tradingDays: number | undefined): string {
  if (date === today) return "Today";
  if (date < today || tradingDays === undefined) return "";
  return `${tradingDays % 1 === 0 ? tradingDays : tradingDays.toFixed(1)} trading days away`;
}
