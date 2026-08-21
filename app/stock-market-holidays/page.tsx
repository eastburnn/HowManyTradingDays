import type { Metadata } from "next";
import Link from "next/link";
import { domine } from "../fonts";
import Breadcrumbs from "@/components/Breadcrumbs";
import { getUsStockMarketHolidays, toISODate } from "@/lib/tradingDays";
import { HOLIDAY_PAGES, slugForHolidayName } from "@/lib/holidayPages";

// Re-render at most once a day so the year rolls over automatically
export const revalidate = 86400;

function getCurrentYearET(): number {
  const yearStr = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
  }).format(new Date());
  return Number(yearStr);
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function generateMetadata(): Metadata {
  const year = getCurrentYearET();
  const closures = getUsStockMarketHolidays(year).filter((h) => h.type === "closed").length;

  const title = `Stock Market Holidays ${year}: NYSE & Nasdaq Schedule`;
  const description = `All ${closures} stock market holidays in ${year}, plus early-close days. Full NYSE and Nasdaq closure schedule for ${year} and ${year + 1}, with observed dates.`;

  return {
    title,
    description,
    alternates: { canonical: "/stock-market-holidays" },
    openGraph: {
      title,
      description,
      url: "https://howmanytradingdays.com/stock-market-holidays",
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

function HolidayTable({ year }: { year: number }) {
  const holidays = [...getUsStockMarketHolidays(year)].sort((a, b) =>
    toISODate(a.date) < toISODate(b.date) ? -1 : 1
  );

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-900/70 text-left text-xs uppercase tracking-wide text-slate-400">
            <th className="px-4 py-3 font-medium">Holiday</th>
            <th className="px-4 py-3 font-medium">Date ({year})</th>
            <th className="px-4 py-3 font-medium text-right">Status</th>
          </tr>
        </thead>
        <tbody>
          {holidays.map((h) => {
            const slug = slugForHolidayName(h.name);
            const displayName = h.name.replace(" (early close)", "");
            return (
            <tr key={toISODate(h.date) + h.name} className="border-t border-slate-800 bg-slate-900/30">
              <td className="px-4 py-2.5 text-slate-200">
                {slug ? (
                  <Link
                    href={`/is-the-stock-market-open/${slug}`}
                    className="hover:text-slate-100 hover:underline decoration-slate-600 underline-offset-2 transition-colors"
                  >
                    {displayName}
                  </Link>
                ) : (
                  displayName
                )}
              </td>
              <td className="px-4 py-2.5 text-slate-400 whitespace-nowrap">{formatDate(h.date)}</td>
              <td className="px-4 py-2.5 text-right">
                {h.type === "closed" ? (
                  <span className="inline-flex items-center rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-300 whitespace-nowrap">
                    Closed
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200 whitespace-nowrap">
                    1 p.m. close
                  </span>
                )}
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function StockMarketHolidaysPage() {
  const year = getCurrentYearET();
  const closures = getUsStockMarketHolidays(year).filter((h) => h.type === "closed");
  const halfDays = getUsStockMarketHolidays(year).filter((h) => h.type === "half-day");

  return (
    <main className="flex-1 flex items-start justify-center px-4">
      <div className="max-w-xl w-full flex flex-col gap-8 py-12">
        <Breadcrumbs
          crumbs={[{ label: "Home", href: "/" }, { label: "Stock Market Holidays" }]}
        />

        <header className="space-y-2">
          <h1 className={`${domine.className} text-3xl sm:text-4xl font-semibold tracking-tight`}>
            Stock Market Holidays <span className="whitespace-nowrap">{year}</span>
          </h1>
          <p className="text-sm text-slate-400 leading-relaxed">
            The NYSE and Nasdaq observe <span className="font-semibold text-slate-200">{closures.length} full market holidays</span> in {year},
            plus {halfDays.length} early-close session{halfDays.length === 1 ? "" : "s"} ending at 1:00 p.m. ET.
          </p>
        </header>

        {/* CURRENT YEAR TABLE */}
        <section className="space-y-3">
          <h2 className={`${domine.className} text-lg font-semibold text-slate-100`}>
            {year} holiday schedule
          </h2>
          <HolidayTable year={year} />
        </section>

        {/* NEXT YEAR TABLE */}
        <section className="space-y-3">
          <h2 className={`${domine.className} text-lg font-semibold text-slate-100`}>
            {year + 1} holiday schedule
          </h2>
          <HolidayTable year={year + 1} />
        </section>

        {/* OBSERVED RULES */}
        <section className="border-t border-slate-800 pt-6 space-y-3">
          <h2 className={`${domine.className} text-lg font-semibold text-slate-100`}>
            How weekend holidays are handled
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed">
            When a fixed-date holiday falls on a Saturday, the market closes the Friday before;
            when it falls on a Sunday, the market closes the following Monday. The one exception
            is New Year&apos;s Day on a Saturday — no substitute day is observed, and trading
            simply resumes Monday.
          </p>
          <p className="text-sm text-slate-400 leading-relaxed">
            Early-close sessions (1:00 p.m. ET) typically occur on July 3, the day after
            Thanksgiving, and Christmas Eve — but only when those dates land on a weekday.
          </p>
        </section>

        {/* PER-HOLIDAY PAGES */}
        <section className="border-t border-slate-800 pt-6 space-y-3">
          <h2 className={`${domine.className} text-lg font-semibold text-slate-100`}>
            Is the market open on…
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {HOLIDAY_PAGES.map((h) => (
              <Link
                key={h.slug}
                href={`/is-the-stock-market-open/${h.slug}`}
                className="group flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 hover:border-slate-700 hover:bg-slate-900/70 transition-all duration-150"
              >
                <span className="text-xs font-medium text-slate-200 truncate">{h.name}</span>
                <span
                  className={`ml-2 flex-shrink-0 text-[9px] font-semibold uppercase tracking-wide ${
                    h.shortAnswer === "closed"
                      ? "text-red-300"
                      : h.shortAnswer === "early-close"
                      ? "text-amber-200"
                      : "text-emerald-300"
                  }`}
                >
                  {h.shortAnswer === "closed" ? "Closed" : h.shortAnswer === "early-close" ? "1 p.m." : "Open"}
                </span>
              </Link>
            ))}
          </div>
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
        </div>
      </div>
    </main>
  );
}
