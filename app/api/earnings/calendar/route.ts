import { NextResponse } from "next/server";
import { getEventsInRange } from "@/lib/earnings/queries";
import { MAX_RANGE_DAYS, toCalendarEvent } from "@/lib/earnings/calendar";
import { daysBetweenISO, parseISODate } from "@/lib/earnings/format";
import { toISODate } from "@/lib/tradingDays";
import { todayET } from "@/lib/earnings/ingest";

/**
 * GET /api/earnings/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Every current event in the range (at most 100 days), for the calendar
 * page's "show more" extension and the month view. CDN-cached for ten
 * minutes; the pipeline changes a few dates an hour.
 */

export const dynamic = "force-dynamic";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isValidISO = (s: string) => ISO.test(s) && toISODate(parseISODate(s)) === s;

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  if (!isValidISO(from) || !isValidISO(to) || daysBetweenISO(from, to) < 0 || daysBetweenISO(from, to) > MAX_RANGE_DAYS) {
    return NextResponse.json(
      { error: `from and to must be YYYY-MM-DD dates at most ${MAX_RANGE_DAYS} days apart` },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
  try {
    const rows = await getEventsInRange(from, to);
    return NextResponse.json(
      { from, to, today: todayET(), events: rows.map(toCalendarEvent) },
      { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600" } }
    );
  } catch (err) {
    console.error("[calendar api]", (err as Error).message);
    return NextResponse.json({ error: "temporarily unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
