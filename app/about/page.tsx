import Link from "next/link";
import { domine } from "../fonts";
import Breadcrumbs from "@/components/Breadcrumbs";

export default function AboutPage() {
  return (
    <main className="flex-1 flex items-start justify-center px-4">
      <div className="max-w-xl w-full flex flex-col gap-8 py-12">
        <Breadcrumbs crumbs={[{ label: "Home", href: "/" }, { label: "About" }]} />

        <header className="space-y-2">
          <h1 className={`${domine.className} text-3xl sm:text-4xl font-semibold tracking-tight`}>
            About
          </h1>
          <p className="text-sm text-slate-400 leading-relaxed">
            A live reference tool for U.S. equity market participants who think in trading days.
          </p>
        </header>

        {/* Feature cards */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-4 flex flex-col gap-2">
            <div className="w-7 h-7 rounded-lg bg-slate-800 flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-slate-300" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2" />
              </svg>
            </div>
            <h2 className="text-sm font-semibold text-slate-100">Live Counter</h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              Tracks remaining U.S. market trading days in the current year, updated in real time relative to 4&nbsp;p.m. ET.
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-4 flex flex-col gap-2">
            <div className="w-7 h-7 rounded-lg bg-slate-800 flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-slate-300" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                <rect x="4" y="2" width="16" height="20" rx="2" />
                <line x1="8" y1="7" x2="16" y2="7" />
                <line x1="8" y1="11" x2="16" y2="11" />
                <line x1="8" y1="15" x2="12" y2="15" />
              </svg>
            </div>
            <h2 className="text-sm font-semibold text-slate-100">Date Calculator</h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              Pick any future date and instantly see how many trading days and calendar days remain from today.
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-4 flex flex-col gap-2">
            <div className="w-7 h-7 rounded-lg bg-slate-800 flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-slate-300" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <h2 className="text-sm font-semibold text-slate-100">Holiday Aware</h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              Follows the full NYSE/Nasdaq holiday schedule. Early-close days count as 0.5. No manual updates needed year to year.
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-4 flex flex-col gap-2">
            <div className="w-7 h-7 rounded-lg bg-slate-800 flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-slate-300" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-sm font-semibold text-slate-100">Always Accurate</h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              Holidays like Good Friday and Memorial Day are computed algorithmically - no hardcoded dates that go stale.
            </p>
          </div>
        </div>

        {/* How it works */}
        <section className="border-t border-slate-800 pt-6 space-y-3">
          <h2 className={`${domine.className} text-lg font-semibold text-slate-100`}>How it works</h2>
          <p className="text-sm text-slate-400 leading-relaxed">
            Trading days are weekdays when U.S. equity markets are open. The counter starts from today
            (or tomorrow if it&apos;s already past 4&nbsp;p.m. Eastern Time) and counts forward,
            skipping weekends and all official NYSE/Nasdaq holidays. Scheduled early-close sessions -
            like the day after Thanksgiving or Christmas Eve - are counted as half days (0.5).
          </p>
          <p className="text-sm text-slate-400 leading-relaxed">
            All holiday dates are derived algorithmically each year using standard calendar rules
            (e.g. the Easter algorithm for Good Friday, nth-weekday formulas for floating holidays),
            so the site stays accurate without any ongoing maintenance.
          </p>
        </section>

        {/* Built by */}
        <section className="border-t border-slate-800 pt-6 space-y-2">
          <h2 className={`${domine.className} text-lg font-semibold text-slate-100`}>Built by</h2>
          <p className="text-sm text-slate-400 leading-relaxed">
            Made by{" "}
            <a
              href="https://www.itschrisray.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline text-slate-300 hover:text-slate-100 transition-colors"
            >
              Chris Ray
            </a>
            . Have feedback or a bug to report? Reach out on{" "}
            <a
              href="https://x.com/itschrisray"
              target="_blank"
              rel="noopener noreferrer"
              className="underline text-slate-300 hover:text-slate-100 transition-colors"
            >
              X&nbsp;@itschrisray
            </a>
            .
          </p>
        </section>

        {/* CTA links */}
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

      </div>
    </main>
  );
}
