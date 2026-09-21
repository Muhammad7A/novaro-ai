/**
 * Uji latihan micro-learning (lib/latihan.js) + rute /api/latihan/:no.
 *
 * Yang paling dijaga:
 *   - kunci jawaban dan penjelasan TIDAK PERNAH keluar lewat GET soal;
 *   - penilaian deterministik untuk ketiga tipe (pilihan/hitung/golong);
 *   - "lulus" berarti semua soal benar; jawaban salah tidak menimpa yang
 *     sudah benar dan tindakan kedua tidak mendobel event;
 *   - tantangan AI hanya terbuka setelah kuis dasar lulus, soalnya tersimpan
 *     milik server (kunci tidak ke peramban), dan dinilai server;
 *   - progres latihan selamat dari saveProgress (backward compatible).
 *
 * Sejak self-paced (RESEARCH-DEPENDENCY-REMOVAL.md), seluruh sesi selalu terbuka.
 *
 *   npm test
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'nova-uji-latihan-'));
process.env.NOVA_DATA_DIR = DATA_DIR;
process.env.PORT = '0';
process.env.NOVA_AI_BACKEND = 'anthropic';
process.env.ANTHROPIC_API_KEY = '';
delete process.env.GOOGLE_CLOUD_PROJECT;
process.on('exit', () => rmSync(DATA_DIR, { recursive: true, force: true }));

const { adaLatihan, modulLatihan, periksa, sanitasiLatihanAI, soalPublik, totalSoal } =
  await import('../lib/latihan.js');
const { store } = await import('../lib/store.js');
const app = (await import('../server.js')).default;

const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const BASE = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const CONSENT_VERSION = (await import('../lib/consent.js')).CONSENT_VERSION;

/* ================================================ Soal & pemeriksa murni */

test('latihan hanya untuk tujuh sesi jalur dasar, tiga soal per sesi', () => {
  assert.deepEqual(modulLatihan(), [1, 2, 3, 4, 5, 6, 7]);
  for (const no of modulLatihan()) {
    assert.equal(totalSoal(no), 3);
    assert.ok(adaLatihan(no));
  }
  assert.equal(adaLatihan(8), false, 'pustaka belum punya latihan');
  assert.equal(adaLatihan(99), false);
});

test('soal publik bersih: tanpa kunci dan tanpa penjelasan', () => {
  for (const no of modulLatihan()) {
    for (const s of soalPublik(no)) {
      const teks = JSON.stringify(s);
      assert.equal(teks.includes('"kunci"'), false, 'kunci tidak boleh ikut ke peramban');
      assert.equal(teks.includes('penjelasan'), false);
      assert.ok(s.pertanyaan?.length > 10);
    }
  }
});

test('tipe pilihan: dinilai dari huruf, tidak peduli kapital/spasi', () => {
  const { benar } = periksa(1, 2, ' b ');
  assert.equal(benar, true);
  assert.equal(periksa(1, 2, 'A').benar, false);
});

test('tipe hitung: angka persis; di luar rentang tetap salah', () => {
  assert.equal(periksa(1, 0, '310000').benar, true);
  assert.equal(periksa(1, 0, 'Rp 310.000').benar, true, 'pemisah ribuan ditoleransi');
  assert.equal(periksa(1, 0, 900_000).benar, false, 'omzet bukan laba');
});

test('tipe golong: urutan golongan harus persis', () => {
  assert.equal(periksa(1, 1, [0, 1, 0, 1]).benar, true);
  assert.equal(periksa(1, 1, [1, 0, 1, 0]).benar, false);
  assert.equal(periksa(1, 1, [0, 1, 0]).benar, false, 'kurang baris = salah, bukan error');
});

test('soal/indeks tidak sah ditolak dengan status 400', () => {
  assert.throws(() => periksa(1, 9, 'A'), (e) => e.status === 400);
  assert.throws(() => periksa(8, 0, 'A'), (e) => e.status === 400);
});

test('sanitasi soal AI: sah diterima, rusak 502, kunci di luar A-C ditolak', () => {
  const sah = sanitasiLatihanAI({
    pertanyaan: 'Dengan omzetmu 21 juta dan bahan 12,3 juta, porsi bahanmu berapa persen?',
    pilihan: { A: '58%', B: '23%', C: '80%' },
    kunci: 'a',
    penjelasan: '12,3 jt ÷ 21 jt ≈ 58% — di atas ambang nyaman 55%.',
    konsep: 'porsi-bahan',
  });
  assert.equal(sah.kunci, 'A', 'kunci dinormalisasi ke huruf besar');
  assert.equal(sah.konsep, 'porsi-bahan');

  assert.throws(() => sanitasiLatihanAI({ pertanyaan: 'x', pilihan: {} }), (e) => e.status === 502);
  assert.throws(
    () => sanitasiLatihanAI({
      pertanyaan: 'Soal yang sah panjangnya cukup.',
      pilihan: { A: 'a', B: 'b', C: 'c' },
      kunci: 'D',
      penjelasan: 'penjelasan',
    }),
    (e) => e.status === 502,
    'kunci di luar A-C harus ditolak',
  );
});

/* =============================================================== Rutenya */

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
  assert.equal((await fetch(BASE + '/api/latihan/1')).status, 401);
  assert.equal((await fetch(BASE + '/api/latihan/1', { method: 'POST' })).status, 401);
});

test('modul pustaka tanpa latihan: 404 yang jujur', async () => {
  const { accessCode } = await buatPeserta('Bu Pustaka');
  const res = await minta('/api/latihan/8', { kode: accessCode });
  assert.equal(res.status, 404);
  assert.match((await res.json()).error, /Latihan belum tersedia/);
});

test('alur lulus: salah boleh diulang, benar tersimpan, lulus setelah semua benar', async () => {
  const { accessCode } = await buatPeserta('Bu Lulus');

  const awal = await (await minta('/api/latihan/1', { kode: accessCode })).json();
  assert.equal(awal.soal.length, 3);
  assert.equal(awal.lulus, false);
  assert.equal(JSON.stringify(awal.soal).includes('"kunci"'), false, 'GET tidak boleh membocorkan kunci');

  // Soal 1: salah dulu — tidak menjatuhkan, tersedia untuk dicoba lagi.
  const salah = await (await minta('/api/latihan/1', {
    kode: accessCode, method: 'POST', body: { index: 0, jawaban: 900_000 },
  })).json();
  assert.equal(salah.benar, false);
  assert.match(salah.penjelasan, /310\.000/);
  assert.equal(salah.status.lulus, false);

  const benar = await (await minta('/api/latihan/1', {
    kode: accessCode, method: 'POST', body: { index: 0, jawaban: 310_000 },
  })).json();
  assert.equal(benar.benar, true);
  assert.equal(benar.status.lulus, false, '1 dari 3 belum lulus');

  // Soal 2 (golong) dan 3 (pilihan) — setelah ini lulus.
  await minta('/api/latihan/1', { kode: accessCode, method: 'POST', body: { index: 1, jawaban: [0, 1, 0, 1] } });
  const akhir = await (await minta('/api/latihan/1', {
    kode: accessCode, method: 'POST', body: { index: 2, jawaban: 'b' },
  })).json();
  assert.equal(akhir.status.lulus, true, 'semua soal benar → lulus');
  assert.equal(akhir.status.baruLulus, true);

  const progress = (await (await minta('/api/me', { kode: accessCode })).json()).user.progress;
  assert.equal(progress.latihan[1].lulusPada ? true : false, true);
  assert.equal(progress.done?.[1], undefined, 'kuis tidak mengubah progress.done');

  // Event riset: tiap percobaan tercatat, benar maupun salah.
  const tersimpan = await store.findUserById((await store.findByAccessCode(accessCode)).id);
  const jawabEvents = tersimpan.events.filter((e) => e.type === 'latihan_dijawab');
  assert.equal(jawabEvents.length, 4, 'tiga percobaan salah/benar + satu benar terakhir');
  assert.equal(jawabEvents.filter((e) => e.meta?.benar === true).length, 3);
});

test('backward compatibility: saveProgress berikutnya tidak menghapus latihan', async () => {
  const { accessCode } = await buatPeserta('Bu Kompat');
  await minta('/api/latihan/1', { kode: accessCode, method: 'POST', body: { index: 0, jawaban: 310_000 } });
  await minta('/api/progress', { kode: accessCode, method: 'PUT', body: { done: { 1: true } } });

  const progress = (await (await minta('/api/me', { kode: accessCode })).json()).user.progress;
  assert.equal(progress.done[1], true);
  assert.ok(progress.latihan?.[1]?.jawaban?.[0]?.benar, 'latihan tetap ada setelah simpan progres');
});

test('tantangan AI terkunci sampai kuis dasar lulus', async () => {
  const { accessCode } = await buatPeserta('Bu Terkunci');
  const res = await minta('/api/latihan/2/ai', { kode: accessCode, method: 'POST' });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Selesaikan kuis dasarnya dulu/);
});

test('tantangan AI: dibuat dari materi + angka peserta, kunci tidak ke peramban, dinilai server', async () => {
  const { accessCode } = await buatPeserta('Bu AI');
  // Luluskan kuis dasar sesi 1 (jawaban benar untuk ketiga soal).
  await minta('/api/latihan/1', { kode: accessCode, method: 'POST', body: { index: 0, jawaban: 310_000 } });
  await minta('/api/latihan/1', { kode: accessCode, method: 'POST', body: { index: 1, jawaban: [0, 1, 0, 1] } });
  await minta('/api/latihan/1', { kode: accessCode, method: 'POST', body: { index: 2, jawaban: 'B' } });

  // Layanan Anthropic tiruan (pola checkup): mengembalikan soal sah.
  const { createServer } = await import('node:http');
  let diminta = null;
  const palsu = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      diminta = JSON.parse(body || '{}');
      const usage = { input_tokens: 300, output_tokens: 120 };
      const json = JSON.stringify({
        pertanyaan: 'Omzetmu setara 21 juta dan prive 1,2 juta — berapa persen laba yang tersisa setelah prive?',
        pilihan: { A: '5,7%', B: '23%', C: '95%' },
        kunci: 'A',
        penjelasan: 'Prive bukan biaya, tapi mengurangi kas: 1,2 jt ÷ 21 jt ≈ 5,7% dari omzetmu.',
        konsep: 'prive',
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
    const res = await minta('/api/latihan/1/ai', { kode: accessCode, method: 'POST' });
    assert.equal(res.status, 200);
    const { soal } = await res.json();
    assert.match(soal.pertanyaan, /prive/i);
    assert.equal(JSON.stringify(soal).includes('"kunci"'), false, 'kunci soal AI tidak ke peramban');

    // Konteks yang dikirim AI: materi modul DAN angka peserta.
    const sistem = String(diminta?.system ?? '');
    assert.match(sistem, /MATERI MODUL YANG SEDANG DIPELAJARI/);
    assert.match(sistem, /ANGKA USAHA PESERTA/);

    // Jawab benar (A) — sekali jawab, hasil terkunci.
    const jawab = await (await minta('/api/latihan/1/ai/jawab', {
      kode: accessCode, method: 'POST', body: { jawaban: 'A' },
    })).json();
    assert.equal(jawab.benar, true);
    assert.match(jawab.penjelasan, /prive/i);

    const ulang = await (await minta('/api/latihan/1/ai/jawab', {
      kode: accessCode, method: 'POST', body: { jawaban: 'C' },
    })).json();
    assert.equal(ulang.benar, true, 'jawaban tidak bisa diubah setelah terkunci');

    // Pemakaian token ikut tercatat ke anggaran peserta.
    const tersimpan = await store.findUserById((await store.findByAccessCode(accessCode)).id);
    assert.ok(tersimpan.events.some((e) => e.type === 'latihan_ai_dibuat'));
    assert.ok((tersimpan.usage?.requests ?? 0) >= 1);
  } finally {
    palsu.close();
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_API_KEY;
  }
});
