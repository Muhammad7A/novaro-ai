# Sesi D5 — Catatan Keputusan: Redaksi Persetujuan & Penyedia AI

**Status: DIPUTUSKAN & DIEKSEKUSI.** Pemilik menyetujui **Opsi 2** (redaksi akurat + `CONSENT_VERSION = 3`, persetujuan ulang diwajibkan mekanisme versi yang sudah ada) dan **menunda** penyebutan "Gemini" statis di `validasi.html` (di luar cakupan).

## Rekam eksekusi

- `consent.js`: redaksi poin "Apa yang dikirim ke layanan AI" kini menyebut kedua pemroses yang mungkin — Claude (Anthropic) **atau** Gemini (Google Cloud, lewat Vertex AI) sesuai pengaturan server — dan `CONSENT_VERSION = 3` dengan catatan sejarah versinya.
- Uji penguat: `perlindungan.test.js` kini mewajibkan redaksi menyebut **kedua** pemroses; `identitas-ai.test.js` mematrikan versi 3, penyebutan kedua jalur, dan `hasConsented(v2) === false` — partisipan lama WAJIB melihat layar persetujuan lagi.
- Sepuluh panggilan `saveConsent(..., 2)` yang di-hardcode di delapan berkas uji dimigrasi memakai konstanta `CONSENT_VERSION` — kenaikan versi berikutnya tidak akan merobek mereka diam-diam.
- Lantai kanonik setelah eksekusi: **535 pass / 0 fail / 0 skipped, exit 0** (`cd server && npm test`, Node v24 win32).

---

## A. Redaksi persis yang berlaku saat ini

`server/lib/consent.js:43` (poin "Apa yang dikirim ke layanan AI", `CONSENT_VERSION = 2`):

> "Saat kamu bertanya ke Konsultan AI atau meminta rekomendasi, sebagian datamu dikirim ke **layanan Claude (Anthropic)** untuk diproses: jenis usaha, produk utama, lama usaha, jumlah karyawan, cara mencatat, tujuanmu, angka keuangan hasil hitungan sistem, ringkasan buku kas termasuk keterangan pengeluaran terbesarmu, teks "tantangan terbesar" bila kamu mengisinya, dan pertanyaanmu sendiri."

## B. Mengapa redaksi ini tidak akurat

`NOVA_AI_BACKEND` memilih salah satu dari tiga jalur (`server/lib/backend.js`): `anthropic` (Claude, Anthropic), `vertex` (Claude di Vertex AI, Google Cloud), `gemini` (Gemini di Vertex AI, Google Cloud). Pada dua dari tiga konfigurasi, pemroses datanya adalah **Google Cloud**, bukan Anthropic. Pernyataan persetujuan yang menyebut pemroses yang salah adalah pernyataan faktual yang keliru di dalam instrumen penelitian — persis kelas kesalahan yang melahirkan versi 2 (redaksi v1 ternyata keliru; lihat komentar di consent.js).

## C. Perbaikan redaksi minimal

Satu kalimat, tanpa mengubah daftar data yang dikirim:

> "…sebagian datamu dikirim ke layanan AI yang dipakai server ini — **Claude (Anthropic) atau Gemini (Google Cloud, lewat Vertex AI)** — untuk diproses: …"

Tidak ada percabangan runtime di dalam teks persetujuan; kalimat netral mencakup ketiga konfigurasi yang sah. (Alternatif yang lebih presisi — menyisipkan nama pemroses aktual saat render dari `backendAI()` — menambah satu titik gagal pada instrumen dan membuat redaksi bervariasi per partisipan; tidak direkomendasikan.)

## D. Apakah redaksi netral penyedia sudah menyelesaikan masalah akurasi?

**Ya.** Semua jalur yang sah sudah tertutup kalimat di atas. Kalau kelak ditambah jalur penyedia baru, kalimat netral tidak otomatis menutupnya — itu risiko yang harus dicatat pemilik (lihat F).

## E. Apakah protokol yang berlaku mewajibkan persetujuan ulang partisipan?

Mekanisme yang sudah ada: `CONSENT_VERSION` + `hasConsented(user)` membandingkan `user.consent.versi` dengan versi teks aktif; versi baru **memaksa layar persetujuan muncul lagi** saat login berikutnya. Preceden sudah ada: v2 lahir justru karena pernyataan v1 keliru. Mengubah isi pengungkapan **siapa pemroses datanya** adalah perubahan substantif dari apa yang disetujui partisipan — protokol yang ada memang dirancang untuk kasus ini.

## F. Konsekuensi tiap opsi

| Opsi | Konsekuensi | Penilaian Sesi D |
|---|---|---|
| **1. Ganti redaksi tanpa menaikkan versi** | Partisipan yang setuju pada "Claude (Anthropic)" tiba-tiba tercatat menyetujui teks yang berbeda; rekam riset mengklaim persetujuan v2 sementara instrumennya sudah lain. Instrumen penelitian dimutasi diam-diam. | **Ditolak** — mendustakan rekam persetujuan. |
| **2. Ganti redaksi + `CONSENT_VERSION = 3`** | Jujur dan mekanismenya sudah ada. Biayanya: semua partisipan aktif melihat layar persetujuan lagi di login berikutnya (gesekan kecil, satu kali), dan analisis riset yang mengelompokkan per versi persetujuan harus menangani split v2/v3. | **Direkomendasikan** bila pemilik menerima persetujuan ulang. |
| **3. Biarkan apa adanya untuk sementara** | Tanpa gesekan apa pun, tetapi instrumen tetap menyatakan pemroses yang salah pada deploy gemini/vertex. Mitigasi sementara bila dipilih: batasi session partisipan hanya pada backend `anthropic` sampai opsi 2 dieksekusi (keputusan operasional pemilik, bukan kode Sesi D). | Dapat diterima hanya sebagai jeda eksplisit, bukan kondisi akhir. |

## Keputusan yang diminta dari pemilik

1. Pilih opsi 2 atau 3 (opsi 1 tidak layak).
2. Bila opsi 2: putuskan kenaikan versi dilakukan bersama pendaratan batch Sesi D ini atau di gelombang tersendiri.
3. Catat keputusan di dokumen keputusan utama program (kebiasaan repo: amend AI-TRUST/decision, bukan komentar kode).

Sesi D **berhenti di batas ini** dan tidak menyentuh `consent.js` tanpa persetujuan eksplisit.
