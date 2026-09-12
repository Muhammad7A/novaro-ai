/**
 * Uji pembacaan stream Gemini (bacaStream) — kontrak tuntas-atau-gagal.
 *
 * Menirukan kredensial Vertex untuk menguji jalur jaringannya mustahil
 * dilakukan rapi; untungnya kontraknya tidak butuh jaringan: stream palsu
 * cukup async-iterable biasa (alasan bacaStream diekspor — pola keUsage).
 * Yang diuji: stream sehat lolos utuh; stream yang berakhir tanpa
 * finishReason gagal bertipe; stream yang menggantung gagal saat batas
 * waktu aplikasi tercapai.
 *
 *   npm test
 */
import assert from 'node:assert/strict';
import test from 'node:test';

const { bacaStream } = await import('../lib/gemini.js');

const alir = (potongan) =>
  (async function* () {
    for (const p of potongan) yield p;
  })();

test('stream sehat: teks utuh, usage dari potongan terakhir, alasan selesai terbaca, onText per potongan', async () => {
  const terkirim = [];
  const hasil = await bacaStream(
    async () =>
      alir([
        { text: 'Ha' },
        { text: 'lo', usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 } },
        {
          candidates: [{ finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 7, thoughtsTokenCount: 1 },
        },
      ]),
    { onText: (t) => terkirim.push(t) },
  );
  assert.equal(hasil.teks, 'Halo');
  assert.equal(hasil.alasan, 'STOP');
  assert.equal(hasil.usage.candidatesTokenCount, 7, 'usage adalah potongan terakhir yang membawanya');
  assert.deepEqual(terkirim, ['Ha', 'lo'], 'setiap potongan teks dialirkan sekali');
});

test('stream berakhir tanpa alasan selesai → galat bertipe AI_STREAM_TERPOTONG, bukan sukses', async () => {
  await assert.rejects(
    bacaStream(async () => alir([{ text: 'setengah' }])),
    (err) => err.code === 'AI_STREAM_TERPOTONG' && err.status === 502,
  );
});

test('stream kosong sama sekali → terpotong, bukan jawaban hampa yang tampak sah', async () => {
  await assert.rejects(bacaStream(async () => alir([])), (err) => err.code === 'AI_STREAM_TERPOTONG');
});

test('stream menggantung tanpa ujung → galat AI_STREAM_TIMEOUT saat batas aplikasi tercapai', async () => {
  const asli = process.env.NOVA_AI_STREAM_TIMEOUT_MS;
  process.env.NOVA_AI_STREAM_TIMEOUT_MS = '120';
  try {
    // Tidak pernah menghasilkan potongan dan tidak pernah berakhir — hanya
    // batas waktu aplikasi yang bisa menghentikannya.
    const takBerujung = (async function* () {
      await new Promise(() => {});
      yield '';
    })();
    await assert.rejects(
      bacaStream(async () => takBerujung),
      (err) => err.code === 'AI_STREAM_TIMEOUT' && err.status === 502,
    );
  } finally {
    if (asli === undefined) delete process.env.NOVA_AI_STREAM_TIMEOUT_MS;
    else process.env.NOVA_AI_STREAM_TIMEOUT_MS = asli;
  }
});

test('sinyal rute dibatalkan: kegagalan diteruskan apa adanya, bukan dianggap potong/habis', async () => {
  const luar = new AbortController();
  const batal = (async function* () {
    yield { text: 'sebagian' };
    luar.abort();
    throw new Error('dibatalkan peserta');
  })();
  await assert.rejects(
    bacaStream(async () => batal, { signal: luar.signal }),
    (err) => /dibatalkan peserta/.test(err.message) && !err.code,
    'pembatalan rute adalah urusan rute — bukan galat stream bertipe',
  );
});
