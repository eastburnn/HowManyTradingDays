import { NextRequest, NextResponse } from "next/server";
import { addTradingDays, getDayInfo, toISODate } from "@/lib/tradingDays";

export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
};

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseISODate(s: string): Date | null {
  if (!ISO_RE.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  if (y < 1950 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, m - 1, d);
  if (date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get("date");
  const daysParam = searchParams.get("days");

  if (!dateParam || daysParam === null) {
    return NextResponse.json(
      { error: "date (YYYY-MM-DD) and days (integer) are required, e.g. ?date=2026-08-21&days=2" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const date = parseISODate(dateParam);
  if (!date) {
    return NextResponse.json(
      { error: "invalid date — use YYYY-MM-DD between 1950 and 2100" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const days = Number(daysParam);
  if (!Number.isInteger(days) || Math.abs(days) > 1000) {
    return NextResponse.json(
      { error: "days must be an integer between -1000 and 1000" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const result = addTradingDays(date, days);
  const resultInfo = getDayInfo(result);

  if (result.getFullYear() < 1950 || result.getFullYear() > 2100) {
    return NextResponse.json(
      { error: "result falls outside the supported range (1950-2100)" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  return NextResponse.json(
    {
      date: dateParam,
      tradingDaysAdded: days,
      result: resultInfo.dateISO,
      resultWeekday: resultInfo.weekday,
      resultIsEarlyClose: resultInfo.isEarlyClose,
      note:
        "Counts trading days strictly after (or before, for negative values) the start date — days=1 from a trade date gives the T+1 settlement date. days=0 returns the nearest trading day on or after the date.",
      source: "https://howmanytradingdays.com",
    },
    { headers: CORS_HEADERS }
  );
}
