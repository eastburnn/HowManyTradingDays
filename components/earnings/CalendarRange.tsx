"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { domine } from "@/app/fonts";
import { type CalendarEvent, MAX_RANGE_DAYS, computeDistances } from "@/lib/earnings/calendar";
import { addDaysISO, daysBetweenISO, formatMediumDate } from "@/lib/earnings/format";
import CalendarGroups from "./CalendarGroups";

/**
 * The "next N days" list. Starts with the server-rendered 30 days and can
 * extend itself — 60 days, a full quarter, or every date on file — by
 * fetching further ranges from /api/earnings/calendar. The chosen range is
 * mirrored into ?days= so a reload or shared link keeps it.
 */

type Props = {
  today: string;
  initialRows: CalendarEvent[];
  initialDays: number;
  initialDistances: Record<string, number>;
  expandUntil: string;
  /** Latest date any event is on file for; null when unknown */
  maxDate: string | null;
  unavailable?: boolean;
};

const QUARTER_DAYS = 90;
const MAX_DEEP_LINK_DAYS = 400;

export default function CalendarRange({ today, initialRows, initialDays, initialDistances, expandUntil, maxDate, unavailable }: Props) {
  const [rows, setRows] = useState(initialRows);
  const [distances, setDistances] = useState(initialDistances);
  const [through, setThrough] = useState(() => addDaysISO(today, initialDays));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const throughRef = useRef(addDaysISO(today, initialDays));
  const busy = useRef(false);

  const extendTo = useCallback(
    async (target: string) => {
      if (busy.current) return;
      busy.current = true;
      setLoading(true);
      setError(null);
      try {
        while (throughRef.current < target) {
          const from = addDaysISO(throughRef.current, 1);
          const chunkEnd = addDaysISO(from, MAX_RANGE_DAYS - 1);
          const to = chunkEnd < target ? chunkEnd : target;
          const res = await fetch(`/api/earnings/calendar?from=${from}&to=${to}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = (await res.json()) as { events: CalendarEvent[] };
          // Overdue placeholders and already-reported dates belong elsewhere.
          const fresh = json.events.filter((e) => !e.overdue && e.status !== "reported");
          setRows((prev) => [...prev, ...fresh]);
          setDistances((prev) => ({ ...prev, ...computeDistances(fresh, today) }));
          throughRef.current = to;
          setThrough(to);
        }
        const url = new URL(window.location.href);
        url.searchParams.set("days", maxDate && target >= maxDate ? "all" : String(daysBetweenISO(today, target)));
        window.history.replaceState(window.history.state, "", url);
      } catch {
        setError("Couldn't load more dates. Please try again.");
      } finally {
        busy.current = false;
        setLoading(false);
      }
    },
    [today, maxDate]
  );

  // Deep link: /earnings?days=90 or ?days=all
  useEffect(() => {
    const days = new URLSearchParams(window.location.search).get("days");
    if (!days) return;
    const wanted = days === "all" ? maxDate : addDaysISO(today, Math.min(Math.max(Number(days) || 0, 0), MAX_DEEP_LINK_DAYS));
    if (!wanted) return;
    const target = maxDate && wanted > maxDate ? maxDate : wanted;
    if (target > throughRef.current) void extendTo(target);
  }, [today, maxDate, extendTo]);

  const daysShown = daysBetweenISO(today, through);
  const everything = maxDate !== null && through >= maxDate;
  const heading = daysShown <= QUARTER_DAYS ? `Next ${daysShown} days` : `Through ${formatMediumDate(through)}`;
  const options = [
    { label: "Next 60 days", target: addDaysISO(today, 60) },
    { label: "Next 90 days (a full quarter)", target: addDaysISO(today, QUARTER_DAYS) },
    ...(maxDate ? [{ label: `Everything on file, through ${formatMediumDate(maxDate)}`, target: maxDate }] : []),
  ].filter((o) => o.target > through && (!maxDate || o.target <= maxDate));

  return (
    <section className="space-y-5">
      <div className="flex items-baseline justify-between">
        <h2 className={`${domine.className} text-lg font-semibold text-slate-100`}>{heading}</h2>
        <span className="text-xs text-slate-500">{rows.length} companies</span>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">
          {unavailable
            ? "The earnings calendar is temporarily unavailable. Please check back shortly."
            : `No earnings dates in the next ${daysShown} days yet.`}
        </p>
      ) : (
        <CalendarGroups rows={rows} today={today} distances={distances} expandUntil={expandUntil} />
      )}

      {!unavailable && (options.length > 0 || everything) && (
        <div className="rounded-xl border border-dashed border-slate-800 px-4 py-4 text-center space-y-3">
          <p className="text-sm text-slate-400">
            {everything
              ? "That's every date on file. Estimates run about two quarters ahead."
              : `Showing the next ${daysShown} days. See further ahead:`}
          </p>
          {options.length > 0 && (
            <div className="flex flex-wrap justify-center gap-2">
              {options.map((o) => (
                <button
                  key={o.label}
                  type="button"
                  disabled={loading}
                  onClick={() => void extendTo(o.target)}
                  className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-slate-500 hover:bg-slate-800/70 disabled:opacity-50 transition-colors"
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
          {loading && <p className="text-xs text-slate-500">Loading…</p>}
          {error && <p className="text-xs text-rose-300">{error}</p>}
        </div>
      )}
    </section>
  );
}
