/**
 * Uji kontrak lib/batas-stream.js — batas waktu aplikasi pembacaan stream AI.
 *
 * Murni: tanpa jaringan, tanpa penyedia, tanpa berkas data. Yang dijaga:
 * satu angka batas untuk semua permukaan, env menimpa untuk uji, sinyal rute
 * diteruskan tanpa dianggap kehabisan waktu, dan janji batas menolak dengan
 * galat bertipe yang siap dipetakan.
 *
 *   npm test
 */
import assert from 'node:assert/strict';
import test from 'node:test';

const { batasStreamMs, tandaBatasStream } = await import('../lib/batas-stream.js');

/** Memasang env sementara, memulihkan apa pun yang terjadi. */
async function denganEnv(nilai, fn) {
  const asli = {};
  for (const [k, v] of Object.entries(nilai)) {
    asli[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(asli)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const tunggu = (ms) => new Promise((r) => setTimeout(r, ms));

test('batasStreamMs: bawaan 60 detik; env sah menimpa; env rusak kembali ke bawaan', async () => {
  await denganEnv({ NOVA_AI_STREAM_TIMEOUT_MS: undefined }, () => {
    assert.equal(batasStreamMs(), 60_000);
  });
  await denganEnv({ NOVA_AI_STREAM_TIMEOUT_MS: '250' }, () => {
    assert.equal(batasStreamMs(), 250);
  });
  await denganEnv({ NOVA_AI_STREAM_TIMEOUT_MS: 'bukan-angka' }, () => {
    assert.equal(batasStreamMs(), 60_000, 'nilai rusak tidak boleh menjadi 0 atau NaN');
  });
  await denganEnv({ NOVA_AI_STREAM_TIMEOUT_MS: '-5' }, () => {
    assert.equal(batasStreamMs(), 60_000, 'nilai negatif bukan batas yang sah');
  });
});

test('batas tercapai: sinyal gabungan batal, habis() benar, janjiBatas menolak galat bertipe', async () => {
  await denganEnv({ NOVA_AI_STREAM_TIMEOUT_MS: '60' }, async () => {
    const t = tandaBatasStream();
    assert.equal(t.sinyal.aborted, false, 'sebelum batas, sinyal masih hidup');
    assert.equal(t.habis(), false);
    await assert.rejects(
      t.janjiBatas,
      (err) => err.code === 'AI_STREAM_TIMEOUT' && err.status === 502,
      'janji batas harus menolak dengan galat bertipe, bukan Error polos',
    );
    assert.equal(t.sinyal.aborted, true, 'batas tercapai ikut memutus sambungan penyedia');
    assert.equal(t.habis(), true);
  });
});

test('selesai() sebelum batas: tidak pernah batal dan tidak pernah dianggap habis', async () => {
  await denganEnv({ NOVA_AI_STREAM_TIMEOUT_MS: '60' }, async () => {
    const t = tandaBatasStream();
    t.selesai();
    await tunggu(140);
    assert.equal(t.sinyal.aborted, false);
    assert.equal(t.habis(), false, 'pembacaan yang selesai lebih dulu tidak boleh terkena pewaktu sisa');
  });
});

test('sinyal rute diteruskan: batal dari luar membatalkan sinyal gabungan TANPA dianggap habis waktu', async () => {
  const luar = new AbortController();
  const t = tandaBatasStream(luar.signal);
  luar.abort(); // peserta menutup aplikasi
  assert.equal(t.sinyal.aborted, true, 'pembatalan rute harus sampai ke penyedia');
  assert.equal(t.habis(), false, 'peserta pergi bukan kehabisan waktu — dua galat yang berbeda nasibnya');
  t.selesai();
});
