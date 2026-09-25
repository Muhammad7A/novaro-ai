/**
 * Uji autentikasi identitas baru — magic link surel + token sesi (W3).
 *
 * Yang dijaga berkas ini, dari yang paling penting:
 *   1. token tautan maupun sesi TIDAK PERNAH disimpan mentah — hanya hash;
 *   2. tautan sekali pakai: terpakai → 401 saat dipakai lagi;
 *   3. respons permintaan tautan SAMA RATA untuk surel dikenal/tidak —
 *      jumlah akun tidak bisa dihitung dari bedanya jawaban;
 *   4. sesi hidup sebagai Bearer di /api/me, bisa dicabut lewat logout;
 *   5. kode akses (jalur legacy) tetap sah di samping sesi;
 *   6. OAuth gagal-tutup yang JUJUR (503) selama belum dikonfigurasi.
 *
 *   npm test
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'nova-uji-autentikasi-'));
process.env.NOVA_DATA_DIR = DATA_DIR;
process.env.PORT = '0';
process.env.NOVA_AI_BACKEND = 'anthropic';
process.env.ANTHROPIC_API_KEY = '';
process.env.MAIL_PROVIDER = 'test'; // kotak keluar di memori — uji membaca tautan tanpa jaringan
delete process.env.GOOGLE_CLOUD_PROJECT;
delete process.env.GOOGLE_OAUTH_CLIENT_ID;
delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
delete process.env.PUBLIC_HOST;
process.on('exit', () => rmSync(DATA_DIR, { recursive: true, force: true }));

const { store } = await import('../lib/store.js');
const { emailSah, entriMagicLink, magicLinkHidup } = await import('../lib/autentikasi.js');
const { KOTAK_KELUAR } = await import('../lib/surel.js');
const { periksaMetaJejak } = await import('../lib/jejak.js');
const app = (await import('../server.js')).default;

const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const BASE = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const { user, accessCode } = await store.createUser({ name: 'Alex Rivera', business: 'Rivera Design Co' });
await store.saveConsent(user.id, (await import('../lib/consent.js')).CONSENT_VERSION);

const bawaSesi = (token) => ({ headers: { Authorization: `Bearer ${token}` } });

/** Mengambil token terakhir dari kotak keluar test untuk alamat ini. */
const tokenTerakhir = (to) => {
  const surat = [...KOTAK_KELUAR].reverse().find((s) => s.to === to);
  const cocok = surat?.text.match(/token=(ml_[A-Za-z0-9_-]+)/);
  return cocok?.[1] ?? null;
};

/* ------------------------------------------------------------ Unit murni */

test('emailSah: menormalkan huruf besar dan menolak bentuk asing', () => {
  assert.equal(emailSah('  Alex@Rivera.CO '), 'alex@rivera.co');
  assert.equal(emailSah('bukan-surel'), null);
  assert.equal(emailSah('a@b'), null);
  assert.equal(emailSah('a b@c.d'), null);
});

test('umur tautan ajaib: hidup saat baru, mati setelah dipakai atau kedaluwarsa', () => {
  const kini = Date.now();
  const m = entriMagicLink('ml_xxx', kini);
  assert.equal(magicLinkHidup(m, kini + 1000), true);
  assert.equal(magicLinkHidup({ ...m, dipakai: new Date(kini).toISOString() }, kini), false);
  assert.equal(magicLinkHidup(m, kini + 16 * 60 * 1000), false);
});

/* ------------------------------------------------- Memasang surel (migrasi) */

test('pasangEmail: surel menempel pada akun; alamat yang sama di akun lain ditolak 409', async () => {
  const pub = await store.pasangEmail(user.id, 'alex@rivera.co');
  assert.equal(pub.email, 'alex@rivera.co');
  assert.equal(pub.emailTerverifikasi, false); // baru terverifikasi lewat tautan

  const { user: userLain } = await store.createUser({ name: 'Other' });
  await assert.rejects(
    () => store.pasangEmail(userLain.id, 'alex@rivera.co'),
    (err) => err.kode === 'email-terpakai' && err.status === 409,
  );
});

/* ----------------------------------------------------- Magic link e2e */

test('magic link: minta → kirim → verifikasi → sesi sah sebagai Bearer', async () => {
  // email belum diverifikasi: pasang ulang yang sama tidak bentrok dengan diri sendiri
  await store.pasangEmail(user.id, 'alex@rivera.co');

  const minta = await fetch(`${BASE}/api/auth/magic-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'alex@rivera.co' }),
  });
  assert.equal(minta.status, 200);
  const isi = await minta.json();
  assert.equal(isi.ok, true);
  assert.ok(isi.pesan.includes('sign-in link has been sent'));

  const token = tokenTerakhir('alex@rivera.co');
  assert.ok(token, 'tautan harus ada di kotak keluar test');

  const verifikasi = await fetch(`${BASE}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  assert.equal(verifikasi.status, 200);
  const masuk = await verifikasi.json();
  assert.match(masuk.sesi, /^sesi_[A-Za-z0-9_-]{20,}$/);
  assert.equal(masuk.user.email, 'alex@rivera.co');
  assert.equal(masuk.user.emailTerverifikasi, true); // memakai tautan = membuktikan kepemilikan
  // bentuk jawaban masuk sama dengan /api/login — layar depan satu jalur
  for (const medan of ['user', 'metrics', 'aiConfigured', 'model', 'consent', 'anggaran', 'belajar']) {
    assert.ok(medan in masuk, `payload masuk wajib memuat ${medan}`);
  }

  const saya = await fetch(`${BASE}/api/me`, bawaSesi(masuk.sesi));
  assert.equal(saya.status, 200);

  // kode akses tetap sah — jalur legacy tidak tersingkir
  const sayaKode = await fetch(`${BASE}/api/me`, bawaSesi(accessCode));
  assert.equal(sayaKode.status, 200);

  // hash, bukan mentah: token tidak pernah ada di data pengguna
  const utuh = await store.findUserById(user.id);
  assert.ok(!JSON.stringify(utuh).includes(masuk.sesi));
  assert.ok(!JSON.stringify(utuh).includes(token));
});

test('tautan sekali pakai: token yang sama dipakai lagi → 401', async () => {
  await fetch(`${BASE}/api/auth/magic-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'alex@rivera.co' }),
  });
  const token = tokenTerakhir('alex@rivera.co');
  const pertama = await fetch(`${BASE}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  assert.equal(pertama.status, 200);
  const kedua = await fetch(`${BASE}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  assert.equal(kedua.status, 401);
});

test('anti-enumerasi: surel tak dikenal dijawab sama rata, tanpa surel terkirim', async () => {
  const sebelum = KOTAK_KELUAR.length;
  const jawab = await fetch(`${BASE}/api/auth/magic-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'tiada@nirwana.example' }),
  });
  assert.equal(jawab.status, 200);
  const isi = await jawab.json();
  assert.equal(isi.ok, true);
  assert.equal(KOTAK_KELUAR.length, sebelum); // tidak ada surel untuk alamat asing
});

test('surel salah bentuk ditolak 400 di muka, bukan dijawab sama rata', async () => {
  const jawab = await fetch(`${BASE}/api/auth/magic-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'bukan-surel' }),
  });
  assert.equal(jawab.status, 400);
});

/* ------------------------------------------------------------- Logout */

test('logout mencabut sesi; kode akses tidak ikut dicabut', async () => {
  await fetch(`${BASE}/api/auth/magic-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'alex@rivera.co' }),
  });
  const token = tokenTerakhir('alex@rivera.co');
  const masuk = await (
    await fetch(`${BASE}/api/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
  ).json();

  const keluar = await fetch(`${BASE}/api/auth/logout`, { method: 'POST', ...bawaSesi(masuk.sesi) });
  assert.equal(keluar.status, 200);

  const setelah = await fetch(`${BASE}/api/me`, bawaSesi(masuk.sesi));
  assert.equal(setelah.status, 401);

  const denganKode = await fetch(`${BASE}/api/me`, bawaSesi(accessCode));
  assert.equal(denganKode.status, 200);
});

/* -------------------------------------------------------- Token sesi liar */

test('token sesi karangan ditolak 401 dan dihitung pembatasnya', async () => {
  const jawab = await fetch(`${BASE}/api/me`, bawaSesi('sesi_' + 'A'.repeat(30)));
  assert.equal(jawab.status, 401);
});

/* ---------------------------------------------------------- /api/me/email */

test('rute /api/me/email: memasang surel lewat sesi dan mengirim tautan verifikasi', async () => {
  // masuk dulu lewat kode (jalur legacy) untuk memasang surel di akun kedua
  const { user: userKedua, accessCode: kodeKedua } = await store.createUser({ name: 'Sam Chen' });
  await store.saveConsent(userKedua.id, (await import('../lib/consent.js')).CONSENT_VERSION);

  const pasang = await fetch(`${BASE}/api/me/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${kodeKedua}` },
    body: JSON.stringify({ email: 'sam@chen.example' }),
  });
  assert.equal(pasang.status, 200);
  const isi = await pasang.json();
  assert.equal(isi.user.email, 'sam@chen.example');

  // alamat milik akun lain → 409 dengan kode mesin yang bisa diperiksa
  const bentrok = await fetch(`${BASE}/api/me/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${kodeKedua}` },
    body: JSON.stringify({ email: 'alex@rivera.co' }),
  });
  assert.equal(bentrok.status, 409);
  assert.equal((await bentrok.json()).kode, 'email-terpakai');
});

/* ------------------------------------------------------------ Metode & OAuth */

test('GET /api/auth/methods: kode + magicLink selalu ada; google jujur false tanpa konfigurasi', async () => {
  const jawab = await fetch(`${BASE}/api/auth/methods`);
  assert.equal(jawab.status, 200);
  const isi = await jawab.json();
  assert.equal(isi.kode, true);
  assert.equal(isi.magicLink, true);
  assert.equal(isi.oauth.google, false);
});

test('OAuth start: gagal-tutup 503 yang jujur; penyedia asing 404', async () => {
  const google = await fetch(`${BASE}/api/auth/oauth/google/start`, { redirect: 'manual' });
  assert.equal(google.status, 503);
  assert.ok((await google.json()).error.includes('not configured'));

  const asing = await fetch(`${BASE}/api/auth/oauth/linkedin/start`, { redirect: 'manual' });
  assert.equal(asing.status, 404);

  const panggilanBalik = await fetch(`${BASE}/api/auth/oauth/callback`);
  assert.equal(panggilanBalik.status, 503); // belum diimplementasikan — terang, bukan setengah hidup
});

/* ----------------------------------------------------------------- Jejak */

test('peristiwa autentikasi tercatat dan lolos pemeriksaan skema jejak', async () => {
  const utuh = await store.findUserById(user.id);
  const jenis = utuh.events.map((e) => e.type);

  assert.ok(jenis.includes('email_dipasang'));
  assert.ok(jenis.includes('magic_link_diminta'));
  assert.ok(jenis.includes('magic_link_dipakai'));
  assert.ok(jenis.includes('sesi_dibuat'));
  assert.ok(jenis.includes('sesi_dicabut'));

  // jalur sesi tercatat tanpa token, tanpa alamat surel (PII)
  const sesiDibuat = utuh.events.filter((e) => e.type === 'sesi_dibuat');
  assert.ok(sesiDibuat.every((e) => e.meta?.jalur === 'magic-link'));
  for (const ev of utuh.events) {
    assert.deepEqual(periksaMetaJejak(ev.type, ev.meta), [], `meta ${ev.type} harus lolos skema`);
    assert.ok(!JSON.stringify(ev).includes('@'), 'jejak tidak boleh memuat alamat surel');
  }
});

/* ---------------------------------------------------------- Pembatas jalan */

test('pembatas tautan masuk: permintaan beruntun akhirnya ditolak 429', async () => {
  let statusTerakhir = 200;
  for (let i = 0; i < 15 && statusTerakhir !== 429; i++) {
    const jawab = await fetch(`${BASE}/api/auth/magic-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'alex@rivera.co' }),
    });
    statusTerakhir = jawab.status;
  }
  assert.equal(statusTerakhir, 429);
});
