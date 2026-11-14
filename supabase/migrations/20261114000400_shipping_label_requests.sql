begin;
alter table public.deals add column label_min_quantity integer
  check (label_min_quantity between 1 and capacity);

create function public.create_deal_with_labels(p_id uuid, p_title text, p_category text,
  p_retailer text, p_url text, p_base integer, p_commission integer, p_capacity integer,
  p_deadline date, p_instructions text, p_label_min_quantity integer default null)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  perform public.create_deal(p_id,p_title,p_category,p_retailer,p_url,p_base,p_commission,p_capacity,p_deadline,p_instructions);
  update public.deals set label_min_quantity = p_label_min_quantity where id = p_id;
  return p_id;
end;
$$;
revoke all on function public.create_deal_with_labels(uuid,text,text,text,text,integer,integer,integer,date,text,integer) from public, anon, authenticated;
grant execute on function public.create_deal_with_labels(uuid,text,text,text,text,integer,integer,integer,date,text,integer) to authenticated;

create table public.label_requests (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null unique references public.reservations(id),
  member_id uuid not null references public.profiles(id),
  email text not null,
  contact text not null check (char_length(trim(contact)) between 1 and 120),
  origin_zip text not null check (origin_zip ~ '^[0-9]{5}(-[0-9]{4})?$'),
  box_quantities integer[] not null,
  box_weights numeric[] not null,
  quantity integer not null check (quantity > 0),
  status text not null default 'requested' check (status in ('requested', 'in_progress', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index label_requests_member_idx on public.label_requests(member_id);
alter table public.label_requests enable row level security;
revoke all on public.label_requests from anon, authenticated;
grant select on public.label_requests to authenticated;
grant all on public.label_requests to service_role;
create policy label_requests_read on public.label_requests for select to authenticated
  using ((select public.is_member()) and (member_id = (select auth.uid()) or (select public.is_super_admin())));

create function public.save_label_request(p_reservation_id uuid, p_contact text, p_origin_zip text,
  p_box_quantities integer[], p_box_weights numeric[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.reservations; d public.deals; item_count integer; total_units bigint;
  result uuid; previous_status text; owner_email text;
begin
  if not public.is_member() then raise exception 'Member access required' using errcode = '42501'; end if;
  select * into r from public.reservations where id=p_reservation_id for update;
  if not found or (r.member_id<>auth.uid() and not public.is_super_admin()) then
    raise exception 'Reservation not found' using errcode='42501';
  end if;
  select * into d from public.deals where id=r.deal_id;
  if d.label_min_quantity is null then raise exception 'This deal does not offer prepaid shipping labels'; end if;
  item_count := cardinality(p_box_quantities);
  if p_contact is null or char_length(trim(p_contact)) not between 1 and 120
    or p_origin_zip is null or p_origin_zip !~ '^[0-9]{5}(-[0-9]{4})?$'
    or item_count is null or item_count not between 1 and 100
    or array_ndims(p_box_quantities)<>1 or array_ndims(p_box_weights)<>1
    or cardinality(p_box_weights) is distinct from item_count
    or exists(select 1 from unnest(p_box_quantities) q where q is null or q<1 or q>100000)
    or exists(select 1 from unnest(p_box_weights) w where w is null or w<=0 or w>10000 or w::text in ('NaN','Infinity','-Infinity')) then
    raise exception 'Enter contact, a ZIP code, and matching positive quantities and weights for each box';
  end if;
  select sum(q) into total_units from unnest(p_box_quantities) q;
  if total_units<d.label_min_quantity or total_units>r.quantity then
    raise exception 'Request must meet the deal label minimum and cannot exceed reserved units';
  end if;
  select status into previous_status from public.label_requests where reservation_id=r.id for update;
  if previous_status is not null and previous_status<>'requested' then
    raise exception 'This request is being handled. Contact the super admin to change it.';
  end if;
  select email into owner_email from auth.users where id=r.member_id;
  insert into public.label_requests(reservation_id,member_id,email,contact,origin_zip,box_quantities,box_weights,quantity)
    values(r.id,r.member_id,owner_email,trim(p_contact),p_origin_zip,p_box_quantities,p_box_weights,total_units)
    on conflict (reservation_id) do update set contact=excluded.contact,origin_zip=excluded.origin_zip,
      box_quantities=excluded.box_quantities,box_weights=excluded.box_weights,quantity=excluded.quantity,updated_at=now()
    returning id into result;
  insert into public.audit_events(actor_id,action,subject_id,details)
    values(auth.uid(),'label_requested',r.id,jsonb_build_object('label_request_id',result,'quantity',total_units));
  return result;
end;
$$;

create function public.set_label_request_status(p_id uuid,p_status text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_super_admin() then raise exception 'Super administrator access required' using errcode='42501'; end if;
  if p_status is null or p_status not in ('requested','in_progress','completed') then raise exception 'Invalid status'; end if;
  update public.label_requests set status=p_status,updated_at=now() where id=p_id;
  if not found then raise exception 'Request not found'; end if;
  insert into public.audit_events(actor_id,action,subject_id,details)
    values(auth.uid(),'label_status_changed',p_id,jsonb_build_object('status',p_status));
end;
$$;
revoke all on function public.save_label_request(uuid,text,text,integer[],numeric[]),public.set_label_request_status(uuid,text) from public, anon, authenticated;
grant execute on function public.save_label_request(uuid,text,text,integer[],numeric[]),public.set_label_request_status(uuid,text) to authenticated;
notify pgrst, 'reload schema';
commit;
