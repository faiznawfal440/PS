-- 202610130003: billing settlement, role hardening, F&B and reservations.
create extension if not exists btree_gist;

create table if not exists public.fb_products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  code varchar(24) not null,
  name varchar(100) not null,
  category varchar(50) not null default 'Lainnya',
  price numeric(12,0) not null check (price >= 0),
  stock_quantity integer check (stock_quantity is null or stock_quantity >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, code)
);
create index if not exists fb_products_business_active_idx on public.fb_products(business_id,is_active);

create table if not exists public.fb_orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  order_no varchar(32) not null,
  unit_id uuid references public.units(id) on delete set null,
  session_id uuid references public.sessions(id) on delete set null,
  customer_name varchar(100),
  status text not null default 'open' check (status in ('open','paid','cancelled')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','partial','paid')),
  subtotal numeric(12,0) not null default 0 check (subtotal >= 0),
  discount numeric(12,0) not null default 0 check (discount >= 0),
  total numeric(12,0) not null default 0 check (total >= 0),
  notes varchar(250),
  created_by uuid references auth.users(id) on delete set null,
  paid_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id,order_no)
);
create index if not exists fb_orders_business_created_idx on public.fb_orders(business_id,created_at desc);

create table if not exists public.fb_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.fb_orders(id) on delete cascade,
  product_id uuid references public.fb_products(id) on delete set null,
  product_name varchar(100) not null,
  quantity integer not null check(quantity > 0),
  unit_price numeric(12,0) not null check(unit_price >= 0),
  line_total numeric(12,0) not null check(line_total >= 0),
  created_at timestamptz not null default now(),
  unique(order_id,product_id)
);
create table if not exists public.fb_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  order_id uuid not null references public.fb_orders(id) on delete restrict,
  method text not null check(method in ('cash','transfer','qris','other')),
  amount numeric(12,0) not null check(amount >= 0),
  received_amount numeric(12,0) not null check(received_amount >= amount),
  change_amount numeric(12,0) not null default 0 check(change_amount >= 0),
  received_by uuid references auth.users(id) on delete set null,
  paid_at timestamptz not null default now()
);
create index if not exists fb_payments_paid_at_idx on public.fb_payments(paid_at);

create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  unit_id uuid references public.units(id) on delete set null,
  customer_name varchar(100) not null,
  phone varchar(40),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'pending' check(status in ('pending','confirmed','checked_in','cancelled','completed')),
  notes varchar(250),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(ends_at > starts_at)
);
create index if not exists reservations_business_start_idx on public.reservations(business_id,starts_at);
do $$ begin
  alter table public.reservations add constraint reservations_unit_time_no_overlap
    exclude using gist (unit_id with =, tstzrange(starts_at,ends_at,'[)') with &&)
    where (unit_id is not null and status in ('confirmed','checked_in'));
exception when duplicate_object then null;
end $$;

create or replace function public.add_session_payment(p_session_id uuid,p_payment_method text,p_received_amount numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s public.sessions%rowtype; total_paid numeric(12,0); outstanding numeric(12,0); received numeric(12,0); applied numeric(12,0); change_due numeric(12,0);
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_payment_method not in ('cash','transfer','qris','other') then raise exception 'INVALID_PAYMENT_METHOD'; end if;
  if p_received_amount is null or p_received_amount<=0 then raise exception 'PAYMENT_MUST_BE_POSITIVE'; end if;
  select * into s from public.sessions where id=p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if not public.is_business_member(s.business_id) then raise exception 'FORBIDDEN'; end if;
  if s.status not in ('completed') then raise exception 'SESSION_MUST_BE_ENDED_FIRST'; end if;
  select coalesce(sum(amount),0) into total_paid from public.payments where session_id=s.id;
  outstanding:=greatest(0,s.total-total_paid);
  if outstanding<=0 then raise exception 'ALREADY_SETTLED'; end if;
  received:=round(p_received_amount);
  applied:=least(outstanding,received);
  change_due:=greatest(0,received-outstanding);
  insert into public.payments(business_id,session_id,method,amount,received_amount,change_amount,received_by)
  values(s.business_id,s.id,p_payment_method,applied,received,change_due,auth.uid());
  update public.sessions set payment_status=case when total_paid+applied>=s.total then 'paid' when total_paid+applied>0 then 'partial' else 'unpaid' end
  where id=s.id;
  insert into public.session_events(business_id,session_id,event_type,payload,created_by)
  values(s.business_id,s.id,'payment_received',jsonb_build_object('method',p_payment_method,'applied',applied,'received',received,'change',change_due,'outstanding',outstanding-applied),auth.uid());
  insert into public.audit_logs(business_id,user_id,action,entity,entity_id,after_data)
  values(s.business_id,auth.uid(),'session.payment_received','session',s.id,jsonb_build_object('applied',applied,'received',received,'change',change_due,'outstanding',outstanding-applied));
  return jsonb_build_object('session_id',s.id,'total',s.total,'previously_paid',total_paid,'applied',applied,'received',received,'change',change_due,'outstanding',outstanding-applied,'payment_status',case when total_paid+applied>=s.total then 'paid' else 'partial' end);
end; $$;

create or replace function public.create_fb_order(p_items jsonb,p_unit_id uuid default null,p_session_id uuid default null,p_customer_name text default null,p_notes text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare bid uuid; item jsonb; product public.fb_products%rowtype; order_id uuid; order_no text; qty integer; line numeric(12,0); subtotal numeric(12,0):=0;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'ORDER_REQUIRES_ITEMS'; end if;
  if exists(select value->>'product_id' from jsonb_array_elements(p_items) group by value->>'product_id' having count(*)>1) then raise exception 'DUPLICATE_PRODUCT_LINE'; end if;
  if p_unit_id is not null then select business_id into bid from public.units where id=p_unit_id and is_active and deleted_at is null; end if;
  if bid is null and p_session_id is not null then select business_id into bid from public.sessions where id=p_session_id; end if;
  if bid is null then select business_id into bid from public.business_members where user_id=auth.uid() and is_active order by created_at limit 1; end if;
  if bid is null or not public.is_business_member(bid) then raise exception 'FORBIDDEN'; end if;
  if p_unit_id is not null and not exists(select 1 from public.units where id=p_unit_id and business_id=bid and is_active and deleted_at is null) then raise exception 'UNIT_NOT_FOUND'; end if;
  if p_session_id is not null and not exists(select 1 from public.sessions where id=p_session_id and business_id=bid and status in ('active','paused','overtime')) then raise exception 'SESSION_NOT_ACTIVE'; end if;
  order_no:='FB-'||to_char(now() at time zone 'Asia/Jakarta','YYMMDD-HH24MISS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));
  insert into public.fb_orders(business_id,order_no,unit_id,session_id,customer_name,status,payment_status,notes,created_by)
  values(bid,order_no,p_unit_id,p_session_id,nullif(trim(p_customer_name),''),'open','unpaid',nullif(trim(p_notes),''),auth.uid()) returning id into order_id;
  for item in select value from jsonb_array_elements(p_items) loop
    if coalesce(item->>'product_id','')='' then raise exception 'PRODUCT_ID_REQUIRED'; end if;
    qty:=coalesce((item->>'quantity')::integer,0);
    if qty<1 or qty>999 then raise exception 'INVALID_QUANTITY'; end if;
    select * into product from public.fb_products where id=(item->>'product_id')::uuid and business_id=bid and is_active for update;
    if not found then raise exception 'PRODUCT_NOT_FOUND_OR_INACTIVE'; end if;
    if product.stock_quantity is not null and product.stock_quantity<qty then raise exception using message = 'INSUFFICIENT_STOCK: ' || product.name; end if;
    line:=product.price*qty;
    insert into public.fb_order_items(order_id,product_id,product_name,quantity,unit_price,line_total) values(order_id,product.id,product.name,qty,product.price,line);
    if product.stock_quantity is not null then update public.fb_products set stock_quantity=stock_quantity-qty,updated_at=now() where id=product.id; end if;
    subtotal:=subtotal+line;
  end loop;
  update public.fb_orders set subtotal=subtotal,total=subtotal,updated_at=now() where id=order_id;
  insert into public.audit_logs(business_id,user_id,action,entity,entity_id,after_data)
  values(bid,auth.uid(),'fb.order_created','fb_order',order_id,jsonb_build_object('order_no',order_no,'subtotal',subtotal));
  return order_id;
end; $$;

create or replace function public.pay_fb_order(p_order_id uuid,p_payment_method text,p_received_amount numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare o public.fb_orders%rowtype; paid_so_far numeric(12,0); outstanding numeric(12,0); received numeric(12,0); applied numeric(12,0); change_due numeric(12,0);
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_payment_method not in ('cash','transfer','qris','other') then raise exception 'INVALID_PAYMENT_METHOD'; end if;
  if coalesce(p_received_amount,0)<=0 then raise exception 'PAYMENT_MUST_BE_POSITIVE'; end if;
  select * into o from public.fb_orders where id=p_order_id for update;
  if not found or not public.is_business_member(o.business_id) then raise exception 'ORDER_NOT_FOUND_OR_FORBIDDEN'; end if;
  if o.status<>'open' then raise exception 'ORDER_NOT_OPEN'; end if;
  select coalesce(sum(amount),0) into paid_so_far from public.fb_payments where order_id=o.id;
  outstanding:=greatest(0,o.total-paid_so_far);
  if outstanding<=0 then raise exception 'ALREADY_SETTLED'; end if;
  received:=round(p_received_amount); applied:=least(outstanding,received); change_due:=greatest(0,received-outstanding);
  insert into public.fb_payments(business_id,order_id,method,amount,received_amount,change_amount,received_by)
  values(o.business_id,o.id,p_payment_method,applied,received,change_due,auth.uid());
  update public.fb_orders set payment_status=case when paid_so_far+applied>=o.total then 'paid' when paid_so_far+applied>0 then 'partial' else 'unpaid' end,
    status=case when paid_so_far+applied>=o.total then 'paid' else 'open' end,
    paid_at=case when paid_so_far+applied>=o.total then now() else null end,updated_at=now() where id=o.id;
  insert into public.audit_logs(business_id,user_id,action,entity,entity_id,after_data)
  values(o.business_id,auth.uid(),'fb.payment_received','fb_order',o.id,jsonb_build_object('applied',applied,'received',received,'change',change_due,'outstanding',outstanding-applied));
  return jsonb_build_object('order_id',o.id,'total',o.total,'previously_paid',paid_so_far,'applied',applied,'received',received,'change',change_due,'outstanding',outstanding-applied);
end; $$;

create or replace function public.cancel_fb_order(p_order_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare o public.fb_orders%rowtype; item record; paid numeric(12,0);
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into o from public.fb_orders where id=p_order_id for update;
  if not found or not public.is_business_member(o.business_id) then raise exception 'ORDER_NOT_FOUND_OR_FORBIDDEN'; end if;
  if o.status<>'open' then raise exception 'ORDER_NOT_OPEN'; end if;
  select coalesce(sum(amount),0) into paid from public.fb_payments where order_id=o.id;
  if paid>0 then raise exception 'REFUND_REQUIRED_BEFORE_CANCELLATION'; end if;
  for item in select product_id,quantity from public.fb_order_items where order_id=o.id and product_id is not null loop
    update public.fb_products set stock_quantity=stock_quantity+item.quantity,updated_at=now() where id=item.product_id and stock_quantity is not null;
  end loop;
  update public.fb_orders set status='cancelled',cancelled_at=now(),updated_at=now() where id=o.id;
  insert into public.audit_logs(business_id,user_id,action,entity,entity_id,after_data)
  values(o.business_id,auth.uid(),'fb.order_cancelled','fb_order',o.id,jsonb_build_object('order_no',o.order_no));
end; $$;

alter table public.fb_products enable row level security;
alter table public.fb_orders enable row level security;
alter table public.fb_order_items enable row level security;
alter table public.fb_payments enable row level security;
alter table public.reservations enable row level security;

drop policy if exists "members read F&B products" on public.fb_products;
create policy "members read F&B products" on public.fb_products for select to authenticated using(public.is_business_member(business_id));
drop policy if exists "admins manage F&B products" on public.fb_products;
create policy "admins manage F&B products" on public.fb_products for all to authenticated using(public.is_business_member(business_id) and public.current_business_role(business_id) in ('owner','admin')) with check(public.is_business_member(business_id) and public.current_business_role(business_id) in ('owner','admin'));
drop policy if exists "members read F&B orders" on public.fb_orders;
create policy "members read F&B orders" on public.fb_orders for select to authenticated using(public.is_business_member(business_id));
drop policy if exists "members read F&B items" on public.fb_order_items;
create policy "members read F&B items" on public.fb_order_items for select to authenticated using(exists(select 1 from public.fb_orders o where o.id=order_id and public.is_business_member(o.business_id)));
drop policy if exists "members read F&B payments" on public.fb_payments;
create policy "members read F&B payments" on public.fb_payments for select to authenticated using(public.is_business_member(business_id));
drop policy if exists "members read reservations" on public.reservations;
create policy "members read reservations" on public.reservations for select to authenticated using(public.is_business_member(business_id));
drop policy if exists "members create reservations" on public.reservations;
create policy "members create reservations" on public.reservations for insert to authenticated with check(public.is_business_member(business_id) and created_by=auth.uid());
drop policy if exists "members update reservations" on public.reservations;
create policy "members update reservations" on public.reservations for update to authenticated using(public.is_business_member(business_id)) with check(public.is_business_member(business_id));

-- Restrict direct writes: session/payment/order mutations must pass through audited RPCs.
revoke insert, update, delete on public.sessions from authenticated;
revoke insert, update, delete on public.payments from authenticated;
revoke insert, update, delete on public.fb_orders from authenticated;
revoke insert, update, delete on public.fb_order_items from authenticated;
revoke insert, update, delete on public.fb_payments from authenticated;
revoke all on function public.add_session_payment(uuid,text,numeric) from public;
revoke all on function public.create_fb_order(jsonb,uuid,uuid,text,text) from public;
revoke all on function public.pay_fb_order(uuid,text,numeric) from public;
revoke all on function public.cancel_fb_order(uuid) from public;
grant execute on function public.add_session_payment(uuid,text,numeric) to authenticated;
grant execute on function public.create_fb_order(jsonb,uuid,uuid,text,text) to authenticated;
grant execute on function public.pay_fb_order(uuid,text,numeric) to authenticated;
grant execute on function public.cancel_fb_order(uuid) to authenticated;

-- Keep user-supplied SQL arrays isolated to the caller's business by RPC checks and RLS.
