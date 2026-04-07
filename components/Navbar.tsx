"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { label: "Home", href: "/" },
  { label: "Calculator", href: "/calculator" },
  { label: "About", href: "/about" },
];

export default function Navbar() {
  const pathname = usePathname();

  return (
    <nav className="w-full border-b border-slate-800 bg-slate-950">
      <div className="max-w-xl mx-auto px-4 h-14 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <img src="/favicon.ico" alt="How Many Trading Days" className="h-6 w-6" />
        </Link>

        {/* Nav links */}
        <div className="flex items-center gap-1">
          {LINKS.map(({ label, href }) => {
            const isActive = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`
                  px-3 py-1.5 rounded-lg text-xs font-medium transition-colors duration-150
                  ${isActive
                    ? "bg-slate-800 text-slate-100"
                    : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/60"
                  }
                `}
              >
                {label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
