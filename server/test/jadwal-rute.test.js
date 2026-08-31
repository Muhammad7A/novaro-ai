/**
 * Uji lapisan HTTP untuk gerbang jadwal.
 *
 * Gerbang yang hanya dijaga tampilan bukan gerbang. Yang diuji di sini adalah
 * empat pintu yang semuanya harus tertutup bersamaan — kalau salah satu
 * terlewat, seluruh penguncian hanya kosmetik:
 *
 *   1. /modul.js         tidak boleh lagi memuat isi sesi harian
 *   2. GET /api/sesi/:no menolak sesi yang harinya belum tiba
 *   3. PUT /api/progress menolak menandai sesi terkunci sebagai selesai
 *   4. POST /api/chat    tidak menyisipkan materi sesi terkunci ke prompt
 *
 * Pintu keempat yang paling mudah terlupakan, dan paling merusak: tanpanya
 * peserta hari ke-2 tinggal mengirim `modul: 6` dan seluruh isinya disalin ke
 * jawaban AI.
 *
 *   npm test
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'nova-jadwal-uji-'));
process.env.NOVA_DATA_DIR = DATA_DIR;
process.env.PORT = '0';
process.on('exit', () => rmSync(DATA_DIR, { recursive: true, force: true }));

const { store } = await import('../lib/store.js');
const { CONSENT_VERSION } = await import('../lib/consent.js');
const { SESI_HARIAN, KURIKULUM } = await import('../lib/kurikulum.js');
const { tanggalWIB } = await import('../lib/cashbook.js');
const app = (await import('../server.js')).default;

const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const BASE = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const minta = (jalur, { kode, ...opts } = {}) =>
  fetch(BASE + jalur, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(kode ? { Authorization: `Bearer ${kode}` } : {}),
      ...(opts.headers ?? {}),
    },
  });

/** Tanggal WIB hari ini digeser `n` hari. */
const geser = (n) =>
  new Date(Date.parse(`${tanggalWIB(new Date())}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

const { user, accessCode } = await store.createUser({ name: 'Bu Sari', business: 'Warung Bu Sari' });
await minta('/api/consent', { kode: accessCode, method: 'POST', body: JSON.stringify({ versi: CONSENT_VERSION }) });

const SESI = (n) => SESI_HARIAN.find((m) => m.sesi === n);

/* ============================================== 1. Berkas kurikulum publik */

test('/modul.js tidak lagi memuat isi sesi harian, tapi tetap memuat metadatanya', async () => {
  const res = await fetch(`${BASE}/modul.js`);
  assert.equal(res.status, 200);
  // Tetap boleh di-cache: isinya sama untuk semua orang, itulah yang membuatnya murah.
  assert.match(res.headers.get('cache-control') ?? '', /public/);

  const isi = await res.text();
  const modul = JSON.parse(isi.match(/window\.NOVA_MODUL=(\[.*?\]);window\.NOVA_JALUR=/s)[1]);
  assert.equal(modul.length, KURIKULUM.length, 'seluruh modul tetap terdaftar');

  for (const m of modul) {
    if (m.sesi != null) {
      assert.equal(m.isi, undefined, `isi sesi ${m.sesi} tidak boleh ikut ke berkas publik`);
      assert.equal(m.praktik, undefined, `praktik sesi ${m.sesi} tidak boleh ikut`);
      assert.equal(m.isiTerpisah, true, 'tampilan perlu tahu bahwa isinya diambil terpisah');
      assert.ok(m.judul && m.ringkas, 'judul & ringkasan tetap dikirim — peta tujuh hari boleh terlihat');
    } else {
      assert.ok(Array.isArray(m.isi) && m.isi.length, `modul pustaka ${m.no} harus tetap lengkap & bisa di-cache`);
    }
  }
});

test('kalimat kunci dari sesi harian benar-benar tidak ada di berkas publik', async () => {
  const isi = await (await fetch(`${BASE}/modul.js`)).text();
  // Kalimat khas modul 5 (HPP) dan modul 2 (cloud accounting).
  assert.ok(!isi.includes('HPP = Rp 1.070 per gelas'), 'isi sesi 5 bocor lewat berkas publik');
  assert.ok(!isi.includes('Cloud accounting adalah pencatatan keuangan'), 'isi sesi 2 bocor lewat berkas publik');
  // Pustaka memang boleh ikut — ini yang menjaga cache-nya tetap berguna.
  assert.ok(isi.includes('First In First Out'), 'modul pustaka 11 seharusnya tetap ikut');
});

/* ================================================ 2. Rute isi satu sesi */

test('sebelum pendamping memulai, tidak satu pun sesi harian bisa diambil', async () => {
  const res = await minta(`/api/sesi/${SESI(1).no}`, { kode: accessCode });
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.terkunci, true);
  assert.match(body.error, /belum dimulai/i);
  assert.equal(body.jadwal.dimulai, false);
});

test('modul pustaka tetap terbuka walau jadwal belum dimulai', async () => {
  const pustaka = KURIKULUM.find((m) => m.sesi == null);
  const res = await minta(`/api/sesi/${pustaka.no}`, { kode: accessCode });
  assert.equal(res.status, 200);
  assert.ok((await res.json()).isi.length);
});

test('sesudah jadwal dimulai hari ini, sesi 1 terbuka dan sesi 2 belum', async () => {
  await store.setMulai(user.id, geser(0));

  const satu = await minta(`/api/sesi/${SESI(1).no}`, { kode: accessCode });
  assert.equal(satu.status, 200);
  const isi = await satu.json();
  assert.ok(isi.isi.length >= 3);
  assert.ok(isi.praktik);
  assert.equal(isi.jadwal.hariKe, 1);

  const dua = await minta(`/api/sesi/${SESI(2).no}`, { kode: accessCode });
  assert.equal(dua.status, 403);
  const body = await dua.json();
  /*
   * Penolakan HARUS menyebutkan tanggalnya. Pemilik warung yang mengira
   * alatnya rusak tidak membukanya lagi besok — dan intervensi tujuh hari
   * tidak selamat dari itu.
   */
  assert.equal(body.terbukaPada, geser(1));
  assert.match(body.error, /terbuka pada/i);
});

test('sesi kemarin tidak pernah menutup lagi', async () => {
  // Jadwal dimulai empat hari lalu: sesi 1-4 terbuka, sesi 5 belum.
  await store.setMulai(user.id, geser(-3));
  for (const n of [1, 2, 3, 4]) {
    const res = await minta(`/api/sesi/${SESI(n).no}`, { kode: accessCode });
    assert.equal(res.status, 200, `sesi ${n} harus tetap terbuka di hari ke-4`);
  }
  assert.equal((await minta(`/api/sesi/${SESI(5).no}`, { kode: accessCode })).status, 403);
});

test('nomor modul asing dijawab 404, bukan diam-diam terbuka', async () => {
  for (const asing of ['999', '0', '__proto__', 'abc']) {
    const res = await minta(`/api/sesi/${asing}`, { kode: accessCode });
    assert.equal(res.status, 404, `${asing} seharusnya tidak ditemukan`);
  }
});

test('isi sesi tidak bisa diambil tanpa kode akses', async () => {
  assert.equal((await minta(`/api/sesi/${SESI(1).no}`)).status, 401);
});

/* ================================================== 3. Penandaan progres */

test('sesi yang belum terbuka tidak bisa ditandai selesai', async () => {
  await store.setMulai(user.id, geser(-1)); // hari ke-2: sesi 1-2 terbuka
  const res = await minta('/api/progress', {
    kode: accessCode,
    method: 'PUT',
    body: JSON.stringify({ done: { [SESI(1).no]: true, [SESI(2).no]: true, [SESI(6).no]: true } }),
  });
  assert.equal(res.status, 200);
  const { progress } = await res.json();
  assert.deepEqual(
    Object.keys(progress.done).map(Number).sort((a, b) => a - b),
    [SESI(1).no, SESI(2).no],
    'sesi 6 belum terbuka, jadi tidak boleh tercatat selesai',
  );
});

test('modul pustaka tetap bisa ditandai selesai kapan saja', async () => {
  const pustaka = KURIKULUM.filter((m) => m.sesi == null).slice(0, 2);
  const res = await minta('/api/progress', {
    kode: accessCode,
    method: 'PUT',
    body: JSON.stringify({ done: Object.fromEntries(pustaka.map((m) => [m.no, true])) }),
  });
  const { progress } = await res.json();
  for (const m of pustaka) assert.ok(progress.done[m.no], `modul pustaka ${m.no} tidak boleh ikut digerbang`);
});

test('koreksi tanggal mulai tidak menghapus riwayat penyelesaian yang sudah ada', async () => {
  /*
   * Pendamping salah ketik tanggal, lalu memperbaikinya ke tanggal yang lebih
   * belakang. Sesi yang sudah pernah diselesaikan peserta menjadi "terkunci"
   * menurut jadwal baru — tapi `module_completed` di events.csv sudah terlanjur
   * mencatat sebaliknya. Menghapusnya diam-diam berarti data penelitian dan
   * jejak peristiwanya saling bertentangan tanpa ada yang tahu.
   */
  await store.setMulai(user.id, geser(-5));
  await minta('/api/progress', {
    kode: accessCode, method: 'PUT', body: JSON.stringify({ done: { [SESI(1).no]: true, [SESI(5).no]: true } }),
  });

  await store.setMulai(user.id, geser(0)); // dikoreksi ke hari ini: sesi 5 kini terkunci

  const res = await minta('/api/progress', {
    kode: accessCode, method: 'PUT', body: JSON.stringify({ done: { [SESI(1).no]: true, [SESI(5).no]: true } }),
  });
  const { progress } = await res.json();
  assert.ok(progress.done[SESI(5).no], 'sesi yang sudah pernah selesai harus tetap tercatat selesai');

  // Tapi sesi lain yang belum pernah selesai tetap ditolak.
  const res2 = await minta('/api/progress', {
    kode: accessCode, method: 'PUT', body: JSON.stringify({ done: { [SESI(1).no]: true, [SESI(5).no]: true, [SESI(6).no]: true } }),
  });
  assert.ok(!(await res2.json()).progress.done[SESI(6).no]);
});

/* ======================================================== 4. Konteks AI */

test('materi sesi terkunci tidak ikut ke prompt AI', async () => {
  /*
   * Pintu yang paling mudah terlupakan. Diuji lewat rutenya dengan layanan AI
   * tiruan: yang diperiksa adalah apakah blok "MATERI MODUL YANG SEDANG DIBUKA"
   * berisi sesi yang belum terbuka.
   */
  const { createServer } = await import('node:http');
  let terkirim = '';
  const palsu = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      terkirim = body;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end('event: message_stop\ndata: {"type":"message_stop"}\n\n');
    });
  });
  await new Promise((r) => palsu.listen(0, r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${palsu.address().port}`;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-uji';

  try {
    await store.setMulai(user.id, geser(0)); // hari ke-1

    await minta('/api/chat', {
      kode: accessCode, method: 'POST',
      body: JSON.stringify({ message: 'jelaskan', modul: SESI(6).no }),
    });
    assert.ok(
      !terkirim.includes('MATERI MODUL YANG SEDANG DIBUKA'),
      'materi sesi 6 tidak boleh ikut terkirim pada hari ke-1',
    );

    terkirim = '';
    await minta('/api/chat', {
      kode: accessCode, method: 'POST',
      body: JSON.stringify({ message: 'jelaskan', modul: SESI(1).no }),
    });
    assert.ok(terkirim.includes('MATERI MODUL YANG SEDANG DIBUKA'), 'sesi yang sudah terbuka harus tetap menyertakan materinya');

    // Jadwalnya sendiri ikut ke prompt, supaya model tidak menyarankan sesi terkunci.
    assert.match(terkirim, /Hari ke-1 sejak jadwal belajarnya dimulai/);
  } finally {
    palsu.close();
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_API_KEY;
  }
});

/* ========================================================= Jadwal di /api/me */

test('/api/me membawa jadwal supaya tampilan tahu kapan sesi berikutnya terbuka', async () => {
  await store.setMulai(user.id, geser(-2));
  const { belajar } = await minta('/api/me', { kode: accessCode }).then((r) => r.json());
  assert.equal(belajar.dimulai, true);
  assert.equal(belajar.hariKe, 3);
  assert.equal(belajar.sesiTerbuka, 3);
  assert.equal(belajar.sesiBerikut, 4);
  assert.equal(belajar.berikutTerbukaPada, geser(1));
});

test('tanggal mulai ikut ke data yang bisa diunduh peserta sendiri', async () => {
  const data = await minta('/api/my-data', { kode: accessCode }).then((r) => r.json());
  assert.equal(data.mulaiPada, geser(-2));
});
