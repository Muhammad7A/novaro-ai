/**
 * Uji Kartu Kesehatan Usaha — kartu ringkas yang bisa dibagikan.
 *
 * Alurnya: pemilik menekan tombol di dasbor → server menerbitkan token
 * undian 144-bit → siapa pun yang memegang TAUTANNYA melihat ringkasan
 * baca-saja di /kartu/<token>, tanpa login.
 *
 * Yang dijaga berkas ini, dari yang paling penting:
 *   1. token TIDAK PERNAH ID internal dan TIDAK PERNAH kode akses —
 *      keduanya kunci akun, token kartu hanya membuka ringkasan;
 *   2. payload publik adalah DAFTAR PUTIH — id internal, transaksi satu
 *      per satu, riwayat chat, dan jejak penelitian tidak pernah ikut;
 *   3. pratinjau yang dilihat pemilik = halaman publik yang dilihat orang
 *      lain (payload server yang sama);
 *   4. tautan kedua untuk akun yang sama tidak mematikan tautan pertama.
 *
 *   npm test
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'nova-uji-kartu-'));
process.env.NOVA_DATA_DIR = DATA_DIR;
process.env.PORT = '0';
process.env.NOVA_AI_BACKEND = 'anthropic';
process.env.ANTHROPIC_API_KEY = '';
delete process.env.GOOGLE_CLOUD_PROJECT;
process.on('exit', () => rmSync(DATA_DIR, { recursive: true, force: true }));

const { store } = await import('../lib/store.js');
const app = (await import('../server.js')).default;

const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const BASE = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const { user, accessCode } = await store.createUser({ name: 'Bu Kartu', business: 'Warung Bu Kartu', batch: 'B1' });
await store.saveConsent(user.id, 2);
await store.saveProfile(user.id, {
  namaUsaha: 'Warung Bu Kartu',
  jenisUsaha: 'kuliner',
  lokasi: 'Semarang',
  lamaUsahaBulan: 14,
  jumlahKaryawan: 0,
  produkUtama: 'Nasi rames',
  omzetBulanan: 6_000_000,
  belanjaBulanan: 3_000_000,
  biayaOperasional: 900_000,
  cicilanBulanan: 300_000,
  pencatatan: 'aplikasi',
  rekeningTerpisah: false,
  punyaNib: false,
  tujuan: 'rapikan-keuangan',
  tantangan: '',
});

const minta = (jalur, { kode, ...opts } = {}) =>
  fetch(BASE + jalur, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(kode ? { Authorization: `Bearer ${kode}` } : {}),
      ...(opts.headers ?? {}),
    },
  });

/* ================================================== Terbitkan token */

test('tanpa kode akses: tidak ada kartu yang bisa diterbitkan', async () => {
  const res = await minta('/api/kartu', { method: 'POST', kode: '' });
  assert.equal(res.status, 401);
});

test('kode asing: 401', async () => {
  const res = await minta('/api/kartu', { method: 'POST', kode: 'NOVA-ZZZZ-ZZZZ' });
  assert.equal(res.status, 401);
});

test('terbitkan kartu: token diundi, bukan id internal dan bukan kode akses', async () => {
  const res = await minta('/api/kartu', { method: 'POST', kode: accessCode });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.match(data.token, /^kartu_[A-Za-z0-9_-]{20,}$/);
  assert.notEqual(data.token, user.id, 'token tidak boleh sama dengan id internal');
  assert.notEqual(data.token, accessCode, 'token tidak boleh sama dengan kode akses');
  assert.match(data.jalur, /^\/kartu\/kartu_/);
});

test('kartu kedua untuk akun yang sama: token SAMA — tautan lama tidak mati', async () => {
  const a = await minta('/api/kartu', { method: 'POST', kode: accessCode }).then((r) => r.json());
  const b = await minta('/api/kartu', { method: 'POST', kode: accessCode }).then((r) => r.json());
  assert.equal(a.token, b.token);
});

/* ================================================== Halaman publik */

test('halaman publik membuka kartu TANPA login dan datanya konsisten', async () => {
  const pribadi = await minta('/api/kartu', { method: 'POST', kode: accessCode }).then((r) => r.json());
  const res = await fetch(BASE + '/api/kartu/publik/' + pribadi.token);
  assert.equal(res.status, 200);
  const data = await res.json();

  const k = data.kartu;
  assert.equal(k.aplikasi, 'Novaro');
  assert.equal(k.namaUsaha, 'Warung Bu Kartu');
  assert.equal(k.jenisUsaha, 'Kuliner (warung/kafe/katering)');
  assert.ok(Number.isFinite(k.skorKesehatan) && k.skorKesehatan > 0, 'skor kesehatan harus terisi');
  assert.ok(k.statusKesehatan);
  assert.ok(k.omzet > 0 && k.labaBersih != null, 'omzet & laba harus terisi');
  assert.ok(Array.isArray(k.insight) && k.insight.length >= 1, 'insight harus ada');

  // Konsisten dengan dasbor: angka yang sama dengan /api/me untuk akun itu.
  const me = await minta('/api/me', { kode: accessCode }).then((r) => r.json());
  assert.equal(k.skorKesehatan, me.metrics.skorKesehatan);
  assert.equal(k.labaBersih, Math.round(me.metrics.labaBersih));
  assert.equal(k.omzet, Math.round(me.metrics.omzet));
});

test('payload publik adalah daftar putih — tidak ada id, kode, token, atau pembukuan', async () => {
  const pribadi = await minta('/api/kartu', { method: 'POST', kode: accessCode }).then((r) => r.json());
  const data = await fetch(BASE + '/api/kartu/publik/' + pribadi.token).then((r) => r.json());
  const teks = JSON.stringify(data);

  assert.ok(!teks.includes(user.id), 'id internal tidak boleh bocor');
  assert.ok(!teks.includes('codeHash'), 'hash kode akses tidak boleh bocor');
  assert.ok(!teks.includes(pribadi.token), 'token kartu tidak boleh ikut di dalam isi kartunya');
  assert.ok(!teks.includes(accessCode), 'kode akses tidak boleh bocor');
  assert.ok(!teks.includes('transactions'), 'transaksi satu per satu tidak boleh bocor');
  assert.ok(!teks.includes('tokenKartu'), 'medan token tidak boleh bocor');
  // Bentuknya persis kunci-karti yang diizinkan.
  assert.deepEqual(Object.keys(data.kartu).sort(), [
    'aplikasi', 'dibuatPada', 'insight', 'jenisUsaha', 'konsistensi',
    'labaBersih', 'namaUsaha', 'omzet', 'periode', 'skorKesehatan',
    'statusKesehatan', 'sumberAngka',
  ]);
});

test('token palsu, rusak, dan milik akun tanpa profil: semuanya 404 yang rapi', async () => {
  for (const token of ['kartu_' + 'A'.repeat(30), '101', 'usr_ca7242a292ba', '../../etc/passwd', '']) {
    const res = await fetch(BASE + '/api/kartu/publik/' + encodeURIComponent(token));
    assert.equal(res.status, 404, `token "${token}" harus 404`);
    const data = await res.json();
    assert.match(data.error, /tidak ditemukan/i);
  }
});

test('akun kedua tidak terbaca dari token akun pertama', async () => {
  const lain = await store.createUser({ name: 'Bu Lain', business: 'Toko Bu Lain', batch: 'B2' });
  await store.saveConsent(lain.user.id, 2);
  await store.saveProfile(lain.user.id, {
    namaUsaha: 'Toko Bu Lain', jenisUsaha: 'retail', pencatatan: 'buku',
    tujuan: 'naikkan-laba', omzetBulanan: 2_000_000,
  });
  const kartuPertama = await minta('/api/kartu', { method: 'POST', kode: accessCode }).then((r) => r.json());
  const data = await fetch(BASE + '/api/kartu/publik/' + kartuPertama.token).then((r) => r.json());
  assert.equal(data.kartu.namaUsaha, 'Warung Bu Kartu', 'kartu hanya isi pemilik tokennya');
  assert.ok(!JSON.stringify(data).includes('Toko Bu Lain'), 'data akun lain tidak boleh bocor');
});

test('halaman /kartu/<token> disajikan tanpa login dan tanpa data pengguna di HTML-nya', async () => {
  const res = await fetch(BASE + '/kartu/kartu_' + 'A'.repeat(30));
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('Kartu Kesehatan'), 'halaman kartu yang benar');
  assert.ok(!html.includes(user.id) && !html.includes(accessCode), 'HTML statik tidak membawa data pengguna');
  assert.ok(!html.includes('loginForm'), 'halaman kartu bukan halaman masuk — tidak ada permintaan kode di sana');
});

/* ================================================== Dasbor tak berubah */

test('dasbor & buku kas tetap bekerja seperti sebelum fitur kartu', async () => {
  await store.addTransaction(user.id, { tanggal: new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10), jenis: 'masuk', kategori: 'penjualan', keterangan: 'jual pagi', jumlah: 150_000 }, { aktor: 'manusia' });
  const kas = await minta('/api/cashbook', { kode: accessCode }).then((r) => r.json());
  assert.ok(kas.transactions.length >= 1, 'buku kas tetap membaca transaksi');
  assert.ok(kas.summary.penjualan >= 150_000, 'ringkasan tetap dihitung');
  const me = await minta('/api/me', { kode: accessCode }).then((r) => r.json());
  assert.ok(me.metrics.skorKesehatan > 0, 'metrik dasbor tetap terisi');
  assert.equal(me.user.tokenKartu, undefined, 'publicUser tidak pernah membawa token kartu');
});
