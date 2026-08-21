import Link from "next/link";
import { domine } from "@/app/fonts";

const REFERENCE_LINKS = [
  { label: "Trading Days in a Year", href: "/trading-days-in-a-year" },
  { label: "Trading Days by Year", href: "/trading-days-by-year" },
  { label: "Stock Market Holidays", href: "/stock-market-holidays" },
  { label: "Is the Market Open?", href: "/is-the-stock-market-open" },
];

const SITE_LINKS = [
  { label: "Calculator", href: "/calculator" },
  { label: "Free API", href: "/api-docs" },
  { label: "About", href: "/about" },
  { label: "Privacy", href: "/privacy" },
];

function LinkColumn({
  heading,
  links,
}: {
  heading: string;
  links: { label: string; href: string }[];
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">
        {heading}
      </span>
      {links.map(({ label, href }) => (
        <Link
          key={href}
          href={href}
          className="text-xs text-slate-400 hover:text-slate-200 transition-colors"
        >
          {label}
        </Link>
      ))}
    </div>
  );
}

export default function Footer() {
  return (
    <footer className="w-full border-t border-slate-800 bg-[#010409] mt-auto">
      <div className="max-w-xl mx-auto px-4 py-6 flex flex-col sm:flex-row justify-between gap-6 sm:gap-8">
        {/* Brand + legal */}
        <div className="flex flex-col gap-2.5 max-w-[250px]">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <img src="/favicon.ico" alt="" className="h-5 w-5" />
            <span className={`${domine.className} text-sm font-semibold text-slate-100`}>
              How Many Trading Days
            </span>
          </Link>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Live reference for U.S. stock market trading days, holidays, and market hours.
          </p>
          <p className="text-[10px] text-slate-600 leading-relaxed">
            U.S. equity markets only &middot; Informational purposes only.
          </p>
          <p className="flex items-center gap-1.5 text-[10px] text-slate-500">
            Made by{" "}
            <a
              href="https://www.itschrisray.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-400 hover:text-slate-300 transition-colors"
            >
              Chris Ray
            </a>
            <span className="text-slate-700">&bull;</span>
            <a
              href="https://x.com/itschrisray"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 hover:opacity-80 transition-opacity"
            >
              <img src="/twitter.png" alt="" className="h-2.5 w-2.5 opacity-70" />
              <span className="text-slate-400 hover:text-slate-300 transition-colors">
                @itschrisray
              </span>
            </a>
          </p>
        </div>

        {/* Links */}
        <div className="flex gap-10 sm:gap-12">
          <LinkColumn heading="Reference" links={REFERENCE_LINKS} />
          <LinkColumn heading="Site" links={SITE_LINKS} />
        </div>
      </div>
    </footer>
  );
}
