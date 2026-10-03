"use client";

import { useState } from "react";

type Props = {
  value: string; // ISO yyyy-mm-dd or ""
  minDate: string; // ISO yyyy-mm-dd — days before this are disabled
  onChange: (isoDate: string) => void;
  initialDate?: string; // ISO yyyy-mm-dd — month shown when no value is selected (defaults to minDate)
};

const DAYS_OF_WEEK = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function parseISO(iso: string): { year: number; month: number; day: number } | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  return { year: y, month: m - 1, day: d };
}

function toISO(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Build the 6-row × 7-col grid of cells for the given displayed month. */
function buildGrid(displayYear: number, displayMonth: number) {
  const firstOfMonth = new Date(displayYear, displayMonth, 1);
  const startDow = firstOfMonth.getDay(); // 0 = Sunday
  const daysInMonth = new Date(displayYear, displayMonth + 1, 0).getDate();

  // How many days from the previous month to show
  const prevMonthDays = new Date(displayYear, displayMonth, 0).getDate();

  type Cell = { iso: string; day: number; belongsTo: "prev" | "current" | "next" };
  const cells: Cell[] = [];

  // Padding from previous month
  for (let i = startDow - 1; i >= 0; i--) {
    const d = prevMonthDays - i;
    const prevMonth = displayMonth === 0 ? 11 : displayMonth - 1;
    const prevYear = displayMonth === 0 ? displayYear - 1 : displayYear;
    cells.push({ iso: toISO(prevYear, prevMonth, d), day: d, belongsTo: "prev" });
  }

  // Current month
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ iso: toISO(displayYear, displayMonth, d), day: d, belongsTo: "current" });
  }

  // Padding from next month to fill 6 rows (42 cells)
  const remaining = 42 - cells.length;
  for (let d = 1; d <= remaining; d++) {
    const nextMonth = displayMonth === 11 ? 0 : displayMonth + 1;
    const nextYear = displayMonth === 11 ? displayYear + 1 : displayYear;
    cells.push({ iso: toISO(nextYear, nextMonth, d), day: d, belongsTo: "next" });
  }

  return cells;
}

export default function CalendarPicker({ value, minDate, onChange, initialDate }: Props) {
  // Initialise the displayed month to the selected date, or today
  const initParsed = parseISO(value) ?? parseISO(initialDate ?? "") ?? parseISO(minDate);
  const initYear = initParsed?.year ?? new Date().getFullYear();
  const initMonth = initParsed?.month ?? new Date().getMonth();

  const [displayYear, setDisplayYear] = useState(initYear);
  const [displayMonth, setDisplayMonth] = useState(initMonth);

  const cells = buildGrid(displayYear, displayMonth);

  function prevMonth() {
    if (displayMonth === 0) {
      setDisplayMonth(11);
      setDisplayYear((y) => y - 1);
    } else {
      setDisplayMonth((m) => m - 1);
    }
  }

  function nextMonth() {
    if (displayMonth === 11) {
      setDisplayMonth(0);
      setDisplayYear((y) => y + 1);
    } else {
      setDisplayMonth((m) => m + 1);
    }
  }

  function handleSelect(iso: string, belongsTo: "prev" | "current" | "next") {
    if (iso < minDate) return; // disabled

    // If clicking an adjacent-month day, jump to that month
    if (belongsTo === "prev") {
      if (displayMonth === 0) { setDisplayMonth(11); setDisplayYear((y) => y - 1); }
      else setDisplayMonth((m) => m - 1);
    } else if (belongsTo === "next") {
      if (displayMonth === 11) { setDisplayMonth(0); setDisplayYear((y) => y + 1); }
      else setDisplayMonth((m) => m + 1);
    }

    onChange(iso);
  }

  const todayISO = toISO(
    new Date().getFullYear(),
    new Date().getMonth(),
    new Date().getDate()
  );

  return (
    <div className="w-full select-none">
      {/* Month / year header */}
      <div className="flex items-center justify-between mb-3 gap-2">
        <button
          onClick={prevMonth}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800/70 transition-colors"
          aria-label="Previous month"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div className="flex items-center gap-1.5 flex-1 justify-center">
          {/* Month dropdown */}
          <div className="relative">
            <select
              value={displayMonth}
              onChange={(e) => setDisplayMonth(Number(e.target.value))}
              className="
                appearance-none bg-transparent border border-slate-700 rounded-lg
                text-sm font-semibold text-slate-100
                pl-2.5 pr-6 py-1
                focus:outline-none focus:ring-1 focus:ring-blue-500/50 focus:border-blue-500/50
                cursor-pointer hover:bg-slate-800/70 transition-colors
              "
            >
              {MONTH_NAMES.map((name, i) => (
                <option key={name} value={i}>{name}</option>
              ))}
            </select>
            <svg className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </div>

          {/* Year dropdown */}
          <div className="relative">
            <select
              value={displayYear}
              onChange={(e) => setDisplayYear(Number(e.target.value))}
              className="
                appearance-none bg-transparent border border-slate-700 rounded-lg
                text-sm font-semibold text-slate-100
                pl-2.5 pr-6 py-1
                focus:outline-none focus:ring-1 focus:ring-blue-500/50 focus:border-blue-500/50
                cursor-pointer hover:bg-slate-800/70 transition-colors
              "
            >
              {Array.from({ length: 11 }, (_, i) => new Date().getFullYear() + i).map((yr) => (
                <option key={yr} value={yr}>{yr}</option>
              ))}
            </select>
            <svg className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>

        <button
          onClick={nextMonth}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800/70 transition-colors"
          aria-label="Next month"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 gap-1 mb-1 text-center text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">
        {DAYS_OF_WEEK.map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>

      {/* Day cells: bordered boxes like the earnings calendar, blue for the selection, a ring for today */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell) => {
          const isSelected = cell.iso === value;
          const isToday = cell.iso === todayISO;
          const isDisabled = cell.iso < minDate;
          const isAdjacent = cell.belongsTo !== "current";

          let cellClass = "";
          if (isSelected) {
            cellClass = "border-blue-400/70 bg-blue-500/30 text-white font-semibold";
          } else if (isDisabled) {
            cellClass = `border-slate-800/40 cursor-default ${isAdjacent ? "text-slate-700" : "text-slate-600"}`;
          } else if (isAdjacent) {
            // Adjacent months: muted, but still clickable
            cellClass = "border-slate-800/60 text-slate-600 hover:border-slate-500 hover:text-slate-400 cursor-pointer";
          } else {
            cellClass = `border-slate-800 hover:border-slate-500 cursor-pointer ${isToday ? "text-blue-300" : "text-slate-100"}`;
          }

          return (
            <button
              key={cell.iso + cell.belongsTo}
              disabled={isDisabled}
              onClick={() => !isDisabled && handleSelect(cell.iso, cell.belongsTo)}
              className={`
                flex h-9 w-full items-center justify-center rounded-lg border text-xs font-medium
                transition-colors duration-100
                ${cellClass}
                ${isToday ? "ring-1 ring-blue-400/70" : ""}
              `}
            >
              {cell.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
