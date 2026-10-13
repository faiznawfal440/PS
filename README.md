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
7. `supabase/migrations/202610130007_rls_policy_cleanup.sql`
8. `supabase/migrations/202610140008_fnb_session_link_unified_checkout.sql`

Migrations are made repeatable where practical: tables/indexes use `IF NOT EXISTS`, functions use `CREATE OR REPLACE`, policy creation is guarded by `DROP POLICY IF EXISTS`, triggers are recreated in a controlled way, constraints check for duplicates, and catalogue seeds use `ON CONFLICT`. Always apply migrations in numeric order. Do not run an older migration after a newer one, because older function/policy definitions can replace newer hardening. `IF NOT EXISTS` also does not repair missing columns or incompatible types in an existing table.

Migration 005 fixes payment settlement. Migration 006 fixes open-billing calculation when a session is paused, ensures reservations can only reference a unit in the same business, removes anonymous execution on privileged RPCs, and adds indexes for previously unindexed foreign keys. Migration 007 removes redundant permissive RLS policies and moves `btree_gist` out of the exposed `public` schema. Migration 008 links new F&B orders to an active rental session when the operator selects that unit, backfills only unambiguous historical links, enables Realtime for F&B orders/payments/products, and settles linked rental+F&B balances at one checkout.

**For an existing Supabase database:** check migration history first and apply only pending migrations. The connected PS project was inspected during this task: the initial schema is present, but its original baseline migration is not separately recorded in migration history; migrations for management, operational hardening, permissions/F&B seed, and payment settlement were recorded. Migrations 006 and 007 were applied to that project and their database effects were verified. Do not run baseline migration 001 or all SQL files from the beginning against that existing project. For another project, reconcile its actual schema/history first and take a backup before production changes.

For invitation/password recovery emails, set Supabase Authentication → URL Configuration:
- Site URL: `https://ps-nawfal5.vercel.app`
- Redirect URL allowlist: `https://ps-nawfal5.vercel.app/**`

The Edge Function `invite-member` must be deployed with JWT verification enabled. It uses the server-only service role key inside the Edge Function; never put that secret into frontend env variables.

## Implemented modules

- Role-aware navigation (owner/admin/operator), Supabase email/password login, invitation acceptance password setup and password recovery.
- Live rental dashboard, start/extend/pause/resume/end session, receipt/thermal print and session history with settlement of outstanding balances.
- Unit/rate CRUD, user invitation and role status through the Edge Function.
- Reports filtered to a selected period, CSV, Excel-compatible SpreadsheetML (.xls) and PDF exports. Revenue is based on recorded payments rather than just session invoice total.
- F&B product catalogue, stock-tracked orders, payment/partial payment and cancellation via audited RPC; when a unit has an active rental, new F&B orders are linked to that session automatically.
- One rental checkout can settle the rental and linked unpaid F&B orders, and the combined receipt includes rental, item-level F&B lines, payment totals, outstanding balance, and the business receipt settings.
- Business-scoped Realtime subscriptions cover rental sessions/payments and F&B orders/payments/products. Settings tabs for payment methods, receipt paper width, receipt header/footer, and light/dark appearance are interactive and persisted in business settings.
- Reservations with customer details and time-overlap protection for confirmed bookings.
- Audit trail and business settings.

## Quality checks

```bash
npm run typecheck
npm test
npm run build
npm audit
```

Billing helpers have 9 automated tests covering exact payment, change, partial settlement, overtime grace/rounding and open billing. Database migration tests add static regression checks for guarded DDL, paused open billing, tenant-safe reservation policies, F&B/session linkage, unified checkout, Realtime publication, and settings controls; they do not execute SQL against PostgreSQL. An actual end-to-end flow still requires logging in with a real owner account and verifying invitation email delivery and printer hardware.

Until the UI includes a business switcher, an account with multiple active business memberships uses the oldest active membership as its deterministic business context. Dashboard/rate queries and realtime subscriptions are scoped to that context instead of mixing records or change notifications from multiple businesses.

## Known limitations

- Excel export uses Excel-compatible SpreadsheetML with an `.xls` extension to avoid the unpatched npm `xlsx` package advisories.
- QRIS is recorded as a payment method; automatic QRIS gateway/payment verification is not integrated.
- Full transaction E2E tests with a real authenticated account and physical thermal printer still need to be performed.
