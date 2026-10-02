/**
 * Earnings-date estimator.
 *
 * Predicts when a company will release results for a fiscal quarter from its
 * own history of the SAME fiscal quarter in prior years (Q4 runs weeks later
 * than Q1–Q3 because the 10-K takes longer, so quarters are never pooled).
 *
 * Four methods are implemented so the backtest can pick on evidence:
 *   nth-weekday  — "the 4th Thursday after period end" (business rhythm)
 *   raw-offset   — "N calendar days after period end"
 *   offset-snap  — raw offset, then shifted to the company's usual weekday
 *   last-year    — offset-snap using only the most recent year (tracks drift)
 *
 * Every result is snapped forward off weekends/market holidays with the
 * site's trading-day engine and clamped to the SEC filing deadline.
 *
 * Backtest (Oct 2026, 500 companies, trained through 2025, tested on 2026
 * releases; `npm run earnings:backtest`): offset-snap beats nth-weekday by
 * 10+ points at ±3 days. Large/accelerated filers do best on last year alone
 * (75.5% / 71.4% within ±3); non-accelerated filers do best on a six-year
 * recency-weighted window (58.2%). Those are the defaults below.
 */

import type { FilerCategory } from "./edgar";
import {
  type EarningsObservation,
  type ReportForm,
  addDaysISO,
  daysBetween,
  filingDeadlineDays,
  parseISO,
} from "./fiscal";
import { addDays, getDayInfo, toISODate } from "@/lib/tradingDays";

export type EstimateMethod = "nth-weekday" | "raw-offset" | "offset-snap" | "last-year";

/**
 * Confidence tiers, calibrated from the backtest on the six-year SD of a
 * company's same-quarter release offsets:
 *   high    SD ≤ 4  → ~72–78% within ±3 days, ~94% within ±7
 *   medium  SD 4–7  → ~55% within ±3, ~87% within ±7
 *   low     SD > 7  → ~47% within ±3, ~76% within ±7 (show a window, not a date)
 * A single prior observation has no SD, so it is capped at medium.
 */
export type ConfidenceTier = "high" | "medium" | "low";

export type Estimate = {
  date: string; // YYYY-MM-DD, snapped to a trading day
  method: EstimateMethod;
  confidence: ConfidenceTier;
  /** Half-width in days of the window to show for this tier (3, 7, or 14) */
  windowDays: number;
  /** Number of same-quarter observations the estimate drew on */
  observations: number;
  /** Standard deviation (days) of historical release offsets — the error bar */
  sdDays: number;
  /** True if the raw estimate exceeded the filing deadline and was pulled back */
  clampedToDeadline: boolean;
  /** Most common time of day across the observations */
  timeOfDay: EarningsObservation["timeOfDay"];
};

export type EstimateInput = {
  /** Prior-year observations for the SAME fiscal quarter, any order */
  history: EarningsObservation[];
  /** Period end of the quarter being predicted */
  periodEnd: string;
  reportForm: ReportForm;
  category: FilerCategory;
  method?: EstimateMethod;
  /** Use at most this many of the most recent years (default 6) */
  maxYears?: number;
  /** Recency weight = decay^k for the k-th most recent year (default 0.7) */
  decay?: number;
};

const DEFAULT_RECENCY_DECAY = 0.7;
const SD_HISTORY_YEARS = 6; // the error bar always uses the long history

/** Backtest-chosen window per filer category (see header comment) */
function defaultWindow(category: FilerCategory): { maxYears: number; decay: number } {
  return category === "large-accelerated" || category === "accelerated"
    ? { maxYears: 1, decay: 1 }
    : { maxYears: SD_HISTORY_YEARS, decay: DEFAULT_RECENCY_DECAY };
}

export function confidenceTier(sdDays: number, observations: number): ConfidenceTier {
  if (observations < 2) return "medium";
  if (sdDays <= 4) return "high";
  if (sdDays <= 7) return "medium";
  return "low";
}

const WINDOW_DAYS: Record<ConfidenceTier, number> = { high: 3, medium: 7, low: 14 };

/* ---------------------------------------------
   WEIGHTED STATISTICS
----------------------------------------------*/

function weightedMedian(values: number[], weights: number[]): number {
  const idx = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
  const total = weights.reduce((s, w) => s + w, 0);
  let acc = 0;
  for (const i of idx) {
    acc += weights[i];
    if (acc >= total / 2) return values[i];
  }
  return values[idx[idx.length - 1]];
}

function weightedMode(values: number[], weights: number[]): number {
  const totals = new Map<number, number>();
  values.forEach((v, i) => totals.set(v, (totals.get(v) ?? 0) + weights[i]));
  let best = values[0];
  let bestWeight = -1;
  for (const [v, w] of totals) {
    if (w > bestWeight) {
      best = v;
      bestWeight = w;
    }
  }
  return best;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/* ---------------------------------------------
   DATE ARITHMETIC
----------------------------------------------*/

/** 1-based: how many times `weekday` has occurred in (periodEnd, date] */
function nthOccurrenceOfWeekday(periodEnd: string, date: string): number {
  const weekday = parseISO(date).getDay();
  const firstAfter = addDays(parseISO(periodEnd), 1);
  const firstMatch = (weekday - firstAfter.getDay() + 7) % 7; // days until first such weekday
  const daysAfter = daysBetween(periodEnd, date) - 1; // 0-based days since firstAfter
  return Math.floor((daysAfter - firstMatch) / 7) + 1;
}

function nthWeekdayAfter(periodEnd: string, weekday: number, n: number): string {
  const firstAfter = addDays(parseISO(periodEnd), 1);
  const firstMatch = (weekday - firstAfter.getDay() + 7) % 7;
  return toISODate(addDays(firstAfter, firstMatch + 7 * (n - 1)));
}

function snapToWeekday(dateISO: string, weekday: number): string {
  const d = parseISO(dateISO);
  let delta = (weekday - d.getDay() + 7) % 7;
  if (delta > 3) delta -= 7; // nearest occurrence, never more than 3 days away
  return toISODate(addDays(d, delta));
}

function nextTradingDayOnOrAfter(dateISO: string): string {
  let d = parseISO(dateISO);
  while (!getDayInfo(d).isTradingDay) d = addDays(d, 1);
  return toISODate(d);
}

function lastTradingDayOnOrBefore(dateISO: string): string {
  let d = parseISO(dateISO);
  while (!getDayInfo(d).isTradingDay) d = addDays(d, -1);
  return toISODate(d);
}

/* ---------------------------------------------
   ESTIMATE
----------------------------------------------*/

export function estimateReleaseDate(input: EstimateInput): Estimate | null {
  const method = input.method ?? "offset-snap";
  const window = defaultWindow(input.category);
  const maxYears = method === "last-year" ? 1 : input.maxYears ?? window.maxYears;
  const decay = input.decay ?? window.decay;

  // Most recent first, one observation per fiscal year
  const byYear = new Map<number, EarningsObservation>();
  for (const o of input.history) {
    if (!byYear.has(o.fiscalYear) || byYear.get(o.fiscalYear)!.releaseDate < o.releaseDate) {
      byYear.set(o.fiscalYear, o);
    }
  }
  const allHistory = [...byYear.values()].sort((a, b) => b.fiscalYear - a.fiscalYear);
  const history = allHistory.slice(0, maxYears);
  if (history.length === 0) return null;

  const weights = history.map((_, k) => decay ** k);
  const offsets = history.map((o) => daysBetween(o.periodEnd, o.releaseDate));
  const weekdays = history.map((o) => parseISO(o.releaseDate).getDay());

  // Error bar from the long history regardless of the prediction window
  const longHistory = allHistory.slice(0, SD_HISTORY_YEARS);
  const sdDays =
    Math.round(standardDeviation(longHistory.map((o) => daysBetween(o.periodEnd, o.releaseDate))) * 10) / 10;
  const confidence = confidenceTier(sdDays, longHistory.length);

  let raw: string;
  switch (method) {
    case "raw-offset":
      raw = addDaysISO(input.periodEnd, weightedMedian(offsets, weights));
      break;
    case "offset-snap":
    case "last-year":
      raw = snapToWeekday(
        addDaysISO(input.periodEnd, weightedMedian(offsets, weights)),
        weightedMode(weekdays, weights)
      );
      break;
    case "nth-weekday":
    default: {
      const weekday = weightedMode(weekdays, weights);
      const matching = history
        .map((o, i) => ({ o, w: weights[i] }))
        .filter(({ o }) => parseISO(o.releaseDate).getDay() === weekday);
      const ns = matching.map(({ o }) => nthOccurrenceOfWeekday(o.periodEnd, o.releaseDate));
      const n = weightedMedian(ns, matching.map(({ w }) => w));
      raw = nthWeekdayAfter(input.periodEnd, weekday, n);
    }
  }

  // Clamp to the filing deadline, then snap onto a trading day
  const deadline = addDaysISO(input.periodEnd, filingDeadlineDays(input.reportForm, input.category));
  let clamped = false;
  let date: string;
  if (raw > deadline) {
    date = lastTradingDayOnOrBefore(deadline);
    clamped = true;
  } else {
    date = nextTradingDayOnOrAfter(raw);
    if (date > deadline) {
      date = lastTradingDayOnOrBefore(deadline);
      clamped = true;
    }
  }

  const timeOfDayVotes = new Map<EarningsObservation["timeOfDay"], number>();
  history.forEach((o, i) =>
    timeOfDayVotes.set(o.timeOfDay, (timeOfDayVotes.get(o.timeOfDay) ?? 0) + weights[i])
  );
  const timeOfDay = [...timeOfDayVotes.entries()].sort((a, b) => b[1] - a[1])[0][0];

  return {
    date,
    method,
    confidence,
    windowDays: WINDOW_DAYS[confidence],
    observations: longHistory.length,
    sdDays,
    clampedToDeadline: clamped,
    timeOfDay,
  };
}
