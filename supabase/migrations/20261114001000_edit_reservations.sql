begin;
alter table public.reservations drop constraint reservations_quantity_check;
alter table public.reservations add constraint reservations_quantity_check check (quantity between 0 and 100000);

create function public.set_reservation_quantity(p_id uuid,p_quantity integer)
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
    if d.base<>r.base or d.commission<>r.commission then raise exception 'The payout terms have changed. Make a new reservation for additional units at the current terms.'; end if;
    if p_quantity-r.quantity>d.capacity-d.reserved then raise exception 'Not enough capacity remains'; end if;
  end if;
  update public.reservations set quantity=p_quantity where id=r.id;
  update public.deals set reserved=reserved+(p_quantity-r.quantity) where id=d.id;
  insert into public.audit_events(actor_id,action,subject_id,details)
    values(auth.uid(),'reservation_changed',r.id,jsonb_build_object('previous',r.quantity,'quantity',p_quantity));
end; $$;
revoke all on function public.set_reservation_quantity(uuid,integer) from public,anon,authenticated;
grant execute on function public.set_reservation_quantity(uuid,integer) to authenticated;
notify pgrst,'reload schema';
commit;
