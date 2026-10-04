/**
 * POST /api/inbound/ir?key=…   Forward Email webhook for alerts@howmanytradingdays.com
 *
 * Accepts only requests carrying the shared key that also come from Forward
 * Email's servers (the key is visible in public DNS, so the address check is
 * the real guard). ?dry=1 reports what would happen without writing anything.
 * A 5xx tells Forward Email to retry later; everything else answers 200 so a
 * message is never bounced back to a company's alert system.
 */

import { NextResponse } from "next/server";
import { type InboundMessage, fromForwardEmail, handleInboundEmail } from "@/lib/earnings/inboundEmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function clientIp(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip");
}

export async function POST(req: Request) {
  const secret = process.env.INBOUND_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "inbound email is not configured" }, { status: 503 });
  const url = new URL(req.url);
  if (url.searchParams.get("key") !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const ip = clientIp(req);
  if (!(await fromForwardEmail(ip))) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let message: InboundMessage;
  try {
    message = (await req.json()) as InboundMessage;
  } catch {
    return NextResponse.json({ error: "expected a JSON body" }, { status: 400 });
  }

  try {
    const outcome = await handleInboundEmail(message, { dry: url.searchParams.get("dry") === "1" });
    return NextResponse.json({ ok: true, ...outcome });
  } catch (err) {
    console.error("[inbound] failed:", (err as Error).message);
    return NextResponse.json({ error: "temporary failure, retry later" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, configured: Boolean(process.env.INBOUND_WEBHOOK_SECRET), method: "POST" });
}
