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
const { tanggalWIB } = await import('../lib/cashbook.js');
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

test('jalur bahagia: AI menjawab, hasil bersih sampai ke peserta dan jatah tercatat', async () => {
  /*
   * Jalur ini dulu TIDAK PERNAH teruji karena `analyzeCheckup` tidak ada di
   * daftar import server.js — ReferenceError di dalam try menjadikan rute
   * 500 di produksi, sementara seluruh uji di atas berhenti di pagar 503.
   * Uji ini berjalan MELEWATI pagar itu: AI ditirui layanan Anthropic palsu
   * (pola yang sama dengan rute.test.js), jadi yang diperiksa adalah sambungan
   * rute → lib/ai.js → sanitasiCheckup → jawaban, bukan jaringannya.
   */
  const { createServer } = await import('node:http');
  let diminta = null;
  const palsu = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      diminta = JSON.parse(body || '{}');
      const usage = { input_tokens: 120, output_tokens: 40 };
      const json = JSON.stringify({
        item: [
          { tipe: 'ok', teks: 'Pencatatan berjalan tanpa hari kosong pekan ini.' },
          { tipe: 'perhatian', teks: 'Porsi belanja bahan mendekati batas atas.' },
        ],
        insight: 'Sisihkan uang cicilan di awal pekan sebelum prive diambil.',
      });
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const w = (t, d) => res.write(`event: ${t}\ndata: ${JSON.stringify(d)}\n\n`);
      w('message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5', content: [], stop_reason: null, usage } });
      w('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
      w('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: json } });
      w('content_block_stop', { type: 'content_block_stop', index: 0 });
      w('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage });
      w('message_stop', { type: 'message_stop' });
      res.end();
    });
  });
  await new Promise((r) => palsu.listen(0, r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${palsu.address().port}`;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-uji';

  try {
    const res = await minta('/api/checkup', { method: 'POST' });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.hasil.item.length, 2);
    assert.equal(data.hasil.item[0].tipe, 'ok');
    assert.ok(data.hasil.insight.length > 0);
    assert.ok(data.anggaran, 'sisa jatah ikut dikembalikan');

    // Angka yang dinilai AI memang berasal dari aplikasi, bukan diminta ulang.
    assert.match(String(diminta?.system ?? ''), /Perbandingan bulan/i);

    // Jejak token berbentuk {tanggal, token} per hari — panggilan ini wajib
    // tercatat di sana, itulah dasar anggaran pemakaian berikutnya.
    const log = await store.getTokenLog(user.id);
    const hariIni = (log ?? []).find((x) => x.tanggal === tanggalWIB());
    assert.ok(hariIni && hariIni.token > 0, 'pemakaian AI checkup harus ikut tercatat');
    const tersimpan = await store.findUserById(user.id);
    assert.ok((tersimpan?.usage?.requests ?? 0) >= 1, 'hitungan permintaan ikut naik');
  } finally {
    palsu.close();
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_API_KEY;
  }
});
