import type { Metadata } from "next";
import Link from "next/link";
import { domine } from "../fonts";
import Breadcrumbs from "@/components/Breadcrumbs";
import { getYearStats, UNSCHEDULED_CLOSURES } from "@/lib/tradingDays";

// Re-render at most once a day so the current-year highlight stays fresh
export const revalidate = 86400;

const START_YEAR = 1990;
const END_YEAR = 2030;

function getCurrentYearET(): number {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
    }).format(new Date())
  );
}

export function generateMetadata(): Metadata {
  const year = getCurrentYearET();
  const title = `Trading Days per Year: ${START_YEAR}–${END_YEAR}`;
  const description = `The exact number of U.S. stock market trading days for every year from ${START_YEAR} to ${END_YEAR} — adjusted for unscheduled closures like 9/11 and Hurricane Sandy. ${year} has ${getYearStats(year).sessions}.`;

  return {
    title,
    description,
    alternates: { canonical: "/trading-days-by-year" },
    openGraph: {
      title,
      description,
      url: "https://howmanytradingdays.com/trading-days-by-year",
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

function formatClosureDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function TradingDaysByYearPage() {
  const currentYear = getCurrentYearET();
  const years = [];
  for (let y = END_YEAR; y >= START_YEAR; y--) years.push(getYearStats(y));

  const min = Math.min(...years.map((y) => y.sessions));
  const max = Math.max(...years.map((y) => y.sessions));

  // Group the unscheduled closures by event for the notable-closures section
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
          crumbs={[{ label: "Home", href: "/" }, { label: "Trading Days by Year" }]}
        />

        <header className="space-y-2">
          <h1 className={`${domine.className} text-3xl sm:text-4xl font-semibold tracking-tight`}>
            Trading Days per Year, <span className="whitespace-nowrap">{START_YEAR}–{END_YEAR}</span>
          </h1>
          <p className="text-sm text-slate-400 leading-relaxed">
            The exact number of U.S. stock market trading days for every year since {START_YEAR} —
            including unscheduled closures such as September 11 and Hurricane Sandy, which most
            published counts miss. Totals range from{" "}
            <span className="font-semibold text-slate-200">{min}</span> to{" "}
            <span className="font-semibold text-slate-200">{max}</span> sessions.
          </p>
        </header>

        {/* FULL TABLE */}
        <section className="space-y-3">
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-900/70 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-3 font-medium">Year</th>
                  <th className="px-4 py-3 font-medium text-right">Weekdays</th>
                  <th className="px-4 py-3 font-medium text-right">Holidays</th>
                  <th className="px-4 py-3 font-medium text-right">Unscheduled</th>
                  <th className="px-4 py-3 font-medium text-right">Trading days</th>
                </tr>
              </thead>
              <tbody>
                {years.map((y) => (
                  <tr
                    key={y.year}
                    className={`border-t border-slate-800 ${
                      y.year === currentYear ? "bg-blue-500/10" : "bg-slate-900/30"
                    }`}
                  >
                    <td className={`px-4 py-2 tabular-nums ${y.year === currentYear ? "font-semibold text-blue-200" : "text-slate-200"}`}>
                      {y.year}
                      {y.year > currentYear && <span className="text-slate-500 text-xs"> *</span>}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-400">{y.weekdays}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-400">{y.closedHolidays}</td>
                    <td className={`px-4 py-2 text-right tabular-nums ${y.unscheduledClosures > 0 ? "text-amber-300 font-medium" : "text-slate-600"}`}>
                      {y.unscheduledClosures > 0 ? y.unscheduledClosures : "—"}
                    </td>
                    <td className={`px-4 py-2 text-right tabular-nums font-semibold ${y.year === currentYear ? "text-blue-200" : "text-slate-100"}`}>
                      {y.sessions}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Early-close sessions (1 p.m. ET) are counted as full trading days, per the standard
            convention. * Future years show the scheduled calendar; any unscheduled closures
            would reduce those totals.
          </p>
        </section>

        {/* NOTABLE CLOSURES */}
        <section className="border-t border-slate-800 pt-6 space-y-3">
          <h2 className={`${domine.className} text-lg font-semibold text-slate-100`}>
            Unscheduled market closures since {START_YEAR}
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed">
            Beyond the scheduled holiday calendar, U.S. markets have closed{" "}
            {UNSCHEDULED_CLOSURES.length} times since {START_YEAR} for national days of mourning
            and emergencies. These closures are reflected in the totals above.
          </p>
          <ul className="space-y-2 text-sm">
            {closureEvents.map((e) => (
              <li
                key={e.reason + e.dates[0]}
                className="flex items-start justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2"
              >
                <span className="font-medium text-slate-100">{e.reason}</span>
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

        {/* METHODOLOGY */}
        <section className="border-t border-slate-800 pt-6 space-y-3">
          <h2 className={`${domine.className} text-lg font-semibold text-slate-100`}>
            How these counts are computed
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed">
            Each year&apos;s total starts from its weekdays, subtracts the NYSE/Nasdaq holidays in
            force that year, then subtracts any unscheduled closures. The holiday calendar itself
            has changed over time, and these counts reflect that: Martin Luther King Jr. Day has
            been observed only since 1998, and Juneteenth only since 2022 — so earlier years
            correctly show fewer scheduled holidays, not a projection of today&apos;s calendar
            backward.
          </p>
          <p className="text-sm text-slate-400 leading-relaxed">
            The typical year has 250–253 trading days. The low outlier is 2001, where the
            four-day closure after September 11 brought the year down to 248 sessions.
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
              <span className="text-sm font-medium text-slate-100">This Year in Detail</span>
            </div>
            <svg className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-400 transition-colors" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </Link>

          <Link
            href="/"
            className="group flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3 hover:border-slate-700 hover:bg-slate-900/70 transition-all duration-150"
          >
            <div className="flex items-center gap-2.5">
              <svg className="w-4 h-4 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2" />
              </svg>
              <span className="text-sm font-medium text-slate-100">Live Counter</span>
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
