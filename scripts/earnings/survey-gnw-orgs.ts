/**
 * For a list of tickers, asks GlobeNewswire's search whether the company has
 * issued releases there recently: results whose source organization (or
 * headline) is the company itself. Complements survey-wires.ts, whose keyword
 * archive only reaches back about two months. Read-only.
 *
 *   npx tsx --env-file=.env.local scripts/earnings/survey-gnw-orgs.ts --in tickers.txt --out gnw-orgs.json
 *
 * The input file has one ticker per line (anything after a tab or "*" is ignored).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fetchGnwSearch } from "@/lib/earnings/wireArchives";
import { displayName } from "@/lib/earnings/format";
import { closePool, query } from "@/lib/earnings/db";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const IN = arg("in", "");
const OUT = arg("out", "gnw-orgs.json");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const norm = (s: string) =>
  displayName(s)
    .toLowerCase()
    .replace(/[.,'’"]/g, "")
    .replace(/\b(inc|incorporated|corp|corporation|co|company|ltd|limited|plc|llc|lp|holdings?|group|the)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

(async () => {
  const tickers = readFileSync(IN, "utf8")
    .split("\n")
    .map((l) => l.split(/[\t*]/)[0].trim().toUpperCase())
    .filter(Boolean);
  const rows = await query<{ ticker: string; name: string }>(`select ticker, name from companies where active and upper(ticker) = any($1)`, [tickers]);
  const byTicker = new Map(rows.map((r) => [r.ticker.toUpperCase(), r.name]));
  process.stderr.write(`${rows.length} companies\n`);

  const results: { ticker: string; name: string; gnw: boolean; hits: number; latest: string; sample: string }[] = [];
  let n = 0;
  for (const t of tickers) {
    const name = byTicker.get(t);
    if (!name) continue;
    const key = norm(name);
    const firstWords = key.split(" ").slice(0, 2).join(" ");
    let items: Awaited<ReturnType<typeof fetchGnwSearch>> = [];
    try {
      items = await fetchGnwSearch(firstWords, 1);
    } catch (err) {
      process.stderr.write(`  ${t}: ${(err as Error).message}\n`);
    }
    // The company's own releases: GlobeNewswire names the source organization on each result, so
    // require that to be the company (either name a prefix of the other), with the headline as a fallback.
    const own = items.filter((it) => {
      const src = norm(it.source ?? "");
      if (src) return src === key || src.startsWith(`${key} `) || key.startsWith(`${src} `);
      return norm(it.title).startsWith(`${key} `);
    });
    const latest = own.map((o) => (o.publishedAt ?? "").slice(0, 10)).sort().reverse()[0] ?? "";
    results.push({ ticker: t, name, gnw: own.length > 0, hits: own.length, latest, sample: own[0]?.title ?? "" });
    n += 1;
    if (n % 50 === 0) process.stderr.write(`  ${n}/${tickers.length} checked, ${results.filter((r) => r.gnw).length} on GlobeNewswire so far\n`);
    await sleep(900);
  }
  writeFileSync(OUT, JSON.stringify(results, null, 1));
  const on = results.filter((r) => r.gnw);
  console.log(JSON.stringify({ checked: results.length, onGlobeNewswire: on.length, notOn: results.length - on.length }, null, 1));
  console.log("on GlobeNewswire:", on.map((r) => r.ticker).join(" "));
  await closePool();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
