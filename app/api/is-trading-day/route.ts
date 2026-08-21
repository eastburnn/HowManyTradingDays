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

function todayET(): Date {
  const nowET = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York" })
  );
  return new Date(nowET.getFullYear(), nowET.getMonth(), nowET.getDate());
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get("date");

  let date: Date | null;
  if (dateParam) {
    date = parseISODate(dateParam);
    if (!date) {
      return NextResponse.json(
        { error: "invalid date — use YYYY-MM-DD between 1950 and 2100" },
        { status: 400, headers: CORS_HEADERS }
      );
    }
  } else {
    date = todayET(); // defaults to today in Eastern Time
  }

  const info = getDayInfo(date);

  return NextResponse.json(
    {
      date: info.dateISO,
      weekday: info.weekday,
      isTradingDay: info.isTradingDay,
      isEarlyClose: info.isEarlyClose,
      holiday: info.holidayName,
      closesAtET: info.isTradingDay ? (info.isEarlyClose ? "13:00" : "16:00") : null,
      previousTradingDay: toISODate(addTradingDays(date, -1)),
      nextTradingDay: toISODate(addTradingDays(date, 1)),
      source: "https://howmanytradingdays.com",
    },
    { headers: CORS_HEADERS }
  );
}
