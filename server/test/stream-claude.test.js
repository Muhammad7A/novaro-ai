/**
 * Uji batas & keutuhan stream Anthropic lewat rute /api/chat.
 *
 * Satu penyedia SSE palsu untuk seluruh berkas (klien Anthropic di-cache per
 * backend — jebakan yang didokumentasikan rekomendasi.test.js), perilakunya
 * diganti per uji. Tiga keadaan yang diuji DI TINGKAT RUTE, lengkap dengan
 * kebenaran disk:
 *   - sehat        → giliran tersimpan utuh, usage tercatat;
 *   - terpotong    → sambungan hancur setelah byte pertama: gagal bertipe,
 *                    tidak ada yang tersimpan, tidak ada usage;
 *   - menggantung  → dibuka lalu diam sampai batas waktu aplikasi (env
 *                    NOVA_AI_STREAM_TIMEOUT_MS dipendekkan khusus uji ini):
 *                    gagal bertipe, tidak ada yang tersimpan.
 *
 *   npm test
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'nova-uji-stream-'));
process.env.NOVA_DATA_DIR = DATA_DIR;
process.env.PORT = '0';
process.env.NOVA_AI_BACKEND = 'anthropic';
process.env.ANTHROPIC_API_KEY = '';
delete process.env.GOOGLE_CLOUD_PROJECT;
process.on('exit', () => rmSync(DATA_DIR, { recursive: true, force: true }));

const { store } = await import('../lib/store.js');
const { CONSENT_VERSION } = await import('../lib/consent.js');
const app = (await import('../server.js')).default;

const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const BASE = `http://127.0.0.1:${server.address().port}`;

/* ------------------------------------------------------- Penyedia palsu */

let mode = 'sehat';
const soket = new Set();

const penyedia = createServer((req, res) => {
  soket.add(req.socket);
  req.on('data', () => {});
  req.on('end', () => {
    const usage = { input_tokens: 100, output_tokens: 20 };
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const w = (t, d) => res.write(`event: ${t}\ndata: ${JSON.stringify(d)}\n\n`);
    w('message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5', content: [], stop_reason: null, usage } });
    w('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });

    if (mode === 'sehat') {
      w('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Jawaban yang utuh sampai akhir.' } });
      w('content_block_stop', { type: 'content_block_stop', index: 0 });
      w('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage });
      w('message_stop', { type: 'message_stop' });
      res.end();
    } else if (mode === 'terpotong') {
      /*
       * Aliran ditutup RAPI tanpa message_delta/message_stop. Ditutup rapi,
       * bukan dihancurkan, supaya seluruh byte pasti sampai dan ter-parse —
       * kegagalan berikutnya dengan demikian PASTI "putus setelah byte
       * pertama", bukan galat nyambung yang belum jelas jenisnya (kasus
       * destroy yang byte-nya belum tentu tiba sudah diuji kegagalan.test.js).
       */
      w('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Jawaban yang berhenti di tengah' } });
      w('content_block_stop', { type: 'content_block_stop', index: 0 });
      res.end();
    } else {
      // menggantung: terbuka lalu diam — hanya batas waktu aplikasi yang bisa menghentikannya.
      w('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Jawaban yang menggantung' } });
    }
  });
});
await new Promise((r) => penyedia.listen(0, r));
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${penyedia.address().port}`;
process.env.ANTHROPIC_API_KEY = 'sk-ant-uji';

test.after(() => {
  // Menggantungnya aliran uji bisa meninggalkan soket terbuka di kedua sisi;
  // tanpa diputus, proses uji tidak pernah keluar.
  for (const s of soket) s.destroy();
  penyedia.closeAllConnections?.();
  penyedia.close();
  server.closeAllConnections?.();
  server.close();
  delete process.env.ANTHROPIC_BASE_URL;
  delete process.env.ANTHROPIC_API_KEY;
});

/* --------------------------------------------------------------- Peserta */

const { user, accessCode } = await store.createUser({ name: 'Bu Stream', business: 'Warung Stream', batch: 'B1' });
await store.saveConsent(user.id, CONSENT_VERSION);

const minta = (opts = {}) =>
  fetch(BASE + '/api/chat', {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessCode}`, ...(opts.headers ?? {}) },
  });

const kirimPesan = () => minta({ method: 'POST', body: JSON.stringify({ message: 'Bagaimana kondisi usaha saya?' }) });

/** Urai tubuh SSE menjadi daftar nama event. */
const namaAcara = async (res) => {
  const teks = await res.text();
  return [...teks.matchAll(/^event: (.+)$/gm)].map((m) => m[1]);
};

/** Potret disk untuk uji kebenaran penyimpanan: isi chat, permintaan, total token. */
const potretDisk = async () => {
  const u = await store.findUserById(user.id);
  return {
    chat: JSON.stringify(u.chat ?? []),
    requests: u.usage?.requests ?? 0,
    tokenTotal: (u.tokenLog ?? []).reduce((n, e) => n + (Number(e.token) || 0), 0),
  };
};

/* ------------------------------------------------------------------ Uji */

test('stream sehat: giliran tersimpan utuh dan usage tercatat', async () => {
  mode = 'sehat';
  const res = await kirimPesan();
  assert.equal(res.status, 200);

  const acara = await namaAcara(res);
  assert.ok(acara.includes('delta'), 'teks dialirkan ke peserta');
  assert.ok(acara.includes('done'), 'stream tuntas berakhir dengan done');

  const u = await store.findUserById(user.id);
  assert.equal(u.chat.length, 2, 'satu giliran: pertanyaan + jawaban');
  assert.match(u.chat[1].content, /utuh sampai akhir/);
  assert.ok(u.usage.requests >= 1, 'pemakaian tercatat');
  assert.ok((u.tokenLog ?? []).some((e) => e.token > 0), 'token terhitung di jejak harian');
});

test('stream putus di tengah: gagal bertipe, tidak ada yang tersimpan, tidak ada usage', async () => {
  mode = 'terpotong';
  const sebelum = await potretDisk();

  const res = await kirimPesan();
  assert.equal(res.status, 200, 'SSE: kepala sudah terkirim sebelum penyedia mati');
  const teks = await res.text();
  assert.match(teks, /event: error/);
  assert.match(teks, /terputus sebelum jawabannya selesai/, 'galat bertipe AI_STREAM_TERPOTONG yang sampai ke peserta');
  assert.ok(!/event: done/.test(teks), 'done setelah aliran patah adalah sukses palsu');

  const sesudah = await potretDisk();
  assert.equal(sesudah.chat, sebelum.chat, 'tidak ada giliran setengah jadi yang tersimpan');
  assert.equal(sesudah.requests, sebelum.requests, 'permintaan tidak tercatat untuk jawaban yang tidak pernah tuntas');
  assert.equal(sesudah.tokenTotal, sebelum.tokenTotal, 'usage nol dari stream mati tidak boleh jadi catatan tagihan');
});

test('stream menggantung: kehabisan batas waktu aplikasi → gagal bertipe, tidak ada yang tersimpan', async () => {
  mode = 'menggantung';
  const asli = process.env.NOVA_AI_STREAM_TIMEOUT_MS;
  process.env.NOVA_AI_STREAM_TIMEOUT_MS = '250'; // dipendekkan khusus uji ini
  const sebelum = await potretDisk();

  try {
    const res = await kirimPesan();
    const teks = await res.text();
    assert.match(teks, /event: error/);
    assert.match(teks, /terlalu lama menjawab/, 'galat bertipe AI_STREAM_TIMEOUT yang sampai ke peserta');
    assert.ok(!/event: done/.test(teks));

    const sesudah = await potretDisk();
    assert.equal(sesudah.chat, sebelum.chat);
    assert.equal(sesudah.requests, sebelum.requests);
    assert.equal(sesudah.tokenTotal, sebelum.tokenTotal);
  } finally {
    if (asli === undefined) delete process.env.NOVA_AI_STREAM_TIMEOUT_MS;
    else process.env.NOVA_AI_STREAM_TIMEOUT_MS = asli;
  }
});
