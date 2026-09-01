# Cara menjalankan Novaro — dari nol

Panduan ini ditulis untuk orang yang **belum pernah menjalankan aplikasi server**.
Tidak ada langkah yang dilewati dan tidak ada istilah yang dipakai tanpa dijelaskan.

Kalau kamu sudah terbiasa dengan Node.js dan VPS, langsung ke **Bagian 4**.

---

## Bagian 1 — Ini sebenarnya benda apa?

### Halaman HTML biasa vs aplikasi ini

Kamu mungkin terbiasa dengan berkas `.html`: klik dua kali, terbuka di peramban,
selesai. Aplikasi ini **bukan** itu.

| | Halaman HTML biasa | Novaro |
|---|---|---|
| Cara membuka | Klik dua kali berkasnya | Harus ada **program yang berjalan** dulu |
| Butuh apa | Peramban saja | Node.js (mesin penjalan program) |
| Data disimpan | Di peramban pengunjung | Di komputer/server yang menjalankannya |
| Bisa dipakai 2 orang dengan data yang sama? | Tidak | Ya |

Di repositori ini ada **dua benda berbeda**:

```
index.html        ← halaman HTML biasa. Prototipe lama. BUKAN yang dipakai pilot.
server/           ← aplikasi sungguhannya. Ini yang dijalankan.
```

### Kenapa harus ada "server"?

Karena tiga hal ini tidak bisa dilakukan oleh berkas HTML:

1. **Menyimpan data terpusat.** Buku kas Bu Sari harus tetap ada walau dia ganti
   ponsel. Berkas HTML hanya bisa menyimpan di peramban orang itu sendiri.
2. **Menyembunyikan kunci API.** Kunci Anthropic-mu harus tidak terlihat peserta.
   Apa pun yang ada di berkas HTML bisa dibaca siapa saja yang membuka halamannya.
3. **Menjadi satu alamat bersama.** Semua peserta membuka alamat yang sama.

"Server" di sini artinya: **sebuah komputer yang menyalakan program ini
terus-menerus, dan bisa dihubungi dari internet.** Itu saja. Bisa laptopmu (untuk
mencoba), bisa komputer sewaan di internet (untuk pilot sungguhan).

### Alurnya

```
Ponsel Bu Sari  ──internet──►  Komputer yang menjalankan aplikasi  ──►  Claude API
                                          │
                                          └──►  users.json  (semua data pilot)
```

---

## Bagian 2 — Yang kamu butuhkan

| Untuk mencoba di laptop | Untuk pilot sungguhan |
|---|---|
| Node.js versi 20+ | Semua yang di kiri, ditambah: |
| Kunci API Anthropic | Tempat hosting (sewa) |
| Terminal | Nama domain (opsional tapi disarankan) |
| — | Kartu untuk bayar hosting + API |

**Node.js** adalah program yang bisa menjalankan berkas `.js`. Sama seperti kamu
butuh Microsoft Word untuk membuka `.docx`, kamu butuh Node.js untuk menjalankan
aplikasi ini. Gratis. Unduh di <https://nodejs.org> — ambil versi **LTS**.

**Terminal** adalah jendela tempat mengetik perintah.
- Windows: cari "PowerShell" di menu Start
- macOS: cari "Terminal" di Spotlight (Cmd+Space)
- Linux: Ctrl+Alt+T

**Kunci API Anthropic**: daftar di <https://console.anthropic.com>, lalu
Settings → API Keys → Create Key. Bentuknya `sk-ant-...`. Ini **berbayar per
pemakaian** — isi saldo dan pasang batas biaya di halaman Billing.

---

## Bagian 3 — Jalankan di laptopmu dulu

**Lakukan ini sebelum menyewa apa pun.** Gratis, 10 menit, dan kamu akan tahu
apakah semuanya berfungsi sebelum mengeluarkan uang.

### 3.1 Pastikan Node.js sudah terpasang

Buka terminal, ketik:

```bash
node --version
```

Harus keluar `v20.x.x` atau lebih tinggi. Kalau keluar "command not found",
Node.js belum terpasang — pasang dulu dari nodejs.org, **tutup terminal, buka
lagi**, ulangi.

### 3.2 Ambil kodenya

```bash
git clone https://github.com/Muhammad7A/Claude-Code-testing.git
cd Claude-Code-testing/server
```

Kalau `git` tidak ada, unduh ZIP dari halaman GitHub, ekstrak, lalu masuk ke
foldernya lewat terminal dengan `cd`.

### 3.3 Pasang pustaka pendukung

```bash
npm install
```

Perintah ini mengunduh 3 pustaka yang dipakai aplikasi (~12 MB) ke folder
`node_modules`. Cukup sekali. Butuh internet.

### 3.4 Masukkan kunci API

```bash
cp .env.example .env
```

Lalu buka berkas `.env` dengan editor teks apa pun (Notepad juga bisa) dan ganti:

```
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

dengan kunci aslimu. **Untuk di laptop, beri tanda pagar di depan `FORCE_HTTPS`
dan `TRUST_PROXY`** supaya tidak aktif:

```
# FORCE_HTTPS=1
# TRUST_PROXY=1
```

Berkas `.env` tidak akan ikut ter-commit ke Git — sudah diatur begitu.

### 3.5 Nyalakan

```bash
npm start
```

Kalau berhasil, muncul:

```
  Novaro berjalan di http://localhost:3000
  Model AI    : claude-sonnet-5
  Kunci API   : terpasang
  Data        : .../server/data/users.json
  Pengguna    : 0 termuat
  HTTPS       : TIDAK dipaksakan (set FORCE_HTTPS=1 di produksi)
```

**Biarkan terminal ini terbuka.** Selama jendela ini hidup, aplikasi berjalan.
Kalau ditutup, aplikasi mati. (Nanti di server ada cara agar tetap hidup.)

### 3.6 Buat pengguna uji dan coba

Buka terminal **kedua** (yang pertama biarkan jalan), lalu:

```bash
cd Claude-Code-testing/server
npm run users -- add "Uji Coba" "Warung Uji"
```

Keluar kode seperti `NOVA-7K3M-9QX2`. Buka <http://localhost:3000> di peramban,
masukkan kode itu, dan cobalah semuanya: setujui persetujuan, isi profil, catat
transaksi, tanya AI, buka laporan.

Sudah selesai mencoba? Hapus akun ujinya:

```bash
npm run users -- remove usr_xxxxx --yes   # id-nya terlihat di `npm run users -- list`
```

### 3.7 Menghentikan

Di terminal pertama, tekan **Ctrl + C**.

> **Catatan penting:** `localhost` hanya bisa dibuka dari laptopmu sendiri.
> Ponsel Bu Sari **tidak bisa** membukanya. Untuk itu perlu Bagian 4.

---

## Bagian 4 — Menaikkan untuk pilot sungguhan

Ada tiga jalan. Pilih satu.

| | **Jalan A — Layanan hosting** | **Jalan B — VPS** | **Jalan C — Google Cloud** |
|---|---|---|---|
| Susahnya | Lebih mudah | Lebih teknis | Teknis, tapi terarah |
| HTTPS | Otomatis | Pasang sendiri (certbot) | Pasang sendiri (certbot) |
| Perlu tahu Linux? | Hampir tidak | Ya, sedikit | Ya, sedikit |
| Letak server | Luar negeri | Pilih sendiri | **Jakarta** (asia-southeast2) |
| Cocok untuk | Kalau backend masih baru | Kalau sudah nyaman dengan terminal | Kalau kampus/hibahmu memang memakai GCP |

**Saran saya: Jalan A**, kecuali kalau kamu memang harus/ingin memakai Google
Cloud — lalu pakai **Jalan C**, dan pakai Compute Engine, bukan Cloud Run.
Alasannya ada di awal Jalan C.

Periksa sendiri tarif terbarunya sebelum memutuskan; harga layanan cloud
berubah dan berbeda per wilayah.

---

## ⚠️ Bacalah ini sebelum memilih hosting

Aplikasi ini menyimpan **semua data pilot di satu berkas** (`data/users.json`).

Banyak layanan hosting memakai penyimpanan **sementara**: setiap kali aplikasi
di-deploy ulang atau restart, semua berkas yang ditulis aplikasi **DIHAPUS dan
kembali seperti semula.**

Kalau itu terjadi:
- Seluruh buku kas peserta hilang.
- Cadangan otomatis ikut hilang — cadangannya ada di disk yang sama.
- **Tidak ada pesan galat.** Aplikasi tenang-tenang saja mulai dari kosong.

Karena itu aplikasi ini mencetak jumlah pengguna setiap kali start:

```
Pengguna    : 8 termuat          ← sehat
Pengguna    : 0 termuat  <-- ...DATA HILANG...   ← bencana, hentikan sekarang
```

**Apa pun hosting yang kamu pilih, kamu WAJIB memasang penyimpanan permanen
(disk / volume) dan mengarahkan `NOVA_DATA_DIR` ke sana.** Ini bukan opsional.
Caranya ada di bawah untuk tiap jalan.

---

## Jalan A — Layanan hosting (disarankan)

Contoh di bawah memakai **Render**; Railway dan Fly.io konsepnya sama.

### A.1 Siapkan

1. Kodenya sudah ada di GitHub (repositori ini).
2. Daftar di <https://render.com>, hubungkan akun GitHub-mu.

### A.2 Buat layanan

**New → Web Service**, pilih repositori ini, lalu isi:

| Isian | Nilai |
|---|---|
| Root Directory | `server` |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |
| Instance Type | Starter (yang berbayar — yang gratis tidur sendiri dan tidak bisa pasang disk) |

### A.3 Pasang penyimpanan permanen — JANGAN DILEWATI

Di layanan yang baru dibuat: **Disks → Add Disk**

| Isian | Nilai |
|---|---|
| Name | `nova-data` |
| Mount Path | `/var/lib/nova` |
| Size | 1 GB (jauh lebih dari cukup) |

### A.4 Isi variabel lingkungan

**Environment → Add Environment Variable**, satu per satu:

| Key | Value |
|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-...` milikmu |
| `NOVA_DATA_DIR` | `/var/lib/nova` ← **harus sama dengan Mount Path di atas** |
| `FORCE_HTTPS` | `1` |
| `TRUST_PROXY` | `1` |

`NOVA_DATA_DIR` inilah yang memindahkan data ke disk permanen. Tanpa baris ini,
data tetap ditulis ke penyimpanan sementara dan akan hilang.

### A.5 Deploy dan periksa

Render akan membangun lalu menyalakan. Buka **Logs**, pastikan tertulis:

```
Kunci API   : terpasang
Data        : /var/lib/nova/users.json      ← bukan .../server/data/...
Pengguna    : 0 termuat
HTTPS       : dipaksakan
Trust proxy : ya
```

Alamatnya akan seperti `https://novaro.onrender.com` — sudah HTTPS
otomatis. Buka di ponsel dan pastikan ada gembok.

### A.6 Uji bahwa datanya benar-benar permanen

**Lakukan ini sebelum mendaftarkan peserta sungguhan.**

1. Buat pengguna uji (lihat A.7 di bawah).
2. Di Render, tekan **Manual Deploy → Deploy latest commit**.
3. Setelah selesai, lihat Logs lagi.

Kalau tertulis `Pengguna : 1 termuat` → penyimpanan permanen berfungsi. **Kalau
tertulis `0 termuat`, `NOVA_DATA_DIR` atau disk-nya salah — perbaiki sebelum
melanjutkan.** Ini uji yang menyelamatkan pilotmu.

### A.7 Menambah pengguna di hosting

Kamu butuh akses terminal ke layanannya. Di Render: buka layananmu → tab
**Shell**, lalu:

```bash
cd server
npm run users -- add "Bu Sari" "Warung Bu Sari"
```

Perintah `npm run backup` dan `npm run export` juga dijalankan dari sini.

---

## Jalan B — VPS (kendali penuh)

VPS = komputer Linux sewaan. ~Rp 80rb/bulan di DigitalOcean, Vultr, Linode,
Biznet, atau Niagahoster. Ambil **Ubuntu 24.04**, RAM 1 GB sudah cukup.

Kamu juga butuh **nama domain** (mis. `nova.domainmu.id`) yang diarahkan ke
alamat IP VPS lewat pengaturan DNS.

### B.1 Masuk ke VPS

```bash
ssh root@ALAMAT_IP_VPS
```

### B.2 Pasang yang diperlukan

```bash
# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs nginx certbot python3-certbot-nginx git

# pm2 — penjaga agar aplikasi tetap hidup
sudo npm install -g pm2
```

Apa gunanya masing-masing:
- **nodejs** — menjalankan aplikasinya
- **nginx** — penerima tamu: menerima permintaan dari internet, meneruskan ke aplikasi, dan memegang sertifikat HTTPS
- **certbot** — mengurus sertifikat HTTPS gratis dari Let's Encrypt
- **pm2** — menyalakan ulang aplikasi kalau mati atau kalau server reboot

### B.3 Pasang aplikasinya

```bash
sudo git clone https://github.com/Muhammad7A/Claude-Code-testing.git /opt/nova
cd /opt/nova/server
npm install --omit=dev

# folder data di luar folder kode, agar aman saat update
sudo mkdir -p /var/lib/nova

cp .env.example .env
nano .env
```

Di dalam `nano`, isi:

```
ANTHROPIC_API_KEY=sk-ant-...kunci-aslimu...
NOVA_DATA_DIR=/var/lib/nova
FORCE_HTTPS=1
TRUST_PROXY=1
```

Simpan: `Ctrl+O`, Enter, lalu `Ctrl+X`.

```bash
chmod 600 .env      # hanya pemilik yang boleh membacanya
```

### B.4 Nyalakan dengan pm2

```bash
pm2 start server.js --name nova
pm2 save
pm2 startup           # ikuti perintah yang ditampilkannya, salin-tempel
pm2 logs nova         # lihat log; Ctrl+C untuk keluar dari tampilan log
```

Periksa di log: `Data : /var/lib/nova/users.json` dan `Pengguna : 0 termuat`.

### B.5 Pasang Nginx

```bash
sudo nano /etc/nginx/sites-available/nova
```

Isi (ganti `nova.domainmu.id` dengan domainmu):

```nginx
server {
  listen 80;
  server_name nova.domainmu.id;

  location / {
    proxy_pass http://localhost:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  # Jawaban AI mengalir sedikit demi sedikit; tanpa dua baris ini
  # jawabannya baru muncul sekaligus di akhir.
  location /api/chat {
    proxy_pass http://localhost:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_read_timeout 300s;
  }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/nova /etc/nginx/sites-enabled/
sudo nginx -t          # harus tertulis "syntax is ok"
sudo systemctl reload nginx
```

### B.6 Pasang HTTPS

```bash
sudo certbot --nginx -d nova.domainmu.id
```

Certbot akan bertanya email, lalu menawarkan pengalihan HTTP→HTTPS — **pilih ya**.
Sertifikatnya diperpanjang otomatis.

### B.7 Tutup pintu yang tidak perlu

```bash
sudo ufw allow 22    # SSH
sudo ufw allow 80    # HTTP (untuk dialihkan ke HTTPS)
sudo ufw allow 443   # HTTPS
sudo ufw enable
```

Port 3000 **tidak** dibuka — aplikasi hanya boleh dihubungi lewat Nginx.

### B.8 Uji

```bash
curl https://nova.domainmu.id/api/health
# {"ok":true,"model":"claude-sonnet-5","aiConfigured":true}

curl -I http://nova.domainmu.id
# harus 301 atau 308 ke https
```

Lalu buka di ponsel, pastikan ada gembok.

### B.9 Menambah pengguna

```bash
ssh root@ALAMAT_IP_VPS
cd /opt/nova/server
npm run users -- add "Bu Sari" "Warung Bu Sari"
```

---

## Jalan C — Google Compute Engine (Jakarta)

### C.0 Kenapa Compute Engine, bukan Cloud Run

Cloud Run terlihat paling cocok — serverless, HTTPS otomatis, bayar sesuai
pemakaian. Untuk aplikasi ini ia justru pilihan yang salah, karena tiga hal
yang semuanya berujung pada data peserta:

1. **Filesystem-nya sementara.** Sama persis dengan peringatan besar di atas.
2. **Penyimpanan permanennya tidak cocok.** `data/users.json` ditulis dengan
   `rename()` atomik dan dijaga kunci berkas (`open` mode `wx`). Cloud Storage
   FUSE tidak menjamin keduanya. Filestore menjamin, tapi tarif minimumnya jauh
   di luar akal untuk pilot 5–30 orang. *(Pastikan sendiri ke dokumentasi
   sebelum mengandalkan salah satunya.)*
3. **Aplikasi ini harus satu instance.** Pembatas login dan pembatas pemakaian
   AI hidup di memori. Dua instance berarti dua pembatas yang tidak saling
   tahu — dan dua salinan berkas data yang bisa saling menimpa.

Compute Engine dengan Persistent Disk menyelesaikan ketiganya sekaligus, dan
langkahnya hampir sama dengan Jalan B.

Kalau kamu tetap memakai Cloud Run untuk mencoba-coba (bukan untuk peserta
sungguhan), pakai `--min-instances=1 --max-instances=1` dan sadari datanya
tidak permanen.

---

### C.1 Siapkan proyek & alat

```bash
gcloud auth login
gcloud config set project PROYEK-KAMU
gcloud config set compute/region asia-southeast2      # Jakarta
gcloud config set compute/zone asia-southeast2-a

gcloud services enable compute.googleapis.com secretmanager.googleapis.com \
  monitoring.googleapis.com logging.googleapis.com storage.googleapis.com
```

Wilayah Jakarta dipilih supaya jarak ke peserta di Banyumanik sependek mungkin,
dan supaya data peserta tidak berpindah negara tanpa alasan.

### C.2 Kunci API ke Secret Manager

Kunci API **tidak** ditaruh di berkas `.env` yang ikut tersalin ke mana-mana:

```bash
printf 'sk-ant-xxxxxxxx' | gcloud secrets create nova-anthropic-key \
  --data-file=- --replication-policy=automatic

# kode untuk lembar validasi materi (lihat PANDUAN-VALIDASI.md)
openssl rand -base64 18 | tr -d '\n' | gcloud secrets create nova-validasi-kode --data-file=-
```

### C.3 Buat VM + disk data terpisah

```bash
gcloud compute disks create nova-data --size=10GB --type=pd-balanced

gcloud compute instances create nova \
  --machine-type=e2-small \
  --image-family=debian-12 --image-project=debian-cloud \
  --boot-disk-size=20GB \
  --disk=name=nova-data,device-name=nova-data,mode=rw,auto-delete=no \
  --scopes=cloud-platform \
  --tags=http-server,https-server
```

**Disk data sengaja terpisah dari disk boot** dan `auto-delete=no`: VM boleh
dibuat ulang, disusutkan, atau diganti tanpa data peserta ikut terbawa. Ini
satu-satunya keputusan di halaman ini yang tidak bisa diperbaiki belakangan.

Buka firewall dan pesan alamat IP tetap:

```bash
gcloud compute firewall-rules create nova-web \
  --allow=tcp:80,tcp:443 --target-tags=http-server,https-server

gcloud compute addresses create nova-ip --region=asia-southeast2
```

Arahkan domainmu (A record) ke alamat itu.

### C.4 Format & pasang disk data

```bash
gcloud compute ssh nova

sudo mkfs.ext4 -m 0 -F -E lazy_itable_init=0,lazy_journal_init=0,discard \
  /dev/disk/by-id/google-nova-data          # HANYA sekali, saat disk masih baru
sudo mkdir -p /var/lib/nova
sudo mount -o discard,defaults /dev/disk/by-id/google-nova-data /var/lib/nova

# supaya ikut ter-mount setiap kali VM menyala
echo '/dev/disk/by-id/google-nova-data /var/lib/nova ext4 discard,defaults,nofail 0 2' \
  | sudo tee -a /etc/fstab
```

> `mkfs` menghapus isi disk. Jalankan **hanya** saat disk itu benar-benar baru.

### C.5 Pasang aplikasi

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx git curl
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

sudo useradd --system --home /opt/nova --shell /usr/sbin/nologin nova
sudo mkdir -p /opt/nova && sudo chown nova:nova /opt/nova /var/lib/nova

sudo -u nova git clone https://github.com/Muhammad7A/Claude-Code-testing.git /opt/nova
cd /opt/nova/server
sudo -u nova npm ci --omit=dev
```

### C.6 Variabel lingkungan

```bash
sudo mkdir -p /etc/nova
sudo tee /etc/nova/nova.env >/dev/null <<'ENV'
NODE_ENV=production
PORT=3000
TZ=Asia/Jakarta
LOG_FORMAT=json
NOVA_DATA_DIR=/var/lib/nova
FORCE_HTTPS=1
TRUST_PROXY=1
PUBLIC_HOST=nova.domainmu.id
TOKEN_BUDGET_DAILY=10000
TOKEN_BUDGET_WEEKLY=50000
ENV

# kunci diambil dari Secret Manager, tidak pernah diketik ke berkas ini
echo "ANTHROPIC_API_KEY=$(gcloud secrets versions access latest --secret=nova-anthropic-key)" \
  | sudo tee -a /etc/nova/nova.env >/dev/null
echo "VALIDASI_KODE=$(gcloud secrets versions access latest --secret=nova-validasi-kode)" \
  | sudo tee -a /etc/nova/nova.env >/dev/null

sudo chmod 600 /etc/nova/nova.env
sudo chown root:root /etc/nova/nova.env
```

`EnvironmentFile` dibaca systemd sebagai root sebelum hak akses diturunkan ke
pengguna `nova`, jadi berkasnya tidak perlu — dan tidak boleh — bisa dibaca
aplikasi itu sendiri. Kunci API juga tidak pernah muncul di `ps aux`.

### C.7 Nyalakan sebagai layanan

```bash
sudo cp /opt/nova/server/deploy/nova.service /etc/systemd/system/nova.service
sudo systemctl daemon-reload
sudo systemctl enable --now nova
sudo systemctl status nova
```

Periksa bahwa penyimpanannya benar-benar hidup:

```bash
curl -s localhost:3000/api/health
# {"ok":true,...,"penyimpanan":{"baca":"ok","tulis":"ok","peserta":0}}
```

Kalau `ok:false`, **jangan lanjut**. Server memang dirancang menolak menyala
bila folder datanya tidak bisa ditulis; `journalctl -u nova -n 50` akan
menyebut persis apa yang perlu diperiksa.

### C.8 Nginx + HTTPS

```bash
sudo cp /opt/nova/server/deploy/nginx-nova.conf /etc/nginx/sites-available/nova
sudo sed -i 's/nova.domainmu.id/DOMAIN-KAMU/' /etc/nginx/sites-available/nova
sudo ln -sf /etc/nginx/sites-available/nova /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

sudo certbot --nginx -d DOMAIN-KAMU
```

Berkas Nginx-nya sudah memuat `proxy_buffering off` — tanpa itu jawaban AI
ditahan sampai selesai lalu muncul sekaligus, dan peserta mengira aplikasinya
menggantung.

### C.9 Cadangan KE LUAR mesin

Cadangan otomatis aplikasi ada di disk yang **sama** dengan datanya. Itu
menolong saat berkasnya rusak, dan tidak menolong sama sekali saat VM atau
disknya yang hilang.

```bash
gsutil mb -l asia-southeast2 gs://nova-cadangan-PROYEK-KAMU
gsutil versioning set on gs://nova-cadangan-PROYEK-KAMU

sudo tee /etc/cron.daily/nova-cadangan >/dev/null <<'SH'
#!/bin/sh
gcloud storage rsync -r /var/lib/nova/backup gs://nova-cadangan-PROYEK-KAMU/backup
SH
sudo chmod +x /etc/cron.daily/nova-cadangan
```

Tambahkan juga snapshot terjadwal pada disk-nya:

```bash
gcloud compute resource-policies create snapshot-schedule nova-harian \
  --region=asia-southeast2 --max-retention-days=14 \
  --daily-schedule --start-time=19:00          # 02.00 WIB
gcloud compute disks add-resource-policies nova-data \
  --resource-policies=nova-harian --zone=asia-southeast2-a
```

**Uji pemulihannya sekali, sebelum ada peserta.** Cadangan yang belum pernah
dipulihkan belum terbukti sebagai cadangan.

### C.10 Pemantauan hidup-mati

```bash
# Ops Agent: meneruskan journald (termasuk log JSON) ke Cloud Logging
curl -sSO https://dl.google.com/cloudagents/add-google-cloud-ops-agent-repo.sh
sudo bash add-google-cloud-ops-agent-repo.sh --also-install
```

Lalu di Console → **Monitoring → Uptime checks**, buat pemeriksaan ke
`https://DOMAIN-KAMU/api/health` tiap 5 menit, dengan syarat berhasil
`ok` bernilai `true`, dan alert ke email/HP-mu.

Probe itu benar-benar memeriksa apakah data bisa dibaca dan ditulis — bukan
sekadar apakah prosesnya hidup. Tambahkan juga alert untuk **disk terpakai
> 80%**: `events[]` tumbuh terus dan tidak pernah dipangkas, dan disk penuh
berarti setiap penyimpanan peserta gagal.

### C.11 Periksa dari luar

```bash
curl -s https://DOMAIN-KAMU/api/health
curl -sI https://DOMAIN-KAMU/ | grep -i 'content-encoding\|x-robots-tag'
# content-encoding: gzip     <- muat pertama 164 KB -> 49 KB
# x-robots-tag: noindex, ...
```

Lalu tambahkan peserta pertamamu dan jadwalkan jalur belajarnya:

```bash
cd /opt/nova/server
sudo -u nova npm run users -- add "Bu Sari" "Warung Bu Sari" --batch B1
sudo -u nova npm run users -- mulai --batch B1 2026-08-17
```

### C.12 Memperbarui aplikasi

```bash
cd /opt/nova
sudo -u nova git pull
cd server && sudo -u nova npm ci --omit=dev
sudo systemctl restart nova     # SIGTERM ditangani: penulisan yang mengantre diselesaikan dulu
```

---

## Bagian 5 — Perintah harian

Semuanya dijalankan dari folder `server/`.

| Perintah | Gunanya |
|---|---|
| `npm start` | Menyalakan aplikasi |
| `npm test` | Memastikan tidak ada yang rusak (layanan AI ditiru) |
| `npm run smoke` | Satu panggilan **sungguhan** ke Claude — bukti jalur AI hidup (± Rp 500) |
| `npm run users -- list` | Daftar peserta + pemakaian AI |
| `npm run users -- add "Nama" "Usaha"` | Menambah peserta, memberi kode akses |
| `npm run users -- reset usr_xxx` | Kode akses baru (yang lama hangus) |
| `npm run users -- remove usr_xxx --yes` | Menghapus peserta + seluruh datanya (permanen; cadangan dibuat otomatis dulu) |
| `npm run backup` | Cadangkan sekarang |
| `npm run backup -- list` | Daftar cadangan |
| `npm run backup -- restore <berkas> --yes` | Pulihkan |
| `npm run export -- --anonymize` | Ekspor data penelitian tanpa nama |

Di VPS, tambahan pm2:

| Perintah | Gunanya |
|---|---|
| `pm2 logs nova` | Melihat log |
| `pm2 restart nova` | Menyalakan ulang |
| `pm2 status` | Melihat apakah masih hidup |

### Memperbarui aplikasi (VPS)

```bash
cd /opt/nova
sudo git pull
cd server && npm install --omit=dev
pm2 restart nova
pm2 logs nova --lines 20     # pastikan "Pengguna : N termuat" masih benar
```

Di Render, cukup `git push` — deploy jalan sendiri.

---

## Bagian 6 — Kalau ada yang salah

| Yang terlihat | Artinya | Yang dilakukan |
|---|---|---|
| `command not found: node` | Node.js belum terpasang | Pasang dari nodejs.org, tutup terminal, buka lagi |
| `command not found: npm` | Sama seperti di atas | Sama |
| `Cannot find module 'express'` | `npm install` belum dijalankan | `cd server && npm install` |
| `EADDRINUSE: address already in use` | Port 3000 sudah dipakai | Aplikasi lain sudah jalan; matikan, atau `PORT=3001 npm start` |
| `Kunci API : BELUM DIATUR` | `.env` tidak terbaca | Pastikan namanya persis `.env` (bukan `.env.txt`) dan ada di folder `server/` |
| `Pengguna : 0 termuat` padahal seharusnya ada | **Data hilang** | Jangan tambah pengguna baru. `npm run backup -- list` lalu pulihkan. Periksa `NOVA_DATA_DIR`. |
| Halaman tidak terbuka dari ponsel | Masih `localhost` | `localhost` hanya untuk laptop sendiri. Perlu hosting (Bagian 4). |
| Jawaban AI muncul sekaligus, tidak mengalir | `proxy_buffering` belum dimatikan | Cek blok `/api/chat` di Nginx (B.5) |
| Peserta: "terlalu banyak percobaan" | Salah ketik 20x dalam 15 menit | Kode yang benar tetap diterima, jadi biasanya dia memang lupa — reset kodenya |
| `EACCES: permission denied` | Kurang izin | Tambahkan `sudo` di depan perintahnya |

### Melihat pesan galat

- Laptop: pesan muncul di terminal tempat `npm start` dijalankan
- VPS: `pm2 logs nova`
- Render: tab **Logs** di dashboard

---

## Bagian 7 — Urutan yang saya sarankan

1. **Bagian 3** — jalankan di laptop, coba sendiri sampai paham. *(hari ini)*
2. Baca `PANDUAN-PILOT.md` supaya tahu proses pendampingannya.
3. **Bagian 4 Jalan A** — deploy ke hosting.
4. **A.6** — uji bahwa datanya bertahan setelah deploy ulang. **Jangan dilewati.**
5. Daftarkan dirimu sendiri sebagai peserta uji, pakai seminggu.
6. Hapus akun ujimu.
7. Baru daftarkan peserta sungguhan yang pertama.

Langkah 5 terasa berlebihan, tapi seminggu memakai aplikasinya sendiri akan
memperlihatkan hal-hal yang tidak muncul dalam percobaan 10 menit.
