-- Scheduler: pg_cron calls the site's /api/jobs/tick endpoint every 15
-- minutes through pg_net. The endpoint URL and shared secret live in
-- Supabase Vault (inserted out of band, never in a migration):
--
--   select vault.create_secret('https://howmanytradingdays.com/api/jobs/tick', 'jobs_tick_url');
--   select vault.create_secret('<JOBS_SECRET>', 'jobs_secret');
--
-- The job is a no-op (with a notice) until both secrets exist, so this
-- migration is safe to apply before they do.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.invoke_earnings_tick()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url    text;
  v_secret text;
begin
  select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'jobs_tick_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'jobs_secret';
  if v_url is null or v_secret is null then
    raise notice 'invoke_earnings_tick: vault secrets jobs_tick_url / jobs_secret not set; skipping';
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

revoke all on function public.invoke_earnings_tick() from public, anon, authenticated;

-- Every 15 minutes. Unschedule first so re-applying is idempotent.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'earnings-tick') then
    perform cron.unschedule('earnings-tick');
  end if;
end;
$$;

select cron.schedule('earnings-tick', '*/15 * * * *', $$select public.invoke_earnings_tick()$$);

-- Keep cron's own history bounded (it grows a row per run).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'cron-history-cleanup') then
    perform cron.unschedule('cron-history-cleanup');
  end if;
end;
$$;

select cron.schedule(
  'cron-history-cleanup',
  '17 3 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '14 days'$$
);
