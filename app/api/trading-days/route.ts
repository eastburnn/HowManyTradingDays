import { NextRequest, NextResponse } from "next/server";
import {
  countTradingDaysBetween,
  getMonthlyStats,
  getUnscheduledClosuresForYear,
  getUsStockMarketHolidays,
  getYearStats,
  stripTime,
  toISODate,
} from "@/lib/tradingDays";

export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
};

function getCurrentYearET(): number {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
    }).format(new Date())
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const currentYear = getCurrentYearET();

  const yearParam = searchParams.get("year");
  const year = yearParam ? Number(yearParam) : currentYear;

  if (!Number.isInteger(year) || year < 1950 || year > 2100) {
    return NextResponse.json(
      { error: "year must be an integer between 1950 and 2100" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const stats = getYearStats(year);
  const holidays = getUsStockMarketHolidays(year)
    .sort((a, b) => (toISODate(a.date) < toISODate(b.date) ? -1 : 1))
    .map((h) => ({
      date: toISODate(h.date),
      name: h.name.replace(" (early close)", ""),
      status: h.type === "closed" ? "closed" : "early-close",
      ...(h.closeTime ? { closesAtET: h.closeTime } : {}),
    }));

  // Remaining counts only make sense for the current year
  let remaining = null;
  if (year === currentYear) {
    const today = stripTime(new Date());
    const endOfYear = new Date(year, 11, 31);
    const r = countTradingDaysBetween(today, endOfYear);
    remaining = {
      tradingDays: r.tradingDays, // early closes counted as 0.5
      fullDays: r.fullDays,
      halfDays: r.halfDays,
    };
  }

  return NextResponse.json(
    {
      year,
      tradingDays: stats.sessions, // early closes counted as full sessions
      tradingDaysHalfDayAdjusted: stats.halfDayAdjusted,
      weekdays: stats.weekdays,
      marketHolidays: stats.closedHolidays,
      earlyCloseSessions: stats.halfDaySessions,
      remaining,
      months: getMonthlyStats(year).map((m) => ({
        month: m.monthIndex + 1,
        name: m.monthName,
        tradingDays: m.sessions,
      })),
      holidays,
      unscheduledClosures: getUnscheduledClosuresForYear(year).map((c) => ({
        date: c.dateISO,
        reason: c.reason,
      })),
      source: "https://howmanytradingdays.com",
    },
    { headers: CORS_HEADERS }
  );
}
