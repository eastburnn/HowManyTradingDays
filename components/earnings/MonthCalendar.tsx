"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { domine } from "@/app/fonts";
import {
  type CalendarEvent,
  monthKey,
  monthLabel,
  monthRange,
  shiftMonth,
  stepWeekday,
  tradingDaysAwayLabel,
  weekdayGrid,
} from "@/lib/earnings/calendar";
import { formatLongDate, parseISODate } from "@/lib/earnings/format";
import { countTradingDaysBetween, getDayInfo } from "@/lib/tradingDays";
import { CompanyRow } from "./CalendarGroups";

/**
 * Month view: a Monday–Friday grid with the number of companies reporting
 * each day (shaded by volume). Clicking a day opens a dialog listing them;
 * inside it ← → step through days (across month boundaries) and Esc closes.
 * Months load on demand from /api/earnings/calendar and are kept in memory.
 */

type Props = {
  today: string;
  /** Earliest and latest "YYYY-MM" with any event on file */
  minMonth: string;
  maxMonth: string;
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const NAV_BTN =
  "h-8 w-8 shrink-0 rounded-lg border border-slate-700 text-lg leading-none text-slate-300 hover:bg-slate-800/70 disabled:opacity-30 disabled:hover:bg-transparent transition-colors";

function clampMonth(key: string, lo: string, hi: string): string {
  return key < lo ? lo : key > hi ? hi : key;
}

export default function MonthCalendar({ today, minMonth, maxMonth }: Props) {
  const headingId = useId();
  // The month the visitor browsed to; while a day is open the grid shows
  // that day's month instead, so stepping across a boundary moves the grid.
  const [browseMonth, setBrowseMonth] = useState(() => clampMonth(monthKey(today), minMonth, maxMonth));
  const [selected, setSelected] = useState<string | null>(null);
  const [data, setData] = useState<Record<string, CalendarEvent[]>>({});
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const inflight = useRef(new Set<string>());
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const selectedRef = useRef<string | null>(null);
  const month = selected ? monthKey(selected) : browseMonth;

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  // Load a month once. The route is CDN-cached, so this is cheap.
  useEffect(() => {
    if (data[month] || failed[month] || inflight.current.has(month)) return;
    const key = month;
    inflight.current.add(key);
    const { from, to } = monthRange(key);
    fetch(`/api/earnings/calendar?from=${from}&to=${to}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as { events: CalendarEvent[] };
      })
      .then((json) => setData((d) => ({ ...d, [key]: json.events.filter((e) => !e.overdue) })))
      .catch(() => setFailed((f) => ({ ...f, [key]: true })))
      .finally(() => inflight.current.delete(key));
  }, [month, data, failed]);

  const events = data[month];
  const byDay = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const e of events ?? []) {
      const list = m.get(e.date);
      if (list) list.push(e);
      else m.set(e.date, [e]);
    }
    return m;
  }, [events]);
  const maxCount = useMemo(() => Math.max(1, ...[...byDay.values()].map((l) => l.length)), [byDay]);
  const weeks = useMemo(() => weekdayGrid(month), [month]);
  const loadingMonth = !events && !failed[month];

  function openDay(iso: string) {
    setSelected(iso);
    const d = dialogRef.current;
    if (d && !d.open) d.showModal();
  }

  function closeDialog() {
    const cur = selectedRef.current;
    if (cur) setBrowseMonth(monthKey(cur)); // the grid stays where the visitor ended up
    setSelected(null);
    const d = dialogRef.current;
    if (d?.open) d.close();
  }

  // Esc and anything else that closes the element natively also reset state.
  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    const onClose = () => closeDialog();
    d.addEventListener("close", onClose);
    d.addEventListener("cancel", onClose);
    return () => {
      d.removeEventListener("close", onClose);
      d.removeEventListener("cancel", onClose);
    };
  }, []);

  // Keep the page from scrolling behind the modal
  useEffect(() => {
    if (!selected) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [selected]);

  // Functional update so a burst of key repeats chains day by day
  function step(dir: 1 | -1) {
    setSelected((cur) => {
      if (!cur) return cur;
      const next = stepWeekday(cur, dir);
      const key = monthKey(next);
      return key < minMonth || key > maxMonth ? cur : next;
    });
  }

  function retry() {
    setFailed((f) => {
      const copy = { ...f };
      delete copy[month];
      return copy;
    });
  }

  const selectedEvents = selected ? data[monthKey(selected)]?.filter((e) => e.date === selected) : undefined;
  const selectedInfo = selected ? getDayInfo(parseISODate(selected)) : null;
  let summary = "";
  if (selected) {
    if (!selectedEvents) {
      summary = failed[monthKey(selected)] ? "Couldn't load this month." : "Loading…";
    } else {
      const confirmed = selectedEvents.filter((e) => e.status === "confirmed").length;
      const reported = selectedEvents.filter((e) => e.status === "reported").length;
      const parts = [`${selectedEvents.length} ${selectedEvents.length === 1 ? "company" : "companies"}`];
      if (confirmed) parts.push(`${confirmed} confirmed`);
      if (reported) parts.push(`${reported} reported`);
      const away = tradingDaysAwayLabel(
        selected,
        today,
        countTradingDaysBetween(parseISODate(today), parseISODate(selected)).tradingDays
      );
      if (away) parts.push(away);
      if (selectedInfo?.holidayName) parts.push(selectedInfo.holidayName);
      summary = parts.join(" · ");
    }
  }

  return (
    <section className="space-y-3 rounded-2xl border border-slate-300/30 p-3 sm:p-4" aria-label="Earnings by day">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setBrowseMonth(shiftMonth(month, -1))}
          disabled={month <= minMonth}
          aria-label="Previous month"
          className={NAV_BTN}
        >
          ‹
        </button>
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className={`${domine.className} text-lg font-semibold text-slate-100 truncate`}>{monthLabel(month)}</h2>
          {events && <span className="text-xs text-slate-500 whitespace-nowrap">{events.length} companies</span>}
          {month !== monthKey(today) && (
            <button
              type="button"
              onClick={() => setBrowseMonth(clampMonth(monthKey(today), minMonth, maxMonth))}
              className="text-xs text-blue-300 hover:text-blue-200 transition-colors"
            >
              Today
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setBrowseMonth(shiftMonth(month, 1))}
          disabled={month >= maxMonth}
          aria-label="Next month"
          className={NAV_BTN}
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-5 gap-1 text-center text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">
        {WEEKDAYS.map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      <div className="space-y-1">
        {weeks.map((week, i) => (
          <div key={i} className="grid grid-cols-5 gap-1">
            {week.map((iso, j) => {
              if (!iso) return <div key={`blank-${j}`} />;
              const count = byDay.get(iso)?.length ?? 0;
              const info = getDayInfo(parseISODate(iso));
              const isToday = iso === today;
              const past = iso < today;
              const alpha = count ? 0.07 + 0.33 * (count / maxCount) : 0;
              return (
                <button
                  key={iso}
                  type="button"
                  disabled={loadingMonth || count === 0}
                  onClick={() => openDay(iso)}
                  aria-label={`${formatLongDate(iso)}: ${count} ${count === 1 ? "company" : "companies"}${
                    info.holidayName ? `, ${info.holidayName}` : ""
                  }`}
                  className={`relative h-14 sm:h-16 rounded-lg border text-center transition-colors ${
                    count ? "border-slate-800 hover:border-slate-500 cursor-pointer" : "border-slate-800/60"
                  } ${isToday ? "ring-1 ring-blue-400/70" : ""} ${!info.isTradingDay ? "opacity-50" : ""}`}
                  style={count ? { backgroundColor: `rgba(59, 130, 246, ${alpha.toFixed(3)})` } : undefined}
                >
                  <span className={`absolute left-1.5 top-1 text-[10px] ${isToday ? "font-semibold text-blue-300" : "text-slate-500"}`}>
                    {Number(iso.slice(8))}
                  </span>
                  <span className="flex h-full items-center justify-center pt-2">
                    {loadingMonth ? (
                      <span className="h-3 w-6 rounded bg-slate-800 animate-pulse" />
                    ) : count ? (
                      <span className={`text-base font-semibold tabular-nums ${past ? "text-slate-300" : "text-slate-100"}`}>{count}</span>
                    ) : (
                      <span className="text-[10px] text-slate-600">{info.holidayName ? "Closed" : "-"}</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {failed[month] && (
        <p className="text-xs text-rose-300">
          Couldn&apos;t load {monthLabel(month)}.{" "}
          <button type="button" onClick={retry} className="underline hover:text-rose-200">
            Try again
          </button>
        </p>
      )}

      {/* A fixed height whatever the day holds: the list scrolls inside it,
          and a quiet day simply leaves room below its rows. */}
      <dialog
        ref={dialogRef}
        onClick={(e) => {
          if (e.target === dialogRef.current) closeDialog();
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            step(-1);
          } else if (e.key === "ArrowRight") {
            e.preventDefault();
            step(1);
          } else if (e.key === "Escape") {
            e.preventDefault();
            closeDialog();
          }
        }}
        aria-labelledby={headingId}
        className="m-auto w-[calc(100vw-2rem)] max-w-lg h-[min(36rem,85vh)] rounded-2xl border border-slate-800 bg-slate-950 p-0 text-slate-100 shadow-2xl shadow-black/60 backdrop:bg-black/70 open:flex open:flex-col"
      >
        {selected && (
          <>
            <header className="flex items-center justify-between gap-2 border-b border-slate-800 px-3 py-3">
              <button type="button" onClick={() => step(-1)} aria-label="Previous day" className={NAV_BTN}>
                ‹
              </button>
              <div className="min-w-0 text-center">
                <h3 id={headingId} className="text-sm font-semibold text-slate-100 truncate">
                  {formatLongDate(selected)}
                </h3>
                <p className="text-[11px] text-slate-500 truncate">{summary}</p>
              </div>
              <button type="button" onClick={() => step(1)} aria-label="Next day" className={NAV_BTN}>
                ›
              </button>
            </header>
            <ul key={selected} className="flex-1 overflow-y-auto overscroll-contain divide-y divide-slate-800">
              {selectedEvents === undefined ? (
                <li className="px-4 py-6 text-center text-sm text-slate-500">{summary}</li>
              ) : selectedEvents.length === 0 ? (
                <li className="px-4 py-6 text-center text-sm text-slate-500">
                  No earnings dates on this day
                  {selectedInfo?.holidayName ? ` (${selectedInfo.holidayName}, market closed)` : ""}.
                </li>
              ) : (
                selectedEvents.map((e) => <CompanyRow key={e.id} e={e} />)
              )}
            </ul>
            <footer className="flex items-center justify-between border-t border-slate-800 px-4 py-2">
              <span className="hidden sm:inline text-[11px] text-slate-500">← → change day · Esc closes</span>
              <button
                type="button"
                onClick={closeDialog}
                className="rounded-lg border border-slate-700 px-3 py-1 text-xs font-medium text-slate-200 hover:bg-slate-800/70 transition-colors"
              >
                Close
              </button>
            </footer>
          </>
        )}
      </dialog>
    </section>
  );
}
