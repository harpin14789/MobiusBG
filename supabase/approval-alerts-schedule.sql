-- Apply after deploying the worker and configuring its secrets. Vault values
-- mobius_alerts_url and mobius_alerts_secret are provisioned privately.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

create or replace function mobius_private.dispatch_approval_alerts()
returns bigint language plpgsql security definer set search_path = '' as $$
declare endpoint text; secret text; request_id bigint;
begin
  select decrypted_secret into endpoint from vault.decrypted_secrets
    where name = 'mobius_alerts_url';
  select decrypted_secret into secret from vault.decrypted_secrets
    where name = 'mobius_alerts_secret';
  if endpoint is null or secret is null then return null; end if;
  select net.http_post(
    url := endpoint,
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Mobius-Alert-Secret', secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) into request_id;
  return request_id;
end;
$$;
revoke all on function mobius_private.dispatch_approval_alerts()
  from public, anon, authenticated, service_role;

do $$
begin
  if exists(select 1 from cron.job where jobname = 'mobius-approval-alerts') then
    perform cron.unschedule('mobius-approval-alerts');
  end if;
end;
$$;
select cron.schedule('mobius-approval-alerts', '*/2 * * * *',
  'select mobius_private.dispatch_approval_alerts();');
