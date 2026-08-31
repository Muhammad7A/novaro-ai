/**
 * Konteks usaha personal — "Angka usahamu bulan ini".
 *
 * ------------------------------------------------------------------
 * KENAPA BERKAS INI ADA
 *
 * Materi dan check-up selama ini membicarakan usaha peserta memakai contoh
 * generik, padahal aplikasi SUDAH menghitung angka peserta sendiri setiap
 * hari. Berkas ini menyatukan angka-angka itu menjadi satu paket konteks
 * yang sama untuk tiga tempat: pembaca modul, hasil check-up, dan dasbor —
 * supaya ketiganya tidak pernah menampilkan versi angka yang berbeda.
 *
 * ------------------------------------------------------------------
 * BATAS YANG DIJAGA
 *
 *   - NOL rumus baru. Semua angka adalah PASSTHROUGH dari computeMetrics
 *     (via metricsFor) dan bandingkanBulan — dua sumber kebenaran yang sama
 *     dengan dasbor. Yang dilakukan berkas ini hanyalah MEMILIH, memberi
 *     label, dan menyusun kalimat penjelas dari kalimat bandingkanBulan.
 *   - Aturan "data cukup" ikut aturan yang sudah ada: metrics.sumber
 *     === 'catatan' hanya bila bulan berjalan lulus isMonthReliable.
 *     Tidak ada aturan kedua yang bisa menyimpang.
 *   - Tidak pernah mengarang angka: profil tanpa catatan tetap ditampilkan,
 *     tapi berlabel 'perkiraan' — dan pengguna tanpa profil sama sekali
 *     mendapat null, bukan nol yang terlihat seperti data.
 *
 * Fungsi ini MURNI: masuk metrik + hasil bandingkanBulan, keluar paket
 * konteks siap render. Dipanggil rute /api/konteks dan diuji langsung.
 */

/**
 * Susun paket konteks usaha.
 *
 * @param {{metrics: object|null, perubahan: object|null}} sumber
 * @returns {object|null} null bila pengguna belum punya profil — pemanggil
 *   harus menyembunyikan kartunya, bukan menampilkan angka kosong.
 */
export function susunKonteksUsaha({ metrics, perubahan } = {}) {
  if (!metrics) return null;

  // Satu sumber aturan "cukup data": label sumber dari computeMetrics.
  const sumber = metrics.sumber === 'catatan' ? 'catatan' : 'perkiraan';

  /*
   * Penyebut konsistensi: bulan yang sudah habis dibagi jumlah harinya;
   * bulan berjalan dibagi hari yang sudah lewat — membandingkan 5 hari
   * tercatat dengan 31 akan selalu terlihat gagal padahal baru tanggal 5.
   * Medan bulanLengkap/hariBulan/hariBerjalan milik computeMetrics.
   */
  const penyebut = metrics.bulanLengkap
    ? metrics.hariBulan
    : (metrics.hariBerjalan || metrics.hariBulan || 0);

  return {
    sumber,
    cukupData: sumber === 'catatan',

    // Passthrough murni — nama medan sengaja sama dengan computeMetrics.
    angka: {
      omzet: metrics.omzet ?? null,
      labaBersih: metrics.labaBersih ?? null,
      hpp: metrics.hpp ?? null,
      biaya: metrics.biaya ?? null,
      marginBersih: metrics.marginBersih ?? null,
      saldoKas: metrics.saldoKas ?? null,
      prive: metrics.prive ?? null,
      cicilan: metrics.cicilanSaatIni ?? null,
      bebanCicilan: metrics.bebanCicilan ?? null,
      statusCicilan: metrics.statusCicilan ?? null,
      skorKesehatan: metrics.skorKesehatan ?? null,
      statusKesehatan: metrics.statusKesehatan ?? null,
    },

    konsistensi: {
      tercatat: Number(metrics.hariTercatat) || 0,
      dari: Number(penyebut) || 0,
      lengkap: Boolean(metrics.bulanLengkap),
    },

    // Interpretasi arah berasal dari kalimat bandingkanBulan yang sama
    // dengan kartu "Apa yang Berubah?" — bukan kalimat kedua yang bisa
    // berbeda dari kartunya. Dibatasi tiga supaya kartunya tetap ringkas.
    kalimat: Array.isArray(perubahan?.kalimat) ? perubahan.kalimat.slice(0, 3) : [],

    // Dua medan ini hanya terisi bila cicilan di profil belum tampak di
    // buku kas — peringatan yang sama dengan dasbor, sekarang ikut ke
    // modul dan check-up supaya konteksnya konsisten di mana pun.
    cicilanBelumTercatat: Boolean(metrics.cicilanBelumTercatat),
    cicilanDicatat: metrics.cicilanDicatat ?? null,
  };
}
