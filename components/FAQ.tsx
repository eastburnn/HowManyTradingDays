// components/FAQ.tsx

import React from "react";

type FaqItem = {
  question: string;
  answer: string; // plain text — also used for JSON-LD
  link?: { href: string; label: string };
};

const faqs: FaqItem[] = [
  {
    question: "How many trading days are in a year?",
    answer:
      "For U.S. markets, most years have about 252 trading days after removing weekends and full market holidays. The exact total ranges from 250 to 253 depending on how holidays fall.",
    link: {
      href: "/trading-days-in-a-year",
      label: "See the exact count for every year",
    },
  },
  {
    question: "Which days is the U.S. stock market closed?",
    answer:
      "We follow the standard NYSE/Nasdaq holiday schedule: New Year's Day, Martin Luther King Jr. Day, Presidents' Day, Good Friday, Memorial Day, Juneteenth, Independence Day, Labor Day, Thanksgiving Day, and Christmas Day. When these fall on a weekend, an observed weekday holiday is used instead. The list above shows the holidays still ahead this year.",
    link: {
      href: "/trading-days-in-a-year",
      label: "Full holiday and trading-day breakdown",
    },
  },
  {
    question: "Have there ever been unscheduled stock market closures?",
    answer:
      "Yes — beyond the scheduled holiday calendar, U.S. markets have closed 11 times since 1990 for emergencies and national days of mourning: four days after the September 11 attacks, two days for Hurricane Sandy in 2012, and single days honoring Presidents Nixon, Reagan, Ford, George H. W. Bush, and Carter. Our historical counts account for all of them.",
    link: {
      href: "/trading-days-by-year",
      label: "See every unscheduled closure since 1990",
    },
  },
  {
    question: "How are half days (early closes) counted?",
    answer:
      "Scheduled early-close sessions — such as the day after Thanksgiving, Christmas Eve in some years, or the day before Independence Day — end at 1:00 p.m. ET and are counted as 0.5 trading days. That's why the counter sometimes ends in .5: at least one remaining session is an early close.",
  },
  {
    question: "Do you count today as a trading day?",
    answer:
      "If today is a weekday and U.S. markets are open, we count it as a trading day until 4:00 p.m. Eastern Time (the normal close). After 4:00 p.m. ET, today is treated as finished and no longer included in the remaining-days count. If today is a weekend or full-day market holiday, it is not counted.",
  },
  {
    question: "Which markets and time zone does this site use?",
    answer:
      "This site is based on regular-session hours for the major U.S. equity exchanges (such as NYSE and Nasdaq) and uses U.S. Eastern Time. It does not track extended hours, futures markets, or cryptocurrencies.",
  },
];

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

export default function FAQ() {
  // FAQPage structured data (helps Google parse Q/A even when collapsed)
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: f.answer,
      },
    })),
  };

  return (
    <section className="w-full border-t border-slate-800 pt-8">
      <h2 className="text-base sm:text-lg font-semibold text-slate-100 mb-2">
        Frequently Asked Questions
      </h2>

      <p className="text-xs text-slate-400 mb-4">
        Quick answers to how we count U.S. stock market trading days and what’s included in the numbers above.
      </p>

      {/* JSON-LD */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

      <div className="space-y-3">
        {faqs.map((item) => {
          const id = slugify(item.question);

          return (
            <details
              key={item.question}
              className="group rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3"
            >
              <summary
                className="flex cursor-pointer list-none items-center justify-between text-sm font-medium text-slate-100"
                aria-controls={`${id}-answer`}
              >
                {/* Make the question a real heading for SEO/semantics */}
                <h3 id={id} className="text-sm font-medium text-slate-100">
                  {item.question}
                </h3>

                <span
                  aria-hidden="true"
                  className="ml-3 text-xs text-slate-500 transition-transform group-open:rotate-90"
                >
                  ›
                </span>
              </summary>

              <p
                id={`${id}-answer`}
                className="mt-2 text-xs leading-relaxed text-slate-300"
              >
                {item.answer}
              </p>

              {item.link && (
                <a
                  href={item.link.href}
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-300 hover:text-blue-200 transition-colors"
                >
                  {item.link.label}
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </a>
              )}
            </details>
          );
        })}
      </div>
    </section>
  );
}
