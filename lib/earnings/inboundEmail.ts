/**
 * Investor-relations alert emails, received as webhooks.
 *
 * A dedicated address (alerts@howmanytradingdays.com) is subscribed to the
 * email alerts of companies whose dates reach us no other way: Business Wire
 * users and companies that publish only on their own sites. Forward Email
 * turns each message into a JSON POST (mailparser's simpleParser shape). The
 * handler verifies the request really came from Forward Email, works out
 * which company the message is about, and stages it as a feed item (feed
 * 'ir-email') for the same advisory parser that reads the wires. Sign-up
 * confirmation emails are not staged: their links are forwarded to the
 * inbox so a person can click them.
 *
 * Server-only.
 */

import { promises as dns } from "node:dns";
import { createHash } from "node:crypto";
import { query } from "./db";
import { type ParsedAdvisory, parseAdvisory, parseTickers } from "./confirm";
import { resolveCik, stageItems } from "./confirmJob";
import type { FeedItem } from "./wires";
import { emailAvailable, sendSubscriptionPrompt } from "@/lib/email";

export const INBOUND_FEED = "ir-email";

/* ---------------------------------------------
   SENDER VERIFICATION
----------------------------------------------*/

const IP_LIST_URL = "https://forwardemail.net/ips.txt";
const IP_LIST_TTL_MS = 12 * 3600_000;
let ipList: { ips: Set<string>; fetchedAt: number } | null = null;

async function forwardEmailIps(): Promise<Set<string>> {
  if (ipList && Date.now() - ipList.fetchedAt < IP_LIST_TTL_MS) return ipList.ips;
  const res = await fetch(IP_LIST_URL, { headers: { "User-Agent": "HowManyTradingDays.com (hello@howmanytradingdays.com)" } });
  if (!res.ok) throw new Error(`ip list ${res.status}`);
  const ips = new Set(
    (await res.text())
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
  );
  ipList = { ips, fetchedAt: Date.now() };
  return ips;
}

/** True when the request's client address belongs to Forward Email: in their published list, or reverse-resolving to their hosts. */
export async function fromForwardEmail(ip: string | null): Promise<boolean> {
  if (process.env.INBOUND_TRUST_ANY_IP === "1" && process.env.NODE_ENV !== "production") return true;
  if (!ip) return false;
  try {
    if ((await forwardEmailIps()).has(ip)) return true;
  } catch (err) {
    console.error("[inbound] ip list unavailable:", (err as Error).message);
  }
  try {
    const hosts = await dns.reverse(ip);
    for (const host of hosts) {
      if (!/\.forwardemail\.net$/i.test(host)) continue;
      const forward = await dns.lookup(host, { all: true });
      if (forward.some((a) => a.address === ip)) return true;
    }
  } catch {
    // no reverse record: not theirs
  }
  return false;
}

/* ---------------------------------------------
   THE MESSAGE
----------------------------------------------*/

type Address = { address?: string; name?: string };
export type InboundMessage = {
  subject?: string;
  text?: string;
  html?: string;
  date?: string;
  messageId?: string;
  from?: { value?: Address[]; text?: string };
  session?: { recipient?: string; remoteAddress?: string; clientHostname?: string };
};

const stripHtml = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>|<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();

function bodyText(m: InboundMessage): string {
  const text = (m.text ?? "").trim();
  if (text) return text;
  return m.html ? stripHtml(m.html) : "";
}

function links(m: InboundMessage): string[] {
  const out = new Set<string>();
  for (const match of (m.html ?? "").matchAll(/href="(https?:\/\/[^"]+)"/gi)) out.add(match[1]);
  for (const match of (m.text ?? "").matchAll(/https?:\/\/[^\s<>"')]+/g)) out.add(match[0]);
  return [...out].filter((u) => !/unsubscribe|optout|opt-out|preferences/i.test(u));
}

/** Double opt-in and similar: a person has to click, so these go to the inbox, not the parser. */
export function isSubscriptionPrompt(subject: string, text: string): boolean {
  const s = `${subject}\n${text.slice(0, 1500)}`;
  return (
    /\b(confirm|verify|validate|activate|complete)\b[^.\n]{0,60}\b(subscription|registration|sign-?up|email|e-mail|address|alerts?)\b/i.test(s) ||
    /\b(double opt-?in|click (the link|here|below) to (confirm|verify|activate))\b/i.test(s) ||
    /^(please )?(confirm|verify) your/i.test(subject)
  );
}

const VENDOR_DOMAINS = new Set([
  "q4inc.com",
  "q4web.com",
  "notified.com",
  "intrado.com",
  "globenewswire.com",
  "prnewswire.com",
  "businesswire.com",
  "investorroom.com",
  "irdirect.net",
  "icrinc.com",
  "mailchimp.com",
  "sendgrid.net",
  "constantcontact.com",
  "campaign-archive.com",
]);

const registrable = (host: string) => {
  const parts = host.toLowerCase().split(".").filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join(".") : host.toLowerCase();
};

/** Which company the message is about, trying the sender's domain, the sender's name, the subject, then any ticker mentioned. */
export async function identifyCompany(m: InboundMessage, text: string): Promise<{ cik: number; ticker: string; how: string } | null> {
  const sender = m.from?.value?.[0] ?? {};
  const domain = sender.address?.split("@")[1];
  if (domain && !VENDOR_DOMAINS.has(registrable(domain))) {
    const rows = await query<{ cik: number; ticker: string }>(
      `select s.cik, c.ticker from ir_sources s join companies c on c.cik = s.cik
        where c.active and s.host is not null and lower(s.host) like $1`,
      [`%${registrable(domain)}`]
    );
    if (rows.length === 1) return { ...rows[0], how: "sender domain" };
  }
  const senderName = (sender.name ?? m.from?.text ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/\b(investor relations|investors?|ir|alerts?|news(room)?|communications|corporate|team)\b/gi, " ")
    .replace(/[|:-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (senderName.length >= 3) {
    const hit = await resolveCik({ companyName: senderName, tickers: [] } as unknown as ParsedAdvisory);
    if (hit) return { ...hit, how: "sender name" };
  }
  const subject = m.subject ?? "";
  const outcome = parseAdvisory(subject, text, m.date ?? new Date().toISOString(), { maxDaysAhead: 400 });
  if (outcome.ok) {
    const hit = await resolveCik(outcome.parsed);
    if (hit) return { ...hit, how: "subject" };
  }
  const tickers = parseTickers(`${subject}\n${text.slice(0, 3000)}`);
  if (tickers.length) {
    const hit = await resolveCik({ companyName: "", tickers } as unknown as ParsedAdvisory);
    if (hit) return { ...hit, how: "ticker in body" };
  }
  return null;
}

/* ---------------------------------------------
   HANDLER
----------------------------------------------*/

export type InboundOutcome =
  | { action: "forwarded-confirmation"; to: string; links: string[] }
  | { action: "staged"; cik: number | null; ticker: string | null; how: string | null; guid: string }
  | { action: "duplicate"; guid: string }
  | { action: "empty" };

export async function handleInboundEmail(m: InboundMessage, opts: { dry?: boolean } = {}): Promise<InboundOutcome> {
  const subject = (m.subject ?? "").trim();
  const text = bodyText(m);
  if (!subject && !text) return { action: "empty" };

  if (isSubscriptionPrompt(subject, text)) {
    const found = links(m).slice(0, 5);
    if (!opts.dry && emailAvailable()) {
      await sendSubscriptionPrompt({ from: m.from?.text ?? m.from?.value?.[0]?.address ?? "unknown sender", subject, links: found, excerpt: text.slice(0, 600) });
    }
    return { action: "forwarded-confirmation", to: "inbox", links: found };
  }

  const company = await identifyCompany(m, text);
  const guid =
    m.messageId?.trim() ||
    createHash("sha256").update(`${m.from?.text ?? ""}|${subject}|${m.date ?? ""}|${text.slice(0, 200)}`).digest("hex");
  const item: FeedItem = {
    guid,
    title: subject || text.split("\n")[0].slice(0, 200),
    link: null,
    description: text.slice(0, 4000),
    publishedAt: m.date ? new Date(m.date).toISOString() : new Date().toISOString(),
    cik: company?.cik,
  };
  if (opts.dry) return { action: "staged", cik: company?.cik ?? null, ticker: company?.ticker ?? null, how: company?.how ?? null, guid };
  const inserted = await stageItems(INBOUND_FEED, [item]);
  if (inserted === 0) return { action: "duplicate", guid };
  return { action: "staged", cik: company?.cik ?? null, ticker: company?.ticker ?? null, how: company?.how ?? null, guid };
}
