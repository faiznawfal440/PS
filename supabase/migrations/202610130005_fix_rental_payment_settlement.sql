-- 202610130005: fix rental payment settlement against the production sessions schema.
-- sessions has no updated_at column; preserve all payment, change, RLS, event and audit logic.
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
  update public.sessions
    set payment_status=case when total_paid+applied>=s.total then 'paid' when total_paid+applied>0 then 'partial' else 'unpaid' end
  where id=s.id;
  insert into public.session_events(business_id,session_id,event_type,payload,created_by)
  values(s.business_id,s.id,'payment_received',jsonb_build_object('method',p_payment_method,'applied',applied,'received',received,'change',change_due,'outstanding',outstanding-applied),auth.uid());
  insert into public.audit_logs(business_id,user_id,action,entity,entity_id,after_data)
  values(s.business_id,auth.uid(),'session.payment_received','session',s.id,jsonb_build_object('applied',applied,'received',received,'change',change_due,'outstanding',outstanding-applied));
  return jsonb_build_object('session_id',s.id,'total',s.total,'previously_paid',total_paid,'applied',applied,'received',received,'change',change_due,'outstanding',outstanding-applied,'payment_status',case when total_paid+applied>=s.total then 'paid' else 'partial' end);
end; $$;
revoke all on function public.add_session_payment(uuid,text,numeric) from public;
grant execute on function public.add_session_payment(uuid,text,numeric) to authenticated;
