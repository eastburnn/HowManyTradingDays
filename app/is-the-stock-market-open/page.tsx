import type { Metadata } from "next";
import Link from "next/link";
import { domine } from "../fonts";
import Breadcrumbs from "@/components/Breadcrumbs";
import MarketStatusCard from "@/components/MarketStatusCard";
import { HOLIDAY_PAGES } from "@/lib/holidayPages";

export const revalidate = 86400;

const title = "Is the Stock Market Open Today?";
const description =
  "Live U.S. stock market status — see whether the NYSE and Nasdaq are open right now, today's closing time, and the full holiday schedule.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/is-the-stock-market-open" },
  openGraph: {
    title,
    description,
    url: "https://howmanytradingdays.com/is-the-stock-market-open",
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

export default function IsMarketOpenPage() {
  return (
    <main className="flex-1 flex items-start justify-center px-4">
      <div className="max-w-xl w-full flex flex-col gap-8 py-12">
        <Breadcrumbs
          crumbs={[{ label: "Home", href: "/" }, { label: "Is the Market Open?" }]}
        />

        <header className="space-y-2">
          <h1 className={`${domine.className} text-3xl sm:text-4xl font-semibold tracking-tight`}>
            Is the Stock Market <span className="whitespace-nowrap">Open Today?</span>
          </h1>
          <p className="text-sm text-slate-400 leading-relaxed">
            Live status for U.S. equity markets (NYSE and Nasdaq), based on regular trading
            hours and the official holiday calendar.
          </p>
        </header>

        {/* LIVE STATUS */}
        <MarketStatusCard linkToHub={false} />

        {/* MARKET HOURS */}
        <section className="space-y-3">
          <h2 className={`${domine.className} text-lg font-semibold text-slate-100`}>
            Regular market hours
          </h2>
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-b border-slate-800 bg-slate-900/30">
                  <td className="px-4 py-2.5 text-slate-200">Regular session</td>
                  <td className="px-4 py-2.5 text-right text-slate-400 whitespace-nowrap">9:30 a.m. – 4:00 p.m. ET</td>
                </tr>
                <tr className="border-b border-slate-800 bg-slate-900/30">
                  <td className="px-4 py-2.5 text-slate-200">Early-close sessions</td>
                  <td className="px-4 py-2.5 text-right text-slate-400 whitespace-nowrap">9:30 a.m. – 1:00 p.m. ET</td>
                </tr>
                <tr className="border-b border-slate-800 bg-slate-900/30">
                  <td className="px-4 py-2.5 text-slate-200">Pre-market</td>
                  <td className="px-4 py-2.5 text-right text-slate-400 whitespace-nowrap">4:00 a.m. – 9:30 a.m. ET</td>
                </tr>
                <tr className="bg-slate-900/30">
                  <td className="px-4 py-2.5 text-slate-200">After-hours</td>
                  <td className="px-4 py-2.5 text-right text-slate-400 whitespace-nowrap">4:00 p.m. – 8:00 p.m. ET</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            The status above reflects the regular session only. Pre-market and after-hours
            trading is available through most brokers but with lower liquidity.
          </p>
        </section>

        {/* HOW THE CALENDAR WORKS */}
        <section className="border-t border-slate-800 pt-6 space-y-3">
          <h2 className={`${domine.className} text-lg font-semibold text-slate-100`}>
            When is the market closed?
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed">
            U.S. stock markets are open Monday through Friday, except for ten scheduled
            holidays each year — New Year&apos;s Day, Martin Luther King Jr. Day,
            Presidents&apos; Day, Good Friday, Memorial Day, Juneteenth, Independence Day,
            Labor Day, Thanksgiving, and Christmas. When one of these falls on a weekend,
            the closure moves to the nearest weekday (Friday before a Saturday holiday,
            Monday after a Sunday one).
          </p>
          <p className="text-sm text-slate-400 leading-relaxed">
            A few sessions each year also end early at 1:00 p.m. ET instead of 4:00 p.m. —
            typically the day after Thanksgiving, Christmas Eve, and July 3 when they land on
            weekdays. Note that the stock market&apos;s schedule differs from the bank
            calendar: on federal holidays like{" "}
            <Link href="/is-the-stock-market-open/veterans-day" className="text-blue-300 hover:text-blue-200 transition-colors">Veterans Day</Link>{" "}
            and{" "}
            <Link href="/is-the-stock-market-open/columbus-day" className="text-blue-300 hover:text-blue-200 transition-colors">Columbus Day</Link>,
            banks close but stocks trade normally. See the{" "}
            <Link href="/stock-market-holidays" className="text-blue-300 hover:text-blue-200 transition-colors">full holiday schedule</Link>{" "}
            for exact dates.
          </p>
        </section>

        {/* PER-HOLIDAY ANSWERS */}
        <section className="border-t border-slate-800 pt-6 space-y-3">
          <h2 className={`${domine.className} text-lg font-semibold text-slate-100`}>
            Is the market open on…
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {HOLIDAY_PAGES.map((h) => (
              <Link
                key={h.slug}
                href={`/is-the-stock-market-open/${h.slug}`}
                className="group flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5 hover:border-slate-700 hover:bg-slate-900/70 transition-all duration-150"
              >
                <span className="text-xs font-medium text-slate-200">{h.name}</span>
                <span
                  className={`ml-2 flex-shrink-0 inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
                    h.shortAnswer === "closed"
                      ? "border-red-500/40 bg-red-500/10 text-red-300"
                      : h.shortAnswer === "early-close"
                      ? "border-amber-400/40 bg-amber-400/10 text-amber-200"
                      : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  }`}
                >
                  {h.shortAnswer === "closed" ? "Closed" : h.shortAnswer === "early-close" ? "1 p.m. close" : "Open"}
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* CTA LINKS */}
        <div className="grid grid-cols-2 gap-3 border-t border-slate-800 pt-6">
          <Link
            href="/stock-market-holidays"
            className="group flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3 hover:border-slate-700 hover:bg-slate-900/70 transition-all duration-150"
          >
            <div className="flex items-center gap-2.5">
              <svg className="w-4 h-4 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="text-sm font-medium text-slate-100">Holiday Schedule</span>
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
