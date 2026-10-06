# Panduan Memasang Online (agar guru bisa buka dari HP)

Kamera (selfie wajah) dan lokasi (GPS) di HP **hanya diizinkan lewat HTTPS**. Mengakses `http://192.168.x.x:3000` lewat Wi-Fi sekolah cukup untuk membuka halaman, tetapi absen akan ditolak browser. Jadi aplikasi perlu dilayani lewat alamat **https://**.

## Pilih cara
| Cara | Cocok untuk | Catatan |
|---|---|---|
| **A. VPS + domain + Caddy** (disarankan) | Sekolah yang mau alamat tetap, mis. `absen.sekolahanda.sch.id` | Sertifikat HTTPS otomatis dan gratis (Let's Encrypt) |
| **B. Cloudflare Tunnel dari PC/server sekolah** | Tidak mau menyewa VPS, PC sekolah menyala terus | Gratis; butuh akun Cloudflare dan domain di Cloudflare |
| **C. Hosting bersama (cPanel)** | — | Umumnya **tidak cocok**: butuh Node.js ≥ 22.13 yang berjalan terus. Tanyakan penyedia; VPS adalah pilihan yang pasti bisa |

Kebutuhan server: Linux (Ubuntu 22.04/24.04), RAM ≥ 1 GB, Node.js ≥ 22.13, disk ≥ 5 GB (foto absen bertambah ±60 KB per absen).

## A. VPS + Caddy (langkah demi langkah)

### 1. Arahkan domain
Buat **A record** `absen.sekolahanda.sch.id` → alamat IP VPS (di panel domain).

### 2. Pasang Node 22 dan alat dasar
```bash
sudo apt update && sudo apt install -y git curl ufw
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # harus v22.13 atau lebih baru
```

### 3. Ambil dan bangun aplikasi
```bash
sudo useradd -m -s /bin/bash absen
sudo -iu absen
git clone https://github.com/saifularif00328-cmd/Absensigurupro.git app
cd app
git checkout claude/practical-turing-lbp70b      # atau cabang utama setelah digabung
npm ci
npm run build
```

### 4. Rahasia dan pengaturan
Buat berkas `/home/absen/app.env` (jangan dimasukkan ke git):
```
NODE_ENV=production
PORT=3000
JWT_SECRET=ganti-dengan-teks-acak-panjang        # buat: openssl rand -hex 32
TRUST_PROXY=1                                    # karena di belakang Caddy
SCHOOL_TZ=Asia/Jakarta                           # WIB; WITA: Asia/Makassar, WIT: Asia/Jayapura
DB_FILE=/home/absen/data/data.db
SELFIE_DIR=/home/absen/data/selfies
```
```bash
chmod 600 /home/absen/app.env
mkdir -p /home/absen/data
set -a; . /home/absen/app.env; set +a
ADMIN_PASSWORD='password-awal-sementara' npm run seed -w server   # membuat akun admin (wajib ganti saat login pertama)
```

### 5. Jalankan sebagai layanan (systemd)
Sebagai root, buat `/etc/systemd/system/absen.service`:
```ini
[Unit]
Description=Absensi Guru Pro
After=network.target

[Service]
User=absen
WorkingDirectory=/home/absen/app
EnvironmentFile=/home/absen/app.env
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning server/src/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload && sudo systemctl enable --now absen
sudo systemctl status absen        # harus active (running)
curl -s localhost:3000/api/health  # {"ok":true}
```

### 6. HTTPS otomatis dengan Caddy
```bash
sudo apt install -y caddy
sudo tee /etc/caddy/Caddyfile >/dev/null <<'CFG'
absen.sekolahanda.sch.id {
    encode gzip
    reverse_proxy localhost:3000
}
CFG
sudo systemctl reload caddy
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable
```
Buka `https://absen.sekolahanda.sch.id` — gembok harus muncul. Selesai: bagikan alamat itu ke guru.

## B. Cloudflare Tunnel (tanpa VPS)
1. Pasang aplikasi di PC sekolah seperti langkah 2–5 di atas (Windows: cukup `npm ci`, `npm run build`, `npm start`).
2. Di dashboard Cloudflare → *Zero Trust → Networks → Tunnels* → buat tunnel, pasang `cloudflared` di PC itu, dan arahkan hostname (mis. `absen.sekolahanda.sch.id`) ke `http://localhost:3000`.
3. Atur `TRUST_PROXY=1` pada lingkungan aplikasi. HTTPS ditangani Cloudflare.
4. PC harus menyala dan terhubung internet selama jam absen.

## Pencadangan (penting)
Yang perlu dicadangkan: **database** dan **folder foto**.
```bash
# harian lewat cron (sebagai user absen): crontab -e
0 2 * * * sqlite3 /home/absen/data/data.db ".backup '/home/absen/backup/data-$(date +\%F).db'" && tar czf /home/absen/backup/selfies-$(date +\%F).tgz -C /home/absen/data selfies
```
(Pasang `sqlite3` dengan `sudo apt install sqlite3`. Salin folder `backup` secara berkala ke tempat lain, mis. Google Drive/HDD.)

## Memperbarui aplikasi
```bash
sudo -iu absen
cd app && git pull && npm ci && npm run build
exit
sudo systemctl restart absen
```
Migrasi database berjalan otomatis saat server mulai.

## Daftar periksa keamanan
- [ ] `JWT_SECRET` diisi acak panjang dan berkas `app.env` ber-`chmod 600`.
- [ ] Hanya HTTPS yang dibuka ke publik (port 80/443); port 3000 tidak dibuka di firewall.
- [ ] Password admin sudah diganti; akun guru yang berhenti dinonaktifkan.
- [ ] Cadangan harian berjalan dan pernah diuji dipulihkan.
- [ ] Sistem operasi diperbarui berkala (`sudo apt upgrade`).
- [ ] Guru diberi tahu bahwa foto absen disimpan di server sekolah sesuai kebijakan sekolah (data pribadi).
