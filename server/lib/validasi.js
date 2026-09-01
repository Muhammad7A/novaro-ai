/**
 * Instrumen validasi materi pembelajaran Novaro — SUMBER TUNGGAL.
 *
 * Berkas ini memuat tiga hal, dan hanya tiga hal:
 *   1. Daftar aspek dan butir pernyataan yang dinilai validator ahli.
 *   2. Skala penilaian dan kriteria interpretasi yang dipakai penelitian ini.
 *   3. Perhitungan skor — fungsi murni, tanpa penyimpanan dan tanpa jaringan.
 *
 * ------------------------------------------------------------------
 * YANG TIDAK DILAKUKAN BERKAS INI, DAN TIDAK BOLEH DILAKUKAN
 *
 * Tidak ada satu pun data hasil validasi yang dibuat di sini. Tidak ada contoh
 * jawaban, tidak ada data awal, tidak ada nilai bawaan. Sistem ini hanya
 * menyediakan instrumen dan perhitungannya; seluruh angka harus datang dari
 * validator sungguhan yang mengisi formulir. Instrumen validasi yang membawa
 * hasil bikinan sendiri bukan alat ukur — ia justru menghapus satu-satunya hal
 * yang membuat validasi ada gunanya.
 *
 * Karena itu juga: `hitungHasil` menolak menghitung butir yang tidak dijawab,
 * bukan menganggapnya bernilai 3. Butir kosong dilaporkan apa adanya sebagai
 * kosong.
 *
 * ------------------------------------------------------------------
 * DARI MANA BUTIRNYA DIAMBIL
 *
 * Setiap butir menunjuk materi yang BENAR-BENAR ada di `kurikulum.js` — nomor
 * modulnya dicantumkan di medan `modul`, dan uji `validasi.test.js` menolak
 * nomor yang tidak ada di kurikulum. Ini bukan formalitas: instrumen yang
 * menanyakan materi yang tidak pernah ditulis akan menghasilkan skor rendah
 * yang tidak bisa ditindaklanjuti, dan validator akan kehilangan kepercayaan
 * pada seluruh lembarnya pada butir pertama yang tidak dia temukan.
 *
 * Pernyataan sengaja dibuat dapat diamati ("contoh berangka benar secara
 * aritmetika", "istilah dijelaskan sebelum dipakai"), bukan penilaian selera
 * ("materinya bagus"). Butir yang tidak bisa diperiksa dengan membuka modulnya
 * tidak dimasukkan.
 *
 * ------------------------------------------------------------------
 * BENTUK SATU BUTIR
 *
 *   kode        B01..B25, tetap dan tidak dipakai ulang. Kode ini tersimpan di
 *               `data/validasi.json` milik validator yang sudah mengisi; menukar
 *               artinya berarti mengubah jawaban orang yang sudah selesai.
 *   aspek       kunci ke ASPEK di bawah.
 *   pernyataan  kalimat yang dinilai 1-5.
 *   modul       nomor modul yang perlu dibuka validator untuk memeriksanya.
 *   rujukan     petunjuk baca untuk validator (modul dan/atau halaman aplikasi).
 */

/* ------------------------------------------------------------------ Versi */

/**
 * Versi instrumen, ikut tersimpan pada setiap hasil.
 *
 * Kalau butir diubah setelah ada validator yang mengisi, hasil lama tetap bisa
 * dibedakan dari hasil baru. Tanpa penanda ini, dua lembar dengan susunan butir
 * berbeda akan terlihat sama persis di berkas data — dan rata-ratanya menjadi
 * angka yang tidak berarti apa-apa.
 */
export const INSTRUMEN_VERSI = 1;

/* ------------------------------------------------------------------ Skala */

/** Skala Likert 1-5 yang dipakai seluruh butir. */
export const SKALA = [
  { nilai: 1, label: 'Sangat Tidak Layak' },
  { nilai: 2, label: 'Tidak Layak' },
  { nilai: 3, label: 'Cukup Layak' },
  { nilai: 4, label: 'Layak' },
  { nilai: 5, label: 'Sangat Layak' },
];

export const SKOR_MIN = 1;
export const SKOR_MAKS = 5;

/* ------------------------------------------------- Kriteria interpretasi */

/**
 * Kriteria interpretasi persentase kelayakan YANG DIPAKAI PENELITIAN INI.
 *
 * Ini bukan standar universal dan tidak boleh ditulis sebagai standar universal.
 * Ia adalah kriteria yang ditetapkan dan dilaporkan sendiri oleh penelitian
 * Novaro, sehingga pembaca laporan bisa menilai kesimpulannya dengan
 * ukuran yang sama. Kalau naskah penelitian memakai rentang lain, ubah di sini —
 * satu tempat — supaya lembar validator, perhitungan, dan naskah tidak pernah
 * menyebut tiga angka yang berbeda.
 *
 * `batasBawah` memakai perbandingan "lebih besar dari", sedangkan `rentang`
 * menuliskan bentuk bulatnya. Keduanya konsisten: rentang 61-80% berarti
 * "di atas 60% sampai dengan 80%", jadi 80,0% masuk Layak dan 80,1% masuk
 * Sangat Layak. Perlu ditulis eksplisit karena persentase di sini jarang bulat —
 * 25 butir tidak membagi 100 dengan rapi.
 */
export const KATEGORI = [
  { kunci: 'sangat-layak', label: 'Sangat Layak', rentang: '81–100%', batasBawah: 80 },
  { kunci: 'layak', label: 'Layak', rentang: '61–80%', batasBawah: 60 },
  { kunci: 'cukup-layak', label: 'Cukup Layak', rentang: '41–60%', batasBawah: 40 },
  { kunci: 'kurang-layak', label: 'Kurang Layak', rentang: '21–40%', batasBawah: 20 },
  { kunci: 'tidak-layak', label: 'Tidak Layak', rentang: '0–20%', batasBawah: -Infinity },
];

/** @returns {object} kategori interpretasi untuk sebuah persentase (0-100). */
export function kategoriKelayakan(persen) {
  const n = Number(persen);
  if (!Number.isFinite(n)) return KATEGORI.at(-1);
  return KATEGORI.find((k) => n > k.batasBawah) ?? KATEGORI.at(-1);
}

/* ------------------------------------------------------------------ Aspek */

export const ASPEK = [
  { kunci: 'A1', nama: 'Kesesuaian materi dengan tujuan pembelajaran' },
  { kunci: 'A2', nama: 'Ketepatan konsep akuntansi dan cloud accounting' },
  { kunci: 'A3', nama: 'Kebenaran informasi dan contoh yang diberikan' },
  { kunci: 'A4', nama: 'Kesesuaian materi dengan kebutuhan pelaku usaha kuliner mikro' },
  { kunci: 'A5', nama: 'Kejelasan bahasa dan istilah' },
  { kunci: 'A6', nama: 'Sistematika dan urutan penyajian materi' },
  { kunci: 'A7', nama: 'Kesesuaian materi dengan pendekatan micro-learning' },
  { kunci: 'A8', nama: 'Keseimbangan antara penjelasan, contoh, dan latihan' },
  { kunci: 'A9', nama: 'Kemudahan materi dipahami pengguna non-akuntansi' },
  { kunci: 'A10', nama: 'Kesesuaian tingkat kesulitan materi' },
  { kunci: 'A11', nama: 'Relevansi materi terhadap praktik pencatatan keuangan usaha' },
  { kunci: 'A12', nama: 'Konsistensi materi antar modul' },
];

/* ------------------------------------------------------------------ Butir */

export const BUTIR = [
  /* --- A1. Kesesuaian materi dengan tujuan pembelajaran --- */
  {
    kode: 'B01',
    aspek: 'A1',
    pernyataan:
      'Tujuh sesi jalur dasar (modul 1–7) tersusun sebagai satu rangkaian utuh yang mengantar pengguna dari memisahkan uang usaha dan uang pribadi (sesi 1) sampai menyusun laporan bulanan dan berkas pengajuan KUR (sesi 7).',
    modul: [1, 2, 3, 4, 5, 6, 7],
    rujukan: 'Modul 1–7 (jalur dasar), halaman Modul',
  },
  {
    kode: 'B02',
    aspek: 'A1',
    pernyataan:
      'Setiap modul ditutup dengan satu tugas praktik yang dapat dikerjakan langsung di aplikasi — misalnya mencatat transaksi di halaman Buku Kas (modul 3) dan membaca angka Laba bersih di Dasbor (modul 4) — sehingga ketercapaian tujuan tiap sesi dapat diamati.',
    modul: [3, 4],
    rujukan: 'Bagian "Praktik" pada setiap modul; halaman Buku Kas dan Dasbor',
  },

  /* --- A2. Ketepatan konsep akuntansi dan cloud accounting --- */
  {
    kode: 'B03',
    aspek: 'A2',
    pernyataan:
      'Konsep akuntansi pokok dinyatakan secara tepat: rumus laba kotor dan laba bersih (modul 4), persamaan Harta = Utang + Modal (modul 15), serta perlakuan prive yang mengurangi saldo kas tetapi tidak mengurangi laba (modul 1 dan 8).',
    modul: [1, 4, 8, 15],
    rujukan: 'Modul 4, 15, 1, dan 8',
  },
  {
    kode: 'B04',
    aspek: 'A2',
    pernyataan:
      'Konsep cloud accounting pada modul 2 dinyatakan secara tepat: data tersimpan di server dan dapat dibuka dari perangkat mana pun dengan kode akses, penghitungan saldo dan laba dilakukan otomatis, serta perubahan data meninggalkan jejak yang dapat ditelusuri.',
    modul: [2],
    rujukan: 'Modul 2 — "Cloud accounting: catatan yang tidak bisa hilang"',
  },

  /* --- A3. Kebenaran informasi dan contoh --- */
  {
    kode: 'B05',
    aspek: 'A3',
    pernyataan:
      'Contoh berangka yang disajikan benar secara aritmetika dan konsisten — antara lain HPP es teh manis Rp 1.070 per gelas dan ayam geprek Rp 11.100 per porsi (modul 5), serta laporan bulanan warung nasi dengan laba kotor Rp 12.500.000 dan laba bersih Rp 7.490.000 (modul 4).',
    modul: [4, 5],
    rujukan: 'Modul 5 (contoh HPP) dan modul 4 (contoh laporan sebulan)',
  },
  {
    kode: 'B06',
    aspek: 'A3',
    pernyataan:
      'Informasi mengenai cloud accounting yang disajikan tidak menimbulkan miskonsepsi: bagian "Yang sering dikira, padahal keliru" pada modul 2 meluruskan anggapan umum (hanya untuk perusahaan besar, harus memasang aplikasi berat, alatnya yang mengambil keputusan) tanpa menjanjikan hal yang tidak dilakukan aplikasi.',
    modul: [2],
    rujukan: 'Modul 2, bagian "Yang sering dikira, padahal keliru" dan "Di aplikasi ini"',
  },
  {
    kode: 'B07',
    aspek: 'A3',
    pernyataan:
      'Informasi tentang pajak UMKM (modul 30), legalitas usaha (modul 31), dan pengajuan KUR (modul 32) disampaikan tanpa angka atau ketentuan yang berisiko keliru, dan mengarahkan pengguna memastikan sendiri ke KPP, dinas terkait, atau bank penyalur.',
    modul: [30, 31, 32],
    rujukan: 'Modul 30, 31, dan 32 (jalur Modal & legalitas)',
  },

  /* --- A4. Kesesuaian dengan kebutuhan pelaku usaha kuliner mikro --- */
  {
    kode: 'B08',
    aspek: 'A4',
    pernyataan:
      'Contoh transaksi dan jenis usaha yang dipakai sesuai dengan kondisi usaha kuliner mikro sehari-hari — warung soto, warung nasi, ayam geprek, es teh, dan belanja pasar harian — termasuk kisaran nominal rupiahnya.',
    modul: [1, 3, 4, 5],
    rujukan: 'Modul 1, 3, 4, dan 5',
  },
  {
    kode: 'B09',
    aspek: 'A4',
    pernyataan:
      'Materi mencakup persoalan yang khas usaha kuliner: stok bahan segar dan FIFO (modul 11), makanan dan bahan terbuang (modul 22), serta penjualan lewat aplikasi pesan-antar (modul 25) dan pembayaran QRIS (modul 26).',
    modul: [11, 22, 25, 26],
    rujukan: 'Modul 11, 22, 25, dan 26',
  },

  /* --- A5. Kejelasan bahasa dan istilah --- */
  {
    kode: 'B10',
    aspek: 'A5',
    pernyataan:
      'Setiap istilah teknis dijelaskan dengan bahasa sehari-hari pada saat pertama kali dipakai — prive (modul 1), HPP dan margin (modul 5), FIFO (modul 11), penyusutan (modul 17), dan titik impas (modul 19).',
    modul: [1, 5, 11, 17, 19],
    rujukan: 'Modul 1, 5, 11, 17, dan 19',
  },
  {
    kode: 'B11',
    aspek: 'A5',
    pernyataan:
      'Kalimat yang dipakai pendek dan lugas, tanpa istilah asing yang dibiarkan tanpa padanan, sehingga terbaca oleh pemilik usaha yang membacanya lewat ponsel di sela jam berjualan.',
    modul: [],
    rujukan: 'Seluruh 29 modul, terutama jalur dasar (modul 1–7)',
  },

  /* --- A6. Sistematika dan urutan penyajian --- */
  {
    kode: 'B12',
    aspek: 'A6',
    pernyataan:
      'Urutan sesi harian tersusun runtut dan tiap sesi berdiri di atas sesi sebelumnya: memisahkan uang (1) → mengenal cloud accounting (2) → mencatat buku kas (3) → menghitung laba rugi (4) → menghitung HPP dan harga jual (5) → mengoreksi catatan (6) → menyusun laporan (7).',
    modul: [1, 2, 3, 4, 5, 6, 7],
    rujukan: 'Modul 1–7, dibaca berurutan',
  },
  {
    kode: 'B13',
    aspek: 'A6',
    pernyataan:
      'Setiap modul mengikuti pola penyajian yang sama: judul, ringkasan satu kalimat, bagian isi yang masing-masing berjudul, penerapan pada aplikasi bila relevan, lalu tugas praktik.',
    modul: [1, 2, 3],
    rujukan: 'Bandingkan susunan modul 1, 2, dan 3 dengan modul pustaka mana pun',
  },

  /* --- A7. Kesesuaian dengan pendekatan micro-learning --- */
  {
    kode: 'B14',
    aspek: 'A7',
    pernyataan:
      'Perkiraan waktu baca tiap modul sesuai dengan pendekatan micro-learning: 10–15 menit untuk sesi harian dan 7–10 menit untuk modul pustaka, sehingga satu modul dapat diselesaikan dalam sekali duduk.',
    modul: [],
    rujukan: 'Perkiraan menit yang tertera pada setiap kartu modul',
  },
  {
    kode: 'B15',
    aspek: 'A7',
    pernyataan:
      'Materi disodorkan sedikit demi sedikit: pengguna hanya berhadapan dengan satu sesi per hari, sedangkan 22 modul pustaka baru dibuka sesudahnya — bukan seluruh materi sekaligus pada hari pertama.',
    modul: [],
    rujukan: 'Halaman Modul: kartu "sesi hari ini" dan daftar pustaka jalur lanjutan',
  },

  /* --- A8. Keseimbangan penjelasan, contoh, dan latihan --- */
  {
    kode: 'B16',
    aspek: 'A8',
    pernyataan:
      'Setiap modul memuat ketiganya dalam porsi yang seimbang — penjelasan konsep, contoh berangka, dan tugas praktik — dan tidak ada modul yang hanya berisi penjelasan tanpa contoh atau tanpa latihan.',
    modul: [3, 5, 19],
    rujukan: 'Modul 3, 5, dan 19 sebagai pembanding',
  },
  {
    kode: 'B17',
    aspek: 'A8',
    pernyataan:
      'Tugas praktik dapat dikerjakan dalam waktu singkat memakai data usaha sendiri — misalnya "hitung HPP satu menu andalanmu" (modul 5) dan "lakukan tutup buku hari ini" (modul 6) — bukan latihan yang memerlukan data tambahan dari luar.',
    modul: [5, 6],
    rujukan: 'Bagian "Praktik" pada modul 5 dan 6',
  },

  /* --- A9. Kemudahan dipahami pengguna non-akuntansi --- */
  {
    kode: 'B18',
    aspek: 'A9',
    pernyataan:
      'Konsep akuntansi disampaikan lewat situasi nyata warung — misalnya membedakan omzet, laba, dan saldo kas dari uang yang ada di laci (modul 1 dan 4) — sehingga dapat dipahami tanpa latar belakang akuntansi.',
    modul: [1, 4],
    rujukan: 'Modul 1 dan 4',
  },
  {
    kode: 'B19',
    aspek: 'A9',
    pernyataan:
      'Materi jalur dasar dapat diikuti tanpa menguasai jurnal, debit-kredit, atau istilah pembukuan formal lainnya.',
    modul: [1, 2, 3, 4, 5, 6, 7],
    rujukan: 'Modul 1–7 (jalur dasar)',
  },

  /* --- A10. Kesesuaian tingkat kesulitan --- */
  {
    kode: 'B20',
    aspek: 'A10',
    pernyataan:
      'Tingkat kesulitan naik bertahap: jalur dasar berisi konsep pokok, sedangkan materi yang menuntut perhitungan lebih rumit — neraca (modul 16), penyusutan (modul 17), biaya tetap dan variabel (modul 18), titik impas (modul 19) — ditempatkan di jalur lanjutan.',
    modul: [16, 17, 18, 19],
    rujukan: 'Bandingkan jalur dasar (modul 1–7) dengan modul 16–19',
  },
  {
    kode: 'B21',
    aspek: 'A10',
    pernyataan:
      'Tidak ada perhitungan pada jalur dasar yang melampaui kemampuan hitung pemilik usaha kuliner mikro pada umumnya; perhitungan yang diminta terbatas pada penjumlahan, pengurangan, perkalian, dan pembagian sederhana.',
    modul: [3, 4, 5],
    rujukan: 'Modul 3 (saldo akhir), 4 (laba), dan 5 (HPP dan pengali harga jual)',
  },

  /* --- A11. Relevansi terhadap praktik pencatatan keuangan usaha --- */
  {
    kode: 'B22',
    aspek: 'A11',
    pernyataan:
      'Buku kas lima kolom beserta daftar kategori pemasukan dan pengeluaran pada modul 3 dapat langsung diterapkan pada pencatatan harian, dan selaras dengan pilihan kategori yang benar-benar tersedia di halaman Buku Kas aplikasi.',
    modul: [3],
    rujukan: 'Modul 3, dibandingkan dengan pilihan kategori di halaman Buku Kas',
  },
  {
    kode: 'B23',
    aspek: 'A11',
    pernyataan:
      'Materi koreksi kesalahan dan tutup buku harian (modul 6) menjawab persoalan pencatatan yang nyata dihadapi pemilik usaha: salah golongan, transaksi tercatat dua kali, dan lupa mencatat sehari.',
    modul: [6],
    rujukan: 'Modul 6 — "Salah catat, koreksi, dan jejak perubahan"',
  },

  /* --- A12. Konsistensi antar modul --- */
  {
    kode: 'B24',
    aspek: 'A12',
    pernyataan:
      'Istilah dan penggolongan yang sama dipakai dengan arti yang sama di seluruh modul — "prive", "belanja bahan", "biaya operasional", "laba kotor", dan "laba bersih" tidak berubah makna antara modul 1, 3, 4, dan 8.',
    modul: [1, 3, 4, 8],
    rujukan: 'Modul 1, 3, 4, dan 8',
  },
  {
    kode: 'B25',
    aspek: 'A12',
    pernyataan:
      'Rujukan silang antar modul ("lihat modul 8", "modul 17", "modul 19", "modul 24") mengarah ke modul yang isinya memang sesuai dengan yang disebutkan.',
    modul: [8, 11, 17, 19, 24],
    rujukan: 'Modul 3, 8, 9, 22, dan 23 — periksa nomor yang mereka rujuk',
  },
];

/* ------------------------------------------------------------ Kesimpulan */

/**
 * Kesimpulan kelayakan menurut validator.
 *
 * Sengaja TERPISAH dari kategori hasil hitungan. Persentase adalah rangkuman
 * angka; kesimpulan adalah keputusan ahli. Membiarkan angka menimpa keputusan
 * itu — misalnya menuliskan "Sangat Layak" sebagai kesimpulan hanya karena
 * skornya 84% — menghapus justru bagian yang paling bernilai dari validasi
 * ahli. Keduanya disimpan, dan boleh berbeda.
 */
export const KESIMPULAN = [
  { kunci: 'layak-tanpa-revisi', label: 'Layak digunakan tanpa revisi' },
  { kunci: 'layak-revisi-kecil', label: 'Layak digunakan dengan revisi kecil' },
  { kunci: 'layak-revisi-besar', label: 'Layak digunakan setelah revisi besar' },
  { kunci: 'belum-layak', label: 'Belum layak digunakan' },
];

/** Bidang keahlian validator. Boleh lebih dari satu, dan boleh diisi sendiri. */
export const BIDANG = [
  'Akuntansi / keuangan',
  'Cloud accounting / sistem informasi akuntansi',
  'Pendidikan & pembelajaran',
  'Pengembangan produk atau media edukasi',
  'Pendampingan UMKM',
];

/* --------------------------------------------------------------- Turunan */

export const KODE_BUTIR = BUTIR.map((b) => b.kode);
export const JUMLAH_BUTIR = BUTIR.length;
/** Skor maksimum bila SELURUH butir dinilai. 25 butir x 5 = 125. */
export const SKOR_MAKSIMUM_PENUH = JUMLAH_BUTIR * SKOR_MAKS;

/** @returns {object|null} satu butir menurut kodenya. */
export function cariButir(kode) {
  return BUTIR.find((b) => b.kode === kode) ?? null;
}

/** @returns {object|null} satu aspek menurut kuncinya. */
export function cariAspek(kunci) {
  return ASPEK.find((a) => a.kunci === kunci) ?? null;
}

/** Butir-butir milik satu aspek, urut kode. */
export function butirAspek(kunci) {
  return BUTIR.filter((b) => b.aspek === kunci);
}

/** Instrumen lengkap untuk dikirim ke halaman validator. */
export function instrumen() {
  return {
    versi: INSTRUMEN_VERSI,
    skala: SKALA,
    /*
     * `batasBawah` ikut dikirim supaya halaman validator memakai ambang yang
     * SAMA PERSIS dengan server saat menampilkan kategori sementara. Kalau
     * halaman menebak ambangnya sendiri dari teks rentang, ia akan menyimpang
     * begitu rentangnya diubah — dan validator melihat label yang berbeda dari
     * label pada lembar hasilnya sendiri. -Infinity tidak selamat melewati
     * JSON, jadi baris terakhir dikirim sebagai null dan dibaca "selalu cocok".
     */
    kategori: KATEGORI.map((k) => ({ ...k, batasBawah: Number.isFinite(k.batasBawah) ? k.batasBawah : null })),
    kesimpulan: KESIMPULAN,
    bidang: BIDANG,
    jumlahButir: JUMLAH_BUTIR,
    skorMaksimum: SKOR_MAKSIMUM_PENUH,
    aspek: ASPEK.map((a) => ({ ...a, butir: butirAspek(a.kunci) })),
  };
}

/* ----------------------------------------------------------- Perhitungan */

/** Skor yang sah: bilangan bulat 1-5. Selain itu dianggap belum dinilai. */
export function skorSah(nilai) {
  const n = Number(nilai);
  return Number.isInteger(n) && n >= SKOR_MIN && n <= SKOR_MAKS;
}

/**
 * Membaca satu jawaban HANYA bila ia milik obyeknya sendiri.
 *
 * `jawaban?.[kode]` biasa akan ikut menyusuri rantai prototipe. Untuk kunci
 * B01-B25 itu tidak pernah menemukan apa pun di Object.prototype, jadi bukan
 * lubang keamanan — tapi obyek yang prototipenya sengaja diisi (`{ __proto__:
 * { B01: 5 } }`) akan terbaca seolah-olah butir B01 dijawab 5. Nilai yang tidak
 * pernah ditulis validator tidak boleh bisa masuk hitungan lewat pintu mana pun.
 */
const ambilJawaban = (jawaban, kode) =>
  jawaban && typeof jawaban === 'object' && Object.hasOwn(jawaban, kode) ? jawaban[kode] : undefined;

/** Membulatkan ke dua angka di belakang koma tanpa menyisakan -0. */
const bulat2 = (n) => Number((Math.round(n * 100) / 100).toFixed(2));

/**
 * Persentase kelayakan.
 *
 *   Persentase Kelayakan = (total skor diperoleh / skor maksimum) x 100%
 *
 * Dibulatkan ke dua angka di belakang koma, DAN kategorinya diambil dari angka
 * yang sudah dibulatkan itu — bukan dari angka mentahnya. Kalau keduanya
 * memakai dasar yang berbeda, sebuah lembar bisa menampilkan "80,00%" dengan
 * label "Sangat Layak" karena angka mentahnya 80,004. Selisihnya tidak berarti
 * secara ilmiah, tapi lembar yang menyangkal dirinya sendiri di layar validator
 * adalah lembar yang tidak akan dipercaya.
 */
export function persentaseKelayakan(skor, maksimum) {
  if (!maksimum) return 0;
  return bulat2((skor / maksimum) * 100);
}

/**
 * Menghitung hasil satu lembar validasi.
 *
 * `jawaban` berbentuk { B01: { skor, komentar }, ... } atau { B01: 4, ... }.
 * Butir yang tidak dijawab TIDAK dihitung dan tidak dianggap bernilai apa pun;
 * ia dilaporkan di `belumDinilai`, dan `skorMaksimum` hanya menjumlahkan butir
 * yang benar-benar dinilai. Dengan begitu persentase lembar yang belum lengkap
 * tetap punya arti — dan tetap jelas bahwa ia belum lengkap.
 */
export function hitungHasil(jawaban = {}) {
  const nilai = (kode) => {
    const j = ambilJawaban(jawaban, kode);
    const skor = j && typeof j === 'object' ? j.skor : j;
    return skorSah(skor) ? Number(skor) : null;
  };

  const dinilai = [];
  const belumDinilai = [];
  for (const b of BUTIR) {
    const n = nilai(b.kode);
    if (n === null) belumDinilai.push(b.kode);
    else dinilai.push({ kode: b.kode, aspek: b.aspek, skor: n });
  }

  const skorDiperoleh = dinilai.reduce((s, b) => s + b.skor, 0);
  const skorMaksimum = dinilai.length * SKOR_MAKS;
  const persentase = persentaseKelayakan(skorDiperoleh, skorMaksimum);

  const aspek = ASPEK.map((a) => {
    const isi = dinilai.filter((b) => b.aspek === a.kunci);
    const skor = isi.reduce((s, b) => s + b.skor, 0);
    const maks = isi.length * SKOR_MAKS;
    const persen = persentaseKelayakan(skor, maks);
    return {
      kunci: a.kunci,
      nama: a.nama,
      butirDinilai: isi.length,
      butirTotal: butirAspek(a.kunci).length,
      skor,
      skorMaksimum: maks,
      persentase: persen,
      kategori: isi.length ? kategoriKelayakan(persen).kunci : null,
    };
  });

  return {
    instrumenVersi: INSTRUMEN_VERSI,
    butirDinilai: dinilai.length,
    butirTotal: JUMLAH_BUTIR,
    lengkap: dinilai.length === JUMLAH_BUTIR,
    belumDinilai,
    skorDiperoleh,
    skorMaksimum,
    persentase,
    // Rata-rata skor per butir — angka yang lazim dilaporkan berdampingan
    // dengan persentase pada penelitian dengan skala Likert.
    rataButir: dinilai.length ? bulat2(skorDiperoleh / dinilai.length) : 0,
    kategori: dinilai.length ? kategoriKelayakan(persentase) : null,
    aspek,
  };
}

/* -------------------------------------------------------- Pemeriksaan isi */

const teks = (v, maks) => String(v ?? '').trim().slice(0, maks);

const BATAS = {
  nama: 100,
  institusi: 150,
  jabatan: 100,
  bidangLain: 100,
  komentar: 600,
  catatan: 3000,
  revisiCatatan: 600,
  revisiMaks: 30,
};

/** Tanggal YYYY-MM-DD yang benar-benar ada di kalender. */
function tanggalSah(nilai) {
  const t = teks(nilai, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const d = new Date(`${t}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== t ? null : t;
}

/**
 * Memeriksa dan merapikan satu pengiriman dari formulir validator.
 *
 * Pemeriksaannya di server, bukan hanya di halaman. Formulir yang hanya dijaga
 * layar depan bukan formulir yang terjaga — dan lembar validasi yang separuh
 * kosong baru ketahuan saat analisis, ketika validatornya sudah selesai dan
 * tidak bisa diminta mengulang.
 *
 * @returns {{data: object|null, errors: string[]}}
 */
export function periksaPengiriman(body = {}, { hariIni } = {}) {
  const errors = [];
  const v = body?.validator ?? {};

  const nama = teks(v.nama, BATAS.nama);
  if (!nama) errors.push('Nama validator wajib diisi.');

  const bidangPilihan = Array.isArray(v.bidang)
    ? v.bidang.map((b) => teks(b, BATAS.bidangLain)).filter(Boolean).slice(0, BIDANG.length + 3)
    : [];
  if (!bidangPilihan.length) errors.push('Bidang keahlian wajib diisi minimal satu.');

  const tanggal = tanggalSah(v.tanggalValidasi);
  if (!tanggal) errors.push('Tanggal validasi wajib diisi dengan format tahun-bulan-tanggal.');
  else if (hariIni && tanggal > hariIni) errors.push('Tanggal validasi tidak boleh di masa depan.');

  const kesimpulan = KESIMPULAN.find((k) => k.kunci === body?.kesimpulan)?.kunci ?? null;
  if (!kesimpulan) errors.push('Kesimpulan kelayakan wajib dipilih.');

  /*
   * Jawaban disaring ke kode butir yang benar-benar ada. Kunci asing dibuang
   * diam-diam: halaman hanya pernah mengirim kode yang sah, jadi kode asing
   * berarti bukan dari lembar ini — dan menyimpannya akan membuat rekapitulasi
   * memuat butir yang tidak pernah ditanyakan kepada siapa pun.
   */
  const jawaban = {};
  const kosong = [];
  const tanpaAlasan = [];
  for (const b of BUTIR) {
    const masuk = ambilJawaban(body?.jawaban, b.kode);
    const skorMentah = masuk && typeof masuk === 'object' ? masuk.skor : masuk;
    const komentar = teks(masuk && typeof masuk === 'object' ? masuk.komentar : '', BATAS.komentar);
    if (!skorSah(skorMentah)) {
      kosong.push(b.kode);
      continue;
    }
    const skor = Number(skorMentah);
    /*
     * Skor 1 atau 2 tanpa komentar adalah temuan yang tidak bisa ditindaklanjuti:
     * ia memberi tahu ada yang salah, tanpa memberi tahu apa. Butir inilah yang
     * paling menentukan revisi materi, jadi justru di sini alasannya diwajibkan.
     */
    if (skor <= 2 && !komentar) tanpaAlasan.push(b.kode);
    jawaban[b.kode] = { skor, komentar };
  }

  if (kosong.length) {
    errors.push(`Masih ada ${kosong.length} butir yang belum dinilai: ${kosong.join(', ')}.`);
  }
  if (tanpaAlasan.length) {
    errors.push(
      `Butir yang dinilai 1 atau 2 wajib disertai komentar agar bisa ditindaklanjuti: ${tanpaAlasan.join(', ')}.`,
    );
  }

  const perluRevisi = (Array.isArray(body?.materiPerluRevisi) ? body.materiPerluRevisi : [])
    .slice(0, BATAS.revisiMaks)
    .map((r) => ({
      // Nomor modul dibiarkan apa adanya sebagai teks: validator boleh menulis
      // "modul 5" maupun "seluruh jalur dasar". Yang penting catatannya terbaca.
      bagian: teks(r?.bagian, 120),
      catatan: teks(r?.catatan, BATAS.revisiCatatan),
    }))
    .filter((r) => r.bagian || r.catatan);

  if (errors.length) return { data: null, errors };

  return {
    errors: [],
    data: {
      instrumenVersi: INSTRUMEN_VERSI,
      validator: {
        nama,
        institusi: teks(v.institusi, BATAS.institusi),
        jabatan: teks(v.jabatan, BATAS.jabatan),
        bidang: bidangPilihan,
        tanggalValidasi: tanggal,
      },
      jawaban,
      kesimpulan,
      catatanUmum: teks(body?.catatanUmum, BATAS.catatan),
      rekomendasi: teks(body?.rekomendasi, BATAS.catatan),
      materiPerluRevisi: perluRevisi,
    },
  };
}

/* ------------------------------------------------------------ Rekapitulasi */

/**
 * Merangkum beberapa lembar validasi menjadi satu tabel.
 *
 * Dipakai perintah `npm run validasi -- rekap` dan ekspor penelitian. Ia HANYA
 * menjumlahkan lembar yang benar-benar ada; daftar kosong menghasilkan
 * rekapitulasi kosong, bukan angka nol yang terlihat seperti hasil pengukuran.
 * Perbedaan itu penting: "belum ada validator yang mengisi" dan "seluruh
 * validator memberi nilai terendah" tidak boleh terlihat sama.
 */
export function rekapValidasi(daftar = []) {
  const sah = (Array.isArray(daftar) ? daftar : []).filter((d) => d?.jawaban);
  if (!sah.length) {
    return {
      jumlahValidator: 0,
      lembarLengkap: 0,
      skorDiperoleh: 0,
      skorMaksimum: 0,
      persentase: null,
      kategori: null,
      rataButir: 0,
      butir: [],
      aspek: [],
    };
  }

  const hasil = sah.map((d) => hitungHasil(d.jawaban));

  const skorDiperoleh = hasil.reduce((s, h) => s + h.skorDiperoleh, 0);
  const skorMaksimum = hasil.reduce((s, h) => s + h.skorMaksimum, 0);
  const persentase = persentaseKelayakan(skorDiperoleh, skorMaksimum);

  const butir = BUTIR.map((b) => {
    const skor = sah.map((d) => ambilJawaban(d.jawaban, b.kode)?.skor).filter((s) => skorSah(s)).map(Number);
    const jumlah = skor.reduce((s, n) => s + n, 0);
    return {
      kode: b.kode,
      aspek: b.aspek,
      pernyataan: b.pernyataan,
      penilai: skor.length,
      skor: jumlah,
      skorMaksimum: skor.length * SKOR_MAKS,
      rata: skor.length ? bulat2(jumlah / skor.length) : 0,
      persentase: persentaseKelayakan(jumlah, skor.length * SKOR_MAKS),
      terendah: skor.length ? Math.min(...skor) : null,
    };
  });

  const aspek = ASPEK.map((a) => {
    const isi = butir.filter((b) => b.aspek === a.kunci);
    const skor = isi.reduce((s, b) => s + b.skor, 0);
    const maks = isi.reduce((s, b) => s + b.skorMaksimum, 0);
    const persen = persentaseKelayakan(skor, maks);
    return {
      kunci: a.kunci,
      nama: a.nama,
      skor,
      skorMaksimum: maks,
      persentase: persen,
      kategori: maks ? kategoriKelayakan(persen).label : null,
    };
  });

  return {
    jumlahValidator: sah.length,
    lembarLengkap: hasil.filter((h) => h.lengkap).length,
    skorDiperoleh,
    skorMaksimum,
    persentase,
    kategori: kategoriKelayakan(persentase),
    rataButir: bulat2(butir.reduce((s, b) => s + b.rata, 0) / butir.length),
    butir,
    aspek,
  };
}
