/**
 * Investor-relations feeds, run by hand:
 *
 *   discover  — find IR feeds for companies not yet looked at (largest first)
 *               npx tsx --env-file=.env.local scripts/earnings/ir-sites.ts discover --limit 400 --concurrency 4
 *   poll      — read every due feed now and run the confirmation pipeline
 *               npx tsx --env-file=.env.local scripts/earnings/ir-sites.ts poll --limit 500
 *   probe     — dry run for a few tickers: candidates, probe result, feed items (no writes)
 *               npx tsx --env-file=.env.local scripts/earnings/ir-sites.ts probe FDX BLK TMO
 *
 * The scheduled jobs do the same work a few companies at a time; this is for
 * the initial pass. One request at a time per host, identified User-Agent,
 * robots.txt honored.
 */

import { closePool, query } from "@/lib/earnings/db";
import { SEC_USER_AGENT } from "@/lib/earnings/edgar";
import { discoverIrSource, feedMentionsCompany, irHostCandidates, probeIrHost, readIrSource, type IrSource } from "@/lib/earnings/irSites";
import { pollIrSourcesBatch } from "@/lib/earnings/jobs";
import { processFeedItems } from "@/lib/earnings/confirmJob";
import { todayET } from "@/lib/earnings/ingest";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function releaseText(cik: number): Promise<string> {
  const [row] = await query<{ accession: string | null }>(
    `select source_accession as accession from earnings_current
      where cik = $1 and status = 'reported' and source_type = 'edgar-8k' and source_accession is not null
      order by event_date desc limit 1`,
    [cik]
  );
  if (!row?.accession) return "";
  const folder = `https://www.sec.gov/Archives/edgar/data/${cik}/${row.accession.replace(/-/g, "")}/`;
  const index = await (await fetch(folder, { headers: { "User-Agent": SEC_USER_AGENT } })).text();
  const docs = [...index.matchAll(/href="(\/Archives\/edgar\/data\/[^"]+\.(?:htm|txt))"/gi)].map((m) => m[1]).filter((h) => !/index/i.test(h));
  const exhibit = docs.find((d) => /ex[-_]?99|99-?1|exhibit/i.test(d)) ?? docs[0];
  if (!exhibit) return "";
  await new Promise((r) => setTimeout(r, 150));
  const html = await (await fetch(`https://www.sec.gov${exhibit}`, { headers: { "User-Agent": SEC_USER_AGENT } })).text();
  return html.replace(/<[^>]+>/g, " ").slice(0, 60_000);
}

(async () => {
  const mode = process.argv[2] ?? "probe";

  if (mode === "probe") {
    const tickers = process.argv.slice(3).filter((t) => !t.startsWith("--")).map((t) => t.toUpperCase());
    const rows = await query<{ cik: number; ticker: string; name: string }>(`select cik, ticker, name from companies where upper(ticker) = any($1)`, [tickers]);
    for (const r of rows) {
      const text = await releaseText(r.cik);
      const hints = { name: r.name, ticker: r.ticker };
      const candidates = irHostCandidates(text, hints);
      console.log(`\n${r.ticker}: candidates ${JSON.stringify(candidates)}`);
      for (const host of candidates) {
        const p = await probeIrHost(host);
        console.log(`  ${host} → ${p ? `${p.platform} events=${p.events_url ?? "-"} releases=${p.releases_url ?? "-"}` : "unreachable"}`);
        if (p && p.platform !== "none" && p.platform !== "blocked") {
          const read = await readIrSource({ cik: r.cik, ...p }, todayET());
          const sampleXml = read.releases.concat(read.events).map((i) => `<title>${i.title}</title>`).join("");
          console.log(`    mentions company: ${feedMentionsCompany(sampleXml, hints)}`);
          console.log(`    events→advisories: ${read.events.map((e) => `« ${e.title} »`).join(" | ") || "none"}`);
          console.log(`    releases: ${read.releases.slice(0, 3).map((e) => `« ${e.title.slice(0, 80)} »`).join(" | ")}`);
          break;
        }
      }
    }
  } else if (mode === "discover") {
    const limit = Number(arg("limit", "200"));
    const concurrency = Number(arg("concurrency", "4"));
    const todo = await query<{ cik: number; ticker: string; name: string }>(
      `select c.cik, c.ticker, c.name from companies c
        where c.active and not exists (select 1 from ir_sources s where s.cik = c.cik and s.discovered_at > now() - interval '30 days')
        order by (c.filer_category = 'large-accelerated') desc, (c.filer_category = 'accelerated') desc, c.indexed desc, c.ticker
        limit $1`,
      [limit]
    );
    console.log(`discovering IR feeds for ${todo.length} companies (concurrency ${concurrency})`);
    const tally: Record<string, number> = {};
    let cursor = 0;
    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        while (cursor < todo.length) {
          const c = todo[cursor++];
          try {
            const src: IrSource = await discoverIrSource(c.cik, await releaseText(c.cik), { name: c.name, ticker: c.ticker });
            tally[src.platform] = (tally[src.platform] ?? 0) + 1;
            if (src.platform !== "none") process.stderr.write(`  ${c.ticker.padEnd(6)} ${src.platform.padEnd(8)} ${src.host ?? ""}\n`);
          } catch (err) {
            tally.error = (tally.error ?? 0) + 1;
            process.stderr.write(`  ${c.ticker.padEnd(6)} error ${(err as Error).message}\n`);
          }
        }
      })
    );
    console.log(JSON.stringify(tally));
  } else if (mode === "poll") {
    const limit = Number(arg("limit", "500"));
    const r = await pollIrSourcesBatch(limit);
    console.log("polled:", JSON.stringify(r));
    const total = { processed: 0, matched: 0, confirmed: 0, ignored: 0, failed: 0, llmCalls: 0, llmMatched: 0, pageReads: 0 };
    for (let pass = 0; pass < 40; pass++) {
      const s = await processFeedItems(200, 200, 200);
      if (s.processed === 0) break;
      for (const k of Object.keys(total) as (keyof typeof total)[]) total[k] += s[k];
    }
    console.log("processed:", JSON.stringify(total));
  }
  await closePool();
})().catch(async (e) => {
  console.error(e);
  await closePool();
  process.exit(1);
});
