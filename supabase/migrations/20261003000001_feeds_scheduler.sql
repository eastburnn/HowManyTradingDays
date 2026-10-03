-- Second scheduled job: poll the press-wire feeds every 5 minutes via
-- /api/jobs/feeds. Reads the endpoint URL from Vault ('jobs_feeds_url') and
-- the shared secret from 'jobs_secret'; no-ops with a notice until both exist.

create or replace function public.invoke_earnings_feeds()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url    text;
  v_secret text;
begin
  select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'jobs_feeds_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'jobs_secret';
  if v_url is null or v_secret is null then
    raise notice 'invoke_earnings_feeds: vault secrets jobs_feeds_url / jobs_secret not set; skipping';
    return;
  end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object('content-type', 'application/json', 'x-jobs-secret', v_secret),
    body    := '{}'::jsonb,
    timeout_milliseconds := 15000
  );
end;
$$;

revoke all on function public.invoke_earnings_feeds() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'earnings-feeds') then
    perform cron.unschedule('earnings-feeds');
  end if;
end;
$$;

-- Offset from the 15-minute tick (which also polls) so the two never collide.
select cron.schedule('earnings-feeds', '2,7,12,17,22,27,32,37,42,47,52,57 * * * *', $$select public.invoke_earnings_feeds()$$);

-- feed_items grows quickly (global wire feeds); keep 30 days of non-matches.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'feed-items-cleanup') then
    perform cron.unschedule('feed-items-cleanup');
  end if;
end;
$$;

select cron.schedule(
  'feed-items-cleanup',
  '23 4 * * *',
  $$delete from feed_items where parse_status in ('ignored','failed') and fetched_at < now() - interval '30 days'$$
);
