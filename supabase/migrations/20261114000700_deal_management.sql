begin;
alter table public.deals add column archived boolean not null default false;
alter table public.deals add column retailers jsonb not null default '[]'::jsonb;

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
  if d.archived then raise exception 'This deal is no longer available'; end if;
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



create function public.validate_deal_retailers(p_retailers jsonb) returns boolean
language sql immutable set search_path='' as $$
  select case when jsonb_typeof(p_retailers) <> 'array' then false
    when jsonb_array_length(p_retailers) not between 1 and 20 then false
    else not exists (select 1 from jsonb_array_elements(p_retailers) r
      where jsonb_typeof(r) <> 'object' or coalesce(char_length(trim(r->>'name')),0) not between 1 and 80
      or coalesce(r->>'url','') !~ '^https?://[^ /]+' or char_length(r->>'url') > 2000) end;
$$;
create function public.create_deal_with_retailers(p_id uuid,p_title text,p_category text,p_retailer text,p_url text,p_base integer,p_commission integer,p_capacity integer,p_deadline date,p_instructions text,p_label_min_quantity integer,p_retailers jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
begin
  if not public.validate_deal_retailers(p_retailers) then raise exception 'Enter valid retailer names and links'; end if;
  perform public.create_deal_with_labels(p_id,p_title,p_category,p_retailers->0->>'name',p_retailers->0->>'url',p_base,p_commission,p_capacity,p_deadline,p_instructions,p_label_min_quantity);
  update public.deals set retailers=p_retailers where id=p_id;
  return p_id;
end; $$;
create function public.update_deal(p_id uuid,p_title text,p_category text,p_base integer,p_commission integer,p_capacity integer,p_deadline date,p_instructions text,p_label_min_quantity integer,p_retailers jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare d public.deals;
begin
  if not public.can_post_deals() then raise exception 'Deal posting access required' using errcode='42501'; end if;
  select * into d from public.deals where id=p_id for update;
  if not found or d.archived then raise exception 'Deal not found'; end if;
  if p_capacity is null or p_capacity<d.reserved then raise exception 'Capacity cannot be lower than reserved units'; end if;
  if not public.validate_deal_retailers(p_retailers) then raise exception 'Enter valid retailer names and links'; end if;
  if p_label_min_quantity is distinct from d.label_min_quantity and exists(select 1 from public.label_requests lr join public.reservations r on r.id=lr.reservation_id where r.deal_id=p_id) then raise exception 'Label terms cannot change after a label request'; end if;
  update public.deals set title=trim(p_title),category=p_category,retailer=trim(p_retailers->0->>'name'),url=trim(p_retailers->0->>'url'),base=p_base,commission=p_commission,capacity=p_capacity,deadline=p_deadline,instructions=trim(p_instructions),label_min_quantity=p_label_min_quantity,retailers=p_retailers where id=p_id;
  insert into public.audit_events(actor_id,action,subject_id) values(auth.uid(),'deal_updated',p_id);
end; $$;
create function public.delete_deal(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.can_post_deals() then raise exception 'Deal posting access required' using errcode='42501'; end if;
  update public.deals set archived=true where id=p_id and not archived;
  if not found then raise exception 'Deal not found'; end if;
  insert into public.audit_events(actor_id,action,subject_id) values(auth.uid(),'deal_archived',p_id);
end; $$;
revoke all on function public.validate_deal_retailers(jsonb),public.create_deal_with_retailers(uuid,text,text,text,text,integer,integer,integer,date,text,integer,jsonb),public.update_deal(uuid,text,text,integer,integer,integer,date,text,integer,jsonb),public.delete_deal(uuid) from public,anon,authenticated;
grant execute on function public.create_deal_with_retailers(uuid,text,text,text,text,integer,integer,integer,date,text,integer,jsonb),public.update_deal(uuid,text,text,integer,integer,integer,date,text,integer,jsonb),public.delete_deal(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
