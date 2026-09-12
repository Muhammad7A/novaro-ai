/**
 * Deteksi konteks — pengamatan deterministik untuk konteks generasi advisori.
 *
 * ------------------------------------------------------------------
 * KENAPA BERKAS INI ADA
 *
 * Nasihat yang beringat (Sesi G) butuh bahan yang bisa dipercaya: sebelum AI
 * menyusun saran berikutnya, ada fakta-fakta arah yang bisa dihitung TANPA AI
 * dari angka bulanan kernel. Berkas ini menegakkan fakta itu dengan disiplin
 * yang sama dengan fokus harian:
 *
 *   - FIRST-MATCH-WINS: satu pengamatan terpenting saja — konteks yang
 *     menuntut tindakan, bukan menu.
 *   - NOL ANGKA BARU: arah perbandingan dan semantik prive>laba diambil dari
 *     yang sudah ada di aplikasi (aturan fokus, ambang kernel); ambang
 *     kelayakan bulan adalah isMonthComplete + isMonthReliable milik
 *     cashbook.js — di sini tidak ada satu pun konstanta baru.
 *   - NOL AI: keluarannya fakta berangka untuk dikutip, bukan opini.
 *
 * Kontrak masukan SENGAJA sama dengan evaluasiAdvisori (peta bulan → angka
 * inti dengan medan `bulanLengkap`): satu pembangun peta (rute) melayani dua
 * pembaca murni ini, sehingga keduanya tidak mungkin berbeda sumber angka.
 */

/**
 * Satu pengamatan konteks terpenting, atau null bila tidak ada yang layak.
 *
 * @param {object} bulanMetrics peta 'YYYY-MM' → {labaBersih, prive, saldoKas,
 *   bulanLengkap, ...} — lihat kontrak evaluasiAdvisori.
 * @returns {{id: string, bulan: string, judul: string, alasan: string}|null}
 */
export function deteksiKonteks(bulanMetrics) {
  // Hanya bulan LENGKAP yang boleh bercerita — sebagian bulan tidak pernah
  // menjadi dasar pengamatan (disiplin setara yang sama dengan evaluasi).
  const bulanUrut = Object.keys(bulanMetrics ?? {})
    .filter((b) => /^\d{4}-\d{2}$/.test(b) && bulanMetrics[b]?.bulanLengkap === true)
    .sort()
    .reverse() // terbaru dulu
    .slice(0, 3);
  if (!bulanUrut.length) return null;

  const terbaru = bulanMetrics[bulanUrut[0]];

  /* 1 — prive melebihi laba: kebocoran yang paling sering (semantik aturan 4
     fokus harian — perbandingan murni, tanpa ambang baru). */
  if ((terbaru.prive ?? 0) > 0 && terbaru.labaBersih > 0 && terbaru.prive > terbaru.labaBersih) {
    return {
      id: 'prive-melebihi-laba',
      bulan: bulanUrut[0],
      judul: 'Prive melebihi laba pada bulan terakhir',
      alasan: `Prive bulan ${bulanUrut[0]} tercatat ${terbaru.prive} — lebih besar daripada laba bersih ${terbaru.labaBersih}. Uang usaha terkikis lebih cepat daripada menghasilkan.`,
    };
  }

  if (bulanUrut.length >= 3) {
    const [b1, b2, b3] = bulanUrut.map((b) => bulanMetrics[b]);

    /* 2 — laba menurun dua bulan berturut-turut: arah murni, bukan ambang. */
    if (b3.labaBersih > b2.labaBersih && b2.labaBersih > b1.labaBersih) {
      return {
        id: 'laba-turun-dua-bulan',
        bulan: bulanUrut[0],
        judul: 'Laba menurun dua bulan berturut-turut',
        alasan: `Laba bersih tiga bulan lengkap terakhir menurun terus: ${b3.labaBersih} (${bulanUrut[2]}) → ${b2.labaBersih} (${bulanUrut[1]}) → ${b1.labaBersih} (${bulanUrut[0]}).`,
      };
    }

    /* 3 — kas menyusut dua bulan berturut-turut: arus kas membunuh usaha yang
       untung; arah saldonya terlihat sebelum labanya. */
    if (b3.saldoKas > b2.saldoKas && b2.saldoKas > b1.saldoKas) {
      return {
        id: 'kas-menyusut-dua-bulan',
        bulan: bulanUrut[0],
        judul: 'Saldo kas menyusut dua bulan berturut-turut',
        alasan: `Saldo kas akhir tiga bulan lengkap terakhir menyusut terus: ${b3.saldoKas} (${bulanUrut[2]}) → ${b2.saldoKas} (${bulanUrut[1]}) → ${b1.saldoKas} (${bulanUrut[0]}).`,
      };
    }
  }

  return null;
}
