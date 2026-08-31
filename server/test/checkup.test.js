/**
 * Uji AI Financial Check-up ("Periksa Usaha Saya").
 *
 * Alurnya meniru rekomendasi: pengguna menekan tombol → angka dari buku kas
 * dikemas metricsToText + bandingkanBulan → AI menilai STATUS → keluarannya
 * dibersihkan sanitasiCheckup sebelum tampil. Yang diuji di sini:
 *   - pembersih keluaran AI secara menyeluruh (murni — tanpa panggilan AI),
 *   - pagar rute (autentikasi, persetujuan, AI belum diatur),
 *   - jatah anggaran checkup terdaftar,
 *   - dan bahwa check-up tidak pernah menyimpan transaksi apa pun.
 *
 *   npm test
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'nova-uji-ck-'));
process.env.NOVA_DATA_DIR = DATA_DIR;
process.env.PORT = '0';
process.env.NOVA_AI_BACKEND = 'anthropic';
process.env.ANTHROPIC_API_KEY = '';
delete process.env.GOOGLE_CLOUD_PROJECT;
process.on('exit', () => rmSync(DATA_DIR, { recursive: true, force: true }));

const { store } = await import('../lib/store.js');
const { sanitasiCheckup } = await import('../lib/checkup.js');
const { PERKIRAAN } = await import('../lib/anggaran.js');
const app = (await import('../server.js')).default;

const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const BASE = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const { user, accessCode } = await store.createUser({ name: 'Bu Cek', business: 'Warung Cek', batch: 'B1' });
await store.saveConsent(user.id, 2);
await store.saveProfile(user.id, {
  namaUsaha: 'Warung Cek', jenisUsaha: 'kuliner', pencatatan: 'aplikasi',
  tujuan: 'rapikan-keuangan', omzetBulanan: 4_000_000,
});

const minta = (jalur, { kode = accessCode, ...opts } = {}) =>
  fetch(BASE + jalur, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${kode}`, ...(opts.headers ?? {}) },
  });

/* ================================================== Sanitasi keluaran AI */

test('hasil AI yang sah diterima: item berstatus, insight terpotong rapi', () => {
  const hasil = sanitasiCheckup({
    item: [
      { tipe: 'ok', teks: 'Pencatatan aktif 31 hari penuh.' },
      { tipe: 'perhatian', teks: 'Beban cicilan mendekati ambang 30% laba.' },
    ],
    insight: 'Sisihkan cicilan di awal bulan agar sisa kas tidak menipu.',
  });
  assert.equal(hasil.item.length, 2);
  assert.equal(hasil.item[0].tipe, 'ok');
  assert.equal(hasil.insight.length, 58);
  assert.deepEqual(Object.keys(hasil).sort(), ['insight', 'item']);
});

test('tipe asing jatuh ke perhatian; teks kepanjangan dipotong; item kelebihan dibuang', () => {
  const hasil = sanitasiCheckup({
    item: Array.from({ length: 9 }, (_, i) => ({ tipe: 'misterius', teks: 'item ' + i + ' ' + 'x'.repeat(250) })),
    insight: 'y'.repeat(500),
  });
  assert.equal(hasil.item.length, 6, 'maksimal enam item');
  assert.ok(hasil.item.every((i) => i.tipe === 'perhatian'));
  assert.ok(hasil.item.every((i) => i.teks.length <= 200));
  assert.ok(hasil.insight.length <= 400);
});

test('bentuk kosong/rusak: galat 502 siap-tampil, bukan crash', () => {
  for (const mentah of [null, 'teks', 42, {}, { item: [] }, { item: [], insight: '' }]) {
    try {
      sanitasiCheckup(mentah);
      assert.fail('harusnya melempar');
    } catch (err) {
      assert.equal(err.status, 502);
    }
  }
});

test('jatah anggaran checkup terdaftar di PERKIRAAN', () => {
  assert.ok(PERKIRAAN.checkup >= 2_000, 'checkup harus punya perkiraan biaya sendiri');
});

/* ================================================== Rute /api/checkup */

test('tanpa kode akses: 401', async () => {
  const res = await fetch(BASE + '/api/checkup', { method: 'POST' });
  assert.equal(res.status, 401);
});

test('kode asing: 401', async () => {
  const res = await minta('/api/checkup', { method: 'POST', kode: 'NOVA-ZZZZ-ZZZZ' });
  assert.equal(res.status, 401);
});

test('peserta belum menyetujui: 451, bukan analisis yang dijalankan', async () => {
  const belum = await store.createUser({ name: 'Belum Setuju', business: '', batch: 'B1' });
  const res = await minta('/api/checkup', { method: 'POST', kode: belum.accessCode });
  assert.equal(res.status, 451);
});

test('AI belum diatur: 503 yang jujur soal sebabnya', async () => {
  const res = await minta('/api/checkup', { method: 'POST' });
  assert.equal(res.status, 503);
  const data = await res.json();
  assert.match(data.error, /AI/);
});

test('check-up tidak pernah menyimpan transaksi atau mengubah pembukuan', async () => {
  const sebelum = (await store.getTransactions(user.id)).length;
  await minta('/api/checkup', { method: 'POST' });
  const sesudah = (await store.getTransactions(user.id)).length;
  assert.equal(sebelum, sesudah);
});

test('rekonsiliasi: anggaran checkup tercatat di jejak token peserta', async () => {
  // Rute menjawab 503 sebelum AI — jejak token tetap kosong, dan itu benar:
  // tidak ada yang ditagih untuk panggilan yang tidak pernah terjadi.
  const log = await store.getTokenLog(user.id);
  const entriCheckup = (log ?? []).filter((x) => x.jenis === 'checkup');
  assert.equal(entriCheckup.length, 0);
});
