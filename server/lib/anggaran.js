/**
 * Anggaran token per peserta.
 *
 * Pembatas yang sudah ada (RATE_LIMIT_PER_HOUR) menjaga LEDAKAN permintaan.
 * Berkas ini menjaga hal yang berbeda: TAGIHAN. Satu peserta yang menekan
 * "Perbarui rekomendasi" belasan kali dalam semalam tidak melanggar batas per
 * jam mana pun, tapi bisa menghabiskan biaya sebulan program.
 *
 * DUA KEPUTUSAN YANG MEMBENTUK BERKAS INI
 *
 * 1. Jendelanya mengikuti KALENDER, bukan 24 jam berjalan.
 *    "Jatahmu hari ini habis, besok pagi penuh lagi" bisa dimengerti pemilik
 *    warung. "Coba lagi pukul 14.37 saat permintaan terlamamu keluar dari
 *    jendela bergulir" tidak bisa. Peserta pilot ini bukan pengembang.
 *
 * 2. Token yang dibaca dari cache dihitung sepersepuluh.
 *    Ini bukan kelonggaran, melainkan menghitung sesuai tarifnya: baca-cache
 *    memang ditagih sekitar 10% tarif normal. Menghitungnya penuh akan membuat
 *    peserta yang paling rajin — yang bukunya paling panjang, jadi awalannya
 *    paling besar dan paling banyak tercache — kehabisan jatah paling cepat,
 *    padahal justru merekalah yang tagihannya paling murah per pertanyaan.
 *    Menghukum ketekunan adalah kebalikan dari tujuan program ini.
 */
import { tanggalWIB } from './cashbook.js';

/** Batas bawaan. Semuanya bisa diatur lewat .env tanpa mengubah kode. */
export const ANGGARAN = {
  harian: Number(process.env.TOKEN_BUDGET_DAILY) || 60_000,
  mingguan: Number(process.env.TOKEN_BUDGET_WEEKLY) || 300_000,
};

/** Tarif relatif tiap jenis token terhadap token masukan biasa. */
const BOBOT = {
  masuk: 1,
  keluar: 1,
  cacheTulis: 1.25, // menulis cache sedikit lebih mahal
  cacheBaca: 0.1, // membaca cache jauh lebih murah
};

/**
 * Perkiraan biaya sebuah permintaan, dipakai untuk memeriksa jatah SEBELUM
 * permintaannya dikirim.
 *
 * Tanpa ini, peserta dengan sisa 500 token masih bisa memicu pembuatan
 * rekomendasi seharga 6.000 token dan melompati batasnya sekali penuh —
 * batas yang hanya diperiksa sesudahnya bukan batas, melainkan laporan.
 * Angkanya dari pengukuran: chat 2.900–4.700, rekomendasi 4.800–6.600.
 */
/*
 * `chatModul` untuk pertanyaan yang diajukan dari dalam sebuah modul: materi
 * modulnya ikut terkirim (~700 token) supaya AI menjelaskan hal yang sama
 * dengan yang sedang dibaca peserta, bukan versinya sendiri. Perkiraannya
 * dinaikkan seperlunya — memakai angka `chat` untuk permintaan yang jelas lebih
 * berat berarti anggaran diperiksa dengan angka yang tidak benar, dan peserta
 * bisa menembus batas hariannya tanpa pernah dicegat.
 */
export const PERKIRAAN = { chat: 3_500, chatModul: 4_500, rekomendasi: 6_000, nota: 4_000, checkup: 3_500 };
// `nota` paling berat di antara semuanya karena gambarnya sendiri dihitung
// sebagai token masuk (±1.300 token untuk foto 1600px) di samping prompt dan
// jawaban JSON-nya. Perkiraan yang terlalu kecil di sini berarti peserta bisa
// memindai nota sepanjang hari tanpa pernah menyentuh batas anggarannya.

/** Berapa lama jejak pemakaian disimpan. Cukup untuk jendela mingguan + sisa. */
export const SIMPAN_HARI = 14;

/** Menghitung bobot satu jawaban API menjadi satu angka "token terhitung". */
export function hitungToken(usage) {
  const n = (v) => Number(v) || 0;
  return Math.round(
    n(usage?.input_tokens) * BOBOT.masuk +
      n(usage?.output_tokens) * BOBOT.keluar +
      n(usage?.cache_creation_input_tokens) * BOBOT.cacheTulis +
      n(usage?.cache_read_input_tokens) * BOBOT.cacheBaca,
  );
}

/** Senin dalam minggu yang memuat tanggal WIB tertentu (YYYY-MM-DD). */
export function awalMinggu(tanggal) {
  const d = new Date(`${tanggal}T00:00:00Z`);
  const hari = (d.getUTCDay() + 6) % 7; // Senin = 0
  d.setUTCDate(d.getUTCDate() - hari);
  return d.toISOString().slice(0, 10);
}

/** Membuang catatan yang sudah terlalu tua untuk jendela mana pun. */
export function pangkasLog(log = [], now = new Date()) {
  const batas = tanggalWIB(new Date(now.getTime() - SIMPAN_HARI * 86_400_000));
  return log.filter((e) => String(e?.tanggal ?? '') >= batas);
}

/**
 * Ringkasan pemakaian: berapa terpakai hari ini dan minggu ini, berapa sisanya,
 * dan kapan jatahnya penuh lagi.
 */
export function ringkasAnggaran(log = [], now = new Date()) {
  const hariIni = tanggalWIB(now);
  const senin = awalMinggu(hariIni);

  let harian = 0;
  let mingguan = 0;
  for (const e of log) {
    const t = String(e?.tanggal ?? '');
    const token = Number(e?.token) || 0;
    if (t === hariIni) harian += token;
    if (t >= senin && t <= hariIni) mingguan += token;
  }

  const sisaHarian = Math.max(0, ANGGARAN.harian - harian);
  const sisaMingguan = Math.max(0, ANGGARAN.mingguan - mingguan);

  return {
    harian: { terpakai: harian, batas: ANGGARAN.harian, sisa: sisaHarian },
    mingguan: { terpakai: mingguan, batas: ANGGARAN.mingguan, sisa: sisaMingguan },
    // Yang benar-benar membatasi adalah yang paling kecil di antara keduanya.
    sisa: Math.min(sisaHarian, sisaMingguan),
    hariIni,
    mingguMulai: senin,
  };
}

const BESOK = (tanggal) => {
  const d = new Date(`${tanggal}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

const TANGGAL_PANJANG = (t) =>
  new Date(`${t}T00:00:00Z`).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

/**
 * Apakah permintaan seharga `perkiraan` token masih muat?
 *
 * @returns null bila boleh, atau { pesan, jenis, sisa } bila tidak.
 */
export function cekAnggaran(log = [], perkiraan = 0, now = new Date()) {
  const r = ringkasAnggaran(log, now);

  if (r.mingguan.sisa < perkiraan) {
    const seninDepan = BESOK(
      new Date(new Date(`${r.mingguMulai}T00:00:00Z`).getTime() + 6 * 86_400_000).toISOString().slice(0, 10),
    );
    return {
      jenis: 'mingguan',
      sisa: r.mingguan.sisa,
      pesan:
        'Jatah tanya-AI minggu ini sudah habis. Jatahnya penuh lagi ' +
        `${TANGGAL_PANJANG(seninDepan)}. ` +
        'Semua catatan buku kas, laporan, dan modul tetap bisa dipakai seperti biasa.',
    };
  }

  if (r.harian.sisa < perkiraan) {
    return {
      jenis: 'harian',
      sisa: r.harian.sisa,
      pesan:
        'Jatah tanya-AI hari ini sudah habis. Jatahnya penuh lagi besok pagi ' +
        `(${TANGGAL_PANJANG(BESOK(r.hariIni))}). ` +
        'Semua catatan buku kas, laporan, dan modul tetap bisa dipakai seperti biasa.',
    };
  }

  return null;
}
