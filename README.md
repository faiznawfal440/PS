# PS Supabase PS Manager — RentalPS Manager

React 19 + TypeScript + Vite dashboard, Supabase Auth/Postgres/RLS/Realtime and Vercel production deployment.

## Local development

```bash
npm install
cp .env.example .env.local
npm run dev
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from Supabase Project Settings → API. The publishable/anon key is intended for browser use under correctly configured RLS. Never expose the Supabase secret/service-role key with a `VITE_` prefix.

## Database setup

Apply migrations in numeric order:

1. `supabase/migrations/202610130001_initial_rentalps.sql`
2. `supabase/migrations/202610130002_management.sql`
3. `supabase/migrations/202610130003_operational_hardening.sql`
4. `supabase/migrations/202610130004_permissions_and_fnb_seed.sql`
5. `supabase/migrations/202610130005_fix_rental_payment_settlement.sql`
6. `supabase/migrations/202610130006_database_hardening_idempotency.sql`

Migrations are made repeatable where practical: tables/indexes use `IF NOT EXISTS`, functions use `CREATE OR REPLACE`, policy creation is guarded by `DROP POLICY IF EXISTS`, triggers are recreated in a controlled way, constraints check for duplicates, and catalogue seeds use `ON CONFLICT`. Always apply migrations in numeric order. Do not run an older migration after a newer one, because older function/policy definitions can replace newer hardening. `IF NOT EXISTS` also does not repair missing columns or incompatible types in an existing table.

Migration 005 fixes payment settlement. Migration 006 fixes open-billing calculation when a session is paused, ensures reservations can only reference a unit in the same business, and restricts execution of membership helper functions.

**For an existing Supabase database:** check migration history first. If migrations 001–004 are already applied and recorded, apply only pending migrations (005 then 006) through the matching migration workflow. If the schema was created manually in SQL Editor and the migration history is not recorded, do not blindly run every file or use `db push`; reconcile the existing schema/history first. Back up the database before production changes.

For invitation/password recovery emails, set Supabase Authentication → URL Configuration:
- Site URL: `https://ps-nawfal5.vercel.app`
- Redirect URL allowlist: `https://ps-nawfal5.vercel.app/**`

The Edge Function `invite-member` must be deployed with JWT verification enabled. It uses the server-only service role key inside the Edge Function; never put that secret into frontend env variables.

## Implemented modules

- Role-aware navigation (owner/admin/operator), Supabase email/password login, invitation acceptance password setup and password recovery.
- Live rental dashboard, start/extend/pause/resume/end session, receipt/thermal print and session history with settlement of outstanding balances.
- Unit/rate CRUD, user invitation and role status through the Edge Function.
- Reports filtered to a selected period, CSV, Excel-compatible SpreadsheetML (.xls) and PDF exports. Revenue is based on recorded payments rather than just session invoice total.
- F&B product catalogue, stock-tracked orders, payment/partial payment and cancellation via audited RPC.
- Reservations with customer details and time-overlap protection for confirmed bookings.
- Audit trail and business settings.

## Quality checks

```bash
npm run typecheck
npm test
npm run build
npm audit
```

Billing helpers have 9 automated tests covering exact payment, change, partial settlement, overtime grace/rounding and open billing. Database migration tests add static regression checks for guarded DDL, paused open billing, and tenant-safe reservation policies; they do not execute SQL against PostgreSQL. An actual end-to-end flow still requires logging in with a real owner account and verifying invitation email delivery and printer hardware.

Until the UI includes a business switcher, an account with multiple active business memberships uses the oldest active membership as its deterministic business context. Dashboard/rate queries are scoped to that context instead of mixing records from multiple businesses.

## Known limitations

- Excel export uses Excel-compatible SpreadsheetML with an `.xls` extension to avoid the unpatched npm `xlsx` package advisories.
- QRIS is recorded as a payment method; automatic QRIS gateway/payment verification is not integrated.
- Full transaction E2E tests with a real authenticated account and physical thermal printer still need to be performed.
