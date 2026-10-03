/**
 * Read-only check of the wire feeds and the advisory parser against live
 * traffic. Prints every item that matched, and every scheduling-shaped item
 * that didn't (the ones worth a fixture). No database writes, no model calls.
 *
 *   npx tsx scripts/earnings/wires-dryrun.ts
 */

import { FEEDS, fetchFeed } from "@/lib/earnings/wires";
import { parseAdvisory } from "@/lib/earnings/confirm";

const SILENT = new Set(["no scheduling language in title", "not about earnings/results"]);

(async () => {
  for (const feed of FEEDS) {
    let items;
    try {
      items = await fetchFeed(feed);
    } catch (err) {
      console.log(`\n=== ${feed.key}: FETCH FAILED — ${(err as Error).message}`);
      continue;
    }
    console.log(`\n=== ${feed.key}: ${items.length} items`);
    let matched = 0;
    let review = 0;
    for (const it of items) {
      const out = parseAdvisory(it.title, it.description, it.publishedAt ?? new Date().toISOString());
      if (out.ok) {
        matched += 1;
        const p = out.parsed;
        console.log(`  MATCH  ${p.date} ${p.timeOfDay.padEnd(13)} Q${p.quarter ?? "?"} FY${p.fiscalYear ?? "?"} ${p.tickers.join(",") || "(no ticker)"}  « ${it.title.slice(0, 90)} »`);
      } else if (!SILENT.has(out.reason)) {
        review += 1;
        console.log(`  review ${out.reason.padEnd(28)} « ${it.title.slice(0, 90)} »`);
      }
    }
    console.log(`  → ${matched} matched, ${review} for review, ${items.length - matched - review} ignored`);
  }
})();
