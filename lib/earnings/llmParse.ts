/**
 * Language-model fallback for wire advisories the regex parser can't finish.
 *
 * Only headlines that already carry scheduling language are ever sent, so the
 * model sees a few hundred tokens for a few dozen items a day. The output is
 * validated against a schema (structured outputs) and then goes through the
 * same sanity checks and attachment logic as a regex match.
 *
 * Inert unless ANTHROPIC_API_KEY is set. Model: EARNINGS_LLM_MODEL, default
 * claude-haiku-4-5 (the inexpensive tier).
 */

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { ParsedAdvisory } from "./confirm";

const DEFAULT_MODEL = "claude-haiku-4-5";

const AdvisorySchema = z.object({
  is_scheduling_advisory: z
    .boolean()
    .describe("true only if the text announces a FUTURE date on which the company will release earnings/results"),
  date: z.string().nullable().describe("The announced release date as YYYY-MM-DD, or null"),
  time_of_day: z.enum(["premarket", "postmarket", "during-market", "unknown"]),
  quarter: z.number().int().min(1).max(4).nullable().describe("Fiscal quarter being reported; 4 for full-year/annual"),
  fiscal_year: z.number().int().nullable().describe("Fiscal year of the quarter if stated, else null"),
  tickers: z.array(z.string()).describe("Stock ticker symbols explicitly mentioned, e.g. from '(NASDAQ: ABC)'"),
  company_name: z.string().nullable().describe("The reporting company's name as written"),
});

const SYSTEM = `You extract earnings-release scheduling facts from press-release headlines and opening paragraphs.

A scheduling advisory announces a FUTURE date on which a company will release financial results (phrasing like "to report", "will announce", "schedules", "sets date", "announces date of ... earnings call"). It is NOT an advisory if the results are already out ("reports", "announces results", "posts record quarter"), if it is about an investor conference, annual meeting, dividend, product, lawsuit, or anything other than an upcoming earnings release.

Rules:
- Resolve dates to YYYY-MM-DD. If the year is not stated, use the next occurrence on or after the publication date.
- time_of_day: "postmarket" for after the close / after-hours / a call at 4:00 p.m. ET or later; "premarket" for before the open / a call before 9:30 a.m. ET; "during-market" for a stated time in between; otherwise "unknown".
- quarter is the fiscal quarter whose results will be released; use 4 for fourth quarter, full year, fiscal year, or annual results.
- Only list tickers that appear explicitly in the text. Never invent a ticker.
- When in doubt, set is_scheduling_advisory to false.`;

let client: Anthropic | null = null;

export function llmAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function getClient(): Anthropic {
  if (!client) client = new Anthropic({ maxRetries: 1, timeout: 30_000 });
  return client;
}

export type LlmOutcome =
  | { ok: true; parsed: ParsedAdvisory }
  | { ok: false; reason: string; retryable: boolean };

export async function parseAdvisoryWithModel(
  title: string,
  description: string,
  publishedISO: string
): Promise<LlmOutcome> {
  if (!llmAvailable()) return { ok: false, reason: "llm not configured", retryable: false };

  const published = publishedISO.slice(0, 10);
  try {
    const response = await getClient().messages.parse({
      model: process.env.EARNINGS_LLM_MODEL || DEFAULT_MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Publication date: ${published}\n\nHeadline: ${title}\n\nOpening text: ${description.slice(0, 1500) || "(none)"}`,
        },
      ],
      output_config: { format: zodOutputFormat(AdvisorySchema) },
    });

    if (response.stop_reason === "refusal") return { ok: false, reason: "llm refusal", retryable: false };
    const out = response.parsed_output;
    if (!out) return { ok: false, reason: "llm output did not parse", retryable: false };
    if (!out.is_scheduling_advisory) return { ok: false, reason: "llm: not a scheduling advisory", retryable: false };
    if (!out.date || !/^\d{4}-\d{2}-\d{2}$/.test(out.date)) return { ok: false, reason: "llm: no date", retryable: false };
    if (out.date <= published) return { ok: false, reason: "llm: date not in the future", retryable: false };
    const daysAhead = Math.round((Date.parse(out.date) - Date.parse(published)) / 86_400_000);
    if (daysAhead > 75) return { ok: false, reason: `llm: date ${daysAhead} days out`, retryable: false };

    return {
      ok: true,
      parsed: {
        date: out.date,
        timeOfDay: out.time_of_day,
        quarter: (out.quarter as 1 | 2 | 3 | 4 | null) ?? null,
        fiscalYear: out.fiscal_year ?? null,
        tickers: out.tickers.map((t) => t.toUpperCase().replace(/[^A-Z.-]/g, "").replace(/\./g, "-")).filter(Boolean),
        companyName: out.company_name,
      },
    };
  } catch (err) {
    // Most-specific first: transient failures are retried on a later run,
    // everything else is recorded and not retried.
    if (err instanceof Anthropic.RateLimitError) return { ok: false, reason: "llm rate limited", retryable: true };
    if (err instanceof Anthropic.APIConnectionError) return { ok: false, reason: "llm connection error", retryable: true };
    if (err instanceof Anthropic.AuthenticationError) return { ok: false, reason: "llm auth error", retryable: false };
    if (err instanceof Anthropic.APIError) {
      return { ok: false, reason: `llm api error ${err.status}`, retryable: (err.status ?? 0) >= 500 };
    }
    return { ok: false, reason: `llm error: ${(err as Error).message}`, retryable: false };
  }
}
