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

Migrations dibuat repeatable sebisa mungkin: tabel/indeks menggunakan `IF NOT EXISTS`, fungsi menggunakan `CREATE OR REPLACE`, pembuatan policy dilindungi `DROP POLICY IF EXISTS`, trigger dibuat ulang secara terkontrol, constraint memeriksa duplikasi, dan seed katalog memakai `ON CONFLICT`. Tetap jalankan dalam urutan angka. Jangan menjalankan satu migration lama setelah migration yang lebih baru karena definisi fungsi/policy lama dapat mengganti hardening yang baru. `IF NOT EXISTS` juga tidak otomatis memperbaiki kolom atau tipe data yang berbeda pada tabel yang sudah telanjur ada.

Migration 005 memperbaiki settlement pembayaran. Migration 006 memperbaiki perhitungan open billing ketika sesi dijeda, memastikan reservasi hanya mengacu ke unit dari bisnis yang sama, dan membatasi akses fungsi helper membership.

**Untuk database Supabase yang sudah dipakai:** cek riwayat migration terlebih dahulu. Jika 001–004 memang sudah diterapkan dan tercatat, terapkan hanya migration yang masih pending (005 lalu 006) melalui alur migration yang sesuai. Jika skema awal pernah dibuat manual lewat SQL Editor dan riwayat migration tidak tercatat, jangan langsung menjalankan seluruh file dari awal atau melakukan `db push`; cocokkan skema/riwayat dahulu. Backup database sebelum perubahan produksi disarankan.

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

Billing helpers have 9 automated tests covering exact payment, change, partial settlement, overtime grace/rounding and open billing. An actual end-to-end flow still requires logging in with a real owner account and verifying invitation email delivery and printer hardware.

## Known limitations

- Excel export uses Excel-compatible SpreadsheetML with an `.xls` extension to avoid the unpatched npm `xlsx` package advisories.
- QRIS is recorded as a payment method; automatic QRIS gateway/payment verification is not integrated.
- Full transaction E2E tests with a real authenticated account and physical thermal printer still need to be performed.
