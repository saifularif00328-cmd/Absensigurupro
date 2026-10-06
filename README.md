# Absensi Guru Pro

Webapp sekolah: absensi **guru** (GPS/QR/selfie, izin, rekap) + bank soal & ujian + nilai/rapor.
Rencana lengkap: lihat riset di `docs/` (belum ada) atau diskusi proyek.

## Stack
Node/Express + SQLite (node:sqlite bawaan Node, tanpa kompilasi; butuh Node 22.13 atau lebih baru) di `server/`, React + Vite di `client/`.

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
- **Fase 2 (ujian) selesai:**
  - Admin: kelas, mapel, bobot nilai (harian/UTS/UAS), impor siswa dari teks CSV/Excel (NIS,Nama,Kelas) dengan kode siswa otomatis.
  - Guru: bank soal manual (pilihan ganda, benar/salah, isian singkat, uraian), buat ujian (jadwal, durasi, acak soal/pilihan, batas pelanggaran), token ujian.
  - Siswa: buka `/#/ujian`, masuk dengan token + NIS + kode siswa. Satu soal per layar, jawaban tersimpan otomatis, timer dari jam server, satu sesi aktif per siswa.
  - Anti-curang level web: layar penuh, deteksi pindah tab/aplikasi/split screen/keluar layar penuh, salin-tempel dan klik kanan diblokir, kunci + kumpul otomatis bila melewati batas pelanggaran. Web **tidak bisa memblokir** notifikasi/split screen; itu butuh APK kiosk (Fase 3). Opsi "Wajib aplikasi Ujian Aman" sudah ada di server (header `X-Safe-Mode: 1`) menunggu APK.
  - Dasbor guru real-time (SSE): siapa mengerjakan, progres, pelanggaran, nilai. PG/BS/isian dikoreksi otomatis; uraian lewat antrean koreksi; nilai terbit ke rapor begitu semua uraian selesai dikoreksi.
  - Nilai & rapor: rata-rata per jenis x bobot mapel (bobot jenis yang belum ada dibagi ulang), rekap S/I/A oleh admin/wali kelas, cetak rapor, ekspor Excel.
  - Cetak soal ke Word (.docx): kop sekolah, isian nama/absen/tanggal, paket A/B, 1-2 kolom, kunci jawaban, satu naskah per siswa.
- Semester berjalan diatur di Pengaturan sekolah (kolom `current_term`; kosong = dihitung dari tanggal).
- Berikutnya: Fase 3 (APK kiosk: anti split-screen, blokir notifikasi, deteksi mock location), Fase 4 (pembuat soal AI opsional, ekspor Google Form).
