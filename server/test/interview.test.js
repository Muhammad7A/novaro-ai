/**
 * Uji klien sidecar interviu + rute siklusnya (W1 fase 1–2) — LOCAL ONLY.
 *
 * Kontrak SIDECAR INTERVIEW API v1 satu-sumbernya lib/interview.js (blok
 * misi tidak ikut paste — lihat catatan di sana). Yang diuji di sini dengan
 * sidecar palsu (pola penyedia-per-berkas): kontrak payload dua arah,
 * timeout → sidecar-mati, 401 → auth-gagal tanpa persist, sidecar mati →
 * gagal tanpa persist, payload rusak → gagal tanpa persist, siklus
 * start→turns→done bahagia dengan event contentless yang lolos gerbang
 * struktural jejak — dan NOL teks bebas yang menetap di rekam pengguna.
 *
 *   npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'nova-uji-interview-'));
process.env.NOVA_DATA_DIR = DATA_DIR;
process.env.PORT = '0';
process.env.NOVA_AI_BACKEND = 'anthropic';
process.env.ANTHROPIC_API_KEY = '';
delete process.env.GOOGLE_CLOUD_PROJECT;
process.env.NOVA_INTERVIEW_TIMEOUT_MS = '300'; // produksi tetap 10 dtk — uji tak menunggu
process.on('exit', () => rmSync(DATA_DIR, { recursive: true, force: true }));

const { store } = await import('../lib/store.js');
const { sidecarTersedia, TIMEOUT_MS, mulaiInterviu, kirimJawaban } = await import('../lib/interview.js');
const { periksaMetaJejak } = await import('../lib/jejak.js');
const { CONSENT_VERSION } = await import('../lib/consent.js');

const penggunaDisk = (id) =>
  JSON.parse(readFileSync(path.join(DATA_DIR, 'users.json'), 'utf8')).users.find((u) => u.id === id);

/* --------------------------- Sidecar palsu (SATU server, perilaku bisa diganti) --- */

const INTAKE_AWAL = 'int_00000000aaaa';
let perilaku = 'happy';
let terakhir = null;
let hitungGiliran = 0; // giliran per intake — selesai pada jawaban kedua

const sidecar = createServer((req, res) => {
  let tubuh = '';
  req.on('data', (c) => { tubuh += c; });
  req.on('end', async () => {
    terakhir = { jalur: req.url, auth: req.headers.authorization, tubuh: tubuh ? JSON.parse(tubuh) : null };
    const jawab = (kode, isi) => {
      res.writeHead(kode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(isi));
    };
    if (perilaku === 'auth') return jawab(401, { error: 'bad key' });
    if (perilaku === 'mati') return res.destroy(); // koneksi diputus
    if (perilaku === 'lambat') return; // tak pernah menjawab — timeout yang mengambil alih
    if (perilaku === 'rusak') return jawab(200, { entah: '?' });
    // happy: /v1/intakes pembuka; /turns giliran (jawaban kedua menutup)
    if (req.url === '/v1/intakes') {
      hitungGiliran = 0;
      return jawab(200, { intakeId: INTAKE_AWAL, jumlahDiscrepancy: 1, pertanyaan: 'Berapa kas akhir bulan kemarin?' });
    }
    hitungGiliran += 1;
    const selesai = hitungGiliran >= 2;
    return jawab(200, selesai
      ? { pertanyaan: null, selesai: true, coverage: 0.75, jumlahDiscrepancy: 2 }
      : { pertanyaan: 'Dan berapa prive yang diambil?', selesai: false, coverage: 0.4 });
  });
});
await new Promise((r) => sidecar.listen(0, r));
process.env.NOVA_INTERVIEW_SIDECAR_URL = `http://127.0.0.1:${sidecar.address().port}`;
process.env.NOVA_INTERVIEW_SECRET = 'rahasia-sidecar-uji';
test.after(() => sidecar.close());

const { store: _s, ...libApp } = { store: null };
const app = (await import('../server.js')).default;
const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const BASE = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const { user, accessCode } = await store.createUser({ name: 'Bu Wawancara', business: 'Warung Wawancara', batch: 'B1' });
await store.saveConsent(user.id, CONSENT_VERSION);
await store.saveProfile(user.id, { namaUsaha: 'Warung Wawancara', jenisUsaha: 'kuliner', pencatatan: 'buku', tujuan: 'naikkan-laba', omzetBulanan: 4_000_000 });

const minta = (jalur, { kode = accessCode, ...opts } = {}) =>
  fetch(BASE + jalur, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${kode}`, ...(opts.headers ?? {}) },
  });

/* ------------------------------------------------------- Gerbang & flag */

test('gerbang: URL kosong → sidecarTersedia()=false, rute 503, /api/me jujur off', async () => {
  delete process.env.NOVA_INTERVIEW_SIDECAR_URL;
  try {
    assert.equal(sidecarTersedia(), false);
    const me = await minta('/api/me');
    assert.equal((await me.json()).sidecar, 'off', 'flag jujur: konfigurasi tidak ada = off');
    const res = await minta('/api/interview/start', { method: 'POST' });
    assert.equal(res.status, 503);
    const u = penggunaDisk(user.id);
    assert.equal(u.events.filter((e) => e.type.startsWith('interview_')).length, 0, 'fitur off = nol persist');
  } finally {
    process.env.NOVA_INTERVIEW_SIDECAR_URL = `http://127.0.0.1:${sidecar.address().port}`;
  }
});

test('flag /api/me: konfigurasi ada = on', async () => {
  assert.equal(sidecarTersedia(), true);
  assert.equal(TIMEOUT_MS, 300, 'override uji terbaca; bawaan produksi tetap 10 dtk');
  const me = await minta('/api/me');
  assert.equal((await me.json()).sidecar, 'on');
});

/* ------------------------------------------------------- Kontrak payload */

test('kontrak start: Bearer secret + profil + digest metrik dari kernel', async () => {
  // Pengguna SENDIRI: start yang sukses menetapkan sesi di memori proses —
  // uji lain tetap mulai dari keadaan bersih tanpa rute batal.
  const { user: uK, accessCode: kodeK } = await store.createUser({ name: 'Bu Kontrak', business: '', batch: 'B1' });
  await store.saveConsent(uK.id, CONSENT_VERSION);
  await store.saveProfile(uK.id, { namaUsaha: 'Warung Wawancara', jenisUsaha: 'kuliner', pencatatan: 'buku', tujuan: 'naikkan-laba', omzetBulanan: 4_000_000 });
  perilaku = 'happy';
  const res = await minta('/api/interview/start', { kode: kodeK, method: 'POST' });
  assert.equal(res.status, 200);
  assert.equal(terakhir.jalur, '/v1/intakes');
  assert.equal(terakhir.auth, 'Bearer rahasia-sidecar-uji');
  // Profil usaha ikut; metrik adalah DIGEST angka kernel (medan tertutup).
  assert.equal(terakhir.tubuh.profil.namaUsaha, 'Warung Wawancara');
  for (const medan of ['omzet', 'labaBersih', 'saldoKas', 'prive', 'hariTercatat']) {
    assert.ok(medan in terakhir.tubuh.metrik, `digest metrik membawa ${medan}`);
  }
  const data = await res.json();
  assert.equal(data.intakeId, INTAKE_AWAL);
  assert.equal(data.jumlahDiscrepancy, 1);
  assert.ok(data.pertanyaan.length > 0);
});

/* -------------------------------------------------- Kegagalan bertipe */

test('timeout: sidecar lambat → 503 sidecar-mati, NOL persist', async () => {
  const sebelum = penggunaDisk(user.id);
  perilaku = 'lambat';
  const res = await minta('/api/interview/start', { method: 'POST' });
  assert.equal(res.status, 503);
  const u = penggunaDisk(user.id);
  assert.equal(u.events.filter((e) => e.type.startsWith('interview_')).length, sebelum.events.filter((e) => e.type.startsWith('interview_')).length);
  assert.equal(u.chat?.length ?? 0, 0, 'teks sidecar tidak pernah menetap di rekam');
});

test('401: auth-gagal → 502, tanpa persist', async () => {
  perilaku = 'auth';
  const res = await minta('/api/interview/start', { method: 'POST' });
  assert.equal(res.status, 502);
  const u = penggunaDisk(user.id);
  assert.equal(u.events.filter((e) => e.type === 'interview_started').length, 0);
});

test('sidecar mati: koneksi diputus → 503, tanpa persist; payload rusak juga gagal jujur', async () => {
  perilaku = 'mati';
  assert.equal((await minta('/api/interview/start', { method: 'POST' })).status, 503);
  perilaku = 'rusak';
  assert.equal((await minta('/api/interview/start', { method: 'POST' })).status, 502);
  const u = penggunaDisk(user.id);
  assert.equal(u.events.filter((e) => e.type.startsWith('interview_')).length, 0, 'kegagalan mana pun = nol rekam');
  // Klien murni membedakan tipenya:
  await assert.rejects(() => mulaiInterviu({ profil: null, metrik: null }), (e) => e.kode === 'payload-rusak');
});

/* ------------------------------------------------- Siklus bahagia penuh */

test('siklus: start → turns → done — event contentless, teks tak menetap, 409 sesudah selesai', async () => {
  perilaku = 'happy';

  const start = await minta('/api/interview/start', { method: 'POST' });
  assert.equal(start.status, 200);
  const awal = await start.json();
  assert.match(awal.pertanyaan, /kas akhir/);

  // Kebenaran disk SETELAH start: satu event contentless, tanpa teks interviu.
  let disk = penggunaDisk(user.id);
  const mulai = disk.events.find((e) => e.type === 'interview_started');
  assert.deepEqual(mulai.meta, { intakeId: INTAKE_AWAL, jumlah: 1 });
  assert.deepEqual(periksaMetaJejak('interview_started', mulai.meta), []);

  // Giliran 1: jawaban pendek → pertanyaan lanjutan.
  const t1 = await minta('/api/interview/answer', { method: 'POST', body: JSON.stringify({ jawaban: 'tiga juta' }) });
  assert.equal(t1.status, 200);
  const g1 = await t1.json();
  assert.equal(g1.selesai, false);
  assert.ok(g1.pertanyaan.length > 0);

  // Giliran 2: selesai → event completed {intakeId, coverage}, keadaan dibuang.
  const t2 = await minta('/api/interview/answer', { method: 'POST', body: JSON.stringify({ jawaban: 'saya sudah menarik dua juta untuk kebutuhan rumah bulan ini' }) });
  assert.equal(t2.status, 200);
  const g2 = await t2.json();
  assert.equal(g2.selesai, true);
  assert.equal(g2.coverage, 0.75);

  disk = penggunaDisk(user.id);
  const selesai = disk.events.find((e) => e.type === 'interview_completed');
  assert.deepEqual(selesai.meta, { intakeId: INTAKE_AWAL, coverage: 0.75 });
  assert.deepEqual(periksaMetaJejak('interview_completed', selesai.meta), []);
  // RATCHET: teks jawaban/pertanyaan tidak ada di rekam mana pun.
  const jejakTeks = JSON.stringify(disk.events);
  assert.doesNotMatch(jejakTeks, /dua juta|kas akhir|prive yang diambil/);
  assert.equal(disk.chat?.length ?? 0, 0, 'percakapan interviu tidak pernah masuk chat');

  // Sesi ditutup: jawaban lagi = 409; mulai lagi = boleh.
  const mati = await minta('/api/interview/answer', { method: 'POST', body: JSON.stringify({ jawaban: 'halo lagi' }) });
  assert.equal(mati.status, 409);
  perilaku = 'happy';
  const mulaiLagi = await minta('/api/interview/start', { method: 'POST' });
  assert.equal(mulaiLagi.status, 200);
});

test('tanpa sesi: 409; jawaban kosong: 400; tanpa persetujuan: 451', async () => {
  const belum = await store.createUser({ name: 'Belum Sepakat', business: '', batch: 'B1' });
  const r451 = await minta('/api/interview/start', { kode: belum.accessCode, method: 'POST' });
  assert.equal(r451.status, 451);

  // Pengguna lain tanpa sesi:
  const sendiri = await store.createUser({ name: 'Sendiri', business: '', batch: 'B1' });
  await store.saveConsent(sendiri.user.id, CONSENT_VERSION);
  const r409 = await minta('/api/interview/answer', { kode: sendiri.accessCode, method: 'POST', body: JSON.stringify({ jawaban: 'apa saja' }) });
  assert.equal(r409.status, 409);

  // Jawaban kosong dites MANDIRI: sesi dibuka di sini, bukan sisa uji lain.
  await minta('/api/interview/start', { method: 'POST' });
  const r400 = await minta('/api/interview/answer', { method: 'POST', body: JSON.stringify({ jawaban: '   ' }) });
  assert.equal(r400.status, 400);
});
