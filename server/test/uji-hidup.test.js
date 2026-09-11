/**
 * Uji uji-hidup — fungsi-fungsi murni yang menopang bukti live.
 *
 * Yang diuji di sini BUKAN panggilan AI-nya — itu hanya bisa dibuktikan oleh
 * eksekusi nyata terhadap layanan terdeploy (artefaknya ada di test_reports/).
 * Yang diuji adalah sambungan yang bila salah TIDAK meledak melainkan
 * membocorkan atau membatalkan bukti: log deploy yang salah urai, env
 * rahasia yang ikut terekam, dan perkiraan biaya yang diam-diam jadi nol.
 *
 *   npm test
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { parseDeployLog, perkiraanBiaya, potong, saringEnv } from '../scripts/uji-hidup.js';

test('import uji-hidup tidak menjalankan apa pun (uji tetap tanpa jaringan)', () => {
  // Sengaja kosong: keberhasilan impor sendiri sudah buktinya — modul ini
  // mengeksekusi rantai uji hidup hanya bila dijalankan langsung dari CLI.
  assert.equal(typeof parseDeployLog, 'function');
});

test('parseDeployLog menemukan URL dan revisi di antara baris progres gcloud', () => {
  const log = [
    'Deploying to Cloud Run...',
    '  Creating revision... Done.',
    'Service [novaexplorer] revision [novaexplorer-00097-2vt] has been deployed',
    'https://novaexplorer-532597100979.asia-southeast2.run.app',
    'Some trailing notice line',
  ].join('\n');
  const hasil = parseDeployLog(log);
  assert.equal(hasil.baseUrl, 'https://novaexplorer-532597100979.asia-southeast2.run.app');
  assert.equal(hasil.revision, 'novaexplorer-00097-2vt');
});

test('parseDeployLog mengembalikan null untuk log yang tidak berisi keduanya', () => {
  const hasil = parseDeployLog('build sukses, tanpa baris deploy\n');
  assert.equal(hasil.baseUrl, null);
  assert.equal(hasil.revision, null);
});

test('saringEnv hanya merekam nilai kunci yang aman; rahasia jadi nama saja', () => {
  const { bernilai, hanyaNama } = saringEnv([
    { name: 'CLOUD_ML_REGION', value: 'us-central1' },
    { name: 'GEMINI_MODEL', value: 'gemini-2.5-flash' },
    { name: 'NODE_ENV', value: 'production' },
    { name: 'DATABASE_URL', value: 'postgresql://rahasia' },
    { name: 'VALIDASI_KODE', value: 'NILAI-YANG-TIDAK-BOLEH-TEREKAM' },
    { name: 'ANTHROPIC_API_KEY', valueFrom: { secretKeyRef: { name: 'anthropic-api-key', key: 'latest' } } },
  ]);

  assert.deepEqual(bernilai, {
    CLOUD_ML_REGION: 'us-central1',
    GEMINI_MODEL: 'gemini-2.5-flash',
    NODE_ENV: 'production',
  });
  // Nilainya TIDAK BOLEH ikut di mana pun — termasuk daftar nama.
  const teks = JSON.stringify({ bernilai, hanyaNama });
  assert.ok(!teks.includes('rahasia'), 'nilai DATABASE_URL bocor');
  assert.ok(!teks.includes('NILAI-YANG-TIDAK-BOLEH-TEREKAM'), 'nilai kode validasi bocor');

  const db = hanyaNama.find((e) => e.nama === 'DATABASE_URL');
  assert.ok(db && db.secret === false);
  const kunci = hanyaNama.find((e) => e.nama === 'ANTHROPIC_API_KEY');
  assert.ok(kunci && kunci.secret === true);
});

test('perkiraanBiaya gemini: tarif 0.30/2.50 per juta, cache dibaca setara input (batas atas)', () => {
  const h = perkiraanBiaya('gemini', { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 });
  // 0.30 + 2.50 + 0.30 (cache_read tanpa diskon) = 3.10 USD
  assert.equal(h.usd, 3.1);
  assert.equal(h.tarif.asal.includes('Gemini 2.5 Flash'), true);
  assert.ok(h.tarif.asOf, 'tarif wajib membawa tanggal berlaku');
});

test('perkiraanBiaya anthropic: 3/15 dengan cache 1.25x/0.1x', () => {
  const h = perkiraanBiaya('anthropic', {
    input_tokens: 1_000_000, output_tokens: 1_000_000,
    cache_creation_input_tokens: 1_000_000, cache_read_input_tokens: 1_000_000,
  });
  // 3 + 15 + 3.75 + 0.3 = 22.05 USD
  assert.equal(h.usd, 22.05);
});

test('perkiraanBiaya backend tak dikenali: null, bukan angka tebak-tebakan', () => {
  assert.equal(perkiraanBiaya('gemmeni', {}), null);
  assert.equal(perkiraanBiaya('', {}), null);
});

test('perkiraanBiaya tanpa usage: nol token, nol biaya, tetap terurai', () => {
  const h = perkiraanBiaya('gemini', null);
  assert.equal(h.usd, 0);
});

test('potong memangkas teks panjang dan membiarkan teks pendek utuh', () => {
  assert.equal(potong('abc'), 'abc');
  assert.equal(potong('abc', 2), 'ab…');
  assert.equal(potong(undefined), '');
});
