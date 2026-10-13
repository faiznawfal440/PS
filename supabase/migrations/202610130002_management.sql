-- RentalPS Manager: management operations and member directory
create table if not exists public.business_member_profiles (
  business_id uuid not null,
  user_id uuid not null,
  email text not null default '',
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (business_id,user_id),
  foreign key (business_id,user_id) references public.business_members(business_id,user_id) on delete cascade
);
alter table public.business_member_profiles enable row level security;
insert into public.business_member_profiles (business_id,user_id,email,display_name)
select m.business_id,m.user_id,coalesce(u.email,''),coalesce(u.raw_user_meta_data->>'full_name',u.raw_user_meta_data->>'name','')
from public.business_members m join auth.users u on u.id=m.user_id
on conflict (business_id,user_id) do update set email=excluded.email,display_name=case when public.business_member_profiles.display_name='' then excluded.display_name else public.business_member_profiles.display_name end,updated_at=now();

drop policy if exists "members read member profiles" on public.business_member_profiles;
create policy "members read member profiles" on public.business_member_profiles
 for select to authenticated using (public.is_business_member(business_id));
drop policy if exists "admins insert units" on public.units;
create policy "admins insert units" on public.units
 for insert to authenticated with check (public.is_business_member(business_id) and public.current_business_role(business_id) in ('owner','admin'));
drop policy if exists "admins deactivate units" on public.units;
create policy "admins deactivate units" on public.units
 for update to authenticated using (public.is_business_member(business_id) and public.current_business_role(business_id) in ('owner','admin'))
 with check (public.is_business_member(business_id) and public.current_business_role(business_id) in ('owner','admin'));
