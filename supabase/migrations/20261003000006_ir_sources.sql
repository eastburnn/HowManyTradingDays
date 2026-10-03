-- Investor-relations sites as a confirmed-date source.
--
-- ir_sources remembers, per company, the IR host and the feeds found on it
-- (Q4's events + press releases, Investis' /rss, or a generic RSS link),
-- when it was last read, and whether reads keep failing. Companies with no
-- usable feed are recorded as 'none' (or 'blocked' when the site refuses
-- non-browser clients) and re-checked after a month.

create table public.ir_sources (
  cik                  integer primary key references public.companies (cik) on delete cascade,
  host                 text,
  platform             text not null check (platform in ('q4','investis','rss','none','blocked')),
  events_url           text,
  releases_url         text,
  discovered_at        timestamptz not null default now(),
  last_polled_at       timestamptz,
  last_status          text,
  consecutive_failures integer not null default 0
);

create index ir_sources_poll_idx on public.ir_sources (last_polled_at nulls first)
  where platform in ('q4','investis','rss');

alter table public.ir_sources enable row level security;
grant select, insert, update, delete on public.ir_sources to service_role;

-- Confirmed events may now come from a company's own site.
alter table public.earnings_events drop constraint earnings_events_source_type_check;
alter table public.earnings_events add constraint earnings_events_source_type_check
  check (source_type in ('estimator','edgar-8k','edgar-periodic','edgar-nt','wire-rss','edgar-fts','ir-site','manual'));
