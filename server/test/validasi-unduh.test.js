/**
 * Uji jalur PENGAMBILAN hasil validasi materi.
 *
 * Kenapa berkas ini ada:
 *
 * Sebelum ini, lembar validasi hanya bisa MASUK. Rute validasi cuma dua —
 * `GET /instrumen` dan `POST /kirim` — dan rekapnya hanya bisa dibaca lewat
 * `npm run validasi`, yang menuntut shell di mesin server. Di Cloud Run tidak
 * ada shell, dan disknya hilang tiap instance didaur ulang. Artinya seorang
 * validator ahli bisa mengisi lembarnya sampai selesai, servernya menjawab
 * "tersimpan", dan penelitinya tidak punya satu pun cara untuk mengambil
 * hasilnya kembali. Penilaian ahli tidak bisa diminta dua kali.
 *
 * Dua jalan keluar diuji di sini, dan keduanya harus berdiri sendiri:
 *
 *   1. `GET /api/validasi/hasil` — unduhan untuk PENGELOLA, dijaga kode
 *      tersendiri. Kode validator tidak boleh membukanya: satu validator tidak
 *      boleh bisa membaca penilaian rekannya, dan itu sudah jadi keputusan
 *      sadar di rute pengiriman.
 *
 *   2. Isi lembarnya ikut tercatat ke log terstruktur saat diterima. Log tidak
 *      ikut mati bersama kontainer, jadi lembar yang belum sempat diunduh
 *      masih bisa diambil dari Cloud Logging. Nama validator tetap TIDAK ikut
 *      — aturan itu sudah berlaku sebelum berkas ini ada, dan justru di sinilah
 *      ia paling mudah dilanggar tanpa sengaja.
 *
 *   npm test -- test/validasi-unduh.test.js
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'nova-validasi-unduh-'));
process.env.NOVA_DATA_DIR = DATA_DIR;
process.env.PORT = '0';
process.env.VALIDASI_KODE = 'kode-validator-uji-1a2b';
process.env.VALIDASI_PENGELOLA_KODE = 'kode-pengelola-uji-9z8y';
process.env.LOG_FORMAT = 'json';
process.on('exit', () => rmSync(DATA_DIR, { recursive: true, force: true }));

/*
 * Log ditangkap SEBELUM lib/log.js dimuat. Modul itu menyimpan rujukan ke
 * console.log ke dalam tabelnya saat didefinisikan, jadi menggantinya sesudah
 * impor tidak akan berpengaruh apa pun.
 */
const barisLog = [];
const consoleAsli = console.log;
console.log = (...args) => { barisLog.push(args.join(' ')); };
test.after(() => { console.log = consoleAsli; });

const { validasiStore } = await import('../lib/validasi-store.js');
const { BUTIR } = await import('../lib/validasi.js');
const app = (await import('../server.js')).default;

const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const BASE = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const KODE_VALIDATOR = process.env.VALIDASI_KODE;
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

const lembar = (ubah = {}) => ({
  validator: {
    nama: 'Prof. Nama Yang Tidak Boleh Bocor',
    institusi: 'Universitas Uji',
    jabatan: 'Guru Besar',
    bidang: ['Akuntansi / keuangan'],
    tanggalValidasi: new Date().toISOString().slice(0, 10),
  },
  jawaban: Object.fromEntries(BUTIR.map((b) => [b.kode, { skor: 4, komentar: '' }])),
  kesimpulan: 'layak-revisi-kecil',
  catatanUmum: 'Materi sudah runtut.',
  rekomendasi: 'Perjelas satuan pada contoh HPP.',
  ...ubah,
});

/* ================================================== Penjagaan kode pengelola */

test('tanpa kode sama sekali, hasil validasi tidak bisa diunduh', async () => {
  const res = await minta('/api/validasi/hasil');
  assert.equal(res.status, 401);
});

test('kode VALIDATOR tidak boleh membuka unduhan hasil', async () => {
  const res = await minta('/api/validasi/hasil', { kode: KODE_VALIDATOR });
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.ok(!('hasil' in body), 'jangan pernah mengembalikan lembar pada kode yang salah');
});

test('kode pengelola membuka seluruh lembar beserta rekapnya', async () => {
  const kirim = await minta('/api/validasi/kirim', {
    kode: KODE_VALIDATOR,
    method: 'POST',
    body: JSON.stringify(lembar()),
  });
  assert.equal(kirim.status, 201);

  const res = await minta('/api/validasi/hasil', { kode: KODE_PENGELOLA });
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(body.jumlah, 1);
  assert.equal(body.hasil.length, 1);
  // Nama validator MEMANG ikut di sini — ini unduhan pengelola, bukan log.
  assert.equal(body.hasil[0].validator.nama, 'Prof. Nama Yang Tidak Boleh Bocor');
  assert.ok(body.rekap, 'rekap harus ikut supaya tidak perlu dihitung tangan');
  assert.equal(body.rekap.jumlahValidator, 1);

  // Diunduh sebagai berkas: pengelola memakainya lewat curl, bukan membacanya
  // di layar.
  assert.match(res.headers.get('content-disposition') ?? '', /attachment/);
});

test('konfigurasi berbahaya ditolak: kode pengelola tidak boleh sama dengan kode validator', async () => {
  const sebelum = process.env.VALIDASI_PENGELOLA_KODE;
  process.env.VALIDASI_PENGELOLA_KODE = KODE_VALIDATOR;
  try {
    const res = await minta('/api/validasi/hasil', { kode: KODE_VALIDATOR });
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.match(body.error, /sama/i);
  } finally {
    process.env.VALIDASI_PENGELOLA_KODE = sebelum;
  }
});

test('bila kode pengelola belum diatur, rutenya menjawab 503 dan menyebut apa yang harus diisi', async () => {
  const sebelum = process.env.VALIDASI_PENGELOLA_KODE;
  delete process.env.VALIDASI_PENGELOLA_KODE;
  try {
    const res = await minta('/api/validasi/hasil', { kode: KODE_PENGELOLA });
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.match(body.error, /VALIDASI_PENGELOLA_KODE/);
  } finally {
    process.env.VALIDASI_PENGELOLA_KODE = sebelum;
  }
});

/* ============================================ Lembar utuh ikut ke log server */

test('lembar yang diterima tercatat utuh di log, TANPA nama validator', async () => {
  barisLog.length = 0;

  const res = await minta('/api/validasi/kirim', {
    kode: KODE_VALIDATOR,
    method: 'POST',
    body: JSON.stringify(lembar({ catatanUmum: 'Penanda unik untuk uji ini.' })),
  });
  assert.equal(res.status, 201);
  const { id } = await res.json();

  const catatan = barisLog
    .map((b) => { try { return JSON.parse(b); } catch { return null; } })
    .filter((o) => o && o.komponen === 'validasi' && o.lembarId === id);

  assert.equal(catatan.length, 1, 'harus ada tepat satu catatan untuk lembar ini');
  const c = catatan[0];

  // Yang menjadikan log ini jaring pengaman: jawaban per butir ikut, bukan
  // cuma skor totalnya. Skor total saja tidak bisa menyusun ulang lembarnya.
  assert.ok(c.jawaban, 'jawaban per butir harus ikut');
  assert.equal(Object.keys(c.jawaban).length, BUTIR.length);
  assert.equal(c.kesimpulan, 'layak-revisi-kecil');
  assert.equal(c.catatanUmum, 'Penanda unik untuk uji ini.');

  // Dan yang menjadikannya tetap layak ditulis ke log: identitas validator
  // tidak ikut ke mana pun di dalam catatan itu.
  const utuh = JSON.stringify(c);
  assert.ok(!utuh.includes('Nama Yang Tidak Boleh Bocor'), 'nama validator bocor ke log');
  assert.ok(!utuh.includes('Universitas Uji'), 'institusi validator bocor ke log');
  assert.ok(!utuh.includes('Guru Besar'), 'jabatan validator bocor ke log');
});

test('unduhan pengelola tidak menyentuh data peserta', async () => {
  const { store } = await import('../lib/store.js');
  const { user } = await store.createUser({ name: 'Peserta Uji' });
  await minta('/api/validasi/hasil', { kode: KODE_PENGELOLA });
  const lagi = await store.exportUser(user.id);
  assert.equal(lagi.name, 'Peserta Uji');
  assert.deepEqual(lagi.transactions, []);
});
