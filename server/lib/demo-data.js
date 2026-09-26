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
 * tangan hanyalah POLAnya (berapa kali belanja bahan seminggu, berapa
 * persen omzetnya, kapan cicilan jatuh). Angka hariannya dibangkitkan
 * dari PRNG berbenih tetap — sehingga:
 *
 *   - tiap akun selalu mendapat angka yang SAMA pada tanggal yang sama,
 *     jadi tangkapan layar dan papan cerita demo tidak pernah berubah;
 *   - angka di rekomendasi dan riwayat chat DIHITUNG dari transaksi yang
 *     sama, bukan dikarang terpisah — AI demo tidak pernah terlihat
 *     "halusinasi" karena menjumlah angka yang tidak saling cocok.
 *
 * Sejak edisi enterprise US (2026-09-25) seluruh isi berbahasa Inggris
 * dan bersatuan dolar AS. Persona sengaja DIBEDAKAN derajat
 * kesehatannya: taco truck yang sehat, roastery bermargin tipis,
 * jasa kebersihan yang stres arus kas, toko lilin yang tumbuh cepat,
 * dan studio desain yang merugi — supaya rekomendasi AI punya pekerjaan
 * nyata yang berbeda di tiap akun. Demo yang serba sempurna membuat
 * fitur rekomendasi tidak punya pekerjaan.
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
import { formatDolar } from './metrics.js';

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
 * Pemetaannya tetap: 101–105 adalah kelima usaha contoh asli (taco truck,
 * roastery kopi, jasa kebersihan, toko lilin, studio desain) — nomor yang
 * sama dengan nomor peserta lama mereka. 106–120 diikat ke akun yang
 * dibuat otomatis saat server menyala (lihat pastikanDemoSiap di
 * server.js) dengan persona berputar.
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
const bulat = (n) => Math.round(n); // dibulatkan ke dolar penuh — seperti uang tunai sungguhan

/* --------------------------------------------------------------- Persona */

/**
 * Tiap persona mendefinisikan POLA usaha, bukan transaksinya.
 *
 *   penjualanHarian(hariKe, rng)  → omzet hari itu ($), 0 = tutup
 *   belanjaBahan(omzet, rng)     → biaya bahan hari itu
 *   tetap()                      → transaksi rutin: [jenis, kategori, jumlah, hari-ofset, keterangan]
 *   prive(rng)                   → pengambilan pribadi hari itu (atau null)
 *   ekonomi                      → rentang margin bulan-penuh yang dijanjikan
 *                                  persona ini (dipatroli test/demo.test.js;
 *                                  `rugi: true` = persona memang dirancang merugi)
 */
const DAFTAR_PERSONA = [
  {
    id: 'usr_f37a37b403ed',
    nama: 'Verde Road Tacos',
    bisnis: 'Food truck — street tacos & catering',
    hariMulaiLalu: 24,
    sesiSelesai: 7,
    modulPustaka: 2,
    ekonomi: { marginMin: 24, marginMax: 44, rugi: false },
    profil: {
      namaUsaha: 'Verde Road Tacos',
      jenisUsaha: 'kuliner',
      lokasi: 'Austin, TX',
      lamaUsahaBulan: 36,
      jumlahKaryawan: 1,
      produkUtama: 'Street tacos, burrito bowls, aguas frescas',
      omzetBulanan: 26500,
      belanjaBulanan: 11300,
      biayaOperasional: 5600,
      cicilanBulanan: 950,
      pencatatan: 'aplikasi',
      rekeningTerpisah: true,
      punyaNib: true,
      tujuan: 'kembangkan-usaha',
      tantangan: 'Weekend catering deposits still land in the personal account, so real profit stays fuzzy.',
    },
    penjualanHarian(hariKe, rng) {
      // Truck buka tiap hari; akhir pekan lebih ramai (festival & larut malam).
      const dasar = antar(rng, 700, 950);
      const faktor = hariKe % 7 >= 5 ? 1.22 : 1;
      return bulat(dasar * faktor);
    },
    belanjaBahan(omzet, rng) {
      return bulat(omzet * antar(rng, 0.42, 0.48));
    },
    tetap: [
      { kategori: 'operasional', jumlah: 90, tiapHari: 3, keterangan: 'Propane tank swap' },
      { kategori: 'operasional', jumlah: 210, tiapHari: 7, keterangan: 'Commissary kitchen & truck parking' },
      { kategori: 'operasional', jumlah: 620, tiapHari: 7, keterangan: 'Weekend helper wages' },
      { kategori: 'operasional', jumlah: 165, tiapHari: 7, keterangan: 'Square processing fees' },
      { kategori: 'operasional', jumlah: 385, tiapHari: 30, keterangan: 'Truck insurance & health permit' },
    ],
    cicilan: { jumlah: 950, tgl: 5, keterangan: 'SBA microloan payment' },
    prive(rng) {
      // Sabtu & Minggu ambil uang jajan keluarga — kebiasaan yang nanti
      // diangkat rekomendasi AI sebagai "owner draw belum dipisah".
      return rng() < 0.3 ? bulat(antar(rng, 90, 160)) : null;
    },
    keteranganJual: ['Downtown lunch service', 'Late-night weekend sales', 'Private catering event'],
  },
  {
    id: 'usr_3683b1949f69',
    nama: 'Lark & Ember Coffee Roasters',
    bisnis: 'Boutique coffee roastery & café',
    hariMulaiLalu: 22,
    sesiSelesai: 7,
    modulPustaka: 1,
    ekonomi: { marginMin: 5, marginMax: 24, rugi: false },
    profil: {
      namaUsaha: 'Lark & Ember Coffee Roasters',
      jenisUsaha: 'produksi',
      lokasi: 'Portland, OR',
      lamaUsahaBulan: 42,
      jumlahKaryawan: 2,
      produkUtama: 'Small-batch roasted beans, espresso drinks, wholesale accounts',
      omzetBulanan: 21000,
      belanjaBulanan: 12000,
      biayaOperasional: 5900,
      cicilanBulanan: 420,
      pencatatan: 'buku',
      rekeningTerpisah: true,
      punyaNib: true,
      tujuan: 'naikkan-laba',
      tantangan: 'Green bean prices keep climbing, but wholesale customers push back on every price increase.',
    },
    penjualanHarian(hariKe, rng) {
      const dasar = antar(rng, 600, 760);
      const faktor = hariKe % 7 >= 5 ? 1.12 : 1;
      return bulat(dasar * faktor);
    },
    /*
     * Belanja HARIAN proporsional, bukan borongan dua-mingguan: kulakan
     * besar membuat bulan kalender bergantian memuat satu vs dua pembelian
     * dan margin bergelombang di setiap benih tanggal. Porsi harian
     * 55–60% omzet menempel pada profil persona (bahan $12 rb dari omzet
     * $21 rb) dan menghasilkan margin tipis yang stabil di setiap bulan
     * dan setiap benih tanggal. Kisah "borongan membuat laporan
     * bergelombang" tetap diajarkan lewat materi Modul 110 — bukan lewat
     * akun contoh.
     */
    belanjaBahan(omzet, rng) {
      return bulat(omzet * antar(rng, 0.55, 0.6));
    },
    tetap: [
      { kategori: 'operasional', jumlah: 720, tiapHari: 7, keterangan: 'Part-time barista wages' },
      { kategori: 'operasional', jumlah: 150, tiapHari: 7, keterangan: 'Farmers market booth fee' },
      { kategori: 'operasional', jumlah: 95, tiapHari: 7, keterangan: 'Bags, labels & milk' },
      { kategori: 'operasional', jumlah: 1400, tiapHari: 30, keterangan: 'Roastery & café rent' },
      { kategori: 'operasional', jumlah: 310, tiapHari: 30, keterangan: 'Utilities (roaster power)' },
    ],
    cicilan: { jumlah: 420, tgl: 12, keterangan: 'Roaster equipment loan payment' },
    prive(rng) {
      return rng() < 0.35 ? bulat(antar(rng, 70, 120)) : null;
    },
    keteranganJual: ['Wholesale roast delivery', 'Café counter sales', 'Farmers market brew stand'],
  },
  {
    id: 'usr_a5354dec9411',
    nama: 'Sunrise Pro Cleaning',
    bisnis: 'One-person cleaning services',
    hariMulaiLalu: 6,
    sesiSelesai: 6,
    modulPustaka: 0,
    ekonomi: { marginMin: 20, marginMax: 48, rugi: false },
    profil: {
      namaUsaha: 'Sunrise Pro Cleaning',
      jenisUsaha: 'jasa',
      lokasi: 'Columbus, OH',
      lamaUsahaBulan: 20,
      jumlahKaryawan: 0,
      produkUtama: 'Residential cleaning, move-out cleans, small offices',
      omzetBulanan: 9700,
      belanjaBulanan: 2400,
      biayaOperasional: 3900,
      cicilanBulanan: 1450,
      pencatatan: 'kadang',
      rekeningTerpisah: false,
      punyaNib: false,
      tujuan: 'rapikan-keuangan',
      tantangan: 'Clients pay weeks late, so cash runs dry even when the calendar is full.',
    },
    penjualanHarian(hariKe, rng) {
      // Minggu sepi (pelanggan rumah merapikan sendiri), Senin–Jumat penuh.
      const dasar = antar(rng, 300, 420);
      const faktor = hariKe % 7 === 6 ? 0.3 : 1;
      return bulat(dasar * faktor);
    },
    belanjaBahan(omzet, rng) {
      return bulat(omzet * antar(rng, 0.22, 0.28));
    },
    tetap: [
      { kategori: 'operasional', jumlah: 95, tiapHari: 3, keterangan: 'Gas & van upkeep' },
      { kategori: 'operasional', jumlah: 420, tiapHari: 7, keterangan: 'Google ads & lead fees' },
      { kategori: 'operasional', jumlah: 180, tiapHari: 7, keterangan: 'Linen & laundry service' },
      { kategori: 'operasional', jumlah: 290, tiapHari: 30, keterangan: 'Insurance, bond & license' },
      { kategori: 'operasional', jumlah: 65, tiapHari: 30, keterangan: 'Phone & scheduling apps' },
    ],
    cicilan: { jumlah: 1450, tgl: 10, keterangan: 'Van & equipment loan payment' },
    prive(rng) {
      // Ambil hampir tiap dua hari — pengambilan pribadi MELAMPAUI laba:
      // cicilan van $1.450 + prive ~$3.5 rb dari laba ~$3.4 rb = stres kas.
      return rng() < 0.6 ? bulat(antar(rng, 170, 230)) : null;
    },
    keteranganJual: ['Weekly house cleaning route', 'Move-out clean — apartment', 'Small office cleaning contract'],
  },
  {
    id: 'usr_e6d4a8e4f5cd',
    nama: 'Ember & Oak Candle Co.',
    bisnis: 'E-commerce candle shop (online + wholesale)',
    hariMulaiLalu: 2,
    sesiSelesai: 2,
    modulPustaka: 0,
    ekonomi: { marginMin: 20, marginMax: 44, rugi: false },
    profil: {
      namaUsaha: 'Ember & Oak Candle Co.',
      jenisUsaha: 'online',
      lokasi: 'Asheville, NC',
      lamaUsahaBulan: 11,
      jumlahKaryawan: 1,
      produkUtama: 'Soy candles, wax melts, gift sets (online + wholesale)',
      omzetBulanan: 13200,
      belanjaBulanan: 5100,
      biayaOperasional: 3800,
      cicilanBulanan: 0,
      pencatatan: 'excel',
      rekeningTerpisah: false,
      punyaNib: true,
      tujuan: 'kelola-stok',
      tantangan: 'Wholesale orders are outpacing the cash available for wax and jars.',
    },
    penjualanHarian(hariKe, rng) {
      // Order online tiap hari; pesanan grosir datang bergelombang tiap 3 hari.
      const dasar = antar(rng, 200, 280);
      const grosir = hariKe % 3 === 0 ? antar(rng, 480, 720) : 0;
      return bulat(dasar + grosir);
    },
    belanjaBahan(omzet, rng) {
      return bulat(omzet * antar(rng, 0.36, 0.42));
    },
    tetap: [
      { kategori: 'operasional', jumlah: 390, tiapHari: 7, keterangan: 'Facebook & Instagram ads' },
      { kategori: 'operasional', jumlah: 255, tiapHari: 7, keterangan: 'Shipping & labels' },
      { kategori: 'operasional', jumlah: 120, tiapHari: 7, keterangan: 'Boxes & packaging' },
      { kategori: 'operasional', jumlah: 175, tiapHari: 14, keterangan: 'Craft fair booth fees' },
      { kategori: 'operasional', jumlah: 115, tiapHari: 30, keterangan: 'Shopify & apps' },
    ],
    prive(rng) {
      return rng() < 0.2 ? bulat(antar(rng, 80, 130)) : null;
    },
    keteranganJual: ['Shopify daily orders', 'Etsy weekend orders', 'Wholesale order — gift shop'],
  },
  {
    id: 'usr_6d2ff8796a9f',
    nama: 'Northline Design Studio',
    bisnis: 'Freelance design studio (solo + subcontractors)',
    hariMulaiLalu: 20,
    sesiSelesai: 5,
    modulPustaka: 1,
    ekonomi: { marginMin: -65, marginMax: -12, rugi: true },
    profil: {
      namaUsaha: 'Northline Design Studio',
      jenisUsaha: 'jasa',
      lokasi: 'Denver, CO',
      lamaUsahaBulan: 8,
      jumlahKaryawan: 0,
      produkUtama: 'Brand identity, web design, monthly design retainers',
      omzetBulanan: 8400,
      belanjaBulanan: 0,
      biayaOperasional: 11300,
      cicilanBulanan: 0,
      pencatatan: 'belum',
      rekeningTerpisah: false,
      punyaNib: false,
      tujuan: 'ajukan-kur',
      tantangan: 'Project income is lumpy and the subcontractor retainer eats most of it.',
    },
    penjualanHarian(hariKe, rng) {
      // Retainer kecil tiap hari; invoice proyek besar tiap 3 hari —
      // pendapatan lebih kecil dari biaya tetap: persona ini DIRANCANG merugi.
      const dasar = antar(rng, 90, 130);
      const proyek = hariKe % 3 === 0 ? antar(rng, 390, 620) : 0;
      return bulat(dasar + proyek);
    },
    belanjaBahan() {
      return null;
    },
    tetap: [
      { kategori: 'operasional', jumlah: 2050, tiapHari: 7, keterangan: 'Subcontract illustrator retainer' },
      { kategori: 'operasional', jumlah: 420, tiapHari: 7, keterangan: 'Co-working studio membership' },
      { kategori: 'operasional', jumlah: 95, tiapHari: 7, keterangan: 'Adobe CC, fonts & portfolio site' },
      { kategori: 'operasional', jumlah: 300, tiapHari: 30, keterangan: 'Accountant & legal' },
    ],
    prive(rng) {
      return rng() < 0.35 ? bulat(antar(rng, 90, 150)) : null;
    },
    keteranganJual: ['Logo design milestone invoice', 'Monthly retainer — web design', 'Brand refresh deposit'],
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
  if (bahan) dorong('keluar', 'belanja-bahan', bahan, 'Materials & supplies restock');

  for (const t of persona.tetap ?? []) {
    if (hariKe % t.tiapHari !== 0) continue;
    dorong('keluar', 'operasional', t.jumlah, t.keterangan);
  }

  if (persona.belanjaBesar && hariKe % persona.belanjaBesar.tiapHari === 0 && hariKe > 0) {
    /*
     * Belanja borongan stok untuk periode berikut. Faktor penyetel per
     * persona (bawaan 0.9) menjaga porsi bahan tetap di kisaran yang
     * dijanjikan profil persona pada benih tanggal mana pun — borongan
     * yang terlalu besar bisa membuat akun contoh tampak rugi.
     */
    const acuan = omzet * persona.belanjaBesar.tiapHari * (persona.belanjaBesar.faktor ?? 0.9); // stok untuk periode berikut
    dorong('keluar', 'belanja-bahan', bulat(acuan * antar(rng, persona.belanjaBesar.porsi[0], persona.belanjaBesar.porsi[1])), persona.belanjaBesar.keterangan);
  }

  if (persona.cicilan) {
    const tgl = Number(tanggal.slice(8, 10));
    if (tgl === persona.cicilan.tgl) dorong('keluar', 'cicilan', persona.cicilan.jumlah, persona.cicilan.keterangan);
  }

  const prive = persona.prive(rng);
  if (prive) dorong('keluar', 'prive', prive, dow % 7 >= 5 ? 'Weekend owner draw' : 'Owner draw (personal)');

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

const usd = formatDolar; // satu sumber format dolar — sama dengan yang dipakai metrik & AI

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
  const namaBulan = new Date(`${bulan}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const labaCicilan = s.cicilan > 0 ? (s.cicilan / Math.max(s.laba, 1)) * 100 : 0;
  const porsiBahan = Math.round((s.bahan / Math.max(s.penjualan, 1)) * 100);
  const porsiOperasional = Math.round((s.operasional / Math.max(s.penjualan, 1)) * 100);

  const rekomendasi = [
    // Persona jasa (tanpa bahan) mendapat versi biaya operasional — judul
    // "kunci porsi bahan di 0% omzet" akan jadi kebohongan untuk mereka.
    s.bahan > 0
      ? {
        judul: `Keep materials at or below ${Math.max(porsiBahan - 2, 1)}% of sales`,
        prioritas: s.margin < 15 ? 'high' : 'medium',
        alasan: `In ${namaBulan}, materials took ${usd(s.bahan)} out of ${usd(s.penjualan)} in sales. Every 2-point drop in that share adds about ${usd(s.penjualan * 0.02)} of profit a month.`,
        langkah: [
          'Log every materials purchase the moment it happens — this app files it under the right category automatically.',
          `Set a weekly purchasing cap from last month's pace (roughly ${usd(s.bahan / 4.3)}) and keep it visible.`,
          'Compare once a week: materials this week vs sales this week.',
        ],
        dampak: `About ${usd(s.penjualan * 0.02)} of extra monthly profit if the share drops 2 points.`,
        modulTerkait: nomorSesi(4) ?? nomorSesi(6), // 104 — membaca laporan laba rugi
      }
      : {
        judul: `Hold operating costs near ${porsiOperasional}% of sales`,
        prioritas: s.margin < 15 ? 'high' : 'medium',
        alasan: `These books carry no material costs, so operating costs are the whole cost story: ${usd(s.operasional)} in ${namaBulan} against ${usd(s.penjualan)} in sales.`,
        langkah: [
          'Tag the two largest operating lines (here: subcontractors and rent) and track them weekly, not monthly.',
          'Before adding any new recurring cost, check it against this month\'s sales first.',
          'Review the Cash Book by category once a week to catch creep early.',
        ],
        dampak: `Every 5% trimmed from operating costs is about ${usd(s.operasional * 0.05)} back in profit each month.`,
        modulTerkait: nomorSesi(6) ?? nomorSesi(4), // 106 — disiplin biaya
      },
    {
      judul: 'Separate business money from personal money',
      prioritas: s.prive > s.laba * 0.6 ? 'high' : 'medium',
      alasan: s.laba > 0
        ? `Owner draws in ${namaBulan} came to ${usd(s.prive)} against ${usd(s.laba)} of profit — ${Math.round((s.prive / s.laba) * 100)}% of the profit left the business before it could be reinvested.`
        : `Owner draws in ${namaBulan} came to ${usd(s.prive)} while the books show a loss of ${usd(Math.abs(s.laba))} — every draw widens the gap.`,
      langkah: [
        'Pay yourself a fixed "owner salary" once a week for the same amount, recorded as an owner draw.',
        'Leave everything else in the business account until the month closes.',
        'Check the Cash Book page: draws are already listed separately from business expenses.',
      ],
      dampak: "Business cash stays steadier for next month's inventory and bills.",
      modulTerkait: nomorSesi(1) ?? nomorSesi(2), // 101 — pisahkan uang usaha & pribadi
    },
    {
      judul: 'Make recording a 5-minute daily close',
      prioritas: 'medium',
      alasan: 'Tidy books are exactly what a lender asks for — most want 3–6 months of continuous records, not scattered weeks.',
      langkah: [
        "At close: record one line with the day's total sales before you pack up.",
        'Snap photos of receipts and enter them the next morning when the day ran too long.',
        'Glance at the "cash left per day" chart once a week.',
      ],
      dampak: 'Three months of clean records you can hand to a lender without patching holes.',
      modulTerkait: nomorSesi(7) ?? nomorSesi(1), // 107 — tutup bulan
    },
  ];

  if (s.cicilan > 0) {
    rekomendasi.push({
      judul: 'Keep loan payments under 30% of profit',
      prioritas: labaCicilan > 30 ? 'high' : 'low',
      alasan: `Loan payments of ${usd(s.cicilan)} a month equal ${Math.round(labaCicilan)}% of ${namaBulan} profit. ${labaCicilan > 30 ? 'That is above the safe line — profit has to grow before any new borrowing.' : 'That is still within a safe range.'}`,
      langkah: [
        'Set the loan payment aside at the start of the month, not from whatever is left.',
        'Run the loan simulation on the Reports page: shift the term to see the monthly payment move.',
      ],
      dampak: 'A healthy payment-to-profit ratio keeps future borrowing options open.',
      modulTerkait: nomorPustaka()[3] ?? nomorSesi(7), // 111 — arus kas & runway
    });
  }

  return {
    ringkasan: `In ${namaBulan}, ${persona.nama} recorded ${usd(s.penjualan)} in sales and ${s.laba >= 0
      ? `a net profit of ${usd(s.laba)} (${s.margin.toFixed(1)}% margin)`
      : `a net loss of ${usd(s.laba)} (${s.margin.toFixed(1)}% margin) — spending is outrunning sales`}. ${s.prive > 0 ? `The owner drew ${usd(s.prive)} for personal use — business and personal money still share one pocket.` : 'Owner draws are already recorded cleanly.'}`,
    rekomendasi,
    peringatan: labaCicilan > 30
      ? [`Loan payments of ${usd(s.cicilan)} absorb ${Math.round(labaCicilan)}% of profit — above the 30% safe line.`]
      : (s.margin < 0
        ? [`The books show a loss of ${usd(Math.abs(s.laba))} for ${namaBulan} — costs must come down or sales rise before any new spending.`]
        : (s.margin < 10 ? [`A ${s.margin.toFixed(1)}% margin is very thin — review pricing and your biggest cost line.`] : [])),
    targetBulanIni: [
      s.bahan > 0
        ? `Keep materials under ${Math.max(porsiBahan - 2, 1)}% of sales`
        : `Hold operating costs under ${porsiOperasional}% of sales`,
      `One fixed owner draw per week, totaling under ${usd(Math.max(s.prive * 0.7, 300))}`,
      'Zero unrecorded days — even the slow ones',
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
  const namaBulan = new Date(`${bulan}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
  const tanya = (iso, h, m) => `${iso}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;

  return [
    {
      role: 'user',
      content: 'What was my actual profit last month? I have only been going by whatever cash is left over.',
      ts: tanya(tanggalMundur(hariIni, 6), 20, 15),
    },
    {
      role: 'assistant',
      content: `From ${persona.nama}'s cash book for ${namaBulan}: sales ${usd(s.penjualan)}, materials ${usd(s.bahan)}, operating costs ${usd(s.operasional)}. Net profit: **${usd(s.laba)}** (${s.margin.toFixed(1)}% margin).${s.prive > 0 ? ` What usually makes the leftover cash feel smaller is owner draws — you took ${usd(s.prive)} for personal use that month. Draws do not change profit, but they do take cash out of the register.` : ''} The math comes from the "Read your P&L in five minutes" lesson: profit and cash are two different numbers.`,
      ts: tanya(tanggalMundur(hariIni, 6), 20, 16),
    },
    {
      role: 'user',
      content: persona.profil.cicilanBulanan > 0
        ? 'If I apply for another small-business loan, can my profit carry the extra payment?'
        : 'How do I get my records ready for a small-business loan application?',
      ts: tanya(tanggalMundur(hariIni, 4), 9, 40),
    },
    {
      role: 'assistant',
      content: persona.profil.cicilanBulanan > 0
        ? `A common rule of thumb: keep total loan payments under 30% of net profit. Your ${namaBulan} profit was ${usd(s.laba)}${s.cicilan > 0 ? `, and current payments are ${usd(s.cicilan)} (${Math.round((s.cicilan / Math.max(s.laba, 1)) * 100)}% of profit)` : ''}. That leaves roughly **${usd(Math.max(s.laba * 0.3 - s.cicilan, 0))} per month** of safe room for an extra payment. Lenders also look for 3–6 months of steady records — the Reports page assembles those straight from your cash book. Module 111 (cash flow and runway) walks through this.`
        : `Most lenders want 3–6 months of continuous sales and expense records. Your cash book here is already in that shape — open the **Reports** page, pick 6 months, and export the PDF. The one thing to protect: no gaps. A long silent stretch makes a lender question whether the records are complete. The routine lives in the month-end close lesson (Module 107).`,
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
 *
 * `kunciSeed` menentukan benih angka. Bawaannya ID persona — begitulah
 * kelima akun asli selalu mendapat angka yang sama pada tanggal yang sama.
 * Akun tambahan yang berbagi persona (106–120) WAJIB mengirim kunci
 * berbeda (ID penggunanya), kalau tidak lima belas usaha contoh akan punya
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
