begin;

alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('member', 'admin', 'super_admin'));

-- Preserve the existing owner's account. Never infer ownership from signup
-- metadata or grant elevated access to the first account to register.
update public.profiles set role = 'super_admin', active = true
where id = (select id from auth.users where lower(email) = 'themobiusenterprises@gmail.com');

create function public.is_super_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles
    where id = auth.uid() and active and role = 'super_admin');
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles
    where id = auth.uid() and active and role = 'super_admin');
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles
    where id = auth.uid() and active and role in ('member', 'super_admin'));
$$;

create function public.can_post_deals() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles
    where id = auth.uid() and active and role in ('admin', 'super_admin'));
$$;

drop policy deals_read on public.deals;
create policy deals_read on public.deals for select to authenticated
  using ((select public.is_member()) or (select public.can_post_deals()));

create or replace function public.create_deal(p_id uuid, p_title text, p_category text, p_retailer text, p_url text, p_base integer, p_commission integer, p_capacity integer, p_deadline date, p_instructions text)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_post_deals() then raise exception 'Deal posting access required' using errcode = '42501'; end if;
  if p_deadline < (now() at time zone 'America/Chicago')::date then raise exception 'Deadline cannot be in the past'; end if;
  insert into public.deals(id, title, category, retailer, url, base, commission, capacity, deadline, instructions, created_by)
  values(p_id, trim(p_title), p_category, trim(p_retailer), trim(p_url), p_base, p_commission, p_capacity, p_deadline, trim(p_instructions), auth.uid());
  insert into public.audit_events(actor_id, action, subject_id) values(auth.uid(), 'deal_created', p_id);
  return p_id;
end;
$$;

create or replace function public.set_member_active(p_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_super_admin() then
    raise exception 'Super administrator access required' using errcode = '42501';
  end if;
  if p_active is null then raise exception 'Membership status is required'; end if;
  if p_id = auth.uid() then raise exception 'You cannot change your own membership'; end if;
  update public.profiles set active = p_active
    where id = p_id and role in ('member', 'admin');
  if not found then raise exception 'Member not found or protected'; end if;
  insert into public.audit_events(actor_id, action, subject_id, details)
    values(auth.uid(), 'membership_changed', p_id, jsonb_build_object('active', p_active));
end;
$$;

create function public.set_member_role(p_id uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare previous_role text;
begin
  if not public.is_super_admin() then
    raise exception 'Super administrator access required' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('member', 'admin') then
    raise exception 'Choose Member or Admin';
  end if;
  if p_id = auth.uid() then raise exception 'You cannot change your own role'; end if;
  select role into previous_role from public.profiles where id = p_id for update;
  if not found or previous_role = 'super_admin' then
    raise exception 'Member not found or protected';
  end if;
  if previous_role = p_role then return; end if;
  update public.profiles set role = p_role where id = p_id;
  insert into public.audit_events(actor_id, action, subject_id, details)
    values(auth.uid(), 'role_changed', p_id,
      jsonb_build_object('previous', previous_role, 'role', p_role));
end;
$$;

revoke all on function public.is_super_admin(), public.can_post_deals(), public.set_member_role(uuid,text)
  from public, anon, authenticated;
grant execute on function public.is_super_admin(), public.can_post_deals(), public.set_member_role(uuid,text)
  to authenticated;

commit;
