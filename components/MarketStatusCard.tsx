"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getMarketStatus, type MarketStatus } from "@/lib/tradingDays";

function formatCountdown(minutes: number): string {
  if (minutes <= 0) return "0m";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function describe(status: MarketStatus): { label: string; detail: string } {
  const nowET = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York" })
  );
  const minutesNow = nowET.getHours() * 60 + nowET.getMinutes();

  if (status.isOpen) {
    const closeMin = status.isEarlyClose ? 13 * 60 : 16 * 60;
    const closeLabel = status.isEarlyClose ? "1:00 p.m." : "4:00 p.m.";
    return {
      label: "Market is open",
      detail: `Closes in ${formatCountdown(closeMin - minutesNow)} (${closeLabel} ET${status.isEarlyClose ? " — early close" : ""})`,
    };
  }

  // Closed — say why and when it reopens
  const [y, m, d] = status.nextOpenISO.split("-").map(Number);
  const nextOpen = new Date(y, m - 1, d);
  const todayISO = `${nowET.getFullYear()}-${String(nowET.getMonth() + 1).padStart(2, "0")}-${String(nowET.getDate()).padStart(2, "0")}`;

  const opensLabel =
    status.nextOpenISO === todayISO
      ? `Opens at 9:30 a.m. ET (in ${formatCountdown(9 * 60 + 30 - minutesNow)})`
      : `Opens ${nextOpen.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })} at 9:30 a.m. ET`;

  let why = "";
  if (status.reason === "weekend") why = "Weekend";
  else if (status.reason === "after-close") why = "After hours";
  else if (status.reason === "before-open") why = "Pre-market";
  else why = status.reason; // holiday name

  return { label: "Market is closed", detail: `${why} · ${opensLabel}` };
}

export default function MarketStatusCard({ linkToHub = true }: { linkToHub?: boolean }) {
  const [status, setStatus] = useState<MarketStatus | null>(null);

  useEffect(() => {
    const update = () => setStatus(getMarketStatus());
    update();
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, []);

  // Render a stable placeholder during SSR/first paint to avoid hydration mismatch
  if (!status) {
    return (
      <div className="w-full rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3 flex items-center gap-2.5">
        <span className="w-2 h-2 rounded-full bg-slate-600 flex-shrink-0" />
        <span className="text-xs text-slate-500">Checking market status…</span>
      </div>
    );
  }

  const { label, detail } = describe(status);

  const inner = (
    <>
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="relative flex w-2 h-2 flex-shrink-0">
          {status.isOpen && (
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
          )}
          <span
            className={`relative inline-flex rounded-full w-2 h-2 ${
              status.isOpen ? "bg-emerald-400" : "bg-red-400"
            }`}
          />
        </span>
        <div className="flex flex-col min-w-0">
          <span className={`text-sm font-medium ${status.isOpen ? "text-emerald-200" : "text-slate-100"}`}>
            {label}
          </span>
          <span className="text-xs text-slate-400 truncate">{detail}</span>
        </div>
      </div>
      {linkToHub && (
        <svg className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-400 transition-colors flex-shrink-0 ml-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      )}
    </>
  );

  const className =
    "group w-full flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3 transition-all duration-150" +
    (linkToHub ? " hover:border-slate-700 hover:bg-slate-900/70" : "");

  if (linkToHub) {
    return (
      <Link href="/is-the-stock-market-open" className={className}>
        {inner}
      </Link>
    );
  }
  return <div className={className}>{inner}</div>;
}
