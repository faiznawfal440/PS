-- 202610140009: authoritative checkout preview, combined balances and idempotent payment RPCs.
-- Payment requests are private to database functions; clients never access this table directly.

create table if not exists public.payment_idempotency_requests (
  idempotency_key uuid primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  operation text not null check (operation in ('rental_checkout','session_balance_payment','fnb_order_payment')),
  entity_id uuid not null,
  request_fingerprint text not null,
  response jsonb,
  created_at timestamptz not null default pg_catalog.now(),
  completed_at timestamptz
);

create index if not exists payment_idempotency_requests_created_at_idx
  on public.payment_idempotency_requests (created_at);

alter table public.payment_idempotency_requests enable row level security;
revoke all on table public.payment_idempotency_requests from public, anon, authenticated;

-- One server-side rental calculation is shared by the live checkout preview and final checkout.
create or replace function public.calculate_session_rental_total(
  p_session_id uuid,
  p_at timestamptz default pg_catalog.now()
)
returns numeric(12,0)
language plpgsql
set search_path = ''
as $function$
declare
  s public.sessions%rowtype;
  mins integer;
  fee numeric(12,0) := 0;
  rate numeric(12,0);
  tol integer;
  rounding integer;
  billing_ended_at timestamptz;
begin
  select * into s from public.sessions where id = p_session_id;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  rate := coalesce((s.rate_snapshot->>'price_per_hour')::numeric, 0);
  tol := coalesce((s.rate_snapshot->>'overtime_tolerance_minutes')::integer, 5);
  rounding := coalesce((s.rate_snapshot->>'rounding_rule_minutes')::integer, 15);

  if s.billing_type = 'open' then
    billing_ended_at := case
      when s.status = 'paused' and s.paused_at is not null then s.paused_at
      else p_at
    end;
    mins := greatest(1, ceil(greatest(0,
      extract(epoch from billing_ended_at - s.started_at) - s.total_paused_seconds
    ) / 60.0)::integer);
    if rounding > 0 then mins := ceil(mins::numeric / rounding)::integer * rounding; end if;
    fee := round(rate * mins / 60.0);
  elsif s.status <> 'paused' and s.planned_end_at is not null then
    mins := greatest(0, ceil(extract(epoch from p_at - s.planned_end_at) / 60.0)::integer - tol);
    if mins > 0 then
      if rounding > 0 then mins := ceil(mins::numeric / rounding)::integer * rounding; end if;
      fee := round(rate * mins / 60.0);
    end if;
  end if;
  return greatest(0, s.subtotal + fee - s.discount);
end;
$function$;

revoke all on function public.calculate_session_rental_total(uuid,timestamptz) from public, anon, authenticated;

create or replace function public.preview_rental_checkout(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  s public.sessions%rowtype;
  rental_total numeric(12,0);
  rental_paid numeric(12,0) := 0;
  fnb_total numeric(12,0) := 0;
  fnb_paid numeric(12,0) := 0;
  combined_total numeric(12,0);
  combined_paid numeric(12,0);
  combined_outstanding numeric(12,0);
  orders_payload jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into s from public.sessions where id = p_session_id;
  if not found or not public.is_business_member(s.business_id) then raise exception 'FORBIDDEN'; end if;
  if s.status not in ('active','paused','overtime') then raise exception 'SESSION_NOT_ACTIVE'; end if;

  rental_total := public.calculate_session_rental_total(s.id, pg_catalog.now());
  select coalesce(sum(p.amount),0) into rental_paid
  from public.payments p where p.business_id=s.business_id and p.session_id=s.id;

  select coalesce(sum(o.total),0), coalesce(sum(coalesce(p.paid_amount,0)),0)
    into fnb_total, fnb_paid
  from public.fb_orders o
  left join lateral (
    select sum(fp.amount) as paid_amount from public.fb_payments fp where fp.order_id=o.id
  ) p on true
  where o.business_id=s.business_id and o.session_id=s.id and o.status in ('open','paid');

  select coalesce(
    jsonb_agg(jsonb_build_object(
      'id',o.id,'order_no',o.order_no,'total',o.total,
      'paid_amount',coalesce(p.paid_amount,0),
      'outstanding',greatest(0,o.total-coalesce(p.paid_amount,0))
    ) order by o.created_at,o.id),'[]'::jsonb)
  into orders_payload
  from public.fb_orders o
  left join lateral (
    select sum(fp.amount) as paid_amount from public.fb_payments fp where fp.order_id=o.id
  ) p on true
  where o.business_id=s.business_id and o.session_id=s.id and o.status in ('open','paid');

  combined_total := rental_total + fnb_total;
  combined_paid := rental_paid + fnb_paid;
  combined_outstanding := greatest(0,rental_total-rental_paid)
    + greatest(0,fnb_total-fnb_paid);
  return jsonb_build_object(
    'session_id',s.id,'rental_total',rental_total,'rental_paid',rental_paid,
    'fnb_total',fnb_total,'fnb_paid',fnb_paid,
    'total',combined_total,'paid_total',combined_paid,
    'outstanding',combined_outstanding,
    'payment_status',case when combined_outstanding=0 then 'paid' when combined_paid>0 then 'partial' else 'unpaid' end,
    'fnb_orders',orders_payload
  );
end;
$function$;

revoke all on function public.preview_rental_checkout(uuid) from public, anon;
grant execute on function public.preview_rental_checkout(uuid) to authenticated;

drop function if exists public.end_rental_session(uuid,text,numeric);
create or replace function public.end_rental_session(
  p_session_id uuid,
  p_payment_method text default 'cash',
  p_received_amount numeric default 0,
  p_idempotency_key uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
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
  received numeric(12,0);
  applied_total numeric(12,0);
  rental_applied numeric(12,0);
  remaining_received numeric(12,0);
  change_due numeric(12,0);
  order_row public.fb_orders%rowtype;
  order_paid numeric(12,0);
  order_applied numeric(12,0);
  order_paid_after numeric(12,0);
  rental_paid_after numeric(12,0);
  paid_total numeric(12,0);
  fnb_orders_payload jsonb := '[]'::jsonb;
  checkout_status text;
  result_payload jsonb;
  fingerprint text;
  existing_business uuid;
  existing_operation text;
  existing_entity uuid;
  existing_fingerprint text;
  existing_response jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_payment_method not in ('cash','transfer','qris','other') then raise exception 'INVALID_PAYMENT_METHOD'; end if;
  if p_received_amount is null or p_received_amount < 0 then raise exception 'INVALID_RECEIVED_AMOUNT'; end if;

  select * into s from public.sessions where id=p_session_id for update;
  if not found or not public.is_business_member(s.business_id) then raise exception 'FORBIDDEN'; end if;

  fingerprint := p_payment_method || ':' || round(p_received_amount)::text;
  if p_idempotency_key is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_idempotency_key::text,0));
    select business_id,operation,entity_id,request_fingerprint,response
      into existing_business,existing_operation,existing_entity,existing_fingerprint,existing_response
    from public.payment_idempotency_requests where idempotency_key=p_idempotency_key for update;
    if found then
      if existing_business is distinct from s.business_id or existing_operation <> 'rental_checkout'
        or existing_entity is distinct from s.id or existing_fingerprint is distinct from fingerprint then
        raise exception 'IDEMPOTENCY_KEY_REUSED';
      end if;
      if existing_response is null then raise exception 'IDEMPOTENCY_REQUEST_IN_PROGRESS'; end if;
      return existing_response;
    end if;
    insert into public.payment_idempotency_requests
      (idempotency_key,business_id,operation,entity_id,request_fingerprint)
    values(p_idempotency_key,s.business_id,'rental_checkout',s.id,fingerprint);
  end if;

  if s.status not in ('active','paused','overtime') then raise exception 'SESSION_NOT_ACTIVE'; end if;
  perform 1 from public.fb_orders o
   where o.business_id=s.business_id and o.session_id=s.id and o.status='open'
   order by o.created_at,o.id for update;

  total_due := public.calculate_session_rental_total(s.id,pg_catalog.now());
  select coalesce(sum(o.total),0) into fnb_total
    from public.fb_orders o
   where o.business_id=s.business_id and o.session_id=s.id and o.status in ('open','paid');
  select coalesce(sum(p.amount),0) into rental_paid_before
    from public.payments p where p.business_id=s.business_id and p.session_id=s.id;
  select coalesce(sum(p.amount),0) into fnb_paid_before
    from public.fb_payments p join public.fb_orders o on o.id=p.order_id
   where o.business_id=s.business_id and o.session_id=s.id and o.status in ('open','paid');

  rental_outstanding := greatest(0,total_due-rental_paid_before);
  fnb_outstanding := greatest(0,fnb_total-fnb_paid_before);
  invoice_total := total_due+fnb_total;
  invoice_outstanding := rental_outstanding+fnb_outstanding;
  received := round(p_received_amount);
  applied_total := least(invoice_outstanding,received);
  change_due := greatest(0,received-invoice_outstanding);
  rental_applied := least(rental_outstanding,received);
  remaining_received := greatest(0,received-rental_applied);

  update public.sessions set status='completed',ended_at=pg_catalog.now(),ended_by=auth.uid(),
    total=total_due,
    payment_status=case when rental_paid_before+rental_applied>=total_due then 'paid'
                        when rental_paid_before+rental_applied>0 then 'partial' else 'unpaid' end
  where id=s.id returning * into s;

  if rental_applied>0 then
    insert into public.payments(business_id,session_id,method,amount,received_amount,change_amount,received_by)
    values(s.business_id,s.id,p_payment_method,rental_applied,rental_applied,0,auth.uid());
  end if;

  for order_row in
    select * from public.fb_orders
     where business_id=s.business_id and session_id=s.id and status='open'
     order by created_at,id for update
  loop
    select coalesce(sum(p.amount),0) into order_paid from public.fb_payments p where p.order_id=order_row.id;
    order_applied := least(greatest(0,order_row.total-order_paid),remaining_received);
    order_paid_after := order_paid+order_applied;
    if order_applied>0 then
      insert into public.fb_payments(business_id,order_id,method,amount,received_amount,change_amount,received_by)
      values(s.business_id,order_row.id,p_payment_method,order_applied,order_applied,0,auth.uid());
      remaining_received := greatest(0,remaining_received-order_applied);
    end if;
    update public.fb_orders
      set payment_status=case when order_paid_after>=order_row.total then 'paid'
                              when order_paid_after>0 then 'partial' else 'unpaid' end,
          status=case when order_paid_after>=order_row.total then 'paid' else 'open' end,
          paid_at=case when order_paid_after>=order_row.total then coalesce(paid_at,pg_catalog.now()) else null end,
          updated_at=pg_catalog.now()
    where id=order_row.id;
  end loop;

  select coalesce(sum(p.amount),0) into rental_paid_after
    from public.payments p where p.business_id=s.business_id and p.session_id=s.id;
  select coalesce(sum(p.amount),0) into fnb_paid_before
    from public.fb_payments p join public.fb_orders o on o.id=p.order_id
   where o.business_id=s.business_id and o.session_id=s.id and o.status in ('open','paid');
  paid_total := rental_paid_after+fnb_paid_before;
  checkout_status := case when paid_total>=invoice_total then 'paid' when paid_total>0 then 'partial' else 'unpaid' end;

  select coalesce(jsonb_agg(jsonb_build_object(
      'order_id',o.id,'order_no',o.order_no,'total',o.total,
      'paid_amount',coalesce(p.paid_amount,0),'outstanding',greatest(0,o.total-coalesce(p.paid_amount,0)),
      'items',coalesce(i.items,'[]'::jsonb)
    ) order by o.created_at,o.id),'[]'::jsonb)
  into fnb_orders_payload
  from public.fb_orders o
  left join lateral (select sum(fp.amount) as paid_amount from public.fb_payments fp where fp.order_id=o.id) p on true
  left join lateral (
    select jsonb_agg(jsonb_build_object('product_name',fi.product_name,'quantity',fi.quantity,
      'unit_price',fi.unit_price,'line_total',fi.line_total) order by fi.created_at,fi.id) as items
    from public.fb_order_items fi where fi.order_id=o.id
  ) i on true
  where o.business_id=s.business_id and o.session_id=s.id and o.status<>'cancelled';

  result_payload := jsonb_build_object('session_id',s.id,'total',invoice_total,'rental_total',total_due,
    'fnb_total',fnb_total,'applied',applied_total,'paid_total',paid_total,'received',received,
    'change',change_due,'outstanding',greatest(0,invoice_total-paid_total),'payment_status',checkout_status,
    'fnb_orders',fnb_orders_payload);

  insert into public.session_events(business_id,session_id,event_type,payload,created_by)
  values(s.business_id,s.id,'end',jsonb_build_object('rental_total',total_due,'fnb_total',fnb_total,
    'total',invoice_total,'payment_status',checkout_status,'applied',applied_total,
    'received',received,'change',change_due,'outstanding',greatest(0,invoice_total-paid_total)),auth.uid());
  insert into public.audit_logs(business_id,user_id,action,entity,entity_id,after_data)
  values(s.business_id,auth.uid(),'session.ended','session',s.id,to_jsonb(s)||jsonb_build_object(
    'invoice_total',invoice_total,'rental_total',total_due,'fnb_total',fnb_total,'paid_total',paid_total,
    'outstanding',greatest(0,invoice_total-paid_total),'received',received,'change',change_due));

  if p_idempotency_key is not null then
    update public.payment_idempotency_requests set response=result_payload,completed_at=pg_catalog.now()
    where idempotency_key=p_idempotency_key;
  end if;
  return result_payload;
end;
$function$;

drop function if exists public.add_session_payment(uuid,text,numeric);
create or replace function public.add_session_payment(
  p_session_id uuid,
  p_payment_method text,
  p_received_amount numeric,
  p_idempotency_key uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  s public.sessions%rowtype;
  rental_paid_before numeric(12,0) := 0;
  fnb_total numeric(12,0) := 0;
  fnb_paid_before numeric(12,0) := 0;
  rental_outstanding numeric(12,0);
  fnb_outstanding numeric(12,0);
  combined_outstanding numeric(12,0);
  received numeric(12,0);
  rental_applied numeric(12,0);
  remaining_received numeric(12,0);
  applied_total numeric(12,0);
  change_due numeric(12,0);
  order_row public.fb_orders%rowtype;
  order_paid numeric(12,0);
  order_applied numeric(12,0);
  order_paid_after numeric(12,0);
  paid_after numeric(12,0);
  final_fnb_paid numeric(12,0);
  combined_status text;
  result_payload jsonb;
  fingerprint text;
  existing_business uuid;
  existing_operation text;
  existing_entity uuid;
  existing_fingerprint text;
  existing_response jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_payment_method not in ('cash','transfer','qris','other') then raise exception 'INVALID_PAYMENT_METHOD'; end if;
  if p_received_amount is null or p_received_amount<=0 then raise exception 'PAYMENT_MUST_BE_POSITIVE'; end if;
  select * into s from public.sessions where id=p_session_id for update;
  if not found or not public.is_business_member(s.business_id) then raise exception 'FORBIDDEN'; end if;

  fingerprint := p_payment_method || ':' || round(p_received_amount)::text;
  if p_idempotency_key is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_idempotency_key::text,0));
    select business_id,operation,entity_id,request_fingerprint,response
      into existing_business,existing_operation,existing_entity,existing_fingerprint,existing_response
    from public.payment_idempotency_requests where idempotency_key=p_idempotency_key for update;
    if found then
      if existing_business is distinct from s.business_id or existing_operation <> 'session_balance_payment'
        or existing_entity is distinct from s.id or existing_fingerprint is distinct from fingerprint then
        raise exception 'IDEMPOTENCY_KEY_REUSED';
      end if;
      if existing_response is null then raise exception 'IDEMPOTENCY_REQUEST_IN_PROGRESS'; end if;
      return existing_response;
    end if;
    insert into public.payment_idempotency_requests
      (idempotency_key,business_id,operation,entity_id,request_fingerprint)
    values(p_idempotency_key,s.business_id,'session_balance_payment',s.id,fingerprint);
  end if;

  if s.status<>'completed' then raise exception 'SESSION_MUST_BE_ENDED_FIRST'; end if;
  perform 1 from public.fb_orders o
   where o.business_id=s.business_id and o.session_id=s.id and o.status='open'
   order by o.created_at,o.id for update;

  select coalesce(sum(p.amount),0) into rental_paid_before
  from public.payments p where p.business_id=s.business_id and p.session_id=s.id;
  select coalesce(sum(o.total),0),coalesce(sum(coalesce(p.paid_amount,0)),0)
    into fnb_total,fnb_paid_before
  from public.fb_orders o
  left join lateral (select sum(fp.amount) as paid_amount from public.fb_payments fp where fp.order_id=o.id) p on true
  where o.business_id=s.business_id and o.session_id=s.id and o.status in ('open','paid');

  rental_outstanding := greatest(0,s.total-rental_paid_before);
  fnb_outstanding := greatest(0,fnb_total-fnb_paid_before);
  combined_outstanding := rental_outstanding+fnb_outstanding;
  if combined_outstanding<=0 then raise exception 'ALREADY_SETTLED'; end if;

  received := round(p_received_amount);
  applied_total := least(combined_outstanding,received);
  change_due := greatest(0,received-combined_outstanding);
  rental_applied := least(rental_outstanding,received);
  remaining_received := greatest(0,received-rental_applied);

  if rental_applied>0 then
    insert into public.payments(business_id,session_id,method,amount,received_amount,change_amount,received_by)
    values(s.business_id,s.id,p_payment_method,rental_applied,rental_applied,0,auth.uid());
  end if;

  for order_row in
    select * from public.fb_orders where business_id=s.business_id and session_id=s.id and status='open'
    order by created_at,id for update
  loop
    select coalesce(sum(p.amount),0) into order_paid from public.fb_payments p where p.order_id=order_row.id;
    order_applied := least(greatest(0,order_row.total-order_paid),remaining_received);
    order_paid_after := order_paid+order_applied;
    if order_applied>0 then
      insert into public.fb_payments(business_id,order_id,method,amount,received_amount,change_amount,received_by)
      values(s.business_id,order_row.id,p_payment_method,order_applied,order_applied,0,auth.uid());
      remaining_received := greatest(0,remaining_received-order_applied);
    end if;
    update public.fb_orders
      set payment_status=case when order_paid_after>=order_row.total then 'paid'
                              when order_paid_after>0 then 'partial' else 'unpaid' end,
          status=case when order_paid_after>=order_row.total then 'paid' else 'open' end,
          paid_at=case when order_paid_after>=order_row.total then coalesce(paid_at,pg_catalog.now()) else null end,
          updated_at=pg_catalog.now()
    where id=order_row.id;
  end loop;

  select coalesce(sum(p.amount),0) into paid_after
  from public.payments p where p.business_id=s.business_id and p.session_id=s.id;
  update public.sessions set payment_status=case when paid_after>=s.total then 'paid'
    when paid_after>0 then 'partial' else 'unpaid' end where id=s.id;
  select coalesce(sum(p.amount),0) into final_fnb_paid
  from public.fb_payments p join public.fb_orders o on o.id=p.order_id
  where o.business_id=s.business_id and o.session_id=s.id and o.status in ('open','paid');
  combined_status := case when paid_after+final_fnb_paid>=s.total+fnb_total then 'paid'
    when paid_after+final_fnb_paid>0 then 'partial' else 'unpaid' end;
  result_payload := jsonb_build_object('session_id',s.id,'total',s.total+fnb_total,'rental_total',s.total,
    'fnb_total',fnb_total,'previously_paid',rental_paid_before+fnb_paid_before,
    'applied',applied_total,'paid_total',paid_after+final_fnb_paid,'received',received,'change',change_due,
    'outstanding',greatest(0,s.total+fnb_total-paid_after-final_fnb_paid),'payment_status',combined_status);

  insert into public.session_events(business_id,session_id,event_type,payload,created_by)
  values(s.business_id,s.id,'payment_received',jsonb_build_object('method',p_payment_method,'applied',applied_total,
    'received',received,'change',change_due,'outstanding',result_payload->'outstanding',
    'rental_total',s.total,'fnb_total',fnb_total),auth.uid());
  insert into public.audit_logs(business_id,user_id,action,entity,entity_id,after_data)
  values(s.business_id,auth.uid(),'session.payment_received','session',s.id,result_payload);

  if p_idempotency_key is not null then
    update public.payment_idempotency_requests set response=result_payload,completed_at=pg_catalog.now()
    where idempotency_key=p_idempotency_key;
  end if;
  return result_payload;
end;
$function$;

drop function if exists public.pay_fb_order(uuid,text,numeric);
create or replace function public.pay_fb_order(
  p_order_id uuid,
  p_payment_method text,
  p_received_amount numeric,
  p_idempotency_key uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  o public.fb_orders%rowtype;
  paid_so_far numeric(12,0);
  outstanding numeric(12,0);
  received numeric(12,0);
  applied numeric(12,0);
  change_due numeric(12,0);
  result_payload jsonb;
  fingerprint text;
  existing_business uuid;
  existing_operation text;
  existing_entity uuid;
  existing_fingerprint text;
  existing_response jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_payment_method not in ('cash','transfer','qris','other') then raise exception 'INVALID_PAYMENT_METHOD'; end if;
  if p_received_amount is null or p_received_amount<=0 then raise exception 'PAYMENT_MUST_BE_POSITIVE'; end if;

  select * into o from public.fb_orders where id=p_order_id for update;
  if not found or not public.is_business_member(o.business_id) then raise exception 'ORDER_NOT_FOUND_OR_FORBIDDEN'; end if;
  fingerprint := p_payment_method || ':' || round(p_received_amount)::text;

  if p_idempotency_key is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_idempotency_key::text,0));
    select business_id,operation,entity_id,request_fingerprint,response
      into existing_business,existing_operation,existing_entity,existing_fingerprint,existing_response
    from public.payment_idempotency_requests where idempotency_key=p_idempotency_key for update;
    if found then
      if existing_business is distinct from o.business_id or existing_operation <> 'fnb_order_payment'
        or existing_entity is distinct from o.id or existing_fingerprint is distinct from fingerprint then
        raise exception 'IDEMPOTENCY_KEY_REUSED';
      end if;
      if existing_response is null then raise exception 'IDEMPOTENCY_REQUEST_IN_PROGRESS'; end if;
      return existing_response;
    end if;
    insert into public.payment_idempotency_requests
      (idempotency_key,business_id,operation,entity_id,request_fingerprint)
    values(p_idempotency_key,o.business_id,'fnb_order_payment',o.id,fingerprint);
  end if;

  if o.status<>'open' then raise exception 'ORDER_NOT_OPEN'; end if;
  select coalesce(sum(amount),0) into paid_so_far from public.fb_payments where order_id=o.id;
  outstanding := greatest(0,o.total-paid_so_far);
  if outstanding<=0 then raise exception 'ALREADY_SETTLED'; end if;
  received := round(p_received_amount);
  applied := least(outstanding,received);
  change_due := greatest(0,received-outstanding);

  insert into public.fb_payments(business_id,order_id,method,amount,received_amount,change_amount,received_by)
  values(o.business_id,o.id,p_payment_method,applied,received,change_due,auth.uid());
  update public.fb_orders set payment_status=case when paid_so_far+applied>=o.total then 'paid'
    when paid_so_far+applied>0 then 'partial' else 'unpaid' end,
    status=case when paid_so_far+applied>=o.total then 'paid' else 'open' end,
    paid_at=case when paid_so_far+applied>=o.total then pg_catalog.now() else null end,
    updated_at=pg_catalog.now() where id=o.id;
  insert into public.audit_logs(business_id,user_id,action,entity,entity_id,after_data)
  values(o.business_id,auth.uid(),'fb.payment_received','fb_order',o.id,
    jsonb_build_object('applied',applied,'received',received,'change',change_due,'outstanding',outstanding-applied));

  result_payload := jsonb_build_object('order_id',o.id,'total',o.total,'previously_paid',paid_so_far,
    'applied',applied,'received',received,'change',change_due,'outstanding',outstanding-applied);
  if p_idempotency_key is not null then
    update public.payment_idempotency_requests set response=result_payload,completed_at=pg_catalog.now()
    where idempotency_key=p_idempotency_key;
  end if;
  return result_payload;
end;
$function$;

revoke all on function public.end_rental_session(uuid,text,numeric,uuid) from public, anon;
revoke all on function public.add_session_payment(uuid,text,numeric,uuid) from public, anon;
revoke all on function public.pay_fb_order(uuid,text,numeric,uuid) from public, anon;
grant execute on function public.end_rental_session(uuid,text,numeric,uuid) to authenticated;
grant execute on function public.add_session_payment(uuid,text,numeric,uuid) to authenticated;
grant execute on function public.pay_fb_order(uuid,text,numeric,uuid) to authenticated;

notify pgrst, 'reload schema';
