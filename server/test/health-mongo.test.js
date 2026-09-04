/**
 * Kesehatan jalur Mongo: penyimpanan tak terjangkau WAJIB membuat
 * /api/health tidak sehat (503) — bukan sehat palsu dengan penyimpanan
 * yang lenyap. Dipisah dari penyimpanan.test.js karena db.js membaca
 * env saat diimpor: berkas ini menyetel MONGO_URI ke alamat yang pasti
 * mati SEBELUM import.
 *
 * serverSelectionTimeoutMS = 10 detik di kode — tes ini memakan waktu
 * ±10 detik; itu harga dari jaminan "tidak sehat, bukan crash".
 *
 *   npm test
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'nova-uji-healthmongo-'));
process.env.NOVA_DATA_DIR = DATA_DIR;
process.env.PORT = '0';
process.env.MONGO_URI = 'mongodb://127.0.0.1:1/novaro?serverSelectionTimeoutMS=1000';
process.on('exit', () => rmSync(DATA_DIR, { recursive: true, force: true }));

const { periksaPenyimpanan } = await import('../lib/kesehatan.js');
const { JENIS_PENYIMPANAN } = await import('../lib/db.js');

test('mongo tak terjangkau: tidak sehat, jenis terlapor, tanpa crash', async () => {
  assert.equal(JENIS_PENYIMPANAN, 'mongo');

  const hasil = await periksaPenyimpanan({ menyeluruh: true });
  assert.equal(hasil.jenis, 'mongo');
  assert.equal(hasil.sehat, false, 'penyimpanan mati tidak boleh dilaporkan sehat');
  assert.notEqual(hasil.baca, 'ok');
  assert.notEqual(hasil.tulis, 'ok');
  assert.equal(hasil.peserta, null);

  // Panggilan kedua: kegagalan tidak pernah di-cache — selalu dicek ulang.
  const ulang = await periksaPenyimpanan();
  assert.equal(ulang.sehat, false);
});

test('kegagalan tidak melempar: /api/health cukup mendapat objek status', async () => {
  // periksaPenyimpanan adalah sumber tunggal status health; bila ia melempar,
  // rute health bisa 500 — padahal yang dijanjikan adalah 503 yang jujur.
  const hasil = await periksaPenyimpanan();
  assert.equal(typeof hasil.sehat, 'boolean');
});
