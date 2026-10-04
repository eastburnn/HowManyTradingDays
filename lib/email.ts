/**
 * Outbound email through Resend, sent as hello@howmanytradingdays.com (the
 * domain is verified in Resend). Server-only. Inert until RESEND_API_KEY is
 * set; the contact route stores every message before trying to send, so a
 * missing key or a Resend outage never loses one.
 *
 * Every message uses the same branded template as the site: the dark slate
 * canvas, a serif wordmark, uppercase tracked labels, and the blue accent.
 * Table layout and inline styles, so it survives Gmail, Outlook and Apple
 * Mail; explicit colors on every element keep it legible in dark mode.
 */

import { Resend } from "resend";
import { topicLabel } from "./contact";

export const CONTACT_FROM = process.env.CONTACT_FROM_EMAIL ?? "How Many Trading Days <hello@howmanytradingdays.com>";
export const CONTACT_TO = process.env.CONTACT_TO_EMAIL ?? "itschrisray@gmail.com";

const SITE = "https://howmanytradingdays.com";

// The site's palette (Tailwind slate/blue) as hex, since email can't use CSS variables
const C = {
  canvas: "#020617", // slate-950, the page background
  card: "#0f172a", // slate-900
  inset: "#020617",
  border: "#1e293b", // slate-800
  text: "#f8fafc", // slate-50
  body: "#e2e8f0", // slate-200
  muted: "#94a3b8", // slate-400
  faint: "#64748b", // slate-500
  accent: "#93c5fd", // blue-300
  accentBg: "#172554", // blue-950
  accentBorder: "#3b82f6", // blue-500
};
const SERIF = "Domine, Georgia, 'Times New Roman', serif";
const SANS = "Arial, Helvetica, sans-serif";

let client: Resend | null = null;

export function emailAvailable(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

function getClient(): Resend {
  if (!client) client = new Resend(process.env.RESEND_API_KEY);
  return client;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

export type BrandedEmail = {
  /** Small uppercase line above the heading, e.g. "Contact form" */
  eyebrow: string;
  heading: string;
  /** Hidden preview text shown by inbox clients next to the subject */
  preheader?: string;
  /** Label/value rows shown under the heading */
  meta?: { label: string; value: string; href?: string }[];
  /** Pre-escaped HTML for the main panel */
  bodyHtml: string;
  cta?: { label: string; href: string };
  footerNote?: string;
};

/** The site's look, as an email */
export function renderBrandedEmail(e: BrandedEmail): string {
  const metaRows = (e.meta ?? [])
    .map(
      (m) => `
        <tr>
          <td style="padding:0 16px 0 0;font-family:${SANS};font-size:11px;letter-spacing:.15em;text-transform:uppercase;color:${C.faint};white-space:nowrap;vertical-align:top;line-height:22px;">${escapeHtml(m.label)}</td>
          <td style="font-family:${SANS};font-size:15px;color:${C.text};line-height:22px;">${
            m.href ? `<a href="${escapeHtml(m.href)}" style="color:${C.accent};text-decoration:none;">${escapeHtml(m.value)}</a>` : escapeHtml(m.value)
          }</td>
        </tr>`
    )
    .join("");

  const cta = e.cta
    ? `
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:20px;">
        <tr>
          <td style="background:${C.accentBg};border:1px solid ${C.accentBorder};border-radius:10px;">
            <a href="${escapeHtml(e.cta.href)}" style="display:inline-block;padding:10px 18px;font-family:${SANS};font-size:14px;font-weight:bold;color:${C.accent};text-decoration:none;">${escapeHtml(e.cta.label)}</a>
          </td>
        </tr>
      </table>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark light">
  <meta name="supported-color-schemes" content="dark light">
  <title>${escapeHtml(e.heading)}</title>
</head>
<body style="margin:0;padding:0;background:${C.canvas};">
  ${e.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.canvas};">${escapeHtml(e.preheader)}</div>` : ""}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.canvas};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
          <tr>
            <td style="padding:0 4px 18px;">
              <a href="${SITE}" style="font-family:${SERIF};font-size:18px;font-weight:bold;color:${C.text};text-decoration:none;">How Many Trading Days</a>
              <div style="margin-top:6px;font-family:${SANS};font-size:11px;letter-spacing:.15em;text-transform:uppercase;color:${C.faint};">${escapeHtml(e.eyebrow)}</div>
            </td>
          </tr>
          <tr>
            <td style="background:${C.card};border:1px solid ${C.border};border-radius:16px;padding:24px;">
              <h1 style="margin:0 0 ${metaRows ? "16px" : "12px"};font-family:${SERIF};font-size:22px;line-height:1.3;font-weight:bold;color:${C.text};">${escapeHtml(e.heading)}</h1>
              ${metaRows ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">${metaRows}</table>` : ""}
              <div style="background:${C.inset};border:1px solid ${C.border};border-radius:12px;padding:16px;font-family:${SANS};font-size:15px;line-height:1.6;color:${C.body};">${e.bodyHtml}</div>
              ${cta}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 8px 0;font-family:${SANS};font-size:11px;line-height:1.6;color:${C.faint};">
              ${e.footerNote ? escapeHtml(e.footerNote) + "<br>" : ""}
              <a href="${SITE}" style="color:${C.faint};text-decoration:underline;">howmanytradingdays.com</a> &middot; Live reference for U.S. stock market trading days, holidays, and market hours.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export type SubscriptionPrompt = { from: string; subject: string; links: string[]; excerpt: string };

/**
 * An investor-relations list wants its sign-up confirmed. The confirmation
 * links go to the inbox so a person can click them; the alert address itself
 * has no mailbox.
 */
export async function sendSubscriptionPrompt(p: SubscriptionPrompt): Promise<{ id: string }> {
  const subject = `[HowManyTradingDays] Confirm IR alerts: ${p.from}`.slice(0, 200);
  const text = [
    `HOW MANY TRADING DAYS / IR EMAIL ALERTS`,
    ``,
    `A subscription confirmation arrived at the alerts address.`,
    `From:    ${p.from}`,
    `Subject: ${p.subject}`,
    ``,
    p.links.length ? `Links:\n${p.links.map((l) => `  ${l}`).join("\n")}` : `No links were found in the message; the excerpt is below.`,
    ``,
    p.excerpt,
  ].join("\n");
  const linkRows = p.links.length
    ? `<ol style="margin:0;padding-left:20px;">${p.links.map((l) => `<li style="margin:0 0 8px;"><a href="${escapeHtml(l)}" style="color:${C.accent};">${escapeHtml(l)}</a></li>`).join("")}</ol>`
    : `<p style="margin:0;">No links were found in the message.</p>`;
  const html = renderBrandedEmail({
    eyebrow: "IR email alerts",
    heading: "A list wants its sign-up confirmed",
    preheader: p.subject.slice(0, 110),
    meta: [
      { label: "From", value: p.from },
      { label: "Subject", value: p.subject },
    ],
    bodyHtml: `${linkRows}<div style="margin-top:16px;white-space:pre-wrap;color:${C.muted};">${escapeHtml(p.excerpt)}</div>`,
    cta: p.links[0] ? { label: "Open the first link", href: p.links[0] } : undefined,
    footerNote: "Forwarded from alerts@howmanytradingdays.com, which has no mailbox of its own.",
  });
  const { data, error } = await getClient().emails.send({ from: CONTACT_FROM, to: [CONTACT_TO], subject, text, html });
  if (error || !data) throw new Error(error?.message ?? "Resend returned no message id");
  return { id: data.id };
}

export type ContactMessage = { name: string; email: string; topic: string; message: string };

/** Deliver a contact-form message to the inbox; the sender becomes Reply-To */
export async function sendContactEmail(m: ContactMessage): Promise<{ id: string }> {
  const label = topicLabel(m.topic);
  const subject = `[HowManyTradingDays] ${label}: ${m.name}`;
  const received = new Date().toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }) + " ET";

  const text = [
    `HOW MANY TRADING DAYS / CONTACT FORM`,
    ``,
    `From:  ${m.name} <${m.email}>`,
    `Topic: ${label}`,
    `Received: ${received}`,
    ``,
    m.message,
    ``,
    `----------`,
    `Sent from the contact form at ${SITE}/contact. Reply to this email to answer ${m.name} directly.`,
  ].join("\n");

  const html = renderBrandedEmail({
    eyebrow: "Contact form",
    heading: `${label} from ${m.name}`,
    preheader: m.message.slice(0, 110),
    meta: [
      { label: "From", value: m.name },
      { label: "Email", value: m.email, href: `mailto:${m.email}` },
      { label: "Topic", value: label },
      { label: "Received", value: received },
    ],
    bodyHtml: `<div style="white-space:pre-wrap;">${escapeHtml(m.message)}</div>`,
    cta: { label: `Reply to ${m.name.split(" ")[0]}`, href: `mailto:${m.email}?subject=${encodeURIComponent(`Re: ${label} (How Many Trading Days)`)}` },
    footerNote: `Sent from the contact form at ${SITE.replace("https://", "")}/contact. Replying to this email goes to the sender.`,
  });

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
