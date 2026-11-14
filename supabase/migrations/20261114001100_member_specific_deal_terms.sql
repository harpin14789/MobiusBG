begin;
create table public.deal_member_terms (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id),
  member_id uuid not null references public.profiles(id),
  base integer not null check(base between 1 and 100000000),
  commission integer not null check(commission between 0 and 100000000),
  updated_at timestamptz not null default now(),
  unique(deal_id,member_id)
);
alter table public.deal_member_terms enable row level security;
revoke all on public.deal_member_terms from anon,authenticated;
grant select on public.deal_member_terms to authenticated;
grant all on public.deal_member_terms to service_role;
create policy member_terms_read on public.deal_member_terms for select to authenticated
  using ((select public.is_member()) and (member_id=(select auth.uid()) or (select public.is_super_admin())));

alter table mobius_private.member_event_alerts drop constraint member_event_alerts_kind_check;
alter table mobius_private.member_event_alerts add constraint member_event_alerts_kind_check
  check(kind in ('deal_created','deal_updated','received','paid','custom_terms','reservation_updated'));

create function public.set_member_deal_terms(p_deal_id uuid,p_member_id uuid,p_base integer,p_commission integer)
returns void language plpgsql security definer set search_path='' as $$
declare d public.deals; old public.deal_member_terms; event_id bigint;
begin
  if not public.is_super_admin() then raise exception 'Super administrator access required' using errcode='42501'; end if;
  select * into d from public.deals where id=p_deal_id for update;
  if not found or d.archived then raise exception 'Deal not found'; end if;
  if not exists(select 1 from public.profiles where id=p_member_id and role='member') then raise exception 'Choose a member'; end if;
  if (p_base is null)<>(p_commission is null) or (p_base is not null and (p_base not between 1 and 100000000 or p_commission not between 0 and 100000000)) then raise exception 'Enter a valid base payout and commission'; end if;
  select * into old from public.deal_member_terms where deal_id=p_deal_id and member_id=p_member_id;
  if p_base is null then
    delete from public.deal_member_terms where deal_id=p_deal_id and member_id=p_member_id;
    if not found then return; end if;
  else
    if old.id is not null and old.base=p_base and old.commission=p_commission then return; end if;
    insert into public.deal_member_terms(deal_id,member_id,base,commission) values(p_deal_id,p_member_id,p_base,p_commission)
      on conflict(deal_id,member_id) do update set base=excluded.base,commission=excluded.commission,updated_at=now();
  end if;
  insert into public.audit_events(actor_id,action,subject_id,details)
    values(auth.uid(),'member_terms_changed',p_deal_id,jsonb_build_object('member_id',p_member_id,'base',p_base,'commission',p_commission)) returning id into event_id;
  insert into mobius_private.member_event_alerts(event_id,member_id,kind,deal_title)
    select event_id,p.id,'custom_terms',d.title from public.profiles p join auth.users u on u.id=p.id
    where p.id=p_member_id and p.active and u.email_confirmed_at is not null and u.email is not null and lower(u.email) not like '%@example.test';
end; $$;

create function public.super_admin_update_reservation(p_id uuid,p_quantity integer,p_base integer,p_commission integer)
returns void language plpgsql security definer set search_path='' as $$
declare r public.reservations; d public.deals; deal_id uuid; submitted_units bigint; label_units integer; minimum_units bigint; event_id bigint;
begin
  if not public.is_super_admin() then raise exception 'Super administrator access required' using errcode='42501'; end if;
  if p_quantity is null or p_quantity not between 0 and 100000 or p_base is null or p_base not between 1 and 100000000
    or p_commission is null or p_commission not between 0 and 100000000 then raise exception 'Enter valid quantity and payout terms'; end if;
  select res.deal_id into deal_id from public.reservations res where id=p_id;
  if not found then raise exception 'Reservation not found'; end if;
  select * into d from public.deals where id=deal_id for update;
  select * into r from public.reservations where id=p_id for update;
  if not found then raise exception 'Reservation not found'; end if;
  if r.quantity=p_quantity and r.base=p_base and r.commission=p_commission then return; end if;
  select coalesce(sum(quantity),0) into submitted_units from public.delivery_submissions where reservation_id=r.id;
  select quantity into label_units from public.label_requests where reservation_id=r.id;
  minimum_units:=greatest(submitted_units,r.received,coalesce(label_units,0));
  if r.submitted and submitted_units=0 then minimum_units:=greatest(minimum_units,r.quantity); end if;
  if p_quantity<minimum_units then raise exception 'Quantity cannot be below % units already submitted, received, or included in a label request',minimum_units; end if;
  if p_quantity>r.quantity and (d.archived or d.deadline < (now() at time zone 'America/Chicago')::date) then raise exception 'This deal is closed; units cannot be added'; end if;
  if p_quantity-r.quantity>d.capacity-d.reserved then raise exception 'Not enough capacity remains'; end if;
  if (r.base<>p_base or r.commission<>p_commission) and (r.received>0 or r.paid>0) then raise exception 'Payout terms cannot change after units have been received or paid'; end if;
  update public.reservations set quantity=p_quantity,base=p_base,commission=p_commission where id=r.id;
  update public.deals set reserved=reserved+(p_quantity-r.quantity) where id=d.id;
  insert into public.audit_events(actor_id,action,subject_id,details)
    values(auth.uid(),'reservation_admin_changed',r.id,jsonb_build_object('previous_quantity',r.quantity,'quantity',p_quantity,'previous_base',r.base,'base',p_base,'previous_commission',r.commission,'commission',p_commission)) returning id into event_id;
  insert into mobius_private.member_event_alerts(event_id,member_id,kind,deal_title,total_units)
    select event_id,p.id,'reservation_updated',d.title,p_quantity from public.profiles p join auth.users u on u.id=p.id
    where p.id=r.member_id and p.active and p.role='member' and u.email_confirmed_at is not null and u.email is not null and lower(u.email) not like '%@example.test';
end; $$;

revoke all on function public.set_member_deal_terms(uuid,uuid,integer,integer),public.super_admin_update_reservation(uuid,integer,integer,integer) from public,anon,authenticated;
grant execute on function public.set_member_deal_terms(uuid,uuid,integer,integer),public.super_admin_update_reservation(uuid,integer,integer,integer) to authenticated;

create or replace function public.reserve_deal(p_deal_id uuid, p_quantity integer, p_request_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare d public.deals; r public.reservations; effective_base integer; effective_commission integer;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and active and role='member') then raise exception 'Only active members can reserve units' using errcode = '42501'; end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 100000 or p_request_id is null then raise exception 'Invalid reservation'; end if;
  -- Serialize competing reservations for the same deal. The counter and reservation commit together.
  select * into d from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found'; end if;
  select * into r from public.reservations where id = p_request_id;
  if found then
    if r.member_id = auth.uid() and r.deal_id = p_deal_id and r.quantity = p_quantity then return r.id; end if;
    raise exception 'Reservation request already used';
  end if;
  select coalesce((select t.base from public.deal_member_terms t where t.deal_id=d.id and t.member_id=auth.uid()),d.base), coalesce((select t.commission from public.deal_member_terms t where t.deal_id=d.id and t.member_id=auth.uid()),d.commission) into effective_base,effective_commission;
  if d.archived then raise exception 'This deal is no longer available'; end if;
  if d.deadline < (now() at time zone 'America/Chicago')::date then raise exception 'This deal has closed'; end if;
  if p_quantity > d.capacity - d.reserved then raise exception 'Not enough capacity remains'; end if;
  insert into public.reservations(id, deal_id, member_id, quantity, base, commission)
  values(p_request_id, d.id, auth.uid(), p_quantity, effective_base, effective_commission);
  update public.deals set reserved = reserved + p_quantity where id = d.id;
  insert into public.audit_events(actor_id, action, subject_id, details)
  values(auth.uid(), 'reserved', p_request_id, jsonb_build_object('quantity', p_quantity, 'base', effective_base, 'commission', effective_commission));
  return p_request_id;
end;
$$;




create or replace function public.set_reservation_quantity(p_id uuid,p_quantity integer)
returns void language plpgsql security definer set search_path='' as $$
declare r public.reservations; d public.deals; deal_id uuid; submitted_units bigint; label_units integer; minimum_units bigint;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and active and role='member') then
    raise exception 'Only active members can change their reservations' using errcode='42501';
  end if;
  if p_quantity is null or p_quantity not between 0 and 100000 then raise exception 'Enter a whole-number quantity between 0 and 100000'; end if;
  select res.deal_id into deal_id from public.reservations res where res.id=p_id and res.member_id=auth.uid();
  if not found then raise exception 'Reservation not found' using errcode='42501'; end if;
  -- Lock in the same order as reserve_deal and update_deal to serialize capacity.
  select * into d from public.deals where id=deal_id for update;
  select * into r from public.reservations where id=p_id and member_id=auth.uid() for update;
  if not found then raise exception 'Reservation not found' using errcode='42501'; end if;
  if p_quantity=r.quantity then return; end if;
  select coalesce(sum(quantity),0) into submitted_units from public.delivery_submissions where reservation_id=r.id;
  select quantity into label_units from public.label_requests where reservation_id=r.id;
  minimum_units:=greatest(submitted_units,r.received,coalesce(label_units,0));
  -- Older delivery entries have no itemized quantities; retain their units.
  if r.submitted and submitted_units=0 then minimum_units:=greatest(minimum_units,r.quantity); end if;
  if p_quantity<minimum_units then raise exception 'Quantity cannot be below % units already submitted, received, or included in a label request',minimum_units; end if;
  if p_quantity>r.quantity then
    if d.archived or d.deadline < (now() at time zone 'America/Chicago')::date then raise exception 'This deal is closed; units cannot be added'; end if;
    if coalesce((select t.base from public.deal_member_terms t where t.deal_id=d.id and t.member_id=auth.uid()),d.base)<>r.base or coalesce((select t.commission from public.deal_member_terms t where t.deal_id=d.id and t.member_id=auth.uid()),d.commission)<>r.commission then raise exception 'The payout terms have changed. Make a new reservation for additional units at the current terms.'; end if;
    if p_quantity-r.quantity>d.capacity-d.reserved then raise exception 'Not enough capacity remains'; end if;
  end if;
  update public.reservations set quantity=p_quantity where id=r.id;
  update public.deals set reserved=reserved+(p_quantity-r.quantity) where id=d.id;
  insert into public.audit_events(actor_id,action,subject_id,details)
    values(auth.uid(),'reservation_changed',r.id,jsonb_build_object('previous',r.quantity,'quantity',p_quantity));
end; $$;

create function public.reserve_deal_at_terms(p_deal_id uuid,p_quantity integer,p_request_id uuid,p_expected_base integer,p_expected_commission integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare d public.deals; effective_base integer; effective_commission integer; existing uuid;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and active and role='member') then raise exception 'Only active members can reserve units' using errcode='42501'; end if;
  select * into d from public.deals where id=p_deal_id for update;
  if not found then raise exception 'Deal not found'; end if;
  select id into existing from public.reservations where id=p_request_id;
  if existing is not null then return public.reserve_deal(p_deal_id,p_quantity,p_request_id); end if;
  select coalesce((select t.base from public.deal_member_terms t where t.deal_id=d.id and t.member_id=auth.uid()),d.base),
    coalesce((select t.commission from public.deal_member_terms t where t.deal_id=d.id and t.member_id=auth.uid()),d.commission)
    into effective_base,effective_commission;
  if p_expected_base is distinct from effective_base or p_expected_commission is distinct from effective_commission then
    raise exception 'Payout terms changed. Close this form and review the updated deal before reserving.';
  end if;
  return public.reserve_deal(p_deal_id,p_quantity,p_request_id);
end; $$;
revoke all on function public.reserve_deal(uuid,integer,uuid) from public,anon,authenticated;
revoke all on function public.reserve_deal_at_terms(uuid,integer,uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.reserve_deal_at_terms(uuid,integer,uuid,integer,integer) to authenticated;

notify pgrst,'reload schema';
commit;
