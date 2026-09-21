/**
 * Data demo — lima usaha fiktif yang selalu terisi penuh untuk akun DEMO.
 *
 * ------------------------------------------------------------------
 * KENAPA BERKAS INI ADA
 *
 * Akun batch DEMO (101–105) dibuat untuk diperlihatkan: ke calon pembeli,
 * ke mitra, ke siapa pun yang ingin mencoba aplikasi tanpa mengisi data
 * sungguhan. Karantina batch tetap memisahkannya dari akun nyata. Akun tanpa data membuat aplikasi tampak setengah jadi —
 * grafik kosong, rekomendasi kosong, riwayat chat kosong — padahal yang
 * kosong hanyalah akunnya, bukan fiturnya.
 *
 * Karena itu data demo DIISI OLEH SERVER SENDIRI saat menyala:
 *
 *   1. Akun DEMO tanpa profil  → diisi penuh ~90 hari riwayat.
 *   2. Akun DEMO yang sudah ada → dilanjutkan sampai hari ini, supaya
 *      "3 bulan terakhir" tidak pernah menjadi "3 bulan lalu".
 *
 * Tanpa langkah kedua, demo yang dibuat bulan Agustus tampil usang saat
 * dibuka bulan Desember — penjualan terakhir tercatat empat bulan silam,
 * dan aplikasi yang mengklaim "membantu mencatat harian" justru
 * memperlihatkan peserta yang berhenti mencatat.
 *
 * ------------------------------------------------------------------
 * KENAPA ANGKANYA DIBANGKITKAN, BUKAN DITULIS TANGAN
 *
 * Lima persona × 90 hari × 2–5 transaksi = ribuan baris. Yang ditulis
 * tangan hanyalah POLANYa (berapa kali belanja bahan seminggu, berapa
 * persen omzetnya, kapan cicilan jatuh). Angka hariannya dibangkitkan
 * dari PRNG berbenih tetap — sehingga:
 *
 *   - tiap akun selalu mendapat angka yang SAMA pada tanggal yang sama,
 *     jadi tangkapan layar dan papan cerita demo tidak pernah berubah;
 *   - angka di rekomendasi dan riwayat chat DIHITUNG dari transaksi yang
 *     sama, bukan dikarang terpisah — AI demo tidak pernah terlihat
 *     "halusinasi" karena menjumlah angka yang tidak saling cocok.
 *
 * Semua persona sengaja dibuat SEHAT tapi tidak sempurna: laba positif,
 * margin wajar, cicilan tertanggung — dengan satu-dua kelemahan jujur
 * (prive terlalu sering, uang masih tercampur) supaya rekomendasi AI
 * punya sesuatu yang nyata untuk diperbaiki. Demo yang serba sempurna
 * membuat fitur rekomendasi tidak punya pekerjaan.
 *
 * ------------------------------------------------------------------
 * BATAS YANG DIJAGA
 *
 * Generator ini TIDAK PERNAH menyentuh peserta sungguhan: hanya akun
 * bermeta batch === 'DEMO'. Salah konfigurasi sekalipun tidak bisa
 * membuatnya menimpa pembukuan peserta penelitian.
 */
import { createHash } from 'node:crypto';

import { tanggalWIB } from './cashbook.js';
import { CONSENT_VERSION } from './consent.js';
import { KURIKULUM } from './kurikulum.js';

/* --------------------------------------------------------------- Kode demo */

/**
 * Kode akses demo: 101 sampai 120.
 *
 * Tiga digit sengaja — kode demo memang untuk diketik cepat di depan juri,
 * bukan untuk dijaga dari penebakan. Yang menjaga data peserta sungguhan
 * bukan kerahasiaan kode demo: peserta memakai format NOVA-XXXX-XXXX yang
 * tidak mungkin bertabrakan dengan angka ini, dan pembatas login tetap
 * berlaku untuk kode apa pun.
 *
 * Pemetaannya tetap: 101–105 adalah kelima usaha contoh asli (warung nasi,
 * kelontong, laundry, snack, keripik) — nomor yang sama dengan nomor peserta
 * lama mereka. 106–120 diikat ke akun yang dibuat otomatis saat server
 * menyala (lihat pastikanDemoSiap di server.js) dengan persona berputar.
 */
export const KODE_DEMO = Array.from({ length: 20 }, (_, i) => String(101 + i));

/** Berapa hari riwayat yang dibangkitkan saat pengisian pertama. */
const HARI_AWAL = 92;

/* --------------------------------------------------------------- PRNG tetap */

/**
 * mulberry32 — PRNG kecil yang hasilnya stabil di semua Node dan platform.
 * Benih diambil dari ID pengguna, bukan dari jam: dua hidupan server yang
 * mengisi akun yang sama harus menghasilkan transaksi yang sama persis.
 */
function prngDari(benih) {
  const hash = createHash('sha256').update(String(benih)).digest();
  let a = hash.readUInt32LE(0);
  return function acak() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const antar = (rng, min, max) => min + rng() * (max - min);
const bulat = (n) => Math.round(n / 1000) * 1000; // dibulatkan ke ribuan — seperti uang sungguhan

/* --------------------------------------------------------------- Persona */

/**
 * Tiap persona mendefinisikan POLA usaha, bukan transaksinya.
 *
 *   penjualanHarian(hariKe, rng)  → omzet hari itu (Rp), 0 = tutup
 *   belanjaBahan(omzet, rng)     → biaya bahan hari itu
 *   tetap()                      → transaksi rutin: [jenis, kategori, jumlah, hari-ofset, keterangan]
 *   prive(rng)                   → pengambilan pribadi hari itu (atau null)
 */
const DAFTAR_PERSONA = [
  {
    id: 'usr_f37a37b403ed',
    nama: 'Warung Nasi Bu Rina',
    bisnis: 'Warung nasi rames & kopi',
    hariMulaiLalu: 24,
    sesiSelesai: 7,
    modulPustaka: 2,
    profil: {
      namaUsaha: 'Warung Nasi Bu Rina',
      jenisUsaha: 'kuliner',
      lokasi: 'Semarang',
      lamaUsahaBulan: 36,
      jumlahKaryawan: 1,
      produkUtama: 'Nasi rames, nasi ayam, kopi tubruk',
      omzetBulanan: 19500000,
      belanjaBulanan: 8200000,
      biayaOperasional: 2400000,
      cicilanBulanan: 450000,
      pencatatan: 'aplikasi',
      rekeningTerpisah: false,
      punyaNib: true,
      tujuan: 'ajukan-kur',
      tantangan: 'Uang warung dan uang dapur rumah sering tercampur, jadi tidak tahu laba sebenarnya.',
    },
    penjualanHarian(hariKe, rng) {
      // Warung makan buka tiap hari; akhir pekan lebih ramai (orang tak masak).
      const dasar = antar(rng, 550, 750);
      const faktor = hariKe % 7 >= 5 ? 1.2 : 1;
      return bulat(dasar * faktor * 1000);
    },
    belanjaBahan(omzet, rng) {
      return bulat(omzet * antar(rng, 0.55, 0.62));
    },
    tetap: [
      { kategori: 'operasional', jumlah: 22000, tiapHari: 3, keterangan: 'Gas 3 kg' },
      { kategori: 'operasional', jumlah: 500000, tiapHari: 7, keterangan: 'Upah penjual (mingguan)' },
      { kategori: 'operasional', jumlah: 185000, tiapHari: 30, keterangan: 'Listrik & air' },
    ],
    cicilan: { jumlah: 450000, tgl: 5, keterangan: 'Cicilan KUR warung' },
    prive(rng) {
      // Senin & Jumat ambil belanja dapur rumah — kebiasaan yang nanti
      // diangkat rekomendasi AI sebagai "uang masih tercampur".
      return rng() < 0.3 ? bulat(antar(rng, 60, 110) * 1000) : null;
    },
    keteranganJual: ['Jual nasi rames', 'Penjualan warung harian', 'Jual nasi ayam + kopi'],
  },
  {
    id: 'usr_3683b1949f69',
    nama: 'Toko Kelontong Maju Jaya',
    bisnis: 'Toko kelontong sembako',
    hariMulaiLalu: 22,
    sesiSelesai: 7,
    modulPustaka: 1,
    profil: {
      namaUsaha: 'Toko Kelontong Maju Jaya',
      jenisUsaha: 'retail',
      lokasi: 'Semarang',
      lamaUsahaBulan: 60,
      jumlahKaryawan: 0,
      produkUtama: 'Sembako, minuman, kudapan',
      omzetBulanan: 15000000,
      belanjaBulanan: 11800000,
      biayaOperasional: 1100000,
      cicilanBulanan: 0,
      pencatatan: 'buku',
      rekeningTerpisah: true,
      punyaNib: true,
      tujuan: 'naikkan-laba',
      tantangan: 'Margin tipis; stok yang lambat laku memakan kas.',
    },
    penjualanHarian(hariKe, rng) {
      const dasar = antar(rng, 420, 620);
      const faktor = hariKe % 7 >= 5 ? 1.25 : 1;
      return bulat(dasar * faktor * 1000);
    },
    /*
     * Belanja HARIAN, bukan borongan dua-mingguan. Kulakan besar membuat
     * bulan kalender bergantian memuat satu vs dua pembelian — margin
     * bergelombang 25%↔70%, dan pada benih tanggal tertentu warung contoh
     * ini tampak RUGI (pernah −11%). Belanja harian pada porsi 62–68% omzet
     * menempel pada profil persona (belanja 11,8 jt dari omzet 15 jt) dan
     * menghasilkan margin sehat yang stabil di setiap bulan dan setiap
     * benih tanggal. Kisah "borongan membuat laporan bergelombang" tetap
     * diajarkan Modul 11 — lewat materinya, bukan lewat akun contoh yang
     * harus selalu sehat.
     */
    belanjaBahan(omzet, rng) {
      return bulat(omzet * antar(rng, 0.62, 0.68));
    },
    tetap: [
      { kategori: 'operasional', jumlah: 260000, tiapHari: 30, keterangan: 'Listrik toko' },
      { kategori: 'operasional', jumlah: 30000, tiapHari: 7, keterangan: 'Kantong & plastik' },
    ],
    prive(rng) {
      return rng() < 0.5 ? bulat(antar(rng, 120, 180) * 1000) : null;
    },
    keteranganJual: ['Penjualan kasir harian', 'Penjualan akhir pekan', 'Penjualan sembako'],
  },
  {
    id: 'usr_a5354dec9411',
    nama: 'Laundry Kilat Mbak Dewi',
    bisnis: 'Laundry kiloan & satuan',
    hariMulaiLalu: 6,
    sesiSelesai: 6,
    modulPustaka: 0,
    profil: {
      namaUsaha: 'Laundry Kilat Mbak Dewi',
      jenisUsaha: 'jasa',
      lokasi: 'Semarang',
      lamaUsahaBulan: 18,
      jumlahKaryawan: 1,
      produkUtama: 'Cuci kiloan, setrika, cuci sepatu',
      omzetBulanan: 9500000,
      belanjaBulanan: 1400000,
      biayaOperasional: 2600000,
      cicilanBulanan: 620000,
      pencatatan: 'kadang',
      rekeningTerpisah: false,
      punyaNib: false,
      tujuan: 'rapikan-keuangan',
      tantangan: 'Pelanggan sering bayar tempo, catatannya mental saja.',
    },
    penjualanHarian(hariKe, rng) {
      // Minggu sepi (orang mencuci sendiri), Senin–Jumat ramai.
      const dasar = antar(rng, 200, 340);
      const faktor = hariKe % 7 === 6 ? 0.45 : 1;
      return bulat(dasar * faktor * 1000);
    },
    belanjaBahan() {
      return null;
    },
    tetap: [
      { kategori: 'operasional', jumlah: 200000, tiapHari: 7, keterangan: 'Deterjen, pewangi, tisu' },
      { kategori: 'operasional', jumlah: 450000, tiapHari: 30, keterangan: 'Listrik & air (pemanas)' },
      { kategori: 'operasional', jumlah: 600000, tiapHari: 7, keterangan: 'Upah penjaga (mingguan)' },
    ],
    belanjaBesar: { tiapHari: 21, porsi: [0.05, 0.08], keterangan: 'Stok mesin cuci & sabun kiloan' },
    cicilan: { jumlah: 620000, tgl: 10, keterangan: 'Cicilan mesin cuci 2 unit' },
    prive(rng) {
      return rng() < 0.35 ? bulat(antar(rng, 80, 130) * 1000) : null;
    },
    keteranganJual: ['Hasil cucian kiloan', 'Setrika satuan', 'Cuci sepatu 2 pasang'],
  },
  {
    id: 'usr_e6d4a8e4f5cd',
    nama: 'Dapur Snack Aulia',
    bisnis: 'Kue & snack pre-order online',
    hariMulaiLalu: 2,
    sesiSelesai: 2,
    modulPustaka: 0,
    profil: {
      namaUsaha: 'Dapur Snack Aulia',
      jenisUsaha: 'online',
      lokasi: 'Semarang',
      lamaUsahaBulan: 9,
      jumlahKaryawan: 0,
      produkUtama: 'Brownies, nastar, pisang crispy (pre-order)',
      omzetBulanan: 7800000,
      belanjaBulanan: 3100000,
      biayaOperasional: 900000,
      cicilanBulanan: 0,
      pencatatan: 'belum',
      rekeningTerpisah: false,
      punyaNib: false,
      tujuan: 'kembangkan-usaha',
      tantangan: 'Order datang burst saat ramai, bahan sering kehabisan dadakan.',
    },
    penjualanHarian(hariKe, rng) {
      // Pre-order bergelombang: dua-tiga hari ramai lalu sepi.
      const gelombang = hariKe % 3 === 0 ? antar(rng, 650, 980) : antar(rng, 90, 220);
      return bulat(gelombang * 1000);
    },
    belanjaBahan(omzet, rng) {
      if (omzet < 400000) return null; // hari sepi tidak belanja bahan
      return bulat(omzet * antar(rng, 0.5, 0.58));
    },
    tetap: [
      { kategori: 'operasional', jumlah: 85000, tiapHari: 7, keterangan: 'Kardus, paper bag, sticker' },
      { kategori: 'operasional', jumlah: 100000, tiapHari: 7, keterangan: 'Iklan medsos' },
    ],
    prive(rng) {
      return rng() < 0.25 ? bulat(antar(rng, 70, 120) * 1000) : null;
    },
    keteranganJual: ['Batch brownies PO', 'Nastar 20 toples', 'Penjualan pisang crispy'],
  },
  {
    id: 'usr_6d2ff8796a9f',
    nama: 'Keripik Singkong Pak Kumis',
    bisnis: 'Produksi keripik rumahan',
    hariMulaiLalu: 20,
    sesiSelesai: 5,
    modulPustaka: 1,
    profil: {
      namaUsaha: 'Keripik Singkong Pak Kumis',
      jenisUsaha: 'produksi',
      lokasi: 'Semarang',
      lamaUsahaBulan: 48,
      jumlahKaryawan: 2,
      produkUtama: 'Keripik singkong balado & original',
      omzetBulanan: 12500000,
      belanjaBulanan: 6100000,
      biayaOperasional: 2300000,
      cicilanBulanan: 380000,
      pencatatan: 'excel',
      rekeningTerpisah: true,
      punyaNib: true,
      tujuan: 'kelola-stok',
      tantangan: 'Harga singkong naik-turun, HPP jadi sulit ditebak.',
    },
    penjualanHarian(hariKe, rng) {
      // Reseller jemput tiap 2–3 hari; retail kecil tiap hari.
      const dasar = antar(rng, 120, 220);
      const ambil = hariKe % 3 === 0 ? antar(rng, 550, 850) : 0;
      return bulat((dasar + ambil) * 1000);
    },
    belanjaBahan(omzet, rng) {
      if (omzet < 300000) return null;
      return bulat(omzet * antar(rng, 0.5, 0.58));
    },
    tetap: [
      { kategori: 'operasional', jumlah: 24000, tiapHari: 3, keterangan: 'Gas 12 kg (goreng)' },
      { kategori: 'operasional', jumlah: 95000, tiapHari: 7, keterangan: 'Minyak goreng & bumbu balado' },
      { kategori: 'operasional', jumlah: 70000, tiapHari: 7, keterangan: 'Kemasan & label' },
      { kategori: 'operasional', jumlah: 200000, tiapHari: 30, keterangan: 'Listrik & air' },
      { kategori: 'operasional', jumlah: 900000, tiapHari: 14, keterangan: 'Upah 2 pekerja (dua mingguan)' },
    ],
    cicilan: { jumlah: 380000, tgl: 5, keterangan: 'Cicilan mesin pemotong' },
    prive(rng) {
      return rng() < 0.3 ? bulat(antar(rng, 100, 160) * 1000) : null;
    },
    keteranganJual: ['Kirim reseller 30 kg', 'Penjualan retail rumah', 'Kirim reseller 50 kg'],
  },
];

/* --------------------------------------------------------------- Bangkitan */

function tanggalMundur(dariISO, hari) {
  const t = new Date(`${dariISO}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - hari);
  return t.toISOString().slice(0, 10);
}

function hariDariISO(iso) {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

/** Nomor modul dari nomor sesi — penomoran pustaka tidak diasumsikan. */
function nomorSesi(n) {
  const m = KURIKULUM.find((k) => k.sesi === n);
  return m?.no ?? null;
}

/** Nomor-nomor modul pustaka (sesi == null), untuk progres tambahan. */
function nomorPustaka() {
  return KURIKULUM.filter((k) => k.sesi == null).map((k) => k.no);
}

/**
 * Satu hari kehidupan usaha → daftar transaksi.
 * `hariKe` dihitung dari awal riwayat, bukan tanggal kalender, supaya pola
 * mingguan (akhir pekan ramai) bergeser realistis antar persona.
 */
function transaksiHari(persona, hariKe, tanggal, rng) {
  const rows = [];
  const dorong = (jenis, kategori, jumlah, keterangan) => {
    if (!jumlah || jumlah <= 0) return;
    rows.push({
      id: `trx_${createHash('sha256').update(`${tanggal}:${jenis}:${kategori}:${keterangan}:${rows.length}`).digest('hex').slice(0, 12)}`,
      tanggal,
      jenis,
      kategori,
      keterangan,
      jumlah: Math.round(jumlah),
      createdAt: `${tanggal}T${String(10 + (hariKe % 9)).padStart(2, '0')}.${String((hariKe * 17) % 60).padStart(2, '0')}:00.000Z`,
    });
  };

  const dow = hariDariISO(tanggal);
  const omzet = persona.penjualanHarian(hariKe, rng);
  if (omzet > 0) {
    const label = persona.keteranganJual[hariKe % persona.keteranganJual.length];
    dorong('masuk', 'penjualan', omzet, label);
  }

  const bahan = persona.belanjaBahan(omzet, rng);
  if (bahan) dorong('keluar', 'belanja-bahan', bahan, 'Belanja bahan / baku');

  for (const t of persona.tetap ?? []) {
    if (hariKe % t.tiapHari !== 0) continue;
    dorong('keluar', 'operasional', t.jumlah, t.keterangan);
  }

  if (persona.belanjaBesar && hariKe % persona.belanjaBesar.tiapHari === 0 && hariKe > 0) {
    /*
     * Faktor penyetel porsi bahan per persona (bawaan 0.9). Kelontong
     * memakai 0.72: dengan 0.9, belanja borongannya menyerap 82–87% omzet —
     * melampaui 70,7% yang dinyatakan profilnya sendiri — sehingga pada
     * benih tanggal tertentu warung contoh ini RUGI, melanggar janji bahwa
     * semua persona demo sehat. 0.72 menurunkan porsinya ke 65–70% omzet
     * (margin ±12%) di benih tanggal berapa pun.
     */
    const acuan = omzet * persona.belanjaBesar.tiapHari * (persona.belanjaBesar.faktor ?? 0.9); // stok untuk periode berikut
    dorong('keluar', 'belanja-bahan', bulat(acuan * antar(rng, persona.belanjaBesar.porsi[0], persona.belanjaBesar.porsi[1])), persona.belanjaBesar.keterangan);
  }

  if (persona.cicilan) {
    const tgl = Number(tanggal.slice(8, 10));
    if (tgl === persona.cicilan.tgl) dorong('keluar', 'cicilan', persona.cicilan.jumlah, persona.cicilan.keterangan);
  }

  const prive = persona.prive(rng);
  if (prive) dorong('keluar', 'prive', prive, dow % 7 >= 5 ? 'Prive akhir pekan' : 'Prive keperluan rumah');

  return rows;
}

/** Ringkasan satu bulan dari daftar transaksi — angka demo dihitung dari sini. */
export function ringkasBulan(trx, bulan) {
  const r = { penjualan: 0, bahan: 0, operasional: 0, cicilan: 0, prive: 0, jumlah: 0 };
  for (const t of trx) {
    if (!t.tanggal?.startsWith(bulan)) continue;
    r.jumlah += 1;
    if (t.jenis !== 'keluar') { r.penjualan += t.jumlah; continue; }
    if (t.kategori === 'belanja-bahan') r.bahan += t.jumlah;
    else if (t.kategori === 'operasional') r.operasional += t.jumlah;
    else if (t.kategori === 'cicilan') r.cicilan += t.jumlah;
    else if (t.kategori === 'prive') r.prive += t.jumlah;
  }
  r.laba = r.penjualan - r.bahan - r.operasional;
  r.margin = r.penjualan > 0 ? (r.laba / r.penjualan) * 100 : 0;
  return r;
}

const rp = (n) => 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(n));

/** Bulan penuh terakhir sebelum hari ini, sebagai YYYY-MM. */
function bulanPenuhTerakhir(hariIni) {
  const [y, m] = hariIni.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 2, 1));
  return t.toISOString().slice(0, 7);
}

/* ------------------------------------------------- Rekomendasi & percakapan */

/**
 * Rekomendasi dibangun dari angka yang benar-benar dihasilkan generator,
 * dengan bentuk persis RECOMMENDATION_SCHEMA — supaya kartunya tampil utuh
 * dan tidak terlihat "belum pernah dipakai".
 */
export function susunRekomendasi(persona, trx, hariIni) {
  // Diekspor semata agar kontrak provenansinya bisa dipatrikan langsung di
  // uji — pola yang sama dengan keUsage di lib/gemini.js.
  const bulan = bulanPenuhTerakhir(hariIni);
  const s = ringkasBulan(trx, bulan);
  const namaBulan = new Date(`${bulan}-01T00:00:00Z`).toLocaleDateString('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const labaCicilan = s.cicilan > 0 ? (s.cicilan / Math.max(s.laba, 1)) * 100 : 0;

  const rekomendasi = [
    {
      judul: `Kunci porsi bahan di ${Math.round((s.bahan / Math.max(s.penjualan, 1)) * 100)}% omzet`,
      prioritas: s.margin < 15 ? 'tinggi' : 'sedang',
      alasan: `Bulan ${namaBulan} bahan menyerap ${rp(s.bahan)} dari penjualan ${rp(s.penjualan)}. Setiap turun 2 poin saja menambah laba sekitar ${rp(s.penjualan * 0.02)} sebulan.`,
      langkah: [
        'Catat total belanja bahan tiap kali belanja — aplikasi ini sudah mengelompokkannya otomatis.',
        'Tetapkan patokan belanja mingguan dari rata-rata bulan lalu, tulis di papan warung.',
        'Bandingkan tiap akhir minggu: bahan minggu ini vs omzet minggu ini.',
      ],
      dampak: `Sekitar ${rp(s.penjualan * 0.02)} laba tambahan per bulan bila porsi turun 2%.`,
      modulTerkait: nomorSesi(5) ?? nomorSesi(4),
    },
    {
      judul: 'Pisahkan uang usaha dan uang rumah',
      prioritas: s.prive > s.laba * 0.6 ? 'tinggi' : 'sedang',
      alasan: `Prive bulan ${namaBulan} tercatat ${rp(s.prive)} dari laba ${rp(s.laba)} — ${Math.round((s.prive / Math.max(s.laba, 1)) * 100)}% laba diambil keluar sebelum sempat diputar kembali.`,
      langkah: [
        'Ambil "gaji tetap" sekali seminggu dengan jumlah sama, catat sebagai prive.',
        'Sisanya biarkan di dompet/rekening usaha sampai akhir bulan.',
        'Cek halaman Buku Kas: barang prive sudah dibedakan dari biaya usaha.',
      ],
      dampak: 'Kas usaha lebih stabil untuk belanja bahan awal bulan.',
      modulTerkait: nomorSesi(1) ?? nomorSesi(2),
    },
    {
      judul: 'Jadwalkan catat kas 5 menit tiap tutup',
      prioritas: 'sedang',
      alasan: 'Data yang rapi adalah syarat laporan KUR — bank meminta 3–6 bulan catatan berkelanjutan, bukan sebagian hari.',
      langkah: [
        'Tutup kas: catat satu baris penjualan total hari itu sebelum merapikan warung.',
        'Foto nota belanja bahan, catat besok pagi bila malam sudah lelah.',
        'Lihat grafik "sisa uang per hari" sekali seminggu.',
      ],
      dampak: 'Laporan KUR 3 bulan bisa dicetak tanpa mengarang angka.',
      modulTerkait: nomorSesi(3) ?? nomorSesi(1),
    },
  ];

  if (s.cicilan > 0) {
    rekomendasi.push({
      judul: `Jaga cicilan di bawah 30% laba`,
      prioritas: labaCicilan > 30 ? 'tinggi' : 'rendah',
      alasan: `Cicilan ${rp(s.cicilan)} per bulan adalah ${Math.round(labaCicilan)}% dari laba ${namaBulan.toLowerCase()}. ${labaCicilan > 30 ? 'Ini di atas ambang aman — laba wajib naik sebelum menambah pinjaman.' : 'Masih dalam ambang aman bank.'}`,
      langkah: [
        'Sisihkan uang cicilan di awal bulan, jangan menunggu sisa.',
        'Simulasi di halaman Laporan: ganti jumlah bulan untuk melihat rata-rata laba.',
      ],
      dampak: 'Rasio cicilan-laba yang sehat memperbesar peluang KUR disetujui.',
      modulTerkait: nomorSesi(7) ?? nomorSesi(5),
    });
  }

  return {
    ringkasan: `Bulan ${namaBulan} ${persona.nama} mencatat penjualan ${rp(s.penjualan)} dengan laba bersih ${rp(s.laba)} (margin ${s.margin.toFixed(1)}%). ${s.prive > 0 ? `Pemilik mengambil prive ${rp(s.prive)} — uang pribadi dan usaha masih berputar di dompet yang sama.` : 'Pengambilan pribadi sudah tercatat rapi.'}`,
    rekomendasi,
    peringatan: labaCicilan > 30
      ? [`Cicilan ${rp(s.cicilan)} menyerap ${Math.round(labaCicilan)}% laba — di atas patokan aman 30%.`]
      : (s.margin < 10 ? [`Margin ${s.margin.toFixed(1)}% sangat tipis; periksa harga jual dan porsi bahan.`] : []),
    targetBulanIni: [
      `Belanja bahan maksimal ${Math.round((s.bahan / Math.max(s.penjualan, 1)) * 100 - 2)}% dari omzet`,
      `Prive tetap sekali seminggu, total di bawah ${rp(Math.max(s.prive * 0.7, 100000))}`,
      'Nol hari tanpa catat kas — termasuk hari sepi',
    ],
    generatedAt: `${hariIni}T02:00:00.000Z`,
    // Benih demo adalah susunan kurasi, BUKAN keluaran model mana pun. Tanpa
    // tanda ini permukaan tampilan akan mati sebagai "AI segar" — dusta
    // provenansi pada akun yang justru paling sering dilihat orang baru.
    sumber: 'contoh',
  };
}

/**
 * Dua-tiga giliran percakapan yang menyebut angka sendiri.
 * Jawaban ditulis dalam gaya asisten: pendek, memakai angka peserta,
 * menunjuk modul yang relevan.
 */
function susunChat(persona, trx, hariIni) {
  const bulan = bulanPenuhTerakhir(hariIni);
  const s = ringkasBulan(trx, bulan);
  const namaBulan = new Date(`${bulan}-01T00:00:00Z`).toLocaleDateString('id-ID', { month: 'long', timeZone: 'UTC' });
  const tanya = (iso, h, m) => `${iso}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;

  return [
    {
      role: 'user',
      content: 'Labaku bulan lalu sebenarnya berapa? Aku selama ini cuma merasakan sisa uangnya.',
      ts: tanya(tanggalMundur(hariIni, 6), 20, 15),
    },
    {
      role: 'assistant',
      content: `Dari catatan kas ${persona.nama} bulan ${namaBulan}: penjualan ${rp(s.penjualan)}, bahan ${rp(s.bahan)}, biaya operasional ${rp(s.operasional)}. Laba bersihnya **${rp(s.laba)}** (margin ${s.margin.toFixed(1)}%).${s.prive > 0 ? ` Yang sering membuat sisa uang terasa kecil adalah prive — bulan itu kamu mengambil ${rp(s.prive)} untuk keperluan pribadi. Prive tidak mengurangi laba, tapi mengurangi kas di tangan.` : ''} Cara menghitungnya dibahas di sesi "Laba rugi sederhana": laba dan uang tunai memang dua hal berbeda.`,
      ts: tanya(tanggalMundur(hariIni, 6), 20, 16),
    },
    {
      role: 'user',
      content: persona.profil.cicilanBulanan > 0 ? 'Kalau aku ajukan tambahan KUR, kuat tidak labaku menanggung cicilan baru?' : 'Bagaimana caranya supaya catatanku bisa dipakai buat mengajukan KUR?',
      ts: tanya(tanggalMundur(hariIni, 4), 9, 40),
    },
    {
      role: 'assistant',
      content: persona.profil.cicilanBulanan > 0
        ? `Patokan umum: seluruh cicilan sebaiknya di bawah 30% laba bersih. Laba ${namaBulan.toLowerCase()}mu ${rp(s.laba)}${s.cicilan > 0 ? `, cicilan saat ini ${rp(s.cicilan)} (${Math.round((s.cicilan / Math.max(s.laba, 1)) * 100)}% laba)` : ''}. Artinya ruang cicilan tambahan yang aman sekitar **${rp(Math.max(s.laba * 0.3 - s.cicilan, 0))} per bulan**. Bank juga akan melihat kestabilan catatan 3–6 bulan — halaman Laporan menyusunnya otomatis dari buku kasmu. Materi ini di Modul 13.`
        : `Bank pada umumnya meminta catatan penjualan dan pengeluaran 3–6 bulan berkelanjutan. Buku kasmu di sini sudah berformat itu — tinggal buka halaman **Laporan**, pilih 6 bulan, lalu cetak/simpan PDF-nya. Yang perlu dijaga: jangan ada hari kosong catatan, karena celah panjang membuat bank bertanya datanya lengkap atau tidak. Langkah-langkahnya di sesi "Laporan bulanan dan berkas untuk KUR".`,
      ts: tanya(tanggalMundur(hariIni, 4), 9, 42),
    },
  ];
}

/* --------------------------------------------------------------- Perakitan */

/** Susun seluruh isi sebuah akun demo untuk rentang tanggal berikut. */
function bangunRiwayat(persona, dariTanggal, sampaiTanggal, rng) {
  const transactions = [];
  let hariKe = 0;
  for (let t = dariTanggal; t <= sampaiTanggal; t = tanggalMundur(t, -1), hariKe += 1) {
    transactions.push(...transaksiHari(persona, hariKe, t, rng));
  }
  return transactions;
}

/** Progres belajar: sesi selesai + beberapa modul pustaka. */
function bangunProgres(persona) {
  const done = {};
  for (let s = 1; s <= persona.sesiSelesai; s += 1) {
    const no = nomorSesi(s);
    if (no != null) done[no] = true;
  }
  const pustaka = nomorPustaka();
  for (let i = 0; i < persona.modulPustaka && i < pustaka.length; i += 1) {
    done[pustaka[i]] = true;
  }
  return { done };
}

/** Kejadian (events) yang wajar untuk peserta seaktif ini — dibatasi agar tidak membengkak. */
function bangunEvents(persona, hariIni, transactions) {
  const ev = [];
  // Bentuk sama dengan pushEvent di store.js: {ts, type, meta} — ekspor
  // penelitian membaca 'type'; bentuk lain diam-diacatatan kosong di events.csv.
  const dorong = (type, ts, meta = {}) => ev.push({ ts, type, ...(Object.keys(meta).length ? { meta } : {}) });
  const waktu = (hariLalu, h = 9) => `${tanggalMundur(hariIni, hariLalu)}T${String(h).padStart(2, '0')}:${String((hariLalu * 13) % 60).padStart(2, '0')}:00.000Z`;

  // Kosakata SATU sumber (Sesi G lanjutan — menutup tanya terbuka #9 laporan
  // Sesi G): demo memancarkan transaction_added PER BARIS, meta bentuk SAMA
  // PERSIS dengan mutator store (jenis, kategori, tanggal, mundur, origin) —
  // bukan lagi ringkasan jamak. Nominal tetap tidak pernah masuk jejak. Baris
  // didorong PALING AWAL supaya sapuan batas 60 di bawah memangkas yang
  // terlama dulu dan peristiwa lain (login, modul) tetap hidup di jejak demo.
  for (const t of transactions) {
    dorong('transaction_added', t.createdAt, {
      jenis: t.jenis,
      kategori: t.kategori,
      tanggal: t.tanggal,
      mundur: t.tanggal < String(t.createdAt ?? '').slice(0, 10),
      origin: 'manual',
    });
  }

  dorong('user_created', waktu(persona.hariMulaiLalu + 1), { batch: 'DEMO', seed: true });
  for (let s = 1; s <= persona.sesiSelesai; s += 1) {
    // Bentuk meta mengikuti store.saveProgress: modul adalah DAFTAR angka,
    // bukan skalar — satu jenis peristiwa, satu bentuk meta (penelitian.test
    // membacanya sebagai daftar).
    dorong('module_completed', waktu(persona.hariMulaiLalu - s + 1, 21), { modul: [nomorSesi(s)] });
  }
  for (let i = persona.hariMulaiLalu; i > 0; i -= 3) dorong('login', waktu(i, 7));
  dorong('report_viewed', waktu(3, 10), { bulan: 3 });
  dorong('chat_turn', waktu(4, 10), { pesan: 2 });
  dorong('recommendations_generated', waktu(5, 8), { jumlah: 3, peringatan: 0 });

  return ev.slice(-60);
}

/**
 * Mengisi satu pengguna demo dari nol.
 * Mengembalikan patch yang diterapkan store — semua medan yang disentuh
 * adalah medan data (bukan kolom SQL terpisah) kecuali yang disebut eksplisit.
 */
/**
 * Mengisi satu pengguna demo dari nol.
 *
 * `kunciSeed` menentukan benih angka. Bawaannya ID persona — begitulah
 * kelima akun asli selalu mendapat angka yang sama pada tanggal yang sama.
 * Akun tambahan yang berbagi persona (106–120) WAJIB mengirim kunci
 * berbeda (ID penggunanya), kalau tidak lima belas warung akan punya
 * pembukuan identik baris demi baris.
 */
export function isiDemoPenuh(persona, hariIni = tanggalWIB(), kunciSeed = persona.id) {
  const mulaiPada = tanggalMundur(hariIni, persona.hariMulaiLalu);
  const dari = tanggalMundur(hariIni, HARI_AWAL);
  const rng = prngDari(kunciSeed);
  const transactions = bangunRiwayat(persona, dari, hariIni, rng);

  return {
    name: persona.nama,
    business: persona.bisnis,
    profile: { ...persona.profil },
    profileHistory: [],
    mulaiPada,
    consent: { versi: CONSENT_VERSION, agreedAt: `${tanggalMundur(hariIni, persona.hariMulaiLalu)}T08:00:00.000Z` },
    progress: bangunProgres(persona),
    recommendations: susunRekomendasi(persona, transactions, hariIni),
    chat: susunChat(persona, transactions, hariIni),
    transactions,
    events: bangunEvents(persona, hariIni, transactions),
    usage: { requests: 23, inputTokens: 41200, outputTokens: 9800 },
    demoMeta: { versi: 1, dibuatPada: new Date().toISOString(), generatedHingga: hariIni },
  };
}

/**
 * Melanjutkan riwayat yang ada sampai hari ini — tanpa menyentuh apa yang
 * sudah tercatat. Dipakai saat boot agar demo tidak menua.
 */
export function lanjutkanDemo(persona, user, hariIni = tanggalWIB(), kunciSeed = persona.id) {
  const sudah = user.demoMeta?.generatedHingga
    ?? user.transactions?.at(-1)?.tanggal
    ?? tanggalMundur(hariIni, 1);
  if (sudah >= hariIni) return null;

  const rng = prngDari(`${kunciSeed}:${sudah}`);
  const transactions = [...(user.transactions ?? []), ...bangunRiwayat(persona, tanggalMundur(sudah, -1), hariIni, rng)];

  return {
    transactions,
    recommendations: susunRekomendasi(persona, transactions, hariIni),
    demoMeta: { ...(user.demoMeta ?? { versi: 1 }), generatedHingga: hariIni },
  };
}

/**
 * Persona untuk sebuah pengguna, atau null bila bukan akun demo.
 *
 * Kelima akun asli dikenali dari ID-nya. Akun tambahan (106–120) membawa
 * `demoPersona` — indeks yang dipasang saat akunnya dibuat — supaya
 * pembagiannya berputar dan tetap, bukan tergantung urutan pemeriksaan.
 */
export function personaDemo(user) {
  if (user?.batch !== 'DEMO') return null;
  if (Number.isInteger(user.demoPersona) && DAFTAR_PERSONA[user.demoPersona]) {
    return DAFTAR_PERSONA[user.demoPersona];
  }
  return DAFTAR_PERSONA.find((p) => p.id === user.id) ?? DAFTAR_PERSONA[0];
}

export const PERSONA_DEMO = DAFTAR_PERSONA;
