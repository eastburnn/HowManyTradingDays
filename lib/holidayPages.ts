/* ---------------------------------------------
   DEFINITIONS FOR THE PROGRAMMATIC
   "Is the stock market open on ___?" PAGES
----------------------------------------------*/

import {
  addDays,
  easterSunday,
  getUsStockMarketHolidays,
  lastWeekdayOfMonth,
  nthWeekdayOfMonth,
  observedFixedHoliday,
  toISODate,
} from "./tradingDays";

// What the market does on this day (in a typical year — weekend
// years are resolved per-year via resolveYearStatus below).
export type HolidayAnswer = "closed" | "open" | "early-close";

export type HolidayPageDef = {
  slug: string;
  name: string; // "Veterans Day"
  shortAnswer: HolidayAnswer;
  getDate: (year: number) => Date | null; // observed/relevant date; null if none that year
  blurb: string[]; // explanation paragraphs
  bondMarketClosed?: boolean; // SIFMA-recommended bond market closure
};

const COMMON_OPEN_NOTE =
  "The NYSE and Nasdaq set their own holiday calendars, which differ from the federal holiday schedule that banks, post offices, and government offices follow.";

export const HOLIDAY_PAGES: HolidayPageDef[] = [
  {
    slug: "new-years-day",
    name: "New Year's Day",
    shortAnswer: "closed",
    getDate: (y) => observedFixedHoliday(y, 0, 1),
    blurb: [
      "U.S. stock markets are closed on New Year's Day. It is one of the ten official NYSE and Nasdaq holidays.",
      "When January 1 falls on a Saturday, the exchanges do not observe a substitute day off — markets simply reopen the following Monday. When it falls on a Sunday, markets are closed the following Monday instead.",
    ],
    bondMarketClosed: true,
  },
  {
    slug: "martin-luther-king-jr-day",
    name: "Martin Luther King Jr. Day",
    shortAnswer: "closed",
    getDate: (y) => nthWeekdayOfMonth(y, 0, 1, 3),
    blurb: [
      "U.S. stock markets are closed on Martin Luther King Jr. Day, observed on the third Monday of January. The NYSE and Nasdaq have observed the holiday since 1998.",
    ],
    bondMarketClosed: true,
  },
  {
    slug: "presidents-day",
    name: "Presidents' Day",
    shortAnswer: "closed",
    getDate: (y) => nthWeekdayOfMonth(y, 1, 1, 3),
    blurb: [
      "U.S. stock markets are closed on Presidents' Day (Washington's Birthday), observed on the third Monday of February.",
    ],
    bondMarketClosed: true,
  },
  {
    slug: "good-friday",
    name: "Good Friday",
    shortAnswer: "closed",
    getDate: (y) => addDays(easterSunday(y), -2),
    blurb: [
      "U.S. stock markets are closed on Good Friday, even though it is not a federal holiday. It is one of the oldest traditions on the NYSE calendar — the exchange has closed for Good Friday nearly every year since the 1800s.",
      "Because Good Friday is tied to Easter, its date moves each year — it can fall anywhere from late March to late April.",
    ],
    bondMarketClosed: true,
  },
  {
    slug: "easter-monday",
    name: "Easter Monday",
    shortAnswer: "open",
    getDate: (y) => addDays(easterSunday(y), 1),
    blurb: [
      "Yes — U.S. stock markets are open on Easter Monday. Unlike many European exchanges (London, Frankfurt, Paris), which close for Easter Monday, the NYSE and Nasdaq trade a normal full session.",
      "Note that markets are closed the Friday before (Good Friday), so Easter Monday is the first session after a three-day weekend.",
    ],
  },
  {
    slug: "memorial-day",
    name: "Memorial Day",
    shortAnswer: "closed",
    getDate: (y) => lastWeekdayOfMonth(y, 4, 1),
    blurb: [
      "U.S. stock markets are closed on Memorial Day, observed on the last Monday of May. It marks the unofficial start of summer and is a full market holiday.",
    ],
    bondMarketClosed: true,
  },
  {
    slug: "juneteenth",
    name: "Juneteenth",
    shortAnswer: "closed",
    getDate: (y) => observedFixedHoliday(y, 5, 19),
    blurb: [
      "U.S. stock markets are closed for Juneteenth National Independence Day (June 19). It became a federal holiday in 2021, and the NYSE and Nasdaq began observing it in 2022 — making it the newest holiday on the market calendar.",
    ],
    bondMarketClosed: true,
  },
  {
    slug: "july-4th",
    name: "July 4th (Independence Day)",
    shortAnswer: "closed",
    getDate: (y) => observedFixedHoliday(y, 6, 4),
    blurb: [
      "U.S. stock markets are closed on Independence Day. In addition, when July 3 falls on a weekday, the market closes early at 1:00 p.m. ET the day before the holiday.",
    ],
    bondMarketClosed: true,
  },
  {
    slug: "labor-day",
    name: "Labor Day",
    shortAnswer: "closed",
    getDate: (y) => nthWeekdayOfMonth(y, 8, 1, 1),
    blurb: [
      "U.S. stock markets are closed on Labor Day, observed on the first Monday of September. It is a full market holiday on both the NYSE and Nasdaq.",
    ],
    bondMarketClosed: true,
  },
  {
    slug: "columbus-day",
    name: "Columbus Day",
    shortAnswer: "open",
    getDate: (y) => nthWeekdayOfMonth(y, 9, 1, 2),
    blurb: [
      "Yes — U.S. stock markets are open on Columbus Day (also observed as Indigenous Peoples' Day), the second Monday of October. It is a federal holiday, so banks and government offices are closed, but the NYSE and Nasdaq trade a normal full session.",
      "The bond market, however, is closed — SIFMA recommends a full bond market close on Columbus Day. This is one of the few days when stocks trade but Treasuries do not.",
      COMMON_OPEN_NOTE,
    ],
    bondMarketClosed: true,
  },
  {
    slug: "election-day",
    name: "Election Day",
    shortAnswer: "open",
    getDate: (y) => addDays(nthWeekdayOfMonth(y, 10, 1, 1), 1), // Tuesday after the first Monday of November
    blurb: [
      "Yes — U.S. stock markets are open on Election Day. The NYSE stopped closing for presidential elections after 1980; since 1984, every Election Day has been a normal full trading session.",
      "Election Day falls on the Tuesday after the first Monday of November. Markets are open regular hours (9:30 a.m.–4:00 p.m. ET) regardless of whether it is a presidential or midterm election year.",
    ],
  },
  {
    slug: "veterans-day",
    name: "Veterans Day",
    shortAnswer: "open",
    getDate: (y) => new Date(y, 10, 11),
    blurb: [
      "Yes — U.S. stock markets are open on Veterans Day (November 11). It is a federal holiday, so banks and post offices are closed, but the NYSE and Nasdaq trade a normal full session.",
      "The bond market is the exception: SIFMA recommends a full bond market close on Veterans Day, so Treasuries do not trade even though stocks do.",
      COMMON_OPEN_NOTE,
    ],
    bondMarketClosed: true,
  },
  {
    slug: "thanksgiving",
    name: "Thanksgiving",
    shortAnswer: "closed",
    getDate: (y) => nthWeekdayOfMonth(y, 10, 4, 4),
    blurb: [
      "U.S. stock markets are closed on Thanksgiving Day, the fourth Thursday of November.",
      "The following day (Black Friday), markets are open but close early at 1:00 p.m. ET.",
    ],
    bondMarketClosed: true,
  },
  {
    slug: "black-friday",
    name: "Black Friday",
    shortAnswer: "early-close",
    getDate: (y) => addDays(nthWeekdayOfMonth(y, 10, 4, 4), 1),
    blurb: [
      "Yes — U.S. stock markets are open on Black Friday (the day after Thanksgiving), but only for a shortened session: trading ends early at 1:00 p.m. ET instead of the usual 4:00 p.m.",
      "It is typically one of the lightest-volume sessions of the year, with many traders away for the holiday weekend.",
    ],
  },
  {
    slug: "christmas-eve",
    name: "Christmas Eve",
    shortAnswer: "early-close",
    getDate: (y) => new Date(y, 11, 24),
    blurb: [
      "When Christmas Eve (December 24) falls on a weekday, U.S. stock markets are open for a shortened session that ends at 1:00 p.m. ET. When it falls on a weekend, there is no session at all.",
      "One exception: when Christmas Day falls on a Saturday, the Christmas holiday is observed on Friday, December 24 — in those years the market is fully closed on Christmas Eve.",
    ],
  },
  {
    slug: "christmas",
    name: "Christmas",
    shortAnswer: "closed",
    getDate: (y) => observedFixedHoliday(y, 11, 25),
    blurb: [
      "U.S. stock markets are closed on Christmas Day. When December 25 falls on a Saturday, the holiday is observed the Friday before; when it falls on a Sunday, markets close the following Monday.",
    ],
    bondMarketClosed: true,
  },
  {
    slug: "new-years-eve",
    name: "New Year's Eve",
    shortAnswer: "open",
    getDate: (y) => new Date(y, 11, 31),
    blurb: [
      "Yes — U.S. stock markets are open for a full session on New Year's Eve (December 31) when it falls on a weekday. Unlike Christmas Eve, there is no early close: trading runs the normal 9:30 a.m.–4:00 p.m. ET.",
      "It is the final trading day of the year (when it falls on a weekday), which makes it the deadline for same-year trade dates.",
    ],
  },
];

/* ---------------------------------------------
   PER-YEAR RESOLUTION
   The generic answer can differ in a specific
   year (e.g. Christmas Eve on a Saturday).
----------------------------------------------*/

export type YearStatus = {
  year: number;
  dateISO: string | null;
  weekdayName: string | null;
  status: "closed" | "open" | "early-close" | "weekend" | "none";
  detail: string; // short human-readable status
};

export function resolveYearStatus(def: HolidayPageDef, year: number): YearStatus {
  const date = def.getDate(year);
  if (!date) {
    return { year, dateISO: null, weekdayName: null, status: "none", detail: "Not observed" };
  }

  const iso = toISODate(date);
  const weekdayName = date.toLocaleDateString("en-US", { weekday: "long" });
  const dow = date.getDay();

  // What does the actual market calendar say for that date?
  const holidayOnDate = getUsStockMarketHolidays(year).find(
    (h) => toISODate(h.date) === iso
  );

  if (dow === 0 || dow === 6) {
    return { year, dateISO: iso, weekdayName, status: "weekend", detail: "Falls on a weekend — no session" };
  }
  if (holidayOnDate?.type === "closed") {
    return { year, dateISO: iso, weekdayName, status: "closed", detail: "Market closed" };
  }
  if (holidayOnDate?.type === "half-day") {
    return { year, dateISO: iso, weekdayName, status: "early-close", detail: "Open until 1:00 p.m. ET" };
  }
  return { year, dateISO: iso, weekdayName, status: "open", detail: "Open — regular hours" };
}

export function getHolidayPage(slug: string): HolidayPageDef | undefined {
  return HOLIDAY_PAGES.find((h) => h.slug === slug);
}
