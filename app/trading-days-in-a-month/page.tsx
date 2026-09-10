import type { Metadata } from "next";
import Link from "next/link";
import { domine } from "../fonts";
import Breadcrumbs from "@/components/Breadcrumbs";
import ScrollHintTable from "@/components/ScrollHintTable";
import { getYearStats, getMonthlyStats } from "@/lib/tradingDays";

// Re-render at most once a day so the year and tables stay current
export const revalidate = 86400;

function getCurrentYearET(): number {
  const yearStr = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
  }).format(new Date());
  return Number(yearStr);
}

export function generateMetadata(): Metadata {
  const year = getCurrentYearET();
  const months = getMonthlyStats(year);
  const min = Math.min(...months.map((m) => m.sessions));
  const max = Math.max(...months.map((m) => m.sessions));

  const title = `How Many Trading Days in a Month? (${year} Table)`;
  const description = `Months average about 21 trading days, ranging from ${min} to ${max}. See the exact count for every month and quarter of ${year}, with the holidays that shorten them.`;

  return {
    title,
    description,
    alternates: { canonical: "/trading-days-in-a-month" },
    openGraph: {
      title,
      description,
      url: "https://howmanytradingdays.com/trading-days-in-a-month",
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
    twitter: { card: "summary_large_image", title, description, images: ["/og-image.png"] },
  };
}

export default function TradingDaysInAMonthPage() {
  const year = getCurrentYearET();
  const stats = getYearStats(year);
  const months = getMonthlyStats(year);

  const avg = stats.sessions / 12;
  const min = Math.min(...months.map((m) => m.sessions));
  const max = Math.max(...months.map((m) => m.sessions));
  const shortest = months.filter((m) => m.sessions === min).map((m) => m.monthName);
  const longest = months.filter((m) => m.sessions === max).map((m) => m.monthName);

  const quarters = [0, 1, 2, 3].map((q) => ({
    label: `Q${q + 1}`,
    months: months.slice(q * 3, q * 3 + 3),
    sessions: months.slice(q * 3, q * 3 + 3).reduce((s, m) => s + m.sessions, 0),
  }));

  return (
    <main className="flex-1 flex items-start justify-center px-4">
      <div className="max-w-xl w-full flex flex-col gap-8 py-12">
        <Breadcrumbs
          crumbs={[{ label: "Home", href: "/" }, { label: "Trading Days in a Month" }]}
        />

        {/* HEADER + DIRECT ANSWER */}
        <header className="space-y-2">
          <h1 className={`${domine.className} text-3xl sm:text-4xl font-semibold tracking-tight`}>
            How Many Trading Days <span className="whitespace-nowrap">in a Month?</span>
          </h1>
          <p className="text-sm text-slate-400 leading-relaxed">
            There are about <span className="font-semibold text-slate-200">21</span> trading days
            in a month on average for U.S. stock markets — anywhere from {min} to {max} depending
            on how weekends and market holidays fall. Below: every month and quarter of {year}.
          </p>
        </header>

        {/* ANSWER CARD */}
        <section className="w-full rounded-2xl border border-slate-800 bg-slate-900/70 shadow-xl p-8 flex flex-col items-center gap-3">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
            Average Trading Days per Month in {year}
          </p>
          <span className="text-6xl sm:text-7xl font-semibold tabular-nums">
            {avg.toFixed(1)}
          </span>
          <div className="flex gap-4 text-xs text-slate-400 mt-1">
            <div className="flex flex-col items-center">
              <span className="text-sm font-semibold text-slate-100 tabular-nums">{min}</span>
              <span>shortest month</span>
            </div>
            <div className="h-8 w-px bg-slate-800" />
            <div className="flex flex-col items-center">
              <span className="text-sm font-semibold text-slate-100 tabular-nums">{max}</span>
              <span>longest month</span>
            </div>
            <div className="h-8 w-px bg-slate-800" />
            <div className="flex flex-col items-center">
              <span className="text-sm font-semibold text-slate-100 tabular-nums">{stats.sessions}</span>
              <span>full year</span>
            </div>
          </div>
        </section>

        {/* BY-MONTH TABLE */}
        <section id="months" className="space-y-3 scroll-mt-20">
          <h2 className={`${domine.className} text-lg font-semibold text-slate-100`}>
            Trading days in each month of {year}
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
            In {year}, the shortest month is {shortest.join(" and ")} ({min} trading days) and the
            longest {longest.length > 1 ? "are" : "is"} {longest.join(", ")} ({max}). Early-close
            sessions count as full trading days here.
          </p>
        </section>

        {/* BY-QUARTER TABLE */}
        <section id="quarters" className="space-y-3 scroll-mt-20">
          <h2 className={`${domine.className} text-lg font-semibold text-slate-100`}>
            Trading days per quarter in {year}
          </h2>
          <ScrollHintTable>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-900/70 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-3 font-medium">Quarter</th>
                  <th className="px-4 py-3 font-medium">Months</th>
                  <th className="px-4 py-3 font-medium text-center">Trading days</th>
                </tr>
              </thead>
              <tbody>
                {quarters.map((q) => (
                  <tr key={q.label} className="border-t border-slate-800 bg-slate-900/30">
                    <td className="px-4 py-2.5 font-semibold text-slate-100">{q.label} {year}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-400">
                      {q.months[0].monthName.slice(0, 3)}–{q.months[2].monthName.slice(0, 3)}
                    </td>
                    <td className="px-4 py-2.5 text-center tabular-nums font-semibold text-slate-100">
                      {q.sessions}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollHintTable>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Quarters average about {Math.round(stats.sessions / 4)} trading days ({stats.sessions} in{" "}
            {year} ÷ 4).
          </p>
        </section>

        {/* HOW THE MATH WORKS */}
        <section className="border-t border-slate-800 pt-6 space-y-3">
          <h2 className={`${domine.className} text-lg font-semibold text-slate-100`}>
            Why about 21?
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed">
            An average month has about 30.4 calendar days, of which roughly 21.7 are weekdays.
            Spread the year&apos;s {stats.closedHolidays} market holidays across 12 months and you
            land at an average just under 21 trading days. Months with no holidays and five full
            trading weeks reach {max}; a short February or a holiday-heavy month like November or
            December can drop to {min}.
          </p>
          <p className="text-sm text-slate-400 leading-relaxed">
            The exact counts change every year as weekends and holidays shift — the table above
            always shows the current year. For yearly totals back to 1990, see{" "}
            <Link href="/trading-days-in-a-year" className="text-blue-300 hover:text-blue-200 transition-colors">
              trading days in a year
            </Link>
            .
          </p>
        </section>

        {/* CTA LINKS */}
        <div className="grid grid-cols-2 gap-3 border-t border-slate-800 pt-6">
          <Link
            href="/trading-days-in-a-year"
            className="group flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3 hover:border-slate-700 hover:bg-slate-900/70 transition-all duration-150"
          >
            <div className="flex items-center gap-2.5">
              <svg className="w-4 h-4 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="text-sm font-medium text-slate-100">Days in a Year</span>
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
