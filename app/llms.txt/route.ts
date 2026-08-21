import {
  countTradingDaysBetween,
  getUsStockMarketHolidays,
  getYearStats,
  stripTime,
  toISODate,
} from "@/lib/tradingDays";
import { HOLIDAY_PAGES } from "@/lib/holidayPages";

// Regenerate daily so the year and live counts stay current
export const revalidate = 86400;

function getCurrentYearET(): number {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
    }).format(new Date())
  );
}

export async function GET() {
  const year = getCurrentYearET();
  const stats = getYearStats(year);
  const remaining = countTradingDaysBetween(stripTime(new Date()), new Date(year, 11, 31));
  const holidays = getUsStockMarketHolidays(year)
    .sort((a, b) => (toISODate(a.date) < toISODate(b.date) ? -1 : 1));

  const holidayList = holidays
    .map(
      (h) =>
        `- ${toISODate(h.date)} — ${h.name.replace(" (early close)", "")}: ${
          h.type === "closed" ? "market closed" : "early close at 1:00 p.m. ET"
        }`
    )
    .join("\n");

  const holidayPageList = HOLIDAY_PAGES.map(
    (h) =>
      `- [Is the Stock Market Open on ${h.name}?](https://howmanytradingdays.com/is-the-stock-market-open/${h.slug}): ${
        h.shortAnswer === "closed"
          ? "No — market holiday."
          : h.shortAnswer === "early-close"
          ? "Yes, with a 1:00 p.m. ET early close."
          : "Yes — markets are open."
      }`
  ).join("\n");

  const body = `# How Many Trading Days

> HowManyTradingDays.com is a live reference for U.S. stock market (NYSE/Nasdaq) trading days. It answers: how many trading days are left in the current year, how many trading days are in any year or month, whether the market is open today or on a specific holiday, and the full market holiday schedule. All data is computed algorithmically from official NYSE/Nasdaq calendar rules, so it stays accurate year over year. A free JSON API exposes the same data.

## Key facts (current as of ${year})

- There are ${stats.sessions} trading days in ${year} (counting early-close sessions as full days, the standard convention).
- Counting early closes as half days instead, ${year} has ${stats.halfDayAdjusted} trading days.
- ${year} has ${stats.weekdays} weekdays, ${stats.closedHolidays} full market holidays, and ${stats.halfDaySessions} early-close sessions.
- Trading days remaining in ${year}: ${remaining.tradingDays} (this figure counts today until 4:00 p.m. ET and early closes as 0.5).
- A typical year has 250-253 trading days; months have 19-23 (about 21 on average).
- Regular session hours: 9:30 a.m. - 4:00 p.m. ET. Early-close sessions end at 1:00 p.m. ET.

## ${year} market holiday schedule

${holidayList}

## Pages

- [Home — live countdown](https://howmanytradingdays.com/): Live count of trading days left in the current year, live market open/closed status, and upcoming holidays. Updates in real time relative to the 4:00 p.m. ET close.
- [Trading Days in a Year](https://howmanytradingdays.com/trading-days-in-a-year): Exact trading-day totals for the current and surrounding years, plus a month-by-month table.
- [Trading Days by Year, 1990-2030](https://howmanytradingdays.com/trading-days-by-year): Historical trading-day counts for every year since 1990, adjusted for unscheduled closures (9/11, Hurricane Sandy, presidential days of mourning) and for holiday-calendar changes (MLK Day added 1998, Juneteenth added 2022).
- [Stock Market Holidays](https://howmanytradingdays.com/stock-market-holidays): Full NYSE/Nasdaq holiday schedule for this year and next, including early-close days and weekend-observance rules.
- [Is the Stock Market Open?](https://howmanytradingdays.com/is-the-stock-market-open): Live market status, regular/extended hours, and per-holiday answers.
- [Trading Days Calculator](https://howmanytradingdays.com/calculator): Count trading days and calendar days between today (or any start date) and a target date.
- [About](https://howmanytradingdays.com/about): How the site counts trading days and handles holidays.

## Per-holiday pages

${holidayPageList}

## Free JSON API

No API key required. CORS enabled. Free for personal and commercial use; attribution with a link to howmanytradingdays.com is appreciated. Full documentation with examples: https://howmanytradingdays.com/api-docs

- GET https://howmanytradingdays.com/api/trading-days — trading-day totals, month-by-month counts, holiday calendar, and (for the current year) remaining days. Optional ?year= parameter (1950-2100). Example fields: tradingDays, tradingDaysHalfDayAdjusted, weekdays, marketHolidays, earlyCloseSessions, remaining, months[], holidays[].
- GET https://howmanytradingdays.com/api/market-status — whether U.S. equity markets are open right now. Example fields: isOpen, isTradingDay, isEarlyClose, closesAtET, closedReason, nextSessionDate, opensAtET.
- GET https://howmanytradingdays.com/api/count?from=YYYY-MM-DD&to=YYYY-MM-DD — count trading days between two dates (inclusive). Example fields: tradingDays, fullDays, halfDays, calendarDays.
- GET https://howmanytradingdays.com/api/is-trading-day?date=YYYY-MM-DD — whether a date is a trading session (defaults to today ET). Example fields: isTradingDay, isEarlyClose, holiday, closesAtET, previousTradingDay, nextTradingDay.
- GET https://howmanytradingdays.com/api/offset?date=YYYY-MM-DD&days=N — add or subtract N trading days from a date (settlement math, e.g. days=1 gives the T+1 settlement date). Example fields: result, resultWeekday, resultIsEarlyClose.

## Conventions and scope

- U.S. equity markets only (NYSE/Nasdaq regular sessions); no futures, crypto, or non-U.S. exchanges.
- All times are U.S. Eastern Time.
- Holidays follow the official NYSE/Nasdaq schedule, including observed dates when holidays fall on weekends. Scheduled closures only — unscheduled closures (e.g. days of mourning) are not modeled.
- Two counting conventions are shown where relevant: early closes as full sessions (standard, ~252/year) and early closes as 0.5 (used by the live countdown).

Made by Chris Ray (https://www.itschrisray.com). Contact: https://x.com/itschrisray
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=86400",
    },
  });
}
