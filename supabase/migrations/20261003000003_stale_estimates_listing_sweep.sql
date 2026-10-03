-- Stale estimates and the listing sweep.
--
-- estimate_is_stale(): an estimate whose quarter ended more than a month past
-- the longest SEC deadline (45 days for a 10-Q, 90 for a 10-K) without a
-- filing belongs to a delinquent filer. The pipeline stops rolling such
-- estimates forward and the watchdog/health checks ignore them; the quarter
-- shows up again only when its filing arrives. Mirrors isStaleEstimate() in
-- lib/earnings/ingest.ts.
--
-- companies.listing_missing_since: set by the daily listing sweep when a
-- company's CIK is absent from the SEC exchange list; two consecutive misses
-- deactivate the company, a reappearance reactivates it.

create or replace function public.estimate_is_stale(p_period_end date, p_report_form text)
returns boolean
language sql
immutable
as $$
  select (now() at time zone 'America/New_York')::date
         > p_period_end + case when p_report_form = '10-K' then 120 else 75 end;
$$;

grant execute on function public.estimate_is_stale(date, text) to service_role;

alter table public.companies add column listing_missing_since timestamptz;
