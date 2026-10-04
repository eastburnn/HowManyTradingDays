-- Confirmed dates can now arrive by email: investor-relations alert emails
-- forwarded to the site as webhooks (feed 'ir-email').
alter table public.earnings_events drop constraint earnings_events_source_type_check;
alter table public.earnings_events add constraint earnings_events_source_type_check
  check (source_type in ('estimator','edgar-8k','edgar-periodic','edgar-nt','wire-rss','edgar-fts','ir-site','ir-email','manual'));
