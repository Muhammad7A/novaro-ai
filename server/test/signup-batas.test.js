/**
 * Uji pembatas ketat signup — BERKAS TERPISAH dengan sengaja.
 *
 * Pembatas signup hidup di memori proses (per IP 5/15 mnt, per hash surel
 * 3/jam) dan node --test memberi SATU PROSES per berkas — satu-satunya cara
 * mengamati kedua batas dengan hitungan presisi adalah menjalankan urutan
 * hitungannya di proses yang limiter-nya masih segar:
 *
 *   1. email tak sah → 400 (tetap menghabiskan satu slot IP — setiap
 *      permintaan dihitung, termasuk yang bentuknya salah: anti-abuse);
 *   2. surel X ×4 → 200,200,200 lalu 429 — yang ke-4 kena BATAS SUREL
 *      (IP saat itu baru tercatat 4 dari 5, jadi yang menembak bukan IP);
 *   3. surel Y → 200 (slot IP ke-5 masih bebas) lalu Z → 429 — BATAS IP.
 *
 *   npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'nova-uji-signup-batas-'));
process.env.NOVA_DATA_DIR = DATA_DIR;
process.env.PORT = '0';
process.env.NOVA_AI_BACKEND = 'anthropic';
process.env.ANTHROPIC_API_KEY = '';
delete process.env.GOOGLE_CLOUD_PROJECT;
process.env.NOVA_SIGNUP_SECRET = 'rahasia-signup-batas';
process.on('exit', () => rmSync(DATA_DIR, { recursive: true, force: true }));

const app = (await import('../server.js')).default;
const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const BASE = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const minta = (email) =>
  fetch(`${BASE}/api/auth/request-signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });

test('hitungan presisi: batas surel 3/jam menembak lebih dulu, lalu batas IP 5/15 mnt', async () => {
  // Slot IP 1 — bentuk asing ditolak 400 TETAP menghabiskan slot (anti-abuse).
  const takSah = await minta('bukan-surel');
  assert.equal(takSah.status, 400);

  // Slot IP 2-4 — surel X: tiga permintaan pertama lolos.
  for (let i = 0; i < 3; i++) {
    assert.equal((await minta('x@contoh.co')).status, 200, `X ke-${i + 1} masih di bawah batas surel`);
  }
  // Slot IP 5 — X ke-4: IP baru tercatat 4 dari 5, jadi yang menembak di sini
  // adalah BATAS SUREL (3/jam untuk hash surel yang sama).
  assert.equal((await minta('x@contoh.co')).status, 429, 'permintaan ke-4 untuk surel sama dibatasi batas surel');

  // Slot IP 6 — surel Y (BARU, jadi batas surelnya kosong): yang menembak
  // sekarang pasti BATAS IP (5/15 menit sudah habis).
  assert.equal((await minta('y@contoh.co')).status, 429, 'permintaan ke-6 dari IP yang sama dibatasi batas IP');
});
