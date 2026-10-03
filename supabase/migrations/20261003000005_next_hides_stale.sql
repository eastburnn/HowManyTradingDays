-- The "next event" view hides stale overdue estimates: a quarter a month past
-- its SEC deadline with no filing is a delinquent filer's, and the company's
-- next date is the following quarter's.

create or replace view public.earnings_next
  with (security_invoker = true) as
  select distinct on (e.cik) e.*
    from public.earnings_events e
   where e.superseded_by is null
     and e.status in ('estimated','confirmed')
     and e.event_date >= (now() at time zone 'America/New_York')::date
     and not (e.status = 'estimated' and e.overdue and public.estimate_is_stale(e.period_end, e.report_form))
   order by e.cik, e.event_date asc, e.id desc;

grant select on public.earnings_next to service_role;
