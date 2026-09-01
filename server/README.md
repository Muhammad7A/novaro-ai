# Novaro — Aplikasi Pendamping Keuangan UMKM

Aplikasi web untuk program pendampingan UMKM skala kecil (5–10 pengguna, ditambahkan manual).
Setiap pemilik usaha mengisi **profil usaha** sekali, lalu memakai aplikasi ini setiap hari:

- **Buku kas** — catat uang masuk/keluar dalam ~10 detik dari ponsel. Inilah inti aplikasinya.
- **Dasbor** — skor kesehatan keuangan 0–100 dengan rincian per aspek, laba rugi, dan saldo kas.
- **Rekomendasi personal** — rencana perbaikan yang disusun AI dari angka usahanya sendiri, bukan saran umum.
- **Konsultasi AI** — tanya jawab dengan **Claude Sonnet 5**, yang sudah membaca profil dan buku kas pengguna.
- **Laporan KUR** — ringkasan 3–12 bulan siap cetak/PDF, format yang biasa diminta bank.
- **10 modul** akuntansi dasar dengan video pendamping dan penanda progres.

### Dua aturan akuntansi yang dibangun ke dalam aplikasi

1. **Prive bukan biaya usaha.** Uang usaha yang dipakai untuk keperluan pribadi tidak
   mengurangi laba, tapi tetap mengurangi kas. Karena itu setiap bulan menghasilkan
   **dua** angka: *laba bersih* dan *saldo kas* (Modul 2 & 6).
2. **Angka nyata mengalahkan perkiraan.** Selama buku kas belum terisi, aplikasi memakai
   perkiraan dari profil dan menandainya jelas. Begitu satu bulan punya ≥10 transaksi di
   ≥8 hari **dan menutupi ≥60% hari yang sudah lewat**, aplikasi otomatis beralih ke angka
   nyata — termasuk untuk skor dan untuk AI.
3. **Setiap angka membawa periodenya.** Jumlah di buku kas adalah "sejauh ini", bukan
   "sebulan". Tanggal 8, sebuah bulan baru terisi 8/30. Aplikasi tidak pernah memakai
   angka sebagian bulan sebagai angka sebulan — lihat bagian *Periode* di bawah.

---

## Cara kerja singkat

```
Browser  ──►  Server Node.js  ──►  Claude API (Sonnet 5)
             (kunci API di sini)
                    │
                    └──►  server/data/users.json
```

Kunci API **hanya ada di server**. Browser tidak pernah menerimanya, jadi kunci tidak bisa
dicuri dari halaman web.

Angka keuangan (laba, margin, batas cicilan, skor kesehatan) **dihitung oleh server** dengan
rumus tetap di `lib/metrics.js`, lalu diberikan ke AI sebagai fakta. AI hanya menjelaskan dan
menyusun saran — sehingga tidak ada risiko angka karangan.

---

## Instalasi

> **Belum pernah menjalankan aplikasi server?** Panduan ini mengasumsikan kamu
> sudah terbiasa dengan Node.js dan terminal. Kalau belum, mulai dari
> **[CARA-MENJALANKAN.md](CARA-MENJALANKAN.md)** — dijelaskan dari nol, termasuk
> cara menaikkannya ke hosting.

Butuh **Node.js 20 atau lebih baru**.

```bash
cd server
npm install

cp .env.example .env      # lalu isi ANTHROPIC_API_KEY di dalamnya
```

Ambil kunci API di <https://console.anthropic.com/settings/keys>.

```bash
npm start
```

Buka <http://localhost:3000>.

---

## Menambahkan pengguna

Pengguna ditambahkan manual oleh pengelola program. Setiap pengguna dapat satu kode akses.

```bash
npm run users -- add "Bu Sari" "Warung Bu Sari"
```

Perintah ini menampilkan kode akses, misalnya `NOVA-7K3M-9QX2`. **Kode hanya muncul sekali** —
yang tersimpan di server hanyalah hash-nya. Berikan kode itu ke pemilik usaha; itulah yang
dia masukkan di halaman login.

Perintah lain:

```bash
npm run users -- list                  # lihat semua pengguna + kelompok + pemakaian AI
npm run users -- reset usr_xxxx        # buat ulang kode akses (kode lama hangus)
npm run users -- remove usr_xxxx --yes # hapus pengguna beserta datanya (permanen)
```

### Kelompok peserta (batch)

Untuk rancangan **waitlist control**: B1 menerima perlakuan lebih dulu, B2
menyusul setelah post-test. Kelompoknya dipakai pengelola dan ekspor penelitian
saja — peserta tidak pernah melihatnya, supaya tidak memengaruhi perilakunya.

```bash
npm run users -- add "Bu Sari" "Warung Bu Sari" --batch B1
npm run users -- batch usr_xxxx B2     # tetapkan/ubah; '-' mengosongkan
npm run users -- acak --yes            # acak yang belum berkelompok ke B1/B2
```

`acak` hanya menyentuh peserta yang **belum** berkelompok, jadi aman dijalankan
lagi setelah menambah peserta baru — yang sudah terlanjur diberi tahu jadwalnya
tidak akan dikocok ulang. Pengacakannya memakai sumber acak kriptografis dan
menjaga kedua kelompok seimbang (selisih tidak pernah lebih dari satu orang).

Setiap penetapan tercatat sebagai peristiwa `batch_assigned` **beserta waktunya**
dan kelompok sebelumnya. Itu bagian dari catatan metodologi: pengacakan setelah
pre-test bukan hal yang sama dengan pengacakan sebelum pre-test, dan urutan itu
tidak bisa dibuktikan dari data mana pun kalau tidak dicatat saat kejadian.

Kolom `batch` ikut ke **seluruh** berkas ekspor — `users.csv`, `events.csv`,
`transactions.csv`, `monthly.csv`, `profile_versions.csv`, dan
`perkiraan_vs_nyata.csv` — sehingga tiap tabel bisa langsung dikelompokkan di
Jamovi tanpa digabungkan dulu.

Untuk mengeluarkan data pilot supaya bisa dianalisis, lihat **Data penelitian** di bawah.

> Untuk panduan operasional menjalankan pilot dengan peserta sungguhan — daftar
> periksa sebelum mulai, urutan hari pendaftaran, ritme pendampingan, dan cara
> memulihkan data — lihat **[PANDUAN-PILOT.md](PANDUAN-PILOT.md)**.

---

## Persetujuan peserta

Aplikasi ini mengumpulkan pembukuan keuangan pemilik usaha kecil dan mengirim
sebagiannya ke layanan AI pihak ketiga. Itu tidak boleh dianggap disetujui hanya
karena seseorang diberi kode akses.

Pada login pertama, peserta melihat layar persetujuan yang menjelaskan data apa
yang disimpan, apa yang dikirim ke layanan Claude, bahwa ini uji coba, haknya
mengunduh dan menghapus data, dan bahwa data dipakai tanpa nama untuk menilai
program. Teksnya ada di `lib/consent.js`.

**Persetujuan disimpan bersama nomor versinya.** Kalau teksnya berubah, naikkan
`CONSENT_VERSION` — peserta yang menyetujui teks lama akan ditanya lagi. Tanpa
nomor versi, catatan persetujuan hanya berarti "pernah menekan tombol", bukan
"menyetujui hal yang ini".

Server **menolak menyimpan data** dari peserta yang belum menyetujui versi saat
ini (HTTP 451) — bukan hanya tampilannya yang menghalangi. Persetujuan yang
dijaga layar depan saja bukan persetujuan; ia cuma tombol yang bisa dilewati.

Di halaman Profil, peserta punya tiga tombol: **unduh data saya** (seluruh
pembukuannya sebagai JSON), **baca lagi persetujuan**, dan **hapus data &
berhenti**. Penghapusan benar-benar menghapus — kode aksesnya langsung tidak
berlaku, dan datanya tidak ikut ekspor penelitian berikutnya.

---

## Keamanan

Satu kenyataan mendasari semuanya: **kode akses ikut di header setiap
permintaan**. Siapa pun yang membacanya mendapat seluruh pembukuan keuangan
peserta itu — bukan sepotong, tapi semuanya.

### Yang sudah terpasang

| | |
|---|---|
| Kunci API hanya di server | Browser tidak pernah menerimanya |
| Kode akses disimpan sebagai hash SHA-256 | Ditampilkan sekali saat dibuat |
| Memaksa HTTPS | `FORCE_HTTPS=1` — GET dialihkan, permintaan berisi data **ditolak** |
| Header keamanan | CSP, HSTS, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy` |
| Pembatas kode akses per IP | 20 percobaan gagal / 15 menit, di **semua** rute, dicatat ke log |
| Pembatas pemakaian AI | Per pengguna per jam (ledakan) + anggaran token harian & mingguan (tagihan) |
| XSS | Semua teks pengguna lewat `escapeHtml()` |
| CSRF | Tidak berlaku — autentikasi lewat header, bukan cookie |
| Penulisan atomik | Tulis ke sementara lalu rename + kunci antar proses |
| Tanpa domain luar | Halaman tidak memuat font, skrip, atau gambar dari pihak ketiga |
| Jawaban API `no-store` | Pembukuan tidak tersimpan di cache peramban |

Permintaan POST yang datang lewat HTTP **tidak dialihkan, tapi ditolak**.
Mengalihkannya tetap mengirim kode aksesnya sekali lewat jaringan terbuka, dan
yang sudah bocor tidak bisa ditarik kembali. Tujuan pengalihan GET diambil dari
`PUBLIC_HOST`, bukan dari header `Host` yang dikirim peramban — header itu bisa
dipalsukan sehingga alamat program dipakai mengalihkan orang ke situs lain.

**Kode yang benar selalu diterima, bahkan saat alamat IP-nya sedang terkunci.**
Di jaringan seluler Indonesia beberapa peserta bisa keluar lewat satu alamat IP
publik yang sama; memeriksa kunci lebih dulu berarti satu tetangga yang salah
menebak ikut mengunci peserta yang kodenya sah. Yang dibatasi adalah penebakan —
dan penebak justru tidak punya kode yang benar. Kode yang benar juga mengosongkan
hitungan, jadi peserta yang salah ketik beberapa kali tidak tersisa satu
kesempatan sampai 15 menit berikutnya.

### Batas yang disadari

- **`'unsafe-inline'` pada `script-src`.** Seluruh aplikasi ini satu berkas
  dengan skrip inline; tanpa itu halamannya mati. Yang tetap didapat: skrip dari
  domain luar tidak bisa dimuat sama sekali — jalur yang biasa dipakai untuk
  membesarkan celah XSS menjadi pencurian data. Menutupnya butuh memecah berkas
  dan memakai nonce.
- **Satu faktor.** Satu kode akses = akses penuh ke pembukuan satu peserta.
  Tidak ada kata sandi kedua. Kalau kodenya bocor: `npm run users -- reset`.
- **Token di `localStorage`.** Aman selama tidak ada celah XSS, dan CSP
  mempersempitnya — tapi ini memang bukan penyimpanan paling kokoh.

### Daftar periksa sebelum produksi

```
□ HTTPS hidup, http:// dialihkan (certbot)
□ FORCE_HTTPS=1 dan TRUST_PROXY=1 di .env
□ chmod 600 .env
□ Firewall: hanya 22, 80, 443 — port 3000 TIDAK boleh terbuka
□ SSH pakai kunci, login kata sandi dimatikan
□ Batas biaya diatur di console.anthropic.com
□ Cadangan tersalin ke luar mesin
□ npm audit bersih
```

---

## Cadangan

Seluruh pilot bersandar pada satu berkas. Peserta yang pindah dari buku tulis ke
aplikasi ini menaruh berbulan-bulan pembukuannya di sana — dan berbeda dengan
buku tulis, dia tidak bisa menyusunnya ulang. Kehilangan itu membuat dia **lebih
buruk karena ikut program ini**, dan itu satu-satunya kerugian nyata yang bisa
ditimbulkan sistem ini.

Server mencadangkan otomatis saat start lalu tiap 24 jam ke `data/backup/`,
menyimpan 14 salinan terakhir.

```bash
npm run backup                              # cadangkan sekarang
npm run backup -- list                      # lihat yang tersimpan
npm run backup -- restore <berkas> --yes    # pulihkan
```

Dua perlindungan yang mudah terlewat:

- **Berkas data yang rusak tidak pernah disalin.** Menyalin berkas rusak akan
  mendorong keluar salinan sehat yang masih ada — cadangan yang justru menghapus
  satu-satunya data utuh.
- **Pemulihan menyimpan dulu data yang sedang berjalan.** Salah pilih berkas
  tidak boleh berarti kehilangan babak kedua.

> Cadangan otomatis ada di disk yang sama dengan datanya. Itu menolong untuk
> berkas terhapus atau rusak, **bukan** untuk disk yang hilang. Untuk pilot
> sungguhan, salin `data/backup/` ke luar mesin secara berkala.

---

## Data penelitian

Aplikasi ini dipakai untuk pilot berpendamping, jadi ada tiga hal yang direkam
sejak awal — bukan karena berguna untuk fiturnya, tapi karena sekali hilang tidak
bisa disusun ulang.

### 1. Garis dasar tidak pernah ditimpa

Angka perkiraan yang diisi peserta di hari pertama (`omzetBulanan`,
`belanjaBulanan`, `biayaOperasional`) adalah satu-satunya catatan tentang apa yang
dia **kira** dia hasilkan, sebelum buku kas menunjukkan kenyataannya. Setiap
penyimpanan profil menambah versi baru ke `profileHistory`; versi pertama adalah
garis dasar dan bertahan selamanya.

Selisih antara keduanya adalah temuan paling layak diteliti dari aplikasi ini.
Pengguna yang sudah terdaftar sebelum fitur ini ada tetap terselamatkan: profil
yang masih tersimpan otomatis dijadikan versi pertama.

### 2. Jejak perilaku

Setiap peserta punya `events[]` yang append-only: `login`, `profile_saved`,
`transaction_added` (termasuk penanda `mundur` bila dicatat menyusul),
`transaction_deleted`, `module_completed`, `chat_turn`, `ai_feedback`,
`recommendations_generated`, `report_viewed`.

Jejak ini sengaja **tidak memuat isi** — tidak ada nominal, nama transaksi, atau
kutipan percakapan. Satu pengecualian yang disengaja: `ai_feedback.alasan`
menyimpan kalimat yang ditulis peserta sendiri saat menandai sebuah jawaban AI
keliru. Tanpa kalimat itu, penandanya hanya berupa angka dan tidak bisa
menjelaskan APA yang keliru — padahal justru itu yang dicari penelitian ini.
Panjangnya dipotong 500 karakter di sisi server, dan ikut terbawa saat peserta
mengunduh datanya sendiri. Semua itu sudah tersimpan di tempatnya masing-masing. Yang
dicatat hanya "apa yang terjadi, kapan", karena itulah yang dibutuhkan untuk
menjawab apakah kebiasaan berubah dan sejak kapan.

Peristiwa yang menyertai perubahan data ditulis dalam mutasi yang sama, jadi tidak
menambah penulisan ke disk.

### 3. Ekspor siap analisis

```bash
npm run export -- --anonymize     # untuk dianalisis atau dibagikan
npm run export                    # lengkap, memuat data pribadi
```

| Berkas | Isi |
|---|---|
| `users.csv` | Satu baris per peserta: profil awal, profil akhir, ringkasan pemakaian |
| `profile_versions.csv` | Tiap versi profil; `garisDasar=1` adalah perkiraan hari pertama |
| `transactions.csv` | Tiap transaksi, plus `hariTundaCatat` — jeda kejadian ke pencatatan |
| `events.csv` | Garis waktu perilaku |
| `monthly.csv` | Tabel siap analisis, satu baris per peserta per bulan |
| `perkiraan_vs_nyata.csv` | Selisih perkiraan hari pertama vs angka buku kas |
| `chat.csv` | Isi percakapan — **hanya** pada ekspor lengkap |

Mode anonim menghapus nama, usaha, lokasi, produk, teks bebas, dan seluruh
percakapan. `usr_xxx` bersifat acak dan tetap dipakai supaya baris antar tabel
masih bisa disambungkan.

Hasil ekspor masuk `server/export/` yang **di-gitignore** — data peserta tidak
pernah masuk repositori kode, bahkan dalam mode anonim.

> Untuk analisis, saring `monthly.csv` dengan `layakRataRata=1`. Bulan dengan
> cakupan rendah angkanya lebih kecil dari kenyataan karena catatannya bolong,
> bukan karena usahanya turun — aturan yang sama dipakai laporan KUR.

### Batas yang perlu diketahui

`events[]` tidak dipangkas, dan **seluruh basis data ditulis ulang setiap ada
perubahan**. Untuk 5–10 peserta selama beberapa bulan ini ringan. Untuk studi
yang jauh lebih besar atau lebih panjang, pindahkan ke database sebelum mulai.

Karena satu penulisan berharga seluruh berkas, penulisan yang mengubah pengguna
yang sama pada momen yang sama digabung menjadi satu: `simpanGiliranChat`
(pesan + jejak + token) dan `simpanRekomendasi` (rekomendasi + token). Terukur
dengan menghitung penulisan `users.json`: 2 menjadi 1 pada tiap giliran chat dan
tiap penyusunan rekomendasi.

---

## Jadwal belajar: satu sesi per hari

Tujuh sesi jalur dasar terbuka **satu per hari**, dihitung dari tanggal yang
ditetapkan pendamping:

```bash
npm run users -- mulai usr_ab12cd34 2026-08-17   # satu peserta
npm run users -- mulai --batch B1 2026-08-17     # satu kelompok sekaligus
npm run users -- list                            # kolom jadwal tiap peserta
```

**Gerbangnya maju saja.** Sesi esok belum terbuka; sesi kemarin **tidak pernah
menutup lagi**. Tiga alasan, semuanya ada di komentar [`lib/jadwal.js`](lib/jadwal.js):

- Materinya saling merujuk — praktik sesi 1 menyuruh peserta membandingkan
  tebakannya di sesi 4, dan modul 3 merujuk modul 8.
- Modul 2 mengajarkan bahwa catatan cloud "bisa dibuka kapan saja". Aplikasi
  yang menutup materi kemarin membantah pelajarannya sendiri.
- Dengan peluang harian 80% dan penguncian penuh, hanya ±21% peserta yang akan
  pernah menyelesaikan tujuh sesinya (0,8⁷) — sisanya diuji post-test atas
  materi yang tidak pernah diajarkan kepada mereka. Gerbang maju hanya
  memanjangkan kalender menjadi ±9 hari; tidak ada sesi yang hilang.

**Tanggal mulai tidak pernah terisi sendiri.** Bukan `createdAt` dan bukan login
pertama: peserta didaftarkan berhari-hari sebelum pendampingan, dan B2 menyusul
jauh di belakang B1. Selama belum ditetapkan, tidak ada sesi harian yang terbuka
— dan `npm run users -- list` menandainya `BELUM DIMULAI` supaya tidak ada yang
lupa tanpa ketahuan. Penetapannya tercatat sebagai peristiwa `belajar_dimulai`
beserta tanggal sebelumnya, sehingga urutan "ditetapkan sebelum atau sesudah
pre-test" bisa dibuktikan dari data.

### Di mana gerbangnya ditegakkan

Empat pintu, dan semuanya harus tertutup bersamaan:

| Pintu | Yang dijaga |
|---|---|
| `/modul.js` | Isi tujuh sesi harian **tidak ikut** — hanya metadatanya |
| `GET /api/sesi/:no` | Menolak sesi yang harinya belum tiba, **beserta tanggal terbukanya** |
| `PUT /api/progress` | Menolak menandai sesi terkunci sebagai selesai |
| `POST /api/chat` | Materi sesi terkunci tidak disisipkan ke prompt AI |

Pintu terakhir yang paling mudah terlupakan: tanpanya peserta hari ke-2 tinggal
mengirim `modul: 6` dan seluruh isi sesi 6 disalin ke jawaban AI.

### Kenapa isinya dibelah begitu

```
seluruh kurikulum        58,1 KB
├─ 22 modul pustaka      37,6 KB   tidak digerbang  -> tetap di /modul.js, di-cache
├─  7 sesi harian (isi)  20,5 KB   digerbang jadwal -> lewat /api/sesi/:no
└─ metadata 7 sesi        1,5 KB   -> tetap publik: peta tujuh hari boleh terlihat
```

`/modul.js` tetap sama untuk semua orang dan tetap boleh di-cache — sifat itu
akan langsung hilang bila isinya berbeda per peserta, dan berkas publik yang
berbeda per peserta adalah kebocoran menunggu waktu bila kelak ada CDN di
depannya. Kuota peserta juga lebih hemat: 37,6 KB sekali (di-cache) + ±2,9 KB
per hari, dibanding 58,1 KB yang diunduh ulang tiap kali cache kedaluwarsa.

Batas hari memakai kalender **WIB**, bukan UTC. Tanpa itu sesi berikutnya baru
terbuka pukul 07.00 pagi, dan peserta yang membuka aplikasi subuh — sebelum
warung buka, salah satu kebiasaan yang justru ingin diamati — diberi tahu
sesinya belum terbuka padahal harinya sudah berganti.

---

## Validasi materi oleh ahli

Sebelum materi dipakai pada responden, kelayakan isinya dinilai validator ahli
lewat lembar tersendiri di **`/validasi`** — 25 butir pernyataan dalam 12 aspek,
skala Likert 1–5, lengkap dengan komentar per butir, catatan umum, rekomendasi
perbaikan, dan daftar materi yang perlu direvisi.

```
Persentase Kelayakan = (total skor diperoleh / skor maksimum) x 100%
```

Tiga hal yang membedakannya dari bagian aplikasi yang lain:

- **Kodenya sendiri.** Dibuka dengan `VALIDASI_KODE` dari `.env`, bukan kode
  peserta. Validator tidak pernah bisa membuka buku kas siapa pun, dan kode
  peserta tidak membuka lembar validasi.
- **Berkasnya sendiri.** Hasil masuk `data/validasi.json`, bukan `users.json` —
  jalur baru ini tidak boleh bisa merusak data peserta yang tidak dapat
  dikumpulkan dua kali.
- **Tidak ada hasil bawaan.** Sistem hanya menyediakan instrumen dan
  perhitungannya; seluruh angka berasal dari validator yang benar-benar mengisi.
  Skor dihitung ulang di server dari jawaban butirnya, bukan diambil dari angka
  yang dikirim peramban.

Hasil kumpulan tidak pernah bisa dibaca dengan kode validator. Dari mesin yang
punya shell ia dibaca lewat `npm run validasi`; dari mesin yang tidak punya
shell (Cloud Run) lewat `GET /api/validasi/hasil`, yang dijaga
`VALIDASI_PENGELOLA_KODE` — kode terpisah yang dipegang peneliti sendiri.
Selengkapnya: **[PANDUAN-VALIDASI.md](PANDUAN-VALIDASI.md)**.

---

## Pengaturan (`.env`)

| Variabel | Wajib | Arti |
|---|---|---|
| `ANTHROPIC_API_KEY` | salah satu | Kunci API Anthropic. Dipakai bila `GOOGLE_CLOUD_PROJECT` kosong. Tanpa keduanya aplikasi tetap jalan, tapi fitur AI nonaktif. |
| `GOOGLE_CLOUD_PROJECT` | salah satu | Memakai Vertex AI alih-alih kunci API. Begitu diisi, `ANTHROPIC_API_KEY` tidak dibaca lagi dan kredensial diambil dari Application Default Credentials. Lihat "Lewat Vertex AI" di bawah. |
| `CLOUD_ML_REGION` | tidak | Region Vertex, default `global`. Hanya berlaku pada jalur Vertex/Gemini. |
| `NOVA_AI_BACKEND` | tidak | `anthropic` \| `vertex` \| `gemini`. Kosong = perilaku lama. Nilai tak dikenali ditolak, tidak mundur diam-diam. |
| `GEMINI_MODEL` | tidak | Model Gemini, default `gemini-2.5-flash`. Hanya berlaku bila `NOVA_AI_BACKEND=gemini`. |
| `PORT` | tidak | Port server, default `3000`. |
| `RATE_LIMIT_PER_HOUR` | tidak | Batas JUMLAH permintaan AI per pengguna per jam, default `40`. Menjaga ledakan permintaan. |
| `TOKEN_BUDGET_DAILY` | tidak | Anggaran token per peserta per hari (WIB), default `10000` ≈ 2–3 pertanyaan. Menjaga tagihan. |
| `TOKEN_BUDGET_WEEKLY` | tidak | Anggaran token per peserta per minggu (Senin–Minggu), default `50000` ≈ 12–17 pertanyaan. |
| `NOVA_DATA_DIR` | tidak | Letak folder data. Default `server/data`. Pakai ini untuk memasang data di volume terpisah. |
| `FORCE_HTTPS` | **produksi** | Isi `1` agar permintaan HTTP polos ditolak. Biarkan kosong saat mengembangkan lokal. |
| `TRUST_PROXY` | **produksi** | Isi `1` bila di belakang Nginx, agar alamat IP asli terbaca. Jangan dinyalakan bila server terbuka langsung ke internet. |
| `LOGIN_MAX_ATTEMPTS` | tidak | Percobaan kode akses gagal per IP per 15 menit, default `20`. Kode yang benar selalu diterima. |
| `LOG_FORMAT` | **produksi** | `json` agar Cloud Logging mengenali `severity` dan medan tambahannya. Kosong = teks biasa. |
| `TZ` | **produksi** | `Asia/Jakarta`, agar cap waktu log terbaca setempat. Logika hari sudah memakai WIB secara eksplisit di kode. |
| `NOVA_HEALTH_CACHE_MS` | tidak | Selang cache hasil probe sehat, default `15000`. Samakan dengan selang probe Load Balancer bila perlu. |
| `NOVA_HEALTH_COUNT_MS` | tidak | Jeda minimum menghitung ulang jumlah peserta pada probe, default `60000`. Menghitung berarti mem-parse seluruh berkas data — pada 300 peserta itu 571 ms sekali jalan. |
| `SHUTDOWN_TIMEOUT_MS` | tidak | Batas menunggu permintaan & penulisan selesai saat berhenti, default `8000`. Harus lebih kecil dari `TimeoutStopSec` systemd. |
| `VALIDASI_KODE` | tidak | Kode untuk membuka lembar validasi materi di `/validasi`. Selama kosong, rute validasi menolak semua permintaan. Bukan kode peserta — lihat [PANDUAN-VALIDASI.md](PANDUAN-VALIDASI.md). |
| `PUBLIC_HOST` | **produksi** | Alamat resmi aplikasi, mis. `nova.contohdomain.id`. Tujuan pengalihan HTTPS. Tanpa ini server memakai header `Host` dari klien, yang bisa dipalsukan. |
| `BACKUP_KEEP` | tidak | Jumlah cadangan yang disimpan, default `14`. |
| `BACKUP_EVERY_HOURS` | tidak | Selang pencadangan otomatis, default `24`. |

---


### Lewat Vertex AI

Server memilih jalurnya dari ada-tidaknya `GOOGLE_CLOUD_PROJECT` — tidak ada
saklar tersendiri, supaya tidak pernah ada keadaan "memilih Vertex tapi tidak
tahu project mana".

Di Vertex tidak ada kunci yang dikirim: kredensial diambil dari Application
Default Credentials. Di laptop lewat `gcloud auth application-default login`,
di Cloud Run otomatis dari service account layanan.

Sebelum jalur ini bisa dipakai, tiga hal di sisi Google Cloud:

```bash
gcloud services enable aiplatform.googleapis.com

gcloud projects add-iam-policy-binding <PROJECT_ID> \
  --member=serviceAccount:<SA-RUNTIME> \
  --role=roles/aiplatform.user --condition=None
```

lalu **aktifkan Claude di Vertex AI → Model Garden** lewat Console dan setujui
syarat penggunaannya. Langkah ketiga ini manual dan tidak ada perintah
`gcloud`-nya; tanpa itu panggilan pertama gagal `403` walau IAM sudah benar.

Yang perlu diketahui sebelum berpindah:

- **Model Claude di Vertex adalah partner model.** Ketersediaan region berbeda
  dari Claude API, dan cakupan kredit percobaan Google Cloud tidak dijamin
  meliputinya. Periksa Billing → Credits sebelum menganggap pemakaiannya gratis.
- `CLOUD_ML_REGION` bawaannya `global`. Region yang tidak melayani Claude gagal
  sebagai `404` pada permintaan pertama, bukan saat server menyala.
- Sebagian fitur Claude API tidak ada di Vertex (web search, code execution,
  Batches, Files API). Tidak satu pun dipakai aplikasi ini — structured outputs
  dan adaptive thinking, yang justru dipakai, tersedia di keduanya.

### Lewat Gemini (`NOVA_AI_BACKEND=gemini`)

Prasyarat Google Cloud-nya **sama persis** dengan jalur Vertex di atas, kecuali
satu: Gemini tidak perlu diaktifkan manual di Model Garden.

```bash
gcloud run services update novaexplorer --region=asia-southeast2 \
  --update-env-vars=NOVA_AI_BACKEND=gemini,GOOGLE_CLOUD_PROJECT=<PROJECT_ID>,CLOUD_ML_REGION=global
```

Kenapa jalur ini ada: model Claude di Vertex dijual sebagai *partner model*, dan
kredit percobaan Google Cloud tidak menanggungnya. Gemini produk Google
langsung, jadi kredit itu berlaku — untuk penelitian yang anggarannya habis,
itu perbedaan antara fitur AI menyala dan mati.

Yang perlu diketahui:

- **Ini mengganti model yang dipakai peserta.** Kalau pengambilan data sudah
  dimulai, jangan berpindah di tengah jalan — gaya jawaban, panjang, dan
  kedalamannya berbeda, dan itu bagian dari perlakuan yang sedang diukur.
- `prompts.js` disetel untuk Claude. Jawaban Gemini dapat terasa berbeda
  sekalipun sistem prompt-nya sama persis; jalankan `npm run smoke` dan baca
  hasilnya sebelum menyerahkannya ke peserta.
- Rekomendasi memakai `responseJsonSchema`, sehingga `RECOMMENDATION_SCHEMA`
  yang sama dipakai kedua jalur tanpa disalin ke bentuk kedua.

## Struktur berkas

```
server/
├── server.js              Rute API + penyajian aplikasi
├── lib/
│   ├── claude.js          Pemanggilan Claude Sonnet 5 (chat streaming + rekomendasi)
│   ├── prompts.js         System prompt, skema JSON, ringkasan buku kas untuk AI
│   ├── cashbook.js        Buku kas: kategori, ringkasan bulanan, laba vs kas
│   ├── metrics.js         Perhitungan keuangan & skor kesehatan (deterministik)
│   ├── consent.js         Teks & versi persetujuan peserta
│   ├── guard.js           HTTPS, header keamanan, pembatas login
│   ├── aset.js            Aset besar dikompresi sekali saat start (164 KB -> 49 KB)
│   ├── backup.js          Cadangan otomatis + pemulihan
│   ├── kesehatan.js       Probe /api/health + penolakan start bila data tak bisa ditulis
│   ├── log.js             Log teks (manusia) atau JSON (Cloud Logging)
│   ├── jadwal.js          Gerbang jadwal: sesi mana yang sudah boleh dibuka
│   ├── validasi.js        Instrumen validasi materi + perhitungan skornya
│   ├── validasi-store.js  Penyimpanan hasil validasi (berkas terpisah)
│   └── store.js           Penyimpanan JSON dengan penulisan atomik
├── scripts/
│   ├── users.js           Alat kelola pengguna
│   ├── export.js          Ekspor data penelitian (npm run export)
│   ├── validasi.js        Baca & ekspor hasil validasi materi (npm run validasi)
│   └── backup.js          Cadangan & pemulihan (npm run backup)
├── test/
│   ├── periode.test.js    Uji regresi aturan periode
│   ├── penelitian.test.js Uji regresi garis dasar & jejak perilaku
│   ├── perlindungan.test.js Uji regresi persetujuan & cadangan
│   ├── pembatalan.test.js Uji panggilan AI berhenti saat peserta menutup aplikasi
│   ├── produksi.test.js   Uji kesiapan produksi: probe, gzip, noindex, penutupan
│   ├── jadwal.test.js     Uji gerbang jadwal (kalender WIB, gerbang maju)
│   ├── jadwal-rute.test.js Uji empat pintu penegakan jadwal
│   ├── validasi.test.js   Uji instrumen & perhitungan validasi materi
│   ├── validasi-rute.test.js Uji rute & penyimpanan lembar validasi
│   └── keamanan.test.js   Uji regresi HTTPS, header, pembatas login
├── deploy/
│   ├── nova.service       Unit systemd (Compute Engine / VPS)
│   └── nginx-nova.conf    Nginx: proxy_buffering off untuk aliran AI, HTTPS
├── Dockerfile             Citra produksi bila dijalankan sebagai kontainer
├── public/
│   ├── index.html         Aplikasi peserta (satu berkas)
│   └── validasi.html      Lembar validasi materi untuk validator ahli
└── data/
    ├── users.json         Data pengguna — TIDAK di-commit ke Git
    ├── validasi.json      Hasil validasi materi — TIDAK di-commit ke Git
    └── backup/            Cadangan otomatis — TIDAK di-commit ke Git
```

---

## Cara model dipakai

| Fitur | Model | Pengaturan | Alasan |
|---|---|---|---|
| Konsultasi chat | `claude-sonnet-5` | `thinking: disabled`, `effort: low`, streaming | Jawaban muncul cepat, terasa seperti mengobrol. |
| Rekomendasi personal | `claude-sonnet-5` | `thinking: adaptive`, `effort: medium`, structured outputs | Analisis butuh penalaran lebih dalam; skema JSON membuat hasilnya selalu bisa ditampilkan rapi. |

### Apa yang TIDAK dikirim ke AI

**Nama usaha dan lokasi tidak pernah ikut** ke prompt mana pun. Untuk warung
mikro keduanya mengenali: nama warung di Indonesia hampir selalu nama
pemiliknya ("Warung Bu Sari"), dan digabung satu kecamatan ia menunjuk satu
orang. Bukti bahwa repositori ini sendiri menganggapnya pengenal —
`npm run export -- --anonymize` menghapus persis medan-medan itu.

Yang hilang dari mutu jawaban hampir nol: model tidak pernah memerlukan nama
warung untuk menghitung HPP atau membaca margin. Yang tetap dikirim adalah yang
benar-benar mengubah isi nasihat — jenis usaha, produk utama, lama usaha, cara
mencatat, tujuan, angka hasil hitungan sistem, dan ringkasan buku kas.

Teks persetujuan peserta (`lib/consent.js`) menyebutkan keduanya secara
terpisah: apa yang dikirim, dan apa yang tidak. Uji regresi di
`test/perlindungan.test.js` memeriksa teks prompt yang **benar-benar** dikirim,
bukan niatnya.

### Apa yang dibaca AI

AI membaca **seluruh buku kas**, bukan beberapa bulan terakhir. Pemilik usaha yang
memindahkan dua tahun pembukuan fisik ke aplikasi ini berhak mendapat saran dari
seluruh catatannya — dan modelnya diberi tahu persis berapa bulan yang ia pegang,
supaya ia tidak pernah bicara soal tren dari sepotong data tanpa menyadarinya.

System prompt disusun dua blok, diurutkan dari yang paling jarang berubah:

| Blok | Isi | Berubah | Cache |
|---|---|---|---|
| 1 | Peran + daftar modul + **riwayat bulan yang sudah selesai** | sebulan sekali | ✅ ditandai `cache_control` |
| 2 | Profil usaha + angka + **bulan berjalan** | tiap kali mencatat | tidak |

Prompt caching bekerja atas awalan: satu byte berubah di depan membatalkan semua yang
di belakangnya. Karena itu tidak ada satu pun angka yang bergerak di blok 1 — termasuk
jumlah transaksi, yang sengaja hanya menghitung bulan-bulan yang sudah selesai.

Ambang minimum caching Sonnet 5 adalah **1024 token**. Blok peran saja hanya ~550 token,
jadi sebelum riwayat digabung ke dalamnya, penanda cache di aplikasi ini tidak berefek
apa pun. Pengguna dengan riwayat pendek tetap belum tercache — awalannya memang belum
cukup panjang, dan prompt-nya juga masih murah.

---

## Grafik

Dua grafik, SVG murni tanpa pustaka luar (ringan di ponsel lama, tetap jalan offline):

- **Sisa uang per hari** (dasbor & buku kas) — batang divergen di atas/bawah garis nol.
  Menjawab pertanyaan yang paling sering ditanya pemilik warung: *hari mana saya nombok?*
- **Laba bersih per bulan** (laporan KUR) — batang satu warna; bank melihat kestabilan.

### Kenapa warnanya biru–merah, bukan hijau–merah

Hijau untuk masuk dan merah untuk keluar adalah kebiasaan umum, tapi pasangan itu
**gagal uji buta warna merah-hijau** (ΔE 4.0 — praktis tidak terbedakan bagi sekitar
8% laki-laki). Untuk aplikasi uang, salah membaca surplus sebagai defisit itu bahaya
nyata. Pasangan biru–merah lolos semua uji dengan ΔE 21.6. Arah batang (naik/turun dari
garis nol) tetap menjadi penanda kedua, jadi warna tidak pernah jadi satu-satunya
pembawa makna. Setiap grafik juga punya tombol **"Lihat sebagai tabel angka"**.

Warna diuji dengan validator kontras/CVD, bukan dikira-kira.

---

## Periode — kenapa ini bagian tersendiri

Ini aturan paling penting di seluruh aplikasi, dan yang paling mudah dilanggar tanpa sadar.

Angka rupiah di buku kas adalah **jumlah sejauh ini**, sedangkan hampir semua label di
aplikasi berbunyi **per bulan**. Kalau keduanya dicampur, usaha yang penjualannya sama
sekali tidak berubah akan terlihat anjlok — bukan karena usahanya, tapi karena kalendernya
belum habis. Akibatnya berantai: omzet di dasbor seperti runtuh, batas cicilan sehat ikut
mengecil, rata-rata laba di laporan KUR turun, dan AI diberi "tren" penurunan palsu lalu
dengan patuh membunyikan alarm.

Karena itu setiap ringkasan bulan membawa periodenya sendiri:

| Field | Arti |
|---|---|
| `hariBerjalan` / `hariBulan` | berapa hari bulan itu sudah lewat, dari total harinya |
| `lengkap` | bulannya sudah habis |
| `cakupan` | bagian hari yang sudah lewat yang benar-benar ada catatannya |
| `setara` | angka yang sudah disetarakan ke sebulan penuh (laju harian × jumlah hari) |

Aturan pemakaiannya:

- Apa pun yang berlabel **per bulan** memakai `setara`, bukan angka mentah.
- **Bulan berjalan** boleh diproyeksikan (`setara`), karena sisa harinya memang belum terjadi.
- **Hari yang sudah lewat tapi tidak dicatat dihitung nol, tidak pernah ditebak.** Menaikkan
  bulan yang bolong seolah-olah penuh berarti mengarang uang yang tidak pernah dicatat.
- Bulan dengan cakupan < 60% tidak dipakai menggantikan perkiraan, dan tidak ikut rata-rata
  laporan KUR. Alasannya **ditampilkan** ke pengguna, bukan didiamkan.
- Rata-rata laba di laporan KUR hanya dari **bulan penuh yang tercatat rapat**. Bulan yang
  masih berjalan atau bolong tetap muncul di tabel dan grafik, diberi penanda, tapi di luar
  rata-rata.

Ambang 60% memberi kelonggaran untuk usaha yang tutup sehari-dua seminggu (libur tiap Minggu
tetap ~86%) tapi menolak bulan yang jelas cuma tercatat sepotong.

Aturan-aturan ini dijaga uji regresi di `test/periode.test.js` — semua kasusnya memakai usaha
dengan penjualan **benar-benar rata**, jadi apa pun yang berubah-ubah dalam hasil hitungan
pasti kesalahan periode, bukan kenyataan usahanya.

```bash
npm test
```

---

## Skor kesehatan keuangan

Skor 0–100 dari lima aspek, semuanya dihitung server:

| Aspek | Nilai | Dasar penilaian |
|---|---|---|
| Margin laba bersih | 30 | Dari buku kas bila ada, kalau tidak dari perkiraan |
| Kebiasaan mencatat | 20 | **Terukur** dari buku kas: hari tercatat ÷ hari sejak mulai memakai aplikasi |
| Uang usaha terpisah | 20 | Isian profil |
| Legalitas (NIB) | 15 | Isian profil |
| Lama usaha berjalan | 15 | Isian profil |

Perhatikan aspek kedua: jendelanya dihitung **sejak hari pertama pengguna memakai aplikasi**
(tanggal entri), bukan sejak tanggal 1 dan bukan pula sejak tanggal struk tertua.

- Sejak tanggal 1 itu salah: orang yang baru mulai tanggal 22 langsung dinilai jelek untuk
  21 hari sebelum dia mengenal aplikasi ini.
- Sejak tanggal struk tertua juga salah, dan lebih halus salahnya: begitu seseorang menyusul
  mencatat satu struk lama, jendelanya mundur ke belakang dan nilainya **jatuh** — dihukum
  justru karena mencatat lebih banyak. Dengan tanggal entri, menyusul mencatat tidak pernah
  bisa menurunkan nilai.

---

## Data & privasi

- Semua data pengguna ada di `server/data/users.json` — satu berkas, mudah di-backup dan dihapus.
- Berkas itu masuk `.gitignore`; profil usaha dan riwayat chat tidak akan ikut ter-commit.
- Kode akses disimpan sebagai hash SHA-256, bukan teks asli.
- Menghapus pengguna (`npm run users -- remove ... --yes`) menghapus profil, buku kas, dan riwayat chat-nya sekaligus.
- Riwayat percakapan yang dikirim ke Claude dibatasi 16 pesan terakhir agar biaya terkendali.

---

## Biaya

Aplikasi ini memakai **kunci API Anthropic milik pengelola**, dan setiap permintaan AI
ditagih. Dua pagar berbeda dipasang aplikasi ini sendiri, dan keduanya perlu:

| Pagar | Menjaga | Bawaan |
|---|---|---|
| `RATE_LIMIT_PER_HOUR` | ledakan permintaan | 40 permintaan/jam/peserta |
| `TOKEN_BUDGET_DAILY` / `TOKEN_BUDGET_WEEKLY` | **tagihan** | 10.000/hari, 50.000/minggu per peserta |

Batas per jam saja tidak cukup: menekan "Perbarui rekomendasi" dua belas kali dalam
semalam tidak melanggar batas per jam mana pun, tapi bisa menghabiskan biaya program
sebulan. Anggaran token diperiksa **sebelum** permintaan dikirim, memakai perkiraan
biaya — batas yang baru diperiksa sesudahnya bukan batas, melainkan laporan.

Ukuran sebenarnya, dari pengukuran prompt yang benar-benar dikirim:

| | satu pertanyaan chat | satu kali rekomendasi |
|---|---|---|
| peserta baru | ~2.900 token | ~4.800 token |
| setelah 12 bulan mencatat | ~3.800 token | ~5.700 token |
| setelah 24 bulan mencatat | ~4.700 token | ~6.600 token |

Jadi bawaan 10.000/hari ≈ 2–3 pertanyaan sehari, dan 50.000/minggu ≈ 12–17 pertanyaan
seminggu. Batas mingguan sengaja lebih kecil dari 7 × batas harian: yang harian
mencegah jatah seminggu habis dalam satu malam, yang mingguan menentukan plafonnya.

Token baca-cache dihitung **10%** sesuai tarifnya. Kalau dihitung penuh, peserta yang
paling rajin mencatat — bukunya paling panjang, jadi awalannya paling besar dan paling
banyak tercache — justru paling cepat kehabisan jatah, padahal biaya per pertanyaannya
paling murah. Menghukum ketekunan adalah kebalikan dari tujuan program ini.

Tarif Claude Sonnet 5: **$3 per 1 juta token masuk, $15 per 1 juta token keluar**
(tarif perkenalan $2/$10 berlaku sampai 31 Agustus 2026). Cache dibaca dengan tarif
sekitar **0,1×**, dan ditulis **1,25×** (TTL 5 menit).

Perkiraan kasar per pengguna aktif: satu tanya-jawab sekitar 2.000 token masuk dan
300 token keluar — beberapa ratus rupiah. Satu set rekomendasi lebih mahal karena
memakai penalaran penuh. Untuk pilot 5–10 pengguna, pantau lewat:

```bash
npm run users -- list     # menampilkan jumlah permintaan + token per pengguna
```

Kolom token di perintah itu diakumulasi dari `usage` setiap respons, jadi angkanya
nyata — bukan perkiraan.

---

## Menaikkan ke server sungguhan

Untuk pilot, jalankan di satu VPS kecil (mis. 1 GB RAM) di belakang Nginx dengan HTTPS:

1. `git clone` repositori, lalu `cd server && npm install --omit=dev`.
2. Buat `.env` berisi `ANTHROPIC_API_KEY`.
3. Jalankan lewat `systemd` atau `pm2` supaya otomatis hidup lagi kalau server restart.
4. Pasang Nginx sebagai reverse proxy ke `localhost:3000` dan aktifkan sertifikat Let's Encrypt.
   **Wajib HTTPS** — kode akses dikirim di header setiap permintaan.
   Lalu isi `FORCE_HTTPS=1` dan `TRUST_PROXY=1` di `.env`. Tanpa `TRUST_PROXY`,
   semua permintaan terlihat datang dari 127.0.0.1 dan satu penyerang akan
   mengunci pembatas login untuk **semua** peserta sekaligus.
5. Untuk Server-Sent Events (chat streaming), matikan buffering di Nginx:
   `proxy_buffering off;` pada lokasi `/api/chat`.
6. Backup `server/data/users.json` secara berkala.

---

## Batasan yang disengaja

- Tanpa database — satu berkas JSON. Cocok sampai puluhan pengguna, bukan ribuan.
  Sekitar 150 transaksi/bulan per pengguna masih sangat ringan; ribuan pengguna butuh database.
- Tanpa pendaftaran mandiri; pengguna ditambahkan manual sesuai kebutuhan pilot.
- Satu kode akses per pengguna, tanpa kata sandi. Sederhana untuk pilot, tapi bukan
  autentikasi tingkat perbankan — jangan simpan data yang sangat sensitif di sini.
- Aplikasi ini alat bantu belajar, **bukan** nasihat keuangan, pajak, atau hukum profesional.
