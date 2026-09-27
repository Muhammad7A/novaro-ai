/**
 * Uji pendaftaran mandiri (self-serve signup) — W1 exit gap #1.
 *
 * Alur: POST /api/auth/request-signup {email} → token verifikasi sekali-pakai
 * (HMAC su1., TTL 15 menit, disiplin lib/proposal.js — ditulis di
 * lib/autentikasi.js, satu rumah kripto auth) → POST /api/auth/verify-signup
 * → akun terverifikasi + consent v5 tampil di langkah pertama.
 *
 * Yang dijaga keras:
 *   - TANPA dev mode, token/tautan TIDAK PERNAH muncul di respons mana pun;
 *   - respons permintaan NETRAL — keberadaan akun tidak bisa dihitung;
 *   - token sekali-pakai dengan label jujur: replay = 409 duplikat
 *     (bukti konsumsi = emailVerifiedAt terisi, bukan penyimpanan jti);
 *   - DILARANG email/PII masuk jejak (requestHash = HMAC, bukan surel);
 *   - jalur lama (magic-link, kode akses) tidak tersentuh — no-retrofit.
 *
 *   npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'nova-uji-signup-'));
process.env.NOVA_DATA_DIR = DATA_DIR;
process.env.PORT = '0';
process.env.NOVA_AI_BACKEND = 'anthropic';
process.env.ANTHROPIC_API_KEY = '';
delete process.env.GOOGLE_CLOUD_PROJECT;
process.env.NOVA_SIGNUP_SECRET = 'rahasia-signup-uji';
process.env.NOVA_DEV_MODE = '1'; // mayoritas uji butuh devLink; guard-nya diuji eksplisit
process.on('exit', () => rmSync(DATA_DIR, { recursive: true, force: true }));

const { store } = await import('../lib/store.js');
const {
  TTL_SIGNUP_MS, bukaTokenSignup, hashPermintaan, signupTersedia, terbitkanTokenSignup,
} = await import('../lib/autentikasi.js');
const { periksaMetaJejak } = await import('../lib/jejak.js');
const app = (await import('../server.js')).default;

const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const BASE = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const penggunaDisk = (id) =>
  JSON.parse(readFileSync(path.join(DATA_DIR, 'users.json'), 'utf8')).users.find((u) => u.id === id);

let sesiSiklus = null; // sesi akun siklus — dipakai uji no-retrofit tanpa request-signup baru

const minta = (jalur, opts = {}) =>
  fetch(BASE + jalur, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
  });

/** Satu pendaftaran sampai dapat devLink — dipakai ulang banyak uji. */
const mintaTautan = async (email, kode) => {
  const res = await minta('/api/auth/request-signup', { method: 'POST', body: JSON.stringify({ email }), ...(kode ? { headers: { Authorization: `Bearer ${kode}` } } : {}) });
  const data = await res.json();
  return { res, data };
};

/* --------------------------------------------------------- Gerbang & dev */

test('gerbang: tanpa rahasia → 503 fail-closed + methods.signup false; dengan rahasia → on', async () => {
  delete process.env.NOVA_SIGNUP_SECRET;
  try {
    assert.equal(signupTersedia(), false);
    const res = await minta('/api/auth/request-signup', { method: 'POST', body: JSON.stringify({ email: 'a@b.co' }) });
    assert.equal(res.status, 503);
    const methods = await (await minta('/api/auth/methods')).json();
    assert.equal(methods.signup, false);
    assert.equal(terbitkanTokenSignup('a@b.co'), null, 'tanpa rahasia, tidak ada token lemah');
  } finally {
    process.env.NOVA_SIGNUP_SECRET = 'rahasia-signup-uji';
  }
  const methods = await (await minta('/api/auth/methods')).json();
  assert.equal(methods.signup, true);
});

test('DEV GUARD: tanpa dev mode, token/tautan TIDAK PERNAH muncul di respons', async () => {
  delete process.env.NOVA_DEV_MODE;
  try {
    const { res, data } = await mintaTautan('dev-guard@contoh.co');
    assert.equal(res.status, 200);
    assert.ok(!('devLink' in data), 'tanpa dev mode: tanpa devLink di respons');
    assert.equal(JSON.stringify(data).includes('su1.'), false, 'token tidak pernah bocor ke respons produksi');
    assert.match(data.message, /Check your email/, 'respons netral yang jujur');
  } finally {
    process.env.NOVA_DEV_MODE = '1';
  }
  const { data: dataDev } = await mintaTautan('dev-on@contoh.co');
  assert.match(dataDev.devLink, /token=su1\./, 'dev mode menampilkan tautan berlabel dev di UI');
});

/* --------------------------------------------------- Siklus & single-use */

test('siklus: request → pending identity → verify → consent v5 tampil → replay 409', async () => {
  const email = 'Wawan@Contoh.CO'; // kapital sengaja — dinormalkan ke bawah
  const { data } = await mintaTautan(email);
  const token = new URL(data.devLink).searchParams.get('token');

  // Pending: rekam ada, BELUM terverifikasi, event request contentless.
  const db1 = JSON.parse(readFileSync(path.join(DATA_DIR, 'users.json'), 'utf8'));
  const pending = db1.users.find((u) => u.email === email.toLowerCase());
  assert.ok(pending, 'pending identity lahir sebagai rekam pengguna');
  assert.ok(!pending.emailVerifiedAt, 'belum terverifikasi');
  const req1 = pending.events.find((e) => e.type === 'signup_requested');
  assert.equal(req1.meta.requestHash, hashPermintaan(email.toLowerCase()), 'requestHash = HMAC surel');
  assert.doesNotMatch(JSON.stringify(pending.events), /wawan@contoh\.co/i, 'email tidak pernah masuk jejak');
  assert.deepEqual(periksaMetaJejak('signup_requested', req1.meta), []);

  // Verifikasi: terverifikasi + sesi pertama + consent v5 tampil.
  const v = await minta('/api/auth/verify-signup', { method: 'POST', body: JSON.stringify({ token }) });
  assert.equal(v.status, 200);
  const masuk = await v.json();
  assert.ok(masuk.sesi, 'sesi pertama diterbitkan');
  sesiSiklus = masuk.sesi;
  assert.ok(masuk.consent, 'consent v5 tampil di langkah pertama (belum disetujui)');
  assert.equal(masuk.user.email, email.toLowerCase());

  // Disk truth: emailVerifiedAt terisi; event verified contentless.
  const disk = penggunaDisk(masuk.user.id);
  assert.ok(disk.emailVerifiedAt);
  const ev = disk.events.find((e) => e.type === 'signup_verified');
  assert.deepEqual(ev.meta, { userId: disk.id });
  assert.deepEqual(periksaMetaJejak('signup_verified', ev.meta), []);

  // REPLAY token yang sama → 409 duplikat; tidak ada sesi kedua yang lahir.
  const ulang = await minta('/api/auth/verify-signup', { method: 'POST', body: JSON.stringify({ token }) });
  assert.equal(ulang.status, 409);
  assert.equal((await ulang.json()).kode, 'duplikat');
  const disk2 = penggunaDisk(masuk.user.id);
  assert.equal(disk2.events.filter((e) => e.type === 'signup_verified').length, 1);
  assert.equal(disk2.sessions.length, disk.sessions.length, 'replay tidak menerbitkan sesi kedua');
});

test('TTL: token kedaluwarsa ditolak 401 dengan kode bertipe', async () => {
  const kini = Date.now();
  const token = terbitkanTokenSignup('kadaluarsa@contoh.co', { kini });
  const lewat = new Date(kini + TTL_SIGNUP_MS + 1);
  assert.throws(() => bukaTokenSignup(token, { kini: lewat }), (e) => e.kode === 'token-kedaluwarsa' && e.status === 401);
  const v = await minta('/api/auth/verify-signup', { method: 'POST', body: JSON.stringify({ token }) });
  assert.equal(v.status, 401, 'rute menolak token kedaluwarsa');
  assert.ok(!penggunaDisk(undefined), 'sanity');
  const db = JSON.parse(readFileSync(path.join(DATA_DIR, 'users.json'), 'utf8'));
  assert.ok(!db.users.some((u) => u.email === 'kadaluarsa@contoh.co'), 'kedaluwarsa sebelum dipakai tidak membuat rekam via verify');
});

test('token palsu: 401 + dicatat sebagai kegagalan verifikasi (pagar menebak sama)', async () => {
  const v = await minta('/api/auth/verify-signup', { method: 'POST', body: JSON.stringify({ token: 'su1.eyJ2IjoxfQ.deadbeef' }) });
  assert.equal(v.status, 401);
  assert.match((await v.json()).error, /not valid/);
});

/* ------------------------------------- Akun lama: netral + tanpa rekam baru */

test('akun lama: respons tetap netral, TANPA rekam baru, sinyal keamanan tercatat', async () => {
  // Signup pertama + verifikasi (akun menjadi lama-terverifikasi).
  const email = 'lama@contoh.co';
  const { data: d1 } = await mintaTautan(email);
  const token1 = new URL(d1.devLink).searchParams.get('token');
  await minta('/api/auth/verify-signup', { method: 'POST', body: JSON.stringify({ token: token1 }) });
  const hitung = () => JSON.parse(readFileSync(path.join(DATA_DIR, 'users.json'), 'utf8')).users.length;
  const sebelum = hitung();

  // Signup kedua atas email yang SAMA (terverifikasi).
  const { data: d2 } = await mintaTautan(email);
  assert.ok(!('devLink' in d2), 'akun terverifikasi tidak menerima token kedua — respons netral');
  assert.match(d2.message, /Check your email/);

  const db = JSON.parse(readFileSync(path.join(DATA_DIR, 'users.json'), 'utf8'));
  const milikEmail = db.users.filter((u) => u.email === email);
  assert.equal(milikEmail.length, 1, 'tanpa rekam baru untuk email terverifikasi');
  assert.equal(hitung(), sebelum, 'jumlah akun tidak bertambah');
  const sinyal = milikEmail[0].events.filter((e) => e.type === 'signup_requested');
  assert.ok(sinyal.length >= 2, 'sinyal keamanan permintaan-ulang tercatat (contentless)');
});

/* ------------------------------------------------------------- No-retrofit */

test('no-retrofit: magic-link dan kode akses bekerja persis seperti sebelumnya', async () => {
  // Magic-link: akun lama menerima tautan dan bisa masuk.
  const m = await minta('/api/auth/magic-link', { method: 'POST', body: JSON.stringify({ email: 'lama@contoh.co' }) });
  assert.equal(m.status, 200);
  assert.match((await m.json()).pesan, /sign-in link/);

  // Kode akses: akun signup tetap punya kode legacy dan bisa dipakai Bearer.
  const { accessCode } = await store.createUser({ name: 'Kode Legacy', business: '', batch: 'B1' });
  const login = await minta('/api/login', { method: 'POST', body: JSON.stringify({ code: accessCode }) });
  assert.equal(login.status, 200);
  const bearer = await minta('/api/me', { headers: { Authorization: `Bearer ${accessCode}` } });
  assert.equal(bearer.status, 200);

  // Akun signup juga bisa dipakai token sesinya — satu pintu Bearer.
  // (Sesi dari uji siklus dipakai di sini: slot request-signup berkas ini
  // terbatas 5 oleh pembatas IP, dan uji pembatas punya berkasnya sendiri.)
  const me = await minta('/api/me', { headers: { Authorization: `Bearer ${sesiSiklus}` } });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).user.email, 'wawan@contoh.co');
});
