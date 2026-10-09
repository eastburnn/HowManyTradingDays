/**
 * Fingerprints of the pipeline's logic, so a change to how dates are worked
 * out applies itself to the whole site instead of waiting for someone to run
 * a backfill.
 *
 * Two fingerprints, because the two kinds of logic are redone differently:
 *
 *   - company logic (fiscal periods, the estimator, EDGAR reading): redo by
 *     refreshing every company;
 *   - feed logic (advisory parsing, wire and IR-site reading, inbound email):
 *     redo by putting recently ignored feed items back through the parser.
 *
 * next.config.ts computes both at build time and exposes them as environment
 * values; the scheduled tick compares them with what last ran (see
 * syncLogicFlush in jobs.ts). Scripts compute them from the source on disk.
 *
 * Node built-ins and relative imports only: next.config.ts loads this file.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Files that decide a company's fiscal periods, reported dates and estimates */
export const COMPANY_LOGIC_FILES = [
  "lib/earnings/fiscal.ts",
  "lib/earnings/estimator.ts",
  "lib/earnings/ingest.ts",
  "lib/earnings/edgar.ts",
  "lib/earnings/resultsReleases.ts",
  "lib/earnings/profile.ts",
  "lib/tradingDays.ts",
];

/** Files that decide whether a feed item becomes a confirmed date */
export const FEED_LOGIC_FILES = [
  "lib/earnings/confirm.ts",
  "lib/earnings/confirmJob.ts",
  "lib/earnings/llmParse.ts",
  "lib/earnings/wires.ts",
  "lib/earnings/irSites.ts",
  "lib/earnings/inboundEmail.ts",
  "lib/earnings/edgarAdvisories.ts",
];

export type LogicVersions = { company: string; feeds: string };

function fingerprint(root: string, files: string[]): string {
  const hash = createHash("sha1");
  for (const file of files) {
    hash.update(file);
    hash.update("\0");
    hash.update(readFileSync(join(root, file)));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 12);
}

export function computeLogicVersions(root: string = process.cwd()): LogicVersions {
  return { company: fingerprint(root, COMPANY_LOGIC_FILES), feeds: fingerprint(root, FEED_LOGIC_FILES) };
}
