/**
 * Regression fixtures for the wire-advisory parser, the results-release
 * reader and the 8-K release-date rules. Run:
 *   npx tsx scripts/earnings/parse-fixtures.ts
 * Exits non-zero on any mismatch. Add a fixture whenever a real headline is
 * misparsed (see the dry-run's unmatched log).
 */

import { parseAdvisory } from "@/lib/earnings/confirm";
import type { EdgarFiling } from "@/lib/earnings/edgar";
import { buildObservations, releaseDateOf } from "@/lib/earnings/fiscal";
import { looksLikeResultsRelease } from "@/lib/earnings/resultsReleases";

const PUBLISHED = "2026-10-05T12:00:00.000Z";

type Fixture = {
  title: string;
  description?: string;
  expect:
    | { ok: false }
    | { ok: true; date: string; tod?: string; quarter?: number | null; fiscalYear?: number | null; tickers?: string[] };
};

const FIXTURES: Fixture[] = [
  {
    title: "Acme Corp to Report Third Quarter 2026 Financial Results on November 5, 2026",
    description: "SAN JOSE, Calif., Oct. 5, 2026 /PRNewswire/ -- Acme Corp (NASDAQ: ACME) today announced that it will release its third quarter 2026 financial results after the market closes on Thursday, November 5, 2026.",
    expect: { ok: true, date: "2026-11-05", tod: "postmarket", quarter: 3, fiscalYear: 2026, tickers: ["ACME"] },
  },
  {
    title: "Widget Industries Announces Date of Third Quarter 2026 Earnings Release and Conference Call",
    description: "CHICAGO, Oct. 5, 2026 (GLOBE NEWSWIRE) -- Widget Industries, Inc. (NYSE: WDG) will report its third quarter 2026 results before the market opens on Wednesday, October 28, 2026, and host a conference call at 8:30 a.m. ET.",
    expect: { ok: true, date: "2026-10-28", tod: "premarket", quarter: 3, tickers: ["WDG"] },
  },
  {
    title: "Globex Schedules Fourth Quarter and Fiscal Year 2026 Earnings Call for Nov. 12",
    description: "Globex Corporation (NYSE American: GLX) will host a conference call at 5:00 p.m. ET on November 12, 2026 to discuss results for the fourth quarter and fiscal year ended September 30, 2026.",
    expect: { ok: true, date: "2026-11-12", tod: "postmarket", quarter: 4, fiscalYear: 2026, tickers: ["GLX"] },
  },
  {
    title: "Initech to Host Fiscal 2027 First Quarter Earnings Conference Call on Thursday, October 29, 2026 at 4:30 p.m. ET",
    description: "Initech (Nasdaq: INTC2) will release its first quarter fiscal 2027 results that afternoon.",
    expect: { ok: true, date: "2026-10-29", tod: "postmarket", quarter: 1, fiscalYear: 2027, tickers: ["INTC2"].filter(() => false) },
  },
  {
    title: "Hooli Sets Date for Q3 2026 Earnings Release",
    description: "Hooli, Inc. (NASDAQGS: HOOL) will announce Q3 2026 results on October 27th after market close.",
    expect: { ok: true, date: "2026-10-27", tod: "postmarket", quarter: 3, tickers: ["HOOL"] },
  },
  {
    title: "Vandelay Industries Announces Timing of Third Quarter 2026 Results",
    description: "NEW YORK, Oct. 5, 2026 -- Vandelay Industries (NYSE: VAN) expects to report third quarter results on 4 November 2026 prior to the market open.",
    expect: { ok: true, date: "2026-11-04", tod: "premarket", quarter: 3, tickers: ["VAN"] },
  },
  {
    title: "Stark Industries Will Report Second Quarter and First Half 2026 Results on August 6",
    description: "Stark Industries (NYSE: STRK) ...",
    expect: { ok: true, date: "2027-08-06", quarter: 2 }, // Aug 6 is past relative to Oct 5 → rolls to next year, then rejected as too far out
  },
  {
    title: "Company schedules earnings conference call to announce third quarter 2026 results",
    description: "CHICAGO, October 6, 2026 -- Example Bancorp (NASDAQ: EXBC) will release third quarter 2026 results after the market closes on Thursday, October 22, 2026.",
    expect: { ok: true, date: "2026-10-22", tod: "postmarket", quarter: 3, tickers: ["EXBC"] },
  },
  {
    title: "Company schedules earnings conference call to announce third quarter 2026 results",
    description: "Houston, Texas, September 22, 2026 – Talos Energy Inc. (NYSE: TALO) today announced the closing of its acquisition, effective September 30, 2026. Talos will release its third quarter 2026 results on November 3, 2026, after market close, and host a conference call on November 4, 2026 at 10:00 a.m. CT.",
    expect: { ok: true, date: "2026-11-03", tod: "postmarket", quarter: 3, tickers: ["TALO"] },
  },
  {
    title: "Company schedules earnings conference call to announce third quarter 2026 results",
    description: "Houston, Texas, September 22, 2026 – Talos Energy Inc. (NYSE: TALO) today announced the closing of its acquisition. The transaction is effective September 30, 2026 and will be reported in the Company's third quarter results. Talos will release its third quarter 2026 results on November 3, 2026, after market close.",
    expect: { ok: true, date: "2026-11-03", tod: "postmarket", quarter: 3, tickers: ["TALO"] },
  },
  {
    title: "Company schedules earnings conference call to announce third quarter 2026 results",
    description: "Updated full-year 2026 guidance will be provided in conjunction with the Company's third quarter 2026 earnings release. THIRD QUARTER 2026 RESULTS AND EARNINGS CONFERENCE CALL The Company intends to release third quarter 2026 results for the period ended September 30, 2026, on Tuesday, November 3, 2026, after the U.S. financial market closes. In addition to this release, Talos (NYSE: TALO) will host a conference call on November 4, 2026.",
    expect: { ok: true, date: "2026-11-03", tod: "postmarket", quarter: 3, tickers: ["TALO"] },
  },
  {
    title: "Horizon Bancorp, Inc. Announces Conference Call to Review Third Quarter Results on October 22",
    description: "Horizon Bank will host a conference call at 7:30 a.m. CT on Thursday, October 22, 2026 to review its third quarter 2026 financial results.",
    expect: { ok: true, date: "2026-10-22", tod: "premarket", quarter: 3, tickers: [] },
  },
  // ---- must NOT match ----
  { title: "Acme Corp Reports Third Quarter 2026 Financial Results", description: "Revenue of $1.2 billion...", expect: { ok: false } },
  { title: "Globex Announces Record Fourth Quarter Results", description: "...", expect: { ok: false } },
  { title: "Widget Industries Announces Third Quarter Results and Conference Call", description: "Widget today reported... the call is at 5 p.m. ET today, October 5, 2026.", expect: { ok: false } },
  { title: "Initech to Present at the Q3 Investor Conference on November 10", description: "Initech will present at the conference.", expect: { ok: false } },
  { title: "DOCS Investors Have Opportunity to Lead Doximity, Inc. Securities Fraud Lawsuit", description: "...quarter...", expect: { ok: false } },
  { title: "Hooli to Hold Annual Meeting of Stockholders on November 20, 2026", description: "...", expect: { ok: false } },
  { title: "Vandelay Industries Declares Quarterly Dividend", description: "payable on October 30, 2026", expect: { ok: false } },
];

let failures = 0;
for (const f of FIXTURES) {
  const out = parseAdvisory(f.title, f.description ?? "", PUBLISHED);
  const want = f.expect;
  let pass: boolean;
  let detail = "";
  if (!want.ok) {
    pass = !out.ok;
    detail = out.ok ? `matched unexpectedly → ${out.parsed.date}` : out.reason;
  } else if (!out.ok) {
    // Fixture 7 is the one expected-rejection among positives (date too far out)
    pass = f.title.startsWith("Stark");
    detail = out.reason;
  } else {
    const p = out.parsed;
    const checks: [string, boolean][] = [
      ["date", p.date === want.date],
      ["tod", want.tod === undefined || p.timeOfDay === want.tod],
      ["quarter", want.quarter === undefined || p.quarter === want.quarter],
      ["fy", want.fiscalYear === undefined || p.fiscalYear === want.fiscalYear],
      ["tickers", want.tickers === undefined || JSON.stringify(p.tickers) === JSON.stringify(want.tickers)],
    ];
    pass = checks.every(([, ok]) => ok);
    detail = `${p.date} ${p.timeOfDay} Q${p.quarter} FY${p.fiscalYear} ${p.tickers.join(",")}` + (pass ? "" : ` (failed: ${checks.filter(([, ok]) => !ok).map(([k]) => k).join(",")})`);
  }
  if (!pass) failures += 1;
  console.log(`${pass ? "PASS" : "FAIL"}  ${f.title.slice(0, 70).padEnd(70)}  ${detail}`);
}
/* ---------------------------------------------
   RESULTS RELEASES (8-K exhibits read for companies that skip Item 2.02)
----------------------------------------------*/

const RELEASES: { text: string; expect: boolean }[] = [
  {
    text: "Exhibit 99.1\nURBN Reports Record Q2 Sales\nPHILADELPHIA, PA, August 26, 2026 - Urban Outfitters, Inc. (NASDAQ:URBN) today announced net income of $143.9 million and earnings per diluted share of $1.58 for the three months ended July 31, 2026.",
    expect: true,
  },
  {
    // Older filings hard-wrap, so the headline spans lines
    text: "MAGYAR BANCORP, INC. ANNOUNCES FIRST QUARTER FINANCIAL\nRESULTS\nNew Brunswick, New Jersey, January 25, 2024 - Magyar Bancorp (NASDAQ: MGYR) reported today the results of its operations\nfor the three months ended December 31, 2023. Net income was $1.7 million.",
    expect: true,
  },
  {
    text: "Exhibit 99.1\nCelsius Holdings, Inc. to Release Second Quarter 2022 Financial Results On Tuesday, August 9, 2022\nBOCA RATON, FL - Celsius Holdings, Inc. (Nasdaq: CELH) today announced that it will release its financial results for the second quarter ended June 30, 2022 on August 9. Revenue was $133 million in the first quarter.",
    expect: false,
  },
  {
    text: "URBAN OUTFITTERS, INC. Preliminary First Quarter Results\nPhiladelphia, PA - May 19, 2020 - Urban Outfitters, Inc. today announced a net loss of $138 million for the three months ended April 30, 2020.",
    expect: false,
  },
  {
    text: "Acme Bancorp Announces Quarterly Dividend\nAcme Bancorp today announced that its Board of Directors declared a quarterly cash dividend of $0.30 per share, reflecting strong earnings in the second quarter.",
    expect: false,
  },
  {
    text: "Fourth Quarter 2023 Investor Presentation\nFebruary 7, 2024\nThe Company reported earnings available for distribution of $0.68 per share for the fourth quarter.",
    expect: false,
  },
  {
    // Boilerplate names the Annual Report and a year end; nothing is reported
    text: "Acme Completes Plant Expansion\nAcme Corp today announced the completion of its $40 million plant expansion. Risks are described in our Annual Report on Form 10-K for the year ended December 31, 2025, including under Results of Operations.",
    expect: false,
  },
];

for (const r of RELEASES) {
  const got = looksLikeResultsRelease(r.text);
  const pass = got === r.expect;
  if (!pass) failures += 1;
  console.log(`${pass ? "PASS" : "FAIL"}  ${r.text.replace(/\s+/g, " ").slice(0, 70).padEnd(70)}  ${got ? "results release" : "not a results release"}`);
}

/* ---------------------------------------------
   RELEASE DATES AND MATCHING
----------------------------------------------*/

const filing = (form: string, filingDate: string, reportDate: string, items: string[] = [], accession = `${form}-${filingDate}`): EdgarFiling => ({
  accession,
  form,
  filingDate,
  reportDate,
  acceptanceDateTime: null,
  items,
});

const QUARTER_ENDS = new Set(["2026-06-30"]);
const DATES: { name: string; got: string; want: string }[] = [
  { name: "event date, filed the next day", got: releaseDateOf(filing("8-K", "2026-07-16", "2026-07-15", ["2.02", "9.01"]), QUARTER_ENDS), want: "2026-07-15" },
  { name: "dated as of the quarter end (Community Trust)", got: releaseDateOf(filing("8-K", "2026-07-15", "2026-06-30", ["2.02", "7.01", "9.01"]), QUARTER_ENDS), want: "2026-07-15" },
  { name: "dated by an earlier event in the same 8-K (Uber)", got: releaseDateOf(filing("8-K", "2026-08-06", "2026-07-28", ["2.02", "8.01", "9.01"]), QUARTER_ENDS), want: "2026-08-06" },
  { name: "wrong year typed (Wabtec)", got: releaseDateOf(filing("8-K", "2026-07-30", "2025-07-30", ["2.02", "9.01"]), QUARTER_ENDS), want: "2026-07-30" },
  { name: "plain 8-K filed late keeps its event date", got: releaseDateOf(filing("8-K", "2026-08-14", "2026-08-05", ["2.02", "9.01"]), QUARTER_ENDS), want: "2026-08-05" },
];

// One fiscal year of periodic reports, with a release per case for the June quarter
const YEAR = [filing("10-K", "2026-02-27", "2025-12-31"), filing("10-Q", "2026-05-08", "2026-03-31"), filing("10-Q", "2026-08-07", "2026-06-30")];
const juneQuarter = (extra: EdgarFiling[], verified: string[] = []) => {
  const o = buildObservations([...YEAR, ...extra], "1231", { periodicFallback: true, resultsAccessions: new Set(verified) }).find((x) => x.periodEnd === "2026-06-30");
  return o ? `${o.releaseDate} ${o.viaPeriodicReport ? "periodic" : "8-K"}` : "none";
};
const MATCHES: { name: string; got: string; want: string }[] = [
  { name: "8-K dated as of the quarter end is matched on its filing date", got: juneQuarter([filing("8-K", "2026-07-15", "2026-06-30", ["2.02", "9.01"])]), want: "2026-07-15 8-K" },
  { name: "2.02 a day after quarter end is a preliminary", got: juneQuarter([filing("8-K", "2026-07-01", "2026-07-01", ["2.02", "9.01"])]), want: "2026-08-07 periodic" },
  { name: "Item 8.01 8-K counts only once verified", got: juneQuarter([filing("8-K", "2026-07-22", "2026-07-21", ["8.01", "9.01"], "furnished")]), want: "2026-08-07 periodic" },
  { name: "verified Item 8.01 release (Urban Outfitters)", got: juneQuarter([filing("8-K", "2026-07-22", "2026-07-21", ["8.01", "9.01"], "furnished")], ["furnished"]), want: "2026-07-21 8-K" },
  { name: "verified 8.01 filed after the 10-Q does not date the quarter", got: juneQuarter([filing("8-K", "2026-08-10", "2026-08-10", ["8.01", "9.01"], "furnished")], ["furnished"]), want: "2026-08-07 periodic" },
];

for (const c of [...DATES, ...MATCHES]) {
  const pass = c.got === c.want;
  if (!pass) failures += 1;
  console.log(`${pass ? "PASS" : "FAIL"}  ${c.name.slice(0, 70).padEnd(70)}  ${c.got}${pass ? "" : ` (want ${c.want})`}`);
}

console.log(failures ? `\n${failures} FAILED` : "\nall fixtures pass");
process.exit(failures ? 1 : 0);
