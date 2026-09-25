/**
 * Buku kas — pencatatan transaksi harian dan ringkasannya.
 *
 * Dua pelajaran inti dari modul sengaja dibangun ke dalam model data:
 *
 *  1. "Prive" (ambil uang untuk keperluan pribadi) BUKAN biaya usaha — Modul 2.
 *     Karena itu prive tidak ikut mengurangi laba, tapi tetap mengurangi kas.
 *  2. Laba dan uang tunai adalah dua hal berbeda — Modul 6.
 *     Karena itu setiap bulan menghasilkan DUA angka: laba bersih dan saldo kas.
 *
 * ATURAN KETIGA — setiap angka selalu membawa PERIODE-nya.
 *
 * Jumlah rupiah di buku kas adalah "sejauh ini", bukan "sebulan". Tanggal 8, satu
 * bulan baru terisi 8/30. Kalau angka sebagian bulan itu dipakai seolah-olah angka
 * sebulan penuh — di dasbor, di batas cicilan, apalagi di laporan untuk bank —
 * usaha yang sehat akan terlihat anjlok hanya karena kalendernya belum habis.
 *
 * Karena itu setiap ringkasan bulan membawa `hariBerjalan`, `hariBulan`, `lengkap`,
 * dan `setara`: versi angka yang sudah disetarakan ke sebulan penuh. Yang memakai
 * angka wajib memilih dengan sadar — "berjalan" untuk melaporkan apa adanya,
 * "setara" untuk apa pun yang berlabel *per bulan*.
 */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Kategori transaksi. `laba: true` artinya ikut diperhitungkan dalam laba rugi. */
export const KATEGORI = {
  masuk: {
    penjualan: { label: 'Sales', short: 'Sales', laba: true },
    /*
     * MODAL BUKAN PENGHASILAN (batas modal — M3, keputusan 2026-09-13).
     *
     * Uang yang dipindahkan pemilik ke kas usaha — setoran awal, tambahan
     * modal — bukan hasil jualan. Sebelum kategori ini ada, catatan semacam
     * ini hanya punya dua tempat, dan dua-duanya salah: "penjualan"
     * menggelembungkan omzet dan laba di laporan yang dibaca bank,
     * "lain-masuk" ikut menggelembungkan laba karena laba:true. Di sini
     * modal-masuk mengubah SALDO KAS saja — uang nyata memang berpindah —
     * tanpa pernah menyentuh laba. Cermin dari prive di sisi keluar, yang
     * juga mengurangi kas tanpa mengurangi laba; penarikan modal tidak
     * dibuat karena memang sudah ada kategori itu.
     */
    'modal-masuk': { label: 'Owner contribution', short: 'Contribution', laba: false },
    'lain-masuk': { label: 'Other income', short: 'Other', laba: true },
  },
  keluar: {
    'belanja-bahan': { label: 'Purchases / cost of goods', short: 'Purchases', laba: true },
    operasional: { label: 'Operating expenses', short: 'Operating', laba: true },
    'lain-keluar': { label: 'Other expenses', short: 'Other', laba: true },
    cicilan: { label: 'Loan payment', short: 'Loan payment', laba: false },
    prive: { label: 'Owner draw (personal use)', short: 'Owner draw', laba: false },
  },
};

export const JENIS = ['masuk', 'keluar'];

export function isValidKategori(jenis, kategori) {
  return Boolean(KATEGORI[jenis]?.[kategori]);
}

export function kategoriLabel(jenis, kategori) {
  return KATEGORI[jenis]?.[kategori]?.label ?? kategori;
}

/**
 * Tanggal kalender WIB (UTC+7) dari sebuah waktu, sebagai YYYY-MM-DD.
 *
 * Satu-satunya tempat pengubahan zona waktu dilakukan. Sebelumnya beberapa
 * berkas menyalin sendiri logika ini dan satu di antaranya lupa — ekspor
 * penelitian membandingkan tanggal UTC dengan tanggal WIB, sehingga setiap
 * transaksi yang dicatat sebelum pukul 07.00 pagi tampak dicatat SEHARI SEBELUM
 * kejadiannya.
 */
export function tanggalWIB(waktu = new Date()) {
  const d = waktu instanceof Date ? waktu : new Date(waktu);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Jam dinding WIB, mis. "15.20". Untuk kalimat yang dibaca peserta.
 *
 * Zona waktunya DISEBUT eksplisit, bukan diwariskan dari `TZ` sistem. Server
 * produksi hampir selalu berjalan pada UTC — di GCP itu bawaannya — sehingga
 * `toLocaleTimeString('id-ID')` polos memberi tahu peserta "coba lagi setelah
 * 08.15" ketika yang dimaksud 15.15. Peserta tidak punya cara menduga bahwa
 * yang salah adalah zona waktunya, dan akan menunggu tujuh jam lebih lama.
 *
 * Menyetel `TZ=Asia/Jakarta` di lingkungan juga menyembuhkannya, dan itu tetap
 * disarankan supaya cap waktu di log ikut terbaca. Tapi kalimat yang sampai ke
 * peserta tidak boleh bergantung pada satu baris konfigurasi yang bisa lupa
 * dipasang.
 */
export function jamWIB(waktu = new Date()) {
  const d = waktu instanceof Date ? waktu : new Date(waktu);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
}

/** Bulan berjalan dalam format YYYY-MM (waktu Indonesia Barat). */
export function currentMonth(now = new Date()) {
  return tanggalWIB(now).slice(0, 7);
}

export function todayISO(now = new Date()) {
  return tanggalWIB(now);
}

/*
 * Batas bawah tanggal transaksi — SATU sumber untuk seluruh aplikasi.
 *
 * Batas atasnya sudah ada (tidak boleh di masa depan), tapi tanpa batas bawah
 * satu salah ketik tahun — "2016" alih-alih "2026" — menyelipkan bulan asing
 * ke daftar pilihan bulan dan ke riwayat yang dibaca AI. Dua tempat pernah
 * menyalin konstanta ini sendiri-sendiri (rute cashbook dan pembersih hasil
 * nota) dan keduanya harus tetap sepakat selamanya; karena penegakan batas
 * ini pindah ke mutator penyimpan, konstantanya ikut pindah ke sini — tempat
 * semua logika tanggal buku kas berada.
 *
 * Lima tahun jauh melampaui kebutuhan laporan pinjaman (3–6 bulan).
 */
export const TAHUN_TERLAMA = 5;

/** Tanggal kalender terlama yang masih boleh dicatat, sebagai YYYY-MM-DD. */
export function tanggalTerlama(now = new Date()) {
  const [y, m, d] = todayISO(now).split('-').map(Number);
  return `${y - TAHUN_TERLAMA}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Jumlah hari dalam sebuah bulan YYYY-MM. */
export function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

/**
 * Tanggal (1–31) saat sebuah transaksi DIMASUKKAN ke aplikasi, bila pemasukannya
 * memang terjadi di bulan yang sedang diringkas. Null bila di luar bulan itu.
 *
 * Dipakai untuk menentukan sejak kapan pengguna mulai memakai aplikasi — yang
 * tidak sama dengan tanggal struk tertua yang dia catat.
 */
function entryDayInMonth(createdAt, month) {
  if (typeof createdAt !== 'string') return null;
  const wib = tanggalWIB(createdAt);
  if (!wib) return null;
  return wib.slice(0, 7) === month ? Number(wib.slice(8, 10)) : null;
}

/**
 * Berapa hari dari bulan itu yang sudah lewat.
 * Untuk bulan berjalan dihitung sampai hari ini, untuk bulan lampau sebulan penuh.
 */
function elapsedDays(month, now = new Date()) {
  const today = todayISO(now);
  const thisMonth = today.slice(0, 7);
  if (month > thisMonth) return 0;
  if (month < thisMonth) return daysInMonth(month);
  return Number(today.slice(8, 10));
}

/** Menyaring transaksi milik satu bulan, diurutkan dari yang terlama. */
export function transactionsForMonth(transactions = [], month) {
  // `createdAt` selalu ada pada baris yang dibuat aplikasi ini, tapi berkas
  // cadangan yang pernah disunting tangan bisa saja kehilangannya — dan sortir
  // yang melempar TypeError akan mematikan seluruh halaman buku kas.
  const dibuat = (t) => String(t?.createdAt ?? '');
  return transactions
    .filter((t) => typeof t.tanggal === 'string' && t.tanggal.startsWith(month))
    .sort((a, b) => (a.tanggal === b.tanggal ? dibuat(a).localeCompare(dibuat(b)) : a.tanggal.localeCompare(b.tanggal)));
}

/**
 * Ringkasan satu bulan buku kas.
 *
 * labaBersih  = pemasukan usaha − pengeluaran usaha (TANPA prive & cicilan)
 * saldoKas    = seluruh uang masuk − seluruh uang keluar (TERMASUK prive & cicilan)
 */
export function summarizeMonth(transactions = [], month, now = new Date()) {
  const rows = transactionsForMonth(transactions, month);

  const perKategori = {};
  let totalMasuk = 0;
  let totalKeluar = 0;
  let labaMasuk = 0;
  let labaKeluar = 0;

  /*
   * Baris dengan `jenis` yang tidak dikenal DILEWATI, tidak dianggap keluar.
   *
   * Cabang `else` yang dulu ada di sini memperlakukan apa pun yang bukan
   * "masuk" sebagai uang keluar — termasuk `"Masuk"` berhuruf besar, medan yang
   * hilang, atau nilai apa pun dari berkas cadangan yang pernah disunting
   * tangan. Akibatnya pemasukan berbalik tanda: penjualan Rp 900.000 terbaca
   * sebagai pengeluaran Rp 900.000, dan saldo kas meleset Rp 1,8 juta dari satu
   * baris. Tidak ada satu pun pesan yang muncul.
   *
   * Melewatkannya membuat laporan bulan itu lebih KECIL dari kenyataan, bukan
   * terbalik — dan arah itu yang dipilih dengan sadar, sama seperti aturan
   * cakupan bulan: aplikasi ini tidak boleh pernah membesar-besarkan usaha di
   * depan bank. Barisnya tetap terhitung di `barisDiabaikan` supaya kelainan
   * itu bisa ditemukan, bukan hanya diam-diam hilang.
   */
  const sah = rows.filter((t) => JENIS.includes(t.jenis));
  const barisDiabaikan = rows.length - sah.length;

  for (const t of sah) {
    const jumlah = num(t.jumlah);
    const info = KATEGORI[t.jenis]?.[t.kategori];
    perKategori[t.kategori] = (perKategori[t.kategori] ?? 0) + jumlah;

    if (t.jenis === 'masuk') {
      totalMasuk += jumlah;
      if (info?.laba) labaMasuk += jumlah;
    } else {
      totalKeluar += jumlah;
      if (info?.laba) labaKeluar += jumlah;
    }
  }

  const hariTercatat = new Set(sah.map((t) => t.tanggal)).size;
  const hariBerjalan = elapsedDays(month, now);

  /*
   * Konsistensi dihitung sejak hari pertama pengguna MEMAKAI APLIKASI di bulan
   * ini, bukan sejak tanggal 1 dan bukan pula sejak tanggal struk tertua.
   *
   * Sejak tanggal 1 itu salah: orang yang baru mulai tanggal 22 akan langsung
   * dinilai jelek untuk 21 hari sebelum dia mengenal aplikasi ini.
   *
   * Sejak tanggal struk tertua juga salah, dan lebih halus salahnya: begitu
   * seseorang menyusul mencatat satu struk lama, jendelanya mundur ke belakang
   * dan nilainya JATUH — dihukum justru karena mencatat lebih banyak. Karena itu
   * yang dipakai adalah tanggal entri (createdAt); menyusul mencatat struk lama
   * tidak pernah bisa menurunkan nilai.
   */
  const hariStrukTertua = sah.length ? Number(sah[0].tanggal.slice(8, 10)) : null;
  const hariEntri = sah.map((t) => entryDayInMonth(t.createdAt, month)).filter((d) => d !== null);
  const mulaiHari = hariEntri.length ? Math.min(...hariEntri) : hariStrukTertua;
  const tanggalMulai = mulaiHari ? `${month}-${String(mulaiHari).padStart(2, '0')}` : null;
  const hariSejakMulai = mulaiHari
    ? Math.max(1, Math.min(elapsedDays(month, now), daysInMonth(month)) - mulaiHari + 1)
    : 0;

  const labaBersih = labaMasuk - labaKeluar;
  const penjualan = perKategori.penjualan ?? 0;

  /*
   * Deret harian untuk grafik: satu titik per hari yang sudah lewat di bulan ini,
   * termasuk hari yang kosong (supaya jeda tidak mencatat terlihat sebagai celah).
   */
  const harianMap = {};
  for (const t of sah) {
    const d = (harianMap[t.tanggal] ??= { tanggal: t.tanggal, masuk: 0, keluar: 0 });
    if (t.jenis === 'masuk') d.masuk += num(t.jumlah);
    else d.keluar += num(t.jumlah);
  }
  const totalHari = Math.min(elapsedDays(month, now) || daysInMonth(month), daysInMonth(month));
  const harian = [];
  for (let d = 1; d <= totalHari; d++) {
    const tanggal = `${month}-${String(d).padStart(2, '0')}`;
    const row = harianMap[tanggal] ?? { tanggal, masuk: 0, keluar: 0 };
    harian.push({ ...row, net: row.masuk - row.keluar, adaCatatan: Boolean(harianMap[tanggal]) });
  }

  const hariBulan = daysInMonth(month);
  const lengkap = hariBerjalan >= hariBulan;

  const summary = {
    month,
    harian,
    jumlahTransaksi: sah.length,
    // Baris yang jenisnya tidak dikenal — nyaris selalu nol. Bukan nol berarti
    // berkas datanya pernah disunting di luar aplikasi ini.
    barisDiabaikan,
    hariTercatat,
    hariBerjalan,
    hariBulan,
    lengkap,
    tanggalMulai,
    hariSejakMulai,
    konsistensi: hariSejakMulai > 0 ? Math.min(1, hariTercatat / hariSejakMulai) : 0,
    /*
     * Cakupan = berapa bagian dari hari yang SUDAH LEWAT yang benar-benar ada
     * catatannya. Beda dengan konsistensi, yang mengukur kebiasaan sejak pengguna
     * mulai dan sengaja memaafkan hari-hari sebelum dia kenal aplikasi ini.
     * Cakupan tidak memaafkan apa pun, karena tugasnya lain: menjawab "boleh
     * tidak angka bulan ini dipakai sebagai angka sebulan?".
     */
    cakupan: hariBerjalan > 0 ? Math.min(1, hariTercatat / hariBerjalan) : 0,
    penjualan,
    lainMasuk: perKategori['lain-masuk'] ?? 0,
    // Modal punya kolom sendiri: kenaikan saldo kas yang datang dari
    // pindahan modal tidak boleh terbaca seperti usaha yang meledak.
    modalMasuk: perKategori['modal-masuk'] ?? 0,
    belanjaBahan: perKategori['belanja-bahan'] ?? 0,
    operasional: perKategori.operasional ?? 0,
    lainKeluar: perKategori['lain-keluar'] ?? 0,
    cicilan: perKategori.cicilan ?? 0,
    prive: perKategori.prive ?? 0,
    totalMasuk,
    totalKeluar,
    labaBersih,
    saldoKas: totalMasuk - totalKeluar,
    // Margin adalah rasio, jadi tidak terpengaruh panjang periode — aman dipakai apa adanya.
    marginBersih: labaMasuk > 0 ? Number(((labaBersih / labaMasuk) * 100).toFixed(1)) : 0,
    perKategori,
  };

  summary.setara = fullMonthEquivalent(summary);
  return summary;
}

/** Kolom rupiah yang ikut disetarakan ke sebulan penuh. Rasio TIDAK ikut. */
const KOLOM_RUPIAH = [
  'penjualan', 'lainMasuk', 'modalMasuk', 'belanjaBahan', 'operasional', 'lainKeluar',
  'cicilan', 'prive', 'totalMasuk', 'totalKeluar', 'labaBersih', 'saldoKas',
];

/**
 * Angka "setara sebulan penuh" — laju harian bulan berjalan dikalikan jumlah hari
 * bulan itu.
 *
 * Pembaginya HARI BERJALAN, bukan hari tercatat. Hari yang lewat tanpa catatan
 * dihitung sebagai nol, bukan diabaikan; hasilnya konservatif (tidak pernah
 * membesar-besarkan usaha di depan bank) dan sekaligus memberi alasan nyata
 * untuk mencatat setiap hari. Bulan yang sudah lewat faktornya 1 — tidak berubah.
 */
export function fullMonthEquivalent(summary) {
  const faktor = summary.lengkap || summary.hariBerjalan <= 0 ? 1 : summary.hariBulan / summary.hariBerjalan;
  const out = { faktor: Number(faktor.toFixed(4)), perkiraan: faktor !== 1 };
  for (const k of KOLOM_RUPIAH) out[k] = Math.round((summary[k] ?? 0) * faktor);
  out.marginBersih = summary.marginBersih;
  return out;
}

/** Bulan-bulan yang punya transaksi, terbaru dulu. */
export function monthsWithData(transactions = []) {
  return [...new Set(transactions.map((t) => String(t.tanggal ?? '').slice(0, 7)).filter(Boolean))].sort().reverse();
}

/**
 * Persen perubahan dari bulan lalu ke bulan ini — atau null bila tidak
 * bisa dihitung dengan jujur.
 *
 * Kasus yang WAJIB aman (semuanya pernah membuat tampilan menampilkan
 * Infinity atau NaN): bulan lalu nol atau tidak ada data → null, karena
 * "naik berapa persen dari nol" tidak bermakna.
 *
 * Pembagi memakai NILAI MUTLAK bulan lalu. Dengan pembagi apa adanya, rugi
 * yang makin dalam (dari −400rb ke −700rb) terbaca "+75%" — tanda terbalik
 * karena pembaginya negatif — dan pemilik melihat panah naik justru saat
 * usahanya makin terpuruk. Mutlak memastikan tanda selalu berarti arah
 * perbaikan. Dibulatkan ke satu desimal: cukup untuk dibaca, tidak
 * berpura-pura presisi.
 */
export function perubahanPersen(lalu, kini) {
  // `Number(null)` adalah 0, bukan NaN — tanpa pemeriksaan eksplisit ini,
  // bulan yang datanya tidak ada terbaca "turun 100%", bukan "tidak bisa
  // dibandingkan".
  if (lalu == null || kini == null) return null;
  const a = Number(lalu);
  const b = Number(kini);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) return null;
  return Number((((b - a) / Math.abs(a)) * 100).toFixed(1));
}

/**
 * Saring transaksi untuk daftar buku kas — pencarian teks, jenis, dan
 * kategori dalam satu fungsi murni.
 *
 * Dipakai rute GET /api/cashbook lewat parameter opsional; ringkasan dan
 * grafik TETAP dihitung dari seluruh transaksi bulan itu (penyaringan hanya
 * untuk daftar), jadi memfilter tidak pernah mengubah angka laporan.
 * Pencarian teks tanpa memeduliikan huruf besar-kecil dan menyentuh
 * keterangan, kategori, dan jenis — kolom satu-satunya yang ada.
 * Nilai filter kosong/asing berarti "tidak disaring".
 */
export function saringTransaksi(transactions = [], { q = '', jenis = '', kategori = '' } = {}) {
  const teks = String(q ?? '').trim().toLowerCase();
  const j = JENIS.includes(jenis) ? jenis : '';
  return transactions.filter((t) => {
    if (j && t.jenis !== j) return false;
    if (kategori && t.kategori !== kategori) return false;
    if (!teks) return true;
    const jerami = `${t.keterangan ?? ''} ${t.kategori ?? ''} ${t.jenis ?? ''}`.toLowerCase();
    return jerami.includes(teks);
  });
}

/**
 * Ambang cakupan: berapa rapat sebuah bulan harus tercatat sebelum angkanya
 * boleh dipakai sebagai angka SEBULAN.
 *
 * 60% memberi kelonggaran untuk usaha yang memang tutup sehari-dua seminggu
 * (warung yang libur tiap Minggu tetap mencapai ~86%), tapi menolak bulan yang
 * jelas-jelas cuma tercatat sepotong. Menaikkan angka bulan yang bolong-bolong
 * seolah-olah sebulan penuh berarti mengarang uang yang tidak pernah dicatat;
 * membiarkannya apa adanya berarti melaporkan usaha lebih kecil dari kenyataan.
 * Karena tidak satu pun dari keduanya boleh, bulan seperti itu tidak dipakai —
 * dan alasannya ditampilkan ke pengguna, bukan didiamkan.
 */
export const CAKUPAN_MINIMAL = 0.6;

/**
 * Sebuah bulan dianggap "tercatat" bila datanya cukup untuk dipercaya sebagai
 * pengganti perkiraan: minimal 10 transaksi, tercatat di minimal 8 hari berbeda,
 * DAN cukup rapat menutupi hari-hari yang sudah lewat.
 *
 * Syarat cakupan itu yang menjaga tanggal 31: 8 hari tercatat dari 31 hari yang
 * sudah lewat tetap saja bukan gambaran sebulan, betapa pun bulannya sudah habis.
 */
export function isMonthReliable(summary) {
  return summary.jumlahTransaksi >= 10 && summary.hariTercatat >= 8 && summary.cakupan >= CAKUPAN_MINIMAL;
}

/**
 * Bulan yang sudah habis DAN tercatat cukup rapat — satu-satunya jenis bulan
 * yang boleh masuk hitungan rata-rata "laba per bulan" di laporan pinjaman.
 *
 * Bulan berjalan yang baru terisi seminggu bukan sebuah bulan. Begitu pula bulan
 * yang sudah lewat tapi hanya tercatat 8 harinya. Keduanya sama-sama menyeret
 * turun angka yang justru paling diperhatikan bank.
 */
export function isMonthComplete(summary) {
  return summary.lengkap && summary.jumlahTransaksi > 0 && summary.cakupan >= CAKUPAN_MINIMAL;
}

/** Ringkasan beberapa bulan terakhir — dipakai untuk laporan pinjaman dan konteks AI. */
export function summarizeRange(transactions = [], months, now = new Date()) {
  return months.map((m) => summarizeMonth(transactions, m, now));
}

/** Daftar bulan mundur dari bulan tertentu, mis. 6 bulan terakhir. */
export function lastMonths(count, from = currentMonth()) {
  const [y, m] = from.split('-').map(Number);
  const out = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(y, m - 1 - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

/**
 * Cari transaksi dengan filter opsional.
 *
 * Murni dan deterministik: tidak menyentuh jaringan, tidak membaca berkas.
 * Batas barisnya diputuskan DI SINI, bukan di prompt — supaya satu pertanyaan
 * peserta tidak bisa menyeret 500 baris ke dalam konteks model dan
 * menghabiskan jatah token hariannya dalam sekali jalan (lihat
 * lib/anggaran.js). Hanya field yang aman dikirim ke model yang dikembalikan;
 * apa pun yang menempel di objek transaksi selain itu ditinggalkan.
 *
 * @param {Array} transactions
 * @param {Object} [opts]
 * @param {string} [opts.dari]     YYYY-MM-DD inklusif
 * @param {string} [opts.sampai]   YYYY-MM-DD inklusif
 * @param {string} [opts.kategori]
 * @param {string} [opts.jenis]    'masuk' | 'keluar'
 * @param {number} [opts.minJumlah]
 * @param {number} [opts.limit]    bawaan 15, batas keras 30, minimum 0
 * @returns {Array} baris tersaring, terurut tanggal terbaru dulu
 */
export function cariTransaksi(transactions = [], opts = {}) {
  if (!Array.isArray(transactions)) return [];

  const { dari, sampai, kategori, jenis, minJumlah, limit: limitMentah = 15 } = opts || {};

  let limit = Number(limitMentah);
  if (!Number.isFinite(limit) || limit < 0) limit = 0;
  if (limit > 30) limit = 30;

  const min = minJumlah != null ? Number(minJumlah) : null;

  const rows = transactions.filter((t) => {
    if (!t || typeof t.tanggal !== 'string') return false;
    if (dari && t.tanggal < dari) return false;
    if (sampai && t.tanggal > sampai) return false;
    if (kategori && t.kategori !== kategori) return false;
    if (jenis && t.jenis !== jenis) return false;
    if (min != null && Number.isFinite(min) && num(t.jumlah) < min) return false;
    return true;
  });

  // Terbaru dulu; id sebagai pemutus seri supaya urutannya tetap sama pada
  // dua transaksi bertanggal identik — hasil yang berpindah-pindah urutan
  // membuat jawaban AI tidak bisa ditelusuri ulang saat analisis data.
  rows.sort((a, b) => {
    if (a.tanggal !== b.tanggal) return b.tanggal.localeCompare(a.tanggal);
    return String(b.id ?? '').localeCompare(String(a.id ?? ''));
  });

  return rows.slice(0, limit).map((t) => ({
    id: t.id,
    tanggal: t.tanggal,
    jenis: t.jenis,
    kategori: t.kategori,
    jumlah: num(t.jumlah),
    keterangan: t.keterangan ?? '',
  }));
}
