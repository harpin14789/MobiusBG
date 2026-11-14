begin;

create table public.delivery_submissions (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations(id),
  member_id uuid not null references public.profiles(id),
  email text not null,
  payment_name text not null check (char_length(trim(payment_name)) between 1 and 120),
  upc text not null check (upc ~ '^([0-9]{8}|[0-9]{12,14})$'),
  method text not null check (method in ('Ship to warehouse', 'Local drop-off', 'Admin-provided label')),
  reference text not null check (char_length(trim(reference)) between 1 and 2000),
  quantity integer not null check (quantity > 0),
  destination text not null check (char_length(trim(destination)) between 1 and 300),
  amazon_otp text not null default '' check (char_length(amazon_otp) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(reservation_id, upc)
);
create index delivery_submissions_member_idx on public.delivery_submissions(member_id);
alter table public.delivery_submissions enable row level security;
revoke all on public.delivery_submissions from anon, authenticated;
grant select on public.delivery_submissions to authenticated;
grant all on public.delivery_submissions to service_role;
create policy delivery_submissions_read on public.delivery_submissions for select to authenticated
  using ((select public.is_member()) and (member_id = (select auth.uid()) or (select public.is_super_admin())));

alter table public.reservations drop constraint reservations_reference_check;
alter table public.reservations add constraint reservations_reference_check
  check (char_length(reference) <= 2000);

create function public.save_delivery_submission(p_reservation_id uuid, p_submission_id uuid,
  p_payment_name text, p_upc text, p_method text, p_reference text,
  p_quantity integer, p_destination text, p_amazon_otp text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.reservations; submission_id uuid; previous public.delivery_submissions;
  submitted_units bigint; owner_email text;
begin
  if not public.is_member() then raise exception 'Member access required' using errcode = '42501'; end if;
  select * into r from public.reservations where id = p_reservation_id for update;
  if not found or (r.member_id <> auth.uid() and not public.is_super_admin()) then
    raise exception 'Reservation not found' using errcode = '42501';
  end if;
  if p_submission_id is not null then
    select * into previous from public.delivery_submissions
      where id = p_submission_id and reservation_id = r.id;
    if not found then raise exception 'Submission not found'; end if;
  end if;
  if p_payment_name is null or char_length(trim(p_payment_name)) not between 1 and 120
    or p_upc is null or p_upc !~ '^([0-9]{8}|[0-9]{12,14})$'
    or p_method is null or p_method not in ('Ship to warehouse', 'Local drop-off', 'Admin-provided label')
    or p_reference is null or char_length(trim(p_reference)) not between 1 and 2000
    or p_quantity is null or p_quantity < 1
    or p_destination is null or char_length(trim(p_destination)) not between 1 and 300
    or char_length(coalesce(p_amazon_otp,'')) > 100 then
    raise exception 'Complete the payment name, UPC, delivery references, quantity, and destination';
  end if;
  select coalesce(sum(quantity),0) into submitted_units from public.delivery_submissions
    where reservation_id = r.id and (p_submission_id is null or id <> p_submission_id);
  if submitted_units + p_quantity > r.quantity then
    raise exception 'Submitted quantities cannot exceed your reserved units';
  end if;
  if submitted_units + p_quantity < r.received then
    raise exception 'Submitted quantities cannot be reduced below received units';
  end if;
  select email into owner_email from auth.users where id = r.member_id;
  if p_submission_id is null then
    insert into public.delivery_submissions(reservation_id,member_id,email,payment_name,upc,method,reference,quantity,destination,amazon_otp)
    values(r.id,r.member_id,owner_email,trim(p_payment_name),p_upc,p_method,trim(p_reference),p_quantity,trim(p_destination),trim(coalesce(p_amazon_otp,'')))
    returning id into submission_id;
  else
    update public.delivery_submissions set email=owner_email,payment_name=trim(p_payment_name),upc=p_upc,
      method=p_method,reference=trim(p_reference),quantity=p_quantity,destination=trim(p_destination),
      amazon_otp=trim(coalesce(p_amazon_otp,'')),updated_at=now() where id=p_submission_id;
    submission_id := p_submission_id;
  end if;
  update public.reservations set submitted=true,method=p_method,reference=trim(p_reference) where id=r.id;
  insert into public.audit_events(actor_id,action,subject_id,details)
    values(auth.uid(),'delivery_submitted',r.id,jsonb_build_object('submission_id',submission_id,'upc',p_upc,'quantity',p_quantity));
  return submission_id;
exception when unique_violation then
  raise exception 'This UPC already has a submission for this reservation. Edit that submission instead.';
end;
$$;

-- Old clients must use the expanded form; incomplete legacy submissions cannot
-- bypass the new required fields. Existing saved references are preserved.
create or replace function public.submit_delivery(p_id uuid, p_method text, p_reference text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'Reload Mobius and use the expanded delivery submission form';
end;
$$;
revoke all on function public.save_delivery_submission(uuid,uuid,text,text,text,text,integer,text,text)
  from public, anon, authenticated;
grant execute on function public.save_delivery_submission(uuid,uuid,text,text,text,text,integer,text,text)
  to authenticated;

notify pgrst, 'reload schema';
commit;
