# Absensi Guru Pro

Webapp sekolah: absensi **guru** (GPS/QR/selfie, izin, rekap) + bank soal & ujian + nilai/rapor.
Rencana lengkap: lihat riset di `docs/` (belum ada) atau diskusi proyek.

## Stack
Node/Express + SQLite (better-sqlite3) di `server/`, React + Vite di `client/`.

## Menjalankan
```
npm install
npm run seed -w server     # buat sekolah & akun admin (admin / admin12345, segera ganti)
npm run dev                # server :3000, klien :5173
npm test                   # tes server
```
Env: `JWT_SECRET` (wajib di production), `DB_FILE`, `PORT`, `ADMIN_PASSWORD`.

## Status
Fondasi: skema database lengkap (`server/src/schema.sql`), login JWT, peran admin/kepsek/guru, profil sekolah, manajemen pengguna.
Berikutnya: Fase 1 absensi guru.
