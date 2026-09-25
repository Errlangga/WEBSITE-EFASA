# SETUP VERCEL — EFASA TEKNIK

Panduan ini dibuat untuk penggunaan pertama kali.

## 1. Import repository

Di Vercel Dashboard pilih Add New Project, lalu Import Git Repository dan pilih:

Errlangga/WEBSITE-EFASA

Jangan ubah folder Root Directory.

Project ini sudah mempunyai vercel.json, jadi routing API/admin dan runtime Node disiapkan di repository.

## 2. Database Neon

Di halaman project Vercel, buka bagian Storage/Marketplace lalu tambahkan Neon.

Pilih Create New Neon Account bila belum punya akun Neon.

Setelah koneksi berhasil, pastikan Environment Variable DATABASE_URL tersedia pada project.

Project akan membuat tabel otomatis saat endpoint pertama kali digunakan.

Tabel yang dibuat:
- settings
- admins
- media_items

Tidak perlu membuat tabel manual.

## 3. Storage foto/video

Tambahkan Vercel Blob dari Storage/Marketplace.

Website menggunakan Blob untuk:
- logo
- dokumentasi foto/video
- katalog foto/video

Admin upload langsung ke Blob dari browser. Jadi file media besar tidak perlu dikirim sebagai body Function.

## 4. SESSION_SECRET

Di Project Settings → Environment Variables buat:

SESSION_SECRET

Isi dengan random string panjang.

Bisa dibuat dari terminal dengan:

~~~powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
~~~

Simpan nilainya dan jangan masukkan ke GitHub.

## 5. Deploy

Setelah Neon, Blob, dan SESSION_SECRET siap:

Deploy atau Redeploy project.

Tunggu sampai status deployment Ready.

## 6. Buat admin

Buka:

https://DOMAIN-KAMU.vercel.app/admin/setup

Buat username dan password admin.

Password minimal 10 karakter.

Setelah berhasil, buka:

https://DOMAIN-KAMU.vercel.app/admin/login

## 7. Isi data website

Dari Dashboard Admin:
1. Upload logo EFASA TEKNIK.
2. Isi WhatsApp dengan format nomor internasional, contoh 62812xxxxxxx.
3. Isi Gmail/email.
4. Pastikan area layanan dan jam 08.00 - 17.00 benar.
5. Upload dokumentasi pekerjaan.
6. Upload stok AC jika ada.
7. Hapus stok ketika sudah tidak tersedia.

## 8. Kondisi lokal vs Vercel

Lokal tanpa konfigurasi cloud:
- data/db.json
- public/uploads/

Vercel production:
- Neon Postgres
- Vercel Blob

Jadi data production tidak bergantung pada file lokal project.

## 9. Pengembangan dari VS Code

Untuk local development:

~~~powershell
npm.cmd install
npm.cmd start
~~~

Buka:

http://localhost:3000

Tidak perlu XAMPP.

