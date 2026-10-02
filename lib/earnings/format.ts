/**
 * Display helpers for earnings pages (safe to import from client components).
 */

import type { EarningsEvent } from "./queries";

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function formatLongDate(iso: string): string {
  return parseISODate(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function formatMediumDate(iso: string): string {
  return parseISODate(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatShortDate(iso: string): string {
  return parseISODate(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function weekdayOf(iso: string): string {
  return parseISODate(iso).toLocaleDateString("en-US", { weekday: "long" });
}

export function addDaysISO(iso: string, days: number): string {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function daysBetweenISO(fromISO: string, toISO: string): number {
  return Math.round((parseISODate(toISO).getTime() - parseISODate(fromISO).getTime()) / 86_400_000);
}

export function fiscalLabel(e: Pick<EarningsEvent, "fiscalYear" | "fiscalQuarter">): string {
  return `Fiscal Q${e.fiscalQuarter} ${e.fiscalYear}`;
}

export function timeOfDayLabel(tod: EarningsEvent["timeOfDay"]): string {
  switch (tod) {
    case "premarket":
      return "Before the open";
    case "postmarket":
      return "After the close";
    case "during-market":
      return "During market hours";
    default:
      return "Time not yet known";
  }
}

export function timeOfDaySentence(tod: EarningsEvent["timeOfDay"]): string {
  switch (tod) {
    case "premarket":
      return "before the market opens";
    case "postmarket":
      return "after the market closes";
    case "during-market":
      return "during market hours";
    default:
      return "at a time not yet known";
  }
}

export function statusLabel(e: Pick<EarningsEvent, "status" | "confidence">): string {
  if (e.status === "confirmed") return "Confirmed";
  if (e.status === "reported") return "Reported";
  switch (e.confidence) {
    case "high":
      return "Estimated";
    case "medium":
      return "Estimated · wider window";
    default:
      return "Expected window";
  }
}

/**
 * The ± window to show for an estimate, as [start, end] ISO dates. Never
 * starts before `today`: an overdue estimate reads "any day now", not a
 * range reaching into the past.
 */
export function estimateWindow(
  e: Pick<EarningsEvent, "eventDate" | "windowDays" | "status">,
  today?: string
): [string, string] {
  if (e.status !== "estimated") return [e.eventDate, e.eventDate];
  const w = e.windowDays ?? 3;
  let start = addDaysISO(e.eventDate, -w);
  if (today && start < today) start = today;
  return [start, addDaysISO(e.eventDate, w)];
}

/**
 * SEC registrant names are shouty and suffixed ("COSTCO WHOLESALE CORP /NEW",
 * "ACUITY INC. (DE)"). Clean them for display without touching mixed-case
 * names companies filed themselves ("Apple Inc.").
 */
export function displayName(raw: string): string {
  let name = raw
    .replace(/\s*\/[A-Z]{2,3}\/?\s*$/i, "")      // "/DE/", "/NEW"
    .replace(/\s*\((DE|MD|NY|NV|OH|PA|TX|NEW)\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (/[a-z]/.test(name)) return name;
  const small = new Set(["of", "and", "the", "for", "de", "la"]);
  const suffix = new Set(["inc", "corp", "co", "ltd", "llc", "plc", "lp", "cos", "intl", "ent", "grp", "hldgs", "svcs"]);
  name = name
    .toLowerCase()
    .split(" ")
    .map((w, i) => {
      const bare = w.replace(/[.,]/g, "");
      if (i > 0 && small.has(bare)) return w;
      if (bare.length <= 3 && !suffix.has(bare)) return w.toUpperCase(); // acronyms: KB, RPM, AT&T
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(" ");
  return name;
}

export function formatQuarterEnd(iso: string): string {
  return parseISODate(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}
