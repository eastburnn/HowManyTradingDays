-- Store the estimator's confidence tier and display window on each event so
-- pages render exactly what the estimator decided (including downgrades for
-- pooled history or overdue estimates), instead of re-deriving it from SD.

alter table public.earnings_events
  add column confidence  text check (confidence in ('high','medium','low')),
  add column window_days smallint;

-- The append-only guard must also protect the new columns.
create or replace function public.earnings_events_guard_update()
returns trigger
language plpgsql
as $$
begin
  if new.id <> old.id
     or new.cik <> old.cik
     or new.ticker <> old.ticker
     or new.fiscal_year <> old.fiscal_year
     or new.fiscal_quarter <> old.fiscal_quarter
     or new.period_end <> old.period_end
     or new.report_form is distinct from old.report_form
     or new.event_date <> old.event_date
     or new.time_of_day <> old.time_of_day
     or new.status <> old.status
     or new.method is distinct from old.method
     or new.history_count is distinct from old.history_count
     or new.sd_days is distinct from old.sd_days
     or new.clamped_to_deadline <> old.clamped_to_deadline
     or new.confidence is distinct from old.confidence
     or new.window_days is distinct from old.window_days
     or new.source_type <> old.source_type
     or new.source_url is distinct from old.source_url
     or new.source_accession is distinct from old.source_accession
     or new.first_seen_at <> old.first_seen_at
     or new.created_at <> old.created_at
  then
    raise exception 'earnings_events is append-only; insert a replacement row and set superseded_by';
  end if;
  if old.superseded_by is not null and new.superseded_by is distinct from old.superseded_by then
    raise exception 'earnings_events row % is already superseded', old.id;
  end if;
  return new;
end;
$$;

-- Replace the write function with one that takes confidence + window.
-- A change in confidence alone (same date/time/status) also produces a new
-- row, so a downgrade from high to low is visible in the audit trail.
drop function public.record_earnings_event(
  integer, text, smallint, smallint, date, text, date, text, text, text,
  text, smallint, numeric, boolean, text, text
);

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
  p_window_days         smallint default null
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

  -- status strength: reported > confirmed > estimated
  v_rank := case p_status when 'reported' then 3 when 'confirmed' then 2 else 1 end;

  if v_found then
    v_cur_rank := case v_current.status when 'reported' then 3 when 'confirmed' then 2 else 1 end;

    -- Never let an estimate overwrite a confirmed or reported fact.
    if v_rank < v_cur_rank then
      return v_current.id;
    end if;

    -- Same fact re-observed: refresh the verification timestamp only.
    if v_current.event_date = p_event_date
       and v_current.time_of_day = p_time_of_day
       and v_current.status = p_status
       and v_current.period_end = p_period_end
       and v_current.confidence is not distinct from p_confidence
    then
      update public.earnings_events
         set last_verified_at = now()
       where id = v_current.id;
      return v_current.id;
    end if;
  end if;

  insert into public.earnings_events (
    cik, ticker, fiscal_year, fiscal_quarter, period_end, report_form,
    event_date, time_of_day, status, method, history_count, sd_days,
    clamped_to_deadline, confidence, window_days, source_type, source_url, source_accession
  ) values (
    p_cik, p_ticker, p_fiscal_year, p_fiscal_quarter, p_period_end, p_report_form,
    p_event_date, p_time_of_day, p_status, p_method, p_history_count, p_sd_days,
    p_clamped_to_deadline, p_confidence, p_window_days, p_source_type, p_source_url, p_source_accession
  )
  returning id into v_new_id;

  if v_found then
    update public.earnings_events
       set superseded_by = v_new_id,
           superseded_at = now()
     where id = v_current.id;
  end if;

  return v_new_id;
end;
$$;

grant execute on function public.record_earnings_event(
  integer, text, smallint, smallint, date, text, date, text, text, text,
  text, smallint, numeric, boolean, text, text, text, smallint
) to service_role;
