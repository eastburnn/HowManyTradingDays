/**
 * Public press-wire RSS feeds — the source for company-announced earnings
 * dates. Read logged-out, one request per feed per poll, filtered locally;
 * only facts are stored (ticker, date, time, link), never release text.
 *
 * Business Wire is deliberately absent: its robots.txt disallows /rss/ for
 * all but two named licensees. PR Newswire has no subject feeds (unknown
 * slugs silently serve the global feed), so its global feed is polled
 * frequently instead.
 */

import { SEC_USER_AGENT } from "./edgar";

export type Feed = { key: string; url: string };

export const FEEDS: Feed[] = [
  {
    key: "prn-global",
    url: "https://www.prnewswire.com/rss/news-releases-list.rss",
  },
  {
    key: "gnw-earnings",
    url: "https://www.globenewswire.com/RssFeed/subjectcode/13-Earnings%20Releases%20And%20Operating%20Results/feedTitle/GlobeNewswire%20-%20Earnings%20Releases%20And%20Operating%20Results",
  },
  {
    key: "gnw-us",
    url: "https://www.globenewswire.com/RssFeed/country/United%20States/feedTitle/GlobeNewswire%20-%20News%20from%20United%20States",
  },
];

export type FeedItem = {
  guid: string;
  title: string;
  link: string | null;
  description: string;
  publishedAt: string | null; // ISO
};

/* ---------------------------------------------
   MINIMAL RSS PARSING (these feeds are plain RSS 2.0)
----------------------------------------------*/

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  ndash: "–",
  mdash: "—",
  hellip: "…",
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

function textOf(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  if (!m) return "";
  let v = m[1].trim();
  const cdata = v.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) v = cdata[1];
  // Descriptions arrive as escaped HTML; decode, then strip tags.
  v = decodeEntities(v);
  v = v.replace(/<[^>]+>/g, " ");
  return decodeEntities(v).replace(/\s+/g, " ").trim();
}

export function parseRss(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  for (const m of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const block = m[1];
    const title = textOf(block, "title");
    const link = textOf(block, "link") || null;
    const guid = textOf(block, "guid") || link || title;
    const pub = textOf(block, "pubDate") || textOf(block, "dc:date");
    const publishedAt = pub && !Number.isNaN(Date.parse(pub)) ? new Date(pub).toISOString() : null;
    if (!title) continue;
    items.push({ guid, title, link, description: textOf(block, "description"), publishedAt });
  }
  return items;
}

export async function fetchFeed(feed: Feed): Promise<FeedItem[]> {
  let lastError: Error | null = null;
  // The wires occasionally answer a single request with a transient 404/5xx;
  // one retry after a short pause covers it without hammering them.
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 3000));
    try {
      const res = await fetch(feed.url, {
        headers: { "User-Agent": SEC_USER_AGENT, Accept: "application/rss+xml, application/xml, text/xml" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        lastError = new Error(`${feed.key}: HTTP ${res.status}`);
        continue;
      }
      return parseRss(await res.text());
    } catch (err) {
      lastError = err as Error;
    }
  }
  throw lastError ?? new Error(`${feed.key}: fetch failed`);
}
