/**
 * Revert "reported" rows that came from a preliminary 8-K filed within days
 * of quarter end, recorded before findUnmatchedRelease() had its
 * plausibility floor. Each is superseded by a fresh copy of the estimate it
 * replaced (or a placeholder when there was none) and the company is queued
 * for a refresh, which re-estimates the quarter under the new rules. Nothing
 * is deleted — the audit trail keeps the mistake and the fix.
 *
 *   npx tsx --env-file=.env.local scripts/earnings/revert-early-reports.ts [--max-days 5] [--dry 1]
 */

import { closePool, query, withTransaction } from "@/lib/earnings/db";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const MAX_DAYS = Number(arg("max-days", "5"));
const DRY = arg("dry", "") !== "";

type Bad = { id: number; cik: number; ticker: string; fiscal_year: number; fiscal_quarter: number; period_end: string; event_date: string };

(async () => {
  const bad = await query<Bad>(
    `select e.id, e.cik, e.ticker, e.fiscal_year, e.fiscal_quarter, e.period_end::text, e.event_date::text
       from earnings_current e
      where e.status = 'reported'
        and e.event_date - e.period_end < $1
        and not exists (select 1 from filings f
                         where f.cik = e.cik and f.form in ('10-Q','10-K','10-QT','10-KT')
                           and f.report_date = e.period_end)
      order by e.ticker`,
    [MAX_DAYS]
  );
  console.log(`${bad.length} reported rows within ${MAX_DAYS} days of quarter end with no periodic report on file${DRY ? " (dry run)" : ""}`);

  for (const b of bad) {
    if (DRY) {
      console.log(`  would revert ${b.ticker} FY${b.fiscal_year} Q${b.fiscal_quarter} reported ${b.event_date} (period end ${b.period_end})`);
      continue;
    }
    await withTransaction(async (client) => {
      await client.query(`select id from earnings_events where id = $1 and superseded_by is null for update`, [b.id]);
      const prior = (await client.query(`select * from earnings_events where superseded_by = $1 order by id desc limit 1`, [b.id])).rows[0];
      let newId: number;
      if (prior && prior.status === "estimated") {
        const ins = await client.query(
          `insert into earnings_events (cik, ticker, fiscal_year, fiscal_quarter, period_end, report_form, event_date,
                                        time_of_day, status, method, history_count, sd_days, clamped_to_deadline,
                                        confidence, window_days, overdue, original_estimate, source_type, source_url)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) returning id`,
          [prior.cik, prior.ticker, prior.fiscal_year, prior.fiscal_quarter, prior.period_end, prior.report_form, prior.event_date,
           prior.time_of_day, prior.status, prior.method, prior.history_count, prior.sd_days, prior.clamped_to_deadline,
           prior.confidence, prior.window_days, prior.overdue, prior.original_estimate, prior.source_type, prior.source_url]
        );
        newId = ins.rows[0].id;
      } else {
        // No estimate to restore: a low-confidence placeholder until the
        // requested refresh re-estimates the quarter.
        const ins = await client.query(
          `insert into earnings_events (cik, ticker, fiscal_year, fiscal_quarter, period_end, report_form, event_date,
                                        time_of_day, status, source_type, method, confidence, window_days, overdue)
           select cik, ticker, fiscal_year, fiscal_quarter, period_end, report_form, event_date, 'unknown', 'estimated',
                  'estimator', 'manual-revert', 'low', 14, false
             from earnings_events where id = $1 returning id`,
          [b.id]
        );
        newId = ins.rows[0].id;
      }
      await client.query(`update earnings_events set superseded_by = $2, superseded_at = now() where id = $1`, [b.id, newId]);
      await client.query(`update companies set refresh_requested_at = coalesce(refresh_requested_at, now()) where cik = $1`, [b.cik]);
      console.log(`  ${b.ticker} FY${b.fiscal_year} Q${b.fiscal_quarter}: reported ${b.event_date} (row ${b.id}) → row ${newId} ${prior?.status === "estimated" ? `restored estimate ${prior.event_date}` : "placeholder"}; refresh requested`);
    });
  }
  await closePool();
})().catch(async (e) => {
  console.error(e);
  await closePool();
  process.exit(1);
});
