/**
 * Find investor-relations sites (and any RSS feed on them) the way a person
 * would: read the company's latest earnings release for its corporate
 * domain, open the corporate home page, follow its "Investors" link, then
 * look on that page for a feed (a <link rel=alternate>, an "RSS" link, or
 * the platforms' predictable feed addresses). The subdomain guessing the
 * scheduled discovery does (investors.<name>.com) misses sites like
 * investorvalero.com or ralphlauren.com/investors; this pass covers those.
 *
 * Records what it finds in ir_sources: a feed (platform rss/q4/investis), or
 * at least the IR host (platform none), which lets inbound IR emails be
 * matched to the company by sender domain.
 *
 *   npx tsx --env-file=.env.local scripts/earnings/find-ir-sites.ts --tickers VLO,RL --dry
 *   npx tsx --env-file=.env.local scripts/earnings/find-ir-sites.ts --limit 500 --concurrency 6
 *
 * Without --tickers it takes active companies with no feed, hostless first.
 */

import { closePool, query } from "@/lib/earnings/db";
import { SEC_USER_AGENT } from "@/lib/earnings/edgar";
import { feedMentionsCompany, probeIrHost, robotsAllows } from "@/lib/earnings/irSites";
import { latestReleaseText } from "@/lib/earnings/jobs";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const DRY = process.argv.includes("--dry");
const TICKERS = arg("tickers", "").split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
const LIMIT = Number(arg("limit", "400"));
const CONCURRENCY = Number(arg("concurrency", "6"));

const UA = "HowManyTradingDays.com (hello@howmanytradingdays.com)";
const TIMEOUT_MS = 15_000;
const PAUSE_MS = 1200;
const lastAt = new Map<string, number>();

async function get(url: string): Promise<{ status: number; text: string; url: string }> {
  const host = new URL(url).hostname;
  const wait = (lastAt.get(host) ?? 0) + PAUSE_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastAt.set(host, Date.now());
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html, application/rss+xml, application/xml;q=0.9, */*;q=0.5" },
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return { status: res.status, text: res.ok ? await res.text() : "", url: res.url };
}

const isRss = (text: string) => /<rss[\s>]|<feed[\s>]/i.test(text.slice(0, 2000));
const SKIP_DOMAINS = /(^|\.)(sec|businesswire|prnewswire|globenewswire|accesswire|newsfilecorp|nasdaq|nyse|linkedin|facebook|twitter|x|youtube|instagram|q4inc|google|apple|microsoft|adobe|gmail|yahoo|bloomberg|reuters|wsj|cnbc|marketwatch|zacks|seekingalpha|morningstar|edgar-online|workiva|donnelley|broadridge|computershare|equiniti|astfinancial|continentalstock|issuerdirect|irdirect|notified|intrado|webcasts|icrinc|kcsa|lhai|gilmartinir|alphaIR|edelman|sardverb|joelefrank)\.(com|net|org|co|io|us)$/i;
const DOMAIN_RE = /\b(?:https?:\/\/)?(?:www\.)?([a-z0-9-]{3,}\.(?:com|net|org|co|io|us|ai|bank))\b/gi;

/** Corporate domains named in the release, most mentioned first */
function corporateDomains(text: string): string[] {
  const counts = new Map<string, number>();
  for (const m of text.matchAll(DOMAIN_RE)) {
    const d = m[1].toLowerCase();
    if (SKIP_DOMAINS.test(d) || /\.(png|jpg|gif|pdf)$/.test(d)) continue;
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([d]) => d);
}

/** Links on a page whose text or address says "investor" */
function investorLinks(html: string, base: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
    const href = m[1];
    const label = m[2].replace(/<[^>]+>/g, " ").trim();
    if (!/investor|shareholder/i.test(href) && !/investor|shareholder/i.test(label)) continue;
    if (/\.(pdf|png|jpg)$/i.test(href) || /mailto:|javascript:/i.test(href)) continue;
    try {
      const u = new URL(href, base);
      if (u.protocol.startsWith("http")) out.add(u.origin + u.pathname.replace(/\/+$/, ""));
    } catch {
      /* bad href */
    }
  }
  return [...out].slice(0, 5);
}

/** A feed advertised on the page, or reachable at a predictable address beside it */
async function feedOnPage(pageUrl: string, html: string, hints: { name: string; ticker: string }): Promise<string | null> {
  const candidates = new Set<string>();
  const link = html.match(/<link[^>]+type="application\/(?:rss|atom)\+xml"[^>]*href="([^"]+)"/i)?.[1] ?? html.match(/href="([^"]+)"[^>]*type="application\/(?:rss|atom)\+xml"/i)?.[1];
  if (link) candidates.add(link);
  for (const m of html.matchAll(/<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]{0,120}?)<\/a>/gi)) {
    if (/rss|\/feed\b|\.xml\b/i.test(m[1]) || /\brss\b/i.test(m[2].replace(/<[^>]+>/g, " "))) candidates.add(m[1]);
  }
  const page = new URL(pageUrl);
  for (const path of ["/news-events/press-releases/rss", "/news/rss", "/news-releases/rss", "/press-releases/rss", "/rss/news-releases.xml", "/rss/pressrelease.aspx", "/feed"]) {
    candidates.add(new URL(path, page.origin).toString());
  }
  for (const c of [...candidates].slice(0, 12)) {
    let u: URL;
    try {
      u = new URL(c, pageUrl);
    } catch {
      continue;
    }
    if (!u.protocol.startsWith("http")) continue;
    if (/unsubscribe|login|cdn-cgi|\.css|\.js/i.test(u.pathname)) continue;
    if (!(await robotsAllows(u.hostname, u.pathname))) continue;
    const r = await get(u.toString()).catch(() => null);
    if (r && isRss(r.text) && feedMentionsCompany(r.text, hints)) return u.toString();
  }
  return null;
}

type Outcome = { host: string | null; platform: "rss" | "q4" | "investis" | "none" | "blocked"; events_url: string | null; releases_url: string | null; how: string };

async function findFor(c: { cik: number; ticker: string; name: string }): Promise<Outcome> {
  const hints = { name: c.name, ticker: c.ticker };
  const text = await latestReleaseText(c.cik).catch(() => "");
  const domains = corporateDomains(text);
  if (!domains.length) return { host: null, platform: "none", events_url: null, releases_url: null, how: "no domain in release" };

  let irHost: string | null = null;
  for (const domain of domains) {
    const home = await get(`https://www.${domain}/`).catch(() => get(`https://${domain}/`).catch(() => null));
    if (!home || home.status !== 200) continue;
    const pages = investorLinks(home.text, home.url);
    if (!pages.length) pages.push(`${new URL(home.url).origin}/investors`, `${new URL(home.url).origin}/investor-relations`);
    for (const pageUrl of pages.slice(0, 4)) {
      const u = new URL(pageUrl);
      // A separate IR host: the platform probe knows Q4 and Investis layouts
      if (u.hostname !== new URL(home.url).hostname) {
        const probe = await probeIrHost(u.hostname);
        if (probe && (probe.platform === "q4" || probe.platform === "investis" || probe.platform === "rss")) {
          const sample = await get(probe.releases_url ?? probe.events_url!).catch(() => null);
          if (sample && feedMentionsCompany(sample.text, hints)) return { ...probe, how: `investor link → ${u.hostname} (${probe.platform})` };
        }
        if (probe?.platform === "blocked") return { host: u.hostname, platform: "blocked", events_url: null, releases_url: null, how: "investor host blocks readers" };
      }
      const page = await get(pageUrl).catch(() => null);
      if (!page) continue;
      if (page.status === 403) return { host: u.hostname, platform: "blocked", events_url: null, releases_url: null, how: "investor page blocks readers" };
      if (page.status !== 200) continue;
      irHost ??= new URL(page.url).hostname;
      const feed = await feedOnPage(page.url, page.text, hints);
      if (feed) return { host: new URL(page.url).hostname, platform: "rss", events_url: null, releases_url: feed, how: `feed linked from ${page.url}` };
    }
  }
  return { host: irHost, platform: "none", events_url: null, releases_url: null, how: irHost ? "investor page found, no feed" : "no investor page found" };
}

(async () => {
  const targets = TICKERS.length
    ? await query<{ cik: number; ticker: string; name: string }>(`select cik, ticker, name from companies where ticker = any($1)`, [TICKERS])
    : await query<{ cik: number; ticker: string; name: string }>(
        `select c.cik, c.ticker, c.name from companies c left join ir_sources s on s.cik = c.cik
          where c.active and (s.cik is null or s.platform in ('none', 'blocked'))
            and exists (select 1 from earnings_current e where e.cik = c.cik and e.status = 'reported' and e.source_type = 'edgar-8k' and e.source_accession is not null)
          order by s.discovered_at asc nulls first, c.ticker limit $1`,
        [LIMIT]
      );
  console.log(`${targets.length} companies${DRY ? " (dry run)" : ""}, concurrency ${CONCURRENCY}`);
  const tally = { rss: 0, q4: 0, investis: 0, none: 0, blocked: 0, hostFound: 0 };
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < targets.length) {
      const c = targets[next++];
      const out = await findFor(c).catch((e) => ({ host: null, platform: "none" as const, events_url: null, releases_url: null, how: `error: ${(e as Error).message.slice(0, 60)}` }));
      tally[out.platform] += 1;
      if (out.host) tally.hostFound += 1;
      console.log(`${c.ticker.padEnd(6)} ${out.platform.padEnd(8)} ${(out.host ?? "-").padEnd(36)} ${out.releases_url ?? ""}  [${out.how}]`);
      if (!DRY) {
        // Always recorded (discovered_at moves forward), so a company with
        // nothing findable is not picked up again by the next chunk.
        await query(
          `insert into ir_sources (cik, host, platform, events_url, releases_url)
           values ($1, $2, $3, $4, $5)
           on conflict (cik) do update set host = coalesce(excluded.host, ir_sources.host), platform = excluded.platform,
             events_url = excluded.events_url, releases_url = excluded.releases_url, discovered_at = now(), consecutive_failures = 0, last_polled_at = null`,
          [c.cik, out.host, out.platform, out.events_url, out.releases_url]
        );
      }
      done += 1;
      if (done % 25 === 0) console.log(`  ${done}/${targets.length}: ${JSON.stringify(tally)}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`done: ${JSON.stringify(tally)}`);
  await closePool();
})().catch(async (e) => {
  console.error(e);
  await closePool();
  process.exit(1);
});
