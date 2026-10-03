import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Script from "next/script";
import { domine } from "../../fonts";
import Breadcrumbs from "@/components/Breadcrumbs";
import EarningsCountdown from "@/components/earnings/EarningsCountdown";
import { getCompanyEarnings, type EarningsEvent } from "@/lib/earnings/queries";
import {
  daysBetweenISO,
  displayName,
  estimateWindow,
  fiscalLabel,
  formatLongDate,
  formatMediumDate,
  formatQuarterEnd,
  formatShortDate,
  parseISODate,
  statusLabel,
  timeOfDayLabel,
  timeOfDaySentence,
  timeOfDayShort,
  weekdayOf,
} from "@/lib/earnings/format";
import { todayET } from "@/lib/earnings/ingest";
import { countTradingDaysBetween } from "@/lib/tradingDays";

// Pages render on demand and are re-generated at most daily; the pipeline
// also revalidates a ticker's page whenever its event changes.
export const revalidate = 86400;
export const dynamicParams = true;
export async function generateStaticParams() {
  return [];
}

type Params = { params: Promise<{ ticker: string }> };

const SITE = "https://howmanytradingdays.com";

/* ---------------------------------------------
   HELPERS
----------------------------------------------*/

function countdownFrom(todayISO: string, targetISO: string) {
  const today = parseISODate(todayISO);
  const target = parseISODate(targetISO);
  if (target < today) return { tradingDays: 0, calendarDays: 0 };
  const r = countTradingDaysBetween(today, target);
  return { tradingDays: r.tradingDays, calendarDays: r.calendarDays };
}

function shortName(raw: string): string {
  // "Apple Inc." → "Apple"; "KKR Real Estate Finance Trust Inc." → "KKR Real Estate Finance Trust"
  return displayName(raw)
    .replace(/,?\s+(inc|incorporated|corp|corporation|co|company|ltd|limited|plc|llc|lp|l\.p|n\.v|s\.a|holdings?)\.?$/i, "")
    .replace(/\s+$/, "");
}

function accuracySentence(e: EarningsEvent): string {
  if (e.status === "confirmed") return "Date confirmed by the company.";
  if (e.overdue) return "No earnings 8-K has reached the SEC yet. Companies occasionally shift a quarter's timing; the estimate will reset once results are filed.";
  const n = e.historyCount ?? 0;
  const q = `Q${e.fiscalQuarter}`;
  switch (e.confidence) {
    case "high":
      return `Estimated from ${n} prior fiscal ${q} reports — companies in this tier have reported within 3 days of our estimate about 3 times out of 4.`;
    case "medium":
      return `Estimated from ${n} prior fiscal ${q} report${n === 1 ? "" : "s"} with a less regular pattern — expect the actual date within about a week of this one.`;
    default:
      return `This company's reporting dates vary too much for a precise estimate, so we show an expected window instead of a single date.`;
  }
}

/* ---------------------------------------------
   METADATA
----------------------------------------------*/

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { ticker } = await params;
  const data = await getCompanyEarnings(ticker);
  if (!data) return { title: "Earnings date not available", robots: { index: false, follow: true } };

  const { company, upcoming } = data;
  const next = upcoming[0] ?? null;
  const name = shortName(company.name);
  const sym = company.ticker;
  const canonical = `/earnings/${sym.toLowerCase()}`;
  const today = todayET();

  let title: string;
  let description: string;
  if (next) {
    const [start, end] = estimateWindow(next, today);
    const label = next.status === "confirmed" ? "Confirmed" : "Estimated";
    const { tradingDays } = countdownFrom(today, next.eventDate);
    title =
      next.overdue && next.status === "estimated"
        ? `${sym} Earnings Date: Expected Any Day | When Does ${name} Report?`
        : next.confidence === "low" && next.status === "estimated"
        ? `${sym} Earnings Date: Expected ${formatShortDate(start)}–${formatShortDate(end)} | Countdown`
        : `${sym} Earnings Date: ${formatMediumDate(next.eventDate)} (${label}) | Countdown`;
    description =
      next.overdue && next.status === "estimated"
        ? `${name} (${sym}) usually reports ${fiscalLabel(next)} earnings by ${next.originalEstimate ? formatMediumDate(next.originalEstimate) : "now"} but has not filed yet — expected any day. Past report dates from SEC filings.`
        : next.confidence === "low" && next.status === "estimated"
        ? `${name} (${sym}) is expected to report ${fiscalLabel(next)} earnings between ${formatMediumDate(start)} and ${formatMediumDate(end)}. Trading-day countdown and past report dates from SEC filings.`
        : `${name} (${sym}) is ${next.status === "confirmed" ? "scheduled" : "expected"} to report ${fiscalLabel(next)} earnings on ${formatLongDate(next.eventDate)}, ${timeOfDaySentence(next.timeOfDay)} — ${tradingDays} trading days away. Live countdown and past report dates.`;
  } else {
    title = `${sym} Earnings Date | When Does ${name} Report Earnings?`;
    description = `When ${name} (${sym}) reports earnings, with past report dates from SEC filings and a trading-day countdown.`;
  }

  return {
    title,
    description: description.length > 158 ? description.slice(0, 155).replace(/\s+\S*$/, "") + "…" : description,
    alternates: { canonical },
    robots: company.indexed ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: {
      title,
      description,
      url: `${SITE}${canonical}`,
      siteName: "How Many Trading Days",
      type: "website",
    },
  };
}

/* ---------------------------------------------
   PAGE
----------------------------------------------*/

export default async function EarningsTickerPage({ params }: Params) {
  const { ticker } = await params;
  const data = await getCompanyEarnings(ticker);
  if (!data) notFound();

  const { company, upcoming, lastReported, history } = data;
  const next = upcoming[0] ?? null;
  const following = upcoming[1] ?? null;
  const name = shortName(company.name);
  const sym = company.ticker;
  const today = todayET();
  const justReported = lastReported ? daysBetweenISO(lastReported.eventDate, today) <= 7 : false;

  const isOverdue = next?.status === "estimated" && next.overdue;
  const isWindow = next?.status === "estimated" && next.confidence === "low" && !isOverdue;
  const [winStart, winEnd] = next ? estimateWindow(next, today) : [today, today];
  const countdown = next ? countdownFrom(today, isWindow ? winStart : next.eventDate) : null;
  const countdownEnd = next && isWindow ? countdownFrom(today, winEnd) : null;

  const jsonLd = next
    ? [
        {
          "@context": "https://schema.org",
          "@type": "Event",
          name: `${name} (${sym}) ${fiscalLabel(next)} Earnings Release`,
          description: `${next.status === "confirmed" ? "Confirmed" : "Estimated"} date for ${name}'s ${fiscalLabel(next)} earnings release.`,
          startDate: next.eventDate,
          eventStatus: "https://schema.org/EventScheduled",
          eventAttendanceMode: "https://schema.org/OnlineEventAttendanceMode",
          location: { "@type": "VirtualLocation", url: `${SITE}/earnings/${sym.toLowerCase()}` },
          organizer: { "@type": "Organization", name: displayName(company.name) },
        },
        {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: [
            {
              "@type": "Question",
              name: `When does ${name} (${sym}) report earnings?`,
              acceptedAnswer: {
                "@type": "Answer",
                text: isOverdue
                  ? `${name} usually would have reported ${fiscalLabel(next)} earnings by ${next.originalEstimate ? formatLongDate(next.originalEstimate) : "now"} but has not filed a release yet; it is expected any day.`
                  : isWindow
                  ? `${name} is expected to report ${fiscalLabel(next)} earnings between ${formatLongDate(winStart)} and ${formatLongDate(winEnd)}.`
                  : `${name} is ${next.status === "confirmed" ? "scheduled" : "expected"} to report ${fiscalLabel(next)} earnings on ${formatLongDate(next.eventDate)}, ${timeOfDaySentence(next.timeOfDay)}.`,
              },
            },
            {
              "@type": "Question",
              name: `How many trading days until ${sym} earnings?`,
              acceptedAnswer: {
                "@type": "Answer",
                text: isOverdue
                  ? `The usual date has passed; the report is expected any day.`
                  : isWindow
                  ? `Between ${countdown!.tradingDays} and ${countdownEnd!.tradingDays} U.S. stock market trading days, depending on the exact date.`
                  : `${countdown!.tradingDays} U.S. stock market trading days (${countdown!.calendarDays} calendar days) as of ${formatLongDate(today)}, counting weekdays and skipping market holidays.`,
              },
            },
            {
              "@type": "Question",
              name: `Does ${sym} report before or after the market opens?`,
              acceptedAnswer: {
                "@type": "Answer",
                text:
                  next.timeOfDay === "unknown"
                    ? `The time of day for ${name}'s next report is not yet known.`
                    : `${name} typically reports ${timeOfDaySentence(next.timeOfDay)}, based on when its past earnings 8-K filings reached the SEC.`,
              },
            },
          ],
        },
      ]
    : null;

  return (
    <main className="flex-1 flex items-start justify-center px-4">
      <div className="max-w-xl w-full flex flex-col gap-8 py-12">
        {jsonLd && (
          <Script id="earnings-jsonld" type="application/ld+json" strategy="beforeInteractive">
            {JSON.stringify(jsonLd)}
          </Script>
        )}

        <Breadcrumbs crumbs={[{ label: "Home", href: "/" }, { label: "Earnings", href: "/earnings" }, { label: sym }]} />

        <header className="space-y-2">
          <h1 className={`${domine.className} text-3xl sm:text-4xl font-semibold tracking-tight text-balance`}>
            When Does {name} Report Earnings?
          </h1>
          <p className="text-sm text-slate-400 leading-relaxed">
            {sym}
            {company.exchange ? ` · ${company.exchange}` : ""} · Next earnings date for {displayName(company.name)}, estimated
            from its SEC filing history, with a live countdown in trading days.
          </p>
        </header>

        {/* JUST REPORTED BANNER */}
        {justReported && lastReported && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            <span className="font-semibold">Just reported:</span> {name} released {fiscalLabel(lastReported)} results on{" "}
            {formatLongDate(lastReported.eventDate)}, {timeOfDaySentence(lastReported.timeOfDay)}.
            {lastReported.sourceUrl && (
              <>
                {" "}
                <a href={lastReported.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-white transition-colors">
                  View the {lastReported.sourceType === "edgar-periodic" ? lastReported.reportForm ?? "filing" : "8-K filing"}
                </a>
                .
              </>
            )}
          </div>
        )}

        {/* HERO: NEXT EARNINGS */}
        {next && countdown ? (
          <section className="w-full rounded-2xl border border-slate-800 bg-slate-900/70 shadow-xl p-6 sm:p-8 flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                  next.status === "confirmed"
                    ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200"
                    : next.confidence === "low"
                    ? "border-slate-500/40 bg-slate-500/10 text-slate-300"
                    : "border-amber-400/40 bg-amber-400/10 text-amber-200"
                }`}
              >
                {isOverdue ? "Past usual date" : statusLabel(next)}
              </span>
              <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-800/60 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-300">
                {timeOfDayLabel(next.timeOfDay)}
              </span>
            </div>

            <div className="space-y-1">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Next earnings date</p>
              {isOverdue ? (
                <p className={`${domine.className} text-2xl sm:text-3xl font-semibold text-slate-100 text-balance`}>
                  Expected any day
                </p>
              ) : isWindow ? (
                <p className={`${domine.className} text-2xl sm:text-3xl font-semibold text-slate-100 text-balance`}>
                  {formatMediumDate(winStart)} – {formatMediumDate(winEnd)}
                </p>
              ) : (
                <p className={`${domine.className} text-2xl sm:text-3xl font-semibold text-slate-100 text-balance`}>
                  {formatLongDate(next.eventDate)}
                </p>
              )}
              <p className="text-sm text-slate-400">
                {fiscalLabel(next)} results · quarter ended {formatQuarterEnd(next.periodEnd)}
                {isOverdue && next.originalEstimate ? ` · usually reported by ${formatMediumDate(next.originalEstimate)}` : ""}
                {next.status === "estimated" && !isWindow && !isOverdue && next.windowDays ? ` · ±${next.windowDays} days` : ""}
              </p>
            </div>

            {isOverdue ? (
              <p className="rounded-xl border border-slate-700 bg-slate-800/40 px-4 py-3 text-sm text-slate-300 leading-relaxed">
                {name} has passed the date its past pattern pointed to and has not filed an earnings release yet. The report could come any day; this page updates automatically when it does.
              </p>
            ) : (
            <EarningsCountdown
              eventDate={isWindow ? winStart : next.eventDate}
              windowEnd={isWindow ? winEnd : undefined}
              initial={{
                tradingDays: countdown.tradingDays,
                calendarDays: countdown.calendarDays,
                tradingDaysEnd: countdownEnd?.tradingDays,
                calendarDaysEnd: countdownEnd?.calendarDays,
              }}
            />
            )}

            <p className="text-xs text-slate-500 leading-relaxed">
              {accuracySentence(next)}
              {next.status === "confirmed" && next.sourceUrl && (
                <>
                  {" "}
                  <a href={next.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-slate-300 transition-colors">
                    Source
                  </a>
                  .
                </>
              )}
            </p>
          </section>
        ) : (
          <section className="w-full rounded-2xl border border-slate-800 bg-slate-900/70 shadow-xl p-6 sm:p-8 space-y-2">
            <p className={`${domine.className} text-xl font-semibold text-slate-100`}>No upcoming date yet</p>
            <p className="text-sm text-slate-400 leading-relaxed">
              We don&apos;t have enough reporting history for {name} to estimate its next earnings date. This
              page updates automatically as new SEC filings arrive.
            </p>
          </section>
        )}

        {/* FOLLOWING QUARTER + LAST REPORTED */}
        {(following || (lastReported && !justReported)) && (
          <div className="grid gap-3 sm:grid-cols-2">
            {following && (
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.15em] text-slate-500">After that</p>
                <p className="mt-1 text-sm font-medium text-slate-100">{fiscalLabel(following)}</p>
                <p className="text-xs text-slate-400">
                  {following.status === "confirmed" ? "Confirmed" : "Estimated"} {formatMediumDate(following.eventDate)} ·{" "}
                  {timeOfDayLabel(following.timeOfDay).toLowerCase()}
                </p>
              </div>
            )}
            {lastReported && !justReported && (
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.15em] text-slate-500">Last reported</p>
                <p className="mt-1 text-sm font-medium text-slate-100">{fiscalLabel(lastReported)}</p>
                <p className="text-xs text-slate-400">
                  {formatMediumDate(lastReported.eventDate)} · {timeOfDayLabel(lastReported.timeOfDay).toLowerCase()}
                  {lastReported.sourceUrl && (
                    <>
                      {" · "}
                      <a href={lastReported.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-blue-300 hover:text-blue-200 transition-colors">
                        {lastReported.sourceType === "edgar-periodic" ? lastReported.reportForm ?? "filing" : "8-K"}
                      </a>
                    </>
                  )}
                </p>
              </div>
            )}
          </div>
        )}

        {/* HISTORY */}
        {history.length > 0 && (
          <section className="space-y-3">
            <h2 className={`${domine.className} text-lg font-semibold text-slate-100`}>
              {sym} earnings date history
            </h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              The last {history.length} earnings releases, from {name}&apos;s SEC filings — its earnings 8-Ks, or
              the quarterly report itself when results are published that way. The &ldquo;days after&rdquo;
              column is how long after the fiscal quarter ended the company reported — the pattern behind the
              estimate above.
            </p>
            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="w-full table-fixed text-xs sm:text-sm">
                <thead className="bg-slate-900/60 text-[10px] sm:text-xs uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-1 sm:px-3 py-2 text-center font-medium">Quarter</th>
                    <th className="px-1 sm:px-3 py-2 text-center font-medium">Reported</th>
                    <th className="px-1 sm:px-3 py-2 text-center font-medium">Time</th>
                    <th className="px-1 sm:px-3 py-2 text-center font-medium leading-tight">Days after</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id} className="border-t border-slate-800">
                      <td className="px-1 sm:px-3 py-2 text-center text-slate-300 whitespace-nowrap">
                        Q{h.fiscalQuarter} {h.fiscalYear}
                        <span className="block text-[11px] text-slate-500">ended {formatShortDate(h.periodEnd)}</span>
                      </td>
                      <td className="px-1 sm:px-3 py-2 text-center text-slate-100 whitespace-nowrap">
                        {h.sourceUrl ? (
                          <a href={h.sourceUrl} target="_blank" rel="noopener noreferrer" className="hover:underline decoration-slate-600 underline-offset-2">
                            {formatMediumDate(h.eventDate)}
                          </a>
                        ) : (
                          formatMediumDate(h.eventDate)
                        )}
                        <span className="block text-[11px] text-slate-500">{weekdayOf(h.eventDate)}</span>
                      </td>
                      <td className="px-1 sm:px-3 py-2 text-center text-slate-400 whitespace-nowrap">{timeOfDayShort(h.timeOfDay)}</td>
                      <td className="px-1 sm:px-3 py-2 text-center tabular-nums text-slate-300">
                        {daysBetweenISO(h.periodEnd, h.eventDate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* METHODOLOGY */}
        <section className="border-t border-slate-800 pt-6 space-y-3">
          <h2 className={`${domine.className} text-lg font-semibold text-slate-100`}>How this estimate is made</h2>
          <p className="text-sm text-slate-400 leading-relaxed">
            Companies report on a rhythm. We read every Form 8-K earnings release and 10-Q/10-K {name} has filed
            with the SEC, work out how many days after each fiscal quarter ended the results came out and on which
            weekday, and project that pattern onto the current quarter — using the same fiscal quarter from prior
            years, since fourth-quarter reports run later than the others. The result is snapped to a trading day
            and capped at the SEC filing deadline for a {company.filerCategory.replace("-", " ")} filer.
          </p>
          <p className="text-sm text-slate-400 leading-relaxed">
            Whether a company reports before the open or after the close comes from the time its past earnings
            8-Ks reached the SEC. When {name} announces an exact date, this page switches from estimated to
            confirmed. Until then, verify the date with the company&apos;s investor relations site before trading
            around it.
          </p>
        </section>

        {/* FAQ */}
        {next && countdown && (
          <section className="space-y-3">
            <h2 className={`${domine.className} text-lg font-semibold text-slate-100`}>Frequently asked questions</h2>
            <div className="space-y-2">
              <details className="group rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3">
                <summary className="cursor-pointer list-none text-sm font-medium text-slate-100 flex items-center justify-between">
                  When does {name} ({sym}) report earnings?
                  <span className="text-slate-600 group-open:rotate-90 transition-transform">›</span>
                </summary>
                <p className="mt-2 text-sm text-slate-400 leading-relaxed">
                  {isOverdue
                    ? `${name} usually would have reported ${fiscalLabel(next)} earnings by ${next.originalEstimate ? formatLongDate(next.originalEstimate) : "now"} but has not filed a release yet; it is expected any day.`
                    : isWindow
                    ? `${name} is expected to report ${fiscalLabel(next)} earnings between ${formatLongDate(winStart)} and ${formatLongDate(winEnd)}.`
                    : `${name} is ${next.status === "confirmed" ? "scheduled" : "expected"} to report ${fiscalLabel(next)} earnings on ${formatLongDate(next.eventDate)}, ${timeOfDaySentence(next.timeOfDay)}.`}
                </p>
              </details>
              <details className="group rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3">
                <summary className="cursor-pointer list-none text-sm font-medium text-slate-100 flex items-center justify-between">
                  How many trading days until {sym} earnings?
                  <span className="text-slate-600 group-open:rotate-90 transition-transform">›</span>
                </summary>
                <p className="mt-2 text-sm text-slate-400 leading-relaxed">
                  {isOverdue
                    ? `The usual date has passed; the report is expected any day.`
                    : isWindow
                    ? `Between ${countdown.tradingDays} and ${countdownEnd!.tradingDays} trading days, depending on the exact date.`
                    : `${countdown.tradingDays} trading days (${countdown.calendarDays} calendar days) as of ${formatLongDate(today)}, counting weekdays and skipping NYSE/Nasdaq holidays.`}
                </p>
              </details>
              <details className="group rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3">
                <summary className="cursor-pointer list-none text-sm font-medium text-slate-100 flex items-center justify-between">
                  Does {sym} report before or after the market opens?
                  <span className="text-slate-600 group-open:rotate-90 transition-transform">›</span>
                </summary>
                <p className="mt-2 text-sm text-slate-400 leading-relaxed">
                  {next.timeOfDay === "unknown"
                    ? `The time of day for ${name}'s next report is not yet known.`
                    : `${name} typically reports ${timeOfDaySentence(next.timeOfDay)}, based on when its past earnings 8-K filings reached the SEC.`}
                </p>
              </details>
            </div>
          </section>
        )}

        {/* CTAS */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 border-t border-slate-800 pt-6">
          <Link
            href={next ? `/calculator?to=${isWindow ? winStart : next.eventDate}` : "/calculator"}
            className="group flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3 hover:border-slate-700 hover:bg-slate-900/70 transition-all duration-150"
          >
            <span className="text-sm font-medium text-slate-100">Open in calculator</span>
            <span className="text-slate-600 group-hover:text-slate-400 transition-colors">›</span>
          </Link>
          <Link
            href="/earnings"
            className="group flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3 hover:border-slate-700 hover:bg-slate-900/70 transition-all duration-150"
          >
            <span className="text-sm font-medium text-slate-100">Earnings calendar</span>
            <span className="text-slate-600 group-hover:text-slate-400 transition-colors">›</span>
          </Link>
          <Link
            href="/is-the-stock-market-open"
            className="group flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3 hover:border-slate-700 hover:bg-slate-900/70 transition-all duration-150"
          >
            <span className="text-sm font-medium text-slate-100">Is the market open?</span>
            <span className="text-slate-600 group-hover:text-slate-400 transition-colors">›</span>
          </Link>
        </div>

        <p className="text-[10px] text-slate-500 text-center leading-relaxed">
          Estimated dates are projections from public SEC filings, not announcements by {displayName(company.name).replace(/\.$/, "")}. Confirm
          with the company before making decisions. Not investment advice.
        </p>
      </div>
    </main>
  );
}
