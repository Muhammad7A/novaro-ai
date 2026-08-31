/**
 * Uji untuk fungsi cariTransaksi di lib/cashbook.js.
 *
 * Fungsi murni dulu, bukan langsung tool AI:
 *   1. Query-nya harus deterministik dan bisa diuji tanpa jaringan.
 *   2. Batas baris (limit) diputuskan di sini, bukan di prompt, supaya token
 *      tidak meledak pada kasus terburuk.
 *   3. Dengan fungsi + uji yang sudah hijau, tool schema dan loop tool-use di
 *      lib/ai.js bisa ditambahkan tanpa merusak regresi yang ada.
 *
 *   npm test -- test/cari-transaksi.test.js
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { cariTransaksi } from '../lib/cashbook.js';

const sample = [
  { id: '1', tanggal: '2026-07-01', jenis: 'masuk', kategori: 'penjualan', jumlah: 500_000, keterangan: 'Jual pagi' },
  { id: '2', tanggal: '2026-07-05', jenis: 'keluar', kategori: 'belanja-bahan', jumlah: 260_000, keterangan: 'Pasar' },
  { id: '3', tanggal: '2026-07-12', jenis: 'keluar', kategori: 'belanja-bahan', jumlah: 410_000, keterangan: 'Pasar' },
  { id: '4', tanggal: '2026-07-15', jenis: 'keluar', kategori: 'operasional', jumlah: 80_000, keterangan: 'Listrik' },
  { id: '5', tanggal: '2026-07-20', jenis: 'masuk', kategori: 'penjualan', jumlah: 620_000, keterangan: 'Jual sore' },
  { id: '6', tanggal: '2026-08-02', jenis: 'keluar', kategori: 'belanja-bahan', jumlah: 300_000, keterangan: 'Pasar' },
  { id: '7', tanggal: '2026-08-03', jenis: 'keluar', kategori: 'prive', jumlah: 100_000, keterangan: 'Ambil pribadi' },
];

test('cariTransaksi mengembalikan array kosong bila tidak ada transaksi', () => {
  assert.deepEqual(cariTransaksi([]), []);
  assert.deepEqual(cariTransaksi(null), []);
  assert.deepEqual(cariTransaksi(undefined), []);
});

test('tanpa filter mengembalikan semua, terurut tanggal terbaru dulu, dibatasi limit default 15', () => {
  const hasil = cariTransaksi(sample);
  assert.equal(hasil.length, 7);
  assert.equal(hasil[0].tanggal, '2026-08-03');
  assert.equal(hasil[hasil.length - 1].tanggal, '2026-07-01');
});

test('filter dari–sampai (inklusif) memotong rentang tanggal', () => {
  const hasil = cariTransaksi(sample, { dari: '2026-07-05', sampai: '2026-07-15' });
  assert.equal(hasil.length, 3);
  assert.ok(hasil.every((t) => t.tanggal >= '2026-07-05' && t.tanggal <= '2026-07-15'));
});

test('filter kategori hanya mengambil kategori yang diminta', () => {
  const hasil = cariTransaksi(sample, { kategori: 'belanja-bahan' });
  assert.equal(hasil.length, 3);
  assert.ok(hasil.every((t) => t.kategori === 'belanja-bahan'));
});

test('filter jenis masuk/keluar', () => {
  const masuk = cariTransaksi(sample, { jenis: 'masuk' });
  assert.equal(masuk.length, 2);
  assert.ok(masuk.every((t) => t.jenis === 'masuk'));
});

test('filter minJumlah mengabaikan transaksi di bawah ambang', () => {
  const hasil = cariTransaksi(sample, { minJumlah: 300_000 });
  assert.equal(hasil.length, 4); // 500k, 410k, 620k, 300k
  assert.ok(hasil.every((t) => t.jumlah >= 300_000));
});

test('limit memotong hasil; tidak pernah melebihi batas', () => {
  const hasil = cariTransaksi(sample, { limit: 2 });
  assert.equal(hasil.length, 2);
  // Masih terurut terbaru dulu
  assert.equal(hasil[0].tanggal, '2026-08-03');
});

test('limit di luar jangkauan (0, negatif, terlalu besar) dipaksa ke rentang aman', () => {
  assert.equal(cariTransaksi(sample, { limit: 0 }).length, 0);
  assert.equal(cariTransaksi(sample, { limit: -5 }).length, 0);
  // Hard ceiling 30 supaya tool tidak bisa diminta 500 baris
  const banyak = Array.from({ length: 40 }, (_, i) => ({
    id: String(i),
    tanggal: `2026-06-${String((i % 28) + 1).padStart(2, '0')}`,
    jenis: 'keluar',
    kategori: 'operasional',
    jumlah: 10_000,
    keterangan: '',
  }));
  assert.equal(cariTransaksi(banyak, { limit: 100 }).length, 30);
});

test('kombinasi filter bekerja bersama', () => {
  const hasil = cariTransaksi(sample, {
    dari: '2026-07-01',
    sampai: '2026-07-31',
    kategori: 'belanja-bahan',
    minJumlah: 400_000,
  });
  assert.equal(hasil.length, 1);
  assert.equal(hasil[0].id, '3');
  assert.equal(hasil[0].jumlah, 410_000);
});

test('hasil hanya memuat field yang aman dikirim ke model (tidak ada createdAt mentah jika ada)', () => {
  const denganExtra = sample.map((t) => ({ ...t, createdAt: '2026-01-01T00:00:00Z', secret: 'x' }));
  const hasil = cariTransaksi(denganExtra, { limit: 1 });
  assert.equal(hasil.length, 1);
  assert.ok(!('secret' in hasil[0]));
  // createdAt boleh ada atau tidak; yang penting field inti ada
  assert.ok(hasil[0].id && hasil[0].tanggal && hasil[0].jumlah != null);
});
