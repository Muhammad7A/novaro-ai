/**
 * Hasil baca AI atas foto nota — dibersihkan SEBELUM sampai ke peserta.
 *
 * ------------------------------------------------------------------
 * KENAPA BERKAS INI ADA
 *
 * Model yang membaca foto bisa salah membaca — dan yang berbahaya bukan
 * galatnya yang keras, melainkan jawabannya yang YAKIN tapi keliru: angka
 * kembalian dibaca sebagai total, nomor telepon dibaca sebagai jumlah.
 * Karena itu seluruh keluaran model melewati pemeriksaan murni di sini
 * sebelum ditampilkan, dan TIDAK ADA jalur dari berkas ini ke penyimpanan:
 * hasil scan hanya pernah menjadi usulan di layar. Simpan hanya lewat
 * rute /api/cashbook yang sama dengan input manual — setelah peserta
 * menekan tombolnya sendiri.
 *
 * Semua fungsi di sini MURNI: tanpa jaringan, tanpa berkas, tanpa jam
 * dinding (tanggal hari ini selalu lewat parameter). Itulah yang membuat
 * seluruh keputusan keamanan hasil AI bisa diuji tanpa memanggil AI.
 */
import { JENIS, KATEGORI } from './cashbook.js';

/**
 * Kata kunci nota → kategori baku Novaro.
 *
 * Model sengaja TIDAK diminta memilih kategori baku — ia diminta menulis
 * kata kunci bebas ("sembako", "pertalite"), dan PEMETAAN INI yang
 * memutuskannya. Dengan begitu kategori di aplikasi tidak bisa bertambah
 * tanpa sepengetahuan kode: kategori asing dari model jatuh menjadi null
 * dan peserta memilih sendiri, bukan diam-diam membuat data kotor.
 */
const PETA_KATEGORI = {
  'belanja-bahan': [
    'bahan', 'bahan makanan', 'bahan baku', 'sembako', 'beras', 'sayur',
    'sayur mayur', 'buah', 'daging', 'ayam', 'ikan', 'telur', 'gula',
    'terigu', 'tepung', 'minyak goreng', 'bumbu', 'kecap', 'saus', 'mi',
    'mie', 'telur', 'groceries', 'kitchen', 'deterjen', 'sabun cuci',
  ],
  operasional: [
    'bbm', 'bensin', 'pertalite', 'pertamax', 'solar', 'dexlite', 'spbu',
    'listrik', 'pln', 'token', 'token listrik', 'air', 'pdam', 'gas',
    'lpg', 'gas 3kg', 'gas 12kg', 'kemasan', 'plastik', 'paper', 'kardus',
    'label', 'stiker', 'sewa', 'internet', 'wifi', 'pulsa', 'parkir', 'tol',
    'ongkir', 'kurus', 'service', 'servis', 'perbaikan',
  ],
  cicilan: ['cicilan', 'angsuran', 'kredit'],
  'lain-keluar': ['donasi', 'sumbangan', 'hampers'],
  penjualan: ['penjualan', 'jualan', 'terjual', 'omzet'],
  /*
   * Modal/setoran → modal-masuk, BUKAN lain-masuk (batas modal, M3).
   * "modal masuk" pindah dari lain-masuk ke sini: kata kunci itu dulunya
   * justru membuat setoran modal ikut dihitung laba lewat lain-masuk yang
   * laba:true — kebohongan angka yang paling disembunyikan, karena kena di
   * bulan pemilik justru menanam uang ke usahanya.
   */
  'modal-masuk': ['modal', 'setoran'],
  'lain-masuk': ['refund', 'pengembalian', 'cashback'],
};

/** Format berkas yang boleh dikirim ke AI, beserta tanda pengenal byte-nya. */
const TANDA_BERKAS = [
  { mime: 'image/jpeg', cek: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: 'image/png',
    cek: (b) =>
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  {
    mime: 'image/webp',
    cek: (b) =>
      b.subarray(0, 4).toString('ascii') === 'RIFF' &&
      b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
];

/**
 * Menyimpulkan jenis berkas dari ISI byte, bukan dari header Content-Type
 * yang dikirim klien. Header bisa apa saja; byte gambar yang menipu lebih
 * susah. Mengembalikan mime yang dikenali, atau null bila bukan gambar.
 */
export function kenaliGambar(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  for (const t of TANDA_BERKAS) {
    if (t.cek(buffer)) return t.mime;
  }
  return null;
}

/**
 * Mengurai teks jawaban model menjadi obyek JSON.
 *
 * Meski diminta JSON murni, model kadang membungkusnya dalam fence ```json
 * atau menambahkan satu kalimat sebelum/sesudahnya. Yang dicari: blok {}
 * terluar pertama. Gagal tetap gagal — dengan galat siap-tampil, bukan
 * SyntaxError mentah yang sampai ke peserta sebagai "kesalahan tak terduga".
 */
export function parseNotaJson(teks) {
  const s = String(teks ?? '').replace(/```(?:json)?/gi, '').trim();
  const awal = s.indexOf('{');
  const akhir = s.lastIndexOf('}');
  if (awal === -1 || akhir <= awal) {
    const err = new Error('AI mengembalikan format yang tidak terbaca. Coba foto ulang notanya.');
    err.status = 502;
    throw err;
  }
  try {
    return JSON.parse(s.slice(awal, akhir + 1));
  } catch {
    const err = new Error('AI mengembalikan format yang tidak terbaca. Coba foto ulang notanya.');
    err.status = 502;
    throw err;
  }
}

/**
 * Kata kunci → kategori baku. Mengembalikan id kategori yang SAH untuk
 * jenis tersebut, atau null — tidak pernah mengarang kategori baru.
 *
 * Kata kunci yang KEBETULAN sudah id kategori (mis. model menjawab persis
 * "belanja-bahan") diterima langsung, supaya model yang patuh skema tidak
 * kena penalti.
 *
 * Kata kunci pendek (≤3 huruf, mis. "mi", "gas") dicocokkan UTUH per kata —
 * cocok sebagian membuat "streaming" terbaca sebagai "mi" dan nota langganan
 * internet tercatat sebagai belanja mi.
 */
export function petakanKategori(teks, jenis) {
  const s = String(teks ?? '').trim().toLowerCase();
  if (!s) return null;
  if (KATEGORI[jenis]?.[s]) return s;
  for (const [kategori, kata] of Object.entries(PETA_KATEGORI)) {
    if (!KATEGORI[jenis]?.[kategori]) continue; // kategori tidak sah untuk jenis ini
    if (kata.some((k) => (k.length <= 3 ? new RegExp(`\\b${k}\\b`).test(s) : s.includes(k)))) return kategori;
  }
  return null;
}

/**
 * Ambang keyakinan → tingkat tampilan.
 *
 *   ok      ≥ 0.85  → kartu konfirmasi biasa
 *   warning ≥ 0.60  → kartu konfirmasi + peringatan periksa dulu
 *   low     < 0.60  → jangan pura-pura hasilnya bisa dipercaya
 */
export function tingkatKeyakinan(confidence) {
  const c = Number(confidence);
  if (!Number.isFinite(c)) return 'low';
  if (c >= 0.85) return 'ok';
  if (c >= 0.6) return 'warning';
  return 'low';
}

/**
 * Mengubah nilai amount dari model menjadi angka.
 *
 * Skema meminta angka murni, tapi model kadang menjawab string dengan
 * format nota yang dilihatnya: "Rp 120.000", "120.000", "120,000". Kebiasaan
 * Indonesia: titik = pemisah ribuan, koma = desimal. Kecuali persis tiga
 * digit di belakang koma — itu gaya marketplace ("120,000" = 120000).
 * Menebak di sini lebih aman daripada membiarkan Number('120.000') menjadi
 * 120 — selisih seribu kali lipat pada catatan peserta.
 */
export function keAngkaRupiah(n) {
  if (typeof n === 'number') return n;
  if (typeof n !== 'string') return NaN;
  let s = n.replace(/rp/gi, '').replace(/\s/g, '');
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  else s = s.replace(',', '.');
  return Number(s);
}

const TAHUN_TERLAMA = 5; // sama dengan batas bawah tanggal di rute cashbook

/**
 * Mengubah keluaran mentah model menjadi usulan transaksi yang aman.
 *
 * Prinsipnya SATU: apa yang tidak bisa dibuktikan sah menjadi null —
 * bukan nilai bawaan yang terlihat seperti hasil baca. Jumlah nol/negatif/
 * bukan angka → null. Tanggal di masa depan atau bukan YYYY-MM-DD → null.
 * Kategori yang tidak terpetakan → null. Peserta yang melihat null paham
 * bahwa yang itu dia harus isi sendiri.
 *
 * @returns {{jenis: string, jumlah: number|null, kategori: string|null,
 *            keterangan: string, merchant: string, tanggal: string|null,
 *            confidence: number, tingkat: string}}
 */
export function sanitasiHasilNota(mentah, { hariIni = undefined } = {}) {
  const hari = hariIni ?? new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

  if (!mentah || typeof mentah !== 'object' || Array.isArray(mentah)) {
    const err = new Error('AI mengembalikan format yang tidak terbaca. Coba foto ulang notanya.');
    err.status = 502;
    throw err;
  }

  // "expense"/"income" adalah bahasa skema; aplikasi mengenal masuk/keluar.
  const jenis = mentah.type === 'income' ? 'masuk' : mentah.type === 'expense' ? 'keluar' : 'keluar';

  // Jumlah: angka positif terbatas, dibulatkan ke rupiah — atau null.
  const angka = keAngkaRupiah(mentah.amount);
  const jumlah = Number.isFinite(angka) && angka > 0
    ? Math.min(Math.round(angka), 1e12)
    : null;

  // Tanggal: bentuk sah DAN tidak di masa depan → dipakai; selain itu null.
  let tanggal = null;
  if (typeof mentah.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(mentah.date)) {
    const d = new Date(`${mentah.date}T00:00:00Z`);
    const batasLama = new Date(`${hari}T00:00:00Z`);
    batasLama.setUTCFullYear(batasLama.getUTCFullYear() - TAHUN_TERLAMA);
    if (!Number.isNaN(d.getTime()) && mentah.date <= hari && mentah.date >= batasLama.toISOString().slice(0, 10)) {
      tanggal = mentah.date;
    }
  }

  return {
    jenis,
    jumlah,
    kategori: petakanKategori(mentah.category, jenis),
    keterangan: String(mentah.description ?? '').trim().slice(0, 120),
    merchant: String(mentah.merchant ?? '').trim().slice(0, 80),
    tanggal,
    confidence: Math.min(Math.max(Number(mentah.confidence) || 0, 0), 1),
    tingkat: tingkatKeyakinan(mentah.confidence),
  };
}

/** Daftar jenis yang sah — diekspor untuk uji kontrak, bukan untuk dipakai luas. */
export { JENIS };
