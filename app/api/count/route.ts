import { NextRequest, NextResponse } from "next/server";
import { countTradingDaysBetween } from "@/lib/tradingDays";

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
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");

  if (!fromParam || !toParam) {
    return NextResponse.json(
      { error: "from and to are required, as YYYY-MM-DD (years 1950-2100)" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const from = parseISODate(fromParam);
  const to = parseISODate(toParam);
  if (!from || !to) {
    return NextResponse.json(
      { error: "invalid date — use YYYY-MM-DD between 1950 and 2100" },
      { status: 400, headers: CORS_HEADERS }
    );
  }
  if (to < from) {
    return NextResponse.json(
      { error: "to must not be before from" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const r = countTradingDaysBetween(from, to);

  return NextResponse.json(
    {
      from: fromParam,
      to: toParam,
      tradingDays: r.tradingDays, // early closes counted as 0.5
      fullDays: r.fullDays,
      halfDays: r.halfDays,
      calendarDays: r.calendarDays,
      note:
        "Both endpoints inclusive. If `from` is today (ET) and the market has already closed (after 4:00 p.m. ET), today is not counted.",
      source: "https://howmanytradingdays.com",
    },
    { headers: CORS_HEADERS }
  );
}
