"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function TickerSearch() {
  const router = useRouter();
  const [value, setValue] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const t = value.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
        if (t) router.push(`/earnings/${t.toLowerCase()}`);
      }}
      className="flex gap-2"
      role="search"
    >
      <label htmlFor="ticker-search" className="sr-only">
        Ticker symbol
      </label>
      <input
        id="ticker-search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Ticker, e.g. NVDA"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        className="flex-1 rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-slate-500 uppercase"
      />
      <button
        type="submit"
        className="rounded-lg border border-blue-500/40 bg-blue-500/20 px-4 py-2 text-sm font-medium text-blue-200 hover:bg-blue-500/30 transition-colors"
      >
        Look up
      </button>
    </form>
  );
}
