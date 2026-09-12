/**
 * Uji jalur rekomendasi — satu-satunya keluaran AI yang TERSIMPAN.
 *
 * Latar: keluaran penyedia dulu langsung masuk `user.recommendations` hanya
 * dengan JSON.parse — skema `json_schema` penyedia diperlakukan cukup. Itu
 * lubang kepercayaan: regresi penyedia (atau tubuh yang disisipi) lolos ke
 * disk dan dibaca ulang tiga permukaan (Saran, fokus harian, kartu publik).
 * Kini rute mewajibkan `sanitasiRekomendasi` sebelum menyimpan; yang diuji:
 *   - pembersih keluaran AI secara menyeluruh (murni — tanpa panggilan AI),
 *   - medan asing dan angka karangan TIDAK IKUT tersimpan,
 *   - jalur rute dengan penyedia palsu: yang bersih tersimpan, yang rusak
 *     gagal 502 dan TIDAK MENULIS APA PUN ke basis data.
 *
 *   npm test
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CONSENT_VERSION } from '../lib/consent.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'nova-uji-rek-'));
process.env.NOVA_DATA_DIR = DATA_DIR;
process.env.PORT = '0';
process.env.NOVA_AI_BACKEND = 'anthropic';
process.env.ANTHROPIC_API_KEY = '';
delete process.env.GOOGLE_CLOUD_PROJECT;
process.on('exit', () => rmSync(DATA_DIR, { recursive: true, force: true }));

const { store } = await import('../lib/store.js');
const { sanitasiRekomendasi } = await import('../lib/rekomendasi.js');
const { MODUL_MAKS, MODUL_MIN } = await import('../lib/kurikulum.js');
const app = (await import('../server.js')).default;

const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const BASE = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const { user, accessCode } = await store.createUser({ name: 'Bu Rek', business: 'Warung Rek', batch: 'B1' });
await store.saveConsent(user.id, CONSENT_VERSION);
await store.saveProfile(user.id, {
  namaUsaha: 'Warung Rek', jenisUsaha: 'kuliner', pencatatan: 'buku',
  tujuan: 'naikkan-laba', omzetBulanan: 5_000_000,
});

const minta = (jalur, { kode = accessCode, ...opts } = {}) =>
  fetch(BASE + jalur, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${kode}`, ...(opts.headers ?? {}) },
  });

/** Satu rekomendasi yang sah — dipakai ulang oleh banyak kasus di bawah. */
const itemSah = () => ({
  judul: 'Rapikan pemisahan uang usaha',
  prioritas: 'tinggi',
  alasan: 'Prive bulan ini 1.200.000, hampir menyamai laba bersih 1.500.000.',
  langkah: ['Tentukan prive tetap mingguan', 'Catat setiap pengambilan di Buku Kas'],
  dampak: 'Saldo kas bulanan berhenti tergerus diam-diam.',
  modulTerkait: MODUL_MIN,
});
const hasilSah = () => ({
  ringkasan: 'Usaha untung, tetapi kas sering menipis karena prive tidak tetap.',
  rekomendasi: [itemSah()],
  peringatan: ['Prive hampir menyamai laba bersih.'],
  targetBulanIni: ['Tetapkan prive mingguan', 'Catat semua pengeluaran harian', 'Naikkan margin menu 1 item'],
});

/* ================================================== Sanitasi keluaran AI */

test('hasil yang sah diteruskan: empat medan, tidak ada medan liar yang ikut', () => {
  const mentah = { ...hasilSah(), medanAsing: 'x', jumlah: 999, total: 42 };
  const hasil = sanitasiRekomendasi(mentah);
  assert.deepEqual(Object.keys(hasil).sort(), ['peringatan', 'rekomendasi', 'ringkasan', 'targetBulanIni']);
  assert.deepEqual(Object.keys(hasil.rekomendasi[0]).sort(),
    ['alasan', 'dampak', 'judul', 'langkah', 'modulTerkait', 'prioritas']);
  assert.equal(hasil.rekomendasi[0].modulTerkait, MODUL_MIN);
});

test('bentuk rusak: galat 502 siap-tampil, bukan crash', () => {
  for (const mentah of [null, 'teks', 42, [], {}, { rekomendasi: [itemSah()] }, { ringkasan: 'saja' }, { rekomendasi: [] }]) {
    try {
      sanitasiRekomendasi(mentah);
      assert.fail('harusnya melempar');
    } catch (err) {
      assert.equal(err.status, 502);
    }
  }
});

test('medan kepanjangan dipotong; daftar kelebihan dibuang sesuai batas skema', () => {
  const hasil = sanitasiRekomendasi({
    ringkasan: 'r'.repeat(700),
    rekomendasi: Array.from({ length: 9 }, () => ({
      judul: 'j'.repeat(120),
      prioritas: 'tinggi',
      alasan: 'a'.repeat(500),
      langkah: Array.from({ length: 9 }, (_, i) => 'langkah ' + i + ' ' + 'x'.repeat(250)),
      dampak: 'd'.repeat(300),
      modulTerkait: MODUL_MAKS,
    })),
    peringatan: Array.from({ length: 9 }, () => 'p'.repeat(300)),
    targetBulanIni: Array.from({ length: 9 }, () => 't'.repeat(300)),
  });
  assert.ok(hasil.ringkasan.length <= 600);
  assert.equal(hasil.rekomendasi.length, 5, 'maksimal lima rekomendasi');
  const satu = hasil.rekomendasi[0];
  assert.ok(satu.judul.length <= 80 && satu.alasan.length <= 400 && satu.dampak.length <= 200);
  assert.equal(satu.langkah.length, 4, 'maksimal empat langkah');
  assert.ok(satu.langkah.every((s) => s.length <= 200));
  assert.equal(hasil.peringatan.length, 5);
  assert.equal(hasil.targetBulanIni.length, 3);
});

test('prioritas asing jatuh ke tengah — tidak naik ke tinggi, tidak turun ke rendah', () => {
  const hasil = sanitasiRekomendasi({
    ringkasan: 'ringkasan cukup.',
    rekomendasi: [{ ...itemSah(), prioritas: 'mendadak' }, { ...itemSah(), prioritas: 7 }],
  });
  assert.ok(hasil.rekomendasi.every((r) => r.prioritas === 'sedang'));
});

test('modulTerkait di luar rentang atau bukan bilangan bulat menjadi null', () => {
  const hasil = sanitasiRekomendasi({
    ringkasan: 'ringkasan cukup.',
    rekomendasi: [
      { ...itemSah(), modulTerkait: 47 },
      { ...itemSah(), modulTerkait: 0 },
      { ...itemSah(), modulTerkait: 2.5 },
      { ...itemSah(), modulTerkait: 'lima' },
      { ...itemSah(), modulTerkait: MODUL_MAKS },
    ],
  });
  assert.deepEqual(hasil.rekomendasi.map((r) => r.modulTerkait), [null, null, null, null, MODUL_MAKS]);
});

test('item hantu (tanpa judul dan tanpa alasan) dibuang; langkah kosong dibersihkan', () => {
  const hasil = sanitasiRekomendasi({
    ringkasan: 'ringkasan cukup.',
    rekomendasi: [
      { prioritas: 'tinggi', langkah: [] },
      { judul: '   ', alasan: '', langkah: ['', '   '] },
      { ...itemSah(), langkah: [42, null, 'Langkah sah', ''] },
    ],
  });
  assert.equal(hasil.rekomendasi.length, 1);
  assert.deepEqual(hasil.rekomendasi[0].langkah, ['42', 'Langkah sah']);
});

/* ================================================== Rute /api/recommendations */

test('tanpa kode akses: 401', async () => {
  const res = await fetch(BASE + '/api/recommendations', { method: 'POST' });
  assert.equal(res.status, 401);
});

test('profil kosong: 400, bukan AI yang dipanggil', async () => {
  const kosong = await store.createUser({ name: 'Tanpa Profil', business: '', batch: 'B1' });
  await store.saveConsent(kosong.user.id, CONSENT_VERSION);
  const res = await minta('/api/recommendations', { method: 'POST', kode: kosong.accessCode });
  assert.equal(res.status, 400);
});

/**
 * Penyedia palsu bergaya Anthropic — pola yang sama dengan uji check-up.
 *
 * SATU server untuk seluruh uji rute, dengan tubuh jawaban yang bisa diganti
 * per uji: klien Anthropic di lib/claude.js di-cache per backend, jadi port
 * palsu yang berubah di antara uji meninggalkan klien menunjuk server mati —
 * kegagalan koneksi yang terbaca 502 dan tidak ada hubungannya dengan yang
 * mau diuji. (Inilah sebabnya uji check-up hanya punya satu kasus penyedia.)
 */
let tubuhPenyedia = '';
const penyediaPalsu = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const usage = { input_tokens: 900, output_tokens: 300 };
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const w = (t, d) => res.write(`event: ${t}\ndata: ${JSON.stringify(d)}\n\n`);
    w('message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5', content: [], stop_reason: null, usage } });
    w('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    w('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: tubuhPenyedia } });
    w('content_block_stop', { type: 'content_block_stop', index: 0 });
    w('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage });
    w('message_stop', { type: 'message_stop' });
    res.end();
  });
});
await new Promise((r) => penyediaPalsu.listen(0, r));
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${penyediaPalsu.address().port}`;
process.env.ANTHROPIC_API_KEY = 'sk-ant-uji';
test.after(() => {
  penyediaPalsu.close();
  delete process.env.ANTHROPIC_BASE_URL;
  delete process.env.ANTHROPIC_API_KEY;
});

/* Pengguna khusus kasus gagalan — rekomendasinya harus tetap kosong setelah
 * setiap kegagalan, tanpa tertukar dengan hasil jalur bahagia di atas. */
const gagal = await store.createUser({ name: 'Bu Gagal', business: 'Warung Gagal', batch: 'B1' });
await store.saveConsent(gagal.user.id, CONSENT_VERSION);
await store.saveProfile(gagal.user.id, {
  namaUsaha: 'Warung Gagal', jenisUsaha: 'retail', pencatatan: 'buku',
  tujuan: 'rapikan-keuangan', omzetBulanan: 3_000_000,
});
const mintaGagal = (opts = {}) => minta('/api/recommendations', { kode: gagal.accessCode, ...opts });

test('jalur bahagia: jawaban bersih tersimpan dengan stempel waktunya', async () => {
  tubuhPenyedia = JSON.stringify({ ...hasilSah(), medanAsing: true, jumlah: 1 });
  const res = await minta('/api/recommendations', { method: 'POST' });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.recommendations.rekomendasi.length, 1);
  assert.equal(data.recommendations.rekomendasi[0].modulTerkait, MODUL_MIN);
  assert.ok(data.recommendations.generatedAt, 'stempel waktu ikut tersimpan');
  assert.equal(data.recommendations.medanAsing, undefined, 'medan asing penyedia tidak tersimpan');
  assert.equal(data.recommendations.jumlah, undefined, 'angka karangan penyedia tidak tersimpan');
});

test('tubuh penyedia yang rusak: 502 dan TIDAK ADA yang tersimpan', async () => {
  for (const tubuh of ['bukan json sama sekali', '{"ringkasan":"tanpa daftar"}', '{"rekomendasi":[]}', '[]']) {
    tubuhPenyedia = tubuh;
    const res = await mintaGagal({ method: 'POST' });
    assert.equal(res.status, 502, `tubuh "${tubuh}" harusnya gagal tertutup`);
    const tersimpan = await store.findUserById(gagal.user.id);
    assert.equal(tersimpan.recommendations, null, 'kegagalan pembersih tidak boleh menulis ke basis data');
  }
});

test('usulan medan uang dari penyedia tidak pernah mencapai basis data', async () => {
  tubuhPenyedia = JSON.stringify({
    ...hasilSah(),
    jumlah: 500_000,
    rekomendasi: [{ ...itemSah(), jumlah: 500_000, nominal: 'Rp 1.000.000' }],
  });
  const res = await minta('/api/recommendations', { method: 'POST' });
  assert.equal(res.status, 200);
  const tersimpan = await store.findUserById(user.id);
  assert.equal(tersimpan.recommendations.jumlah, undefined);
  assert.equal(tersimpan.recommendations.rekomendasi[0].jumlah, undefined);
  assert.equal(tersimpan.recommendations.rekomendasi[0].nominal, undefined);
});
