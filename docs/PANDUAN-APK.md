# Aplikasi Android "Ujian Aman"

Aplikasi Android ringan (±1 MB, tanpa pustaka tambahan) yang membuka Absensi Guru Pro dalam WebView yang **dikunci ke server sekolah Anda**, dan menambah hal yang tidak bisa dilakukan browser:

| Kemampuan | Cara kerja | Hasil |
|---|---|---|
| **Tidak bisa keluar saat ujian** | Penyematan layar (`startLockTask`) + tombol Kembali dinonaktifkan | Home/Recent diblokir sistem selama ujian |
| **Anti split-screen** | `resizeableActivity=false` + deteksi `onMultiWindowModeChanged` | Layar terbagi ditolak; bila terjadi dicatat pelanggaran |
| **Notifikasi tidak masuk** | Penyematan layar menutup bilah status/notifikasi; opsional mode *Jangan Ganggu* | Siswa tidak melihat pesan masuk |
| **Anti tangkapan layar** | `FLAG_SECURE` selama ujian | Screenshot/rekam layar hitam |
| **Deteksi lokasi palsu** (absen guru) | Lokasi diambil native dan membawa penanda *mock provider* | Absen dengan lokasi palsu ditolak server |
| **Hanya server sekolah** | Navigasi ke alamat lain diblokir | Tidak bisa browsing ke web lain |
| **Kamera & lokasi** | Izin Android → WebView | Selfie wajah dan GPS jalan di aplikasi |

Semua pelanggaran (keluar aplikasi, split-screen, penyematan terlepas) dikirim ke halaman ujian dan **dihitung seperti pelanggaran web** (batas → ujian terkunci & dikumpulkan otomatis).

## Batasan yang jujur
- **Penyematan layar ≠ kiosk penuh.** Tanpa perangkat yang didaftarkan sebagai *Device Owner* (perangkat milik sekolah), siswa masih bisa **melepas penyematan** dengan gestur sistem (tahan tombol Kembali + Recent, atau geser ke atas & tahan). Aplikasi mendeteksinya dalam ±2 detik, **mencatat pelanggaran**, dan meminta menyematkan ulang. Kiosk penuh (tak bisa dilepas) butuh provisioning Device Owner — belum ada di versi ini.
- Deteksi lokasi palsu hanya menangkap *mock provider* standar Android; HP yang di-root/dimodifikasi bisa lolos.
- Penanda "Mode Aman" ke server berupa header yang **dapat ditiru** siapa pun yang tahu caranya. Ia mencegah pembukaan ujian lewat browser biasa secara tidak sengaja, bukan pertahanan terhadap peretas. Perlindungan utama tetap kiosk + pelanggaran tercatat.
- Hanya **Android 7.0 ke atas**. iPhone/iPad tidak didukung (gunakan Guided Access manual atau Safe Exam Browser).
- Unduhan file (Excel/Word) dari halaman admin tidak didukung di dalam aplikasi; gunakan browser biasa untuk tugas admin.
- Saya (pembuat kode) belum menguji aplikasi ini di perangkat fisik; yang sudah diuji: kode dikompilasi terhadap API Android 14, logika murni lolos tes JUnit, sisi web diuji dengan jembatan tiruan. **Lakukan uji perangkat nyata (daftar periksa di bawah) sebelum dipakai ujian sungguhan.**

## 1. Mendapatkan APK
**Cara termudah — GitHub Actions** (tanpa memasang apa pun):
1. Buka repositori di GitHub → tab **Actions** → alur **Android APK (Ujian Aman)**.
2. Buka *run* terbaru yang hijau (✓). Bila belum ada, klik **Run workflow**.
3. Di bagian bawah halaman *run*, unduh artefak **ujian-aman-apk** (berkas zip) lalu ekstrak → `app-release.apk`.

**Cara lain — Android Studio:** pasang Android Studio, buka folder `android/`, tunggu sinkronisasi Gradle, lalu *Build → Build Bundle(s)/APK(s) → Build APK(s)*.

> Penandatanganan: secara bawaan memakai keystore di repo (`android/app/sekolah-ujian.keystore`) **yang bukan rahasia** — hanya agar tanda tangan konsisten sehingga APK baru bisa memperbarui yang lama. Untuk tanda tangan milik sekolah sendiri, isi *secrets* GitHub `KEYSTORE_FILE`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD` (atau ubah `app/build.gradle`).

## 2. Membagikan ke HP guru/siswa
1. Salin `app-release.apk` ke server sebagai `server/downloads/ujian-aman.apk` (atau folder di `APK_DIR`).
2. Tombol **Unduh aplikasi Android** muncul otomatis di halaman login dan di layar masuk ujian (bila ujian mewajibkan aplikasi). Alamatnya: `https://alamat-server-anda/unduh/ujian-aman.apk`.
3. Di HP: izinkan *Pasang aplikasi dari sumber tidak dikenal* untuk browser yang dipakai mengunduh, lalu buka berkas APK.

## 3. Penyetelan pertama di tiap HP
1. Buka aplikasi **Ujian Aman** → isi **alamat server** (mis. `absen.sekolahanda.sch.id`) dan buat **PIN proktor** 4–8 angka → *Simpan dan buka*.
2. Izinkan **Kamera** dan **Lokasi** saat diminta.
3. **Aktifkan penyematan layar** di pengaturan HP (nama berbeda per merek): *Pengaturan → Keamanan (atau Layar Kunci/Keamanan tambahan) → Penyematan layar / Screen pinning → ON*. Saat ujian dimulai, sistem menampilkan konfirmasi sekali; siswa memilih **Mulai**.
4. (Opsional) Menu proktor → *Izinkan mode Jangan Ganggu* agar notifikasi juga diam.

## 4. Menu proktor
**Ketuk 7 kali** pojok kiri atas layar dalam 5 detik → masukkan PIN → pilihan: *Muat ulang halaman*, *Lepas mode ujian (keluar kiosk)*, *Pengaturan server/PIN*, *Jangan Ganggu*, *Tutup aplikasi*. PIN salah 5× dikunci 30 detik.

## 5. Menjalankan ujian dengan aplikasi
1. Guru membuat ujian dan mencentang **Wajib aplikasi Ujian Aman**.
2. Siswa membuka aplikasi → layar masuk ujian (atau menu `…/#/ujian`) → isi token, NIS, kode siswa → *Mulai*. Layar disematkan; kemajuan tampil real-time di dasbor guru.
3. Setelah *Kumpulkan* (atau ujian terkunci), penyematan dilepas otomatis.
Siswa yang membuka ujian ini lewat browser biasa ditolak dan diberi tautan unduh aplikasi.

## 6. Daftar periksa uji di perangkat nyata (lakukan sebelum ujian resmi)
- [ ] Pasang APK, penyetelan awal, halaman login muncul.
- [ ] Guru: daftar wajah → absen; kamera dan lokasi jalan.
- [ ] Aktifkan aplikasi lokasi palsu (Opsi Pengembang → *Pilih aplikasi lokasi palsu*) → absen **ditolak** "Lokasi palsu terdeteksi".
- [ ] Ujian wajib-aplikasi: mulai → layar tersemat; tombol Home/Recent tidak berfungsi.
- [ ] Lepas penyematan dengan gestur → dalam ±2 detik muncul peringatan dan pelanggaran tercatat di dasbor guru.
- [ ] Coba buka split-screen → ditolak/ tercatat.
- [ ] Tarik bilah notifikasi → tidak muncul; kirim WhatsApp ke HP → tidak terlihat.
- [ ] Screenshot saat ujian → hasil hitam/ditolak.
- [ ] Putus Wi-Fi saat ujian → jawaban tertunda lalu terkirim saat tersambung.
- [ ] Menu proktor (ketuk 7×) + PIN berfungsi; *Lepas mode ujian* melepas penyematan.

## 7. Untuk pengembang
- Kode: `android/` (Java, tanpa AndroidX). Logika murni yang diuji JUnit: `UrlGuard`, `PinHash`, `LocationJson` (`./gradlew testDebugUnitTest`).
- Jembatan web ↔ aplikasi: `window.UjianAman` (`enterExam`, `exitExam`, `requestLocation`) dan callback `window.__ujianAmanEvent(kind)` / `window.__ujianAmanLocation(id, data)`; sisi web di `client/src/safeMode.js`.
- CI: `.github/workflows/android.yml` (tes unit + `assembleRelease`, mengunggah APK sebagai artefak).
