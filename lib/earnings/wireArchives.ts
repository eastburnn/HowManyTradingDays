/**
 * Public, paginated listing pages on the wires — the HTML face of the same
 * streams the RSS feeds expose only the top of. Used for the one-time
 * backfill of past announcements and for polling PR Newswire's dedicated
 * "Conference Call Announcements" category, which has no RSS equivalent.
 *
 * Posture: logged out, identified User-Agent, robots.txt honored (neither
 * site restricts these paths), one request at a time with a pause between
 * pages, and only headlines, links, timestamps and the published summary
 * sentence are kept.
 */

import { SEC_USER_AGENT } from "./edgar";
import { decodeEntities, type FeedItem } from "./wires";

const PAUSE_MS = 1500;
let lastRequestAt = 0;

async function politeFetch(url: string): Promise<string> {
  const wait = lastRequestAt + PAUSE_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
  const res = await fetch(url, {
    headers: { "User-Agent": SEC_USER_AGENT, Accept: "text/html" },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

function clean(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** "Oct 01, 2026, 17:21 ET" or "October 02, 2026 17:50 ET" → ISO (UTC) */
export function parseWireTimestamp(s: string): string | null {
  const m = s.match(/\b([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s+(\d{4}),?\s+(\d{1,2}):(\d{2})\s*ET\b/);
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  if (!month) return null;
  // Build the ET wall time, then convert via the America/New_York offset.
  const local = new Date(Date.UTC(Number(m[3]), month - 1, Number(m[2]), Number(m[4]), Number(m[5])));
  const etString = local.toLocaleString("en-US", { timeZone: "America/New_York" });
  const offsetMs = local.getTime() - new Date(etString + " UTC").getTime();
  return new Date(local.getTime() + offsetMs).toISOString();
}

/* ---------------------------------------------
   PR NEWSWIRE — Conference Call Announcements list
----------------------------------------------*/

export const PRN_CONFERENCE_CALLS_URL =
  "https://www.prnewswire.com/news-releases/financial-services-latest-news/conference-call-announcements-list/";

export async function fetchPrnConferenceCalls(page = 1, pageSize = 100): Promise<FeedItem[]> {
  const html = await politeFetch(`${PRN_CONFERENCE_CALLS_URL}?page=${page}&pagesize=${pageSize}`);
  const items: FeedItem[] = [];
  for (const block of html.split(/<div class="row newsCards"/).slice(1)) {
    const href = block.match(/href="(\/news-releases\/[^"]+\.html)"/)?.[1];
    const h3 = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/)?.[1] ?? "";
    const summary = block.match(/<p class="remove-outline">([\s\S]*?)<\/p>/)?.[1] ?? "";
    if (!href || !h3) continue;
    const stamp = clean(h3.match(/<small[^>]*>([\s\S]*?)<\/small>/)?.[1] ?? "");
    const title = clean(h3.replace(/<small[\s\S]*?<\/small>/, ""));
    const dateText = clean(block.match(/\b[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4},?\s+\d{1,2}:\d{2}\s*ET\b/)?.[0] ?? "");
    items.push({
      guid: `https://www.prnewswire.com${href}`,
      title,
      link: `https://www.prnewswire.com${href}`,
      description: clean(summary),
      publishedAt: parseWireTimestamp(dateText || stamp) ?? todayStamp(stamp),
    });
  }
  return items;
}

/** Today's items show only "16:15 ET"; the list is newest-first, so that means today in New York. */
function todayStamp(timeOnly: string): string | null {
  const m = timeOnly.match(/^(\d{1,2}):(\d{2})\s*ET$/);
  if (!m) return null;
  const todayET = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [y, mo, d] = todayET.split("-");
  const monthName = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][Number(mo) - 1];
  return parseWireTimestamp(`${monthName} ${Number(d)}, ${y}, ${m[1]}:${m[2]} ET`);
}

/* ---------------------------------------------
   GLOBENEWSWIRE — keyword search results
----------------------------------------------*/

export async function fetchGnwSearch(keyword: string, page = 1): Promise<FeedItem[]> {
  const html = await politeFetch(
    `https://www.globenewswire.com/search/keyword/${encodeURIComponent(keyword)}?page=${page}`
  );
  const items: FeedItem[] = [];
  for (const block of html.split(/<li class="row"/).slice(1)) {
    const href = block.match(/<div class="mainLink">\s*<a href="(\/news-release\/[^"]+\.html)"/)?.[1];
    const title = clean(block.match(/<div class="mainLink">\s*<a[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? "");
    const dateText = clean(block.match(/<div class="date-source">\s*<span>([^<]+)<\/span>/)?.[1] ?? "");
    const summary = block.match(/<div class="newsTxt">\s*<p>([\s\S]*?)<\/p>/)?.[1] ?? "";
    const source = clean(block.match(/class="sourceLink"[^>]*>([^<]+)<\/a>/)?.[1] ?? "");
    if (!href || !title) continue;
    items.push({
      guid: `https://www.globenewswire.com${href}`,
      title,
      link: `https://www.globenewswire.com${href}`,
      description: clean(summary),
      publishedAt: parseWireTimestamp(dateText),
      source: source || undefined,
    });
  }
  return items;
}

/* ---------------------------------------------
   RELEASE PAGE — only to recover a ticker the summary lacked
----------------------------------------------*/

export async function fetchReleaseOpening(url: string): Promise<string> {
  const html = await politeFetch(url);
  const body = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ");
  // The release body starts at the dateline ("CITY, State, Oct. 2, 2026 /PRNewswire/",
  // "(GLOBE NEWSWIRE)", or "--(BUSINESS WIRE)--" on a company's own site)
  const text = clean(body);
  const at = text.search(/\/PRNewswire\/|\(GLOBE NEWSWIRE\)|\(BUSINESS WIRE\)/);
  return at >= 0 ? text.slice(Math.max(0, at - 200), at + 2500) : text.slice(0, 2500);
}
