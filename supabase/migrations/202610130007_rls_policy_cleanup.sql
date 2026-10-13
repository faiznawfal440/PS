-- 202610130007: reduce redundant RLS policies and relocate btree_gist.
-- Every operation is guarded so this migration can be safely reapplied.

-- btree_gist is relocatable. Keep extension-owned objects outside the exposed public schema.
do $$
declare extension_schema text;
begin
  select n.nspname into extension_schema
  from pg_extension e
  join pg_namespace n on n.oid=e.extnamespace
  where e.extname='btree_gist';

  if extension_schema='public'
     and exists (select 1 from pg_namespace where nspname='extensions') then
    execute 'alter extension btree_gist set schema extensions';
  end if;
end;
$$;

-- Members already have SELECT on these catalogues. Keep admin write permissions
-- in action-specific policies to avoid overlapping permissive SELECT policies.
drop policy if exists "admins manage F&B products" on public.fb_products;
drop policy if exists "admins insert F&B products" on public.fb_products;
create policy "admins insert F&B products" on public.fb_products
  for insert to authenticated
  with check (
    public.is_business_member(business_id)
    and public.current_business_role(business_id) in ('owner','admin')
  );
drop policy if exists "admins update F&B products" on public.fb_products;
create policy "admins update F&B products" on public.fb_products
  for update to authenticated
  using (
    public.is_business_member(business_id)
    and public.current_business_role(business_id) in ('owner','admin')
  )
  with check (
    public.is_business_member(business_id)
    and public.current_business_role(business_id) in ('owner','admin')
  );
drop policy if exists "admins delete F&B products" on public.fb_products;
create policy "admins delete F&B products" on public.fb_products
  for delete to authenticated
  using (
    public.is_business_member(business_id)
    and public.current_business_role(business_id) in ('owner','admin')
  );

drop policy if exists "admins manage rates" on public.rate_plans;
drop policy if exists "admins insert rates" on public.rate_plans;
create policy "admins insert rates" on public.rate_plans
  for insert to authenticated
  with check (
    public.is_business_member(business_id)
    and public.current_business_role(business_id) in ('owner','admin')
  );
drop policy if exists "admins update rates" on public.rate_plans;
create policy "admins update rates" on public.rate_plans
  for update to authenticated
  using (
    public.is_business_member(business_id)
    and public.current_business_role(business_id) in ('owner','admin')
  )
  with check (
    public.is_business_member(business_id)
    and public.current_business_role(business_id) in ('owner','admin')
  );
drop policy if exists "admins delete rates" on public.rate_plans;
create policy "admins delete rates" on public.rate_plans
  for delete to authenticated
  using (
    public.is_business_member(business_id)
    and public.current_business_role(business_id) in ('owner','admin')
  );

-- "admins update units" already authorizes the same rows as the duplicate policy.
drop policy if exists "admins deactivate units" on public.units;
