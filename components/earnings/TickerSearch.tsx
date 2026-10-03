"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { formatShortDate } from "@/lib/earnings/format";

type Hit = {
  ticker: string;
  name: string;
  nextDate: string | null;
  status: "estimated" | "confirmed" | null;
  confidence: string | null;
  overdue: boolean | null;
};

const DEBOUNCE_MS = 150;

function hitLabel(h: Hit): string {
  if (!h.nextDate) return "";
  if (h.overdue) return "Any day";
  const date = formatShortDate(h.nextDate);
  if (h.status === "confirmed") return `${date} · Confirmed`;
  if (h.confidence === "low") return `~${date}`;
  return `${date} · Estimated`;
}

export default function TickerSearch() {
  const router = useRouter();
  const listId = useId();
  const [value, setValue] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const requestId = useRef(0);

  // Fetch suggestions as the user types (debounced; stale responses ignored)
  useEffect(() => {
    const q = value.trim();
    if (!q) {
      setHits([]);
      setOpen(false);
      return;
    }
    const id = ++requestId.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/earnings/search?q=${encodeURIComponent(q)}`);
        const json = (await res.json()) as { results: Hit[] };
        if (id !== requestId.current) return;
        setHits(json.results);
        setOpen(true);
        setActive(json.results.length ? 0 : -1);
      } catch {
        if (id === requestId.current) setHits([]);
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  function go(ticker: string) {
    setOpen(false);
    router.push(`/earnings/${ticker.toLowerCase()}`);
  }

  function submit() {
    const q = value.trim();
    if (!q) return;
    if (open && active >= 0 && hits[active]) return go(hits[active].ticker);
    if (hits[0]) return go(hits[0].ticker);
    // No suggestions yet: treat the input as a ticker
    const t = q.toUpperCase().replace(/[^A-Z0-9.-]/g, "");
    if (t) go(t);
  }

  return (
    <div ref={boxRef} className="relative">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex gap-2"
        role="search"
      >
        <label htmlFor="ticker-search" className="sr-only">
          Company or ticker
        </label>
        <input
          id="ticker-search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => hits.length && setOpen(true)}
          onKeyDown={(e) => {
            if (!open || !hits.length) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => (a + 1) % hits.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => (a - 1 + hits.length) % hits.length);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder="Company name or ticker, e.g. Nvidia or NVDA"
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
          className="flex-1 min-w-0 rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-slate-500"
        />
        <button
          type="submit"
          className="rounded-lg border border-blue-500/40 bg-blue-500/20 px-4 py-2 text-sm font-medium text-blue-200 hover:bg-blue-500/30 transition-colors"
        >
          Look up
        </button>
      </form>

      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full mt-1.5 z-50 rounded-xl border border-slate-800 bg-slate-950 shadow-xl shadow-black/40 py-1 max-h-80 overflow-y-auto"
        >
          {hits.length === 0 ? (
            <li className="px-3.5 py-2.5 text-sm text-slate-500">
              {loading ? "Searching…" : "No listed company matches that. Try the ticker symbol."}
            </li>
          ) : (
            hits.map((h, i) => (
              <li
                key={h.ticker}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  go(h.ticker);
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex items-center justify-between gap-3 px-3.5 py-2 cursor-pointer ${
                  i === active ? "bg-slate-800/70" : "hover:bg-slate-800/40"
                }`}
              >
                <span className="min-w-0 flex items-baseline gap-2">
                  <span className="text-sm font-semibold text-slate-100 whitespace-nowrap">{h.ticker}</span>
                  <span className="text-xs text-slate-400 truncate">{h.name}</span>
                </span>
                <span className="shrink-0 text-[11px] text-slate-500 whitespace-nowrap">{hitLabel(h)}</span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
