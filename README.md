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
- Fondasi: skema database lengkap (`server/src/schema.sql`), login JWT, peran admin/kepsek/guru, profil sekolah, manajemen pengguna.
- **Fase 1 (absensi guru) selesai:** check-in/out via GPS (geofence) atau QR dinamis (berganti tiap menit), 1 perangkat per guru (admin bisa reset), antrean offline + sinkron (maks 24 jam, ditandai `late_synced`), izin/sakit/cuti/dinas dengan persetujuan (mengisi absensi hari kerja, melewati akhir pekan & hari libur), dasbor kepala sekolah, rekap bulanan + ekspor Excel.
- Catatan: absen selfie, deteksi lokasi palsu di level OS (butuh APK), dan scan QR via kamera belum ada; kode QR saat ini diketik/ditempel.
- Berikutnya: Fase 2 (bank soal, ujian, dasbor real-time, koreksi -> rapor, cetak Word).

Server juga menyajikan hasil `npm run build` klien (satu proses untuk produksi). Zona waktu: `SCHOOL_TZ` (default Asia/Jakarta).
