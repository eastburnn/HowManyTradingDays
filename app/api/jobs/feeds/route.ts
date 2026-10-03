import { after, NextResponse } from "next/server";
import { runFeeds } from "@/lib/earnings/jobs";

/**
 * POST /api/jobs/feeds — poll the press-wire feeds and record any newly
 * announced earnings dates. Called every 5 minutes by pg_cron; the 15-minute
 * tick also runs the same step, so a missed call costs nothing.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function authorized(req: Request): boolean {
  const secret = process.env.JOBS_SECRET;
  if (!secret) return false;
  const header = req.headers.get("x-jobs-secret") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return header === secret;
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  after(async () => {
    try {
      const stats = await runFeeds();
      console.log("[feeds] done", JSON.stringify(stats));
    } catch (err) {
      console.error("[feeds] failed:", err);
    }
  });
  return NextResponse.json({ accepted: true }, { status: 202 });
}
