-- Retire the cashier-shift feature while preserving any existing shift records.
-- Migration 010 remains in history; this migration removes the callable API safely.
begin;

drop function if exists public.get_cashier_shift(uuid);
drop function if exists public.start_cashier_shift(uuid, numeric);
drop function if exists public.close_cashier_shift(uuid, uuid, numeric, text);
drop function if exists public.cashier_expected_cash(uuid, uuid, timestamptz);

-- Keep public.cashier_shifts and its existing rows for historical preservation.
-- The table already has RLS enabled and all direct privileges revoked by migration 010.

commit;
