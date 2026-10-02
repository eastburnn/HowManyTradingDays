-- Earnings countdown: core schema.
--
-- Principles
--   * earnings_events is append-only. Rows are never updated in place; a
--     replacement row is inserted and the old row's superseded_by points at
--     it. Enforced by trigger, not convention.
--   * The site and the job runner talk to the database with the service
--     role. RLS is enabled everywhere with no policies, so the anon and
--     authenticated roles can read nothing until a later migration says so.
--   * No price, EPS, or market data — facts only: who, which quarter, when,
--     what time of day, how sure, and where it came from.

-- ---------------------------------------------------------------------------
-- companies: the earnings universe (domestic quarterly reporters)
-- ---------------------------------------------------------------------------
create table public.companies (
  cik                  integer primary key,
  ticker               text not null,                 -- primary listing symbol, uppercase
  tickers              text[] not null default '{}',  -- all symbols EDGAR lists for the CIK
  name                 text not null,
  exchange             text,                          -- NYSE | Nasdaq | ...
  sic                  text,
  sic_description      text,
  filer_category       text not null default 'unknown'
                         check (filer_category in ('large-accelerated','accelerated','non-accelerated','unknown')),
  fiscal_year_end      text,                          -- MMDD as EDGAR reports it
  is_52_53_week        boolean not null default false,
  active               boolean not null default true, -- still a quarterly reporter
  refresh_requested_at timestamptz,                   -- set when the daily index sees a new filing
  last_refreshed_at    timestamptz,                   -- last full submissions pull
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create unique index companies_ticker_idx on public.companies (upper(ticker));
create index companies_refresh_idx on public.companies (refresh_requested_at nulls last, last_refreshed_at nulls first)
  where active;

-- ---------------------------------------------------------------------------
-- filings: the raw EDGAR history the estimator trains on
-- ---------------------------------------------------------------------------
create table public.filings (
  accession      text primary key,
  cik            integer not null references public.companies (cik) on delete cascade,
  form           text not null,                        -- 8-K, 10-Q, 10-K, NT 10-Q, NT 10-K, ...
  items          text[] not null default '{}',         -- 8-K item codes, e.g. {2.02,9.01}
  filing_date    date not null,
  report_date    date,                                 -- period of report, or 8-K event date
  acceptance_at  timestamptz,
  created_at     timestamptz not null default now()
);

create index filings_cik_date_idx on public.filings (cik, filing_date desc);
create index filings_form_date_idx on public.filings (form, filing_date desc);

-- ---------------------------------------------------------------------------
-- earnings_events: append-only; everything the site shows reads from here
-- ---------------------------------------------------------------------------
create table public.earnings_events (
  id                  bigint generated always as identity primary key,
  cik                 integer not null references public.companies (cik) on delete cascade,
  ticker              text not null,
  fiscal_year         smallint not null,
  fiscal_quarter      smallint not null check (fiscal_quarter between 1 and 4),
  period_end          date not null,
  report_form         text check (report_form in ('10-Q','10-K')),
  event_date          date not null,
  time_of_day         text not null default 'unknown'
                        check (time_of_day in ('premarket','postmarket','during-market','unknown')),
  status              text not null check (status in ('estimated','confirmed','reported')),
  -- estimator provenance (null for confirmed/reported rows)
  method              text,
  history_count       smallint,
  sd_days             numeric(5,1),
  clamped_to_deadline boolean not null default false,
  -- source provenance (always keep the link)
  source_type         text not null
                        check (source_type in ('estimator','edgar-8k','edgar-nt','wire-rss','edgar-fts','manual')),
  source_url          text,
  source_accession    text,
  first_seen_at       timestamptz not null default now(),
  last_verified_at    timestamptz not null default now(),
  superseded_by       bigint references public.earnings_events (id),
  superseded_at       timestamptz,
  created_at          timestamptz not null default now()
);

create index earnings_events_company_period_idx
  on public.earnings_events (cik, fiscal_year, fiscal_quarter);
create index earnings_events_current_ticker_idx
  on public.earnings_events (upper(ticker)) where superseded_by is null;
create index earnings_events_current_date_idx
  on public.earnings_events (event_date) where superseded_by is null;

-- Append-only guard: the only columns that may change on an existing row are
-- the supersession pointer and the verification timestamp.
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

create trigger earnings_events_append_only
  before update on public.earnings_events
  for each row execute function public.earnings_events_guard_update();

create or replace function public.earnings_events_no_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'earnings_events is append-only; rows cannot be deleted';
end;
$$;

create trigger earnings_events_no_delete
  before delete on public.earnings_events
  for each row execute function public.earnings_events_no_delete();

-- ---------------------------------------------------------------------------
-- record_earnings_event: the single write path.
--
-- Atomically compares the incoming fact against the current (non-superseded)
-- row for the same company and fiscal quarter:
--   * identical date/time/status → just bump last_verified_at, return its id
--   * a weaker status than what we have (estimated vs confirmed) → no-op
--   * otherwise → insert the new row and mark the old one superseded
-- Returns the id of the row that is now current.
-- ---------------------------------------------------------------------------
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
  p_source_accession    text default null
)
returns bigint
language plpgsql
as $$
declare
  v_current public.earnings_events%rowtype;
  v_new_id  bigint;
  v_rank    int;
  v_cur_rank int;
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

  -- status strength: reported > confirmed > estimated
  v_rank := case p_status when 'reported' then 3 when 'confirmed' then 2 else 1 end;

  if found then
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
    clamped_to_deadline, source_type, source_url, source_accession
  ) values (
    p_cik, p_ticker, p_fiscal_year, p_fiscal_quarter, p_period_end, p_report_form,
    p_event_date, p_time_of_day, p_status, p_method, p_history_count, p_sd_days,
    p_clamped_to_deadline, p_source_type, p_source_url, p_source_accession
  )
  returning id into v_new_id;

  if found and v_current.id is not null then
    update public.earnings_events
       set superseded_by = v_new_id,
           superseded_at = now()
     where id = v_current.id;
  end if;

  return v_new_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------

-- Current state: one row per company per fiscal quarter.
create view public.earnings_current
  with (security_invoker = true) as
  select *
    from public.earnings_events
   where superseded_by is null;

-- Next event per company: the earliest current estimated/confirmed event on
-- or after today (ET). Reported events drop out automatically.
create view public.earnings_next
  with (security_invoker = true) as
  select distinct on (e.cik) e.*
    from public.earnings_events e
   where e.superseded_by is null
     and e.status in ('estimated','confirmed')
     and e.event_date >= (now() at time zone 'America/New_York')::date
   order by e.cik, e.event_date asc, e.id desc;

-- ---------------------------------------------------------------------------
-- feed_items: raw wire/RSS staging for the confirmed-date layer
-- ---------------------------------------------------------------------------
create table public.feed_items (
  id            bigint generated always as identity primary key,
  feed          text not null,
  guid          text not null,
  title         text not null,
  link          text,
  published_at  timestamptz,
  fetched_at    timestamptz not null default now(),
  parse_status  text not null default 'pending'
                  check (parse_status in ('pending','matched','ignored','failed')),
  parsed        jsonb,
  unique (feed, guid)
);

create index feed_items_pending_idx on public.feed_items (fetched_at) where parse_status = 'pending';

-- ---------------------------------------------------------------------------
-- job_runs: heartbeat and stats for every scheduled run
-- ---------------------------------------------------------------------------
create table public.job_runs (
  id           bigint generated always as identity primary key,
  job          text not null,              -- tick | backfill | daily-index | rss | ...
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  status       text not null default 'running' check (status in ('running','ok','error')),
  stats        jsonb not null default '{}'::jsonb,
  error        text
);

create index job_runs_job_started_idx on public.job_runs (job, started_at desc);

-- ---------------------------------------------------------------------------
-- pipeline_state: small key/value store for cursors (e.g. last daily index)
-- ---------------------------------------------------------------------------
create table public.pipeline_state (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger companies_set_updated_at
  before update on public.companies
  for each row execute function public.set_updated_at();

create trigger pipeline_state_set_updated_at
  before update on public.pipeline_state
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Security: RLS on, no policies. Service role bypasses; anon reads nothing.
-- ---------------------------------------------------------------------------
alter table public.companies       enable row level security;
alter table public.filings         enable row level security;
alter table public.earnings_events enable row level security;
alter table public.feed_items      enable row level security;
alter table public.job_runs        enable row level security;
alter table public.pipeline_state  enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
