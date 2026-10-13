-- A period that changes its fiscal label must not keep two rows.
--
-- record_earnings_event() keys the current row by (cik, fiscal_year,
-- fiscal_quarter). When the label for a period changes (the fiscal-year
-- naming rule for years ending in early January was corrected; EDGAR's
-- declared year end for Brown & Brown was found to be a slip), the next
-- refresh wrote the period under its new label and the old row survived:
-- Johnson & Johnson showed "fiscal 2026 Q3, confirmed" and "fiscal 2027 Q3,
-- estimated" for the same September quarter, both dated October 13.
--
-- Now the function also looks for current rows with the same cik and
-- period_end under another label. The best of them (a confirmation or a
-- report outranks an estimate) is carried over under the new label, and
-- every other-labeled row for the period is superseded by the row that ends
-- up current, so a period has one current row whatever it was once called.

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
  v_other    public.earnings_events%rowtype;
  v_result   bigint;
  v_new_id   bigint;
  v_carry_id bigint;
  v_rank     int;
  v_cur_rank int;
  v_oth_rank int;
  v_found    boolean;
  v_relabeled bigint[] := '{}';
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
  v_cur_rank := case when v_found then (case v_current.status when 'reported' then 3 when 'confirmed' then 2 else 1 end) else 0 end;

  -- The same period under another label (see the header). A row that
  -- outranks both the incoming event and the current row is carried over
  -- under the new label so a confirmation or a report survives relabeling.
  for v_other in
    select * from public.earnings_events
     where cik = p_cik
       and period_end = p_period_end
       and superseded_by is null
       and (fiscal_year, fiscal_quarter) is distinct from (p_fiscal_year, p_fiscal_quarter)
     order by id
     for update
  loop
    v_oth_rank := case v_other.status when 'reported' then 3 when 'confirmed' then 2 else 1 end;
    if v_oth_rank > greatest(v_rank, v_cur_rank) then
      insert into public.earnings_events (
        cik, ticker, fiscal_year, fiscal_quarter, period_end, report_form,
        event_date, time_of_day, status, method, history_count, sd_days,
        clamped_to_deadline, confidence, window_days, overdue, original_estimate,
        source_type, source_url, source_accession, first_seen_at
      )
      select cik, ticker, p_fiscal_year, p_fiscal_quarter, period_end, report_form,
             event_date, time_of_day, status, method, history_count, sd_days,
             clamped_to_deadline, confidence, window_days, overdue, original_estimate,
             source_type, source_url, source_accession, first_seen_at
        from public.earnings_events where id = v_other.id
      returning id into v_carry_id;
      if v_found then
        update public.earnings_events
           set superseded_by = v_carry_id, superseded_at = now()
         where id = v_current.id;
      end if;
      update public.earnings_events
         set superseded_by = v_carry_id, superseded_at = now()
       where id = v_other.id;
      select * into v_current from public.earnings_events where id = v_carry_id;
      v_found := true;
      v_cur_rank := v_oth_rank;
    else
      v_relabeled := v_relabeled || v_other.id;
    end if;
  end loop;

  v_result := null;

  if v_found then
    if v_rank < v_cur_rank then
      v_result := v_current.id;

    -- A report dated before a company-confirmed date that is still ahead of
    -- us is a preliminary announcement, not the results: keep the confirmation.
    elsif p_status = 'reported'
       and v_current.status = 'confirmed'
       and p_event_date < v_current.event_date
       and v_current.event_date >= (now() at time zone 'America/New_York')::date
    then
      v_result := v_current.id;

    elsif v_current.event_date = p_event_date
       and v_current.time_of_day = p_time_of_day
       and v_current.status = p_status
       and v_current.period_end = p_period_end
       and v_current.confidence is not distinct from p_confidence
       and v_current.overdue = p_overdue
       and v_current.history_count is not distinct from p_history_count
       and v_current.sd_days is not distinct from p_sd_days
       and v_current.window_days is not distinct from p_window_days
    then
      update public.earnings_events set last_verified_at = now() where id = v_current.id;
      v_result := v_current.id;
    end if;
  end if;

  if v_result is null then
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
    v_result := v_new_id;
  end if;

  if array_length(v_relabeled, 1) > 0 then
    update public.earnings_events
       set superseded_by = v_result, superseded_at = now()
     where id = any(v_relabeled) and superseded_by is null;
  end if;

  return v_result;
end;
$$;
