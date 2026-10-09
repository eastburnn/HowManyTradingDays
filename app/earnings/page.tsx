import type { Metadata } from "next";
import Link from "next/link";
import { domine } from "../fonts";
import Breadcrumbs from "@/components/Breadcrumbs";
import TickerSearch from "@/components/earnings/TickerSearch";
import MonthCalendar from "@/components/earnings/MonthCalendar";
import StatusKey from "@/components/earnings/StatusKey";
import CalendarRange from "@/components/earnings/CalendarRange";
import { type EstimateAccuracy, getEstimateAccuracy, getEventDateBounds, getEventsInRange } from "@/lib/earnings/queries";
import { type RangeRow, computeDistances, monthKey, shiftMonth, toCalendarEvent } from "@/lib/earnings/calendar";
import { todayET } from "@/lib/earnings/ingest";
import { addDaysISO, displayName, formatMediumDate } from "@/lib/earnings/format";

export const revalidate = 3600;

// Search snippet: the year in the title matches how people search ("earnings
// calendar 2026") and rolls over with the hourly regeneration; the description
// stays under 155 characters so Google shows all of it.
const year = new Date().getFullYear();
const title = `Earnings Calendar ${year}: Upcoming Earnings Dates by Day & Month`;
const description =
  "Upcoming earnings dates for every NYSE and Nasdaq stock, by day and month. Confirmed and estimated dates from SEC filings, plus a trading-day countdown.";

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

export default async function EarningsCalendarPage() {
  const today = todayET();
  const end = addDaysISO(today, DAYS_AHEAD);

  // Degrade to an empty calendar rather than failing the build or the page
  // if the database is unreachable; ISR retries within the hour.
  let rows: RangeRow[] = [];
  let bounds: { min: string; max: string } | null = null;
  let accuracy: EstimateAccuracy | null = null;
  let unavailable = false;
  try {
    [rows, bounds, accuracy] = await Promise.all([getEventsInRange(today, end), getEventDateBounds(), getEstimateAccuracy()]);
  } catch (err) {
    console.error("[earnings calendar] database unavailable:", (err as Error).message);
    unavailable = true;
  }

  // Overdue estimates (usual date passed, nothing filed) are listed apart —
  // they are not predictions that the company reports today.
  const overdue = rows.filter((r) => r.overdue);
  const scheduled = rows.filter((r) => !r.overdue && r.status !== "reported").map(toCalendarEvent);
  const distances = computeDistances(scheduled, today);
  const expandUntil = addDaysISO(today, EXPANDED_DAYS);
  const thisMonth = monthKey(today);
  const minMonth = bounds ? monthKey(bounds.min) : shiftMonth(thisMonth, -1);
  const maxMonth = bounds ? monthKey(bounds.max) : shiftMonth(thisMonth, 6);

  return (
    <main className="flex-1 flex items-start justify-center px-4">
      <div className="max-w-xl w-full flex flex-col gap-8 py-12">
        <Breadcrumbs crumbs={[{ label: "Home", href: "/" }, { label: "Earnings" }]} />

        <header className="space-y-2">
          <h1 className={`${domine.className} text-3xl sm:text-4xl font-semibold tracking-tight text-balance`}>
            Earnings Calendar
          </h1>
          {/* Half the length on phones, where the full paragraph pushes the search and calendar below the fold */}
          <p className="text-sm text-slate-400 leading-relaxed">
            <span className="sm:hidden">
              Upcoming earnings dates for every NYSE and Nasdaq company, with a countdown in trading days. Estimated
              from SEC filings and confirmed once announced.
            </span>
            <span className="hidden sm:inline">
              See upcoming earnings dates for every NYSE and Nasdaq company, with a countdown in trading days to
              each report. Dates are estimated from each company&apos;s SEC filing history and upgraded to
              confirmed once the company announces. Browse by month, scan the next 30 days or a full quarter, or
              look up any ticker.
            </span>
          </p>
        </header>

        <TickerSearch />

        <MonthCalendar today={today} minMonth={minMonth} maxMonth={maxMonth} />

        <StatusKey accuracy={accuracy} />

        <CalendarRange
          today={today}
          initialRows={scheduled}
          initialDays={DAYS_AHEAD}
          initialDistances={distances}
          expandUntil={expandUntil}
          maxDate={bounds?.max ?? null}
          unavailable={unavailable}
        />

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
            history (how many days after each fiscal quarter ended the company reported, on which weekday, and
            at what time of day) and project the pattern onto the current quarter, using the same fiscal
            quarter in prior years. Each ticker page shows the past dates the estimate is based on and how
            reliable that company&apos;s pattern has been. &ldquo;Window&rdquo; marks companies whose pattern is
            too irregular for a single date.
          </p>
          <p className="text-sm text-slate-400 leading-relaxed">
            Counts are in U.S. stock market trading days: weekdays excluding NYSE/Nasdaq holidays, with early-close
            sessions counted as half days, the same engine behind the{" "}
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
          company before making decisions. Not investment advice. See the{" "}
          <Link href="/terms" className="underline hover:text-slate-300 transition-colors">
            Terms of Service
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
