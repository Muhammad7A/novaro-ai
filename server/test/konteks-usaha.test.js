/**
 * Uji konteks usaha personal (lib/konteks-usaha.js + rute /api/konteks).
 *
 * Paket ini dipakai TIGA tempat (pembaca modul, hasil check-up, dasbor),
 * jadi yang paling dijaga:
 *   - passthrough murni — tidak ada rumus kedua di dalamnya;
 *   - aturan "data cukup" ikut metrics.sumber (isMonthReliable), bukan
 *     aturan baru;
 *   - penyebut konsistensi bulan berjalan = hari yang sudah lewat;
 *   - dan pengguna tanpa profil mendapat null, bukan angka kosong yang
 *     terlihat seperti data.
 *
 *   npm test
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'nova-uji-konteks-'));
process.env.NOVA_DATA_DIR = DATA_DIR;
process.env.PORT = '0';
process.env.NOVA_AI_BACKEND = 'anthropic';
process.env.ANTHROPIC_API_KEY = '';
delete process.env.GOOGLE_CLOUD_PROJECT;
process.on('exit', () => rmSync(DATA_DIR, { recursive: true, force: true }));

const { susunKonteksUsaha } = await import('../lib/konteks-usaha.js');
const { store } = await import('../lib/store.js');
const app = (await import('../server.js')).default;

const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const BASE = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

/* ------------------------------------------------- Peranti metrik uji */

const METRIK_CATATAN = {
  sumber: 'catatan',
  omzet: 21_002_000, hpp: 11_000_000, biaya: 4_000_000,
  labaBersih: 6_002_000, marginBersih: 28.6,
  saldoKas: 5_735_000, prive: 1_200_000,
  cicilanSaatIni: 450_000, bebanCicilan: 7.5, statusCicilan: 'aman',
  skorKesehatan: 78, statusKesehatan: 'Sehat',
  hariTercatat: 31, hariBulan: 31, hariBerjalan: 31, bulanLengkap: true,
  cicilanBelumTercatat: false, cicilanDicatat: 450_000,
};

const METRIK_PERKIRAAN = {
  ...METRIK_CATATAN,
  sumber: 'perkiraan',
  hariTercatat: 3, hariBulan: 31, hariBerjalan: 5, bulanLengkap: false,
};

const PERUBAHAN = {
  lalu: { omzet: 18_000_000 }, kini: { omzet: 21_002_000 },
  ubah: { omzet: 16.7 },
  kalimat: ['Omzet naik 16,7% dibanding bulan sebelumnya.', 'Ritme mencatat konsisten: 31 catatan.'],
};

/* ================================================ Data tersedia (catatan) */

test('bulan yang tercatat rapat: passthrough murni dan cukupData', () => {
  const k = susunKonteksUsaha({ metrics: METRIK_CATATAN, perubahan: PERUBAHAN });

  assert.equal(k.sumber, 'catatan');
  assert.equal(k.cukupData, true, 'sumber catatan berarti lulus isMonthReliable — satu-satunya aturan');

  // Passthrough: angka yang sama persis dengan computeMetrics, bukan hitungan kedua.
  assert.equal(k.angka.omzet, 21_002_000);
  assert.equal(k.angka.labaBersih, 6_002_000);
  assert.equal(k.angka.hpp, 11_000_000);
  assert.equal(k.angka.saldoKas, 5_735_000);
  assert.equal(k.angka.statusCicilan, 'aman');

  // Bulan lengkap → penyebut konsistensi = hariBulan.
  assert.deepEqual(k.konsistensi, { tercatat: 31, dari: 31, lengkap: true });

  // Interpretasi arah = kalimat bandingkanBulan, urut, tanpa diganti.
  assert.deepEqual(k.kalimat, PERUBAHAN.kalimat);

  assert.equal(k.cicilanBelumTercatat, false);
});

test('kalimat dibatasi tiga supaya kartunya tetap ringkas', () => {
  const banyak = {
    ...PERUBAHAN,
    kalimat: ['satu', 'dua', 'tiga', 'empat'],
  };
  const k = susunKonteksUsaha({ metrics: METRIK_CATATAN, perubahan: banyak });
  assert.deepEqual(k.kalimat, ['satu', 'dua', 'tiga']);
});

/* ==================================================== Data kosong / tipis */

test('bulan berjalan yang tipis: berlabel perkiraan, bukan angka palsu', () => {
  const k = susunKonteksUsaha({ metrics: METRIK_PERKIRAAN, perubahan: PERUBAHAN });

  assert.equal(k.cukupData, false);
  assert.equal(k.sumber, 'perkiraan');

  // BATAS: penyebut konsistensi bulan berjalan = hari yang sudah lewat (5),
  // bukan hariBulan (31) — membandingkan 3 dengan 31 selalu terlihat gagal.
  assert.deepEqual(k.konsistensi, { tercatat: 3, dari: 5, lengkap: false });

  // Angka perkiraan profil tetap disertakan — pemanggil yang berlabel.
  assert.equal(k.angka.omzet, 21_002_000);
});

test('kalimat kosong bila tidak ada yang bisa dibandingkan', () => {
  const kosong = susunKonteksUsaha({ metrics: METRIK_PERKIRAAN, perubahan: { kalimat: [] } });
  assert.deepEqual(kosong.kalimat, []);

  const tanpa = susunKonteksUsaha({ metrics: METRIK_CATATAN, perubahan: undefined });
  assert.deepEqual(tanpa.kalimat, []);
});

test('penyebut konsistensi mundur ke hariBulan bila hariBerjalan tidak ada', () => {
  const k = susunKonteksUsaha({
    metrics: { ...METRIK_PERKIRAAN, hariBerjalan: undefined, bulanLengkap: false },
    perubahan: PERUBAHAN,
  });
  assert.equal(k.konsistensi.dari, 31);
});

test('tanpa metrik sama sekali: null, bukan objek kosong yang terlihat seperti data', () => {
  assert.equal(susunKonteksUsaha({ metrics: null, perubahan: PERUBAHAN }), null);
  assert.equal(susunKonteksUsaha({}), null);
  assert.equal(susunKonteksUsaha(), null);
});

test('cicilan dari profil yang belum tampak di buku kas ikut diberi tahu', () => {
  const k = susunKonteksUsaha({
    metrics: { ...METRIK_CATATAN, cicilanBelumTercatat: true, cicilanDicatat: 0 },
    perubahan: PERUBAHAN,
  });
  assert.equal(k.cicilanBelumTercatat, true);
  assert.equal(k.cicilanDicatat, 0);
});

/* =============================================================== Rutenya */

const PROFIL = {
  namaUsaha: 'Warung Konteks', jenisUsaha: 'kuliner', lokasi: 'Semarang',
  lamaUsahaBulan: 12, jumlahKaryawan: 0, produkUtama: 'Nasi rames',
  omzetBulanan: 9_000_000, belanjaBulanan: 4_500_000, biayaOperasional: 1_000_000,
  cicilanBulanan: 0, pencatatan: 'aplikasi', rekeningTerpisah: true, punyaNib: true,
  tujuan: 'naikkan-laba', tantangan: '',
};

test('tanpa kode akses: 401', async () => {
  const res = await fetch(BASE + '/api/konteks');
  assert.equal(res.status, 401);
});

test('pengguna tanpa profil: konteks null — disembunyikan, bukan dikarang', async () => {
  const { accessCode } = await store.createUser({ name: 'Tanpa Profil', business: '', batch: 'B1' });
  const res = await fetch(BASE + '/api/konteks', { headers: { Authorization: `Bearer ${accessCode}` } });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.konteks, null);
});

test('pengguna dengan profil: bentuk utuh, angka dari metrik yang sama dengan dasbor', async () => {
  const { user, accessCode } = await store.createUser({ name: 'Bu Konteks', business: 'Warung Konteks', batch: 'B1' });
  await store.saveProfile(user.id, PROFIL);
  await store.addTransaction(user.id, {
    tanggal: new Date().toISOString().slice(0, 10),
    jenis: 'masuk', kategori: 'penjualan', keterangan: 'Penjualan hari ini', jumlah: 450_000,
  }, { aktor: 'manusia' });

  const res = await fetch(BASE + '/api/konteks', { headers: { Authorization: `Bearer ${accessCode}` } });
  assert.equal(res.status, 200);
  const { konteks } = await res.json();

  assert.ok(konteks, 'punya profil → konteks ada');
  assert.ok(['catatan', 'perkiraan'].includes(konteks.sumber));
  assert.equal(konteks.cukupData, konteks.sumber === 'catatan');
  assert.equal(typeof konteks.angka.omzet, 'number');
  assert.equal(typeof konteks.angka.labaBersih, 'number');
  assert.ok(konteks.konsistensi.tercatat >= 1, 'transaksi tadi ikut terhitung');
  assert.ok(Array.isArray(konteks.kalimat));
});
