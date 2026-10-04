/**
 * Fill in the time of day on upcoming dates (confirmed, estimated, or a
 * window) that show "unknown" or "during market hours", from the company's
 * own pattern: before the open or after the close, whichever its past
 * filings favour (three readable filings over the last three years minimum;
 * a filing accepted during market hours counts as before the open, see
 * predictTimeOfDay). Each fixed row is superseded by a copy with the time
 * set, so the audit trail keeps both.
 *
 *   npx tsx --env-file=.env.local scripts/earnings/backfill-time-of-day.ts            # dry run
 *   npx tsx --env-file=.env.local scripts/earnings/backfill-time-of-day.ts --apply
 */

import { closePool, query, withTransaction } from "@/lib/earnings/db";
import { predictTimeOfDay } from "@/lib/earnings/estimator";
import type { TimeOfDay } from "@/lib/earnings/fiscal";

const apply = process.argv.includes("--apply");
const MIN_REPORTS = 3;

type Row = {
  id: number;
  cik: number;
  ticker: string;
  status: string;
  event_date: string;
  time_of_day: TimeOfDay;
  slots: TimeOfDay[];
};

(async () => {
  const rows = await query<Row>(
    `select e.id, e.cik, e.ticker, e.status, e.event_date::text, e.time_of_day,
            coalesce((select array_agg(h.time_of_day) from earnings_current h
                       where h.cik = e.cik and h.status = 'reported' and h.time_of_day <> 'unknown'
                         and h.event_date >= current_date - interval '3 years'), '{}') as slots
       from earnings_current e
      where e.status in ('confirmed', 'estimated') and e.event_date >= current_date
        and e.time_of_day in ('unknown', 'during-market')
      order by e.event_date, e.ticker`
  );

  const fixes = rows
    .map((r) => ({ ...r, predicted: r.slots.length >= MIN_REPORTS ? predictTimeOfDay(r.slots.map((s) => [s, 1])) : "unknown" }))
    .filter((r) => r.predicted !== "unknown" && r.predicted !== r.time_of_day);

  const by = (status: string) => fixes.filter((f) => f.status === status).length;
  console.log(
    `${rows.length} upcoming dates with unknown or during-market time; ${fixes.length} to fill` +
      ` (${by("confirmed")} confirmed, ${by("estimated")} estimated)${apply ? "" : " (dry run)"}`
  );
  for (const f of fixes) {
    const n = f.slots.length;
    const agree = f.slots.filter((s) => (f.predicted === "premarket" ? s !== "postmarket" : s === "postmarket")).length;
    console.log(`${f.ticker.padEnd(6)} ${f.status.padEnd(9)} ${f.event_date}  ${f.time_of_day.padEnd(13)} → ${f.predicted.padEnd(10)} (${agree} of ${n})`);
    if (!apply) continue;
    await withTransaction(async (client) => {
      const ins = await client.query<{ id: number }>(
        `insert into earnings_events (cik, ticker, fiscal_year, fiscal_quarter, period_end, report_form, event_date,
                                      time_of_day, status, method, history_count, sd_days, clamped_to_deadline,
                                      confidence, window_days, overdue, original_estimate, source_type, source_url)
         select cik, ticker, fiscal_year, fiscal_quarter, period_end, report_form, event_date,
                $2, status, method, history_count, sd_days, clamped_to_deadline,
                confidence, window_days, overdue, original_estimate, source_type, source_url
           from earnings_events where id = $1 and superseded_by is null
         returning id`,
        [f.id, f.predicted]
      );
      if (!ins.rows[0]) return;
      await client.query(`update earnings_events set superseded_by = $2, superseded_at = now() where id = $1`, [f.id, ins.rows[0].id]);
    });
  }
  await closePool();
})().catch(async (e) => {
  console.error(e);
  await closePool();
  process.exit(1);
});
