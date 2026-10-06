# Absensi Guru Pro

Webapp sekolah: absensi **guru** dengan wajah + lokasi (izin, rekap Excel), impor guru/siswa dari Excel, bank soal & ujian online, nilai/rapor.

## Stack
Node/Express + SQLite (node:sqlite bawaan Node, tanpa kompilasi; butuh Node 22.13 atau lebih baru) di `server/`, React + Vite di `client/`.

## Menjalankan
```
npm install
npm run seed -w server     # buat sekolah & akun admin (admin / admin12345; wajib diganti saat login pertama)
npm run dev                # server :3000, klien :5173
npm test                   # tes server + klien
```
Untuk dipakai sungguhan (HTTPS, layanan, cadangan): lihat `docs/PANDUAN-HOSTING.md`.

## Dokumentasi
- [`docs/PANDUAN-ADMIN.md`](docs/PANDUAN-ADMIN.md) — urutan setup sampai guru bisa absen.
- [`docs/PANDUAN-APK.md`](docs/PANDUAN-APK.md) — aplikasi Android "Ujian Aman" (kiosk ujian, anti split-screen, deteksi lokasi palsu).
- [`docs/PANDUAN-HOSTING.md`](docs/PANDUAN-HOSTING.md) — memasang online dengan HTTPS (wajib untuk kamera & GPS di HP).

## Status
- **Akun & akses:** login JWT; peran admin/kepsek/guru. Akun baru/hasil reset **wajib ganti password** saat login pertama (server memblokir fitur lain sampai diganti). Pembatas login (5 gagal/15 menit per username+IP). Admin: reset password, reset perangkat, reset wajah, nonaktifkan.
- **Impor Excel (.xlsx):** guru (password awal acak + lembar kredensial yang bisa dicetak/diunduh) dan siswa; template dapat diunduh; error dilaporkan per baris.
- **Absensi guru dengan wajah:** guru mendaftarkan wajah sekali (3 foto, konsisten), lalu tiap absen = lokasi di area sekolah + selfie dengan **tantangan kedip/menoleh** + pencocokan wajah otomatis. Foto dan jarak kecocokan disimpan; hasil meragukan ditandai. Batas kecocokan diatur admin (bawaan 0,55). Offline: absen disimpan di HP lalu disinkron (maks. 24 jam), keputusan wajah tetap di server. QR sudah dihapus.
- **Ujian:** bank soal manual, ujian bertoken dengan anti-curang web, dasbor real-time (SSE), koreksi otomatis + uraian manual, nilai otomatis ke rapor, cetak soal ke Word, rapor/ekspor Excel.
- **Aplikasi Android "Ujian Aman" (Fase 3):** WebView terkunci ke server sekolah, penyematan layar saat ujian, anti split-screen/screenshot, pelanggaran native dicatat, lokasi dengan deteksi *mock provider*. APK dibangun oleh GitHub Actions (`android/`). Belum diuji di perangkat fisik — lihat daftar periksa di `docs/PANDUAN-APK.md`.
- **Tampilan "Aurora Glass":** gelap, kartu kaca, tombol 3D, dock menu di HP; font/ikon dibundel (jalan tanpa internet); lolos pemeriksaan aksesibilitas otomatis (axe, WCAG A/AA).

### Batasan jujur
- Pencocokan wajah memakai `@vladmandic/face-api` (deskriptor 128-d) yang berjalan **di HP guru**; server menilai jarak dari deskriptor yang dikirim klien dan menyimpan fotonya. Bukan biometrik tingkat bank: orang yang sangat mirip dapat lolos pada batas longgar, dan klien yang dimodifikasi sengaja dapat memalsukan deskriptor. Pertahanan berlapis: lokasi + satu perangkat per guru + tantangan liveness + foto tersimpan + tanda untuk ditinjau.
- Browser biasa tidak bisa memblokir notifikasi/split-screen saat ujian siswa atau mendeteksi lokasi palsu; gunakan aplikasi Android (`docs/PANDUAN-APK.md`). Penyematan layar bisa dilepas pengguna tanpa Device Owner (dideteksi dan dicatat).
- Model wajah (±7 MB) diunduh sekali lalu di-cache; di-prefetch saat guru membuka halaman absensi agar bisa dipakai offline berikutnya.

## Variabel lingkungan
`JWT_SECRET` (wajib di production), `DB_FILE`, `SELFIE_DIR`, `APK_DIR` (lokasi `ujian-aman.apk`), `PORT`, `SCHOOL_TZ` (bawaan Asia/Jakarta), `TRUST_PROXY` (mis. `1` di belakang proxy), `ADMIN_PASSWORD` (saat seed).

## Berikutnya
Fase 4 (pembuat soal AI opsional, ekspor Google Form); kiosk penuh dengan Device Owner.
