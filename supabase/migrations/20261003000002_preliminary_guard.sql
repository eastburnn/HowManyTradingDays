-- Two fixes from the first live weeks of the confirmed-date layer.
--
-- 1. A new source for reported events: companies that publish results with
--    the 10-Q/10-K itself (no earnings 8-K) have the report's filing date
--    recorded as the release, tagged 'edgar-periodic'.
--
-- 2. Preliminary 8-Ks. An Item 2.02 filed days after quarter end (a delivery
--    report, a revenue pre-announcement) must not displace a date the company
--    has confirmed for that quarter. record_earnings_event() now keeps a
--    confirmed FUTURE date when a 'reported' observation arrives dated before
--    it; once the confirmed date has passed, a report may replace it as usual.

alter table public.earnings_events drop constraint earnings_events_source_type_check;
alter table public.earnings_events add constraint earnings_events_source_type_check
  check (source_type in ('estimator','edgar-8k','edgar-periodic','edgar-nt','wire-rss','edgar-fts','manual'));

create or replace function public.record_earnings_event(
  p_cik                 integer,
  p_ticker              text,
  p_fiscal_year         smallint,
  p_fiscal_quarter      smallint,
  p_period_end          date,
  p_report_form         text,
  p_event_date          date,
  p_time_of_day         text,
  p_status              text,
  p_source_type         text,
  p_method              text default null,
  p_history_count       smallint default null,
  p_sd_days             numeric default null,
  p_clamped_to_deadline boolean default false,
  p_source_url          text default null,
  p_source_accession    text default null,
  p_confidence          text default null,
  p_window_days         smallint default null,
  p_overdue             boolean default false,
  p_original_estimate   date default null
)
returns bigint
language plpgsql
as $$
declare
  v_current  public.earnings_events%rowtype;
  v_new_id   bigint;
  v_rank     int;
  v_cur_rank int;
  v_found    boolean;
begin
  select * into v_current
    from public.earnings_events
   where cik = p_cik
     and fiscal_year = p_fiscal_year
     and fiscal_quarter = p_fiscal_quarter
     and superseded_by is null
   order by id desc
   limit 1
   for update;
  v_found := found;

  v_rank := case p_status when 'reported' then 3 when 'confirmed' then 2 else 1 end;

  if v_found then
    v_cur_rank := case v_current.status when 'reported' then 3 when 'confirmed' then 2 else 1 end;
    if v_rank < v_cur_rank then
      return v_current.id;
    end if;

    -- A report dated before a company-confirmed date that is still ahead of
    -- us is a preliminary announcement, not the results: keep the confirmation.
    if p_status = 'reported'
       and v_current.status = 'confirmed'
       and p_event_date < v_current.event_date
       and v_current.event_date >= (now() at time zone 'America/New_York')::date
    then
      return v_current.id;
    end if;

    if v_current.event_date = p_event_date
       and v_current.time_of_day = p_time_of_day
       and v_current.status = p_status
       and v_current.period_end = p_period_end
       and v_current.confidence is not distinct from p_confidence
       and v_current.overdue = p_overdue
    then
      update public.earnings_events set last_verified_at = now() where id = v_current.id;
      return v_current.id;
    end if;
  end if;

  insert into public.earnings_events (
    cik, ticker, fiscal_year, fiscal_quarter, period_end, report_form,
    event_date, time_of_day, status, method, history_count, sd_days,
    clamped_to_deadline, confidence, window_days, overdue, original_estimate,
    source_type, source_url, source_accession
  ) values (
    p_cik, p_ticker, p_fiscal_year, p_fiscal_quarter, p_period_end, p_report_form,
    p_event_date, p_time_of_day, p_status, p_method, p_history_count, p_sd_days,
    p_clamped_to_deadline, p_confidence, p_window_days, p_overdue, p_original_estimate,
    p_source_type, p_source_url, p_source_accession
  )
  returning id into v_new_id;

  if v_found then
    update public.earnings_events
       set superseded_by = v_new_id, superseded_at = now()
     where id = v_current.id;
  end if;

  return v_new_id;
end;
$$;
