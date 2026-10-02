import { NextResponse } from "next/server";
import { checkHealth } from "@/lib/earnings/jobs";

/**
 * GET /api/jobs/health — pipeline liveness for an external uptime monitor.
 * 200 when every check passes, 503 with the list of problems otherwise.
 * Exposes only aggregate counts.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const health = await checkHealth();
    return NextResponse.json(health, {
      status: health.ok ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, problems: [`health check failed: ${(err as Error).message}`] },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
