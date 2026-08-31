/**
 * Uji penutupan loop belajar → tindakan (lib/praktik.js + penandaannya).
 *
 * Yang paling dijaga:
 *   - klik CTA BUKAN selesai: praktik hanya ditandai server saat tindakan
 *     benar-benar terjadi (transaksi tercatat / laporan dibuka);
 *   - hanya modul yang relevan + sedang menjadi perhatian pengguna (selesai
 *     dibaca, atau sesi berikutnya yang sedang dijalani) yang ikut ditandai;
 *   - `progress.praktik` milik server dan selamat dari setiap saveProgress —
 *     progres lama tanpa `praktik` tetap sah (backward compatible);
 *   - jenis aksi asing tidak pernah menandai apa pun.
 *
 * UNLOCK_ALL_MODULES=1: uji ini membuat pengguna uji baru tanpa jadwal
 * pendamping, jadi gerbang sesi dibuka penuh lewat saklar evaluasi yang sama
 * dengan lembar validasi ahli.
 *
 *   npm test
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'nova-uji-praktik-'));
process.env.NOVA_DATA_DIR = DATA_DIR;
process.env.PORT = '0';
process.env.NOVA_AI_BACKEND = 'anthropic';
process.env.ANTHROPIC_API_KEY = '';
process.env.UNLOCK_ALL_MODULES = '1';
delete process.env.GOOGLE_CLOUD_PROJECT;
process.on('exit', () => rmSync(DATA_DIR, { recursive: true, force: true }));

const { modulPraktikTerverifikasi } = await import('../lib/praktik.js');
const { store } = await import('../lib/store.js');
const app = (await import('../server.js')).default;

const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const BASE = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const CONSENT_VERSION = (await import('../lib/consent.js')).CONSENT_VERSION;

/* =================================================== Lib — pemilihan modul */

test('jenis aksi asing tidak pernah menandai apa pun', () => {
  const hasil = modulPraktikTerverifikasi({
    done: { 1: true, 2: true, 3: true, 7: true },
    jenis: 'chat',
  });
  assert.deepEqual(hasil, []);
});

test('transaksi: hanya modul transaksi yang done — yang belum dan bukan sesi berikutnya dilewati', () => {
  const hasil = modulPraktikTerverifikasi({
    done: { 2: true },
    sudah: {},
    jenis: 'transaksi',
    sesiBerikutNo: 3,
  });
  // Modul 1: belum done dan bukan sesi berikutnya → dilewati.
  // Modul 2: done → ditandai. Modul 3: sesi berikutnya → ditandai.
  assert.deepEqual(hasil, [2, 3]);
});

test('yang sudah pernah ditandai tidak didobel', () => {
  const hasil = modulPraktikTerverifikasi({
    done: { 2: true },
    sudah: { 2: { pada: '2026-08-01T00:00:00.000Z' } },
    jenis: 'transaksi',
    sesiBerikutNo: 3,
  });
  assert.deepEqual(hasil, [3]);
});

test('laporan: hanya modul dengan aksi terverifikasi laporan', () => {
  const hasil = modulPraktikTerverifikasi({
    done: { 7: true, 28: true, 30: true, 32: true, 4: true },
    sudah: {},
    jenis: 'laporan',
  });
  // Modul 4 punya CTA dasbor tanpa terverifikasi — tidak ikut.
  assert.deepEqual(hasil, [7, 28, 30, 32]);
});

/* ================================================ Rute — tindakan nyata */

const buatPeserta = async (nama) => {
  const { user, accessCode } = await store.createUser({ name: nama, business: 'Warung Uji', batch: 'B1' });
  await store.saveConsent(user.id, CONSENT_VERSION);
  return { user, accessCode };
};

const minta = (jalur, { kode, method = 'GET', body } = {}) =>
  fetch(BASE + jalur, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${kode}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

test('tanpa kode akses: 401', async () => {
  assert.equal((await fetch(BASE + '/api/report')).status, 401);
  assert.equal((await fetch(BASE + '/api/cashbook', { method: 'POST' })).status, 401);
});

test('aksi nyata: transaksi tercatat → praktik modul yang relevan terverifikasi', async () => {
  const { user, accessCode } = await buatPeserta('Bu Praktik');
  // Modul 3 sudah selesai dibaca; sesi berikutnya (satu-satunya yang terbuka
  // sebagai "sedang dijalani") adalah modul 1.
  await minta('/api/progress', { kode: accessCode, method: 'PUT', body: { done: { 3: true } } });

  const res = await minta('/api/cashbook', {
    kode: accessCode,
    method: 'POST',
    body: { jenis: 'masuk', kategori: 'penjualan', jumlah: 450_000, keterangan: 'Penjualan pagi' },
  });
  assert.equal(res.status, 201);
  const data = await res.json();
  assert.deepEqual(data.praktikTerverifikasi.sort(), [1, 3]);

  const sesudah = (await (await minta('/api/me', { kode: accessCode })).json()).user.progress;
  assert.equal(sesudah.done[3], true, 'progress.done tidak tersentuh');
  assert.ok(sesudah.praktik[3]?.pada, 'praktik modul 3 tercatat dengan waktunya');
  assert.ok(sesudah.praktik[1]?.pada, 'sesi berikutnya yang sedang dijalani ikut terverifikasi');

  // Event untuk penelitian turut tercatat.
  const tersimpan = await store.findUserById(user.id);
  assert.ok(tersimpan.events.some((e) => e.type === 'praktik_terverifikasi' && e.meta?.aksi === 'transaksi'));
  assert.ok(tersimpan.events.some((e) => e.type === 'transaction_added'), 'bukti tindakan memakai event existing');
});

test('tindakan kedua tidak mendobel tanda praktik', async () => {
  const { accessCode } = await buatPeserta('Bu Dobel');
  await minta('/api/progress', { kode: accessCode, method: 'PUT', body: { done: { 2: true } } });

  for (let i = 0; i < 2; i += 1) {
    const res = await minta('/api/cashbook', {
      kode: accessCode,
      method: 'POST',
      body: { jenis: 'keluar', kategori: 'operasional', jumlah: 20_000, keterangan: 'Gas' },
    });
    const data = await res.json();
    if (i === 0) assert.deepEqual(data.praktikTerverifikasi.sort(), [1, 2]);
    if (i === 1) assert.deepEqual(data.praktikTerverifikasi, [], 'yang sudah ditandai tidak diulang');
  }
});

test('membuka laporan = tindakan terverifikasi untuk modul laporan yang selesai dibaca', async () => {
  const { accessCode } = await buatPeserta('Bu Laporan');
  await minta('/api/progress', { kode: accessCode, method: 'PUT', body: { done: { 7: true, 32: true } } });

  const res = await minta('/api/report?months=3', { kode: accessCode });
  assert.equal(res.status, 200);

  const sesudah = (await (await minta('/api/me', { kode: accessCode })).json()).user.progress;
  assert.ok(sesudah.praktik[7]?.pada);
  assert.ok(sesudah.praktik[32]?.pada);
});

test('user tanpa data dan tanpa modul selesai: tidak ada yang diklaim, tanpa crash', async () => {
  const { accessCode } = await buatPeserta('Tanpa Data');
  const res = await minta('/api/report?months=3', { kode: accessCode });
  assert.equal(res.status, 200);

  const progress = (await (await minta('/api/me', { kode: accessCode })).json()).user.progress;
  assert.deepEqual(progress.praktik ?? {}, {}, 'belum ada yang layak ditandai');

  const resKas = await minta('/api/cashbook', { kode: accessCode });
  assert.equal(resKas.status, 200); // buku kas kosong tetap terbuka normal
});

test('backward compatibility: saveProgress berikutnya tidak menghapus praktik', async () => {
  const { accessCode } = await buatPeserta('Bu Kompatibel');
  await minta('/api/progress', { kode: accessCode, method: 'PUT', body: { done: { 2: true } } });
  await minta('/api/cashbook', {
    kode: accessCode,
    method: 'POST',
    body: { jenis: 'masuk', kategori: 'penjualan', jumlah: 100_000, keterangan: 'Penjualan' },
  });

  // Simpanan progres kedua dari peramban — praktik milik server harus selamat.
  await minta('/api/progress', { kode: accessCode, method: 'PUT', body: { done: { 2: true, 3: true } } });
  const progress = (await (await minta('/api/me', { kode: accessCode })).json()).user.progress;

  assert.equal(progress.done[2], true);
  assert.equal(progress.done[3], true);
  assert.ok(progress.praktik?.[2]?.pada, 'praktik tetap ada setelah simpanan progres berikutnya');
});

test('nomor modul asing tidak pernah lolos ke praktik maupun done', async () => {
  const { accessCode } = await buatPeserta('Bu Asing');
  await minta('/api/progress', { kode: accessCode, method: 'PUT', body: { done: { 99: true } } });
  const progress = (await (await minta('/api/me', { kode: accessCode })).json()).user.progress;
  assert.equal(progress.done[99], undefined);
  assert.deepEqual(progress.praktik ?? {}, {});
});
