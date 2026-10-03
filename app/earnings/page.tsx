import type { Metadata } from "next";
import Link from "next/link";
import { domine } from "../fonts";
import Breadcrumbs from "@/components/Breadcrumbs";
import TickerSearch from "@/components/earnings/TickerSearch";
import { getUpcomingEvents, type UpcomingRow } from "@/lib/earnings/queries";
import { todayET } from "@/lib/earnings/ingest";
import {
  addDaysISO,
  displayName,
  formatLongDate,
  formatMediumDate,
  parseISODate,
  timeOfDayLabel,
} from "@/lib/earnings/format";
import { countTradingDaysBetween, getDayInfo } from "@/lib/tradingDays";

export const revalidate = 3600;

const title = "Earnings Calendar with Trading-Day Countdowns";
const description =
  "Upcoming U.S. earnings dates for NYSE and Nasdaq companies over the next 30 days, estimated from SEC filings, with a countdown in trading days to each report.";

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

const DAYS_AHEAD = 30;
const EXPANDED_DAYS = 7; // days beyond this are collapsed but still rendered

/** Monday-start week key for a date */
function weekStart(iso: string): string {
  const d = parseISODate(iso);
  const offset = (d.getDay() + 6) % 7;
  return addDaysISO(iso, -offset);
}

function groupByWeekAndDay(rows: UpcomingRow[]): Map<string, Map<string, UpcomingRow[]>> {
  const weeks = new Map<string, Map<string, UpcomingRow[]>>();
  for (const r of rows) {
    const wk = weekStart(r.eventDate);
    if (!weeks.has(wk)) weeks.set(wk, new Map());
    const days = weeks.get(wk)!;
    if (!days.has(r.eventDate)) days.set(r.eventDate, []);
    days.get(r.eventDate)!.push(r);
  }
  return weeks;
}

function Badge({ r }: { r: UpcomingRow }) {
  const cls =
    r.status === "confirmed"
      ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200"
      : r.confidence === "low"
      ? "border-slate-600 bg-slate-700/30 text-slate-400"
      : "border-amber-400/40 bg-amber-400/10 text-amber-200";
  return (
    <span className={`rounded-full border px-2 py-0.5 font-semibold ${cls}`}>
      {r.status === "confirmed" ? "Confirmed" : r.confidence === "low" ? "Window" : "Est."}
    </span>
  );
}

function CompanyRow({ r }: { r: UpcomingRow }) {
  return (
    <li>
      <Link
        href={`/earnings/${r.ticker.toLowerCase()}`}
        className="flex items-center justify-between gap-3 px-4 py-2 hover:bg-slate-900/70 transition-colors"
      >
        <span className="min-w-0 flex items-baseline gap-2">
          <span className="text-sm font-semibold text-slate-100 whitespace-nowrap">{r.ticker}</span>
          <span className="text-xs text-slate-400 truncate">{displayName(r.name)}</span>
        </span>
        <span className="flex items-center gap-2 shrink-0 text-[10px] uppercase tracking-wide">
          <span className="text-slate-500 hidden sm:inline">{timeOfDayLabel(r.timeOfDay)}</span>
          <Badge r={r} />
        </span>
      </Link>
    </li>
  );
}

export default async function EarningsCalendarPage() {
  const today = todayET();
  const end = addDaysISO(today, DAYS_AHEAD);

  // Degrade to an empty calendar rather than failing the build or the page
  // if the database is unreachable; ISR retries within the hour.
  let rows: UpcomingRow[] = [];
  let unavailable = false;
  try {
    rows = await getUpcomingEvents(today, end, 3000);
  } catch (err) {
    console.error("[earnings calendar] database unavailable:", (err as Error).message);
    unavailable = true;
  }

  // Overdue estimates (usual date passed, nothing filed) are listed apart —
  // they are not predictions that the company reports today.
  const overdue = rows.filter((r) => r.overdue);
  const scheduled = rows.filter((r) => !r.overdue);
  const weeks = groupByWeekAndDay(scheduled);
  const expandUntil = addDaysISO(today, EXPANDED_DAYS);

  return (
    <main className="flex-1 flex items-start justify-center px-4">
      <div className="max-w-xl w-full flex flex-col gap-8 py-12">
        <Breadcrumbs crumbs={[{ label: "Home", href: "/" }, { label: "Earnings" }]} />

        <header className="space-y-2">
          <h1 className={`${domine.className} text-3xl sm:text-4xl font-semibold tracking-tight text-balance`}>
            Earnings Calendar
          </h1>
          <p className="text-sm text-slate-400 leading-relaxed">
            When U.S. companies report earnings over the next 30 days, with a countdown in trading days to each
            date. Dates are estimated from each company&apos;s SEC filing history and upgraded to confirmed when
            the company announces. Look up any NYSE or Nasdaq ticker.
          </p>
        </header>

        <TickerSearch />

        <section className="space-y-5">
          <div className="flex items-baseline justify-between">
            <h2 className={`${domine.className} text-lg font-semibold text-slate-100`}>Next 30 days</h2>
            <span className="text-xs text-slate-500">{scheduled.length} companies</span>
          </div>

          {weeks.size === 0 ? (
            <p className="text-sm text-slate-500">
              {unavailable
                ? "The earnings calendar is temporarily unavailable. Please check back shortly."
                : "No earnings dates in the next 30 days yet."}
            </p>
          ) : (
            [...weeks.entries()].map(([wk, days]) => {
              const weekTotal = [...days.values()].reduce((n, items) => n + items.length, 0);
              return (
                <div key={wk} className="space-y-2">
                  <div className="flex items-baseline justify-between border-b border-slate-800 pb-1">
                    <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">
                      Week of {formatMediumDate(wk)}
                    </h3>
                    <span className="text-[11px] text-slate-600">{weekTotal}</span>
                  </div>

                  {[...days.entries()].map(([date, items]) => {
                    const info = getDayInfo(parseISODate(date));
                    const { tradingDays } = countTradingDaysBetween(parseISODate(today), parseISODate(date));
                    const distance =
                      date === today
                        ? "Today"
                        : `${tradingDays % 1 === 0 ? tradingDays : tradingDays.toFixed(1)} trading days away`;
                    const open = date <= expandUntil;
                    return (
                      <details key={date} open={open} className="group rounded-xl border border-slate-800 bg-slate-900/40">
                        <summary className="cursor-pointer list-none flex items-baseline justify-between px-4 py-2.5 group-open:border-b group-open:border-slate-800">
                          <div>
                            <p className="text-sm font-medium text-slate-100">{formatLongDate(date)}</p>
                            <p className="text-[11px] text-slate-500">
                              {distance}
                              {info.isEarlyClose ? " · early close" : ""}
                            </p>
                          </div>
                          <span className="text-xs text-slate-500">
                            {items.length}
                            <span className="ml-1.5 inline-block text-slate-600 transition-transform group-open:rotate-90">›</span>
                          </span>
                        </summary>
                        <ul className="divide-y divide-slate-800">
                          {items.map((r) => (
                            <CompanyRow key={r.id} r={r} />
                          ))}
                        </ul>
                      </details>
                    );
                  })}
                </div>
              );
            })
          )}
        </section>

        {overdue.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-baseline justify-between">
              <h2 className={`${domine.className} text-lg font-semibold text-slate-100`}>
                Past their usual date, not yet reported
              </h2>
              <span className="text-xs text-slate-500">{overdue.length} companies</span>
            </div>
            <p className="text-sm text-slate-400 leading-relaxed">
              These companies normally would have reported by now based on their past pattern, but no earnings
              release has been filed yet. Expect them any day; the exact date is unknown.
            </p>
            <ul className="rounded-xl border border-slate-800 bg-slate-900/40 divide-y divide-slate-800">
              {overdue.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/earnings/${r.ticker.toLowerCase()}`}
                    className="flex items-center justify-between gap-3 px-4 py-2 hover:bg-slate-900/70 transition-colors"
                  >
                    <span className="min-w-0 flex items-baseline gap-2">
                      <span className="text-sm font-semibold text-slate-100 whitespace-nowrap">{r.ticker}</span>
                      <span className="text-xs text-slate-400 truncate">{displayName(r.name)}</span>
                    </span>
                    <span className="shrink-0 text-[11px] text-slate-500 whitespace-nowrap">
                      {r.originalEstimate ? `usually by ${formatMediumDate(r.originalEstimate)}` : "overdue"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="border-t border-slate-800 pt-6 space-y-3">
          <h2 className={`${domine.className} text-lg font-semibold text-slate-100`}>How these dates are estimated</h2>
          <p className="text-sm text-slate-400 leading-relaxed">
            Every company on this calendar files its earnings releases with the SEC on Form 8-K. We read that
            history — how many days after each fiscal quarter ended the company reported, on which weekday, and
            at what time of day — and project the pattern onto the current quarter, using the same fiscal
            quarter in prior years. Each ticker page shows the past dates the estimate is based on and how
            reliable that company&apos;s pattern has been. &ldquo;Window&rdquo; marks companies whose pattern is
            too irregular for a single date.
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
