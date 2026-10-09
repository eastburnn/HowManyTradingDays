/**
 * How a company's results reach the public, for the note on its ticker page.
 *
 * Almost every listed company marks its results with a Form 8-K earnings
 * release (Item 2.02). Three kinds of registrant do not:
 *
 *   - blank-check companies (SPACs), which have no business to report on;
 *   - funds and trusts that hold commodities, currencies or digital assets,
 *     which file quarterly reports but have no earnings;
 *   - companies that never furnish an earnings 8-K, so the only dated event
 *     we can track is the 10-Q or 10-K itself.
 *
 * Safe to import from client components.
 */

export const BLANK_CHECK_SIC = "6770";
export const ASSET_TRUST_SIC = "6221";

/**
 * Quarterly filers that have no earnings releases to fall back to the 10-Q
 * date for. Their periodic reports are filings, not results announcements.
 */
export const NO_RELEASE_SICS = new Set([ASSET_TRUST_SIC, BLANK_CHECK_SIC]);

export type ReportingProfile = "blank-check" | "asset-trust" | "filing-only" | null;

/** Reported quarters needed before "never an earnings 8-K" is a pattern rather than a gap */
const MIN_FILING_ONLY_HISTORY = 4;

export function reportingProfile(input: {
  sic: string | null;
  /** Recent reported quarters, any order */
  history: Array<{ sourceType: string }>;
  /** Earnings 8-Ks on file from the last 18 months (Item 2.02, or verified from the exhibit) */
  recentEarnings8Ks: number;
}): ReportingProfile {
  const { sic, history, recentEarnings8Ks } = input;
  // A SIC code outlives a merger: a former SPAC that now reports results is an ordinary company.
  const reportsResults = recentEarnings8Ks > 0 || history.some((h) => h.sourceType === "edgar-8k");
  if (reportsResults) return null;
  if (sic === BLANK_CHECK_SIC) return "blank-check";
  if (sic === ASSET_TRUST_SIC) return "asset-trust";
  if (history.length >= MIN_FILING_ONLY_HISTORY && history.every((h) => h.sourceType === "edgar-periodic")) return "filing-only";
  return null;
}
