import type { Metadata } from "next";
import Link from "next/link";
import { domine } from "../fonts";
import Breadcrumbs from "@/components/Breadcrumbs";
import TickerSearch from "@/components/earnings/TickerSearch";
import { getUpcomingEvents, type UpcomingRow } from "@/lib/earnings/queries";
import { todayET } from "@/lib/earnings/ingest";
import { addDaysISO, displayName, formatLongDate, parseISODate, timeOfDayLabel } from "@/lib/earnings/format";
import { countTradingDaysBetween, getDayInfo } from "@/lib/tradingDays";

export const revalidate = 3600;

const title = "Earnings Calendar with Trading-Day Countdowns";
const description =
  "Upcoming U.S. earnings dates for NYSE and Nasdaq companies, estimated from SEC filings, with a countdown in trading days to each report.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/earnings" },
  openGraph: {
    title,
    description,
    url: "https://howmanytradingdays.com/earnings",
    siteName: "How Many Trading Days",
    type: "website",
  },
};

const DAYS_AHEAD = 14;

function groupByDate(rows: UpcomingRow[]): Map<string, UpcomingRow[]> {
  const map = new Map<string, UpcomingRow[]>();
  for (const r of rows) {
    if (!map.has(r.eventDate)) map.set(r.eventDate, []);
    map.get(r.eventDate)!.push(r);
  }
  return map;
}

export default async function EarningsCalendarPage() {
  const today = todayET();
  const end = addDaysISO(today, DAYS_AHEAD);
  const rows = await getUpcomingEvents(today, end, 800);
  const byDate = groupByDate(rows);

  return (
    <main className="flex-1 flex items-start justify-center px-4">
      <div className="max-w-xl w-full flex flex-col gap-8 py-12">
        <Breadcrumbs crumbs={[{ label: "Home", href: "/" }, { label: "Earnings" }]} />

        <header className="space-y-2">
          <h1 className={`${domine.className} text-3xl sm:text-4xl font-semibold tracking-tight text-balance`}>
            Earnings Calendar
          </h1>
          <p className="text-sm text-slate-400 leading-relaxed">
            When U.S. companies report earnings, with a countdown in trading days to each date. Dates are
            estimated from each company&apos;s SEC filing history and upgraded to confirmed when the company
            announces. Look up any NYSE or Nasdaq ticker.
          </p>
        </header>

        <TickerSearch />

        <section className="space-y-4">
          <div className="flex items-baseline justify-between">
            <h2 className={`${domine.className} text-lg font-semibold text-slate-100`}>Next two weeks</h2>
            <span className="text-xs text-slate-500">{rows.length} companies</span>
          </div>

          {byDate.size === 0 ? (
            <p className="text-sm text-slate-500">No earnings dates in the next two weeks yet.</p>
          ) : (
            [...byDate.entries()].map(([date, items]) => {
              const info = getDayInfo(parseISODate(date));
              const { tradingDays } = countTradingDaysBetween(parseISODate(today), parseISODate(date));
              return (
                <div key={date} className="rounded-xl border border-slate-800 bg-slate-900/40">
                  <div className="flex items-baseline justify-between px-4 py-2.5 border-b border-slate-800">
                    <div>
                      <p className="text-sm font-medium text-slate-100">{formatLongDate(date)}</p>
                      <p className="text-[11px] text-slate-500">
                        {date === today
                          ? "Today"
                          : `${tradingDays % 1 === 0 ? tradingDays : tradingDays.toFixed(1)} trading days away`}
                        {info.isEarlyClose ? " · early close" : ""}
                      </p>
                    </div>
                    <span className="text-xs text-slate-500">{items.length}</span>
                  </div>
                  <ul className="divide-y divide-slate-800">
                    {items.map((r) => (
                      <li key={r.id}>
                        <Link
                          href={`/earnings/${r.ticker.toLowerCase()}`}
                          className="flex items-center justify-between gap-3 px-4 py-2 hover:bg-slate-900/70 transition-colors"
                        >
                          <span className="min-w-0 flex items-baseline gap-2">
                            <span className="text-sm font-semibold text-slate-100 whitespace-nowrap">{r.ticker}</span>
                            <span className="text-xs text-slate-400 truncate">{displayName(r.name)}</span>
                          </span>
                          <span className="flex items-center gap-2 shrink-0 text-[10px] uppercase tracking-wide">
                            <span className="text-slate-500">{timeOfDayLabel(r.timeOfDay)}</span>
                            <span
                              className={`rounded-full border px-2 py-0.5 font-semibold ${
                                r.status === "confirmed"
                                  ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200"
                                  : r.confidence === "low"
                                  ? "border-slate-600 bg-slate-700/30 text-slate-400"
                                  : "border-amber-400/40 bg-amber-400/10 text-amber-200"
                              }`}
                            >
                              {r.status === "confirmed" ? "Confirmed" : "Est."}
                            </span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })
          )}
        </section>

        <section className="border-t border-slate-800 pt-6 space-y-3">
          <h2 className={`${domine.className} text-lg font-semibold text-slate-100`}>How these dates are estimated</h2>
          <p className="text-sm text-slate-400 leading-relaxed">
            Every company on this calendar files its earnings releases with the SEC on Form 8-K. We read that
            history — how many days after each fiscal quarter ended the company reported, on which weekday, and
            at what time of day — and project the pattern onto the current quarter, using the same fiscal
            quarter in prior years. Each ticker page shows the past dates the estimate is based on and how
            reliable that company&apos;s pattern has been.
          </p>
          <p className="text-sm text-slate-400 leading-relaxed">
            Counts are in U.S. stock market trading days: weekdays excluding NYSE/Nasdaq holidays, with early-close
            sessions counted as half days — the same engine behind the{" "}
            <Link href="/" className="text-blue-300 hover:text-blue-200 transition-colors">
              live counter
            </Link>{" "}
            and the{" "}
            <Link href="/calculator" className="text-blue-300 hover:text-blue-200 transition-colors">
              trading days calculator
            </Link>
            .
          </p>
        </section>

        <p className="text-[10px] text-slate-500 text-center leading-relaxed">
          Estimated dates are projections from public SEC filings, not company announcements. Confirm with the
          company before making decisions. Not investment advice.
        </p>
      </div>
    </main>
  );
}
