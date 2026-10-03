/**
 * Retract a wrong confirmed date for a company's upcoming quarter: the
 * confirmed row is superseded by a fresh copy of the estimate it replaced
 * (nothing is deleted — the audit trail keeps the mistake and the fix).
 *
 *   npx tsx --env-file=.env.local scripts/earnings/retract-confirmation.ts --tickers KLXE,LYFT --reason "not a trading day"
 */

import { closePool, withTransaction } from "@/lib/earnings/db";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const tickers = arg("tickers", "").split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
const reason = arg("reason", "manual retraction");
if (!tickers.length) {
  console.error("usage: --tickers A,B [--reason text]");
  process.exit(1);
}

(async () => {
  for (const ticker of tickers) {
    await withTransaction(async (client) => {
      const { rows } = await client.query(
        `select id, cik, fiscal_year, fiscal_quarter, event_date::text, source_url
           from earnings_events
          where upper(ticker) = $1 and status = 'confirmed' and superseded_by is null
            and event_date >= (now() at time zone 'America/New_York')::date
          order by event_date limit 1 for update`,
        [ticker]
      );
      const bad = rows[0];
      if (!bad) {
        console.log(`${ticker}: no current confirmed row`);
        return;
      }
      // The row this confirmation superseded is the last good estimate.
      const prior = (
        await client.query(`select * from earnings_events where superseded_by = $1 order by id desc limit 1`, [bad.id])
      ).rows[0];

      let newId: number;
      if (prior) {
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
        // Nothing to fall back to: leave the quarter unestimated; the next
        // refresh will re-estimate it.
        const ins = await client.query(
          `insert into earnings_events (cik, ticker, fiscal_year, fiscal_quarter, period_end, report_form, event_date,
                                        time_of_day, status, source_type, confidence, window_days, overdue)
           select cik, ticker, fiscal_year, fiscal_quarter, period_end, report_form, event_date, 'unknown', 'estimated',
                  'estimator', 'low', 14, false
             from earnings_events where id = $1 returning id`,
          [bad.id]
        );
        newId = ins.rows[0].id;
        await client.query(`update companies set refresh_requested_at = now() where cik = $1`, [bad.cik]);
      }
      await client.query(`update earnings_events set superseded_by = $2, superseded_at = now() where id = $1`, [bad.id, newId]);
      await client.query(
        `update feed_items set parse_status = 'failed', parsed = coalesce(parsed,'{}'::jsonb) || $2::jsonb
          where parse_status = 'matched' and link = $1`,
        [bad.source_url, JSON.stringify({ retracted: reason })]
      );
      console.log(`${ticker}: retracted confirmed ${bad.event_date} (row ${bad.id}) → now row ${newId} (${prior ? "restored prior estimate " + prior.event_date : "placeholder, refresh requested"})`);
    });
  }
  await closePool();
})().catch(async (e) => {
  console.error(e);
  await closePool();
  process.exit(1);
});
