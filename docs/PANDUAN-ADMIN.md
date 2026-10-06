# Panduan Admin — dari nol sampai guru bisa absen

Urutan di bawah dibuat agar tidak ada langkah yang terlewat. Semua dilakukan dari menu **Pengaturan** dan **Kelas & Siswa** setelah login sebagai admin.

## 1. Login pertama
- Login dengan `admin` dan password awal dari perintah `seed` (bawaan `admin12345`).
- Aplikasi **langsung meminta password baru** — isi password yang kuat dan simpan baik-baik.

## 2. Pengaturan sekolah (menu Pengaturan)
1. Isi **nama**, **alamat**, dan **baris kop** (untuk cetak soal & rapor).
2. Tekan **Gunakan lokasi saya sekarang** saat Anda berada di sekolah (HP/laptop dengan GPS). Atur **radius absen** (mis. 100–200 m).
3. Atur **jam masuk**, **jam pulang**, dan **toleransi terlambat**.
4. **Batas kecocokan wajah** (bawaan 0,55). Makin kecil makin ketat. Jika banyak guru yang sah ditolak (ruangan gelap, berkacamata), naikkan sedikit (maks. 0,65); jika khawatir ada yang titip absen, turunkan (min. 0,40).
5. **Tantangan kedip/menoleh** sebaiknya dibiarkan aktif (mencegah absen memakai foto).
6. Isi **semester berjalan** (mis. `2026/2027 Ganjil`) lalu **Simpan**.
7. Tambahkan **hari libur** yang berlaku.

## 3. Kelas, mapel, dan siswa (menu Kelas & Siswa)
1. Tambah **mata pelajaran** dan atur **bobot nilai** (harian/UTS/UAS, total 100%).
2. Di bagian **Impor siswa**: klik **Unduh template Excel**, isi (NIS, Nama, Kelas), lalu **Unggah file Excel**.
   - Kelas yang belum ada dibuat otomatis. Mengunggah ulang dengan NIS yang sama memperbarui data.
   - Tiap siswa mendapat **kode siswa** 6 karakter (dipakai untuk masuk ujian bersama token ujian).

## 4. Akun guru (menu Pengaturan → bagian Guru)
1. Klik **Unduh template Excel**, isi kolom **Nama** (wajib), **NIP**, **Username** (opsional), **Peran** (guru/kepsek, opsional), **Kelas Wali** (opsional).
2. **Unggah file Excel**. Aplikasi membuat akun dan menampilkan **password awal acak** satu kali.
3. Segera **Unduh Excel** atau **Cetak** lembar kredensial itu dan bagikan ke masing-masing guru (jangan lewat grup yang berisi banyak orang).
4. Username bawaan = NIP (atau dari nama bila NIP kosong).

## 5. Yang dilakukan guru
1. Buka alamat aplikasi, login dengan username dan password awal → **diminta mengganti password**.
2. Sekali saja: **Daftarkan wajah** (3 foto singkat, tempat terang, tanpa masker/topi).
3. Setiap hari: tekan **Check-in**, izinkan lokasi & kamera, ikuti tantangan (kedip/menoleh), selesai. Pulang: **Check-out**.
4. Tidak ada sinyal? Absen disimpan di HP dan dikirim otomatis saat online (maks. 24 jam). Wajah tetap diperiksa server saat sinkron.

## 6. Mengelola guru (menu Pengaturan → Guru)
| Kebutuhan | Tindakan |
|---|---|
| Guru lupa password | **Reset password** → berikan password baru yang tampil |
| Ganti HP | **Reset perangkat** |
| Wajah salah daftar / berubah banyak | **Foto wajah** untuk memeriksa, **Reset wajah** agar guru mendaftar ulang |
| Guru pindah/berhenti | **Nonaktifkan** (data absensi tetap tersimpan) |

## 7. Memantau (menu Dasbor)
- Ubin hadir/terlambat/izin/belum absen, daftar guru + **foto selfie**, label **cocok/ragu**, dan catatan ⚠ (lokasi/akurasi mencurigakan).
- Baris **ragu** atau bertanda ⚠ layak ditinjau: buka foto dan bandingkan dengan **Foto wajah** terdaftar.
- **Rekap bulanan** dapat diunduh sebagai Excel.

## Batasan yang perlu Anda ketahui
- Pencocokan wajah memakai model standar (bukan sistem biometrik tingkat bank). Orang yang sangat mirip **bisa** lolos pada batas yang longgar; karena itu foto setiap absen disimpan untuk ditinjau.
- Pencocokan dihitung di HP guru. Orang yang memodifikasi aplikasi di HP-nya secara sengaja dapat memalsukannya; kombinasi **lokasi + satu perangkat per guru + foto tersimpan** membuat hal itu mudah terlacak.
- Kamera dan lokasi di HP hanya jalan lewat **HTTPS** — lihat `PANDUAN-HOSTING.md`.
