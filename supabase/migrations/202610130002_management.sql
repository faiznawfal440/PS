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
create policy "members read member profiles" on public.business_member_profiles
 for select to authenticated using (public.is_business_member(business_id));
create policy "admins insert units" on public.units
 for insert to authenticated with check (public.is_business_member(business_id) and public.current_business_role(business_id) in ('owner','admin'));
create policy "admins deactivate units" on public.units
 for update to authenticated using (public.is_business_member(business_id) and public.current_business_role(business_id) in ('owner','admin'))
 with check (public.is_business_member(business_id) and public.current_business_role(business_id) in ('owner','admin'));
