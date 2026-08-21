import { NextResponse } from "next/server";
import { getMarketStatus } from "@/lib/tradingDays";

export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET() {
  const s = getMarketStatus();

  return NextResponse.json(
    {
      isOpen: s.isOpen,
      isTradingDay: s.isTradingDay,
      isEarlyClose: s.isEarlyClose,
      closesAtET: s.isTradingDay ? s.closeTimeET : null,
      closedReason: s.isOpen
        ? null
        : s.reason === "before-open" || s.reason === "after-close" || s.reason === "weekend"
        ? s.reason
        : `holiday: ${s.reason}`,
      nextSessionDate: s.nextOpenISO,
      opensAtET: "09:30",
      timezone: "America/New_York",
      source: "https://howmanytradingdays.com",
    },
    { headers: CORS_HEADERS }
  );
}
