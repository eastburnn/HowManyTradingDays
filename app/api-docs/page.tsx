import type { Metadata } from "next";
import Link from "next/link";
import { domine } from "../fonts";
import Breadcrumbs from "@/components/Breadcrumbs";

const title = "Free Trading Days API";
const description =
  "Free JSON API for U.S. stock market trading days: yearly totals, remaining days, the NYSE/Nasdaq holiday calendar, and live market status. No key required.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/api-docs" },
  openGraph: {
    title,
    description,
    url: "https://howmanytradingdays.com/api-docs",
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

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/70 p-4 text-xs leading-relaxed text-slate-300">
      <code>{children}</code>
    </pre>
  );
}

export default function ApiDocsPage() {
  return (
    <main className="flex-1 flex items-start justify-center px-4">
      <div className="max-w-xl w-full flex flex-col gap-8 py-12">
        <Breadcrumbs crumbs={[{ label: "Home", href: "/" }, { label: "API" }]} />

        <header className="space-y-2">
          <h1 className={`${domine.className} text-3xl sm:text-4xl font-semibold tracking-tight`}>
            Free Trading Days API
          </h1>
          <p className="text-sm text-slate-400 leading-relaxed">
            The data behind this site, as JSON. Free to use, no API key, CORS enabled. If you
            use it in something public, a link back to{" "}
            <span className="text-slate-200">howmanytradingdays.com</span> is appreciated.
          </p>
        </header>

        {/* TRADING DAYS ENDPOINT */}
        <section className="space-y-3">
          <h2 className={`${domine.className} text-lg font-semibold text-slate-100`}>
            GET /api/trading-days
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed">
            Trading-day totals, month-by-month counts, and the full holiday calendar for a year.
            Defaults to the current year; pass <code className="text-slate-200 bg-slate-800/80 px-1 py-0.5 rounded">?year=2027</code>{" "}
            for any year from 1950 to 2100. For the current year, <code className="text-slate-200 bg-slate-800/80 px-1 py-0.5 rounded">remaining</code>{" "}
            holds the live days-left count.
          </p>
          <CodeBlock>{`curl https://howmanytradingdays.com/api/trading-days?year=2026`}</CodeBlock>
          <CodeBlock>{`{
  "year": 2026,
  "tradingDays": 251,
  "tradingDaysHalfDayAdjusted": 250,
  "weekdays": 261,
  "marketHolidays": 10,
  "earlyCloseSessions": 2,
  "remaining": { "tradingDays": 91, "fullDays": 90, "halfDays": 2 },
  "months": [ { "month": 1, "name": "January", "tradingDays": 20 }, ... ],
  "holidays": [
    { "date": "2026-01-01", "name": "New Year's Day", "status": "closed" },
    ...
    { "date": "2026-11-27", "name": "Day After Thanksgiving",
      "status": "early-close", "closesAtET": "13:00" }
  ],
  "source": "https://howmanytradingdays.com"
}`}</CodeBlock>
        </section>

        {/* MARKET STATUS ENDPOINT */}
        <section className="space-y-3 border-t border-slate-800 pt-6">
          <h2 className={`${domine.className} text-lg font-semibold text-slate-100`}>
            GET /api/market-status
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed">
            Whether U.S. equity markets are open right now, based on regular session hours
            (9:30 a.m.–4:00 p.m. ET) and the NYSE/Nasdaq holiday calendar.
          </p>
          <CodeBlock>{`curl https://howmanytradingdays.com/api/market-status`}</CodeBlock>
          <CodeBlock>{`{
  "isOpen": true,
  "isTradingDay": true,
  "isEarlyClose": false,
  "closesAtET": "16:00",
  "closedReason": null,
  "nextSessionDate": "2026-08-21",
  "opensAtET": "09:30",
  "timezone": "America/New_York",
  "source": "https://howmanytradingdays.com"
}`}</CodeBlock>
        </section>

        {/* NOTES */}
        <section className="space-y-3 border-t border-slate-800 pt-6">
          <h2 className={`${domine.className} text-lg font-semibold text-slate-100`}>Notes</h2>
          <ul className="text-sm text-slate-400 leading-relaxed list-disc pl-5 space-y-1.5">
            <li>
              <span className="text-slate-200">tradingDays</span> counts early-close sessions as
              full days (the standard ~252 convention);{" "}
              <span className="text-slate-200">tradingDaysHalfDayAdjusted</span> counts them as 0.5.
            </li>
            <li>
              Holidays are computed algorithmically from NYSE/Nasdaq calendar rules — scheduled
              closures only, not unscheduled ones (e.g. days of mourning).
            </li>
            <li>Responses are cached briefly at the edge. No rate limits, no key — please be reasonable.</li>
            <li>Free for personal and commercial use. Attribution with a link is appreciated.</li>
          </ul>
        </section>

        {/* CTA */}
        <div className="border-t border-slate-800 pt-6">
          <Link href="/" className="text-sm text-blue-300 hover:text-blue-200 transition-colors font-medium">
            ← Back to the live counter
          </Link>
        </div>
      </div>
    </main>
  );
}
