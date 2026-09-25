/**
 * Uji Today's Business Focus (lib/fokus-harian.js + rute /api/fokus).
 *
 * Yang paling dijaga:
 *   - FIRST-MATCH-WINS: urutan aturan menentukan hasil — diuji dengan
 *     fixture yang memenuhi BEBERAPA aturan sekaligus;
 *   - nol rumus baru: alasan menyebut angka dari metrik apa adanya;
 *   - ambang yang dipakai adalah ambang aplikasi (status cicilan dari
 *     simulasi-cicilan, margin 10% dari dasbor), bukan ambang baru;
 *   - fallback jujur: tanpa profil, tanpa data, dan pesan positif.
 *
 *   npm test
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'nova-uji-fokus-'));
process.env.NOVA_DATA_DIR = DATA_DIR;
process.env.PORT = '0';
process.env.NOVA_AI_BACKEND = 'anthropic';
process.env.ANTHROPIC_API_KEY = '';
delete process.env.GOOGLE_CLOUD_PROJECT;
process.on('exit', () => rmSync(DATA_DIR, { recursive: true, force: true }));

const { susunFokusHarian } = await import('../lib/fokus-harian.js');
const { store } = await import('../lib/store.js');
const app = (await import('../server.js')).default;

const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const BASE = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

/* --------------------------------------------------------- Peranti uji */

const METRIK_SEHAT = {
  sumber: 'catatan',
  omzet: 21_002_000, hpp: 11_000_000, biaya: 4_000_000,
  labaKotor: 10_002_000, labaBersih: 6_002_000, marginKotor: 47.6, marginBersih: 28.6,
  maxCicilanSehat: 1_800_600, cicilanSaatIni: 450_000, bebanCicilan: 7.5,
  statusCicilan: 'safe', cicilanBelumTercatat: false, cicilanDicatat: 450_000,
  skorKesehatan: 90, statusKesehatan: 'Very healthy',
  komponenSkor: [
    { aspek: 'Net profit margin', poin: 30, maks: 30, catatan: '28.6% of sales' },
    { aspek: 'Recording habit', poin: 20, maks: 20, catatan: 'Recorded 31 consecutive days since starting — keep it up!' },
    { aspek: 'Separate business account', poin: 20, maks: 20, catatan: 'Has a dedicated business account' },
    { aspek: 'Business registration (EIN)', poin: 15, maks: 15, catatan: 'Has an EIN' },
    { aspek: 'Years in business', poin: 15, maks: 15, catatan: '3 yr 0 mo' },
  ],
  rugi: false,
  prive: 1_200_000, saldoKas: 5_735_000,
  hariTercatat: 31, hariBerjalan: 31, hariBulan: 31, hariSejakMulai: 31,
  catatanBelumCukup: false, bulanLengkap: true, disetarakan: false,
  berjalan: { omzet: 21_002_000, labaBersih: 6_002_000, saldoKas: 5_735_000, prive: 1_200_000, cicilan: 450_000 },
};

const fokus = (sumber) => susunFokusHarian({ punyaProfil: true, metrics: METRIK_SEHAT, ...sumber });

/* ============================================== Aturan 0 — tanpa profil */

test('tanpa profil: pintu semua angka — menang atas segalanya', () => {
  const k = susunFokusHarian({
    punyaProfil: false,
    metrics: { ...METRIK_SEHAT, saldoKas: -1_000_000, rugi: true },
  });
  assert.equal(k.id, 'isi-profil');
  assert.equal(k.aksi.halaman, 'profil');
  assert.equal(k.modul, null);

  const tanpaMetrik = susunFokusHarian({ punyaProfil: true, metrics: null });
  assert.equal(tanpaMetrik.id, 'isi-profil');
});

/* ===================================== Aturan 1 — konsistensi mencatat */

test('bulan tipis: fokus kembali ke mencatat, bukan optimasi', () => {
  const k = fokus({ metrics: { ...METRIK_SEHAT, sumber: 'perkiraan', catatanBelumCukup: true, hariTercatat: 3, hariBerjalan: 5, prive: 0, saldoKas: null } });
  assert.equal(k.id, 'konsistensi');
  assert.match(k.alasan, /3 of 5 elapsed days/);
  assert.equal(k.aksi.halaman, 'kas');
  assert.equal(k.modul, 101);
});

test('bulan kosong sama sekali: pesan yang lebih ramah, fokus yang sama', () => {
  const k = fokus({ metrics: { ...METRIK_SEHAT, sumber: 'perkiraan', catatanBelumCukup: false, hariTercatat: 0, prive: 0, saldoKas: null } });
  assert.equal(k.id, 'konsistensi');
  assert.match(k.alasan, /Nothing recorded this month yet/);
});

/* =============================================== Aturan 2 — kas defisit */

test('kas minus: menang sebelum rugi dan prive (arus kas paling mendasar)', () => {
  const k = fokus({
    metrics: { ...METRIK_SEHAT, saldoKas: -750_000, rugi: true, labaBersih: -900_000, prive: 2_000_000 },
  });
  assert.equal(k.id, 'kas-defisit');
  assert.match(k.alasan, /-\$750,000/);
  assert.match(k.alasan, /-\$900,000/);
  assert.equal(k.modul, 111);
});

/* ===================================================== Aturan 3 — rugi */

test('rugi: fokus harga dan biaya, menang atas prive dan cicilan', () => {
  const k = fokus({
    metrics: {
      ...METRIK_SEHAT,
      rugi: true, labaBersih: -1_800_000, marginBersih: -8.6,
      prive: 2_000_000, statusCicilan: 'risky', bebanCicilan: 999,
    },
  });
  assert.equal(k.id, 'rugi');
  assert.match(k.alasan, /-\$1,800,000/);
  assert.match(k.alasan, /-8\.6%/);
  assert.equal(k.aksi.halaman, 'laporan');
  assert.equal(k.modul, 104);
});

/* ===================================================== Aturan 4 — prive */

test('prive lebih besar dari laba: bocor yang paling sering', () => {
  const k = fokus({
    metrics: { ...METRIK_SEHAT, prive: 7_000_000, labaBersih: 6_002_000 },
  });
  assert.equal(k.id, 'prive-lebih-besar-dari-laba');
  assert.match(k.alasan, /\$7,000,000/);
  assert.match(k.alasan, /\$6,002,000/);
  assert.equal(k.modul, 101);
});

test('prive di bawah laba BUKAN masalah — jatuh ke aturan berikutnya', () => {
  const k = fokus({
    metrics: {
      ...METRIK_SEHAT,
      prive: 1_000_000,
      komponenSkor: METRIK_SEHAT.komponenSkor.map((c) => ({ ...c })), // semua penuh
    },
  });
  assert.notEqual(k.id, 'prive-lebih-besar-dari-laba');
  assert.equal(k.id, 'pertahankan');
});

/* ================================================== Aturan 5 — cicilan */

test('cicilan berisiko: ambangnya milik simulasi cicilan, bukan baru', () => {
  const k = fokus({
    metrics: {
      ...METRIK_SEHAT,
      statusCicilan: 'risky', bebanCicilan: 45.2, cicilanSaatIni: 2_700_000,
      prive: 1_000_000,
    },
  });
  assert.equal(k.id, 'cicilan');
  assert.match(k.judul, /risky threshold/);
  assert.match(k.alasan, /45\.2%/);
  assert.match(k.alasan, /\$1,800,600/); // maxCicilanSehat dari rumus existing
  assert.equal(k.modul, 111);
});

test('cicilan hati-hati juga naik jadi fokus', () => {
  const k = fokus({
    metrics: {
      ...METRIK_SEHAT,
      statusCicilan: 'caution', bebanCicilan: 34, cicilanSaatIni: 2_040_000,
      prive: 1_000_000,
    },
  });
  assert.equal(k.id, 'cicilan');
  assert.match(k.judul, /nearing the safe limit/);
});

/* =============================================== Aturan 6 — margin tipis */

test('margin 0–10%: ambang yang sama dengan pewarnaan margin dasbor', () => {
  const k = fokus({
    metrics: {
      ...METRIK_SEHAT,
      marginBersih: 7.5, labaBersih: 1_575_000,
      prive: 1_000_000,
    },
  });
  assert.equal(k.id, 'margin-tipis');
  assert.match(k.alasan, /7\.5%/);
  assert.equal(k.modul, 104);
});

/* ================================= Aturan 7 — peringatan rekomendasi */

/* Sesi D: aturan 7 kini berjendela umur — uji lama tetap menguji bentuk &
 * keterhubungan, dengan `kini` terkunci dan rekomendasi yang jelas SEGAR. */
const KINI_UJI = new Date('2026-09-12T04:00:00.000Z');
const segar = (hariLalu) => new Date(KINI_UJI.getTime() - hariLalu * 86_400_000).toISOString();

test('peringatan tersimpan dari rekomendasi terakhir dibaca apa adanya', () => {
  const k = fokus({
    kini: KINI_UJI,
    metrics: { ...METRIK_SEHAT, prive: 1_000_000 },
    rekomendasi: {
      peringatan: ['Loan payment $450,000 absorbs 8% of profit — still within the safe limit.'],
      rekomendasi: [{ judul: 'Lock input costs', modulTerkait: 104 }],
      generatedAt: segar(0),
    },
  });
  assert.equal(k.id, 'peringatan-rekomendasi');
  assert.match(k.alasan, /Loan payment \$450,000/);
  assert.doesNotMatch(k.alasan, /Generated/, 'generated today — no age note needed');
  assert.equal(k.aksi.halaman, 'rekomendasi');
  assert.equal(k.modul, 104, 'modulTerkait dari rekomendasi yang sama ikut dihubungkan');
});

test('modulTerkait yang tidak sah tidak bocor menjadi tautan', () => {
  const k = fokus({
    kini: KINI_UJI,
    metrics: { ...METRIK_SEHAT, prive: 1_000_000 },
    rekomendasi: {
      peringatan: ['Check inventory.'],
      rekomendasi: [{ judul: 'X', modulTerkait: 99 }],
      generatedAt: segar(2),
    },
  });
  assert.equal(k.id, 'peringatan-rekomendasi');
  assert.equal(k.modul, null);
});

test('umur peringatan disebut jujur saat rekomendasinya sudah berhari-hari', () => {
  const k = fokus({
    kini: KINI_UJI,
    metrics: { ...METRIK_SEHAT, prive: 1_000_000 },
    rekomendasi: {
      peringatan: ['Check dry stock levels.'],
      rekomendasi: [{ judul: 'X' }],
      generatedAt: segar(9),
    },
  });
  assert.equal(k.id, 'peringatan-rekomendasi');
  assert.match(k.alasan, /^Generated 9 days ago\. /, 'pengguna menilai sendiri kebaruannya');
});

/* ======================================= Aturan 8 — komponen terlemah */

test('komponen skor terlemah: rasio terendah + catatan bawaan skor', () => {
  const komponen = [
    { aspek: 'Net profit margin', poin: 30, maks: 30, catatan: '28.6% of sales' },
    { aspek: 'Recording habit', poin: 20, maks: 20, catatan: 'Recorded 31 days' },
    { aspek: 'Separate business account', poin: 0, maks: 20, catatan: 'Business and personal money still mixed' },
    { aspek: 'Business registration (EIN)', poin: 15, maks: 15, catatan: 'Has an EIN' },
    { aspek: 'Years in business', poin: 7, maks: 15, catatan: '6 mo' },
  ];
  const k = fokus({
    metrics: { ...METRIK_SEHAT, komponenSkor: komponen, prive: 1_000_000 },
  });
  assert.equal(k.id, 'komponen-skor');
  assert.match(k.judul, /Separate business account/);
  assert.match(k.alasan, /0\/20/);
  assert.match(k.alasan, /Business and personal money still mixed/);
  assert.equal(k.modul, 101, 'aspek pemisahan uang diajarkan sesi 1 (modul 101)');
});

test('aspek EIN dan lama usaha: tidak ada modul yang mengajarkan keduanya — null yang jujur', () => {
  const legal = fokus({
    metrics: {
      ...METRIK_SEHAT,
      komponenSkor: [
        { aspek: 'Net profit margin', poin: 30, maks: 30, catatan: '' },
        { aspek: 'Recording habit', poin: 20, maks: 20, catatan: '' },
        { aspek: 'Separate business account', poin: 20, maks: 20, catatan: '' },
        { aspek: 'Business registration (EIN)', poin: 0, maks: 15, catatan: 'No EIN yet (free at irs.gov)' },
        { aspek: 'Years in business', poin: 15, maks: 15, catatan: '3 yr 0 mo' },
      ],
      prive: 1_000_000,
    },
  });
  assert.equal(legal.modul, null);

  const lama = fokus({
    metrics: {
      ...METRIK_SEHAT,
      komponenSkor: [
        { aspek: 'Net profit margin', poin: 30, maks: 30, catatan: '' },
        { aspek: 'Recording habit', poin: 20, maks: 20, catatan: '' },
        { aspek: 'Separate business account', poin: 20, maks: 20, catatan: '' },
        { aspek: 'Business registration (EIN)', poin: 15, maks: 15, catatan: '' },
        { aspek: 'Years in business', poin: 3, maks: 15, catatan: '1 mo' },
      ],
      prive: 1_000_000,
    },
  });
  assert.equal(lama.modul, null, 'tidak ada materi yang mempercepat waktu');
});

/* ============================================ Aturan 9 — pertahankan */

test('semua sehat: pesan positif yang tetap membawa langkah belajar', () => {
  const k = fokus({
    metrics: { ...METRIK_SEHAT, prive: 1_000_000 },
    sesiBerikut: { no: 104, judul: 'Read your P&L in five minutes' },
  });
  assert.equal(k.id, 'pertahankan');
  assert.match(k.alasan, /Read your P&L in five minutes/);
  assert.equal(k.aksi.halaman, 'modul');
  assert.equal(k.modul, 104);
});

test('semua selesai: tetap positif tanpa modul yang dikarang', () => {
  const k = fokus({
    metrics: { ...METRIK_SEHAT, prive: 1_000_000 },
    sesiBerikut: null,
  });
  assert.equal(k.id, 'pertahankan');
  assert.equal(k.modul, null);
});

/* ========================================= Fokus berubah saat data berubah */

test('fokus yang sama berubah ketika kondisi data berubah', () => {
  const sebelum = fokus({ metrics: METRIK_SEHAT });
  const sesudah = fokus({ metrics: { ...METRIK_SEHAT, saldoKas: -200_000 } });
  assert.notEqual(sebelum.id, sesudah.id);
  assert.equal(sesudah.id, 'kas-defisit');
});

test('bulan berjalan diberi tahu sebagai laju setara, bukan anjlok', () => {
  const k = fokus({
    metrics: {
      ...METRIK_SEHAT,
      rugi: true, labaBersih: -300_000, marginBersih: -1.4, disetarakan: true,
    },
  });
  assert.equal(k.id, 'rugi');
  assert.match(k.alasan, /full-month equivalent pace/);
});

/* =============================================================== Rutenya */

const PROFIL = {
  namaUsaha: 'Focus Test Shop', jenisUsaha: 'retail', lokasi: 'Austin',
  lamaUsahaBulan: 12, jumlahKaryawan: 0, produkUtama: 'Specialty coffee beans',
  omzetBulanan: 9_000, belanjaBulanan: 4_500, biayaOperasional: 1_000,
  cicilanBulanan: 0, pencatatan: 'aplikasi', rekeningTerpisah: true, punyaNib: true,
  tujuan: 'naikkan-laba', tantangan: '',
};

const ID_SAH = new Set([
  'isi-profil', 'konsistensi', 'kas-defisit', 'rugi', 'prive-lebih-besar-dari-laba',
  'cicilan', 'margin-tipis', 'peringatan-rekomendasi', 'komponen-skor', 'pertahankan',
]);
const HALAMAN_SAH = new Set(['profil', 'kas', 'laporan', 'dasbor', 'rekomendasi', 'modul']);

test('tanpa kode akses: 401', async () => {
  const res = await fetch(BASE + '/api/fokus');
  assert.equal(res.status, 401);
});

test('rute: bentuk fokus utuh dan hanya memuat nilai yang sah', async () => {
  const { user, accessCode } = await store.createUser({ name: 'Focus Owner', business: 'Focus Test Shop', batch: '' });
  await store.saveProfile(user.id, PROFIL);
  await store.addTransaction(user.id, {
    tanggal: new Date().toISOString().slice(0, 10),
    jenis: 'masuk', kategori: 'penjualan', keterangan: 'Today sales', jumlah: 450,
  }, { aktor: 'manusia' });

  const res = await fetch(BASE + '/api/fokus', { headers: { Authorization: `Bearer ${accessCode}` } });
  assert.equal(res.status, 200);
  const { fokus: k } = await res.json();

  assert.ok(ID_SAH.has(k.id), `id aturan harus dikenal: ${k.id}`);
  assert.ok(HALAMAN_SAH.has(k.aksi.halaman));
  assert.ok(k.judul.length > 0 && k.alasan.length > 0);
  assert.ok(k.modul === null || (Number.isInteger(k.modul) && k.modul >= 101 && k.modul <= 113));
});
