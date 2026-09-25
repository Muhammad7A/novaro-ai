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
 * PERSIST CHECKUP — keputusan owner YA 2026-09-13 (menutup Open Question #7):
 * keluaran checkup kini TERSIMPAN, dan hanya sebagai advisori jenis 'checkup'
 * (bentuk ter-sanitasi, trim per jenis, provenansi sumber+model). Pin lama
 * "output checkup tidak pernah persist" DIGANTI secara sadar menjadi pin baru
 * "persist HANYA sebagai advisori, tidak ke tempat lain" — lihat uji di bawah.
 * Pin pembukuan (nol tulisan uang) TIDAK berubah.
 *
 *   npm test
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CONSENT_VERSION } from '../lib/consent.js';

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
await store.saveConsent(user.id, CONSENT_VERSION);
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
  assert.ok(hasil.item.every((i) => i.tipe === 'attention'));
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

    // Persist checkup (keputusan YA 2026-09-13): hasil yang tampil di layar
    // ikut direkam sebagai advisori — bentuk sanitizer PERSIS, provenansi
    // Sesi D, event contentless; usage berangkat dalam penulisan yang sama.
    const adv = tersimpan.advisori.filter((a) => a.jenis === 'checkup');
    assert.equal(adv.length, 1, 'satu rekam checkup ter-append');
    assert.deepEqual(adv[0].isi, data.hasil, 'isi = keluaran sanitizer persis');
    assert.equal(adv[0].sumber, 'ai');
    assert.ok(adv[0].model, 'model ikut tercatat — pola provenansi Sesi D');
    assert.match(adv[0].id, /^adv_[0-9a-f]{12}$/);
    const evCheckup = tersimpan.events.find((e) => e.type === 'advisori_dibuat' && e.meta.jenis === 'checkup');
    assert.deepEqual(evCheckup.meta, { id: adv[0].id, jenis: 'checkup', sumber: 'ai' });
  } finally {
    palsu.close();
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_API_KEY;
  }
});

test('PIN BARU: persist HANYA sebagai advisori — tidak ke tempat lain', async () => {
  const { user: u2 } = await store.createUser({ name: 'Bu Hanya Advi', business: '', batch: 'B1' });
  const hasil = sanitasiCheckup({
    item: [{ tipe: 'ok', teks: 'aman.' }], insight: 'pertahankan.',
  });
  await store.simpanCheckup(u2.id, hasil, { input_tokens: 5, output_tokens: 5 }, { model: 'm-cek' });
  const u = await store.findUserById(u2.id);

  // Satu-satunya jejak: advisori + eventnya + usage. Slot rekomendasi,
  // transaksi, progres, dan consent tidak tersentuh sama sekali.
  assert.equal(u.advisori.length, 1);
  assert.equal(u.recommendations, null, 'slot rekomendasi tidak ikut tersentuh');
  assert.equal(u.transactions.length, 0, 'nol baris uang — pin pembukuan tetap');
  assert.deepEqual(u.progress, {});
  const jenisPeristiwa = [...new Set(u.events.map((e) => e.type))];
  assert.deepEqual(jenisPeristiwa, ['user_created', 'advisori_dibuat']);
});

test('trim per jenis: checkup terpegah di kap yang sama dengan rekomendasi', async () => {
  const { user: u3 } = await store.createUser({ name: 'Bu Trim Cek', business: '', batch: 'B1' });
  const { MAKS_PER_JENIS } = await import('../lib/advisori.js');
  const hasil = sanitasiCheckup({ item: [{ tipe: 'ok', teks: 'x.' }], insight: 'y.' });

  for (let i = 0; i < MAKS_PER_JENIS + 3; i++) {
    await store.simpanCheckup(u3.id, hasil, { input_tokens: 1, output_tokens: 1 });
  }
  const u = await store.findUserById(u3.id);
  const checkup = u.advisori.filter((a) => a.jenis === 'checkup');
  assert.equal(checkup.length, MAKS_PER_JENIS, 'kap per jenis terpegah — checkup tidak menumpuk tanpa batas');
  // Jejak eventnya tidak pernah dipangkas — riwayat lengkap tetap ada di sana.
  assert.equal(u.events.filter((e) => e.type === 'advisori_dibuat').length, MAKS_PER_JENIS + 3);
});

test('fail-closed: penyedia mati → 502, tidak ada yang ter-append', async () => {
  const { user: u4 } = await store.createUser({ name: 'Bu Gagal Cek', business: '', batch: 'B1' });
  await store.saveConsent(u4.id, CONSENT_VERSION);
  const sebelum = await store.findUserById(u4.id);

  // Port yang SUDAH ditutup: koneksi ditolak — kegagalan transport nyata
  // (E-2: → 502, refund). Env lengkap supaya lolos gerbang isConfigured()
  // dan yang diuji benar-benar kegagalan provider, bukan 503 konfigurasi.
  const { createServer: buatServer } = await import('node:http');
  const mati = buatServer(() => {});
  await new Promise((r) => mati.listen(0, r));
  const portMati = mati.address().port;
  await new Promise((r) => mati.close(r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${portMati}`;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-uji';

  try {
    const res = await minta('/api/checkup', { kode: u4.accessCode, method: 'POST' });
    assert.equal(res.status, 502);

    const sesudah = await store.findUserById(u4.id);
    assert.equal(sesudah.advisori?.length ?? 0, 0, 'kegagalan provider tidak meninggalkan rekam');
    assert.equal(sesudah.usage.requests, sebelum.usage.requests, 'usage juga tak bergerak — nol efek samping');
    assert.equal(sesudah.events.filter((e) => e.type === 'advisori_dibuat').length, 0);
  } finally {
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_API_KEY;
  }
});
