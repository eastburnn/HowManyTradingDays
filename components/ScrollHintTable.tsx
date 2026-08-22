"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Wraps a wide table in a horizontal-scroll container and, when the content
 * overflows (i.e. on narrow screens), shows a right-edge gradient with a
 * pulsing chevron nudging the user to scroll sideways. The hint fades out
 * permanently once the user scrolls the table horizontally.
 */
export default function ScrollHintTable({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [hint, setHint] = useState(false);
  const dismissed = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const check = () => {
      if (dismissed.current) return;
      // Skip while the tab/pane is hidden and not laid out (width 0)
      if (el.clientWidth === 0) return;
      setHint(el.scrollWidth > el.clientWidth + 8);
    };

    const onScroll = () => {
      if (el.scrollLeft > 16 && !dismissed.current) {
        dismissed.current = true;
        setHint(false);
      }
    };

    check();
    const lateCheck = setTimeout(check, 400); // fonts/layout settling
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearTimeout(lateCheck);
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  return (
    <div className="relative rounded-xl border border-slate-800">
      <div ref={ref} className="overflow-x-auto rounded-xl">
        {children}
      </div>

      {/* Right-edge fade + pulsing chevron (sticky so it stays in view while
          scrolling vertically through a tall table) */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-y-0 right-0 w-14 rounded-r-xl bg-gradient-to-l from-slate-950/90 via-slate-950/40 to-transparent transition-opacity duration-500 ${
          hint ? "opacity-100" : "opacity-0"
        }`}
      >
        {/* mt pushes the chevron's first appearance below the table's top edge;
            once scrolled it sticks at mid-viewport */}
        <div className="sticky top-[45vh] mt-20 flex justify-end pr-1">
          <svg
            className="w-4 h-4 text-slate-300 scroll-hint-nudge"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>
    </div>
  );
}
