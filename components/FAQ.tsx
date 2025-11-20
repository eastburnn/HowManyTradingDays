// components/FAQ.tsx

import React from "react";

const faqs = [
  {
    question: "How many trading days are there in a typical year for U.S. markets?",
    answer:
      "Most years have around 252 trading days once weekends and stock-market holidays are removed. The exact number changes depending on where holidays fall. This site calculates the precise number remaining for the current calendar year.",
  },
  {
    question: "How many trading days are in a typical month?",
    answer:
      "Most months have between 19 and 22 trading days. The exact number depends on where weekends and market holidays fall. Months containing major holidays—such as July, November, or December tend to have fewer trading days. This site only calculates the count for the full calendar year, but monthly totals follow the same pattern of excluding weekends and full U.S. stock-market holidays.",
  },
  {
    question: "Which days is the U.S. stock market closed?",
    answer:
      "We follow the standard NYSE/Nasdaq holiday schedule: New Year’s Day, Martin Luther King Jr. Day, Presidents’ Day, Good Friday, Memorial Day, Juneteenth National Independence Day, Independence Day, Labor Day, Thanksgiving Day, and Christmas Day. When these fall on a weekend, an observed weekday holiday is used instead.",
  },
  {
    question: "Does this site include half trading days?",
    answer:
      "Yes. Scheduled early-close days—such as the day after Thanksgiving, Christmas Eve in some years, or the day before Independence Day—are counted as 0.5 trading days. Full holidays are counted as 0, and normal weekdays when the market is open are counted as 1.",
  },
  {
    question: "How many trading days are left in the year?",
    answer:
      "The main counter at the top of the page shows the remaining U.S. stock-market trading days in the current calendar year. It includes weekdays when markets are open, partial days as 0.5, and excludes weekends and full-day holidays.",
  },
  {
    question: "Why does the number sometimes end in .5 instead of a whole number?",
    answer:
      "A .5 at the end means there is at least one remaining scheduled half day (early close). For example, if the only remaining session is an early-close day, the counter will show 0.5 trading days left.",
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
  {
    question: "How often is the countdown updated?",
    answer:
      "The countdown is recalculated every time you load or refresh the page, using your current date and time converted to U.S. Eastern Time. There’s no manual input—everything updates automatically.",
  },
];

export default function FAQ() {
  return (
    <section className="w-full border-t border-slate-800 pt-8">
      <h2 className="text-base sm:text-lg font-semibold text-slate-100 mb-2">
        Frequently Asked Questions
      </h2>
      <p className="text-xs text-slate-400 mb-4">
        Quick answers to how we count U.S. stock market trading days and what’s
        included in the numbers you see above.
      </p>

      <div className="space-y-3">
        {faqs.map((item) => (
          <details
            key={item.question}
            className="group rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium text-slate-100">
              <span>{item.question}</span>
              <span className="ml-3 text-xs text-slate-500 transition-transform group-open:rotate-90">
                ›
              </span>
            </summary>
            <p className="mt-2 text-xs leading-relaxed text-slate-300">
              {item.answer}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}
