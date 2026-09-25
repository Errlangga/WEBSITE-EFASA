# WEBSITE-EFASA — EFASA TEKNIK

Website jasa service AC EFASA TEKNIK dengan landing page modern, katalog stok AC, dokumentasi pekerjaan, admin dashboard, PostgreSQL Neon untuk production, dan Vercel Blob untuk logo/foto/video.

## Jalankan lokal tanpa XAMPP

Prasyarat: Node.js 22+.

PowerShell Windows yang memblokir npm.ps1 bisa langsung memakai:

~~~powershell
npm.cmd install
npm.cmd start
~~~

Buka:
- Website: http://localhost:3000
- Admin setup: http://localhost:3000/admin/setup
- Admin login: http://localhost:3000/admin/login
- Health: http://localhost:3000/api/health

Mode lokal default tidak membutuhkan database cloud. Data memakai data/db.json dan file upload memakai public/uploads.

## Deploy ke Vercel

Production project ini memakai:
- Vercel Functions / Express untuk API dan website.
- Neon Postgres untuk settings, akun admin, dokumentasi, dan stok.
- Vercel Blob untuk logo, foto, dan video.

Langkah:
1. Import repository Errlangga/WEBSITE-EFASA ke Vercel.
2. Gunakan Node.js 24.x.
3. Tambahkan Neon Postgres dari Storage/Marketplace lalu connect ke project.
4. Tambahkan Vercel Blob dari Storage/Marketplace.
5. Buat Environment Variable SESSION_SECRET dengan random string panjang.
6. Redeploy.
7. Buka /admin/setup dan buat akun admin pertama.

Tabel database dibuat otomatis saat API pertama kali dipanggil.

Untuk upload media di Vercel, dashboard admin memakai direct client upload ke Vercel Blob sehingga foto/video besar tidak perlu lewat payload Function.

## Fitur admin

- Upload logo.
- Ubah brand, tagline, hero, WhatsApp, Gmail/email, Instagram, alamat, area layanan, dan jam.
- Upload dokumentasi pekerjaan foto/video dengan lokasi, service, dan deskripsi.
- Upload stok AC foto/video dengan nama, brand, kapasitas, harga, dan deskripsi.
- Hapus dokumentasi dan stok.
- Login admin dengan password hash dan session cookie.
- CSRF protection untuk perubahan data.

## Copy EFASA TEKNIK saat ini

Hero:
Layanan Teknik Pendingin Ruangan

Subteks:
Melayani AC rumahan, perkantoran, dan industrial.

Jam:
08.00 - 17.00

Heading layanan:
Layanan yang kami tawarkan

Layanan:
1. Perawatan AC
2. Perbaikan AC
3. Pasang Baru & Reposisi
4. Isi Freon — AC single split, AHU (Air Handling Unit), chiller, dan VRF system

Dokumentasi:
Dokumentasi pekerjaan kita

CTA:
Apakah AC Anda perlu diservis hari ini?

## Repository

https://github.com/Errlangga/WEBSITE-EFASA
