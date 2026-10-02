import { after, NextResponse } from "next/server";
import { runTick } from "@/lib/earnings/jobs";

/**
 * POST /api/jobs/tick — one unit of scheduled pipeline work.
 *
 * Called every 15 minutes by pg_cron (via pg_net) with the shared secret.
 * Responds 202 immediately and does the work in `after()`, so the caller's
 * HTTP timeout never cuts a run short. The work itself is bounded by
 * TICK_BUDGET_MS, comfortably inside the function's maxDuration.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const TICK_BUDGET_MS = 240_000;

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
      const stats = await runTick(TICK_BUDGET_MS);
      console.log("[tick] done", JSON.stringify(stats));
    } catch (err) {
      console.error("[tick] failed:", err);
    }
  });

  return NextResponse.json({ accepted: true }, { status: 202 });
}
