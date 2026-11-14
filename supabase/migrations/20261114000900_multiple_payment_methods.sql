begin;
alter table mobius_private.member_payment_profiles add column encrypted_methods bytea;

create function mobius_private.read_payment_methods(p_member_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p mobius_private.member_payment_profiles; secret text;
begin
  select * into p from mobius_private.member_payment_profiles where member_id=p_member_id;
  if not found then return '{}'::jsonb; end if;
  select decrypted_secret into secret from vault.decrypted_secrets where name='mobius_payment_encryption_key';
  if p.encrypted_methods is not null then return extensions.pgp_sym_decrypt(p.encrypted_methods,secret)::jsonb; end if;
  if p.payment_method<>'none' and p.encrypted_payment is not null then
    return jsonb_build_object(p.payment_method,extensions.pgp_sym_decrypt(p.encrypted_payment,secret)::jsonb);
  end if;
  return '{}'::jsonb;
end; $$;
revoke all on function mobius_private.read_payment_methods(uuid) from public,anon,authenticated,service_role;

-- Keep already-open older clients from losing other methods during rollout.
create function mobius_private.sync_legacy_payment() returns trigger
language plpgsql security definer set search_path='' as $$
declare methods jsonb; secret text;
begin
  if tg_op='INSERT' and new.encrypted_methods is not null then return new; end if;
  if tg_op='UPDATE' and new.encrypted_methods is distinct from old.encrypted_methods then return new; end if;
  select decrypted_secret into secret from vault.decrypted_secrets where name='mobius_payment_encryption_key';
  methods:=case when tg_op='UPDATE' then mobius_private.read_payment_methods(new.member_id) else '{}'::jsonb end;
  if new.payment_method='none' then
    if tg_op='UPDATE' then methods:=methods-old.payment_method; end if;
  elsif new.encrypted_payment is not null then
    methods:=jsonb_set(methods,array[new.payment_method],extensions.pgp_sym_decrypt(new.encrypted_payment,secret)::jsonb,true);
  end if;
  new.encrypted_methods:=case when methods='{}'::jsonb then null else extensions.pgp_sym_encrypt(methods::text,secret,'cipher-algo=aes256') end;
  return new;
end; $$;
revoke all on function mobius_private.sync_legacy_payment() from public,anon,authenticated,service_role;
create trigger mobius_sync_legacy_payment before insert or update on mobius_private.member_payment_profiles
  for each row execute function mobius_private.sync_legacy_payment();

create function public.get_member_payment_methods(p_member_id uuid default null,p_reveal_payment boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target uuid:=coalesce(p_member_id,auth.uid()); methods jsonb; role_name text;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  if target<>auth.uid() and not public.is_super_admin() then raise exception 'Profile access denied' using errcode='42501'; end if;
  select role into role_name from public.profiles where id=target;
  if not found then raise exception 'Profile not found'; end if;
  if target=auth.uid() and role_name='admin' then raise exception 'This account has deal-posting access only' using errcode='42501'; end if;
  methods:=mobius_private.read_payment_methods(target);
  if methods ? 'bank' and not coalesce(p_reveal_payment,false) then
    methods:=jsonb_set(methods,'{bank}',((methods->'bank') - 'account_number'::text - 'routing_number'::text) || jsonb_build_object('account_last4',right(methods->'bank'->>'account_number',4)));
  elsif methods ? 'bank' and coalesce(p_reveal_payment,false) then
    insert into public.audit_events(actor_id,action,subject_id,details) values(auth.uid(),'payment_details_viewed',target,'{}'::jsonb);
  end if;
  return methods;
end; $$;

create function public.save_member_payment_methods(p_full_name text,p_phone text,p_discord text,p_methods jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare p public.profiles; previous mobius_private.member_payment_profiles; old_methods jsonb; methods jsonb:='{}'::jsonb;
  secret text; b jsonb; routing text; account_number text; checksum integer; primary_method text; changed boolean;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  select * into p from public.profiles where id=auth.uid() for update;
  if not found or p.role<>'member' then raise exception 'Member profile access required' using errcode='42501'; end if;
  if p_full_name is null or char_length(trim(p_full_name)) not between 1 and 120 or char_length(coalesce(p_phone,''))>40
    or char_length(coalesce(p_discord,''))>100 or p_methods is null or jsonb_typeof(p_methods)<>'object'
    or exists(select 1 from jsonb_object_keys(p_methods) k where k not in ('bank','zelle','taekus')) then
    raise exception 'Enter your name and valid contact/payment information';
  end if;
  select decrypted_secret into secret from vault.decrypted_secrets where name='mobius_payment_encryption_key';
  if secret is null then raise exception 'Payment storage is not configured'; end if;
  select * into previous from mobius_private.member_payment_profiles where member_id=p.id;
  old_methods:=mobius_private.read_payment_methods(p.id);
  if p_methods ? 'bank' then
    b:=p_methods->'bank'; if jsonb_typeof(b)<>'object' then raise exception 'Invalid bank details'; end if;
    routing:=coalesce(nullif(b->>'routing_number',''),old_methods->'bank'->>'routing_number');
    account_number:=coalesce(nullif(b->>'account_number',''),old_methods->'bank'->>'account_number');
    if routing is null or routing !~ '^[0-9]{9}$' or routing='000000000' or account_number is null or account_number !~ '^[0-9]{4,17}$'
      or coalesce(b->>'account_type','') not in ('checking','savings')
      or char_length(trim(coalesce(b->>'account_holder',''))) not between 1 and 120
      or char_length(trim(coalesce(b->>'bank_name',''))) not between 1 and 120 then raise exception 'Enter valid bank account details'; end if;
    checksum:=3*(substring(routing,1,1)::int+substring(routing,4,1)::int+substring(routing,7,1)::int)
      +7*(substring(routing,2,1)::int+substring(routing,5,1)::int+substring(routing,8,1)::int)
      +substring(routing,3,1)::int+substring(routing,6,1)::int+substring(routing,9,1)::int;
    if checksum%10<>0 then raise exception 'Check the bank routing number'; end if;
    methods:=methods||jsonb_build_object('bank',jsonb_build_object('account_holder',trim(b->>'account_holder'),'bank_name',trim(b->>'bank_name'),'account_type',b->>'account_type','routing_number',routing,'account_number',account_number));
  end if;
  if p_methods ? 'zelle' then
    b:=p_methods->'zelle';
    if jsonb_typeof(b)<>'object' or char_length(trim(coalesce(b->>'name',''))) not between 1 and 120 or char_length(trim(coalesce(b->>'identifier',''))) not between 3 and 254 then raise exception 'Enter your Zelle name and registered email or phone'; end if;
    methods:=methods||jsonb_build_object('zelle',jsonb_build_object('name',trim(b->>'name'),'identifier',trim(b->>'identifier')));
  end if;
  if p_methods ? 'taekus' then
    b:=p_methods->'taekus';
    if jsonb_typeof(b)<>'object' or char_length(trim(coalesce(b->>'name',''))) not between 1 and 120 or coalesce(b->>'code','') !~ '^[A-Za-z0-9]{1,128}$' then raise exception 'Enter your exact Taekus name and alphanumeric Taekus Pay code'; end if;
    methods:=methods||jsonb_build_object('taekus',jsonb_build_object('name',trim(b->>'name'),'code',b->>'code'));
  end if;
  changed:=methods<>old_methods;
  primary_method:=case when methods ? coalesce(previous.payment_method,'none') then previous.payment_method
    when methods ? 'bank' then 'bank' when methods ? 'zelle' then 'zelle' when methods ? 'taekus' then 'taekus' else 'none' end;
  update public.profiles set full_name=trim(p_full_name) where id=p.id;
  insert into mobius_private.member_payment_profiles(member_id,phone,discord,payment_method,encrypted_payment,encrypted_methods)
    values(p.id,trim(coalesce(p_phone,'')),trim(coalesce(p_discord,'')),primary_method,
      case when primary_method='none' then null else extensions.pgp_sym_encrypt((methods->primary_method)::text,secret,'cipher-algo=aes256') end,
      case when methods='{}'::jsonb then null else extensions.pgp_sym_encrypt(methods::text,secret,'cipher-algo=aes256') end)
  on conflict(member_id) do update set phone=excluded.phone,discord=excluded.discord,payment_method=excluded.payment_method,
    encrypted_payment=excluded.encrypted_payment,encrypted_methods=excluded.encrypted_methods,
    updated_at=case when changed then now() else mobius_private.member_payment_profiles.updated_at end;
  insert into public.audit_events(actor_id,action,subject_id,details) values(auth.uid(),'profile_updated',p.id,jsonb_build_object('payment_changed',changed));
  if changed then insert into mobius_private.payment_change_alerts(member_id) values(p.id); end if;
end; $$;
revoke all on function public.get_member_payment_methods(uuid,boolean),public.save_member_payment_methods(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.get_member_payment_methods(uuid,boolean),public.save_member_payment_methods(text,text,text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
