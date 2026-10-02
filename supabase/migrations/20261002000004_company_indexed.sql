-- Staged indexation: ticker pages render for every active company, but only
-- companies with indexed = true appear in the sitemap and are allowed to be
-- indexed (others carry a noindex tag). The launch batch is set by hand;
-- later batches are flipped as the first ones prove they earn clicks.

alter table public.companies
  add column indexed boolean not null default false;

create index companies_indexed_idx on public.companies (ticker) where active and indexed;
