/**
 * Uji untuk mekanisme umpan balik jawaban AI (POST /api/feedback).
 *
 * Tanpa penanda mana jawaban yang dianggap keliru oleh peserta, data
 * `chat_turn` hanya menunjukkan volume pertanyaan, bukan apakah jawabannya
 * layak dipakai untuk mengurus buku kas sungguhan. Rute ini menutup lubang
 * itu, dan uji di bawah menjaga tiga hal: rute tertutup tanpa autentikasi,
 * rating di luar up/down ditolak, dan mencatat umpan balik tidak boleh
 * menyentuh data peserta yang lain.
 *
 *   npm test -- test/feedback.test.js
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'nova-feedback-'));
process.env.NOVA_DATA_DIR = DATA_DIR;
process.env.NODE_ENV = 'test';
process.env.PORT = '0';
process.on('exit', () => rmSync(DATA_DIR, { recursive: true, force: true }));

const { store } = await import('../lib/store.js');
const { CONSENT_VERSION } = await import('../lib/consent.js');
const app = (await import('../server.js')).default;

const server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const BASE = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const { user, accessCode } = await store.createUser({ name: 'Bu Sari', business: 'Warung Bu Sari' });

// Setujui dulu agar rute penulisan terbuka
await store.saveConsent(user.id, CONSENT_VERSION);

const minta = (jalur, { kode, ...opts } = {}) =>
  fetch(BASE + jalur, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(kode ? { Authorization: `Bearer ${kode}` } : {}),
      ...(opts.headers ?? {}),
    },
  });

test('POST /api/feedback menolak tanpa autentikasi', async () => {
  const res = await minta('/api/feedback', {
    method: 'POST',
    body: JSON.stringify({ rating: 'down', alasan: 'salah hitung' }),
  });
  assert.equal(res.status, 401);
});

test('POST /api/feedback menolak rating yang tidak dikenal', async () => {
  const res = await minta('/api/feedback', {
    kode: accessCode,
    method: 'POST',
    body: JSON.stringify({ rating: 'maybe' }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error || '', /rating/i);
});

test('POST /api/feedback menerima thumbs-down dan mencatat event', async () => {
  const res = await minta('/api/feedback', {
    kode: accessCode,
    method: 'POST',
    body: JSON.stringify({
      rating: 'down',
      alasan: 'Angka laba tidak sesuai buku kas',
      chatIndex: 3,
    }),
  });
  assert.equal(res.status, 201, 'harus menerima feedback');

  const events = await store.getEvents(user.id);
  const fb = events.filter((e) => e.type === 'ai_feedback');
  assert.equal(fb.length, 1, 'harus ada tepat satu event ai_feedback');
  assert.equal(fb[0].meta.rating, 'down');
  assert.equal(fb[0].meta.alasan, 'Angka laba tidak sesuai buku kas');
  assert.equal(fb[0].meta.chatIndex, 3);
});

test('POST /api/feedback menerima thumbs-up tanpa alasan', async () => {
  const res = await minta('/api/feedback', {
    kode: accessCode,
    method: 'POST',
    body: JSON.stringify({ rating: 'up' }),
  });
  assert.equal(res.status, 201);

  const events = await store.getEvents(user.id);
  const ups = events.filter((e) => e.type === 'ai_feedback' && e.meta.rating === 'up');
  assert.ok(ups.length >= 1);
});

test('feedback tidak boleh menimpa data lain', async () => {
  const before = await store.getChat(user.id);
  await minta('/api/feedback', {
    kode: accessCode,
    method: 'POST',
    body: JSON.stringify({ rating: 'down', alasan: 'test' }),
  });
  const after = await store.getChat(user.id);
  assert.deepEqual(after, before, 'chat history tidak boleh berubah');
});
