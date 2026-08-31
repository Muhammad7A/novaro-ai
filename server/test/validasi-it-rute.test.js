/**
 * Uji lapisan HTTP dan penyimpanan lembar validasi Ahli IT.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'nova-validasi-it-uji-'));
process.env.NOVA_DATA_DIR = DATA_DIR;
process.env.PORT = '0';
process.env.VALIDASI_KODE = 'kode-validasi-uji-it-789';
process.env.VALIDASI_PENGELOLA_KODE = 'kode-pengelola-uji-it-123';
process.on('exit', () => rmSync(DATA_DIR, { recursive: true, force: true }));

const { BUTIR_IT } = await import('../lib/validasi-it.js');
const app = (await import('../server.js')).default;

const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const BASE = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const KODE = process.env.VALIDASI_KODE;
const KODE_PENGELOLA = process.env.VALIDASI_PENGELOLA_KODE;

const minta = (jalur, { kode, ...opts } = {}) =>
  fetch(BASE + jalur, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(kode ? { Authorization: `Bearer ${kode}` } : {}),
      ...(opts.headers ?? {}),
    },
  });

const jawabanSemuaIT = (n, komentar = '') =>
  Object.fromEntries(BUTIR_IT.map((b) => [b.kode, { skor: n, komentar }]));

const lembarIT = (ubah = {}) => ({
  jenis: 'it',
  validator: {
    nama: 'Dr. Eng. Ahli IT & Keamanan',
    institusi: 'Lab Komputasi Awan',
    jabatan: 'Kepala Lab',
    bidang: ['Infrastruktur Cloud & DevOps', 'Keamanan Siber & Privasi Data (Cybersecurity)'],
    tanggalValidasi: new Date().toISOString().slice(0, 10),
  },
  jawaban: jawabanSemuaIT(4),
  kesimpulan: 'layak-tanpa-revisi',
  catatanUmum: 'Infrastruktur Cloud Run & Cloud SQL PostgreSQL siap dipakai intervensi.',
  rekomendasi: 'Monitoring koneksi Cloud SQL secara berkala.',
  materiPerluRevisi: [],
  ...ubah,
});

test('GET /api/validasi/instrumen?jenis=it mengembalikan instrumen IT 25 butir', async () => {
  const res = await minta('/api/validasi/instrumen?jenis=it', { kode: KODE });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.instrumen.jenis, 'it');
  assert.equal(data.instrumen.jumlahButir, 25);
  assert.equal(data.instrumen.aspek.length, 6);
});

test('GET /api/validasi/it/instrumen mengembalikan instrumen IT', async () => {
  const res = await minta('/api/validasi/it/instrumen', { kode: KODE });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.instrumen.jenis, 'it');
  assert.equal(data.instrumen.jumlahButir, 25);
});

test('POST /api/validasi/kirim menyimpan lembar IT dengan benar', async () => {
  const res = await minta('/api/validasi/kirim', {
    method: 'POST',
    kode: KODE,
    body: JSON.stringify(lembarIT()),
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.ok(body.id.startsWith('val_'));
  assert.equal(body.hasil.jenis, 'it');
  assert.equal(body.hasil.skorDiperoleh, 100);
  assert.equal(body.hasil.persentase, 80);
  assert.equal(body.hasil.kategori.kunci, 'layak');
});

test('GET /api/validasi/hasil pengelola memuat rekap materi dan rekap IT', async () => {
  const res = await minta('/api/validasi/hasil', { kode: KODE_PENGELOLA });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.jumlah >= 1, true);
  assert.ok(data.rekapIT);
  assert.equal(data.rekapIT.jumlahValidator, 1);
  assert.equal(data.rekapIT.skorDiperoleh, 100);
});
