-- 202610130006: idempotent runtime fixes for billing, tenant isolation and helper access.
-- Safe to apply after migrations 001-005; definitions below are intentionally repeatable.

create or replace function public.end_rental_session(p_session_id uuid,p_payment_method text default 'cash',p_received_amount numeric default 0) returns jsonb language plpgsql security definer set search_path=public as $$ declare s public.sessions%rowtype; total_due numeric(12,0); mins integer; fee numeric(12,0):=0; rate numeric(12,0); received numeric(12,0); applied numeric(12,0); change_due numeric(12,0); tol integer; rounding integer; billing_ended_at timestamptz; begin if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if; if p_payment_method not in ('cash','transfer','qris','other') then raise exception 'INVALID_PAYMENT_METHOD'; end if; select * into s from public.sessions where id=p_session_id for update; if not found or not public.is_business_member(s.business_id) then raise exception 'FORBIDDEN'; end if; if s.status not in ('active','paused','overtime') then raise exception 'SESSION_NOT_ACTIVE'; end if; rate:=coalesce((s.rate_snapshot->>'price_per_hour')::numeric,0); tol:=coalesce((s.rate_snapshot->>'overtime_tolerance_minutes')::integer,5); rounding:=coalesce((s.rate_snapshot->>'rounding_rule_minutes')::integer,15); if s.billing_type='open' then billing_ended_at:=case when s.status='paused' and s.paused_at is not null then s.paused_at else now() end; mins:=greatest(1,ceil(greatest(0,extract(epoch from billing_ended_at-s.started_at)-s.total_paused_seconds)/60.0)::integer); if rounding>0 then mins:=ceil(mins::numeric/rounding)::integer*rounding; end if; fee:=round(rate*mins/60.0); elsif s.status<>'paused' and s.planned_end_at is not null then mins:=greatest(0,ceil(extract(epoch from now()-s.planned_end_at)/60.0)::integer-tol); if mins>0 then if rounding>0 then mins:=ceil(mins::numeric/rounding)::integer*rounding; end if; fee:=round(rate*mins/60.0); end if; end if; total_due:=greatest(0,s.subtotal+fee-s.discount); received:=greatest(0,coalesce(p_received_amount,0)); applied:=least(total_due,received); change_due:=greatest(0,received-total_due); update public.sessions set status='completed',ended_at=now(),ended_by=auth.uid(),total=total_due,payment_status=case when applied>=total_due then 'paid' when applied>0 then 'partial' else 'unpaid' end where id=s.id returning * into s; if received>0 then insert into public.payments(business_id,session_id,method,amount,received_amount,change_amount,received_by) values(s.business_id,s.id,p_payment_method,applied,received,change_due,auth.uid()); end if; insert into public.session_events(business_id,session_id,event_type,payload,created_by) values(s.business_id,s.id,'end',jsonb_build_object('overtime_fee',fee,'total',total_due,'payment_status',s.payment_status),auth.uid()); insert into public.audit_logs(business_id,user_id,action,entity,entity_id,after_data) values(s.business_id,auth.uid(),'session.ended','session',s.id,to_jsonb(s)); return jsonb_build_object('session_id',s.id,'total',total_due,'overtime_fee',fee,'applied',applied,'received',received,'change',change_due,'payment_status',s.payment_status); end; $$;

-- Keep reservation unit references inside the same business, even for service-role writes.
create or replace function public.validate_reservation_unit_business()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.unit_id is not null and not exists (
    select 1
    from public.units u
    where u.id = new.unit_id
      and u.business_id = new.business_id
  ) then
    raise exception 'RESERVATION_UNIT_BUSINESS_MISMATCH'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists reservations_validate_unit_business on public.reservations;
create trigger reservations_validate_unit_business
before insert or update on public.reservations
for each row execute function public.validate_reservation_unit_business();

alter table public.reservations enable row level security;

drop policy if exists "members create reservations" on public.reservations;
create policy "members create reservations" on public.reservations
  for insert to authenticated
  with check (
    public.is_business_member(reservations.business_id)
    and reservations.created_by = (select auth.uid())
    and (
      reservations.unit_id is null
      or exists (
        select 1
        from public.units u
        where u.id = reservations.unit_id
          and u.business_id = reservations.business_id
      )
    )
  );

drop policy if exists "members update reservations" on public.reservations;
create policy "members update reservations" on public.reservations
  for update to authenticated
  using (
    public.is_business_member(reservations.business_id)
    and (
      reservations.unit_id is null
      or exists (
        select 1
        from public.units u
        where u.id = reservations.unit_id
          and u.business_id = reservations.business_id
      )
    )
  )
  with check (
    public.is_business_member(reservations.business_id)
    and (
      reservations.unit_id is null
      or exists (
        select 1
        from public.units u
        where u.id = reservations.unit_id
          and u.business_id = reservations.business_id
      )
    )
  );

-- Keep internal security-definer RPCs unavailable to anonymous clients.
-- Preserve authenticated execution because the frontend invokes these APIs.
revoke all on function public.add_session_payment(uuid,text,numeric) from anon, public;
grant execute on function public.add_session_payment(uuid,text,numeric) to authenticated;
revoke all on function public.cancel_fb_order(uuid) from anon, public;
grant execute on function public.cancel_fb_order(uuid) to authenticated;
revoke all on function public.create_fb_order(jsonb,uuid,uuid,text,text) from anon, public;
grant execute on function public.create_fb_order(jsonb,uuid,uuid,text,text) to authenticated;
revoke all on function public.current_business_role(uuid) from anon, public;
grant execute on function public.current_business_role(uuid) to authenticated;
revoke all on function public.end_rental_session(uuid,text,numeric) from anon, public;
grant execute on function public.end_rental_session(uuid,text,numeric) to authenticated;
revoke all on function public.extend_rental_session(uuid,integer) from anon, public;
grant execute on function public.extend_rental_session(uuid,integer) to authenticated;
revoke all on function public.has_business_role(uuid,text[]) from anon, public;
grant execute on function public.has_business_role(uuid,text[]) to authenticated;
revoke all on function public.is_business_member(uuid) from anon, public;
grant execute on function public.is_business_member(uuid) to authenticated;
revoke all on function public.pause_rental_session(uuid,text) from anon, public;
grant execute on function public.pause_rental_session(uuid,text) to authenticated;
revoke all on function public.pay_fb_order(uuid,text,numeric) from anon, public;
grant execute on function public.pay_fb_order(uuid,text,numeric) to authenticated;
revoke all on function public.resume_rental_session(uuid) from anon, public;
grant execute on function public.resume_rental_session(uuid) to authenticated;
revoke all on function public.start_rental_session(uuid,uuid,text,text,integer,numeric) from anon, public;
grant execute on function public.start_rental_session(uuid,uuid,text,text,integer,numeric) to authenticated;

-- Cover foreign keys used for joins/deletes. These indexes were reported missing by
-- Supabase's performance advisor in the connected production project.
create index if not exists audit_logs_business_id_idx on public.audit_logs(business_id);
create index if not exists audit_logs_user_id_idx on public.audit_logs(user_id);
create index if not exists business_members_user_id_idx on public.business_members(user_id);
create index if not exists businesses_created_by_idx on public.businesses(created_by);
create index if not exists fb_order_items_product_id_idx on public.fb_order_items(product_id);
create index if not exists fb_orders_created_by_idx on public.fb_orders(created_by);
create index if not exists fb_orders_session_id_idx on public.fb_orders(session_id);
create index if not exists fb_orders_unit_id_idx on public.fb_orders(unit_id);
create index if not exists fb_payments_business_id_idx on public.fb_payments(business_id);
create index if not exists fb_payments_order_id_idx on public.fb_payments(order_id);
create index if not exists fb_payments_received_by_idx on public.fb_payments(received_by);
create index if not exists payments_business_id_idx on public.payments(business_id);
create index if not exists payments_received_by_idx on public.payments(received_by);
create index if not exists payments_session_id_idx on public.payments(session_id);
create index if not exists rate_plans_business_id_idx on public.rate_plans(business_id);
create index if not exists reservations_created_by_idx on public.reservations(created_by);
create index if not exists session_events_business_id_idx on public.session_events(business_id);
create index if not exists session_events_created_by_idx on public.session_events(created_by);
create index if not exists session_events_session_id_idx on public.session_events(session_id);
create index if not exists session_pauses_created_by_idx on public.session_pauses(created_by);
create index if not exists session_pauses_session_id_idx on public.session_pauses(session_id);
create index if not exists sessions_created_by_idx on public.sessions(created_by);
create index if not exists sessions_ended_by_idx on public.sessions(ended_by);
create index if not exists sessions_rate_plan_id_idx on public.sessions(rate_plan_id);
