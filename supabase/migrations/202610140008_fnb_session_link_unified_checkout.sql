-- 202610140008: link F&B orders to active rental sessions, settle a unified checkout,
-- and enable Realtime for the F&B tables used by the client.

-- Safely backfill historical orders only when exactly one completed session on the
-- same unit contains the order timestamp. Ambiguous rows remain untouched.
with candidates as (
  select o.id as order_id, s.id as session_id,
         count(*) over (partition by o.id) as candidate_count
  from public.fb_orders o
  join public.sessions s
    on s.business_id = o.business_id
   and s.unit_id = o.unit_id
   and s.status = 'completed'
   and o.created_at >= s.started_at
   and o.created_at <= coalesce(s.ended_at, now())
  where o.session_id is null
    and o.status in ('open', 'paid')
)
update public.fb_orders o
set session_id = c.session_id,
    customer_name = coalesce(o.customer_name, s.customer_name),
    updated_at = now()
from candidates c
join public.sessions s on s.id = c.session_id
where o.id = c.order_id
  and c.candidate_count = 1;

-- Adding only the unit is now sufficient: when that unit has an active rental,
-- bind the order to the active session in the same transaction.
create or replace function public.create_fb_order(
  p_items jsonb,
  p_unit_id uuid default null,
  p_session_id uuid default null,
  p_customer_name text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  bid uuid;
  session_business_id uuid;
  linked_unit_id uuid;
  item jsonb;
  product public.fb_products%rowtype;
  order_id uuid;
  order_no text;
  qty integer;
  line_total numeric(12,0);
  order_subtotal numeric(12,0) := 0;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'ORDER_REQUIRES_ITEMS';
  end if;
  if exists (
    select value->>'product_id'
    from jsonb_array_elements(p_items)
    group by value->>'product_id'
    having count(*) > 1
  ) then raise exception 'DUPLICATE_PRODUCT_LINE'; end if;

  if p_unit_id is not null then
    select business_id into bid
    from public.units
    where id = p_unit_id and is_active and deleted_at is null;
  end if;

  if p_session_id is null and p_unit_id is not null and bid is not null then
    select id into p_session_id
    from public.sessions
    where business_id = bid
      and unit_id = p_unit_id
      and status in ('active', 'paused', 'overtime')
    order by started_at desc
    limit 1
    for update;
  end if;

  if p_session_id is not null then
    select business_id, unit_id
      into session_business_id, linked_unit_id
    from public.sessions
    where id = p_session_id
      and status in ('active', 'paused', 'overtime')
    for update;
    if not found then raise exception 'SESSION_NOT_ACTIVE'; end if;
    if bid is not null and bid is distinct from session_business_id then
      raise exception 'SESSION_BUSINESS_MISMATCH';
    end if;
    if p_unit_id is not null and linked_unit_id is distinct from p_unit_id then
      raise exception 'SESSION_UNIT_MISMATCH';
    end if;
    bid := coalesce(bid, session_business_id);
    p_unit_id := coalesce(p_unit_id, linked_unit_id);
  end if;

  if bid is null then
    select business_id into bid
    from public.business_members
    where user_id = auth.uid() and is_active
    order by created_at, business_id
    limit 1;
  end if;
  if bid is null or not public.is_business_member(bid) then raise exception 'FORBIDDEN'; end if;
  if p_unit_id is not null and not exists (
    select 1 from public.units
    where id = p_unit_id and business_id = bid and is_active and deleted_at is null
  ) then raise exception 'UNIT_NOT_FOUND'; end if;
  if p_session_id is not null and not exists (
    select 1 from public.sessions
    where id = p_session_id and business_id = bid and unit_id = p_unit_id
      and status in ('active', 'paused', 'overtime')
  ) then raise exception 'SESSION_NOT_ACTIVE'; end if;

  order_no := 'FB-' || to_char(now() at time zone 'Asia/Jakarta', 'YYMMDD-HH24MISS')
    || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4));
  insert into public.fb_orders(
    business_id, order_no, unit_id, session_id, customer_name, status,
    payment_status, notes, created_by
  )
  values (
    bid, order_no, p_unit_id, p_session_id, nullif(trim(p_customer_name), ''),
    'open', 'unpaid', nullif(trim(p_notes), ''), auth.uid()
  )
  returning id into order_id;

  for item in select value from jsonb_array_elements(p_items) loop
    if coalesce(item->>'product_id', '') = '' then raise exception 'PRODUCT_ID_REQUIRED'; end if;
    qty := coalesce((item->>'quantity')::integer, 0);
    if qty < 1 or qty > 999 then raise exception 'INVALID_QUANTITY'; end if;
    select * into product
    from public.fb_products
    where id = (item->>'product_id')::uuid
      and business_id = bid and is_active
    for update;
    if not found then raise exception 'PRODUCT_NOT_FOUND_OR_INACTIVE'; end if;
    if product.stock_quantity is not null and product.stock_quantity < qty then
      raise exception using message = 'INSUFFICIENT_STOCK: ' || product.name;
    end if;
    line_total := product.price * qty;
    insert into public.fb_order_items(order_id, product_id, product_name, quantity, unit_price, line_total)
    values(order_id, product.id, product.name, qty, product.price, line_total);
    if product.stock_quantity is not null then
      update public.fb_products
      set stock_quantity = stock_quantity - qty, updated_at = now()
      where id = product.id;
    end if;
    order_subtotal := order_subtotal + line_total;
  end loop;

  update public.fb_orders
  set subtotal = order_subtotal, total = order_subtotal, updated_at = now()
  where id = order_id;
  insert into public.audit_logs(business_id, user_id, action, entity, entity_id, after_data)
  values(bid, auth.uid(), 'fb.order_created', 'fb_order', order_id,
         jsonb_build_object('order_no', order_no, 'subtotal', order_subtotal,
                            'unit_id', p_unit_id, 'session_id', p_session_id));
  return order_id;
end;
$$;

-- End a rental as one checkout: allocate the tender to the rental balance first,
-- then to unpaid F&B orders linked to that same session. Keep sessions.total as
-- the rental-only amount and return the combined invoice for one printable receipt.
create or replace function public.end_rental_session(
  p_session_id uuid,
  p_payment_method text default 'cash',
  p_received_amount numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.sessions%rowtype;
  total_due numeric(12,0);
  fnb_total numeric(12,0) := 0;
  rental_paid_before numeric(12,0) := 0;
  fnb_paid_before numeric(12,0) := 0;
  rental_outstanding numeric(12,0);
  fnb_outstanding numeric(12,0);
  invoice_total numeric(12,0);
  invoice_outstanding numeric(12,0);
  invoice_paid_before numeric(12,0);
  received numeric(12,0);
  applied_total numeric(12,0);
  rental_applied numeric(12,0);
  remaining_received numeric(12,0);
  change_due numeric(12,0);
  mins integer;
  fee numeric(12,0) := 0;
  rate numeric(12,0);
  tol integer;
  rounding integer;
  billing_ended_at timestamptz;
  order_row public.fb_orders%rowtype;
  order_paid numeric(12,0);
  order_outstanding numeric(12,0);
  order_applied numeric(12,0);
  rental_paid_after numeric(12,0);
  paid_total numeric(12,0);
  fnb_orders_payload jsonb := '[]'::jsonb;
  checkout_status text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_payment_method not in ('cash', 'transfer', 'qris', 'other') then
    raise exception 'INVALID_PAYMENT_METHOD';
  end if;

  select * into s from public.sessions where id = p_session_id for update;
  if not found or not public.is_business_member(s.business_id) then raise exception 'FORBIDDEN'; end if;
  if s.status not in ('active', 'paused', 'overtime') then raise exception 'SESSION_NOT_ACTIVE'; end if;

  rate := coalesce((s.rate_snapshot->>'price_per_hour')::numeric, 0);
  tol := coalesce((s.rate_snapshot->>'overtime_tolerance_minutes')::integer, 5);
  rounding := coalesce((s.rate_snapshot->>'rounding_rule_minutes')::integer, 15);
  if s.billing_type = 'open' then
    billing_ended_at := case when s.status = 'paused' and s.paused_at is not null then s.paused_at else now() end;
    mins := greatest(1, ceil(greatest(0, extract(epoch from billing_ended_at - s.started_at) - s.total_paused_seconds) / 60.0)::integer);
    if rounding > 0 then mins := ceil(mins::numeric / rounding)::integer * rounding; end if;
    fee := round(rate * mins / 60.0);
  elsif s.status <> 'paused' and s.planned_end_at is not null then
    mins := greatest(0, ceil(extract(epoch from now() - s.planned_end_at) / 60.0)::integer - tol);
    if mins > 0 then
      if rounding > 0 then mins := ceil(mins::numeric / rounding)::integer * rounding; end if;
      fee := round(rate * mins / 60.0);
    end if;
  end if;

  total_due := greatest(0, s.subtotal + fee - s.discount);
  select coalesce(sum(o.total), 0) into fnb_total
  from public.fb_orders o
  where o.business_id = s.business_id and o.session_id = s.id and o.status in ('open', 'paid');

  select coalesce(sum(p.amount), 0) into rental_paid_before
  from public.payments p where p.business_id = s.business_id and p.session_id = s.id;
  select coalesce(sum(p.amount), 0) into fnb_paid_before
  from public.fb_payments p
  join public.fb_orders o on o.id = p.order_id
  where o.business_id = s.business_id and o.session_id = s.id and o.status in ('open', 'paid');

  rental_outstanding := greatest(0, total_due - rental_paid_before);
  fnb_outstanding := greatest(0, fnb_total - fnb_paid_before);
  invoice_total := total_due + fnb_total;
  invoice_paid_before := rental_paid_before + fnb_paid_before;
  invoice_outstanding := rental_outstanding + fnb_outstanding;
  received := greatest(0, round(coalesce(p_received_amount, 0)));
  applied_total := least(invoice_outstanding, received);
  change_due := greatest(0, received - invoice_outstanding);
  rental_applied := least(rental_outstanding, received);
  remaining_received := greatest(0, received - rental_applied);

  update public.sessions
  set status = 'completed',
      ended_at = now(),
      ended_by = auth.uid(),
      total = total_due,
      payment_status = case
        when rental_paid_before + rental_applied >= total_due then 'paid'
        when rental_paid_before + rental_applied > 0 then 'partial'
        else 'unpaid'
      end
  where id = s.id
  returning * into s;

  if rental_applied > 0 then
    insert into public.payments(business_id, session_id, method, amount, received_amount, change_amount, received_by)
    values(s.business_id, s.id, p_payment_method, rental_applied, rental_applied, 0, auth.uid());
  end if;

  for order_row in
    select * from public.fb_orders
    where business_id = s.business_id and session_id = s.id and status = 'open'
    order by created_at, id
    for update
  loop
    select coalesce(sum(p.amount), 0) into order_paid
    from public.fb_payments p where p.order_id = order_row.id;
    order_outstanding := greatest(0, order_row.total - order_paid);
    order_applied := least(order_outstanding, remaining_received);
    if order_applied > 0 then
      insert into public.fb_payments(business_id, order_id, method, amount, received_amount, change_amount, received_by)
      values(s.business_id, order_row.id, p_payment_method, order_applied, order_applied, 0, auth.uid());
      remaining_received := greatest(0, remaining_received - order_applied);
      update public.fb_orders
      set payment_status = case
            when order_paid + order_applied >= order_row.total then 'paid'
            when order_paid + order_applied > 0 then 'partial'
            else 'unpaid'
          end,
          status = case when order_paid + order_applied >= order_row.total then 'paid' else 'open' end,
          paid_at = case when order_paid + order_applied >= order_row.total then now() else paid_at end,
          updated_at = now()
      where id = order_row.id;
    end if;
  end loop;

  select coalesce(sum(p.amount), 0) into fnb_paid_before
  from public.fb_payments p
  join public.fb_orders o on o.id = p.order_id
  where o.business_id = s.business_id and o.session_id = s.id and o.status in ('open', 'paid');
  select coalesce(sum(p.amount), 0) into rental_paid_after
  from public.payments p where p.business_id = s.business_id and p.session_id = s.id;
  paid_total := rental_paid_after + fnb_paid_before;
  checkout_status := case
    when paid_total >= invoice_total then 'paid'
    when paid_total > 0 then 'partial'
    else 'unpaid'
  end;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'order_id', o.id,
        'order_no', o.order_no,
        'total', o.total,
        'paid_amount', coalesce(p.paid_amount, 0),
        'outstanding', greatest(0, o.total - coalesce(p.paid_amount, 0)),
        'items', coalesce(i.items, '[]'::jsonb)
      ) order by o.created_at, o.id
    ),
    '[]'::jsonb
  ) into fnb_orders_payload
  from public.fb_orders o
  left join lateral (
    select sum(fp.amount) as paid_amount from public.fb_payments fp where fp.order_id = o.id
  ) p on true
  left join lateral (
    select jsonb_agg(
      jsonb_build_object('product_name', fi.product_name, 'quantity', fi.quantity,
                         'unit_price', fi.unit_price, 'line_total', fi.line_total)
      order by fi.created_at, fi.id
    ) as items
    from public.fb_order_items fi where fi.order_id = o.id
  ) i on true
  where o.business_id = s.business_id and o.session_id = s.id and o.status <> 'cancelled';

  insert into public.session_events(business_id, session_id, event_type, payload, created_by)
  values(s.business_id, s.id, 'end',
         jsonb_build_object('rental_total', total_due, 'fnb_total', fnb_total,
                            'total', invoice_total, 'payment_status', checkout_status,
                            'applied', applied_total, 'received', received,
                            'change', change_due, 'outstanding', greatest(0, invoice_total - paid_total)),
         auth.uid());
  insert into public.audit_logs(business_id, user_id, action, entity, entity_id, after_data)
  values(s.business_id, auth.uid(), 'session.ended', 'session', s.id,
         to_jsonb(s) || jsonb_build_object('invoice_total', invoice_total,
           'rental_total', total_due, 'fnb_total', fnb_total, 'paid_total', paid_total,
           'outstanding', greatest(0, invoice_total - paid_total)));

  return jsonb_build_object(
    'session_id', s.id,
    'total', invoice_total,
    'rental_total', total_due,
    'fnb_total', fnb_total,
    'applied', applied_total,
    'paid_total', paid_total,
    'received', received,
    'change', change_due,
    'outstanding', greatest(0, invoice_total - paid_total),
    'payment_status', checkout_status,
    'fnb_orders', fnb_orders_payload
  );
end;
$$;

-- The client subscribes only to tenant-scoped, business_id-bearing tables.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'fb_orders'
    ) then alter publication supabase_realtime add table public.fb_orders; end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'fb_payments'
    ) then alter publication supabase_realtime add table public.fb_payments; end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'fb_products'
    ) then alter publication supabase_realtime add table public.fb_products; end if;
  end if;
end;
$$;
