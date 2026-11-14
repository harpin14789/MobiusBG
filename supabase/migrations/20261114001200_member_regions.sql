begin;
alter table public.profiles add column region text check (region in ('west','central','east'));

create function public.set_member_region(p_region text)
returns void language plpgsql security definer set search_path='' as $$
declare old_region text;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  if p_region is null or p_region not in ('west','central','east') then raise exception 'Select West, Central, or East'; end if;
  select region into old_region from public.profiles where id=auth.uid() and role='member' for update;
  if not found then raise exception 'Member profile access required' using errcode='42501'; end if;
  if old_region is not distinct from p_region then return; end if;
  update public.profiles set region=p_region where id=auth.uid();
  insert into public.audit_events(actor_id,action,subject_id,details)
    values(auth.uid(),'member_region_changed',auth.uid(),jsonb_build_object('previous',old_region,'region',p_region));
end; $$;
revoke all on function public.set_member_region(text) from public,anon,authenticated;
grant execute on function public.set_member_region(text) to authenticated;
notify pgrst,'reload schema';
commit;
