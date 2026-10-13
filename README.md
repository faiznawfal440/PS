# PS Supabase PS Manager — RentalPS Manager

React + TypeScript + Vite frontend berdasar desain Figma Make, dengan Supabase Auth, PostgreSQL, RLS, RPC untuk sesi, dan Realtime.

## Menjalankan

```bash
npm install
cp .env.example .env.local
npm run dev
```

Isi `.env.local` dari Supabase Project Settings → API:

```dotenv
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable-or-anon-key>
```

Jangan pernah menaruh service-role key ke frontend.

## Database

Jalankan `supabase/migrations/202610130001_initial_rentalps.sql` lewat Supabase SQL Editor/CLI, lalu buat user melalui Authentication → Users dan bootstrap usaha serta membership owner sekali lewat SQL Editor:

```sql
with b as (
 insert into public.businesses(name,created_by) values ('RentalPS Anda','USER_UUID') returning id
)
insert into public.business_members(business_id,user_id,role) select id,'USER_UUID','owner' from b;
```

Ganti `USER_UUID` dengan UUID user. Setelah itu tambah data awal pada tabel `units` dan `rate_plans` dengan `business_id` yang sama. RLS mengisolasi setiap bisnis; gunakan akun pemilik/admin untuk mengubah unit dan tarif.

## MVP yang tersedia

- Dashboard grid unit, countdown lokal per detik, mode demo bila Supabase belum dikonfigurasi.
- Mulai sesi, tambah waktu, jeda, lanjutkan, akhiri dan catat pembayaran ketika Supabase tersambung.
- Snapshot tarif, status pembayaran, log peristiwa/audit, pencegahan sesi ganda aktif lewat unique partial index.
- Riwayat, laporan lanjutan, CRUD pengguna/tarif penuh, ekspor PDF/XLSX, F&B, reservasi, dan gateway QRIS masih backlog.

Akun Supabase dan proyek database tidak dibuat oleh repo ini. Konfigurasikan proyek dan migrasi terlebih dahulu untuk menggunakan backend.
