-- 202610130004: business permission helpers, F&B starter catalogue and RPC consistency.
create or replace function public.has_business_role(p_business_id uuid,p_roles text[])
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.business_members m
    where m.business_id=p_business_id and m.user_id=auth.uid() and m.is_active and m.role=any(p_roles)
  );
$$;
revoke all on function public.has_business_role(uuid,text[]) from public;
grant execute on function public.has_business_role(uuid,text[]) to authenticated;

-- Product catalogue defaults are idempotent; each business can change prices and stock later.
insert into public.fb_products(business_id,code,name,category,price,stock_quantity,is_active)
select b.id,v.code,v.name,v.category,v.price,v.stock_quantity,true
from public.businesses b
cross join (values
 ('AIR01','Air Mineral','Minuman',5000::numeric,30),
 ('TEH01','Teh Botol','Minuman',6000::numeric,24),
 ('MIE01','Mi Instan','Makanan',8000::numeric,20),
 ('SNK01','Keripik','Snack',5000::numeric,18),
 ('KOP01','Kopi Kaleng','Minuman',9000::numeric,20),
 ('SODA1','Minuman Soda','Minuman',7000::numeric,20)
) as v(code,name,category,price,stock_quantity)
on conflict (business_id,code) do nothing;

create or replace function public.create_fb_order(p_items jsonb,p_unit_id uuid default null,p_session_id uuid default null,p_customer_name text default null,p_notes text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare bid uuid; item jsonb; product public.fb_products%rowtype; order_id uuid; order_no text; qty integer; line_total numeric(12,0); order_subtotal numeric(12,0):=0; linked_unit_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'ORDER_REQUIRES_ITEMS'; end if;
  if exists(select value->>'product_id' from jsonb_array_elements(p_items) group by value->>'product_id' having count(*)>1) then raise exception 'DUPLICATE_PRODUCT_LINE'; end if;
  if p_unit_id is not null then select business_id into bid from public.units where id=p_unit_id and is_active and deleted_at is null; end if;
  if bid is null and p_session_id is not null then select business_id,unit_id into bid,linked_unit_id from public.sessions where id=p_session_id; end if;
  if bid is null then select business_id into bid from public.business_members where user_id=auth.uid() and is_active order by created_at limit 1; end if;
  if bid is null or not public.is_business_member(bid) then raise exception 'FORBIDDEN'; end if;
  if p_unit_id is not null and not exists(select 1 from public.units where id=p_unit_id and business_id=bid and is_active and deleted_at is null) then raise exception 'UNIT_NOT_FOUND'; end if;
  if p_session_id is not null then
    select unit_id into linked_unit_id from public.sessions where id=p_session_id and business_id=bid and status in ('active','paused','overtime');
    if not found then raise exception 'SESSION_NOT_ACTIVE'; end if;
    if p_unit_id is not null and linked_unit_id is distinct from p_unit_id then raise exception 'SESSION_UNIT_MISMATCH'; end if;
  end if;
  order_no:='FB-'||to_char(now() at time zone 'Asia/Jakarta','YYMMDD-HH24MISS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));
  insert into public.fb_orders(business_id,order_no,unit_id,session_id,customer_name,status,payment_status,notes,created_by)
  values(bid,order_no,p_unit_id,p_session_id,nullif(trim(p_customer_name),''),'open','unpaid',nullif(trim(p_notes),''),auth.uid()) returning id into order_id;
  for item in select value from jsonb_array_elements(p_items) loop
    if coalesce(item->>'product_id','')='' then raise exception 'PRODUCT_ID_REQUIRED'; end if;
    qty:=coalesce((item->>'quantity')::integer,0);
    if qty<1 or qty>999 then raise exception 'INVALID_QUANTITY'; end if;
    select * into product from public.fb_products where id=(item->>'product_id')::uuid and business_id=bid and is_active for update;
    if not found then raise exception 'PRODUCT_NOT_FOUND_OR_INACTIVE'; end if;
    if product.stock_quantity is not null and product.stock_quantity<qty then raise exception using message = 'INSUFFICIENT_STOCK: '||product.name; end if;
    line_total:=product.price*qty;
    insert into public.fb_order_items(order_id,product_id,product_name,quantity,unit_price,line_total) values(order_id,product.id,product.name,qty,product.price,line_total);
    if product.stock_quantity is not null then update public.fb_products set stock_quantity=stock_quantity-qty,updated_at=now() where id=product.id; end if;
    order_subtotal:=order_subtotal+line_total;
  end loop;
  update public.fb_orders set subtotal=order_subtotal,total=order_subtotal,updated_at=now() where id=order_id;
  insert into public.audit_logs(business_id,user_id,action,entity,entity_id,after_data)
  values(bid,auth.uid(),'fb.order_created','fb_order',order_id,jsonb_build_object('order_no',order_no,'subtotal',order_subtotal));
  return order_id;
end; $$;
revoke all on function public.create_fb_order(jsonb,uuid,uuid,text,text) from public;
grant execute on function public.create_fb_order(jsonb,uuid,uuid,text,text) to authenticated;

-- Role-aware policies for privileged business data and settings.
drop policy if exists "owners update business" on public.businesses;
create policy "owners update business" on public.businesses for update to authenticated
using (public.has_business_role(id,array['owner'])) with check(public.has_business_role(id,array['owner']));
drop policy if exists "admins manage rates" on public.rate_plans;
create policy "admins manage rates" on public.rate_plans for all to authenticated
using (public.has_business_role(business_id,array['owner','admin']))
with check (public.has_business_role(business_id,array['owner','admin']));
drop policy if exists "admins insert units" on public.units;
create policy "admins insert units" on public.units for insert to authenticated
with check (public.has_business_role(business_id,array['owner','admin']));
drop policy if exists "admins update units" on public.units;
create policy "admins update units" on public.units for update to authenticated
using (public.has_business_role(business_id,array['owner','admin']))
with check (public.has_business_role(business_id,array['owner','admin']));
drop policy if exists "admins deactivate units" on public.units;
create policy "admins deactivate units" on public.units for update to authenticated
using (public.has_business_role(business_id,array['owner','admin']))
with check (public.has_business_role(business_id,array['owner','admin']));
drop policy if exists "admins read audit" on public.audit_logs;
create policy "admins read audit" on public.audit_logs for select to authenticated
using (public.has_business_role(business_id,array['owner','admin']));
