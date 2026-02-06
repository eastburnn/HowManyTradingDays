// components/FiscalAd.tsx
import Image from "next/image";

type FiscalAdProps = {
  href: string;
  className?: string;
};

const WORDS = [
  "Instant Answers.",
  "Faster Research.",
  "Earnings Summaries.",
  "Filings Breakdown.",
  "Transcript Highlights.",
  "Thesis Builder.",
  "Market Clarity.",
  "Signal Hunting.",
];

export default function FiscalAd({ href, className = "" }: FiscalAdProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer sponsored"
      aria-label="Visit Fiscal.ai (sponsored)"
      data-ad="true"
      className={[
        "group relative block w-full rounded-2xl bg-white border border-black/10",
        // base shadow + hover lift
        "shadow-[0_4px_12px_rgba(0,0,0,0.12)]",
        "transition-transform duration-200 ease-out hover:-translate-y-[2px]",
        className,
      ].join(" ")}
    >
      {/* Hover vignette shadow (kept in CSS to avoid Tailwind arbitrary-value issues) */}
      <div className="fiscal-vignette pointer-events-none absolute inset-0 -z-10 opacity-0 transition-opacity duration-200 group-hover:opacity-100" />

      {/* content */}
      <div className="relative flex flex-col gap-3 px-4 py-3 sm:px-5 sm:py-4 overflow-hidden rounded-2xl">
        {/* top row */}
        <div className="flex items-end gap-4">
          {/* LOGO (nudged right) */}
          <div className="relative h-10 w-44 shrink-0 sm:h-12 sm:w-52 ml-2">
            <Image
              src="/ads/fiscal.png"
              alt="Fiscal.ai"
              fill
              sizes="(max-width: 640px) 180px, 220px"
              className="object-contain object-left"
            />
          </div>

          {/* WORD CAROUSEL */}
          <div className="flex-1 flex justify-center">
            <div className="w-full max-w-xs -translate-y-1">
              <div
                className={[
                  "fiscal-marquee relative overflow-hidden",
                  "text-left text-lg sm:text-xl font-semibold italic tracking-tight text-black",
                ].join(" ")}
                aria-label="Fiscal.ai capabilities"
              >
                <div className="fiscal-marquee__track">
                  {WORDS.map((word, i) => (
                    <span key={`a-${i}`} className="fiscal-marquee__word">
                      {word}
                    </span>
                  ))}
                  {/* duplicate for seamless loop */}
                  {WORDS.map((word, i) => (
                    <span
                      key={`b-${i}`}
                      className="fiscal-marquee__word"
                      aria-hidden="true"
                    >
                      {word}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* promo bar */}
        <div className="flex items-center justify-center gap-2 rounded-xl border border-black/30 bg-black px-3 py-2 text-center">
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]"
          />
          <p className="text-[11px] sm:text-xs text-white leading-snug">
            <span className="font-semibold">Use code WELCOME15</span> for{" "}
            <span className="font-semibold">
              15% off your first 11 months
            </span>
          </p>
        </div>
      </div>

      {/* scoped styles (safe) */}
      <style jsx>{`
        /* Vignette hover shadow behind the card */
        .fiscal-vignette {
          /* bigger than the card so it reads as a shadow on the page */
          position: absolute;
          inset: -20px;
          border-radius: 28px;
          filter: blur(18px);
          background: radial-gradient(
            ellipse at center,
            rgba(0, 0, 0, 0) 48%,
            rgba(0, 0, 0, 0.35) 100%
          );
        }

        /* Fade edges of marquee */
        .fiscal-marquee {
          -webkit-mask-image: linear-gradient(
            to right,
            transparent 0%,
            black 22%,
            black 78%,
            transparent 100%
          );
          mask-image: linear-gradient(
            to right,
            transparent 0%,
            black 22%,
            black 78%,
            transparent 100%
          );
        }

        .fiscal-marquee__track {
          display: inline-flex;
          gap: 18px;
          white-space: nowrap;
          will-change: transform;
          animation: fiscalMarquee 16s linear infinite;
        }

        .fiscal-marquee__word {
          opacity: 0.95;
        }

        @media (min-width: 640px) {
          .fiscal-marquee__track {
            animation-duration: 18s;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .fiscal-marquee__track {
            animation: none;
            transform: translateX(0);
          }
        }

        @keyframes fiscalMarquee {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(-50%);
          }
        }
      `}</style>
    </a>
  );
}
