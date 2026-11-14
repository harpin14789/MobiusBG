-- All browser access uses authenticated JWTs and RLS. No service-role key is needed by the app.
begin;

create table public.profiles (
  id uuid primary key references auth.users(id),
  email text not null,
  role text not null default 'member' check (role in ('member', 'admin')),
  active boolean not null default false,
  created_at timestamptz not null default now()
);

create function public.handle_new_member() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, email) values (new.id, coalesce(new.email, ''));
  return new;
end;
$$;
revoke all on function public.handle_new_member() from public, anon, authenticated;
create trigger mobius_new_member after insert on auth.users
for each row execute function public.handle_new_member();
insert into public.profiles(id, email) select id, coalesce(email, '') from auth.users;

create function public.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id = auth.uid() and active);
$$;
create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id = auth.uid() and active and role = 'admin');
$$;

create table public.deals (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 120),
  category text not null check (category in ('Laptops', 'Graphics cards', 'VR & gaming', 'Other')),
  retailer text not null check (char_length(trim(retailer)) between 1 and 80),
  url text not null check (url ~ '^https?://[^ /]+' and char_length(url) <= 2000),
  base integer not null check (base between 1 and 100000000),
  commission integer not null default 0 check (commission between 0 and 100000000),
  capacity integer not null check (capacity between 1 and 100000),
  reserved integer not null default 0 check (reserved >= 0 and reserved <= capacity),
  deadline date not null,
  instructions text not null check (char_length(trim(instructions)) between 1 and 2000),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create table public.reservations (
  id uuid primary key,
  deal_id uuid not null references public.deals(id),
  member_id uuid not null references public.profiles(id),
  quantity integer not null check (quantity between 1 and 100000),
  base integer not null check (base > 0),
  commission integer not null check (commission >= 0),
  method text not null default '' check (method in ('', 'Ship to warehouse', 'Local drop-off', 'Admin-provided label')),
  reference text not null default '' check (char_length(reference) <= 300),
  submitted boolean not null default false,
  received integer not null default 0 check (received >= 0 and received <= quantity),
  paid integer not null default 0 check (paid >= 0 and paid <= received),
  created_at timestamptz not null default now()
);
create index reservations_member_idx on public.reservations(member_id);
create index reservations_deal_idx on public.reservations(deal_id);
create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid not null references public.profiles(id),
  action text not null,
  subject_id uuid not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.deals enable row level security;
alter table public.reservations enable row level security;
alter table public.audit_events enable row level security;
revoke all on public.profiles, public.deals, public.reservations, public.audit_events from anon, authenticated;
grant select on public.profiles, public.deals, public.reservations, public.audit_events to authenticated;
create policy profiles_read on public.profiles for select to authenticated using (id = (select auth.uid()) or (select public.is_admin()));
create policy deals_read on public.deals for select to authenticated using ((select public.is_member()));
create policy reservations_read on public.reservations for select to authenticated using ((select public.is_member()) and (member_id = (select auth.uid()) or (select public.is_admin())));
create policy audit_read on public.audit_events for select to authenticated using ((select public.is_admin()));

create function public.create_deal(p_id uuid, p_title text, p_category text, p_retailer text, p_url text, p_base integer, p_commission integer, p_capacity integer, p_deadline date, p_instructions text)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Administrator access required' using errcode = '42501'; end if;
  if p_deadline < (now() at time zone 'America/Chicago')::date then raise exception 'Deadline cannot be in the past'; end if;
  insert into public.deals(id, title, category, retailer, url, base, commission, capacity, deadline, instructions, created_by)
  values(p_id, trim(p_title), p_category, trim(p_retailer), p_url, p_base, p_commission, p_capacity, p_deadline, trim(p_instructions), auth.uid());
  insert into public.audit_events(actor_id, action, subject_id) values(auth.uid(), 'deal_created', p_id);
  return p_id;
end;
$$;

create function public.reserve_deal(p_deal_id uuid, p_quantity integer, p_request_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare d public.deals; r public.reservations;
begin
  if not public.is_member() then raise exception 'Active membership required' using errcode = '42501'; end if;
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

create function public.submit_delivery(p_id uuid, p_method text, p_reference text)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.reservations;
begin
  if not public.is_member() then raise exception 'Active membership required' using errcode = '42501'; end if;
  select * into r from public.reservations where id = p_id for update;
  if not found or (r.member_id <> auth.uid() and not public.is_admin()) then raise exception 'Reservation not found' using errcode = '42501'; end if;
  if p_method is null or p_method not in ('Ship to warehouse', 'Local drop-off', 'Admin-provided label') or p_reference is null or char_length(trim(p_reference)) not between 1 and 300 then raise exception 'Valid delivery method and reference required'; end if;
  update public.reservations set method = p_method, reference = trim(p_reference), submitted = true where id = p_id;
  insert into public.audit_events(actor_id, action, subject_id) values(auth.uid(), 'delivery_submitted', p_id);
end;
$$;

create function public.record_units(p_id uuid, p_kind text, p_units integer)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.reservations; previous integer;
begin
  if not public.is_admin() then raise exception 'Administrator access required' using errcode = '42501'; end if;
  select * into r from public.reservations where id = p_id for update;
  if not found then raise exception 'Reservation not found'; end if;
  if p_units is null then raise exception 'A whole-number quantity is required'; end if;
  if p_kind = 'received' then
    previous := r.received;
    if p_units < r.received or p_units > r.quantity then raise exception 'Received count must increase and cannot exceed reserved units'; end if;
    update public.reservations set received = p_units where id = p_id;
  elsif p_kind = 'paid' then
    previous := r.paid;
    if p_units < r.paid or p_units > r.received then raise exception 'Paid count must increase and cannot exceed received units'; end if;
    update public.reservations set paid = p_units where id = p_id;
  else raise exception 'Invalid record type'; end if;
  if p_units > previous then
    insert into public.audit_events(actor_id, action, subject_id, details)
    values(auth.uid(), p_kind, p_id, jsonb_build_object('previous', previous, 'total', p_units, 'amount_cents', (p_units - previous)::bigint * (r.base::bigint + r.commission::bigint)));
  end if;
end;
$$;

create function public.set_member_active(p_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Administrator access required' using errcode = '42501'; end if;
  if p_id = auth.uid() then raise exception 'You cannot change your own membership'; end if;
  update public.profiles set active = p_active where id = p_id and role = 'member';
  if not found then raise exception 'Member not found'; end if;
  insert into public.audit_events(actor_id, action, subject_id, details) values(auth.uid(), 'membership_changed', p_id, jsonb_build_object('active', p_active));
end;
$$;

-- Postgres grants EXECUTE to PUBLIC by default. Scope every callable function explicitly.
revoke all on function public.is_member(), public.is_admin() from public, anon, authenticated;
grant execute on function public.is_member(), public.is_admin() to authenticated;
revoke all on function public.create_deal(uuid,text,text,text,text,integer,integer,integer,date,text), public.reserve_deal(uuid,integer,uuid), public.submit_delivery(uuid,text,text), public.record_units(uuid,text,integer), public.set_member_active(uuid,boolean) from public, anon, authenticated;
grant execute on function public.create_deal(uuid,text,text,text,text,integer,integer,integer,date,text), public.reserve_deal(uuid,integer,uuid), public.submit_delivery(uuid,text,text), public.record_units(uuid,text,integer), public.set_member_active(uuid,boolean) to authenticated;
commit;
