/**
 * Jadwal belajar — kapan sebuah sesi harian boleh dibuka.
 *
 * ------------------------------------------------------------------
 * BENTUKNYA: GERBANG MAJU, BUKAN GERBANG DUA ARAH
 *
 * Sesi hari esok belum terbuka. Sesi kemarin TETAP TERBUKA, selamanya.
 *
 * Bukan setengah hati — itu keputusan yang dipilih di atas penguncian penuh
 * ("modul hanya bisa dibuka pada harinya"), karena tiga hal:
 *
 *   1. Materinya sendiri melawan penguncian mundur. Praktik sesi 1 berbunyi
 *      "nanti kita bandingkan di sesi 4", dan sesi 4 menyuruh peserta membuka
 *      kembali tebakan yang dia tulis di sesi 1. Modul 3 merujuk modul 8.
 *      Menutup sesi kemarin membuat materi menyuruh sesuatu yang dilarang
 *      aplikasinya sendiri.
 *
 *   2. Modul 2 mengajarkan bahwa cloud accounting berarti catatan "bisa dibuka
 *      lagi kapan saja dari perangkat mana saja". Aplikasi yang menutup materi
 *      kemarin membantah pelajarannya sendiri pada hari kedua.
 *
 *   3. Peluang seorang pemilik warung sempat membuka aplikasi pada hari
 *      tertentu tidak pernah 100%. Dengan penguncian penuh dan peluang harian
 *      80%, hanya sekitar 21% peserta yang akan pernah menyelesaikan tujuh
 *      sesinya (0,8^7) — sisanya kehilangan materi secara permanen, lalu diuji
 *      post-test atas materi yang tidak pernah diajarkan kepada mereka. Dengan
 *      gerbang maju, peluang yang sama hanya memanjangkan kalendernya menjadi
 *      ±9 hari; tidak ada satu sesi pun yang hilang.
 *
 * Yang tetap didapat: peserta tidak bisa membaca tujuh sesi sekaligus pada
 * malam pertama. Tanpa itu, "micro-learning tujuh hari" adalah klaim yang tidak
 * didukung datanya sendiri.
 *
 * ------------------------------------------------------------------
 * HANYA SESI HARIAN YANG DIGERBANG
 *
 * 22 modul pustaka tidak ikut. Keduanya memang sudah berbeda perlakuan di
 * tampilan (pustaka dibuka sesuai kebutuhan, bukan sesuai hari), dan menambah
 * gerbang di sana akan mengubah perilaku yang tidak diminta siapa pun.
 *
 * ------------------------------------------------------------------
 * TANGGAL MULAI DITETAPKAN PENDAMPING
 *
 * `mulaiPada` tidak pernah terisi sendiri. Ia ditetapkan pendamping lewat
 * `npm run users -- mulai`, saat pendampingan berlangsung.
 *
 * Bukan `createdAt`, dan bukan login pertama. Peserta didaftarkan berhari-hari
 * sebelum pendampingan, dan rancangan waitlist menaruh B2 jauh di belakang B1 —
 * kalau hitungan hari dimulai sendiri saat peserta membuka aplikasi karena
 * penasaran, hari ke-1 seseorang bisa jatuh sebelum pre-test-nya sendiri, dan
 * tidak ada cara memperbaikinya setelah pilot berjalan.
 *
 * Selama belum ditetapkan, tidak ada sesi harian yang terbuka. Itu disengaja
 * dan harus terlihat: `npm run users -- list` menandai peserta yang jadwalnya
 * belum dimulai, supaya pendamping tidak pernah lupa tanpa ada yang tahu.
 */
import { tanggalWIB } from './cashbook.js';
import { SESI_HARIAN, cariModul } from './kurikulum.js';

/** Jumlah sesi harian pada jalur dasar. */
export const JUMLAH_SESI = SESI_HARIAN.length;

const POLA_TANGGAL = /^\d{4}-\d{2}-\d{2}$/;

/** Tanggal YYYY-MM-DD yang benar-benar ada di kalender, atau null. */
export function tanggalSah(nilai) {
  const t = String(nilai ?? '').trim();
  if (!POLA_TANGGAL.test(t)) return null;
  const d = new Date(`${t}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== t ? null : t;
}

/**
 * Selisih hari antara dua tanggal kalender.
 *
 * Keduanya dibaca sebagai tengah malam UTC, jadi tidak ada pergeseran musim
 * panas atau jam yang ikut terhitung. Yang penting: KEDUANYA harus tanggal
 * kalender WIB — lihat `hariKe` di bawah.
 */
export function selisihHari(dari, sampai) {
  const a = tanggalSah(dari);
  const b = tanggalSah(sampai);
  if (!a || !b) return null;
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

/**
 * Hari keberapa peserta berada, 1-based. `null` bila jadwalnya belum dimulai.
 *
 * Hari pertama adalah hari `mulaiPada` itu sendiri, bukan hari sesudahnya —
 * pendampingan dan sesi 1 terjadi pada hari yang sama.
 *
 * Batas hari memakai tanggal kalender WIB, bukan UTC. Tanpa itu, sesi
 * berikutnya akan terbuka pukul 07.00 pagi WIB alih-alih tengah malam, dan
 * peserta yang membuka aplikasi subuh — sebelum warung buka, salah satu
 * kebiasaan yang justru ingin diamati penelitian ini — akan diberi tahu
 * sesinya belum terbuka padahal harinya sudah berganti.
 */
export function hariKe(mulaiPada, sekarang = new Date()) {
  const mulai = tanggalSah(mulaiPada);
  if (!mulai) return null;
  const hariIni = tanggalSah(sekarang) ?? tanggalWIB(sekarang);
  const selisih = selisihHari(mulai, hariIni);
  return selisih === null ? null : selisih + 1;
}

/**
 * Apakah seluruh modul sedang dibuka (mode validasi / evaluasi ahli).
 * Dapat diaktifkan lewat variabel lingkungan UNLOCK_ALL_MODULES=1 atau BUKA_SEMUA_MODUL=1.
 */
export function semuaModulTerbuka() {
  return process.env.UNLOCK_ALL_MODULES === '1' || process.env.BUKA_SEMUA_MODUL === '1';
}

/**
 * Nomor sesi harian tertinggi yang sudah boleh dibuka. 0 berarti belum ada.
 *
 * Dibatasi di kedua ujung: peserta yang jadwalnya ditetapkan untuk minggu depan
 * mendapat 0 (bukan angka negatif), dan peserta di hari ke-40 mendapat 7 (bukan
 * 40, yang akan membuat `sesi <= sesiTerbuka` benar untuk nomor yang tidak ada).
 */
export function sesiTerbuka(mulaiPada, sekarang = new Date()) {
  if (semuaModulTerbuka()) return JUMLAH_SESI;
  const hari = hariKe(mulaiPada, sekarang);
  if (hari === null) return 0;
  return Math.min(Math.max(hari, 0), JUMLAH_SESI);
}

/**
 * Apakah satu modul boleh dibuka peserta ini sekarang?
 *
 * Modul pustaka selalu boleh. Modul yang tidak ada selalu tidak boleh — nomor
 * asing tidak boleh diam-diam lolos sebagai "bukan sesi harian, berarti bebas".
 */
export function modulTerbuka(no, mulaiPada, sekarang = new Date()) {
  const m = cariModul(no);
  if (!m) return false;
  if (semuaModulTerbuka()) return true;
  if (m.sesi == null) return true;
  return m.sesi <= sesiTerbuka(mulaiPada, sekarang);
}

/** Tanggal kalender saat sebuah sesi harian akan terbuka, atau null. */
export function tanggalSesiTerbuka(sesi, mulaiPada) {
  const mulai = tanggalSah(mulaiPada);
  if (!mulai || !Number.isInteger(sesi) || sesi < 1) return null;
  return new Date(Date.parse(`${mulai}T00:00:00Z`) + (sesi - 1) * 86400000).toISOString().slice(0, 10);
}

/**
 * Ringkasan jadwal untuk dikirim ke peramban dan ke prompt AI.
 *
 * `berikutTerbukaPada` menjawab satu pertanyaan yang pasti ditanyakan peserta
 * dan pendamping: "kapan sesi berikutnya bisa dibuka?". Menjawabnya dengan
 * tanggal jauh lebih baik daripada "besok" — peserta yang membuka aplikasi
 * pukul 23.50 akan membaca "besok" dan mendapati sesinya terbuka sepuluh menit
 * kemudian.
 */
export function ringkasJadwal(user, sekarang = new Date()) {
  if (semuaModulTerbuka()) {
    return {
      mulaiPada: user?.mulaiPada || null,
      dimulai: true,
      hariKe: 7,
      sesiTerbuka: JUMLAH_SESI,
      jumlahSesi: JUMLAH_SESI,
      sesiBerikut: null,
      berikutTerbukaPada: null,
      semuaTerbuka: true,
    };
  }
  const mulai = tanggalSah(user?.mulaiPada);
  const terbuka = sesiTerbuka(mulai, sekarang);
  const berikut = terbuka < JUMLAH_SESI ? terbuka + 1 : null;
  return {
    mulaiPada: mulai,
    dimulai: Boolean(mulai),
    hariKe: hariKe(mulai, sekarang),
    sesiTerbuka: terbuka,
    jumlahSesi: JUMLAH_SESI,
    sesiBerikut: berikut,
    berikutTerbukaPada: berikut ? tanggalSesiTerbuka(berikut, mulai) : null,
    semuaTerbuka: false,
  };
}

/**
 * Satu baris untuk prompt AI, disisipkan ke blok kemajuan belajar.
 *
 * Tanpa ini model bisa mengarahkan peserta hari ke-2 untuk "membaca sesi 5
 * dulu" — saran yang tidak bisa dijalankan, dan peserta akan mengira
 * aplikasinya rusak, bukan sarannya yang keliru.
 */
export function jadwalUntukAI(user, sekarang = new Date()) {
  const j = ringkasJadwal(user, sekarang);
  if (!j.dimulai) {
    return '- Jadwal belajar peserta belum dimulai pendamping; belum ada sesi harian yang terbuka untuknya.';
  }
  const baris = [`- Hari ke-${j.hariKe} sejak jadwal belajarnya dimulai (${j.mulaiPada}).`];
  baris.push(
    j.sesiBerikut
      ? `- Sesi yang sudah boleh dibuka: 1 sampai ${j.sesiTerbuka}. Sesi ${j.sesiBerikut} baru terbuka ${j.berikutTerbukaPada} — jangan menyuruhnya membaca sesi yang belum terbuka.`
      : `- Seluruh ${j.jumlahSesi} sesi harian sudah terbuka untuknya.`,
  );
  return baris.join('\n');
}
