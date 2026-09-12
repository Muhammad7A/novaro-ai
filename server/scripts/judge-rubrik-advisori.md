# Rubrik Penilaian Advisori — LLM-as-Judge

> ## ⚠️ ALAT RISET — BUKAN GERBANG CI
> Rubrik ini dan skrip pendampingnya (`eval-judge-advisori.js`) adalah alat
> riset kualitatif untuk membandingkan **dua draft perubahan prompt**. Ia
> TIDAK PERNAH menjadi gerbang CI, tidak memblokir deploy, dan hasilnya tidak
> boleh disimpulkan menjadi satu angka mutu. Penilaian LLM atas LLM bukan
> kebenaran — ia sinyal yang layak diperiksa manusia.

## 1. Tujuan

Saat `lib/prompts.js` berubah, keluaran advisori bisa berubah nada, struktur,
atau kejujuran tanpa satu pun uji merah — golden set
(`eval-advisori.js`) menjaga BENTUK; rubrik ini menjalankan penilaian
KUALITATIF atas isi: apakah nasihatnya jujur, jelas, dan sesuai konteks
warungnya. Penilaian dilakukan berpasangan: **draft lama vs draft baru**
untuk kasus yang sama, dinilai buta (judge tidak tahu mana yang lama).

## 2. Peran judge

Judge adalah penilai teliti yang MENCARI PELANGGARAN, bukan pembaca ramah.
Setiap vonis wajib disertai **kutipan bukti** dari naskah yang dinilai.
Tanpa kutipan, vonis tidak sah dan dibuang oleh skrip penghitung.

## 3. Tiga dimensi (dinilai mandiri — JANGAN dirata-ratakan)

### a. Kejujuran (honesty)
- Tidak ada angka yang dikarang di luar angka konteks yang diberikan.
- Ketidakpastian dinyatakan dalam bahasa pengguna (mis. "perkiraan"),
  bukan dikubur atau dipalsukan yakin.
- Tidak mengklaim "dihitung sistem" untuk hal yang bukan keluaran server.
- Pelanggaran contoh: menyebut persentase margin yang tidak ada di konteks;
  menjanjikan hasil pasti ("laba naik 20%").

### b. Kejelasan (clarity)
- Bahasa sehari-hari pemilik warung Indonesia; tanpa jargon akuntansi
  (margin kontribusi, EBITDA, rasio lancar) kecuali dijelaskan langsung.
- Satu kalimat satu gagasan; perintah yang bisa ditindaklanjuti.
- Pelanggaran contoh: saran abstrak tanpa langkah; kalimat majemuk tiga
  anak kalimat; istilah asing tanpa terjemahan.

### c. Kesesuaian konteks (context fit)
- Saran relevan dengan situasi profil (margin tipis ≠ saran ekspansi).
- Tidak bertentangan dengan angka yang diberikan (saran menabung saat
- kas negatif adalah kegagalan konteks).
- Jenis usaha dikenali (saran "belanja bahan" untuk jasa laundry adalah
  kegagalan konteks).

## 4. Skala per dimensi

Tepat dua vonis — tidak boleh netral:

| Vonis | Arti |
|---|---|
| `layak` | Tidak ditemukan pelanggaran pada dimensi ini |
| `tak-layak` | Ada ≥1 pelanggaran, dengan kutipan |

Keputusan sulit tetap harus memihak: bila ragu antara dua, pilih `tak-layak`
dan tulis keraguannya di catatan — keraguan yang tercatat lebih jujur daripada
netralitas yang menyembunyikan.

## 5. Protokol buta

1. Jalankan `eval-judge-advisori.js --susun --a draftA.json --b draftB.json
   --keluar dir/` — menghasilkan satu paket per kasus: konteks profil +
   dua naskah berlabel acak "Naskah 1"/"Naskah 2" + `kunci-acak.json`.
2. Satu paket = satu sesi penilaian segar (judge tidak membawa ingatan
   kasus lain). Model, versi, dan suhu penilaian dicatat di kepala laporan.
3. `kunci-acak.json` DIBUKA HANYA SETELAH semua vonis terkumpul.

## 6. Format jawaban (satu objek JSON per kasus)

```json
{
  "kasus": "r01",
  "naskah1": {
    "kejujuran": "layak",
    "kejujuranBukti": "…kutipan…",
    "kejelasan": "tak-layak",
    "kejelasanBukti": "…kutipan…",
    "konteks": "layak",
    "konteksBukti": "…kutipan…"
  },
  "naskah2": { "…": "sama" },
  "catatan": "opsional"
}
```

Baris-baris JSON itu disimpan sebagai `hasil.jsonl`, lalu dihitung:
`eval-judge-advisori.js --hitung --hasil dir/hasil.jsonl --kunci
dir/kunci-acak.json`.

## 7. Aturan pelaporan — agreement antar-draft, bukan angka tunggal

Laporan yang sah HANYA matriks persetujuan per dimensi:

| | Draft B layak | Draft B tak-layak |
|---|---|---|
| **Draft A layak** | keduanya layak | hanya Draft A |
| **Draft A tak-layak** | hanya Draft B | keduanya tak-layak |

- DILARANG merata-ratakan dimensi menjadi satu skor.
- DILARANG menghitung "persentase mutu" lintas kasus tanpa matriks.
- Divergensi (hanya-A / hanya-B) adalah BAGIAN PALING PENTING dari laporan:
  daftarkan kasusnya dengan kutipan, karena di sanalah perubahan prompt
  benar-benar mengubah perilaku.
- Kesimpulan riset yang sah bentuknya: "pada N kasus, dimensi kejelasan
  berdivergensi k kasus menguntungkan Draft B, dengan bukti berikut" —
  keputusan tetap milik manusia.
