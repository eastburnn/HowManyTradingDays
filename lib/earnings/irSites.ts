/**
 * Company investor-relations sites as a confirmed-date source.
 *
 * Most large companies' IR sites run on one of two platforms that publish
 * RSS feeds: Q4 (`/rss/event.aspx`, `/rss/pressrelease.aspx`) and Investis
 * (`/rss`). The events feed lists upcoming earnings calls with their dates
 * ("10/28/2026 : FedEx Q3 2026 Earnings Call"); the press-release feed
 * carries the same advisories the company put on the wire — including the
 * Business Wire ones no public feed exposes. Every feed is read logged out,
 * with our identified User-Agent, robots.txt honored, one request at a time
 * per host, at most twice a day.
 *
 * Discovery: a company's IR host is found in its own earnings-release
 * exhibit on EDGAR ("investors.example.com", or the corporate domain with
 * the usual investor subdomains tried), then probed for the known feed
 * paths. Results persist in ir_sources; companies with nothing usable are
 * remembered too, and re-checked after a month.
 */

import { SEC_USER_AGENT } from "./edgar";
import { QUARTER_TOKEN, dateMentioned } from "./confirm";
import { parseRss, type FeedItem } from "./wires";
import { query } from "./db";

export type IrPlatform = "q4" | "investis" | "rss" | "none" | "blocked";

export type IrSource = {
  cik: number;
  host: string | null;
  platform: IrPlatform;
  events_url: string | null;
  releases_url: string | null;
};

const FETCH_TIMEOUT_MS = 15_000;
const PAUSE_MS = 1200;
const lastRequestAt = new Map<string, number>();

async function fetchText(url: string): Promise<{ status: number; type: string; text: string }> {
  const host = new URL(url).hostname;
  const wait = (lastRequestAt.get(host) ?? 0) + PAUSE_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt.set(host, Date.now());
  const res = await fetch(url, {
    headers: { "User-Agent": SEC_USER_AGENT, Accept: "application/rss+xml, application/xml, text/xml, text/html;q=0.8" },
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  return { status: res.status, type: (res.headers.get("content-type") ?? "").split(";")[0], text: res.ok ? await res.text() : "" };
}

/* ---------------------------------------------
   ROBOTS.TXT
----------------------------------------------*/

type RobotsRules = { allow: string[]; disallow: string[] };
const robotsCache = new Map<string, RobotsRules>();

/** Rules for our agent (by name) or, failing that, for "*" */
export function parseRobots(text: string, agent: string): RobotsRules {
  const groups: { agents: string[]; allow: string[]; disallow: string[] }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], allow: [], disallow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (current && (key === "allow" || key === "disallow")) {
      if (value) current[key].push(value);
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }
  const mine = groups.find((g) => g.agents.some((a) => a !== "*" && agent.toLowerCase().includes(a)));
  const star = groups.find((g) => g.agents.includes("*"));
  const g = mine ?? star;
  return g ? { allow: g.allow, disallow: g.disallow } : { allow: [], disallow: [] };
}

function ruleMatches(rule: string, path: string): boolean {
  // Prefix match with "*" wildcards and an optional "$" anchor
  const re = new RegExp("^" + rule.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*").replace(/\\\$$/, "$"));
  return re.test(path);
}

export function robotsPathAllowed(rules: RobotsRules, path: string): boolean {
  const longest = (list: string[]) => list.filter((r) => ruleMatches(r, path)).sort((a, b) => b.length - a.length)[0] ?? "";
  const allow = longest(rules.allow);
  const disallow = longest(rules.disallow);
  if (!disallow) return true;
  return allow.length >= disallow.length;
}

export async function robotsAllows(host: string, path: string): Promise<boolean> {
  let rules = robotsCache.get(host);
  if (!rules) {
    rules = { allow: [], disallow: [] };
    try {
      const r = await fetchText(`https://${host}/robots.txt`);
      if (r.status === 200) rules = parseRobots(r.text, "HowManyTradingDays");
    } catch {
      // unreachable robots.txt: treat as allow-all, like crawlers do
    }
    robotsCache.set(host, rules);
  }
  return robotsPathAllowed(rules, path);
}

/* ---------------------------------------------
   DISCOVERY
----------------------------------------------*/

const IR_SUBDOMAINS = ["investors", "ir", "investor", "investorrelations"];
const HOST_RE = /\b((?:investors?|ir|investorrelations|investor-relations|investorcenter)\.[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})\b/gi;
const DOMAIN_RE = /\b(?:https?:\/\/)?(?:www\.)([a-z0-9-]+\.(?:com|net|org|co|io|us))\b/gi;

// Words that say nothing about which company a feed belongs to
const GENERIC_WORDS = new Set([
  "inc", "incorporated", "corp", "corporation", "co", "company", "companies", "ltd", "limited", "plc", "llc", "lp",
  "holdings", "holding", "group", "the", "and", "of", "american", "america", "national", "international", "global",
  "united", "first", "financial", "services", "industries", "technologies", "technology", "systems", "energy",
  "capital", "bancorp", "bank", "trust", "realty", "resources", "partners", "brands", "healthcare", "health",
  "medical", "pharmaceuticals", "therapeutics", "solutions", "properties", "enterprises", "new", "general",
]);

/** Distinctive words of a company name, for matching a feed to the company */
export function nameTokens(name: string): string[] {
  return [...new Set(name.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length >= 4 && !GENERIC_WORDS.has(w)))];
}

/**
 * IR host candidates: hosts named in the company's own release text, then
 * the usual investor subdomains of its corporate domain, of a domain made
 * from its name ("fedex.com") and of its ticker ("slb.com"). Guesses can
 * land on another company's site, so a feed is only accepted once it
 * mentions the company (see discoverIrSource).
 */
export function irHostCandidates(text: string, hints: { name?: string; ticker?: string } = {}): string[] {
  const explicit = [...new Set([...text.matchAll(HOST_RE)].map((m) => m[1].toLowerCase()))];
  const domains = new Map<string, number>();
  for (const m of text.matchAll(DOMAIN_RE)) {
    const d = m[1].toLowerCase();
    if (/\b(sec|businesswire|prnewswire|globenewswire|nasdaq|nyse|linkedin|facebook|twitter|youtube|instagram|q4inc)\./.test(`.${d}`)) continue;
    domains.set(d, (domains.get(d) ?? 0) + 1);
  }
  const top = [...domains.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([d]) => d);
  const guessed: string[] = [];
  const tokens = hints.name ? nameTokens(hints.name) : [];
  const first = tokens[0];
  if (first && first.length >= 4) guessed.push(`${first}.com`);
  if (tokens.length >= 2) guessed.push(`${tokens[0]}${tokens[1]}.com`); // "lambweston.com"
  if (hints.ticker && /^[a-z]{3,5}$/i.test(hints.ticker)) guessed.push(`${hints.ticker.toLowerCase()}.com`);
  const conventional = [...new Set([...top, ...guessed])].flatMap((d) => IR_SUBDOMAINS.map((s) => `${s}.${d}`));
  return [...new Set([...explicit, ...conventional])].slice(0, 14);
}

/** Does feed text (channel title, item titles) mention the company? */
export function feedMentionsCompany(xml: string, hints: { name?: string; ticker?: string }): boolean {
  const titles = [...xml.matchAll(/<title[^>]*>([\s\S]*?)<\/title>/gi)].map((m) => m[1].toLowerCase()).join(" \n ");
  const tokens = hints.name ? nameTokens(hints.name) : [];
  if (tokens.some((t) => titles.includes(t))) return true;
  return Boolean(hints.ticker && new RegExp(`\\b${hints.ticker.toLowerCase()}\\b`).test(titles));
}

const isRss = (r: { status: number; text: string }) => r.status === 200 && /<rss[\s>]|<feed[\s>]/i.test(r.text.slice(0, 2000));

/** Probe one host for a usable feed. Null when the host does not answer. */
export async function probeIrHost(host: string): Promise<Omit<IrSource, "cik"> | null> {
  try {
    if (!(await robotsAllows(host, "/rss/event.aspx")) || !(await robotsAllows(host, "/rss"))) {
      return { host, platform: "blocked", events_url: null, releases_url: null };
    }
    const q4 = await fetchText(`https://${host}/rss/event.aspx`);
    if (q4.status === 403) return { host, platform: "blocked", events_url: null, releases_url: null };
    if (isRss(q4)) {
      return { host, platform: "q4", events_url: `https://${host}/rss/event.aspx`, releases_url: `https://${host}/rss/pressrelease.aspx` };
    }
    const inv = await fetchText(`https://${host}/rss`);
    if (isRss(inv)) return { host, platform: "investis", events_url: null, releases_url: `https://${host}/rss` };
    const home = await fetchText(`https://${host}/`);
    if (home.status === 403) return { host, platform: "blocked", events_url: null, releases_url: null };
    if (home.status !== 200) return null;
    const link = home.text.match(/<link[^>]+type="application\/(?:rss|atom)\+xml"[^>]*href="([^"]+)"/i)?.[1] ?? home.text.match(/href="([^"]+)"[^>]*type="application\/(?:rss|atom)\+xml"/i)?.[1];
    if (link) return { host, platform: "rss", events_url: null, releases_url: new URL(link, `https://${host}/`).toString() };
    return { host, platform: "none", events_url: null, releases_url: null };
  } catch {
    return null; // no such host, timeout, TLS error
  }
}

/**
 * Discover a company's IR source from its own release text and record it. A
 * feed found on a guessed host is accepted only if it mentions the company.
 */
export async function discoverIrSource(
  cik: number,
  releaseText: string,
  hints: { name?: string; ticker?: string } = {}
): Promise<IrSource> {
  let found: Omit<IrSource, "cik"> | null = null;
  for (const host of irHostCandidates(releaseText, hints)) {
    const probe = await probeIrHost(host);
    if (!probe) continue;
    if (probe.platform === "q4" || probe.platform === "investis" || probe.platform === "rss") {
      const sample = await fetchText(probe.releases_url ?? probe.events_url!).catch(() => ({ status: 0, type: "", text: "" }));
      if (!hints.name && !hints.ticker) {
        found = probe;
        break;
      }
      if (feedMentionsCompany(sample.text, hints)) {
        found = probe;
        break;
      }
      continue; // someone else's site
    }
    if (!found) found = probe; // remember a reachable host even without feeds
  }
  const src: IrSource = { cik, ...(found ?? { host: null, platform: "none", events_url: null, releases_url: null }) };
  await query(
    `insert into ir_sources (cik, host, platform, events_url, releases_url)
     values ($1, $2, $3, $4, $5)
     on conflict (cik) do update set host = excluded.host, platform = excluded.platform,
       events_url = excluded.events_url, releases_url = excluded.releases_url, discovered_at = now(), consecutive_failures = 0`,
    [src.cik, src.host, src.platform, src.events_url, src.releases_url]
  );
  return src;
}

/* ---------------------------------------------
   EVENTS → ADVISORIES
----------------------------------------------*/

const EVENT_TITLE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s*:\s*(.+)$/;
const NOT_EARNINGS = /\b(annual meeting|investor day|analyst day|conference presentation|fireside|roadshow|dividend)\b/i;

/**
 * Turn a platform's events feed into advisory-shaped items the regular
 * parser understands: "FedEx Q3 2026 Earnings Call on October 28, 2026".
 * Only earnings events with a quarter token and a future date qualify.
 */
export function eventsToAdvisories(items: FeedItem[], cik: number, todayISO: string): FeedItem[] {
  const out: FeedItem[] = [];
  for (const it of items) {
    const m = it.title.match(EVENT_TITLE);
    if (!m) continue;
    const name = m[4].trim();
    if (!/\b(earnings|results)\b/i.test(name) || !QUARTER_TOKEN.test(name) || NOT_EARNINGS.test(name)) continue;
    const iso = `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
    if (iso < todayISO) continue;
    const long = new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2])).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    out.push({
      guid: `${it.link ?? it.guid}#${iso}`,
      title: dateMentioned(name, iso) ? name : `${name} on ${long}`,
      link: it.link,
      description: `Scheduled investor event: ${name}, ${long}.`,
      // The feed lists the event as upcoming now, whenever it was first posted
      publishedAt: new Date().toISOString(),
      cik,
    });
  }
  return out;
}

/* ---------------------------------------------
   POLLING
----------------------------------------------*/

export type IrPollResult = { fetched: number; failed: number; events: FeedItem[]; releases: FeedItem[] };

/** Read one company's feeds; the caller stages what comes back */
export async function readIrSource(src: IrSource, todayISO: string): Promise<IrPollResult> {
  const result: IrPollResult = { fetched: 0, failed: 0, events: [], releases: [] };
  for (const [kind, url] of [["events", src.events_url], ["releases", src.releases_url]] as const) {
    if (!url) continue;
    try {
      const path = new URL(url).pathname;
      if (!(await robotsAllows(src.host!, path))) continue;
      const r = await fetchText(url);
      result.fetched += 1;
      if (!isRss(r)) {
        result.failed += 1;
        continue;
      }
      const items = parseRss(r.text).map((i) => ({ ...i, cik: src.cik }));
      if (kind === "events") result.events.push(...eventsToAdvisories(items, src.cik, todayISO));
      else result.releases.push(...items);
    } catch {
      result.failed += 1;
    }
  }
  return result;
}
