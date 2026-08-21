"use client";

import { useEffect, useState } from "react";
import { getMarketStatus, type MarketStatus } from "@/lib/tradingDays";

function nowET(): Date {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York" })
  );
}

type Target = {
  status: MarketStatus;
  label: string;
  kicker: string;
  target: Date; // in ET wall-clock terms
  secondary: string[]; // short lines that each fit without wrapping
};

function computeTarget(): Target {
  const status = getMarketStatus();
  const n = nowET();

  if (status.isOpen) {
    const target = new Date(n);
    target.setHours(status.isEarlyClose ? 13 : 16, 0, 0, 0);
    return {
      status,
      label: "U.S. markets are open",
      kicker: "Closes in",
      target,
      secondary: status.isEarlyClose
        ? ["Early close today — session ends at 1:00 p.m. ET"]
        : ["Today's regular session ends at 4:00 p.m. ET"],
    };
  }

  const [y, m, d] = status.nextOpenISO.split("-").map(Number);
  const target = new Date(y, m - 1, d, 9, 30, 0, 0);
  const dayLabel = target.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  let why = "";
  if (status.reason === "weekend") why = "Closed for the weekend";
  else if (status.reason === "before-open") why = "Pre-market";
  else if (status.reason !== "after-close") why = `Closed for ${status.reason}`;

  const lines = [];
  if (why) lines.push(why);
  lines.push(`Next session: ${dayLabel} \u00b7 9:30 a.m. ET`);

  return {
    status,
    label: "U.S. markets are closed",
    kicker: "Opens in",
    target,
    secondary: lines,
  };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export default function MarketCountdown() {
  const [state, setState] = useState<{ t: Target; secondsLeft: number } | null>(null);

  useEffect(() => {
    let t = computeTarget();

    const tick = () => {
      const diff = Math.max(0, Math.floor((t.target.getTime() - nowET().getTime()) / 1000));
      // Crossed an open/close boundary — recompute the target
      if (diff === 0) t = computeTarget();
      setState({ t, secondsLeft: diff });
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  if (!state) {
    return (
      <section className="w-full rounded-2xl border border-slate-800 bg-slate-900/70 shadow-xl p-8 flex flex-col items-center gap-3">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Market status</p>
        <span className="text-5xl sm:text-6xl font-semibold tabular-nums text-slate-700">
          --:--:--
        </span>
      </section>
    );
  }

  const { t, secondsLeft } = state;
  const d = Math.floor(secondsLeft / 86400);
  const h = Math.floor((secondsLeft % 86400) / 3600);
  const m = Math.floor((secondsLeft % 3600) / 60);
  const s = secondsLeft % 60;
  const isOpen = t.status.isOpen;

  return (
    <section className="w-full rounded-2xl border border-slate-800 bg-slate-900/70 shadow-xl p-8 flex flex-col items-center gap-3">
      {/* Status badge */}
      <div className="flex items-center gap-2">
        <span className="relative flex w-2 h-2">
          {isOpen && (
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
          )}
          <span
            className={`relative inline-flex rounded-full w-2 h-2 ${
              isOpen ? "bg-emerald-400" : "bg-red-400"
            }`}
          />
        </span>
        <p className={`text-xs uppercase tracking-[0.2em] ${isOpen ? "text-emerald-300" : "text-slate-400"}`}>
          {t.label}
        </p>
      </div>

      <p className="text-[10px] uppercase tracking-[0.25em] text-slate-500 -mb-1">
        {t.kicker}
      </p>

      {/* Countdown */}
      <div className="flex items-end gap-1.5 tabular-nums">
        {d > 0 && (
          <>
            <span className="text-4xl sm:text-6xl font-semibold">{d}</span>
            <span className="text-base sm:text-lg text-slate-400 mb-1 sm:mb-1.5">d</span>
          </>
        )}
        {(d > 0 || h > 0) && (
          <>
            <span className="text-4xl sm:text-6xl font-semibold">{d > 0 ? pad(h) : h}</span>
            <span className="text-base sm:text-lg text-slate-400 mb-1 sm:mb-1.5">h</span>
          </>
        )}
        <span className="text-4xl sm:text-6xl font-semibold">{d > 0 || h > 0 ? pad(m) : m}</span>
        <span className="text-base sm:text-lg text-slate-400 mb-1 sm:mb-1.5">m</span>
        <span className="text-4xl sm:text-6xl font-semibold">{pad(s)}</span>
        <span className="text-base sm:text-lg text-slate-400 mb-1 sm:mb-1.5">s</span>
      </div>

      <div className="flex flex-col items-center gap-0.5">
        {t.secondary.map((line) => (
          <p key={line} className="text-xs text-slate-400 text-center whitespace-nowrap">
            {line}
          </p>
        ))}
      </div>
    </section>
  );
}
