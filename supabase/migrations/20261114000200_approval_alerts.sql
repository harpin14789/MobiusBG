begin;

create schema if not exists mobius_private;
revoke all on schema mobius_private from public, anon, authenticated;
grant usage on schema mobius_private to service_role;

create table mobius_private.approval_alerts (
  member_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'sent', 'skipped', 'failed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_token uuid,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
alter table mobius_private.approval_alerts enable row level security;
revoke all on mobius_private.approval_alerts from public, anon, authenticated;
grant all on mobius_private.approval_alerts to service_role;

create function mobius_private.queue_approval_alert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email_confirmed_at is null then return new; end if;
  if tg_op = 'UPDATE' and old.email_confirmed_at is not null then return new; end if;
  if exists(select 1 from public.profiles where id = new.id and not active
      and role in ('member', 'admin')) then
    insert into mobius_private.approval_alerts(member_id) values(new.id)
      on conflict (member_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function mobius_private.queue_approval_alert() from public, anon, authenticated;

-- Alphabetical order makes this run after mobius_new_member on INSERT.
create trigger zz_mobius_approval_alert
after insert or update of email_confirmed_at on auth.users
for each row execute function mobius_private.queue_approval_alert();

create function public.claim_approval_alerts()
returns table(member_id uuid, email text, lease_token uuid)
language plpgsql security definer set search_path = '' as $$
begin
  -- Approvals made before delivery cancel an unnecessary notification.
  update mobius_private.approval_alerts q set status = 'skipped', lease_token = null
  from public.profiles p where p.id = q.member_id
    and (p.active or p.role = 'super_admin')
    and q.status in ('queued', 'sending') and q.available_at <= now();

  update mobius_private.approval_alerts set status = 'failed', lease_token = null,
    last_error = 'attempt_limit'
  where status in ('queued', 'sending') and attempts >= 5 and available_at <= now();

  return query
  with candidates as (
    select q.member_id from mobius_private.approval_alerts q
    join public.profiles p on p.id = q.member_id
    join auth.users u on u.id = q.member_id
    where q.status in ('queued', 'sending') and q.available_at <= now()
      and q.attempts < 5 and not p.active and p.role in ('member', 'admin')
      and u.email_confirmed_at is not null
    order by q.created_at limit 5 for update of q skip locked
  ), claimed as (
    update mobius_private.approval_alerts q
      set status = 'sending', attempts = attempts + 1,
        lease_token = gen_random_uuid(), available_at = now() + interval '10 minutes'
    from candidates c where q.member_id = c.member_id
    returning q.member_id, q.lease_token
  )
  select c.member_id, u.email::text, c.lease_token
    from claimed c join auth.users u on u.id = c.member_id;
end;
$$;

create function public.complete_approval_alert(p_member_id uuid, p_lease_token uuid,
  p_sent boolean, p_error text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update mobius_private.approval_alerts
  set status = case when p_sent then 'sent' when attempts >= 5 then 'failed' else 'queued' end,
    sent_at = case when p_sent then now() else null end,
    available_at = now() + interval '2 minutes' * power(2, least(attempts, 5)),
    lease_token = null,
    last_error = case when p_sent then null else left(coalesce(p_error, 'smtp_error'), 80) end
  where member_id = p_member_id and status = 'sending' and lease_token = p_lease_token;
  return found;
end;
$$;

revoke all on function public.claim_approval_alerts(),
  public.complete_approval_alert(uuid,uuid,boolean,text) from public, anon, authenticated;
grant execute on function public.claim_approval_alerts(),
  public.complete_approval_alert(uuid,uuid,boolean,text) to service_role;

commit;
