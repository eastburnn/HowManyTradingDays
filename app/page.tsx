"use client";

import { useRef } from "react";
import Script from "next/script";
import { domine } from "./fonts";
import ShareButton from "@/components/ShareButton";
import FAQ from "@/components/FAQ";

/* ---------------------------------------------
   DATE + HOLIDAY UTILITIES
----------------------------------------------*/

type HolidayType = "closed" | "half-day";

type Holiday = {
  date: Date;
  name: string;
  type: HolidayType;
  closeTime?: string;
};

type DisplayHoliday = {
  isoDate: string;
  name: string;
  type: HolidayType;
  closeTime?: string;
};

function stripTime(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatDisplayDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function addDays(d: Date, days: number): Date {
  const copy = new Date(d.getTime());
  copy.setDate(copy.getDate() + days);
  return copy;
}

function nthWeekdayOfMonth(
  year: number,
  monthIndex: number,
  weekday: number,
  nth: number
): Date {
  const firstOfMonth = new Date(year, monthIndex, 1);
  const firstWeekday = firstOfMonth.getDay();
  const offset = (weekday - firstWeekday + 7) % 7;
  const day = 1 + offset + 7 * (nth - 1);
  return new Date(year, monthIndex, day);
}

function lastWeekdayOfMonth(
  year: number,
  monthIndex: number,
  weekday: number
): Date {
  const last = new Date(year, monthIndex + 1, 0);
  const d = last.getDay();
  const offset = (d - weekday + 7) % 7;
  return new Date(year, monthIndex + 1, 0 - offset);
}

function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function observedFixedHoliday(
  year: number,
  monthIndex: number,
  day: number
): Date | null {
  const d = new Date(year, monthIndex, day);
  const dow = d.getDay();
  if (dow === 6) d.setDate(day - 1);
  else if (dow === 0) d.setDate(day + 1);
  if (d.getFullYear() !== year) return null;
  return d;
}

function getEasternTime() {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York" })
  );
}

function isAfterMarketCloseET() {
  const nowET = getEasternTime();
  const close = new Date(nowET);
  close.setHours(16, 0, 0, 0); // 4:00 PM ET
  return nowET > close;
}

function isSameDay(d1: Date, d2: Date): boolean {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

/* ---------------------------------------------
   COMPUTE HOLIDAYS FOR A GIVEN YEAR
----------------------------------------------*/

function getUsStockMarketHolidays(year: number): Holiday[] {
  const holidays: Holiday[] = [];

  const newYears = observedFixedHoliday(year, 0, 1);
  if (newYears)
    holidays.push({
      date: newYears,
      name: "New Year's Day",
      type: "closed",
    });

  holidays.push({
    date: nthWeekdayOfMonth(year, 0, 1, 3),
    name: "Martin Luther King Jr. Day",
    type: "closed",
  });

  holidays.push({
    date: nthWeekdayOfMonth(year, 1, 1, 3),
    name: "Presidents' Day",
    type: "closed",
  });

  const easter = easterSunday(year);
  holidays.push({
    date: addDays(easter, -2),
    name: "Good Friday",
    type: "closed",
  });

  holidays.push({
    date: lastWeekdayOfMonth(year, 4, 1),
    name: "Memorial Day",
    type: "closed",
  });

  const juneteenth = observedFixedHoliday(year, 5, 19);
  if (juneteenth)
    holidays.push({
      date: juneteenth,
      name: "Juneteenth National Independence Day",
      type: "closed",
    });

  const independence = observedFixedHoliday(year, 6, 4);
  if (independence)
    holidays.push({
      date: independence,
      name: "Independence Day",
      type: "closed",
    });

  holidays.push({
    date: nthWeekdayOfMonth(year, 8, 1, 1),
    name: "Labor Day",
    type: "closed",
  });

  const thanksgiving = nthWeekdayOfMonth(year, 10, 4, 4);
  holidays.push({
    date: thanksgiving,
    name: "Thanksgiving Day",
    type: "closed",
  });

  const christmas = observedFixedHoliday(year, 11, 25);
  if (christmas)
    holidays.push({
      date: christmas,
      name: "Christmas Day",
      type: "closed",
    });

  /* --- Half Days --- */

  const july3 = new Date(year, 6, 3);
  if (![0, 6].includes(july3.getDay())) {
    const iso = toISODate(july3);
    if (!holidays.some((h) => toISODate(h.date) === iso))
      holidays.push({
        date: july3,
        name: "Day Before Independence Day (early close)",
        type: "half-day",
        closeTime: "13:00",
      });
  }

  const dayAfterThanksgiving = addDays(thanksgiving, 1);
  if (dayAfterThanksgiving.getDay() === 5)
    holidays.push({
      date: dayAfterThanksgiving,
      name: "Day After Thanksgiving (early close)",
      type: "half-day",
      closeTime: "13:00",
    });

  const christmasEve = new Date(year, 11, 24);
  if (![0, 6].includes(christmasEve.getDay())) {
    const iso = toISODate(christmasEve);
    if (!holidays.some((h) => toISODate(h.date) === iso))
      holidays.push({
        date: christmasEve,
        name: "Christmas Eve (early close)",
        type: "half-day",
        closeTime: "13:00",
      });
  }

  return holidays;
}

/* ---------------------------------------------
   CALCULATE TRADING DAYS & UPCOMING HOLIDAYS
----------------------------------------------*/

function calculateTradingDays(fromDate: Date) {
  const today = stripTime(fromDate);
  const year = today.getFullYear();
  const endOfYear = new Date(year, 11, 31);

  const allHolidays = getUsStockMarketHolidays(year);
  const afterClose = isAfterMarketCloseET();

  const holidayMap = new Map<
    string,
    { type: HolidayType; name: string; closeTime?: string }
  >();

  for (const h of allHolidays) {
    holidayMap.set(toISODate(h.date), {
      type: h.type,
      name: h.name,
      closeTime: h.closeTime,
    });
  }

  let fullDays = 0;
  let halfDays = 0;
  const upcoming: DisplayHoliday[] = [];

  let cursor = new Date(today.getTime());
  while (cursor <= endOfYear) {
    const iso = toISODate(cursor);
    const dow = cursor.getDay();
    const hInfo = holidayMap.get(iso);

    if (hInfo) {
      upcoming.push({
        isoDate: iso,
        name: hInfo.name,
        type: hInfo.type,
        closeTime: hInfo.closeTime,
      });
    }

    if (dow !== 0 && dow !== 6) {
      const isToday = isSameDay(cursor, today);

      // If today is a trading day but the market is already closed (after 4pm ET),
      // skip counting today in the "days remaining" total.
      if (isToday && afterClose) {
        // do not count today
      } else {
        if (!hInfo) fullDays += 1;
        else if (hInfo.type === "half-day") halfDays += 1;
      }
    }

    cursor = addDays(cursor, 1);
  }

  upcoming.sort((a, b) => (a.isoDate < b.isoDate ? -1 : 1));

  return {
    year,
    totalTradingDays: fullDays + halfDays * 0.5,
    fullDays,
    halfDays,
    upcoming,
  };
}

/* ---------------------------------------------
   PAGE COMPONENT
----------------------------------------------*/

export default function HomePage() {
  const now = new Date();
  const { year, totalTradingDays, fullDays, halfDays, upcoming } =
    calculateTradingDays(now);

  const cardRef = useRef<HTMLDivElement | null>(null);

  // Mirror your FAQ content here so we can generate FAQPage JSON-LD (helps Google understand the Q&A)
  const faqItems = [
    {
      question:
        "How many trading days are there in a typical year for U.S. markets?",
      answer:
        "Most years have around 252 trading days once weekends and stock-market holidays are removed. The exact number changes depending on where holidays fall. This site calculates the precise number remaining for the current calendar year.",
    },
    {
      question: "How many trading days are in a typical month?",
      answer:
        "Most months have between 19 and 22 trading days. The exact number depends on where weekends and market holidays fall. Months containing major holidays—such as July, November, or December—tend to have fewer trading days. This site only calculates the count for the full calendar year, but monthly totals follow the same pattern of excluding weekends and full U.S. stock-market holidays.",
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
      question:
        "Why does the number sometimes end in .5 instead of a whole number?",
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

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqItems.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center px-4">
      {/* FAQ structured data (JSON-LD) */}
      <Script id="faq-jsonld" type="application/ld+json" strategy="afterInteractive">
        {JSON.stringify(faqJsonLd)}
      </Script>

      <div className="max-w-xl w-full flex flex-col items-center gap-10 py-12">
        {/* TITLE */}
        <header className="text-center space-y-2">
          <h1
            className={`${domine.className} text-3xl sm:text-4xl font-semibold tracking-tight`}
          >
            How Many Trading Days
          </h1>

          {/* Small, keyword-rich helper line for SEO + clarity */}
          <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
            Live countdown of how many U.S. stock market trading days are left in {year}.
            Includes weekdays if it’s before 4pm ET; excludes weekends,
            full holidays, and counts scheduled early-close days as 0.5.
          </p>
        </header>

        {/* MAIN CARD */}
        <section className="w-full">
          <div
            ref={cardRef}
            className="w-full rounded-2xl border border-slate-800 bg-slate-900/70 shadow-xl p-8 sm:p-8 flex flex-col items-center gap-3"
          >
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
              Trading Days Left in {year}
            </p>

            <div className="flex flex-col items-center">
              <span className="text-6xl sm:text-7xl font-semibold tabular-nums">
                {totalTradingDays.toFixed(1)}
              </span>
              <span className="text-xs text-slate-400"></span>
            </div>

            <div className="flex gap-4 text-xs text-slate-400 mt-1">
              <div className="flex flex-col items-center">
                <span className="text-sm font-semibold text-slate-100 tabular-nums">
                  {fullDays}
                </span>
                <span>full days</span>
              </div>
              <div className="h-8 w-px bg-slate-800" />
              <div className="flex flex-col items-center">
                <span className="text-sm font-semibold text-slate-100 tabular-nums">
                  {halfDays}
                </span>
                <span>half days</span>
              </div>
            </div>
          </div>
        </section>

        {/* SHARE BUTTON */}
        <div className="w-full flex justify-center -mt-8">
          <ShareButton cardRef={cardRef} />
        </div>

        {/* UPCOMING HOLIDAYS */}
        <section className="w-full">
          <h2 className="text-sm font-medium text-slate-200 mb-3">
            Upcoming market holidays &amp; half days
          </h2>

          {upcoming.length === 0 ? (
            <p className="text-xs text-slate-500">
              No remaining NYSE/Nasdaq holidays or half days for the rest of the
              year.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {upcoming.map((h) => (
                <li
                  key={h.isoDate + h.name}
                  className="flex items-start justify-between rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2"
                >
                  <div className="flex flex-col">
                    <span className="font-medium text-slate-100">{h.name}</span>
                    <span className="text-xs text-slate-400">
                      {formatDisplayDate(h.isoDate)}
                    </span>
                  </div>
                  <div className="text-right text-xs">
                    {h.type === "closed" ? (
                      <span className="inline-flex items-center rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-300">
                        Closed
                      </span>
                    ) : (
                      <div className="flex flex-col items-end gap-1">
                        <span className="inline-flex items-center rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200">
                          Half day
                        </span>
                        {h.closeTime && (
                          <span className="text-[10px] text-slate-400">
                            Closes early at {h.closeTime} ET
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-3 text-[10px] text-slate-500 leading-relaxed">
            Calendar is based on standard NYSE/Nasdaq U.S. stock market holidays
            and common 1 p.m. early closes. Weekends are handled automatically
            and not shown here.
          </p>
        </section>

        {/* FAQ */}
        <FAQ />

        {/* FOOTER */}
        <footer className="mt-4 text-[10px] text-slate-500 text-center space-y-1">
          <p>
            HowManyTradingDays.com · U.S. equity markets only · For informational
            purposes only.
          </p>

          {/* NEW LINE BELOW */}
          <p className="flex items-center justify-center gap-2 text-[10px] text-slate-500">
            Made by{" "}
            <a
              href="https://www.itschrisray.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline text-slate-400 hover:text-slate-300"
            >
              itschrisray.com
            </a>

            {/* Divider dot */}
            <span className="text-slate-700">•</span>

            {/* X Profile (with your X logo image) */}
            <a
              href="https://x.com/itschrisray"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 hover:opacity-80 transition"
            >
              <img
                src="/twitter.png" // replace this with your actual local logo filename
                alt="X Logo"
                className="h-3 w-3 opacity-70"
              />
              <span className="text-slate-400 hover:text-slate-300">
                @itschrisray
              </span>
            </a>
          </p>
        </footer>
      </div>
    </main>
  );
}