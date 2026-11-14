begin;
create extension if not exists pgcrypto with schema extensions;
alter table public.profiles add column full_name text not null default ''
  check (char_length(full_name)<=120);

do $$ begin
  if not exists(select 1 from vault.secrets where name='mobius_payment_encryption_key') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'mobius_payment_encryption_key');
  end if;
end; $$;

create table mobius_private.member_payment_profiles (
  member_id uuid primary key references public.profiles(id) on delete cascade,
  phone text not null default '',
  discord text not null default '',
  payment_method text not null default 'none' check(payment_method in ('none','bank','zelle','taekus')),
  encrypted_payment bytea,
  updated_at timestamptz not null default now()
);
alter table mobius_private.member_payment_profiles enable row level security;
revoke all on mobius_private.member_payment_profiles from public,anon,authenticated;
grant all on mobius_private.member_payment_profiles to service_role;

create table mobius_private.payment_change_alerts (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'queued' check(status in ('queued','sending','sent','failed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_token uuid,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
alter table mobius_private.payment_change_alerts enable row level security;
revoke all on mobius_private.payment_change_alerts from public,anon,authenticated;
grant all on mobius_private.payment_change_alerts to service_role;

create function public.get_member_profile(p_member_id uuid default null,p_reveal_payment boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target uuid := coalesce(p_member_id,auth.uid()); p public.profiles;
  private mobius_private.member_payment_profiles; payment jsonb := '{}'::jsonb; encryption_key text;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  if target<>auth.uid() and not public.is_super_admin() then raise exception 'Profile access denied' using errcode='42501'; end if;
  select * into p from public.profiles where id=target;
  if not found then raise exception 'Profile not found'; end if;
  if target=auth.uid() and p.role='admin' then raise exception 'This account has deal-posting access only' using errcode='42501'; end if;
  select * into private from mobius_private.member_payment_profiles where member_id=target;
  if private.encrypted_payment is not null then
    select decrypted_secret into encryption_key from vault.decrypted_secrets where name='mobius_payment_encryption_key';
    payment := extensions.pgp_sym_decrypt(private.encrypted_payment,encryption_key)::jsonb;
    if private.payment_method='bank' and not coalesce(p_reveal_payment,false) then
      payment := (payment - 'account_number' - 'routing_number') || jsonb_build_object('account_last4',right(payment->>'account_number',4));
    end if;
    if coalesce(p_reveal_payment,false) then
      insert into public.audit_events(actor_id,action,subject_id,details)
      values(auth.uid(),'payment_details_viewed',target,'{}'::jsonb);
    end if;
  end if;
  return jsonb_build_object('id',p.id,'email',(select email from auth.users where id=target),
    'full_name',p.full_name,'role',p.role,'active',p.active,'phone',coalesce(private.phone,''),
    'discord',coalesce(private.discord,''),'payment_method',coalesce(private.payment_method,'none'),
    'payment_details',payment,'payment_updated_at',private.updated_at,'own_profile',target=auth.uid());
end;
$$;

create function public.save_member_profile(p_full_name text,p_phone text,p_discord text,
  p_payment_method text,p_payment_details jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare p public.profiles; previous mobius_private.member_payment_profiles;
  old_details jsonb := '{}'::jsonb; details jsonb := '{}'::jsonb; encryption_key text;
  routing text; account_number text; checksum integer; payment_changed boolean;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  select * into p from public.profiles where id=auth.uid() for update;
  if not found or p.role not in ('member','super_admin') then raise exception 'Member profile access required' using errcode='42501'; end if;
  if p_full_name is null or char_length(trim(p_full_name)) not between 1 and 120
    or char_length(coalesce(p_phone,''))>40 or char_length(coalesce(p_discord,''))>100
    or p_payment_method is null or p_payment_method not in ('none','bank','zelle','taekus')
    or p_payment_details is null or jsonb_typeof(p_payment_details)<>'object' then
    raise exception 'Enter your name and valid contact/payment information';
  end if;
  select decrypted_secret into encryption_key from vault.decrypted_secrets where name='mobius_payment_encryption_key';
  if encryption_key is null then raise exception 'Payment storage is not configured'; end if;
  select * into previous from mobius_private.member_payment_profiles where member_id=p.id;
  if previous.encrypted_payment is not null then
    old_details := extensions.pgp_sym_decrypt(previous.encrypted_payment,encryption_key)::jsonb;
  end if;
  if p_payment_method='bank' then
    routing := coalesce(nullif(p_payment_details->>'routing_number',''),case when previous.payment_method='bank' then old_details->>'routing_number' end);
    account_number := coalesce(nullif(p_payment_details->>'account_number',''),case when previous.payment_method='bank' then old_details->>'account_number' end);
    if routing is null or routing !~ '^[0-9]{9}$' or routing='000000000'
      or account_number is null or account_number !~ '^[0-9]{4,17}$'
      or coalesce(p_payment_details->>'account_type','') not in ('checking','savings')
      or char_length(trim(coalesce(p_payment_details->>'account_holder',''))) not between 1 and 120
      or char_length(trim(coalesce(p_payment_details->>'bank_name',''))) not between 1 and 120 then
      raise exception 'Enter the account holder, bank, account type, 9-digit routing number, and account number';
    end if;
    checksum := 3*(substring(routing,1,1)::int+substring(routing,4,1)::int+substring(routing,7,1)::int)
      +7*(substring(routing,2,1)::int+substring(routing,5,1)::int+substring(routing,8,1)::int)
      +substring(routing,3,1)::int+substring(routing,6,1)::int+substring(routing,9,1)::int;
    if checksum%10<>0 then raise exception 'Check the bank routing number'; end if;
    details := jsonb_build_object('account_holder',trim(p_payment_details->>'account_holder'),
      'bank_name',trim(p_payment_details->>'bank_name'),'account_type',p_payment_details->>'account_type',
      'routing_number',routing,'account_number',account_number);
  elsif p_payment_method='zelle' then
    if char_length(trim(coalesce(p_payment_details->>'name',''))) not between 1 and 120
      or char_length(trim(coalesce(p_payment_details->>'identifier',''))) not between 3 and 254 then
      raise exception 'Enter your Zelle name and registered email or phone';
    end if;
    details := jsonb_build_object('name',trim(p_payment_details->>'name'),'identifier',trim(p_payment_details->>'identifier'));
  elsif p_payment_method='taekus' then
    if char_length(trim(coalesce(p_payment_details->>'name',''))) not between 1 and 120
      or coalesce(p_payment_details->>'code','') !~ '^[A-Za-z0-9]{1,128}$' then
      raise exception 'Enter your exact Taekus name and alphanumeric Taekus Pay code';
    end if;
    details := jsonb_build_object('name',trim(p_payment_details->>'name'),'code',p_payment_details->>'code');
  end if;
  payment_changed := coalesce(previous.payment_method,'none')<>p_payment_method or old_details<>details;
  update public.profiles set full_name=trim(p_full_name) where id=p.id;
  insert into mobius_private.member_payment_profiles(member_id,phone,discord,payment_method,encrypted_payment)
    values(p.id,trim(coalesce(p_phone,'')),trim(coalesce(p_discord,'')),p_payment_method,
      case when p_payment_method='none' then null else extensions.pgp_sym_encrypt(details::text,encryption_key,'cipher-algo=aes256') end)
    on conflict(member_id) do update set phone=excluded.phone,discord=excluded.discord,
      payment_method=excluded.payment_method,encrypted_payment=excluded.encrypted_payment,
      updated_at=case when payment_changed then now() else mobius_private.member_payment_profiles.updated_at end;
  insert into public.audit_events(actor_id,action,subject_id,details)
    values(auth.uid(),'profile_updated',p.id,jsonb_build_object('payment_changed',payment_changed));
  if payment_changed then insert into mobius_private.payment_change_alerts(member_id) values(p.id); end if;
end;
$$;

create function public.claim_payment_change_alerts()
returns table(id uuid,member_id uuid,email text,full_name text,lease_token uuid)
language plpgsql security definer set search_path='' as $$
begin
  update mobius_private.payment_change_alerts set status='failed',lease_token=null,last_error='attempt_limit'
    where status in ('queued','sending') and attempts>=5 and available_at<=now();
  return query with candidates as (
    select q.id from mobius_private.payment_change_alerts q where q.status in ('queued','sending')
      and q.available_at<=now() and q.attempts<5 order by q.created_at limit 2 for update skip locked
  ), claimed as (
    update mobius_private.payment_change_alerts q set status='sending',attempts=attempts+1,
      lease_token=gen_random_uuid(),available_at=now()+interval '10 minutes'
    from candidates c where q.id=c.id returning q.id,q.member_id,q.lease_token
  ) select c.id,c.member_id,u.email::text,p.full_name,c.lease_token from claimed c
    join auth.users u on u.id=c.member_id join public.profiles p on p.id=c.member_id;
end;
$$;

create function public.complete_payment_change_alert(p_id uuid,p_lease_token uuid,p_sent boolean,p_error text default null)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  update mobius_private.payment_change_alerts set
    status=case when p_sent then 'sent' when attempts>=5 then 'failed' else 'queued' end,
    sent_at=case when p_sent then now() else null end,
    available_at=now()+interval '2 minutes'*power(2,least(attempts,5)),lease_token=null,
    last_error=case when p_sent then null else left(coalesce(p_error,'smtp_error'),80) end
  where id=p_id and status='sending' and lease_token=p_lease_token;
  return found;
end;
$$;
revoke all on function public.get_member_profile(uuid,boolean),public.save_member_profile(text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.get_member_profile(uuid,boolean),public.save_member_profile(text,text,text,text,jsonb) to authenticated;
revoke all on function public.claim_payment_change_alerts(),public.complete_payment_change_alert(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.claim_payment_change_alerts(),public.complete_payment_change_alert(uuid,uuid,boolean,text) to service_role;
create or replace function public.claim_approval_alerts()
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
    order by q.created_at limit 3 for update of q skip locked
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


notify pgrst,'reload schema';
commit;
