/**
 * SEC EDGAR client.
 *
 * Free, no key. The SEC fair-access policy requires a declared User-Agent
 * with contact details and a hard ceiling of 10 requests/second; this client
 * identifies itself and throttles to a safe margin below that on every call.
 *
 * Optionally caches raw responses on disk (for the backfill and backtest
 * scripts) so re-runs don't re-download the same submissions.
 */

import { promises as fs } from "fs";
import path from "path";

export const SEC_USER_AGENT =
  process.env.EDGAR_USER_AGENT ?? "HowManyTradingDays.com itschrisray@gmail.com";

const MAX_REQUESTS_PER_SECOND = 8;

/* ---------------------------------------------
   RATE LIMITER (token bucket shared per process)
----------------------------------------------*/

let tokens = MAX_REQUESTS_PER_SECOND;
let lastRefill = Date.now();
const waiters: (() => void)[] = [];

function refill() {
  const now = Date.now();
  const elapsed = (now - lastRefill) / 1000;
  tokens = Math.min(MAX_REQUESTS_PER_SECOND, tokens + elapsed * MAX_REQUESTS_PER_SECOND);
  lastRefill = now;
}

function drain() {
  refill();
  while (tokens >= 1 && waiters.length > 0) {
    tokens -= 1;
    waiters.shift()!();
  }
  if (waiters.length > 0) setTimeout(drain, 1000 / MAX_REQUESTS_PER_SECOND);
}

function acquire(): Promise<void> {
  return new Promise((resolve) => {
    waiters.push(resolve);
    drain();
  });
}

/* ---------------------------------------------
   FETCH WITH RETRY + OPTIONAL DISK CACHE
----------------------------------------------*/

export type EdgarClientOptions = {
  /** Directory for cached JSON responses; omit to disable caching */
  cacheDir?: string;
  /** Re-download even if a cached copy exists */
  refresh?: boolean;
};

async function readCache(cacheDir: string, key: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(cacheDir, key), "utf8");
  } catch {
    return null;
  }
}

async function writeCache(cacheDir: string, key: string, body: string) {
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(path.join(cacheDir, key), body, "utf8");
}

export async function fetchEdgarJson<T>(
  url: string,
  opts: EdgarClientOptions = {}
): Promise<T> {
  const cacheKey = url.replace(/^https?:\/\//, "").replace(/[^a-zA-Z0-9._-]/g, "_");
  if (opts.cacheDir && !opts.refresh) {
    const cached = await readCache(opts.cacheDir, cacheKey);
    if (cached) return JSON.parse(cached) as T;
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    await acquire();
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": SEC_USER_AGENT,
          "Accept-Encoding": "gzip, deflate",
          Accept: "application/json",
        },
      });
      if (res.status === 429 || res.status === 503) {
        lastError = new Error(`EDGAR ${res.status} for ${url}`);
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      if (!res.ok) throw new Error(`EDGAR ${res.status} for ${url}`);
      const body = await res.text();
      if (opts.cacheDir) await writeCache(opts.cacheDir, cacheKey, body);
      return JSON.parse(body) as T;
    } catch (err) {
      lastError = err;
      if (attempt === 4) break;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw lastError;
}

/**
 * Fetch an EDGAR document as text through the shared rate limiter. A complete
 * submission file can run to megabytes of encoded attachments, so `maxBytes`
 * stops reading once enough has arrived.
 */
export async function fetchEdgarText(url: string, maxBytes = Infinity): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    await acquire();
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": SEC_USER_AGENT, "Accept-Encoding": "gzip, deflate" },
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 429 || res.status === 503) {
        lastError = new Error(`EDGAR ${res.status} for ${url}`);
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      if (!res.ok) throw new Error(`EDGAR ${res.status} for ${url}`);
      if (!res.body || maxBytes === Infinity) return await res.text();

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = "";
      let bytes = 0;
      while (bytes < maxBytes) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        text += decoder.decode(value, { stream: true });
      }
      await reader.cancel().catch(() => {});
      return text;
    } catch (err) {
      lastError = err;
      if (attempt === 2) break;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw lastError;
}

/* ---------------------------------------------
   TICKER / EXCHANGE LIST
----------------------------------------------*/

export type ExchangeListing = {
  cik: number;
  name: string;
  ticker: string;
  exchange: string | null;
};

export async function fetchExchangeListings(
  opts: EdgarClientOptions = {}
): Promise<ExchangeListing[]> {
  const raw = await fetchEdgarJson<{ fields: string[]; data: (string | number | null)[][] }>(
    "https://www.sec.gov/files/company_tickers_exchange.json",
    opts
  );
  const idx = Object.fromEntries(raw.fields.map((f, i) => [f, i]));
  return raw.data.map((row) => ({
    cik: Number(row[idx.cik]),
    name: String(row[idx.name]),
    ticker: String(row[idx.ticker]),
    exchange: row[idx.exchange] === null ? null : String(row[idx.exchange]),
  }));
}

/* ---------------------------------------------
   SUBMISSIONS (full filing history for a CIK)
----------------------------------------------*/

export type FilerCategory =
  | "large-accelerated"
  | "accelerated"
  | "non-accelerated"
  | "unknown";

export type EdgarFiling = {
  accession: string;
  form: string;
  filingDate: string; // YYYY-MM-DD
  reportDate: string | null; // period of report / event date, YYYY-MM-DD
  acceptanceDateTime: string | null; // ISO, UTC
  items: string[]; // 8-K item codes, e.g. ["2.02", "9.01"]
};

export type EdgarCompany = {
  cik: number;
  name: string;
  tickers: string[];
  exchanges: string[];
  category: FilerCategory;
  categoryRaw: string;
  fiscalYearEnd: string | null; // "MMDD"
  sic: string | null;
  sicDescription: string | null;
  stateOfIncorporation: string | null;
  filings: EdgarFiling[]; // newest first
};

type SubmissionsColumns = {
  accessionNumber: string[];
  filingDate: string[];
  reportDate: string[];
  acceptanceDateTime: string[];
  form: string[];
  items: string[];
};

type SubmissionsJson = {
  cik: string;
  name: string;
  tickers: string[];
  exchanges: string[];
  category: string;
  fiscalYearEnd: string;
  sic: string;
  sicDescription: string;
  stateOfIncorporation: string;
  filings: {
    recent: SubmissionsColumns;
    files: { name: string; filingCount: number; filingFrom: string; filingTo: string }[];
  };
};

/**
 * EDGAR's category string is free text and occasionally HTML-flavored, e.g.
 * "Large accelerated filer" or "<br>Emerging growth company" (no filer
 * status at all). Anything without an accelerated status gets the lenient
 * non-accelerated deadlines, which is correct for deadline clamping.
 */
export function parseFilerCategory(raw: string | undefined): FilerCategory {
  const s = (raw ?? "").replace(/<[^>]+>/g, " ").toLowerCase();
  // Order matters: "non-accelerated filer" contains "accelerated filer".
  if (s.includes("large accelerated")) return "large-accelerated";
  if (s.includes("non-accelerated") || s.includes("smaller reporting")) return "non-accelerated";
  if (s.includes("accelerated filer")) return "accelerated";
  return "unknown";
}

function columnsToFilings(cols: SubmissionsColumns): EdgarFiling[] {
  const out: EdgarFiling[] = [];
  for (let i = 0; i < cols.form.length; i++) {
    out.push({
      accession: cols.accessionNumber[i],
      form: cols.form[i],
      filingDate: cols.filingDate[i],
      reportDate: cols.reportDate[i] || null,
      acceptanceDateTime: cols.acceptanceDateTime[i] || null,
      items: cols.items[i] ? cols.items[i].split(",").map((s) => s.trim()) : [],
    });
  }
  return out;
}

export function padCik(cik: number | string): string {
  return String(cik).padStart(10, "0");
}

/**
 * Fetch a company's complete filing history. The submissions endpoint inlines
 * only the latest ~1,000 filings; older ones live in paginated files that
 * this merges in, back to `sinceDate` (default: everything).
 */
export async function fetchCompany(
  cik: number | string,
  opts: EdgarClientOptions & { sinceDate?: string } = {}
): Promise<EdgarCompany> {
  const padded = padCik(cik);
  const main = await fetchEdgarJson<SubmissionsJson>(
    `https://data.sec.gov/submissions/CIK${padded}.json`,
    opts
  );

  let filings = columnsToFilings(main.filings.recent);

  for (const file of main.filings.files ?? []) {
    if (opts.sinceDate && file.filingTo < opts.sinceDate) continue;
    const page = await fetchEdgarJson<SubmissionsColumns>(
      `https://data.sec.gov/submissions/${file.name}`,
      opts
    );
    filings = filings.concat(columnsToFilings(page));
  }

  if (opts.sinceDate) filings = filings.filter((f) => f.filingDate >= opts.sinceDate!);
  filings.sort((a, b) => (a.filingDate < b.filingDate ? 1 : a.filingDate > b.filingDate ? -1 : 0));

  return {
    cik: Number(main.cik),
    name: main.name,
    tickers: main.tickers ?? [],
    exchanges: main.exchanges ?? [],
    category: parseFilerCategory(main.category),
    categoryRaw: main.category ?? "",
    fiscalYearEnd: main.fiscalYearEnd || null,
    sic: main.sic || null,
    sicDescription: main.sicDescription || null,
    stateOfIncorporation: main.stateOfIncorporation || null,
    filings,
  };
}

/* ---------------------------------------------
   UNIVERSE RULES
----------------------------------------------*/

const FOREIGN_FORMS = new Set(["20-F", "6-K", "40-F", "20-F/A", "40-F/A"]);

/**
 * True for domestic operating companies that report quarterly: at least
 * four 10-Qs in the trailing three years and no foreign-private-issuer forms.
 * Filters out ETFs, trusts, shells, funds, and 20-F/6-K filers.
 */
/** A quarterly reporter whose last 10-Q/10-K is older than this has stopped (deregistered, converted, acquired) */
const PERIODIC_SILENCE_DAYS = 400;

export function isQuarterlyReporter(company: EdgarCompany, asOf = new Date()): boolean {
  const cutoff = new Date(asOf);
  cutoff.setFullYear(cutoff.getFullYear() - 3);
  const cutoffISO = cutoff.toISOString().slice(0, 10);
  const silence = new Date(asOf.getTime() - PERIODIC_SILENCE_DAYS * 86_400_000).toISOString().slice(0, 10);

  let tenQs = 0;
  let latestPeriodic = "";
  for (const f of company.filings) {
    if (f.filingDate < cutoffISO) break; // newest first
    if (FOREIGN_FORMS.has(f.form)) return false;
    if (f.form === "10-Q") tenQs += 1;
    if (!latestPeriodic && /^10-[QK]T?$/.test(f.form)) latestPeriodic = f.filingDate;
  }
  return tenQs >= 4 && latestPeriodic >= silence;
}
