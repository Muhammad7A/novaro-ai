/**
 * Uji jalur Gemini di Vertex AI.
 *
 * Yang diuji di sini bukan apakah modelnya menjawab dengan baik — itu tidak
 * bisa diuji tanpa memanggil layanan berbayar. Yang diuji adalah SAMBUNGANNYA:
 * pemilihan jalur, penerjemahan bentuk data, dan pemetaan galat. Ketiganya
 * punya sifat yang sama — bila salah, tidak ada yang meledak. Server tetap
 * menyala, peserta tetap dilayani, dan yang rusak hanya hal-hal yang baru
 * terlihat berminggu-minggu kemudian: jatah token yang tidak pernah tercapai,
 * atau tagihan ke penyedia yang salah.
 *
 *   npm test
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { hitungToken } from '../lib/anggaran.js';

/** Menjalankan fn dengan env sementara, lalu memulihkannya apa pun yang terjadi. */
function denganEnv(nilai, fn) {
  const asli = {};
  for (const [k, v] of Object.entries(nilai)) {
    asli[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(asli)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('NOVA_AI_BACKEND yang salah ketik ditolak keras, tidak mundur diam-diam', async () => {
  const { backendAI } = await import(`../lib/backend.js?u=${Math.random()}`);

  denganEnv({ NOVA_AI_BACKEND: 'gemeni', GOOGLE_CLOUD_PROJECT: 'p' }, () => {
    /*
     * Kalau saklar yang salah ketik mundur ke nilai bawaan, server menyala dan
     * tampak sehat sambil menagih ke penyedia yang salah — di penelitian ini,
     * ke penyedia yang anggarannya justru sudah habis.
     */
    assert.throws(() => backendAI(), /tidak dikenali/i);
  });

  denganEnv({ NOVA_AI_BACKEND: '  GEMINI  ', GOOGLE_CLOUD_PROJECT: 'p' }, () => {
    assert.equal(backendAI(), 'gemini', 'spasi dan huruf besar harus dimaafkan');
  });

  denganEnv({ NOVA_AI_BACKEND: undefined, GOOGLE_CLOUD_PROJECT: 'p' }, () => {
    assert.equal(backendAI(), 'vertex', 'tanpa saklar, perilaku lama dipertahankan');
  });

  denganEnv({ NOVA_AI_BACKEND: undefined, GOOGLE_CLOUD_PROJECT: undefined }, () => {
    assert.equal(backendAI(), 'anthropic');
  });
});

test('token penalaran Gemini ikut dihitung sebagai keluaran', async () => {
  const { keUsage } = await import(`../lib/gemini.js?u=${Math.random()}`);

  /*
   * Gemini melaporkan token penalaran di medan TERPISAH (`thoughtsTokenCount`)
   * meski menagihnya seperti keluaran biasa. Mengabaikannya membuat jatah
   * peserta terbaca jauh lebih kecil daripada yang sebenarnya dipakai — batas
   * harian tidak pernah tercapai, dan tidak ada satu pun galat yang muncul.
   */
  const usage = keUsage({
    promptTokenCount: 1000,
    candidatesTokenCount: 400,
    thoughtsTokenCount: 600,
    cachedContentTokenCount: 200,
  });

  assert.equal(usage.input_tokens, 1000);
  assert.equal(usage.output_tokens, 1000, 'keluaran = candidates + thoughts');
  assert.equal(usage.cache_read_input_tokens, 200);

  // Dan hasilnya harus benar-benar terbaca oleh penghitung anggaran.
  assert.ok(hitungToken(usage) > hitungToken({ ...usage, output_tokens: 400 }));

  // usageMetadata yang hilang sama sekali tidak boleh melempar galat.
  assert.deepEqual(keUsage(undefined), {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  });
});

test('galat Gemini diterjemahkan ke sebab yang bisa ditindaklanjuti', async () => {
  const { ApiError } = await import('@google/genai');
  const { describeError } = await import(`../lib/gemini.js?u=${Math.random()}`);

  // Kredensial: dilempar google-auth-library sebagai Error biasa tanpa status.
  const kredensial = describeError(new Error('Could not load the default credentials.'));
  assert.equal(kredensial.status, 503);
  assert.match(kredensial.message, /kredensial Google Cloud/i);
  assert.doesNotMatch(kredensial.message, /tak terduga/i);

  // IAM / API belum dinyalakan.
  const ditolak = describeError(new ApiError({ message: 'denied', status: 403 }));
  assert.equal(ditolak.status, 503);
  assert.match(ditolak.message, /aiplatform\.user/);

  // Model atau region salah — sebutkan keduanya, karena itulah dua tersangkanya.
  const takAda = denganEnv({ CLOUD_ML_REGION: 'asia-southeast2' }, () =>
    describeError(new ApiError({ message: 'not found', status: 404 })),
  );
  assert.equal(takAda.status, 503);
  assert.match(takAda.message, /asia-southeast2/);

  const penuh = describeError(new ApiError({ message: 'quota', status: 429 }));
  assert.equal(penuh.status, 429);
});
