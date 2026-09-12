# Novaro

Aplikasi pendamping keuangan untuk pemilik UMKM Indonesia — buku kas harian,
skor kesehatan keuangan, konsultan AI, kurikulum micro-learning, laporan KUR
siap bank, check-up keuangan AI, dan kartu kesehatan usaha yang bisa
dibagikan.

## Fitur

| Fitur | Penjelasan |
|---|---|
| **Buku Kas** | Catat pemasukan/pengeluaran dalam 10 detik; prive dipisah dari biaya usaha; grafik surplus harian |
| **Pencarian & Filter** | Cari transaksi teks bebas, filter jenis & kategori — hasil instan, angka laporan tidak berubah |
| **Skor Kesehatan** | Skor 0–100 dari catatan nyata, lengkap dengan komponennya |
| **Garis Waktu Kesehatan** | Skor per bulan dari catatan nyata — bulan kosong tidak dikarang |
| **Apa yang Berubah?** | Perbandingan bulan ini vs bulan lalu: omzet, biaya, laba, ritme mencatat |
| **Check-up AI** | AI menilai status usaha dari angka buku kas — analisis edukatif, bukan keputusan kredit |
| **Simulasi KUR** | Geser jumlah & tenor, lihat cicilan (bunga flat 6%/tahun) dan status AMAN/KETAT/TERLALU BERAT terhadap laba nyata |
| **Laporan KUR** | Rekap 3–12 bulan format siap bank, cetak/simpan PDF |
| **Kartu Kesehatan Usaha** | Satu tautan publik baca-saja untuk memamerkan kondisi usaha — tanpa login, tanpa data sensitif |
| **Scan Nota** | Foto struk → AI mengisi transaksi → konfirmasi sebelum disimpan |

## Arsitektur singkat

```
Peramban (satu berkas HTML) ──► Server Node.js/Express ──► Gemini / Claude
                                      │
                                      └──► PostgreSQL atau berkas JSON
```

Semua angka keuangan dihitung server dengan rumus tetap; AI hanya menjelaskan
dan menilai status. Kunci API hanya hidup di server.

## Menjalankan

```bash
cd server
npm install
cp .env.example .env
npm start                       # → http://localhost:3000
```

Mode demo: buka halaman depan dan tekan **Coba Demo Tanpa Kode**, atau masuk
dengan kode **101–120** — lima persona usaha dengan ±3 bulan pembukuan contoh
yang diperbarui otomatis sampai hari ini.

## Pengujian

```bash
cd server
npm test                        # 535 uji regresi, layanan AI ditiru
```

## Catatan

Aplikasi ini alat bantu belajar dan pendampingan — **bukan** nasihat keuangan,
pajak, atau hukum profesional. Keputusan KUR sepenuhnya ada di bank.
