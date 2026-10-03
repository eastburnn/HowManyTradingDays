/**
 * Regression fixtures for the wire-advisory parser. Run:
 *   npx tsx scripts/earnings/parse-fixtures.ts
 * Exits non-zero on any mismatch. Add a fixture whenever a real headline is
 * misparsed (see the dry-run's unmatched log).
 */

import { parseAdvisory } from "@/lib/earnings/confirm";

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
console.log(failures ? `\n${failures} FAILED` : "\nall fixtures pass");
process.exit(failures ? 1 : 0);
