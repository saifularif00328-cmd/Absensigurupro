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
- **Penyempurnaan Fase 1:**
  - Selfie: opsional atau wajib (pengaturan sekolah), JPEG maks 300 KB, disimpan di `SELFIE_DIR` (default `server/selfies/`), hanya bisa dilihat pemilik/admin/kepsek. Ini bukti visual untuk ditinjau manusia, **bukan** pengenalan wajah/liveness.
  - Lokasi palsu: web tidak bisa mendeteksi mock location. Yang dilakukan: tolak akurasi GPS > 150 m, beri tanda ⚠ untuk akurasi tak wajar (<1 m) dan perpindahan >200 km/jam antar-absen. Deteksi sungguhan butuh APK (Fase 3, tanda `mock_location` sudah didukung server). Pertahanan utama: QR dinamis + selfie wajib.
  - Scan QR lewat kamera (BarcodeDetector, cadangan jsQR); input tempel tetap ada.
  - Layar Admin: pengaturan sekolah (lokasi, radius, jam, selfie), hari libur (tambah/hapus; dasbor tidak menuding guru "belum absen" saat libur/akhir pekan), daftar guru + reset perangkat.
  - Kamera butuh **HTTPS** (atau localhost) saat dipakai di server sungguhan.
- Berikutnya: Fase 2 (bank soal, ujian, dasbor real-time, koreksi -> rapor, cetak Word).

Server juga menyajikan hasil `npm run build` klien (satu proses untuk produksi). Zona waktu: `SCHOOL_TZ` (default Asia/Jakarta).
