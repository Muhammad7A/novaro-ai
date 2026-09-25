/**
 * Perhitungan keuangan dari profil usaha.
 *
 * Semua angka di sini dihitung di server dengan rumus tetap, BUKAN oleh AI.
 * AI hanya menjelaskan dan menyusun saran berdasarkan angka yang sudah pasti,
 * sehingga tidak ada risiko angka "karangan".
 *
 * Sejak edisi enterprise US (W2c 2026-09-25): label dan format angka
 * berbahasa Inggris dengan dolar AS; kunci data (status cicilan, sumber angka)
 * ikut berbahasa Inggris dan dikonsumsi konsisten oleh kartu, fokus harian,
 * dan tampilan.
 */
import { RASIO_AMAN_PORSEN, RASIO_BERISIKO_PORSEN } from './simulasi-cicilan.js';

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

export const PROFIL_FIELDS = {
  jenisUsaha: ['kuliner', 'retail', 'jasa', 'produksi', 'online', 'lainnya'],
  pencatatan: ['belum', 'kadang', 'buku', 'excel', 'aplikasi'],
  tujuan: ['rapikan-keuangan', 'naikkan-laba', 'ajukan-kur', 'kelola-stok', 'kembangkan-usaha'],
};

/**
 * US dollars as text — INCLUDING negatives.
 *
 * Dulu fungsi ini memakai `num()`, yang menjadikan setiap angka negatif nol.
 * Akibatnya usaha yang rugi $2.500 dilaporkan ke AI sebagai
 * "Net profit: $0 (margin -31.3%)" — model diberi tahu ada kerugian tapi
 * tidak pernah diberi tahu sebesar apa, dan ia memang dilarang menghitung
 * sendiri. Kerugian adalah justru angka yang paling perlu terbaca utuh.
 */
export function formatDolar(n) {
  const v = Number(n);
  const bulat = Number.isFinite(v) ? Math.round(v) : 0;
  const angka = new Intl.NumberFormat('en-US').format(Math.abs(bulat));
  return (bulat < 0 ? '-$' : '$') + angka;
}

// Alias nama lama — dipakai berkas lain yang belum selesai ganti nama panggilan.
export const formatRupiah = formatDolar;

/** Nilai kesehatan keuangan 0–100 dengan komponen yang transparan. */
function healthScore({ marginBersih, profile, real }) {
  const parts = [];

  // Margin laba bersih (maks 30)
  let marginPoin = 0;
  if (marginBersih >= 20) marginPoin = 30;
  else if (marginBersih >= 10) marginPoin = 22;
  else if (marginBersih >= 5) marginPoin = 14;
  else if (marginBersih > 0) marginPoin = 7;
  parts.push({
    aspek: 'Net profit margin',
    poin: marginPoin,
    maks: 30,
    catatan: `${marginBersih.toFixed(1)}% of sales`,
  });

  // Kebiasaan mencatat (maks 20).
  // Kalau pengguna sudah punya buku kas, dinilai dari catatan nyata —
  // bukan dari jawaban sendiri di formulir profil.
  if (real && real.hariSejakMulai > 0 && real.jumlahTransaksi > 0) {
    parts.push({
      aspek: 'Recording habit',
      poin: Math.round(real.konsistensi * 20),
      maks: 20,
      catatan:
        real.hariTercatat >= real.hariSejakMulai
          ? `Recorded ${real.hariTercatat} consecutive days since starting — keep it up!`
          : `Recorded ${real.hariTercatat} of ${real.hariSejakMulai} days since starting to record`,
      terukur: true,
    });
  } else {
    const catatMap = { aplikasi: 20, excel: 18, buku: 12, kadang: 6, belum: 0 };
    parts.push({
      aspek: 'Recording habit',
      poin: catatMap[profile.pencatatan] ?? 0,
      maks: 20,
      catatan: {
        aplikasi: 'Already uses an app',
        excel: 'Already uses Excel/spreadsheet',
        buku: 'Paper notebook',
        kadang: 'Only sometimes',
        belum: 'Not recording yet',
      }[profile.pencatatan] ?? 'Not filled in',
    });
  }

  // Pemisahan uang usaha (maks 20)
  const pisahPoin = profile.rekeningTerpisah ? 20 : 0;
  parts.push({
    aspek: 'Separate business account',
    poin: pisahPoin,
    maks: 20,
    catatan: profile.rekeningTerpisah ? 'Has a dedicated business account' : 'Business and personal money still mixed',
  });

  // Legalitas usaha (maks 15) — padanan AS bagi NIB adalah EIN.
  const nibPoin = profile.punyaNib ? 15 : 0;
  parts.push({
    aspek: 'Business registration (EIN)',
    poin: nibPoin,
    maks: 15,
    catatan: profile.punyaNib ? 'Has an EIN' : 'No EIN yet (free at irs.gov)',
  });

  // Ketahanan usaha (maks 15)
  const bulan = num(profile.lamaUsahaBulan);
  let lamaPoin = 3;
  if (bulan >= 24) lamaPoin = 15;
  else if (bulan >= 12) lamaPoin = 11;
  else if (bulan >= 6) lamaPoin = 7;
  parts.push({
    aspek: 'Years in business',
    poin: lamaPoin,
    maks: 15,
    catatan: bulan >= 12 ? `${Math.floor(bulan / 12)} yr ${bulan % 12} mo` : `${bulan} mo`,
  });

  const total = parts.reduce((s, p) => s + p.poin, 0);
  let status = 'Needs attention';
  if (total >= 80) status = 'Very healthy';
  else if (total >= 60) status = 'Healthy';
  else if (total >= 40) status = 'Fair';
  return { skor: total, status, komponen: parts };
}

/**
 * Menghitung seluruh indikator keuangan.
 *
 * Semua angka di sini berlabel PER BULAN, jadi semuanya diambil dari
 * `real.setara` — versi buku kas yang sudah disetarakan ke sebulan penuh.
 * Memakai `real` mentah di sini adalah membandingkan sebagian bulan dengan
 * perkiraan sebulan penuh; itu membuat usaha yang sehat terlihat anjlok pada
 * hari pertama angka nyata dipakai, dan memangkas batas cicilannya.
 *
 * Angka apa adanya "sejauh ini" tetap tersedia di `berjalan` untuk ditampilkan
 * berdampingan, lengkap dengan jumlah harinya.
 *
 * @param profile  Profil usaha (angka perkiraan yang diisi sendiri).
 * @param real     Ringkasan buku kas bulan berjalan, bila datanya sudah memadai.
 *                 Bila ada, angka nyata ini menggantikan perkiraan.
 * @param bulanIni Ringkasan bulan berjalan apa adanya — selalu diisi bila ada.
 *                 Dipakai untuk menjelaskan ke pengguna kenapa catatannya belum
 *                 dipakai, alih-alih diam-diam kembali ke perkiraan.
 */
export function computeMetrics(profile = {}, real = null, bulanIni = null) {
  const pakaiCatatan = Boolean(real);
  const setara = pakaiCatatan ? real.setara : null;
  const belumCukup = !pakaiCatatan && Boolean(bulanIni?.jumlahTransaksi);

  const omzet = pakaiCatatan ? setara.penjualan + setara.lainMasuk : num(profile.omzetBulanan);
  const hpp = pakaiCatatan ? setara.belanjaBahan : num(profile.belanjaBulanan);
  const biaya = pakaiCatatan ? setara.operasional + setara.lainKeluar : num(profile.biayaOperasional);

  /*
   * Cicilan adalah satu-satunya angka yang TIDAK boleh sekadar berganti sumber.
   *
   * Angsuran pinjaman keluar lewat rekening, bukan lewat laci — jadi banyak
   * pemilik usaha tidak pernah mencatatnya di buku kas. Kalau angka ini hanya
   * diambil dari catatan, hari pertama buku kas dipakai adalah hari utang yang
   * sudah diakui sendiri di profil MENGHILANG: beban cicilan jadi 0% dan
   * statusnya "safe". Pindah ke angka nyata seharusnya membuat gambarannya lebih
   * jujur, bukan menghapus kewajiban yang jelas-jelas ada.
   *
   * Karena itu yang dipakai adalah yang lebih besar, dan selisihnya ditandai
   * supaya bisa dijelaskan ke pengguna, bukan didiamkan.
   */
  const cicilanCatatan = pakaiCatatan ? setara.cicilan : 0;
  const cicilanProfil = num(profile.cicilanBulanan);
  const cicilan = Math.max(cicilanCatatan, cicilanProfil);
  const cicilanBelumTercatat = pakaiCatatan && cicilanProfil > cicilanCatatan;

  const labaKotor = omzet - hpp;
  const labaBersih = labaKotor - biaya;
  const marginKotor = omzet > 0 ? (labaKotor / omzet) * 100 : 0;
  const marginBersih = omzet > 0 ? (labaBersih / omzet) * 100 : 0;

  // Aturan sehat beban cicilan: maksimal ~30% laba bersih bulanan.
  // Ambangnya hidup di lib/simulasi-cicilan.js — dipakai bersama dengan
  // simulasi cicilan di halaman Laporan, supaya keduanya tidak pernah berbeda.
  const maxCicilanSehat = Math.max(0, labaBersih * (RASIO_AMAN_PORSEN / 100));
  const bebanCicilan = labaBersih > 0 ? (cicilan / labaBersih) * 100 : cicilan > 0 ? 999 : 0;

  let statusCicilan = 'safe';
  if (cicilan > 0) {
    if (bebanCicilan > RASIO_BERISIKO_PORSEN) statusCicilan = 'risky';
    else if (bebanCicilan > RASIO_AMAN_PORSEN) statusCicilan = 'caution';
  }

  const { skor, status, komponen } = healthScore({ marginBersih, profile, real });

  return {
    sumber: pakaiCatatan ? 'catatan' : 'perkiraan',
    omzet,
    hpp,
    biaya,
    labaKotor,
    labaBersih,
    marginKotor: Number(marginKotor.toFixed(1)),
    marginBersih: Number(marginBersih.toFixed(1)),
    maxCicilanSehat: Math.round(maxCicilanSehat),
    cicilanSaatIni: cicilan,
    bebanCicilan: cicilan > 0 ? Number(Math.min(bebanCicilan, 999).toFixed(1)) : 0,
    statusCicilan,
    // Cicilan diakui di profil tapi belum muncul di buku kas bulan ini.
    cicilanBelumTercatat,
    cicilanDicatat: cicilanCatatan,
    skorKesehatan: skor,
    statusKesehatan: status,
    komponenSkor: komponen,
    rugi: labaBersih < 0,
    // Hanya terisi bila angka berasal dari buku kas.
    prive: pakaiCatatan ? setara.prive : 0,
    saldoKas: pakaiCatatan ? setara.saldoKas : null,
    hariTercatat: (pakaiCatatan ? real : bulanIni)?.hariTercatat ?? 0,
    hariBerjalan: (pakaiCatatan ? real : bulanIni)?.hariBerjalan ?? 0,
    hariBulan: (pakaiCatatan ? real : bulanIni)?.hariBulan ?? 0,
    hariSejakMulai: pakaiCatatan ? real.hariSejakMulai : 0,
    /*
     * Ada catatan, tapi belum cukup rapat untuk mewakili sebulan. Ini bukan
     * "belum mencatat" — dan pengguna berhak tahu bedanya, supaya dia mengerti
     * apa yang kurang dan bukan mengira aplikasinya mengabaikan usahanya.
     */
    catatanBelumCukup: belumCukup,
    /*
     * Bulan yang sedang berjalan, apa adanya. `disetarakan` menandai bahwa angka
     * per bulan di atas adalah proyeksi dari periode ini, bukan uang yang sudah
     * benar-benar lewat mesin kasir.
     */
    bulanLengkap: pakaiCatatan ? real.lengkap : false,
    disetarakan: pakaiCatatan ? real.setara.perkiraan : false,
    berjalan: pakaiCatatan
      ? {
          omzet: real.penjualan + real.lainMasuk,
          hpp: real.belanjaBahan,
          biaya: real.operasional + real.lainKeluar,
          labaBersih: real.labaBersih,
          saldoKas: real.saldoKas,
          prive: real.prive,
          cicilan: real.cicilan,
        }
      : null,
  };
}

/** Ringkasan angka dalam bentuk teks, dipakai sebagai konteks untuk AI. */
export function metricsToText(m) {
  const lines = [
    m.sumber === 'catatan'
      ? `- Number source: REAL CASH BOOK — measured, not estimated. The user has recorded ${m.hariTercatat} of ${m.hariSejakMulai} days since they started recording this month. ` +
        (m.hariTercatat >= m.hariSejakMulai
          ? 'They record every single day without gaps — praise the consistency when relevant.'
          : 'Some days are missing; encourage a steadier routine, without blaming.')
      : '- Number source: owner\'s own estimates (no cash book yet). Remind that daily recording will make these numbers accurate.',
    `- Monthly revenue: ${formatDolar(m.omzet)}`,
    `- Purchases / COGS: ${formatDolar(m.hpp)}`,
    `- Operating expenses: ${formatDolar(m.biaya)}`,
    `- Gross profit: ${formatDolar(m.labaKotor)} (margin ${m.marginKotor}%)`,
    `- Net profit: ${formatDolar(m.labaBersih)} (margin ${m.marginBersih}%)`,
    `- Safe loan payment ceiling (30% of net profit): ${formatDolar(m.maxCicilanSehat)} per month`,
  ];
  if (m.cicilanSaatIni > 0) {
    lines.push(
      `- Current loan payments: ${formatDolar(m.cicilanSaatIni)} = ${m.bebanCicilan}% of net profit (status: ${m.statusCicilan})`,
    );
    if (m.cicilanBelumTercatat) {
      lines.push(
        `  That payment figure comes from the business profile, NOT from the cash book — this month's book only shows ${formatDolar(m.cicilanDicatat)} recorded. ` +
          'Most likely the payment leaves from a bank account and never gets recorded. When relevant, remind them to record loan payments too (category "Loan payment") so the cash balance stays true.',
      );
    }
  }
  if (m.sumber === 'catatan') {
    lines.push(`- Monthly cash balance (all money in − out): ${formatDolar(m.saldoKas)}`);
    if (m.prive > 0) {
      lines.push(
        `- Owner draw (business money taken for personal use): ${formatDolar(m.prive)}. This is NOT a business expense, so it does not reduce profit — but it does reduce cash.`,
      );
    }
    /*
     * Jelaskan periodenya secara gamblang. Tanpa ini model membandingkan angka
     * sebagian bulan dengan angka sebulan penuh dan menyimpulkan usaha ini anjlok.
     */
    if (m.disetarakan) {
      lines.push(
        `- IMPORTANT about the period: the month is only ${m.hariBerjalan} of ${m.hariBulan} days in. ` +
          `Every "per month" number above is a FULL-MONTH EQUIVALENT — this month's daily pace times ${m.hariBulan} days. ` +
          `What has actually been recorded so far: revenue ${formatDolar(m.berjalan.omzet)}, net profit ${formatDolar(m.berjalan.labaBersih)}, cash balance ${formatDolar(m.berjalan.saldoKas)}. ` +
          'Do not describe those partial-month numbers as a business decline — the period simply is not over yet.',
      );
    } else {
      lines.push(`- Period: this month is complete at ${m.hariBulan} days, so the numbers above are true full-month figures.`);
    }
  }
  lines.push(`- Financial health score: ${m.skorKesehatan}/100 (${m.statusKesehatan})`);
  lines.push(
    `  Score breakdown: ${m.komponenSkor.map((k) => `${k.aspek} ${k.poin}/${k.maks}`).join('; ')}`,
  );
  if (m.rugi) lines.push('- ATTENTION: this business is currently LOSING MONEY (net profit is negative).');
  return lines.join('\n');
}
