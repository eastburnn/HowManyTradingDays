/**
 * Outbound email through Resend, sent as hello@howmanytradingdays.com (the
 * domain is verified in Resend). Server-only. Inert until RESEND_API_KEY is
 * set; the contact route stores every message before trying to send, so a
 * missing key or a Resend outage never loses one.
 */

import { Resend } from "resend";
import { topicLabel } from "./contact";

export const CONTACT_FROM = process.env.CONTACT_FROM_EMAIL ?? "HowManyTradingDays <hello@howmanytradingdays.com>";
export const CONTACT_TO = process.env.CONTACT_TO_EMAIL ?? "itschrisray@gmail.com";

let client: Resend | null = null;

export function emailAvailable(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

function getClient(): Resend {
  if (!client) client = new Resend(process.env.RESEND_API_KEY);
  return client;
}

export type ContactMessage = { name: string; email: string; topic: string; message: string };

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

/** Deliver a contact-form message to the inbox; the sender becomes Reply-To */
export async function sendContactEmail(m: ContactMessage): Promise<{ id: string }> {
  const label = topicLabel(m.topic);
  const subject = `[HowManyTradingDays] ${label}: ${m.name}`;
  const text = [
    `From: ${m.name} <${m.email}>`,
    `Topic: ${label}`,
    "",
    m.message,
    "",
    "—",
    "Sent from the contact form at howmanytradingdays.com/contact. Reply to this email to answer directly.",
  ].join("\n");
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111">
      <p><strong>From:</strong> ${escapeHtml(m.name)} &lt;${escapeHtml(m.email)}&gt;<br/>
         <strong>Topic:</strong> ${escapeHtml(label)}</p>
      <p style="white-space:pre-wrap;border-left:3px solid #ddd;padding-left:12px">${escapeHtml(m.message)}</p>
      <p style="color:#777;font-size:13px">Sent from the contact form at howmanytradingdays.com/contact. Reply to this email to answer directly.</p>
    </div>`;

  const { data, error } = await getClient().emails.send({
    from: CONTACT_FROM,
    to: [CONTACT_TO],
    replyTo: m.email,
    subject,
    text,
    html,
  });
  if (error || !data) throw new Error(error?.message ?? "Resend returned no message id");
  return { id: data.id };
}
