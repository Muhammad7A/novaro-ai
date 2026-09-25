/**
 * Simulasi cicilan — hitungan murni untuk penggeser di halaman Laporan.
 *
 * ------------------------------------------------------------------
 * KENAPA BERKAS INI ADA
 *
 * Halaman Laporan sudah menghitung rata-rata laba bulanan dari buku kas,
 * dan metrics.js sudah punya aturan sehat cicilan (maks 30% laba). Yang
 * belum ada adalah jembatannya: "kalau saya ambil pinjaman $X selama Y
 * bulan, cicilannya berapa, dan kuat tidak laba saya menanggungnya?".
 * Hitungan itu dibutuhkan DUA dunia sekaligus — di server untuk uji
 * otomatis, di peramban untuk penggeser yang harus terasa instan tanpa
 * panggilan API — karena itu satu berkas ini dipakai dua dunia:
 *
 *   - node/uji   : import biasa dari berkas ini;
 *   - peramban   : disajikan apa adanya sebagai <script type="module">
 *                  lewat rute /simulasi-cicilan.js (server.js), yang
 *                  menempel seluruh API ke window.NOVA_SIMULASI di bawah.
 *
 * Satu rumus, satu tempat. Tidak ada salinan kedua yang bisa menyimpang.
 *
 * ------------------------------------------------------------------
 * DARI MANA ANGKANYA
 *
 *   - Ambang 30% / 50%: SAMA dengan aturan metrics.js (maxCicilanSehat,
 *     bebanCicilan, statusCicilan) — konstantanya ditarik ke sini dan
 *     metrics.js mengimpor dari sini, bukan menjaga angka kembar.
 *   - Bunga 6% per tahun: model bunga flat sederhana yang sengaja dipakai
 *     untuk edukasi keterjangkauan — BUKAN anuitas/APR amortisasi pinjaman
 *     AS sesungguhnya. Simulasi ini alat bantu nurani ("kuatkah labaku"),
 *     bukan penawaran kredit; kalimatnya yang menjaga, di halamannya.
 *   - Rentang jumlah $1.000–$500.000 dan tenor 3–60 bulan: wilayah usaha
 *     kecil-menengah yang dilayani aplikasi ini.
 *
 * Batas yang dijaga: fungsi di sini MURNI dan tidak pernah menyentuh
 * penyimpanan, AI, atau jaringan. Hasilnya adalah SIMULASI edukasi —
 * bukan keputusan kredit.
 */

/** Ambang rasio cicilan terhadap laba (persen) — dipakai juga oleh metrics.js. */
export const RASIO_AMAN_PORSEN = 30;
export const RASIO_BERISIKO_PORSEN = 50;

/** Bunga flat ilustratif per tahun (6% = 0,5% per bulan) — edukasi keterjangkauan, bukan penawaran. */
export const BUNGA_TAHUNAN_DEFAULT = 0.06;

/** Rentang penggeser jumlah pinjaman (USD) dan langkahnya. */
export const JUMLAH_MIN = 1_000;
export const JUMLAH_MAKS = 500_000;
export const LANGKAH_JUMLAH = 1_000;

/** Rentang tenor dalam bulan. */
export const TENOR_MIN = 3;
export const TENOR_MAKS = 60;

/**
 * Cicilan bulanan bunga flat: pokok/tenor + bunga pokok satu bulan.
 * Mengembalikan dolar bulat, atau null bila masukan tidak masuk akal
 * (jumlah bukan angka positif, tenor bukan bulat ≥ 1) — penelepon yang
 * menampilkan null lebih jujur daripada menampilkan $0.
 */
export function cicilanBulanan(jumlah, tenorBulan, bungaTahunan = BUNGA_TAHUNAN_DEFAULT) {
  const n = Number(jumlah);
  const t = Number(tenorBulan);
  const b = Number(bungaTahunan);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (!Number.isFinite(t) || t < 1 || !Number.isInteger(t)) return null;
  if (!Number.isFinite(b) || b < 0) return null;
  const pokok = n / t;
  const bunga = n * (b / 12);
  return Math.round(pokok + bunga);
}

/**
 * Status kelayakan dari rasio cicilan terhadap laba (persen).
 * Tangga SAMA dengan statusCicilan di metrics.js: ≤30 safe, 30–50
 * caution, >50 risky. Label halamannya diterjemahkan di tampilan
 * supaya istilah internal tidak berubah.
 */
export function statusBeban(rasioPorsen) {
  const r = Number(rasioPorsen);
  if (!Number.isFinite(r)) return 'risky';
  if (r > RASIO_BERISIKO_PORSEN) return 'risky';
  if (r > RASIO_AMAN_PORSEN) return 'caution';
  return 'safe';
}

/**
 * Simulasi utuh satu skenario.
 *
 * `labaBulanan` berasal dari rataLabaBulanan /api/report (buku kas nyata);
 * `cicilanBerjalan` dari cicilanBulanan profil — cicilan LAMA tetap dihitung,
 * karena pemberi pinjaman menilai seluruh beban cicilan, bukan cuma
 * pinjaman barunya. Sama seperti metrics.js: laba nol/negatif dengan
 * cicilan di atas nol dibaca beban tak terhingga (berisiko), bukan dibaca
 * 0% yang menenangkan secara palsu.
 *
 * @returns {null | {cicilan: number, cicilanLama: number, totalBeban: number,
 *   rasioPorsen: number, status: string, totalBayar: number, totalBunga: number}}
 */
export function simulasiCicilan(opts = {}) {
  const { jumlah, tenorBulan, labaBulanan, cicilanBerjalan = 0 } = opts ?? {};
  const cicilan = cicilanBulanan(jumlah, tenorBulan);
  if (cicilan === null) return null;

  const lama = Number(cicilanBerjalan) || 0;
  const totalBeban = cicilan + Math.max(lama, 0);
  const laba = Number(labaBulanan);

  let rasioPorsen;
  if (!Number.isFinite(laba) || laba <= 0) {
    rasioPorsen = totalBeban > 0 ? 999 : 0;
  } else {
    rasioPorsen = (totalBeban / laba) * 100;
  }

  const tenor = Number(tenorBulan);
  const totalBayar = Math.round(cicilan * tenor);

  return {
    cicilan,
    cicilanLama: Math.max(lama, 0),
    totalBeban: Math.round(totalBeban),
    rasioPorsen: Number(Math.min(rasioPorsen, 999).toFixed(1)),
    status: statusBeban(rasioPorsen),
    totalBayar,
    totalBunga: Math.round(totalBayar - jumlah),
  };
}

/* Peramban: serahkan seluruh API ke satu pintu global. Node melewati ini. */
if (typeof window !== 'undefined') {
  window.NOVA_SIMULASI = {
    RASIO_AMAN_PORSEN,
    RASIO_BERISIKO_PORSEN,
    BUNGA_TAHUNAN_DEFAULT,
    JUMLAH_MIN,
    JUMLAH_MAKS,
    LANGKAH_JUMLAH,
    TENOR_MIN,
    TENOR_MAKS,
    cicilanBulanan,
    statusBeban,
    simulasiCicilan,
  };
}
