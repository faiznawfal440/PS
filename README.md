# 🎮 RentalPS Manager

<p align="center">
  <strong>Dashboard operasional rental PlayStation — dari sesi bermain hingga laporan kas.</strong><br />
  Kelola unit, pelanggan, transaksi, F&amp;B, reservasi, dan laporan dalam satu aplikasi.
</p>

<p align="center">
  <img alt="React" src="https://img.shields.io/badge/React-19-149eca?logo=react&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white" />
  <img alt="Vite" src="https://img.shields.io/badge/Vite-8-646cff?logo=vite&logoColor=white" />
  <img alt="Supabase" src="https://img.shields.io/badge/Supabase-Auth%20%7C%20Postgres%20%7C%20Realtime-3fcf8e?logo=supabase&logoColor=white" />
</p>

---

## ✨ Tentang aplikasi

**RentalPS Manager** adalah dashboard untuk membantu operasional rental PlayStation sehari-hari. Aplikasi menyediakan pemantauan status unit, pengelolaan sesi dan tarif, pencatatan pembayaran, penjualan makanan dan minuman (F&B), reservasi, rekonsiliasi kasir, serta ekspor laporan.

Aplikasi dapat dijalankan dalam **mode demo** atau dihubungkan ke **Supabase** untuk autentikasi dan data operasional bersama.

## 🚀 Fitur utama

### 🕹️ Operasional rental
- Dashboard status unit dengan pembaruan real-time melalui Supabase Realtime.
- Mulai, perpanjang, jeda, lanjutkan, dan akhiri sesi rental.
- Mendukung tarif paket, per jam, dan *open billing*.
- Penanganan waktu overtime, toleransi, dan pembulatan sesuai aturan tarif.
- Pengelolaan unit, tipe konsol, ruangan, harga dasar, dan status maintenance.
- Riwayat sesi, detail pembayaran, saldo terutang, dan cetak struk.

### 🧾 Checkout dan pembayaran terpadu
- Pratinjau total checkout dihitung di database sebelum transaksi diselesaikan.
- Satu checkout dapat mencakup biaya rental dan pesanan F&B yang terhubung ke sesi.
- Rincian invoice menampilkan item, total pembayaran, kembalian, dan saldo yang masih terutang.
- Mendukung metode tunai, transfer, QRIS sebagai metode pencatatan, dan metode lain.
- Pembayaran sebagian dan pelunasan saldo setelah checkout didukung.
- Kunci idempotensi pada operasi pembayaran membantu mencegah transaksi atau catatan pembayaran ganda saat permintaan dicoba ulang.

### 🍟 Modul F&B
- Katalog produk dengan pengelolaan stok.
- Buat pesanan, catat pembayaran penuh atau sebagian, dan batalkan pesanan melalui operasi database yang diaudit.
- Pesanan F&B baru dapat otomatis ditautkan ke sesi rental aktif untuk unit yang dipilih.
- Pesanan yang terhubung ikut diperhitungkan dalam checkout dan struk rental.
- Pesanan F&B mandiri tetap masuk laporan tanpa menghitung pesanan tertaut dua kali.

### 📅 Reservasi dan pelanggan
- Catat reservasi beserta informasi pelanggan dan waktu.
- Perlindungan bentrok waktu untuk reservasi yang dikonfirmasi.
- Tampilan riwayat membantu meninjau sesi aktif, selesai, dijeda, overtime, atau dibatalkan.

### 📊 Laporan dan pengaturan usaha
- Laporan dapat difilter berdasarkan periode.
- Ekspor laporan ke **CSV**, **Excel-compatible SpreadsheetML (.xls)**, dan **PDF**.
- Pelaporan membedakan nilai tagihan, pembayaran yang diterima, dan piutang.
- Log audit untuk membantu menelusuri aktivitas operasional penting.
- Pengaturan metode pembayaran, lebar kertas struk, header/footer struk, serta tema terang/gelap.

### 🔐 Pengguna dan keamanan
- Login email/password, alur penerimaan undangan, pengaturan kata sandi, dan pemulihan kata sandi.
- Navigasi berdasarkan peran: **Pemilik**, **Admin**, dan **Operator**.
- Pengundangan anggota dilakukan melalui Supabase Edge Function.
- Data operasional dibatasi berdasarkan usaha melalui konteks bisnis, kebijakan Row Level Security (RLS), dan pemeriksaan akses pada operasi database.
- Langganan real-time difilter ke konteks usaha yang aktif.

## 🧰 Teknologi

| Area | Teknologi |
| --- | --- |
| Frontend | React 19, TypeScript, Vite |
| Backend dan database | Supabase Postgres, Auth, RLS, Realtime, Edge Functions |
| Pengujian | Vitest, TypeScript typecheck, Playwright |
| Ekspor laporan | CSV, SpreadsheetML kompatibel Excel, PDF melalui jsPDF |
| Deployment | Vercel |

## ⚡ Menjalankan secara lokal

**Prasyarat:** Node.js `>=22.12.0` dan npm.

1. Clone repositori dan masuk ke direktori proyek:

   ```bash
   git clone https://github.com/faiznawfal440/PS.git
   cd PS
   ```

2. Instal dependensi dan buat berkas environment lokal:

   ```bash
   npm install
   cp .env.example .env.local
   ```

3. Isi `.env.local` dengan URL dan publishable/anon key dari **Supabase → Project Settings → API**:

   ```dotenv
   VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
   VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY
   ```

4. Jalankan server pengembangan:

   ```bash
   npm run dev
   ```

Jika konfigurasi Supabase belum tersedia, aplikasi menggunakan data demo untuk membantu meninjau UI. Data demo tidak menggantikan penyimpanan database bersama.

> **Keamanan:** hanya gunakan publishable/anon key yang memang ditujukan untuk frontend. Jangan pernah menambahkan Supabase service-role/secret key ke variabel yang diawali `VITE_` atau ke kode browser.

## 🗄️ Menyiapkan database Supabase

Jalankan migrasi dalam urutan berikut pada proyek database baru setelah memeriksa skema target:

1. `supabase/migrations/202610130001_initial_rentalps.sql`
2. `supabase/migrations/202610130002_management.sql`
3. `supabase/migrations/202610130003_operational_hardening.sql`
4. `supabase/migrations/202610130004_permissions_and_fnb_seed.sql`
5. `supabase/migrations/202610130005_fix_rental_payment_settlement.sql`
6. `supabase/migrations/202610130006_database_hardening_idempotency.sql`
7. `supabase/migrations/202610130007_rls_policy_cleanup.sql`
8. `supabase/migrations/202610140008_fnb_session_link_unified_checkout.sql`
9. `supabase/migrations/202610140009_checkout_integrity_and_idempotency.sql`
10. `supabase/migrations/202610140010_cashier_shift_reconciliation.sql` (migrasi historis)
11. `supabase/migrations/202610140011_remove_cashier_shift_feature.sql`

Migrasi 008 menambahkan pengaitan F&B dengan sesi dan checkout gabungan; migrasi 009 memperkuat pratinjau checkout, penyelesaian saldo, dan idempotensi pembayaran. Migrasi 010 dipertahankan sebagai bagian dari riwayat versi database; migrasi 011 menonaktifkan RPC dan akses fitur shift kasir tanpa menghapus tabel maupun data historis yang sudah ada.

**Untuk database yang sudah berjalan:** periksa skema dan riwayat migrasi terlebih dahulu, lalu terapkan hanya migrasi yang belum dijalankan. Jangan mengulang migrasi baseline pada database berisi data tanpa memastikan dampaknya. Buat backup sebelum perubahan pada lingkungan produksi dan verifikasi hasil migrasi sesudahnya.

Untuk email undangan dan pemulihan kata sandi, atur **Supabase Authentication → URL Configuration**. Sesuaikan Site URL dan Redirect URL allowlist dengan domain deployment yang digunakan. Edge Function `invite-member` memerlukan konfigurasi dan secret sisi server; jangan letakkan service-role key pada environment frontend.

## ✅ Pemeriksaan kualitas

Jalankan perintah berikut sebelum mengirim perubahan:

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
npm audit
```

Tes unit/regresi yang tersedia mencakup helper penagihan, perhitungan pembayaran, perubahan, idempotensi, aturan database penting, serta beberapa kontrol pengaturan. Tes statis migrasi **tidak** menjalankan SQL terhadap PostgreSQL. Uji alur nyata dengan akun yang terautentikasi tetap diperlukan untuk memvalidasi undangan email, transaksi end-to-end, dan printer struk fisik.

## ℹ️ Catatan dan batasan

- Ekspor `.xls` menggunakan SpreadsheetML yang kompatibel dengan Excel; proyek menghindari dependensi `xlsx` yang belum diperbarui.
- QRIS tersedia sebagai **metode pencatatan pembayaran**; integrasi gateway dan verifikasi pembayaran QRIS otomatis belum tersedia.
- Belum ada pemilih usaha (*business switcher*). Jika satu akun memiliki beberapa keanggotaan usaha aktif, aplikasi memilih keanggotaan aktif tertua sebagai konteks deterministik.
- Pengujian end-to-end transaksi pada akun nyata dan verifikasi printer thermal fisik masih perlu dilakukan.

---

<p align="center">
  Dibuat untuk membantu operasional rental PlayStation lebih rapi, transparan, dan mudah direkonsiliasi. 🎮
</p>
