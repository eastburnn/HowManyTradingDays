/**
 * EDGAR full-text search as a confirmed-date source.
 *
 * Some companies furnish their "to report third quarter results on ..."
 * advisory as an 8-K (Item 7.01 / 8.01) with the press release attached as
 * an exhibit. EDGAR's full-text search indexes those documents, so phrase
 * queries over a date window find them — including weeks before the wire
 * poller existed. Results releases are excluded by item code (2.02).
 *
 * Hits are staged in feed_items under feed 'edgar-fts' (guid = accession:
 * filename) and parsed by the same pipeline as wire items.
 */

import { SEC_USER_AGENT, fetchEdgarJson } from "./edgar";
import { query } from "./db";

const SEARCH_URL = "https://efts.sec.gov/LATEST/search-index";

// Phrase queries that scheduling advisories use; each is "all terms must match".
const QUERIES = [
  `"to report" "quarter" results`,
  `"to announce" "quarter" "financial results"`,
  `"will release" "quarter" results`,
  `"will report" "quarter" results`,
  `"earnings conference call" "quarter"`,
  `"earnings release" "conference call" "quarter"`,
  `"to host" "conference call" "quarter" results`,
];

type Hit = {
  _id: string; // "0001193125-26-393183:d156244dex991.htm"
  _source: {
    ciks: string[];
    display_names: string[];
    file_date: string;
    form: string;
    file_type: string;
    items?: string[]; // e.g. ["7.01", "9.01"]
    adsh: string;
  };
};

type SearchResponse = { hits: { total: { value: number }; hits: Hit[] } };

export type EdgarAdvisoryCandidate = {
  guid: string;
  cik: number;
  accession: string;
  filename: string;
  fileDate: string;
  url: string;
  displayName: string;
};

function docUrl(cik: number, accession: string, filename: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replace(/-/g, "")}/${filename}`;
}

/** Search EDGAR for advisory-shaped 8-K documents filed in [startISO, endISO]. */
export async function searchEdgarAdvisories(startISO: string, endISO: string): Promise<EdgarAdvisoryCandidate[]> {
  const seen = new Map<string, EdgarAdvisoryCandidate>();

  for (const q of QUERIES) {
    for (let from = 0; from < 1000; from += 100) {
      const url =
        `${SEARCH_URL}?q=${encodeURIComponent(q)}&forms=8-K&dateRange=custom` +
        `&startdt=${startISO}&enddt=${endISO}&from=${from}&size=100`;
      const res = await fetchEdgarJson<SearchResponse>(url);
      const hits = res.hits?.hits ?? [];
      for (const h of hits) {
        const s = h._source;
        const items = s.items ?? [];
        // Advisories are furnished under 7.01/8.01; 2.02 means results are out.
        if (items.includes("2.02")) continue;
        if (!items.includes("7.01") && !items.includes("8.01")) continue;
        // Press-release exhibits or the 8-K body; skip agreements, indentures, etc.
        if (!/^(8-K|EX-99(\.\d+)?)$/i.test(s.file_type)) continue;
        const [accession, filename] = h._id.split(":");
        if (!accession || !filename) continue;
        const cik = Number(s.ciks?.[0]);
        if (!cik) continue;
        if (!seen.has(h._id)) {
          seen.set(h._id, {
            guid: h._id,
            cik,
            accession,
            filename,
            fileDate: s.file_date,
            url: docUrl(cik, accession, filename),
            displayName: s.display_names?.[0] ?? "",
          });
        }
      }
      if (hits.length < 100 || from + 100 >= (res.hits?.total?.value ?? 0)) break;
    }
  }
  return [...seen.values()];
}

/* ---------------------------------------------
   DOCUMENT TEXT
----------------------------------------------*/

export async function fetchDocumentText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": SEC_USER_AGENT }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`EDGAR doc ${res.status}: ${url}`);
  let html = await res.text();
  // EDGAR wraps documents in an SGML envelope (<DOCUMENT><TYPE>…<TEXT>…</TEXT>)
  // whose unclosed tags would otherwise leak their contents into the text.
  const textStart = html.search(/<TEXT>/i);
  if (textStart >= 0) html = html.slice(textStart + 6).replace(/<\/TEXT>[\s\S]*$/i, "");
  return html
    .replace(/<head[\s\S]*?<\/head>|<title[\s\S]*?<\/title>|<ix:header[\s\S]*?<\/ix:header>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|tr|li|h\d|br)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&(ldquo|rdquo|quot);/g, '"')
    .replace(/&(lsquo|rsquo|apos);/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

const SCHEDULING_HINT =
  /\b(to (report|announce|release|host|hold)|will (report|announce|release|host|hold)|schedules?|sets? (the )?date|announces? (the )?(date|timing)|conference call|earnings call|webcast)\b/i;

/**
 * Pick a headline and an opening passage from a press-release document:
 * the first short line with scheduling language, else the first line.
 */
export function splitDocument(text: string): { title: string; description: string } {
  // An 8-K body starts with the cover page; the substance begins at the item.
  const itemAt = text.search(/Item\s+[78]\.01/i);
  const body = itemAt >= 0 ? text.slice(itemAt) : text;
  const lines = body.split("\n").map((l) => l.trim()).filter((l) => l.length >= 12);
  const candidates = lines
    .slice(0, 15)
    .filter((l) => l.length <= 220 && !/^exhibit\s+\d/i.test(l) && !/^(press release|for immediate release)$/i.test(l));
  const title = candidates.find((l) => SCHEDULING_HINT.test(l)) ?? candidates[0] ?? lines[0] ?? "";
  const start = Math.max(0, body.indexOf(title));
  // Advisories buried at the end of long releases (deal closings, guidance) need a wide window.
  return { title, description: body.slice(start, start + 8000) };
}

/* ---------------------------------------------
   STAGE INTO feed_items
----------------------------------------------*/

/** Stage new EDGAR candidates (only companies in the universe); returns how many were new. */
export async function stageEdgarAdvisories(candidates: EdgarAdvisoryCandidate[]): Promise<number> {
  if (!candidates.length) return 0;
  const known = await query<{ cik: number }>(`select cik from companies where active and cik = any($1::int[])`, [
    [...new Set(candidates.map((c) => c.cik))],
  ]);
  const inUniverse = new Set(known.map((k) => k.cik));
  const keep = candidates.filter((c) => inUniverse.has(c.cik));
  if (!keep.length) return 0;

  const inserted = await query<{ id: number; guid: string }>(
    `insert into feed_items (feed, guid, title, link, published_at)
     select 'edgar-fts', * from unnest($1::text[], $2::text[], $3::text[], $4::timestamptz[])
     on conflict (feed, guid) do nothing
     returning id, guid`,
    [keep.map((c) => c.guid), keep.map((c) => c.displayName.slice(0, 500)), keep.map((c) => c.url), keep.map((c) => c.fileDate)]
  );
  if (!inserted.length) return 0;

  // Fetch each new document and store its headline + opening text for parsing.
  const byGuid = new Map(keep.map((c) => [c.guid, c]));
  for (const row of inserted) {
    const c = byGuid.get(row.guid)!;
    try {
      const text = await fetchDocumentText(c.url);
      const { title, description } = splitDocument(text);
      await query(`update feed_items set title = $2, parsed = $3 where id = $1`, [
        row.id,
        title.slice(0, 1000),
        JSON.stringify({ description, cik: c.cik, hint: "edgar" }),
      ]);
    } catch (err) {
      await query(`update feed_items set parse_status = 'failed', parsed = $2 where id = $1`, [
        row.id,
        JSON.stringify({ reason: `document fetch failed: ${(err as Error).message}` }),
      ]);
    }
  }
  return inserted.length;
}
