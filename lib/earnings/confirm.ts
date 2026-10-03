/**
 * Confirmed-date layer: turn a press-wire advisory ("Acme to Report Third
 * Quarter 2026 Results on November 5") into a confirmed earnings event.
 *
 * A headline must satisfy TWO conditions — a quarter token AND a future-
 * tense scheduling verb — so "Acme Announces Third Quarter Results" (already
 * happened) never matches. Date, time of day, and ticker are then read from
 * the title and the first paragraphs the feed carries in its description.
 */

import type { TimeOfDay } from "./fiscal";
import { addDays, toISODate } from "@/lib/tradingDays";

function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return toISODate(addDays(new Date(y, m - 1, d), days));
}

export type ParsedAdvisory = {
  date: string; // YYYY-MM-DD
  timeOfDay: TimeOfDay;
  quarter: 1 | 2 | 3 | 4 | null;
  fiscalYear: number | null;
  tickers: string[]; // from "(NASDAQ: ABC)"-style mentions
  companyName: string | null; // text before the scheduling verb in the title
};

export type ParseOutcome =
  | { ok: true; parsed: ParsedAdvisory }
  | { ok: false; reason: string };

/* ---------------------------------------------
   PATTERNS
----------------------------------------------*/

const QUARTER_WORDS: Record<string, 1 | 2 | 3 | 4> = {
  first: 1,
  "1st": 1,
  second: 2,
  "2nd": 2,
  third: 3,
  "3rd": 3,
  fourth: 4,
  "4th": 4,
};

// "third quarter", "Q3", "3Q", "third-quarter", "fourth quarter and full year", "full year", "year-end"
export const QUARTER_TOKEN =
  /\b(?:(first|second|third|fourth|1st|2nd|3rd|4th)[\s-]+quarter|q([1-4])\b|([1-4])q\b|(full[\s-]year|fiscal[\s-]year|year[\s-]end|annual)\b)/i;

// Future-tense scheduling language. Must be present in the TITLE.
const SCHEDULING =
  /\b(?:to\s+(?:report|announce|release|host|hold|discuss|present|webcast|broadcast|issue|publish)|will\s+(?:report|announce|release|host|hold|discuss|present|webcast|broadcast|issue|publish)|schedules?|sets?\s+(?:the\s+)?(?:date|time)|announces?\s+(?:the\s+)?(?:date|timing|schedule|details)|announces?\s+(?:its\s+|a\s+)?(?:(?:earnings|results)\s+)?(?:conference\s+call|webcast)|conference\s+call\s+to\s+(?:review|discuss)|(?:earnings|results|financial results)\s+(?:release\s+)?(?:date|call|conference call|webcast|and conference call)|conference\s+call\s+(?:and|&)\s+webcast|date\s+(?:of|for)\s+(?:its\s+)?(?:\w+\s+){0,4}(?:earnings|results)|earnings\s+call)\b/i;

// Results already out — never a schedule even if a quarter token is present.
const ALREADY_REPORTED =
  /\b(?:reports?|reported|announces?|announced|posts?|delivers?|achieves?|records?)\s+(?:(?:record|strong|solid|preliminary|unaudited|its|their|a|an|the)\s+)?(?:\w+[\s-]+){0,4}(?:results|earnings|revenue|net income|profit|loss|sales)\b/i;

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

// "on Thursday, November 5, 2026" / "Nov. 5, 2026" / "November 5th" / "5 November 2026"
const DATE_PATTERNS = [
  /\b(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day,?\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?(?:\s+(\d{4}))?\b/gi,
  /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?,?(?:\s+(\d{4}))?\b/gi,
];

const POSTMARKET = /\b(?:after\s+(?:the\s+)?(?:[\w.]+\s+){0,3}(?:market|markets|close|trading)\s*(?:clos(?:e|es|ing)|closes)?|following\s+(?:the\s+)?(?:[\w.]+\s+){0,3}close|post[\s-]market|after[\s-]hours|after\s+the\s+bell)\b/i;
const PREMARKET = /\b(?:before\s+(?:the\s+)?(?:[\w.]+\s+){0,3}(?:market|markets)\s+open(?:s|ing)?|before\s+(?:the\s+)?(?:opening\s+of\s+)?(?:trading|market)|prior\s+to\s+(?:the\s+)?(?:[\w.]+\s+){0,3}(?:market\s+)?open(?:ing)?|pre[\s-]market|ahead\s+of\s+(?:the\s+)?(?:market\s+)?open(?:ing)?|before\s+the\s+bell)\b/i;
const CLOCK_TIME = /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?\s*(?:\(?\s*(?:e[sd]?t|eastern|et)\b)?/i;

const TICKER_MENTION =
  /\((?:NASDAQ|NASDAQGS|NASDAQGM|NASDAQCM|NYSE|NYSE\s+AMERICAN|NYSE\s+ARCA|NYSEAMERICAN|AMEX|CBOE)\s*:\s*([A-Z]{1,5}(?:[.-][A-Z]{1,2})?)\)/gi;

/* ---------------------------------------------
   PIECES
----------------------------------------------*/

export function parseQuarter(text: string): { quarter: 1 | 2 | 3 | 4 | null; fiscalYear: number | null } {
  const m = text.match(QUARTER_TOKEN);
  if (!m) return { quarter: null, fiscalYear: null };
  let quarter: 1 | 2 | 3 | 4 | null = null;
  if (m[1]) quarter = QUARTER_WORDS[m[1].toLowerCase()] ?? null;
  else if (m[2]) quarter = Number(m[2]) as 1 | 2 | 3 | 4;
  else if (m[3]) quarter = Number(m[3]) as 1 | 2 | 3 | 4;
  else if (m[4]) quarter = 4; // full year / fiscal year / year-end / annual

  // "fiscal 2027", "fiscal year 2027", "FY2027", "FY 27", "2026 third quarter"
  const fy =
    text.match(/\b(?:fiscal(?:\s+year)?|FY)\s*'?(\d{4}|\d{2})\b/i) ??
    text.match(/\b(20\d{2})\b/);
  let fiscalYear: number | null = null;
  if (fy) {
    const n = Number(fy[1]);
    fiscalYear = n < 100 ? 2000 + n : n;
  }
  return { quarter, fiscalYear };
}

const RESULTS_SENTENCE = /\b(results|earnings)\b/i;
// An explicit scheduling construction — "will release", "to report", "plans
// to announce" — or a call/webcast mention. "will be reported in" (a passive
// aside about where a transaction shows up) must not qualify.
const SCHEDULE_SENTENCE =
  /\b(?:will|to|plans?\s+to|expects?\s+to|intends?\s+to|scheduled\s+to)\s+(?:release|report|announce|issue|publish|host|hold|discuss)\b|\b(?:conference\s+call|webcast|earnings\s+call)\b/i;

/**
 * The scheduled date: first, a date inside a sentence that talks about
 * releasing/reporting results (so deal dates, datelines and other future
 * dates elsewhere in a release don't win); otherwise the first future date
 * in the text beyond the dateline.
 */
export function parseDate(text: string, publishedISO: string): string | null {
  const sentences = text.split(/(?<=[.!?])\s+|\n+/);
  for (const s of sentences) {
    if (!RESULTS_SENTENCE.test(s) || !SCHEDULE_SENTENCE.test(s)) continue;
    const d = firstFutureDate(s, publishedISO);
    if (d) return d;
  }
  return firstFutureDate(text, publishedISO);
}

function firstFutureDate(text: string, publishedISO: string): string | null {
  const published = publishedISO.slice(0, 10);
  const candidates: string[] = [];
  for (const re of DATE_PATTERNS) {
    for (const m of text.matchAll(re)) {
      const monthName = (re === DATE_PATTERNS[0] ? m[1] : m[2]).toLowerCase().replace(/\.$/, "");
      const day = Number(re === DATE_PATTERNS[0] ? m[2] : m[1]);
      const yearRaw = m[3];
      const month = MONTHS[monthName] ?? MONTHS[monthName.slice(0, 3)];
      if (!month || day < 1 || day > 31) continue;
      // "for the quarter ended September 30, 2026" is a period end, not the event.
      const before = text.slice(Math.max(0, (m.index ?? 0) - 30), m.index ?? 0);
      if (/\b(?:ended|ending|ends|as of|through|since|beginning)\s*(?:on\s+)?$/i.test(before)) continue;
      let year = yearRaw ? Number(yearRaw) : Number(published.slice(0, 4));
      let iso = toISODate(new Date(year, month - 1, day));
      if (!yearRaw && iso < published) {
        year += 1;
        iso = toISODate(new Date(year, month - 1, day));
      }
      candidates.push(iso);
    }
  }
  // The scheduling date is the first FUTURE date mentioned (datelines like
  // "Oct. 2, 2026" in the description are the publication date, not the event).
  const future = candidates.filter((d) => d > published);
  // A release dated the day after the feed/filing timestamp is still a
  // dateline, not the event; prefer a later date when one exists.
  const beyondDateline = future.filter((d) => d > addDaysISO(published, 1));
  return beyondDateline[0] ?? future[0] ?? null;
}

const MONTH_NAMES = ["january","february","march","april","may","june","july","august","september","october","november","december"];

/**
 * True when "Month D" (or "D Month") for the given ISO date appears literally
 * in the text. Guards model-extracted dates against invention: "early
 * November" must never become November 1.
 */
export function dateMentioned(text: string, iso: string): boolean {
  const [, m, d] = iso.split("-").map(Number);
  const full = MONTH_NAMES[m - 1];
  const abbr = full.slice(0, 3);
  const month = `(?:${full}|${abbr}\\.?|sept\\.?)`;
  const day = `0?${d}(?:st|nd|rd|th)?`;
  const re = new RegExp(`\\b${month}\\s+${day}\\b|\\b${day}\\s+${month}\\b`, "i");
  return re.test(text);
}

export function parseTimeOfDay(text: string): TimeOfDay {
  if (POSTMARKET.test(text)) return "postmarket";
  if (PREMARKET.test(text)) return "premarket";
  const t = text.match(CLOCK_TIME);
  if (t) {
    let hour = Number(t[1]) % 12;
    if (t[3].toLowerCase() === "p") hour += 12;
    const minutes = hour * 60 + Number(t[2] ?? 0);
    // Call times are a proxy: a 4:30 p.m. call means results after the close,
    // an 8:30 a.m. call means results before the open.
    if (minutes >= 16 * 60) return "postmarket";
    if (minutes < 9 * 60 + 30) return "premarket";
    return "during-market";
  }
  return "unknown";
}

export function parseTickers(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(TICKER_MENTION)) out.add(m[1].toUpperCase().replace(/\./g, "-"));
  return [...out];
}

function companyNameFromTitle(title: string): string | null {
  const m = title.match(SCHEDULING);
  if (!m || m.index === undefined) return null;
  const name = title.slice(0, m.index).replace(/[\s,:\-–—]+$/, "").trim();
  return name.length >= 2 && name.length <= 80 ? name : null;
}

/* ---------------------------------------------
   PARSE ONE ITEM
----------------------------------------------*/

export function parseAdvisory(title: string, description: string, publishedISO: string): ParseOutcome {
  const t = title.replace(/\s+/g, " ").trim();
  const text = `${t} ${description}`;

  if (!SCHEDULING.test(t)) return { ok: false, reason: "no scheduling language in title" };
  if (ALREADY_REPORTED.test(t) && !/\b(?:to|will)\s+(?:report|announce|release)\b/i.test(t)) {
    return { ok: false, reason: "results already reported" };
  }
  if (!QUARTER_TOKEN.test(text)) return { ok: false, reason: "no quarter token" };
  if (!/\b(?:earnings|results|financial results|operating results)\b/i.test(text)) {
    return { ok: false, reason: "not about earnings/results" };
  }

  const date = parseDate(text, publishedISO);
  if (!date) return { ok: false, reason: "no future date found" };

  // Sanity: advisories run 1–60 days ahead. Longer is a different kind of event.
  const daysAhead = Math.round((Date.parse(date) - Date.parse(publishedISO.slice(0, 10))) / 86_400_000);
  if (daysAhead > 75) return { ok: false, reason: `date ${daysAhead} days out` };

  const { quarter, fiscalYear } = parseQuarter(text);
  return {
    ok: true,
    parsed: {
      date,
      timeOfDay: parseTimeOfDay(text),
      quarter,
      fiscalYear,
      tickers: parseTickers(text),
      companyName: companyNameFromTitle(t),
    },
  };
}
