import type { Metadata } from "next";
import Link from "next/link";
import { domine } from "../fonts";
import Breadcrumbs from "@/components/Breadcrumbs";
import { getTrafficSnapshot } from "@/lib/ga4";

// Refresh the GA4 traffic snapshot once a day
export const revalidate = 86400;

const title = "Advertise | How Many Trading Days";
const description =
  "Sponsor HowManyTradingDays.com and reach an audience of U.S. investors and traders.";

export const metadata: Metadata = {
  title,
  description,
  robots: {
    index: false,
    follow: true,
  },
};

const CONTACT_HREF = "/contact?topic=advertising";

// Static fallback shown only if the live GA4 fetch is unavailable.
const FALLBACK_STATS = [
  { value: "2,200+", label: "Monthly visitors" },
  { value: "+16%", label: "Visitor growth last month" },
  { value: "Organic search", label: "Primary traffic source" },
  { value: "Investors & traders", label: "Core audience" },
];

const FALLBACK_AS_OF = "September 2026";

export default async function AdvertisePage() {
  const live = await getTrafficSnapshot();

  const stats = live
    ? [
        { value: live.monthlyVisitors.toLocaleString("en-US"), label: "Monthly visitors" },
        live.growthPct !== null
          ? {
              value: `${live.growthPct >= 0 ? "+" : ""}${live.growthPct}%`,
              label: "Visitor growth, last 30 days",
            }
          : FALLBACK_STATS[1],
        live.organicSharePct !== null
          ? { value: `${live.organicSharePct}%`, label: "Traffic from organic search" }
          : FALLBACK_STATS[2],
        { value: "Investors & traders", label: "Core audience" },
      ]
    : FALLBACK_STATS;

  const sourceNote = live
    ? "Source: Google Analytics 4, trailing 30 days, updated daily. Traffic has grown every month since the site launched, driven almost entirely by organic search."
    : `Source: Google Analytics 4, as of ${FALLBACK_AS_OF}. Traffic has grown every month since the site launched, driven almost entirely by organic search.`;

  return (
    <main className="flex-1 flex items-start justify-center px-4">
      <div className="max-w-xl w-full flex flex-col gap-8 py-12">
        <Breadcrumbs crumbs={[{ label: "Home", href: "/" }, { label: "Advertise" }]} />

        <header className="space-y-2">
          <h1 className={`${domine.className} text-3xl sm:text-4xl font-semibold tracking-tight text-balance`}>
            Advertise Here
          </h1>
          <p className="text-sm text-slate-400 leading-relaxed">
            HowManyTradingDays.com is a live reference for U.S. stock market trading days,
            visited by investors, traders, and finance professionals who plan around the
            market calendar.
          </p>
        </header>

        {/* Traffic snapshot */}
        <section className="space-y-3">
          <h2 className={`${domine.className} text-lg font-semibold text-slate-100`}>
            Traffic snapshot
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {stats.map(({ value, label }) => (
              <div
                key={label}
                className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-4 flex flex-col gap-1"
              >
                <span className="text-lg sm:text-xl font-semibold text-slate-100 leading-tight">
                  {value}
                </span>
                <span className="text-xs text-slate-400 leading-relaxed">{label}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-600">{sourceNote}</p>
        </section>

        {/* What's available */}
        <section className="border-t border-slate-800 pt-6 space-y-3">
          <h2 className={`${domine.className} text-lg font-semibold text-slate-100`}>
            What&apos;s available
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed">
            A single sponsored placement on the homepage, directly below the live trading-day
            counter, the most-viewed spot on the site. One sponsor at a time, clearly
            disclosed, with click tracking available on request. Placements on other
            high-traffic pages can also be arranged.
          </p>
          <p className="text-sm text-slate-400 leading-relaxed">
            A good fit: brokerages, investing research and analytics tools, financial data
            APIs, newsletters, and other products built for people who follow the market.
          </p>
        </section>

        {/* Contact CTA */}
        <section className="border-t border-slate-800 pt-6 space-y-3">
          <h2 className={`${domine.className} text-lg font-semibold text-slate-100`}>
            Get in touch
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed">
            Interested, or want more detailed traffic data? Send a note and I&apos;ll get back
            to you quickly.
          </p>
          <Link
            href={CONTACT_HREF}
            className="group inline-flex items-center gap-2.5 rounded-lg border border-slate-700 bg-slate-800/60 px-5 py-3 text-sm font-medium text-slate-100 hover:border-slate-600 hover:bg-slate-800 transition-all duration-150 active:scale-[0.99]"
          >
            <svg className="w-4 h-4 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            Contact Me
            <svg className="w-3.5 h-3.5 text-slate-500 group-hover:text-slate-300 group-hover:translate-x-0.5 transition-all" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </section>

        <div className="border-t border-slate-800 pt-6">
          <Link href="/" className="text-sm text-blue-300 hover:text-blue-200 transition-colors font-medium">
            ← Back to Home
          </Link>
        </div>
      </div>
    </main>
  );
}
