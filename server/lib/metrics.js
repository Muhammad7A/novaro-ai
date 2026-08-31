/**
 * Perhitungan keuangan dari profil usaha.
 *
 * Semua angka di sini dihitung di server dengan rumus tetap, BUKAN oleh AI.
 * AI hanya menjelaskan dan menyusun saran berdasarkan angka yang sudah pasti,
 * sehingga tidak ada risiko angka "karangan".
 */
import { RASIO_AMAN_PORSEN, RASIO_BERISIKO_PORSEN } from './simulasi-kur.js';

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
 * Rupiah sebagai teks — TERMASUK yang negatif.
 *
 * Dulu fungsi ini memakai `num()`, yang menjadikan setiap angka negatif nol.
 * Akibatnya usaha yang rugi Rp 2,5 juta dilaporkan ke AI sebagai
 * "Laba bersih: Rp 0 (margin -31,3%)" — model diberi tahu ada kerugian tapi
 * tidak pernah diberi tahu sebesar apa, dan ia memang dilarang menghitung
 * sendiri. Kerugian adalah justru angka yang paling perlu terbaca utuh.
 */
export function formatRupiah(n) {
  const v = Number(n);
  const bulat = Number.isFinite(v) ? Math.round(v) : 0;
  const angka = new Intl.NumberFormat('id-ID').format(Math.abs(bulat));
  return (bulat < 0 ? '-Rp ' : 'Rp ') + angka;
}

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
    aspek: 'Margin laba bersih',
    poin: marginPoin,
    maks: 30,
    catatan: `${marginBersih.toFixed(1)}% dari penjualan`,
  });

  // Kebiasaan mencatat (maks 20).
  // Kalau pengguna sudah punya buku kas, dinilai dari catatan nyata —
  // bukan dari jawaban sendiri di formulir profil.
  if (real && real.hariSejakMulai > 0 && real.jumlahTransaksi > 0) {
    parts.push({
      aspek: 'Kebiasaan mencatat',
      poin: Math.round(real.konsistensi * 20),
      maks: 20,
      catatan:
        real.hariTercatat >= real.hariSejakMulai
          ? `Tercatat ${real.hariTercatat} hari berturut-turut sejak mulai — pertahankan!`
          : `Tercatat ${real.hariTercatat} dari ${real.hariSejakMulai} hari sejak mulai mencatat`,
      terukur: true,
    });
  } else {
    const catatMap = { aplikasi: 20, excel: 18, buku: 12, kadang: 6, belum: 0 };
    parts.push({
      aspek: 'Kebiasaan mencatat',
      poin: catatMap[profile.pencatatan] ?? 0,
      maks: 20,
      catatan: {
        aplikasi: 'Sudah pakai aplikasi',
        excel: 'Sudah pakai Excel/spreadsheet',
        buku: 'Dicatat di buku tulis',
        kadang: 'Kadang-kadang saja',
        belum: 'Belum mencatat',
      }[profile.pencatatan] ?? 'Belum diisi',
    });
  }

  // Pemisahan uang usaha (maks 20)
  const pisahPoin = profile.rekeningTerpisah ? 20 : 0;
  parts.push({
    aspek: 'Uang usaha terpisah',
    poin: pisahPoin,
    maks: 20,
    catatan: profile.rekeningTerpisah ? 'Sudah punya rekening/dompet khusus' : 'Masih tercampur uang pribadi',
  });

  // Legalitas usaha (maks 15)
  const nibPoin = profile.punyaNib ? 15 : 0;
  parts.push({
    aspek: 'Legalitas (NIB)',
    poin: nibPoin,
    maks: 15,
    catatan: profile.punyaNib ? 'Sudah punya NIB' : 'Belum punya NIB (gratis di oss.go.id)',
  });

  // Ketahanan usaha (maks 15)
  const bulan = num(profile.lamaUsahaBulan);
  let lamaPoin = 3;
  if (bulan >= 24) lamaPoin = 15;
  else if (bulan >= 12) lamaPoin = 11;
  else if (bulan >= 6) lamaPoin = 7;
  parts.push({
    aspek: 'Lama usaha berjalan',
    poin: lamaPoin,
    maks: 15,
    catatan: bulan >= 12 ? `${Math.floor(bulan / 12)} tahun ${bulan % 12} bulan` : `${bulan} bulan`,
  });

  const total = parts.reduce((s, p) => s + p.poin, 0);
  let status = 'Perlu perhatian';
  if (total >= 80) status = 'Sangat sehat';
  else if (total >= 60) status = 'Sehat';
  else if (total >= 40) status = 'Cukup';
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
   * statusnya "aman". Pindah ke angka nyata seharusnya membuat gambarannya lebih
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

  // Aturan sehat KUR: cicilan maksimal ~30% laba bersih bulanan.
  // Ambangnya hidup di lib/simulasi-kur.js — dipakai bersama dengan
  // simulasi KUR di halaman Laporan, supaya keduanya tidak pernah berbeda.
  const maxCicilanSehat = Math.max(0, labaBersih * (RASIO_AMAN_PORSEN / 100));
  const bebanCicilan = labaBersih > 0 ? (cicilan / labaBersih) * 100 : cicilan > 0 ? 999 : 0;

  let statusCicilan = 'aman';
  if (cicilan > 0) {
    if (bebanCicilan > RASIO_BERISIKO_PORSEN) statusCicilan = 'berisiko';
    else if (bebanCicilan > RASIO_AMAN_PORSEN) statusCicilan = 'hati-hati';
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
      ? `- Sumber angka: BUKU KAS NYATA — terukur, bukan perkiraan. Pengguna sudah mencatat ${m.hariTercatat} hari dari ${m.hariSejakMulai} hari sejak dia mulai mencatat bulan ini. ` +
        (m.hariTercatat >= m.hariSejakMulai
          ? 'Dia mencatat setiap hari tanpa bolong — puji konsistensinya bila relevan.'
          : 'Ada hari yang terlewat; dorong agar lebih rutin, tanpa menyalahkan.')
      : '- Sumber angka: perkiraan yang diisi sendiri oleh pemilik usaha (belum ada buku kas). Ingatkan bahwa mencatat harian akan membuat angka ini akurat.',
    `- Omzet per bulan: ${formatRupiah(m.omzet)}`,
    `- Belanja barang/bahan (HPP): ${formatRupiah(m.hpp)}`,
    `- Biaya operasional: ${formatRupiah(m.biaya)}`,
    `- Laba kotor: ${formatRupiah(m.labaKotor)} (margin ${m.marginKotor}%)`,
    `- Laba bersih: ${formatRupiah(m.labaBersih)} (margin ${m.marginBersih}%)`,
    `- Batas cicilan sehat (30% laba bersih): ${formatRupiah(m.maxCicilanSehat)} per bulan`,
  ];
  if (m.cicilanSaatIni > 0) {
    lines.push(
      `- Cicilan berjalan saat ini: ${formatRupiah(m.cicilanSaatIni)} = ${m.bebanCicilan}% dari laba bersih (status: ${m.statusCicilan})`,
    );
    if (m.cicilanBelumTercatat) {
      lines.push(
        `  Angka cicilan itu berasal dari profil usaha, BUKAN dari buku kas — di buku kas bulan ini baru tercatat ${formatRupiah(m.cicilanDicatat)}. ` +
          'Kemungkinan besar angsuran dibayar lewat rekening dan belum ikut dicatat. Bila relevan, ingatkan agar cicilan juga dicatat di buku kas (kategori "Bayar cicilan pinjaman") supaya saldo kasnya benar.',
      );
    }
  }
  if (m.sumber === 'catatan') {
    lines.push(`- Saldo kas per bulan (semua uang masuk − keluar): ${formatRupiah(m.saldoKas)}`);
    if (m.prive > 0) {
      lines.push(
        `- Prive (uang usaha yang diambil untuk keperluan pribadi): ${formatRupiah(m.prive)}. Ini BUKAN biaya usaha, jadi tidak mengurangi laba — tapi mengurangi uang kas.`,
      );
    }
    /*
     * Jelaskan periodenya secara gamblang. Tanpa ini model membandingkan angka
     * sebagian bulan dengan angka sebulan penuh dan menyimpulkan usaha ini anjlok.
     */
    if (m.disetarakan) {
      lines.push(
        `- PENTING soal periode: bulan ini baru berjalan ${m.hariBerjalan} dari ${m.hariBulan} hari. ` +
          `Semua angka "per bulan" di atas adalah SETARA SEBULAN PENUH — laju harian bulan berjalan dikali ${m.hariBulan} hari. ` +
          `Uang yang benar-benar sudah tercatat sejauh ini: omzet ${formatRupiah(m.berjalan.omzet)}, laba bersih ${formatRupiah(m.berjalan.labaBersih)}, saldo kas ${formatRupiah(m.berjalan.saldoKas)}. ` +
          'Jangan menyebut angka sebagian bulan itu sebagai penurunan usaha — periodenya memang belum habis.',
      );
    } else {
      lines.push(`- Periode: bulan ini sudah lengkap ${m.hariBulan} hari, jadi angka di atas adalah angka sebulan penuh yang sesungguhnya.`);
    }
  }
  lines.push(`- Skor kesehatan keuangan: ${m.skorKesehatan}/100 (${m.statusKesehatan})`);
  lines.push(
    `  Rincian skor: ${m.komponenSkor.map((k) => `${k.aspek} ${k.poin}/${k.maks}`).join('; ')}`,
  );
  if (m.rugi) lines.push('- PERHATIAN: usaha ini sedang RUGI (laba bersih negatif).');
  return lines.join('\n');
}
