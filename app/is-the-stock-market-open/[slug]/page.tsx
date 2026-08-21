import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { domine } from "../../fonts";
import Breadcrumbs from "@/components/Breadcrumbs";
import { HOLIDAY_PAGES, getHolidayPage, resolveYearStatus } from "@/lib/holidayPages";

export const revalidate = 86400;

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return HOLIDAY_PAGES.map((h) => ({ slug: h.slug }));
}

function getCurrentYearET(): number {
  const yearStr = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
  }).format(new Date());
  return Number(yearStr);
}

function formatFullDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const def = getHolidayPage(slug);
  if (!def) return {};

  const year = getCurrentYearET();
  const status = resolveYearStatus(def, year);

  const title = `Is the Stock Market Open on ${def.name}? (${year})`;
  const answerWord =
    status.status === "open"
      ? "Yes — markets are open."
      : status.status === "early-close"
      ? "Yes — with a 1 p.m. ET early close."
      : "No — markets are closed.";
  const description = `${answerWord} ${def.name} ${year} falls on ${
    status.dateISO ? formatFullDate(status.dateISO) : "—"
  }. See NYSE and Nasdaq hours for ${def.name} this year and next.`;

  return {
    title,
    description,
    alternates: { canonical: `/is-the-stock-market-open/${slug}` },
    openGraph: {
      title,
      description,
      url: `https://howmanytradingdays.com/is-the-stock-market-open/${slug}`,
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

const STATUS_STYLES = {
  open: {
    border: "border-emerald-500/30",
    bg: "bg-emerald-500/10",
    text: "text-emerald-200",
    label: "OPEN",
  },
  "early-close": {
    border: "border-amber-400/30",
    bg: "bg-amber-400/10",
    text: "text-amber-200",
    label: "OPEN UNTIL 1 P.M. ET",
  },
  closed: {
    border: "border-red-500/30",
    bg: "bg-red-500/10",
    text: "text-red-300",
    label: "CLOSED",
  },
  weekend: {
    border: "border-slate-700",
    bg: "bg-slate-800/40",
    text: "text-slate-300",
    label: "WEEKEND — NO SESSION",
  },
  none: {
    border: "border-slate-700",
    bg: "bg-slate-800/40",
    text: "text-slate-300",
    label: "NOT OBSERVED",
  },
} as const;

export default async function HolidayOpenPage({ params }: Props) {
  const { slug } = await params;
  const def = getHolidayPage(slug);
  if (!def) notFound();

  const year = getCurrentYearET();
  const current = resolveYearStatus(def, year);
  const years = [year, year + 1, year + 2, year + 3].map((y) => resolveYearStatus(def, y));
  const style = STATUS_STYLES[current.status];

  const answerSentence =
    current.status === "open"
      ? `Yes — U.S. stock markets are open on ${def.name} in ${year}.`
      : current.status === "early-close"
      ? `Yes — markets are open on ${def.name} in ${year}, but close early at 1:00 p.m. ET.`
      : current.status === "weekend"
      ? `In ${year}, ${def.name} falls on a weekend, so there is no trading session that day.`
      : `No — U.S. stock markets are closed on ${def.name}.`;

  // Other holiday pages for the "related" section (exclude self)
  const related = HOLIDAY_PAGES.filter((h) => h.slug !== def.slug).slice(0, 6);

  return (
    <main className="flex-1 flex items-start justify-center px-4">
      <div className="max-w-xl w-full flex flex-col gap-8 py-12">
        <Breadcrumbs
          crumbs={[
            { label: "Home", href: "/" },
            { label: "Is the Market Open?", href: "/is-the-stock-market-open" },
            { label: def.name },
          ]}
        />

        <header className="space-y-2">
          <h1 className={`${domine.className} text-3xl sm:text-4xl font-semibold tracking-tight`}>
            Is the Stock Market Open on <span className="whitespace-nowrap">{def.name}?</span>
          </h1>
        </header>

        {/* ANSWER CARD */}
        <section className={`w-full rounded-2xl border ${style.border} ${style.bg} shadow-xl p-6 sm:p-8 flex flex-col items-center gap-2 text-center`}>
          <span className={`text-xs font-semibold uppercase tracking-[0.2em] ${style.text}`}>
            {style.label}
          </span>
          <p className="text-sm text-slate-200 leading-relaxed max-w-md">{answerSentence}</p>
          {current.dateISO && (
            <p className="text-xs text-slate-400">
              {def.name} {year}: <span className="text-slate-200 font-medium">{formatFullDate(current.dateISO)}</span>
            </p>
          )}
        </section>

        {/* EXPLANATION */}
        <section className="space-y-3">
          {def.blurb.map((p, i) => (
            <p key={i} className="text-sm text-slate-400 leading-relaxed">
              {p}
            </p>
          ))}
          {def.bondMarketClosed && def.shortAnswer !== "open" && (
            <p className="text-sm text-slate-400 leading-relaxed">
              The U.S. bond market is also closed, per SIFMA&apos;s recommended holiday schedule.
            </p>
          )}
        </section>

        {/* BY-YEAR TABLE */}
        <section className="space-y-3">
          <h2 className={`${domine.className} text-lg font-semibold text-slate-100`}>
            {def.name} market status by year
          </h2>
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-900/70 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-3 font-medium">Year</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium text-right">Market status</th>
                </tr>
              </thead>
              <tbody>
                {years.map((ys) => (
                  <tr
                    key={ys.year}
                    className={`border-t border-slate-800 ${ys.year === year ? "bg-blue-500/10" : "bg-slate-900/30"}`}
                  >
                    <td className={`px-4 py-2.5 tabular-nums ${ys.year === year ? "font-semibold text-blue-200" : "text-slate-200"}`}>
                      {ys.year}
                    </td>
                    <td className="px-4 py-2.5 text-slate-400 whitespace-nowrap">
                      {ys.dateISO
                        ? `${ys.weekdayName}, ${new Date(ys.dateISO + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                        : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs text-slate-300 whitespace-nowrap">{ys.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* RELATED */}
        <section className="border-t border-slate-800 pt-6 space-y-3">
          <h2 className={`${domine.className} text-lg font-semibold text-slate-100`}>
            Other market holidays
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {related.map((h) => (
              <Link
                key={h.slug}
                href={`/is-the-stock-market-open/${h.slug}`}
                className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-xs font-medium text-slate-300 hover:border-slate-700 hover:bg-slate-900/70 hover:text-slate-100 transition-all duration-150 truncate"
              >
                {h.name}
              </Link>
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <Link href="/stock-market-holidays" className="text-blue-300 hover:text-blue-200 transition-colors font-medium">
              Full {year} holiday schedule →
            </Link>
            <Link href="/is-the-stock-market-open" className="text-blue-300 hover:text-blue-200 transition-colors font-medium">
              Is the market open today? →
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
