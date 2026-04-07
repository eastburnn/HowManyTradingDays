"use client";

import { useState } from "react";

type Props = {
  value: string; // ISO yyyy-mm-dd or ""
  minDate: string; // ISO yyyy-mm-dd — days before this are disabled
  onChange: (isoDate: string) => void;
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

export default function CalendarPicker({ value, minDate, onChange }: Props) {
  // Initialise the displayed month to the selected date, or today
  const initParsed = parseISO(value) ?? parseISO(minDate);
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
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition flex-shrink-0"
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
                appearance-none bg-slate-800 border border-slate-700 rounded-lg
                text-sm font-semibold text-slate-100
                pl-2.5 pr-6 py-1
                focus:outline-none focus:ring-1 focus:ring-blue-500/50 focus:border-blue-500/50
                cursor-pointer hover:bg-slate-700 transition
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
                appearance-none bg-slate-800 border border-slate-700 rounded-lg
                text-sm font-semibold text-slate-100
                pl-2.5 pr-6 py-1
                focus:outline-none focus:ring-1 focus:ring-blue-500/50 focus:border-blue-500/50
                cursor-pointer hover:bg-slate-700 transition
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
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition flex-shrink-0"
          aria-label="Next month"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 mb-1">
        {DAYS_OF_WEEK.map((d) => (
          <div key={d} className="text-center text-[10px] font-medium text-slate-500 py-1">
            {d}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-y-0.5">
        {cells.map((cell) => {
          const isSelected = cell.iso === value;
          const isToday = cell.iso === todayISO;
          const isDisabled = cell.iso < minDate;
          const isAdjacent = cell.belongsTo !== "current";

          let textClass = "";
          if (isDisabled && isAdjacent) {
            textClass = "text-slate-700 cursor-default";
          } else if (isDisabled) {
            textClass = "text-slate-600 cursor-default";
          } else if (isAdjacent) {
            // Adjacent months: muted gray, but still clickable
            textClass = "text-slate-600 hover:text-slate-400 cursor-pointer";
          } else {
            // Current month: bright white
            textClass = "text-slate-100 cursor-pointer";
          }

          return (
            <button
              key={cell.iso + cell.belongsTo}
              disabled={isDisabled}
              onClick={() => !isDisabled && handleSelect(cell.iso, cell.belongsTo)}
              className={`
                relative flex items-center justify-center
                h-8 w-full rounded-lg text-xs font-medium
                transition-colors duration-100
                ${isSelected
                  ? "bg-blue-600 text-white font-semibold"
                  : isDisabled
                    ? ""
                    : isAdjacent
                      ? "hover:bg-slate-800/60"
                      : "hover:bg-slate-800"
                }
                ${!isSelected ? textClass : ""}
              `}
            >
              {cell.day}
              {/* Today dot */}
              {isToday && !isSelected && (
                <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-blue-400" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
