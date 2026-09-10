import type { Metadata } from "next";
import Link from "next/link";
import { domine } from "../fonts";
import Breadcrumbs from "@/components/Breadcrumbs";
import ScrollHintTable from "@/components/ScrollHintTable";
import { getYearStats, getMonthlyStats, UNSCHEDULED_CLOSURES } from "@/lib/tradingDays";

// Re-render at most once a day so the year and tables stay current
export const revalidate = 86400;

const START_YEAR = 1990;
const END_YEAR = 2030;

function getCurrentYearET(): number {
  const yearStr = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
  }).format(new Date());
  return Number(yearStr);
}

export function generateMetadata(): Metadata {
  const year = getCurrentYearET();
  const stats = getYearStats(year);

  const title = `How Many Trading Days in a Year? (${year} Answer)`;
  const description = `There are ${stats.sessions} trading days in ${year}. See the count for every month of ${year} and every year from ${START_YEAR} to ${END_YEAR}, adjusted for unscheduled closures.`;

  return {
    title,
    description,

    alternates: {
      canonical: "/trading-days-in-a-year",
    },

    openGraph: {
      title,
      description,
      url: "https://howmanytradingdays.com/trading-days-in-a-year",
      siteName: "How Many Trading Days",
      images: [
        {
          url: "/og-image.png",
          width: 1200,
          height: 630,
          alt: "How Many Trading Days — U.S. stock market trading days left this year",
        },
      ],
      type: "website",
    },

    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/og-image.png"],
    },
  };
}

function formatClosureDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function TradingDaysInAYearPage() {
  const year = getCurrentYearET();
  const years = [];
  for (let y = END_YEAR; y >= START_YEAR; y--) years.push(getYearStats(y));
  const current = years.find((y) => y.year === year)!;
  const months = getMonthlyStats(year);

  const min = Math.min(...years.map((y) => y.sessions));
  const max = Math.max(...years.map((y) => y.sessions));

  // Group the unscheduled closures by event for the closures section
  const closureEvents: { reason: string; dates: string[] }[] = [];
  for (const c of UNSCHEDULED_CLOSURES) {
    const existing = closureEvents.find((e) => e.reason === c.reason);
    if (existing) existing.dates.push(c.dateISO);
    else closureEvents.push({ reason: c.reason, dates: [c.dateISO] });
  }
  closureEvents.sort((a, b) => (a.dates[0] < b.dates[0] ? 1 : -1));

  return (
    <main className="flex-1 flex items-start justify-center px-4">
      <div className="max-w-xl w-full flex flex-col gap-8 py-12">
        <Breadcrumbs
          crumbs={[{ label: "Home", href: "/" }, { label: "Trading Days in a Year" }]}
        />

        {/* HEADER + DIRECT ANSWER */}
        <header className="space-y-2">
          <h1 className={`${domine.className} text-3xl sm:text-4xl font-semibold tracking-tight`}>
            How Many Trading Days <span className="whitespace-nowrap">in a Year?</span>
          </h1>
          <p className="text-sm text-slate-400 leading-relaxed">
            There are usually about <span className="font-semibold text-slate-200">252</span> trading
            days in a year for the U.S. stock market — the exact number varies with how weekends
            and holidays fall. Below: this year&apos;s total, every month of {year}, and every
            year back to {START_YEAR}.
          </p>
        </header>

        {/* ANSWER CARD */}
        <section className="w-full rounded-2xl border border-slate-800 bg-slate-900/70 shadow-xl p-8 flex flex-col items-center gap-3">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
            Trading Days in {year}
          </p>
          <span className="text-6xl sm:text-7xl font-semibold tabular-nums">
            {current.sessions}
          </span>
          <div className="flex gap-4 text-xs text-slate-400 mt-1">
            <div className="flex flex-col items-center">
              <span className="text-sm font-semibold text-slate-100 tabular-nums">
                {current.weekdays}
              </span>
              <span>weekdays</span>
            </div>
            <div className="h-8 w-px bg-slate-800" />
            <div className="flex flex-col items-center">
              <span className="text-sm font-semibold text-slate-100 tabular-nums">
                {current.closedHolidays}
              </span>
              <span>market holidays</span>
            </div>
            <div className="h-8 w-px bg-slate-800" />
            <div className="flex flex-col items-center">
              <span className="text-sm font-semibold text-slate-100 tabular-nums">
                {current.halfDaySessions}
              </span>
              <span>early closes</span>
            </div>
          </div>
        </section>

        {/* BY-MONTH TABLE */}
        <section id="months" className="space-y-3 scroll-mt-20">
          <h2 className={`${domine.className} text-lg font-semibold text-slate-100`}>
            Trading days per month in {year}
          </h2>
          <ScrollHintTable>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-900/70 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-3 font-medium">Month</th>
                  <th className="px-4 py-3 font-medium text-center">Trading days</th>
                  <th className="px-4 py-3 font-medium">Market holidays</th>
                </tr>
              </thead>
              <tbody>
                {months.map((m) => (
                  <tr key={m.monthIndex} className="border-t border-slate-800 bg-slate-900/30">
                    <td className="px-4 py-2.5 text-slate-200">{m.monthName}</td>
                    <td className="px-4 py-2.5 text-center tabular-nums font-semibold text-slate-100">
                      {m.sessions}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-400">
                      {m.holidayNames.length > 0 ? m.holidayNames.join(", ") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollHintTable>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Months average about 21 trading days. February is usually the shortest; months with no
            holidays and five full weeks reach 22–23.
          </p>
        </section>

        {/* BY-YEAR TABLE (1990–2030) */}
        <section id="by-year" className="space-y-3 scroll-mt-20">
          <h2 className={`${domine.className} text-lg font-semibold text-slate-100`}>
            Trading days per year, {START_YEAR}–{END_YEAR}
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed">
            Exact totals for every year — including unscheduled closures such as September 11 and
            Hurricane Sandy, which most published counts miss. Totals range from{" "}
            <span className="font-semibold text-slate-200">{min}</span> to{" "}
            <span className="font-semibold text-slate-200">{max}</span> sessions.
          </p>
          <ScrollHintTable>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-900/70 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-3 font-medium text-center">Year</th>
                  <th className="px-4 py-3 font-medium text-center">Weekdays</th>
                  <th className="px-4 py-3 font-medium text-center">Holidays</th>
                  <th className="px-4 py-3 font-medium text-center">Unscheduled</th>
                  <th className="px-4 py-3 font-medium text-center">Trading days</th>
                </tr>
              </thead>
              <tbody>
                {years.map((y) => (
                  <tr
                    key={y.year}
                    className={`border-t border-slate-800 ${
                      y.year === year ? "bg-blue-500/10" : "bg-slate-900/30"
                    }`}
                  >
                    <td className={`px-4 py-2 text-center tabular-nums whitespace-nowrap ${y.year === year ? "font-semibold text-blue-200" : "text-slate-200"}`}>
                      {y.year}
                      {y.year > year && <span className="text-slate-500 text-xs"> *</span>}
                    </td>
                    <td className="px-4 py-2 text-center tabular-nums text-slate-400">{y.weekdays}</td>
                    <td className="px-4 py-2 text-center tabular-nums text-slate-400">{y.closedHolidays}</td>
                    <td className={`px-4 py-2 text-center tabular-nums whitespace-nowrap ${y.unscheduledClosures > 0 ? "text-amber-300 font-medium" : "text-slate-600"}`}>
                      {y.unscheduledClosures > 0 ? y.unscheduledClosures : "—"}
                    </td>
                    <td className={`px-4 py-2 text-center tabular-nums font-semibold ${y.year === year ? "text-blue-200" : "text-slate-100"}`}>
                      {y.sessions}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollHintTable>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Early-close sessions (1 p.m. ET) are counted as full trading days, per the standard
            convention. Counting them as half days instead, {year} has {current.halfDayAdjusted % 1 === 0 ? current.halfDayAdjusted : current.halfDayAdjusted.toFixed(1)} trading
            days — the convention used by our{" "}
            <Link href="/" className="underline text-slate-400 hover:text-slate-200 transition-colors">
              live countdown
            </Link>
            . * Future years show the scheduled calendar; any unscheduled closures would reduce
            those totals.
          </p>
        </section>

        {/* UNSCHEDULED CLOSURES */}
        <section id="closures" className="border-t border-slate-800 pt-6 space-y-3 scroll-mt-20">
          <h2 className={`${domine.className} text-lg font-semibold text-slate-100`}>
            Unscheduled market closures since {START_YEAR}
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed">
            Beyond the scheduled holiday calendar, U.S. markets have closed{" "}
            {UNSCHEDULED_CLOSURES.length} times since {START_YEAR} for national days of mourning
            and emergencies — all reflected in the totals above. The low outlier is 2001, where
            the four-day closure after September 11 brought the year down to 248 sessions.
          </p>
          <ul className="space-y-2 text-sm">
            {closureEvents.map((e) => (
              <li
                key={e.reason + e.dates[0]}
                className="flex items-start justify-between gap-6 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2"
              >
                <span className="font-medium text-slate-100 max-w-[50%] sm:max-w-none">{e.reason}</span>
                <span className="text-xs text-slate-400 text-right whitespace-nowrap">
                  {e.dates.length === 1
                    ? formatClosureDate(e.dates[0])
                    : `${formatClosureDate(e.dates[0]).replace(/, \d{4}$/, "")}–${formatClosureDate(e.dates[e.dates.length - 1])}`}
                  {e.dates.length > 1 && (
                    <span className="block text-slate-500">{e.dates.length} sessions lost</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* HOW THE MATH WORKS */}
        <section className="border-t border-slate-800 pt-6 space-y-3">
          <h2 className={`${domine.className} text-lg font-semibold text-slate-100`}>
            How the math works
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed">
            Start with the 365 (or 366) days in a year and remove the roughly 104 weekend days,
            leaving {current.weekdays} weekdays
            in {year}. The NYSE and Nasdaq then observe {current.closedHolidays} full market
            holidays that fall on weekdays, which brings the total to {current.sessions} trading
            days. Holidays that land on a Saturday are observed the Friday before; Sunday holidays
            are observed the following Monday.
          </p>
          <p className="text-sm text-slate-400 leading-relaxed">
            The count shifts slightly year to year because of leap years, holidays falling on
            weekends (and dropping off the schedule), and where January 1 lands in the week. That is
            why the answer ranges from 250 to 253 rather than being a fixed number.
          </p>
          <p className="text-sm text-slate-400 leading-relaxed">
            The historical totals also reflect changes to the holiday calendar itself: Martin
            Luther King Jr. Day has been observed only since 1998, and Juneteenth only since
            2022 — so earlier years correctly show fewer scheduled holidays, not a projection of
            today&apos;s calendar backward.
          </p>
        </section>

        {/* HOLIDAYS + HALF DAYS */}
        <section className="border-t border-slate-800 pt-6 space-y-3">
          <h2 className={`${domine.className} text-lg font-semibold text-slate-100`}>
            Which days are markets closed?
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed">
            U.S. equity markets close for New Year&apos;s Day, Martin Luther King Jr. Day,
            Presidents&apos; Day, Good Friday, Memorial Day, Juneteenth, Independence Day, Labor
            Day, Thanksgiving, and Christmas. In addition, a few sessions close early at 1 p.m. ET —
            typically July 3, the day after Thanksgiving, and Christmas Eve, when they fall on a
            weekday. See the{" "}
            <Link href="/stock-market-holidays" className="text-blue-300 hover:text-blue-200 transition-colors">
              full holiday schedule
            </Link>{" "}
            for exact dates.
          </p>
        </section>

        {/* CTA LINKS */}
        <div className="grid grid-cols-2 gap-3 border-t border-slate-800 pt-6">
          <Link
            href="/"
            className="group flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3 hover:border-slate-700 hover:bg-slate-900/70 transition-all duration-150"
          >
            <div className="flex items-center gap-2.5">
              <svg className="w-4 h-4 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2" />
              </svg>
              <span className="text-sm font-medium text-slate-100">Days Left in {year}</span>
            </div>
            <svg className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-400 transition-colors" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </Link>

          <Link
            href="/calculator"
            className="group flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3 hover:border-slate-700 hover:bg-slate-900/70 transition-all duration-150"
          >
            <div className="flex items-center gap-2.5">
              <svg className="w-4 h-4 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                <rect x="4" y="2" width="16" height="20" rx="2" />
                <line x1="8" y1="7" x2="16" y2="7" />
                <line x1="8" y1="11" x2="16" y2="11" />
                <line x1="8" y1="15" x2="12" y2="15" />
              </svg>
              <span className="text-sm font-medium text-slate-100">Calculator</span>
            </div>
            <svg className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-400 transition-colors" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </div>
    </main>
  );
}
