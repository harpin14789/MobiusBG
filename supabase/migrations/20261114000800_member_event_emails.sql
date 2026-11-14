begin;
create table mobius_private.member_event_alerts (
  id uuid primary key default gen_random_uuid(), event_id bigint not null references public.audit_events(id),
  member_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check(kind in ('deal_created','deal_updated','received','paid')),
  deal_title text not null, quantity_delta integer, total_units integer, amount_cents bigint,
  status text not null default 'queued' check(status in ('queued','sending','sent','skipped','failed')),
  attempts integer not null default 0, available_at timestamptz not null default now(),
  lease_token uuid, sent_at timestamptz, last_error text, created_at timestamptz not null default now(),
  unique(event_id,member_id)
);
alter table mobius_private.member_event_alerts enable row level security;
revoke all on mobius_private.member_event_alerts from public,anon,authenticated;
grant all on mobius_private.member_event_alerts to service_role;

create function mobius_private.queue_member_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare title text; target uuid;
begin
  if new.action not in ('deal_created','deal_updated','received','paid') then return new; end if;
  if new.action in ('deal_created','deal_updated') then
    select d.title into title from public.deals d where d.id=new.subject_id;
    insert into mobius_private.member_event_alerts(event_id,member_id,kind,deal_title)
      select new.id,p.id,new.action,title from public.profiles p join auth.users u on u.id=p.id
      where p.active and p.role='member' and u.email_confirmed_at is not null
        and u.email is not null and lower(u.email) not like '%@example.test';
  else
    select d.title,r.member_id into title,target from public.reservations r
      join public.deals d on d.id=r.deal_id where r.id=new.subject_id;
    insert into mobius_private.member_event_alerts(event_id,member_id,kind,deal_title,quantity_delta,total_units,amount_cents)
      select new.id,p.id,new.action,title,(new.details->>'total')::int-(new.details->>'previous')::int,
        (new.details->>'total')::int,(new.details->>'amount_cents')::bigint
      from public.profiles p join auth.users u on u.id=p.id
      where p.id=target and p.active and p.role='member' and u.email_confirmed_at is not null
        and u.email is not null and lower(u.email) not like '%@example.test';
  end if;
  return new;
end; $$;
revoke all on function mobius_private.queue_member_event() from public,anon,authenticated;
create trigger mobius_member_event_alert after insert on public.audit_events
  for each row execute function mobius_private.queue_member_event();

create function public.claim_member_event_alerts()
returns table(id uuid,member_id uuid,email text,kind text,deal_title text,quantity_delta integer,total_units integer,amount_cents bigint,lease_token uuid)
language plpgsql security definer set search_path='' as $$
begin
  update mobius_private.member_event_alerts q set status='skipped',lease_token=null
    from public.profiles p where p.id=q.member_id and (not p.active or p.role<>'member')
    and q.status in ('queued','sending') and q.available_at<=now();
  update mobius_private.member_event_alerts set status='failed',lease_token=null,last_error='attempt_limit'
    where status in ('queued','sending') and attempts>=5 and available_at<=now();
  return query with candidates as (
    select q.id from mobius_private.member_event_alerts q join public.profiles p on p.id=q.member_id
    join auth.users u on u.id=q.member_id where q.status in ('queued','sending') and q.available_at<=now()
      and q.attempts<5 and p.active and p.role='member' and u.email_confirmed_at is not null
      and u.email is not null and lower(u.email) not like '%@example.test'
    order by q.created_at limit 3 for update of q skip locked
  ), claimed as (
    update mobius_private.member_event_alerts q set status='sending',attempts=q.attempts+1,
      lease_token=gen_random_uuid(),available_at=now()+interval '10 minutes'
      from candidates c where q.id=c.id
      returning q.id,q.member_id,q.kind,q.deal_title,q.quantity_delta,q.total_units,q.amount_cents,q.lease_token
  ) select c.id,c.member_id,u.email::text,c.kind,c.deal_title,c.quantity_delta,c.total_units,c.amount_cents,c.lease_token
    from claimed c join auth.users u on u.id=c.member_id;
end; $$;
create function public.complete_member_event_alert(p_id uuid,p_lease_token uuid,p_sent boolean,p_error text default null)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  update mobius_private.member_event_alerts set status=case when p_sent then 'sent' when attempts>=5 then 'failed' else 'queued' end,
    sent_at=case when p_sent then now() else null end,available_at=now()+interval '2 minutes'*power(2,least(attempts,5)),
    lease_token=null,last_error=case when p_sent then null else left(coalesce(p_error,'smtp_error'),80) end
  where id=p_id and status='sending' and lease_token=p_lease_token;
  return found;
end; $$;
revoke all on function public.claim_member_event_alerts(),public.complete_member_event_alert(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.claim_member_event_alerts(),public.complete_member_event_alert(uuid,uuid,boolean,text) to service_role;
notify pgrst,'reload schema';
commit;
