/**
 * Uji pencarian & filter transaksi buku kas.
 *
 * Penyaringan hidup di SATU tempat: saringTransaksi (lib/cashbook.js), dipakai
 * rute GET /api/cashbook lewat parameter opsional q/jenis/kategori. Yang dijaga:
 * filter hanya mengubah DAFTAR — ringkasan, grafik, dan angka laporan tetap
 * dihitung dari seluruh transaksi bulan itu. Simpan transaksi lewat rute lama
 * tidak berubah sedikit pun.
 *
 *   npm test
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'nova-uji-cari-'));
process.env.NOVA_DATA_DIR = DATA_DIR;
process.env.PORT = '0';
process.env.NOVA_AI_BACKEND = 'anthropic';
process.env.ANTHROPIC_API_KEY = '';
delete process.env.GOOGLE_CLOUD_PROJECT;
process.on('exit', () => rmSync(DATA_DIR, { recursive: true, force: true }));

const { store } = await import('../lib/store.js');
const { saringTransaksi } = await import('../lib/cashbook.js');
const app = (await import('../server.js')).default;

const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const BASE = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const { user, accessCode } = await store.createUser({ name: 'Bu Cari', business: 'Warung Cari', batch: 'B1' });
await store.saveConsent(user.id, 2);

const hariIni = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
await store.addTransaction(user.id, { tanggal: hariIni, jenis: 'masuk', kategori: 'penjualan', keterangan: 'Jual Nasi Rames', jumlah: 25_000 }, { aktor: 'manusia' });
await store.addTransaction(user.id, { tanggal: hariIni, jenis: 'keluar', kategori: 'belanja-bahan', keterangan: 'Belanja sayur di pasar', jumlah: 60_000 }, { aktor: 'manusia' });
await store.addTransaction(user.id, { tanggal: hariIni, jenis: 'keluar', kategori: 'operasional', keterangan: 'Gas 3 kg', jumlah: 22_000 }, { aktor: 'manusia' });
await store.addTransaction(user.id, { tanggal: hariIni, jenis: 'keluar', kategori: 'prive', keterangan: 'Ambil untuk bensin', jumlah: 15_000 }, { aktor: 'manusia' });

/* ================================================== Murni: saringTransaksi */

test('pencarian teks: cocok di keterangan, tanpa memedulikan huruf besar', () => {
  const hasil = saringTransaksi([
    { jenis: 'masuk', kategori: 'penjualan', keterangan: 'Jual NASI Rames' },
    { jenis: 'keluar', kategori: 'belanja-bahan', keterangan: 'Sayur' },
  ], { q: 'nasi' });
  assert.equal(hasil.length, 1);
  assert.equal(hasil[0].keterangan, 'Jual NASI Rames');
});

test('pencarian juga menyentuh kategori dan jenis', () => {
  const rows = [
    { jenis: 'keluar', kategori: 'operasional', keterangan: '' },
    { jenis: 'masuk', kategori: 'penjualan', keterangan: 'jualan pagi' },
  ];
  assert.equal(saringTransaksi(rows, { q: 'operasional' }).length, 1);
  assert.equal(saringTransaksi(rows, { q: 'keluar' }).length, 1);
});

test('filter jenis: masuk / keluar / semua', () => {
  const rows = [
    { jenis: 'masuk', kategori: 'penjualan' },
    { jenis: 'keluar', kategori: 'prive' },
  ];
  assert.equal(saringTransaksi(rows, { jenis: 'masuk' }).length, 1);
  assert.equal(saringTransaksi(rows, { jenis: 'keluar' }).length, 1);
  assert.equal(saringTransaksi(rows, {}).length, 2, 'tanpa jenis = semua');
  assert.equal(saringTransaksi(rows, { jenis: 'jenis-palsu' }).length, 2, 'jenis asing diabaikan, bukan membuang semua');
});

test('filter kategori: persis sama', () => {
  const rows = [
    { jenis: 'keluar', kategori: 'operasional' },
    { jenis: 'keluar', kategori: 'prive' },
  ];
  assert.equal(saringTransaksi(rows, { kategori: 'operasional' }).length, 1);
  assert.equal(saringTransaksi(rows, { kategori: 'cicilan' }).length, 0);
});

test('filter gabungan: ketat, tapi tidak saling menghapus', () => {
  const rows = [
    { jenis: 'keluar', kategori: 'operasional', keterangan: 'Gas 3 kg' },
    { jenis: 'keluar', kategori: 'prive', keterangan: 'Bensin' },
  ];
  const hasil = saringTransaksi(rows, { q: 'gas', jenis: 'keluar', kategori: 'operasional' });
  assert.equal(hasil.length, 1);
  assert.equal(hasil[0].keterangan, 'Gas 3 kg');
  // Gabungan yang mustahil: hasil kosong, bukan galat.
  assert.equal(saringTransaksi(rows, { q: 'gas', kategori: 'prive' }).length, 0);
});

test('filter kosong: semua lolos persis apa adanya', () => {
  const rows = [{ a: 1 }, { b: 2 }];
  assert.deepEqual(saringTransaksi(rows, { q: '', jenis: '', kategori: '' }), rows);
});

/* ================================================== Rute /api/cashbook */

const minta = (jalur) => fetch(BASE + jalur, { headers: { Authorization: `Bearer ${accessCode}` } });

test('rute: ?q= menyaring daftar, ringkasan tetap dari seluruh bulan', async () => {
  const penuh = await (await minta('/api/cashbook')).json();
  assert.equal(penuh.transactions.length, 4);
  assert.equal(penuh.terfilter, false);

  const tersaring = await (await minta('/api/cashbook?q=gas')).json();
  assert.equal(tersaring.transactions.length, 1);
  assert.equal(tersaring.transactions[0].keterangan, 'Gas 3 kg');
  assert.equal(tersaring.terfilter, true);
  // Angka laporan tidak ikut tersaring — mencari "gas" tidak mengubah saldo sebulan.
  assert.equal(tersaring.summary.totalKeluar, penuh.summary.totalKeluar);
  assert.equal(tersaring.summary.saldoKas, penuh.summary.saldoKas);
});

test('rute: ?jenis= dan ?kategori= bekerja, kombinasi juga', async () => {
  const masuk = await (await minta('/api/cashbook?jenis=masuk')).json();
  assert.equal(masuk.transactions.length, 1);
  const prive = await (await minta('/api/cashbook?kategori=prive')).json();
  assert.equal(prive.transactions.length, 1);
  const gabung = await (await minta('/api/cashbook?jenis=keluar&kategori=belanja-bahan')).json();
  assert.equal(gabung.transactions.length, 1);
  assert.equal(gabung.transactions[0].kategori, 'belanja-bahan');
});

test('kombinasi tanpa hasil: daftar kosong + penanda terfilter', async () => {
  const res = await minta('/api/cashbook?q=zzz-tidak-ada');
  const data = await res.json();
  assert.equal(data.transactions.length, 0);
  assert.equal(data.terfilter, true);
});

test('membersihkan filter (tanpa parameter): semua kembali', async () => {
  const res = await minta('/api/cashbook');
  assert.equal((await res.json()).transactions.length, 4);
});

test('simpan transaksi lewat rute lama tetap bekerja dan muncul tanpa filter', async () => {
  const buat = await fetch(BASE + '/api/cashbook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessCode}` },
    body: JSON.stringify({ jenis: 'masuk', kategori: 'penjualan', jumlah: 30_000, keterangan: 'jualan sore', tanggal: hariIni }),
  });
  assert.equal(buat.status, 201);
  const semua = await (await minta('/api/cashbook')).json();
  assert.equal(semua.transactions.length, 5);
  assert.ok(semua.transactions.some((t) => t.keterangan === 'jualan sore'));
  // Dan transaksi barunya ditemukan oleh pencarian yang ada.
  const dicari = await (await minta('/api/cashbook?q=sore')).json();
  assert.equal(dicari.transactions.length, 1);
});
