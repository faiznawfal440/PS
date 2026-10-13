-- Cashier shift opening/closing and reconciliation, exposed only through tenant-scoped RPCs.
create table if not exists public.cashier_shifts (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade,
 opened_by uuid not null references auth.users(id), closed_by uuid references auth.users(id),
 opening_cash numeric(12,0) not null default 0 check(opening_cash>=0), expected_cash numeric(12,0) not null default 0 check(expected_cash>=0),
 closing_cash numeric(12,0) check(closing_cash>=0), cash_difference numeric(12,0), status text not null default 'open' check(status in ('open','closed')),
 notes text, opened_at timestamptz not null default now(), closed_at timestamptz, created_at timestamptz not null default now(),
 check((status='open' and closed_at is null and closing_cash is null) or (status='closed' and closed_at is not null and closing_cash is not null))
);
create index if not exists cashier_shifts_business_opened_idx on public.cashier_shifts(business_id,opened_at desc);
create index if not exists cashier_shifts_opened_by_idx on public.cashier_shifts(opened_by,opened_at desc);
create unique index if not exists cashier_shifts_one_open_per_cashier_idx on public.cashier_shifts(business_id,opened_by) where status='open';
create index if not exists payment_idempotency_requests_business_id_idx on public.payment_idempotency_requests(business_id);
alter table public.cashier_shifts enable row level security;
revoke all on table public.cashier_shifts from public,anon,authenticated;
create or replace function public.cashier_expected_cash(p_business_id uuid,p_user_id uuid,p_opened_at timestamptz)
returns numeric(12,0) language sql stable security definer set search_path=''
as $function$
 select greatest(0,coalesce(sum(amount),0))::numeric(12,0) from (
  select p.amount from public.payments p where p.business_id=p_business_id and p.received_by=p_user_id and p.method='cash' and p.paid_at>=p_opened_at
  union all
  select fp.amount from public.fb_payments fp where fp.business_id=p_business_id and fp.received_by=p_user_id and fp.method='cash' and fp.paid_at>=p_opened_at
 ) cash_sales;
$function$;
revoke all on function public.cashier_expected_cash(uuid,uuid,timestamptz) from public,anon,authenticated;
create or replace function public.get_cashier_shift(p_business_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare s public.cashier_shifts%rowtype; expected numeric(12,0);
begin
 if auth.uid() is null or not public.is_business_member(p_business_id) then raise exception 'FORBIDDEN'; end if;
 select * into s from public.cashier_shifts where business_id=p_business_id and opened_by=auth.uid() and status='open' order by opened_at desc limit 1;
 if not found then return null; end if;
 expected:=s.opening_cash+public.cashier_expected_cash(p_business_id,auth.uid(),s.opened_at);
 update public.cashier_shifts set expected_cash=expected where id=s.id returning * into s;
 return jsonb_build_object('id',s.id,'business_id',s.business_id,'opened_by',s.opened_by,'opening_cash',s.opening_cash,'expected_cash',s.expected_cash,'closed_cash',s.closing_cash,'cash_difference',s.cash_difference,'opened_at',s.opened_at,'closed_at',s.closed_at,'status',s.status,'notes',s.notes);
end;
$function$;
create or replace function public.start_cashier_shift(p_business_id uuid,p_opening_cash numeric default 0)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare s public.cashier_shifts%rowtype;
begin
 if auth.uid() is null or not public.is_business_member(p_business_id) then raise exception 'FORBIDDEN'; end if;
 if p_opening_cash is null or p_opening_cash<0 or p_opening_cash<>round(p_opening_cash) then raise exception 'INVALID_OPENING_CASH'; end if;
 if exists(select 1 from public.cashier_shifts where business_id=p_business_id and opened_by=auth.uid() and status='open') then raise exception 'SHIFT_ALREADY_OPEN'; end if;
 insert into public.cashier_shifts(business_id,opened_by,opening_cash,expected_cash) values(p_business_id,auth.uid(),p_opening_cash,p_opening_cash) returning * into s;
 insert into public.audit_logs(business_id,user_id,action,entity,entity_id,after_data) values(p_business_id,auth.uid(),'cashier_shift_opened','cashier_shift',s.id,jsonb_build_object('opening_cash',s.opening_cash));
 return jsonb_build_object('id',s.id,'business_id',s.business_id,'opened_by',s.opened_by,'opening_cash',s.opening_cash,'expected_cash',s.expected_cash,'closed_cash',s.closing_cash,'cash_difference',s.cash_difference,'opened_at',s.opened_at,'closed_at',s.closed_at,'status',s.status,'notes',s.notes);
end;
$function$;
create or replace function public.close_cashier_shift(p_business_id uuid,p_shift_id uuid,p_closing_cash numeric,p_notes text default null)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare s public.cashier_shifts%rowtype; expected numeric(12,0);
begin
 if auth.uid() is null or not public.is_business_member(p_business_id) then raise exception 'FORBIDDEN'; end if;
 if p_closing_cash is null or p_closing_cash<0 or p_closing_cash<>round(p_closing_cash) then raise exception 'INVALID_CLOSING_CASH'; end if;
 select * into s from public.cashier_shifts where id=p_shift_id and business_id=p_business_id and opened_by=auth.uid() and status='open' for update;
 if not found then raise exception 'OPEN_SHIFT_NOT_FOUND'; end if;
 expected:=s.opening_cash+public.cashier_expected_cash(p_business_id,auth.uid(),s.opened_at);
 update public.cashier_shifts set status='closed',closed_by=auth.uid(),closed_at=now(),closing_cash=p_closing_cash,expected_cash=expected,cash_difference=p_closing_cash-expected,notes=nullif(trim(p_notes), '') where id=s.id returning * into s;
 insert into public.audit_logs(business_id,user_id,action,entity,entity_id,after_data) values(p_business_id,auth.uid(),'cashier_shift_closed','cashier_shift',s.id,jsonb_build_object('expected_cash',s.expected_cash,'closing_cash',s.closing_cash,'cash_difference',s.cash_difference,'notes',s.notes));
 return jsonb_build_object('id',s.id,'business_id',s.business_id,'opened_by',s.opened_by,'opening_cash',s.opening_cash,'expected_cash',s.expected_cash,'closed_cash',s.closing_cash,'cash_difference',s.cash_difference,'opened_at',s.opened_at,'closed_at',s.closed_at,'status',s.status,'notes',s.notes);
end;
$function$;
revoke all on function public.get_cashier_shift(uuid) from public,anon;
revoke all on function public.start_cashier_shift(uuid,numeric) from public,anon;
revoke all on function public.close_cashier_shift(uuid,uuid,numeric,text) from public,anon;
grant execute on function public.get_cashier_shift(uuid) to authenticated;
grant execute on function public.start_cashier_shift(uuid,numeric) to authenticated;
grant execute on function public.close_cashier_shift(uuid,uuid,numeric,text) to authenticated;
