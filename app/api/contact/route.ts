import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/earnings/db";
import { CONTACT_TOPICS, MESSAGE_MAX, MESSAGE_MIN } from "@/lib/contact";
import { emailAvailable, sendContactEmail } from "@/lib/email";

/**
 * POST /api/contact — the contact form.
 *
 * Validates, applies three quiet spam checks (a honeypot field, a minimum
 * time between the form appearing and being sent, a per-address hourly
 * limit), stores the message, then emails it through Resend. The message
 * is on record before the send, so a failure is reported but never lost.
 */

export const dynamic = "force-dynamic";

const MIN_SECONDS_TO_FILL = 3;
const PER_ADDRESS_PER_HOUR = 5;
const SITE_PER_DAY = 200;

const Body = z.object({
  name: z.string().trim().min(1, "Please add your name").max(120),
  email: z.email("Please enter a valid email address").max(200),
  topic: z.enum(CONTACT_TOPICS.map((t) => t.value) as [string, ...string[]]),
  message: z.string().trim().min(MESSAGE_MIN, `Please write at least ${MESSAGE_MIN} characters`).max(MESSAGE_MAX),
  website: z.string().max(500).optional(), // honeypot: humans never see it; anything in it is a bot
  startedAt: z.number().int().optional(),
});

function ipHash(req: Request): string | null {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip");
  if (!ip) return null;
  return createHash("sha256").update(`${ip}|${process.env.JOBS_SECRET ?? "contact"}`).digest("hex").slice(0, 32);
}

const reply = (status: number, body: Record<string, unknown>) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Is delivery configured? The form shows a plain email link when it is not. */
export async function GET() {
  return reply(200, { enabled: emailAvailable() });
}

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return reply(400, { error: "Invalid request" });
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return reply(400, { error: first?.message ?? "Please check the form", field: first?.path?.[0] ?? null });
  }
  const body = parsed.data;

  // Bots fill the hidden field and submit instantly; say nothing useful either way.
  if (body.website) return reply(200, { ok: true });
  if (body.startedAt && Date.now() - body.startedAt < MIN_SECONDS_TO_FILL * 1000) return reply(200, { ok: true });

  const hash = ipHash(req);
  try {
    const [limits] = await query<{ mine: string; site: string }>(
      `select (select count(*) from contact_messages where ip_hash = $1 and created_at > now() - interval '1 hour') as mine,
              (select count(*) from contact_messages where created_at > now() - interval '1 day') as site`,
      [hash]
    );
    if (Number(limits.mine) >= PER_ADDRESS_PER_HOUR || Number(limits.site) >= SITE_PER_DAY) {
      return reply(429, { error: "Too many messages for now. Please try again in a little while." });
    }

    const [row] = await query<{ id: number }>(
      `insert into contact_messages (name, email, topic, message, ip_hash, user_agent)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [body.name, body.email, body.topic, body.message, hash, (req.headers.get("user-agent") ?? "").slice(0, 300)]
    );

    if (!emailAvailable()) {
      await query(`update contact_messages set status = 'failed', error = 'RESEND_API_KEY not configured' where id = $1`, [row.id]);
      return reply(502, { error: "Email delivery isn't set up yet. Your message was saved; please try again later." });
    }

    try {
      const { id } = await sendContactEmail(body);
      await query(`update contact_messages set status = 'sent', resend_id = $2 where id = $1`, [row.id, id]);
      return reply(200, { ok: true });
    } catch (err) {
      await query(`update contact_messages set status = 'failed', error = $2 where id = $1`, [row.id, (err as Error).message.slice(0, 500)]);
      return reply(502, { error: "Couldn't send your message right now. It was saved; please try again later." });
    }
  } catch (err) {
    console.error("[contact]", (err as Error).message);
    return reply(503, { error: "Something went wrong on our side. Please try again in a moment." });
  }
}
