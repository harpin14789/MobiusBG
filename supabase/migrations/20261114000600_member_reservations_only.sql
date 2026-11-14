begin;

create or replace function public.reserve_deal(p_deal_id uuid, p_quantity integer, p_request_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare d public.deals; r public.reservations;
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
  if d.deadline < (now() at time zone 'America/Chicago')::date then raise exception 'This deal has closed'; end if;
  if p_quantity > d.capacity - d.reserved then raise exception 'Not enough capacity remains'; end if;
  insert into public.reservations(id, deal_id, member_id, quantity, base, commission)
  values(p_request_id, d.id, auth.uid(), p_quantity, d.base, d.commission);
  update public.deals set reserved = reserved + p_quantity where id = d.id;
  insert into public.audit_events(actor_id, action, subject_id, details)
  values(auth.uid(), 'reserved', p_request_id, jsonb_build_object('quantity', p_quantity, 'base', d.base, 'commission', d.commission));
  return p_request_id;
end;
$$;


notify pgrst,'reload schema';
commit;
