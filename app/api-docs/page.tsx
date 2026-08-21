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
    <pre className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/70 p-4 text-xs leading-relaxed text-slate-300">
      <code>{children}</code>
    </pre>
  );
}

function EndpointCard({
  path,
  url,
  description,
  children,
}: {
  path: string;
  url: string;
  description: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/40 shadow-xl overflow-hidden">
      {/* Header */}
      <div className="p-5 sm:p-6 flex flex-col gap-3">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex items-center rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold tracking-wide text-emerald-300">
            GET
          </span>
          <h2 className="font-mono text-sm sm:text-base font-semibold text-slate-100">{path}</h2>
        </div>

        <p className="font-mono text-[11px] text-slate-500 break-all">{url}</p>

        <p className="text-sm text-slate-400 leading-relaxed">{description}</p>
      </div>

      {/* Expandable footer */}
      <details className="group border-t border-slate-800">
        <summary className="flex cursor-pointer list-none items-center justify-between px-5 sm:px-6 py-3 text-xs font-medium uppercase tracking-wide text-slate-400 hover:text-slate-200 hover:bg-slate-900/70 transition-colors">
          Code examples &amp; sample response
          <svg
            className="w-3.5 h-3.5 text-slate-500 transition-transform duration-150 group-open:rotate-180 flex-shrink-0 ml-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </summary>
        <div className="px-5 sm:px-6 pb-5 pt-1 flex flex-col gap-3">{children}</div>
      </details>
    </section>
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
        <EndpointCard
          path="/api/trading-days"
          url="https://howmanytradingdays.com/api/trading-days"
          description={
            <>
              Trading-day totals, month-by-month counts, and the full holiday calendar for a year.
              Defaults to the current year; pass <code className="text-slate-200 bg-slate-800/80 px-1 py-0.5 rounded">?year=2027</code>{" "}
              for any year from 1950 to 2100. For the current year, <code className="text-slate-200 bg-slate-800/80 px-1 py-0.5 rounded">remaining</code>{" "}
              holds the live days-left count.
            </>
          }
        >
            <CodeBlock>{`# curl
curl https://howmanytradingdays.com/api/trading-days?year=2026`}</CodeBlock>
            <CodeBlock>{`// JavaScript (browser or Node — CORS is enabled)
const res = await fetch(
  "https://howmanytradingdays.com/api/trading-days?year=2026"
);
const data = await res.json();

console.log(data.tradingDays);           // 251
console.log(data.remaining.tradingDays); // days left (current year only)
console.log(data.holidays[0]);           // { date, name, status }`}</CodeBlock>
            <CodeBlock>{`# Python
import requests

data = requests.get(
    "https://howmanytradingdays.com/api/trading-days", params={"year": 2026}
).json()
print(data["tradingDays"])  # 251`}</CodeBlock>
            <p className="text-sm text-slate-400 leading-relaxed">Sample response:</p>
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
        </EndpointCard>

        {/* MARKET STATUS ENDPOINT */}
        <EndpointCard
          path="/api/market-status"
          url="https://howmanytradingdays.com/api/market-status"
          description={
            <>
              Whether U.S. equity markets are open right now, based on regular session hours
              (9:30 a.m.–4:00 p.m. ET) and the NYSE/Nasdaq holiday calendar.
            </>
          }
        >
            <CodeBlock>{`# curl
curl https://howmanytradingdays.com/api/market-status`}</CodeBlock>
            <CodeBlock>{`// JavaScript — e.g. show an open/closed badge on your site
const res = await fetch("https://howmanytradingdays.com/api/market-status");
const { isOpen, isEarlyClose, closesAtET } = await res.json();

badge.textContent = isOpen
  ? \`Market open — closes \${closesAtET} ET\`
  : "Market closed";`}</CodeBlock>
            <p className="text-sm text-slate-400 leading-relaxed">Sample response:</p>
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
        </EndpointCard>

        {/* COUNT ENDPOINT */}
        <EndpointCard
          path="/api/count"
          url="https://howmanytradingdays.com/api/count?from=2026-11-02&to=2026-12-31"
          description={
            <>
              Count trading days between any two dates (inclusive) — the{" "}
              <Link href="/calculator" className="text-blue-300 hover:text-blue-200 transition-colors">calculator</Link>,
              as an API. Both <code className="text-slate-200 bg-slate-800/80 px-1 py-0.5 rounded">from</code> and{" "}
              <code className="text-slate-200 bg-slate-800/80 px-1 py-0.5 rounded">to</code> are required, as YYYY-MM-DD.
            </>
          }
        >
          <CodeBlock>{`# curl
curl "https://howmanytradingdays.com/api/count?from=2026-11-02&to=2026-12-31"`}</CodeBlock>
          <p className="text-sm text-slate-400 leading-relaxed">Sample response (early closes count as 0.5):</p>
          <CodeBlock>{`{
  "from": "2026-11-02",
  "to": "2026-12-31",
  "tradingDays": 41,
  "fullDays": 40,
  "halfDays": 2,
  "calendarDays": 59,
  "source": "https://howmanytradingdays.com"
}`}</CodeBlock>
        </EndpointCard>

        {/* IS-TRADING-DAY ENDPOINT */}
        <EndpointCard
          path="/api/is-trading-day"
          url="https://howmanytradingdays.com/api/is-trading-day?date=2026-11-27"
          description={
            <>
              Check whether a specific date is a trading session — and if so, when it closes.
              Also returns the previous and next trading days.{" "}
              <code className="text-slate-200 bg-slate-800/80 px-1 py-0.5 rounded">date</code> defaults
              to today (ET).
            </>
          }
        >
          <CodeBlock>{`# curl
curl "https://howmanytradingdays.com/api/is-trading-day?date=2026-11-27"`}</CodeBlock>
          <p className="text-sm text-slate-400 leading-relaxed">Sample response:</p>
          <CodeBlock>{`{
  "date": "2026-11-27",
  "weekday": "Friday",
  "isTradingDay": true,
  "isEarlyClose": true,
  "holiday": "Day After Thanksgiving",
  "closesAtET": "13:00",
  "previousTradingDay": "2026-11-25",
  "nextTradingDay": "2026-11-30",
  "source": "https://howmanytradingdays.com"
}`}</CodeBlock>
        </EndpointCard>

        {/* OFFSET ENDPOINT */}
        <EndpointCard
          path="/api/offset"
          url="https://howmanytradingdays.com/api/offset?date=2026-08-21&days=2"
          description={
            <>
              Add (or subtract) trading days from a date — useful for settlement math:{" "}
              <code className="text-slate-200 bg-slate-800/80 px-1 py-0.5 rounded">days=1</code> from
              a trade date gives the T+1 settlement date, automatically skipping weekends and
              holidays. <code className="text-slate-200 bg-slate-800/80 px-1 py-0.5 rounded">days</code> may
              be negative; range ±1000.
            </>
          }
        >
          <CodeBlock>{`# curl — T+2 from a Friday lands on Tuesday
curl "https://howmanytradingdays.com/api/offset?date=2026-08-21&days=2"`}</CodeBlock>
          <p className="text-sm text-slate-400 leading-relaxed">Sample response:</p>
          <CodeBlock>{`{
  "date": "2026-08-21",
  "tradingDaysAdded": 2,
  "result": "2026-08-25",
  "resultWeekday": "Tuesday",
  "resultIsEarlyClose": false,
  "source": "https://howmanytradingdays.com"
}`}</CodeBlock>
        </EndpointCard>

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
              <span className="text-sm font-medium text-slate-100">Live Counter</span>
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

        {/* DISCLAIMER */}
        <p className="text-[10px] text-slate-600 leading-relaxed">
          Disclaimer: This API and its data are provided free of charge, &quot;as is,&quot; without
          warranty of any kind — including accuracy, completeness, availability, or fitness for any
          purpose. Nothing here is financial, investment, or trading advice. You are solely
          responsible for how you use this API and for any decisions or outcomes that result. By
          using it, you agree that HowManyTradingDays.com and its creator bear no liability for any
          loss or damage arising from its use, its unavailability, or any errors in its data.
        </p>
      </div>
    </main>
  );
}
