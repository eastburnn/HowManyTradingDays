-- Views built with `select *` capture the column list at creation time, so
-- rebuild them to pick up confidence and window_days.

create or replace view public.earnings_current
  with (security_invoker = true) as
  select *
    from public.earnings_events
   where superseded_by is null;

create or replace view public.earnings_next
  with (security_invoker = true) as
  select distinct on (e.cik) e.*
    from public.earnings_events e
   where e.superseded_by is null
     and e.status in ('estimated','confirmed')
     and e.event_date >= (now() at time zone 'America/New_York')::date
   order by e.cik, e.event_date asc, e.id desc;

grant select on public.earnings_current, public.earnings_next to service_role;
