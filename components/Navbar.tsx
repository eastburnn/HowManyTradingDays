"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const REFERENCE_LINKS = [
  { label: "Trading Days in a Year", href: "/trading-days-in-a-year" },
  { label: "Trading Days by Year (1990–)", href: "/trading-days-by-year" },
  { label: "Stock Market Holidays", href: "/stock-market-holidays" },
  { label: "Is the Market Open?", href: "/is-the-stock-market-open" },
];

const BEFORE_DROPDOWN = [
  { label: "Home", href: "/" },
  { label: "Calculator", href: "/calculator" },
];

const AFTER_DROPDOWN = [
  { label: "API", href: "/api-docs" },
  { label: "About", href: "/about" },
];

const linkClass = (isActive: boolean) => `
  px-2 sm:px-3 py-1.5 rounded-lg text-xs font-medium transition-colors duration-150 whitespace-nowrap
  ${isActive
    ? "bg-slate-800 text-slate-100"
    : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/60"
  }
`;

export default function Navbar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // A reference page (including the per-holiday pages) is active
  const referenceActive = REFERENCE_LINKS.some(
    (l) => pathname === l.href || pathname.startsWith(l.href + "/")
  );

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // Close when navigating
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <nav className="w-full border-b border-slate-800 bg-slate-950">
      <div className="max-w-xl mx-auto px-4 h-14 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <img src="/favicon.ico" alt="How Many Trading Days" className="h-6 w-6" />
        </Link>

        {/* Nav links */}
        <div className="flex items-center gap-0.5 sm:gap-1">
          {BEFORE_DROPDOWN.map(({ label, href }) => (
            <Link key={href} href={href} className={linkClass(pathname === href)}>
              {label}
            </Link>
          ))}

          {/* Reference dropdown */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setOpen(!open)}
              aria-expanded={open}
              aria-haspopup="menu"
              className={`${linkClass(referenceActive)} flex items-center gap-1`}
            >
              Reference
              <svg
                className={`w-3 h-3 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {open && (
              <div
                role="menu"
                className="absolute -right-12 sm:right-auto sm:left-0 top-full mt-1.5 w-52 rounded-xl border border-slate-800 bg-slate-950 shadow-xl shadow-black/40 py-1.5 z-50"
              >
                {REFERENCE_LINKS.map(({ label, href }) => {
                  const isActive = pathname === href || pathname.startsWith(href + "/");
                  return (
                    <Link
                      key={href}
                      href={href}
                      role="menuitem"
                      className={`
                        block px-3.5 py-2 text-xs font-medium transition-colors duration-150
                        ${isActive
                          ? "text-slate-100 bg-slate-800/60"
                          : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/60"
                        }
                      `}
                    >
                      {label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {AFTER_DROPDOWN.map(({ label, href }) => (
            <Link key={href} href={href} className={linkClass(pathname === href)}>
              {label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
