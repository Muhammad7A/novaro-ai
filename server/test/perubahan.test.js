/**
 * Uji "Apa yang Berubah?" — perbandingan bulan ini vs bulan lalu.
 *
 * Semua persentase lahir dari perubahanPersen (murni) dan rute /api/perubahan.
 * Yang dijaga paling ketat: tidak ada Infinity, tidak ada NaN, dan bulan
 * lalu yang kosong tidak pernah menghasilkan persen yang menyesatkan.
 *
 *   npm test
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CONSENT_VERSION } from '../lib/consent.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'nova-uji-ubah-'));
process.env.NOVA_DATA_DIR = DATA_DIR;
process.env.PORT = '0';
process.env.NOVA_AI_BACKEND = 'anthropic';
process.env.ANTHROPIC_API_KEY = '';
delete process.env.GOOGLE_CLOUD_PROJECT;
process.on('exit', () => rmSync(DATA_DIR, { recursive: true, force: true }));

const { store } = await import('../lib/store.js');
const { perubahanPersen } = await import('../lib/cashbook.js');

/* ================================================== perubahanPersen */

test('perubahan positif, negatif, dan nol dihitung dengan pembulatan satu desimal', () => {
  assert.equal(perubahanPersen(1_000_000, 1_180_000), 18); // contoh di brief
  assert.equal(perubahanPersen(1_000_000, 930_000), -7);
  assert.equal(perubahanPersen(3, 4), 33.3, 'dibulatkan, bukan 33.33333');
  assert.equal(perubahanPersen(100, 100), 0, 'periode identik → 0, bukan null');
});

test('bulan lalu nol / tidak ada: null, bukan Infinity atau NaN', () => {
  assert.equal(perubahanPersen(0, 500_000), null);
  assert.equal(perubahanPersen(null, 500_000), null);
  assert.equal(perubahanPersen(undefined, 500_000), null);
  assert.equal(perubahanPersen(NaN, 500_000), null);
  assert.equal(perubahanPersen('bukan angka', 500_000), null);
});

test('angka sekarang yang aneh tetap aman: tidak pernah meledak', () => {
  assert.equal(perubahanPersen(1_000_000, null), null);
  assert.equal(perubahanPersen(1_000_000, NaN), null);
});

/* ================================================== Rute /api/perubahan */

const app = (await import('../server.js')).default;
const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const BASE = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const { user, accessCode } = await store.createUser({ name: 'Bu Ubah', business: 'Warung Ubah', batch: 'B1' });
await store.saveConsent(user.id, CONSENT_VERSION);
await store.saveProfile(user.id, {
  namaUsaha: 'Warung Ubah', jenisUsaha: 'kuliner', pencatatan: 'aplikasi',
  tujuan: 'naikkan-laba', omzetBulanan: 4_000_000,
});

const hariIni = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const bulanIni = hariIni.slice(0, 7);
/** Tanggal bulan berjalan yang PASTI sudah lewat — mutator menolak masa depan. */
const tanggalBulanIni = (tanggal) =>
  tanggalDiBulan(0, Math.min(tanggal, Number(hariIni.slice(8, 10))));

const tanggalDiBulan = (mundur, tanggal) => {
  const [y, m] = bulanIni.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 - mundur, 1));
  return `${d.toISOString().slice(0, 7)}-${String(tanggal).padStart(2, '0')}`;
};
const tambah = (tanggal, jenis, kategori, jumlah, ket) =>
  store.addTransaction(user.id, { tanggal, jenis, kategori, keterangan: ket, jumlah }, { aktor: 'manusia' });

test('tanpa kode akses: 401', async () => {
  const res = await fetch(BASE + '/api/perubahan');
  assert.equal(res.status, 401);
});

test('data dua bulan: omzet, pengeluaran, laba, dan pencatatan dibandingkan benar', async () => {
  // Bulan lalu: omzet 10jt, biaya 6jt → laba 4jt, 20 catatan.
  for (let i = 1; i <= 10; i += 1) {
    await tambah(tanggalDiBulan(1, i), 'masuk', 'penjualan', 1_000_000, 'jualan');
    await tambah(tanggalDiBulan(1, i + 10), 'keluar', 'belanja-bahan', 600_000, 'belanja');
  }
  // Bulan ini: omzet 12jt (+20%), biaya 5jt (−16.7%), laba 7jt (+75%), 16 catatan.
  for (let i = 1; i <= 8; i += 1) {
    await tambah(tanggalBulanIni(i), 'masuk', 'penjualan', 1_500_000, 'jualan');
    await tambah(tanggalBulanIni(i + 8), 'keluar', 'belanja-bahan', 625_000, 'belanja');
  }

  const data = await fetch(BASE + '/api/perubahan', { headers: { Authorization: `Bearer ${accessCode}` } }).then((r) => r.json());
  assert.equal(data.kini.ada, true);
  assert.equal(data.lalu.ada, true);

  assert.equal(data.kini.omzet, 12_000_000);
  assert.equal(data.lalu.omzet, 10_000_000);
  assert.equal(data.ubah.omzet, 20);
  assert.equal(data.ubah.pengeluaran, -16.7);
  assert.equal(data.ubah.labaBersih, 75);
  assert.equal(data.ubah.pencatatan, -20);

  // Pengeluaran = biaya usaha saja: prive/cicilan tidak mengaburkan perbandingan.
  assert.ok(data.kini.pengeluaran <= 5_000_000);
  assert.ok(data.kalimat.length >= 2);
  assert.ok(data.kalimat.some((s) => s.includes('Omzet naik 20%')), 'kalimat harus menyebut angka yang benar');
  assert.ok(data.kalimat.every((s) => !/Infinity|NaN/.test(s)), 'tidak boleh ada Infinity/NaN di penjelasan');
});

test('bulan lalu kosong: perubahan null dengan kalimat yang jujur', async () => {
  const kosong = await store.createUser({ name: 'Bu Baru', business: '', batch: 'B1' });
  await store.saveConsent(kosong.user.id, CONSENT_VERSION);
  await store.saveProfile(kosong.user.id, {
    namaUsaha: 'Warung Baru', jenisUsaha: 'kuliner', pencatatan: 'aplikasi',
    tujuan: 'rapikan-keuangan', omzetBulanan: 3_000_000,
  });
  await store.addTransaction(kosong.user.id, { tanggal: hariIni, jenis: 'masuk', kategori: 'penjualan', keterangan: 'jualan pertama', jumlah: 100_000 }, { aktor: 'manusia' });

  const data = await fetch(BASE + '/api/perubahan', { headers: { Authorization: `Bearer ${kosong.accessCode}` } }).then((r) => r.json());
  assert.equal(data.lalu.ada, false);
  assert.equal(data.ubah.omzet, null, 'bulan lalu kosong → null, bukan Infinity');
  assert.ok(data.kalimat.some((s) => s.includes('Belum cukup data')));
});

test('laba negatif: arah perubahan selalu benar — memburuk tidak pernah terbaca "naik"', () => {
  // Rugi makin dalam (−400rb → −700rb): pembagi mutlak menjaga tandanya
  // tetap negatif. Formula naif (b−a)/a di sini memberi +75% — panah naik
  // justru saat usaha makin terpuruk.
  assert.equal(perubahanPersen(-400_000, -700_000), -75);
  assert.equal(statusDari(perubahanPersen(-400_000, -700_000)), 'turun');
  // Rugi yang menyempit terbaca membaik (positif), seperti seharusnya.
  assert.equal(perubahanPersen(-700_000, -400_000), 42.9);
  function statusDari(p) { return p == null ? 'null' : p > 0 ? 'naik' : p < 0 ? 'turun' : 'datar'; }
});

test('laba negatif di kedua bulan: perbandingan tetap dihitung, tanpa NaN', async () => {
  const rugi = await store.createUser({ name: 'Bu Rugi', business: '', batch: 'B2' });
  await store.saveConsent(rugi.user.id, CONSENT_VERSION);
  await store.saveProfile(rugi.user.id, {
    namaUsaha: 'Warung Rugi', jenisUsaha: 'kuliner', pencatatan: 'buku',
    tujuan: 'naikkan-laba', omzetBulanan: 1_000_000,
  });
  const t1 = tanggalDiBulan(1, 5), t2 = tanggalBulanIni(5);
  await store.addTransaction(rugi.user.id, { tanggal: t1, jenis: 'masuk', kategori: 'penjualan', keterangan: 'jualan', jumlah: 1_000_000 }, { aktor: 'manusia' });
  await store.addTransaction(rugi.user.id, { tanggal: t1, jenis: 'keluar', kategori: 'operasional', keterangan: 'bahan mahal', jumlah: 1_400_000 }, { aktor: 'manusia' }); // rugi 400rb
  await store.addTransaction(rugi.user.id, { tanggal: t2, jenis: 'masuk', kategori: 'penjualan', keterangan: 'jualan', jumlah: 1_000_000 }, { aktor: 'manusia' });
  await store.addTransaction(rugi.user.id, { tanggal: t2, jenis: 'keluar', kategori: 'operasional', keterangan: 'bahan makin mahal', jumlah: 1_700_000 }, { aktor: 'manusia' }); // rugi 700rb

  const data = await fetch(BASE + '/api/perubahan', { headers: { Authorization: `Bearer ${rugi.accessCode}` } }).then((r) => r.json());
  assert.equal(data.kini.labaBersih, -700_000);
  assert.equal(data.ubah.labaBersih, -75);
  assert.ok(!/Infinity|NaN/.test(JSON.stringify(data)));
});
