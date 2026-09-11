/**
 * Uji batas tulis buku kas — lantai kepercayaan mutator penyimpan.
 *
 * Pemeriksaan yang dulu hanya hidup di rute HTTP kini dipegang mutator
 * (`store.addTransaction`). Uji di sini sengaja menyerang DUA sisi batas itu:
 *
 *   - sisi HTTP: tubuh permintaan tidak boleh bisa menetapkan medan
 *     siapa-punya-server (`origin`, `proposalId`), dan id permintaan yang
 *     dikirim ulang tidak boleh menghasilkan baris kedua;
 *   - sisi internal: pemanggil langsung tanpa rute — alat CLI, otomasi,
 *     pemanggil masa depan — menghadapi penolakan yang sama, termasuk
 *     invarian MESIN TIDAK MENULIS PENGHASILAN.
 *
 * Setiap penolakan juga diuji BEBAS EFEK SAMPING: baris dan jejak peristiwa
 * tidak boleh berubah oleh mutasi yang ditolak — kegagalan yang menyisakan
 * jejak sama bahayanya dengan kegagalan yang menulis.
 *
 *   npm test
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'nova-mutasi-uang-uji-'));
process.env.NOVA_DATA_DIR = DATA_DIR;
process.env.PORT = '0';
process.on('exit', () => rmSync(DATA_DIR, { recursive: true, force: true }));

const { store, GalatMutasi } = await import('../lib/store.js');
const { CONSENT_VERSION } = await import('../lib/consent.js');
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

/** Pengguna bersedia yang siap menulis ke buku kasnya lewat rute. */
async function penggunaSiap(nama = 'Bu Batas') {
  const { user, accessCode } = await store.createUser({ name: nama });
  await store.saveConsent(user.id, CONSENT_VERSION);
  return { user, accessCode };
}

const barisHariIni = (ubah = {}) => ({
  jenis: 'keluar', kategori: 'operasional', keterangan: 'uji batas tulis', jumlah: 12_500, ...ubah,
});

/* ------------------------------------------------ Medan siapa-punya-server */

test('tubuh permintaan yang memalsukan origin/proposalId/voided diabaikan mutator', async () => {
  const { user, accessCode } = await penggunaSiap();
  const res = await minta('/api/cashbook', {
    method: 'POST',
    kode: accessCode,
    body: JSON.stringify({
      ...barisHariIni(),
      origin: 'rule', // kelas serangan: memalsukan asal baris
      proposalId: 'prop_palsu', // kelas serangan: mengarang jejak usulan
      voided: false,
      voidedAt: '2026-01-01T00:00:00.000Z',
      id: 'trx_ditentukan_penyerang',
    }),
  });
  assert.equal(res.status, 201);
  const { transaction: row } = await res.json();

  assert.equal(row.origin, 'manual', 'asal baris ditetapkan server — selalu manual dari rute ini');
  assert.equal('proposalId' in row, false, 'proposalId tidak boleh lahir dari tubuh permintaan');
  assert.equal('voided' in row, false);
  assert.equal('voidedAt' in row, false);
  assert.match(row.id, /^trx_[0-9a-f]{12}$/, 'id baris selalu diundi server');
  assert.notEqual(row.id, 'trx_ditentukan_penyerang');
});

test('origin ikut ke meta peristiwa transaction_added — kosakata tertutup, tanpa nominal', async () => {
  const { user } = await penggunaSiap();
  await store.addTransaction(user.id, barisHariIni(), { aktor: 'manusia' });

  const ev = (await store.getEvents(user.id)).find((e) => e.type === 'transaction_added');
  assert.equal(ev.meta.origin, 'manual');
  const teks = JSON.stringify(ev);
  assert.doesNotMatch(teks, /12500/, 'meta peristiwa tetap buta nominal');
  assert.doesNotMatch(teks, /uji batas tulis/, 'meta peristiwa tetap buta teks bebas');
});

/* ----------------------------------------- Aktor efektif & invarian mesin */

test('pemanggil internal tanpa pernyataan aktor ditolak — gagal-tutup, bukan dianggap manusia', async () => {
  const { user } = await penggunaSiap();
  await assert.rejects(
    () => store.addTransaction(user.id, barisHariIni()),
    (err) => err instanceof GalatMutasi && err.kode === 'aktor-tidak-sah' && err.status === 400,
  );
  assert.equal((await store.getTransactions(user.id)).length, 0, 'tidak ada baris yang lahir dari penolakan');
});

test('MESIN TIDAK MENULIS PENGHASILAN — pemasukan dari aktor mesin ditolak', async () => {
  const { user } = await penggunaSiap();
  await assert.rejects(
    () => store.addTransaction(user.id, { jenis: 'masuk', kategori: 'penjualan', jumlah: 999_999 }, { aktor: 'mesin' }),
    (err) => err instanceof GalatMutasi && err.kode === 'mesin-penghasilan' && err.status === 403,
  );
  // Penolakan bebas efek samping: buku dan jejaknya persis keadaan sebelumnya.
  assert.equal((await store.getTransactions(user.id)).length, 0);
  assert.equal((await store.getEvents(user.id)).some((e) => e.type === 'transaction_added'), false);
});

test('pengeluaran oleh mesin juga ditolak — belum ada asal mesin yang bisa ditetapkan', async () => {
  const { user } = await penggunaSiap();
  await assert.rejects(
    () => store.addTransaction(user.id, barisHariIni(), { aktor: 'mesin' }),
    (err) => err instanceof GalatMutasi && err.kode === 'mesin-tanpa-asal' && err.status === 403,
  );
});

/* ------------------------------------------------ Idempotensi id permintaan */

test('kirim ulang dengan x-request-id sama ditolak 409 — satu niat, satu baris', async () => {
  const { user, accessCode } = await penggunaSiap();
  const headers = { 'x-request-id': 'kirim-2026.09.11-001' };
  const pertama = await minta('/api/cashbook', { method: 'POST', kode: accessCode, headers, body: JSON.stringify(barisHariIni()) });
  assert.equal(pertama.status, 201);
  assert.equal((await pertama.json()).transaction.requestId, 'kirim-2026.09.11-001');

  const ulang = await minta('/api/cashbook', {
    method: 'POST', kode: accessCode, headers,
    body: JSON.stringify(barisHariIni({ keterangan: 'kirim ulang' })),
  });
  assert.equal(ulang.status, 409);
  assert.equal((await ulang.json()).kode, 'duplikat');
  assert.equal((await store.getTransactions(user.id)).length, 1, 'tidak ada baris kedua dari niat yang sama');
});

test('id permintaan berbeda tetap lolos, dan id yang sama pada pengguna lain tidak tertukar', async () => {
  const { user: a, accessCode: kodeA } = await penggunaSiap('Bu A');
  const { user: b, accessCode: kodeB } = await penggunaSiap('Bu B');

  for (const id of ['req-1', 'req-2']) {
    const res = await minta('/api/cashbook', { method: 'POST', kode: kodeA, headers: { 'x-request-id': id }, body: JSON.stringify(barisHariIni()) });
    assert.equal(res.status, 201);
  }
  assert.equal((await store.getTransactions(a.id)).length, 2);

  const res = await minta('/api/cashbook', { method: 'POST', kode: kodeB, headers: { 'x-request-id': 'req-1' }, body: JSON.stringify(barisHariIni()) });
  assert.equal(res.status, 201, 'cakupan id permintaan adalah satu pengguna, bukan satu server');
});

test('x-request-id berbentuk asing ditolak di mutator, bukan didiamkan tanpa dedup', async () => {
  const { accessCode } = await penggunaSiap();
  const res = await minta('/api/cashbook', {
    method: 'POST', kode: accessCode,
    headers: { 'x-request-id': 'ada spasi; dan lebih dari ter bats'.slice(0, 200) },
    body: JSON.stringify(barisHariIni()),
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).kode, 'id-permintaan');
});

/* ---------------------------------- Validasi di mutator (pemanggil internal) */

test('enum tidak sah ditolak di mutator — termasuk huruf besar yang mirip', async () => {
  const { user } = await penggunaSiap();
  await assert.rejects(
    () => store.addTransaction(user.id, { jenis: 'Masuk', kategori: 'penjualan', jumlah: 1000 }, { aktor: 'manusia' }),
    (err) => err instanceof GalatMutasi && err.kode === 'jenis',
  );
  await assert.rejects(
    () => store.addTransaction(user.id, { jenis: 'masuk', kategori: 'gaji', jumlah: 1000 }, { aktor: 'manusia' }),
    (err) => err instanceof GalatMutasi && err.kode === 'kategori',
  );
});

test('jumlah tidak sah ditolak: nol, negatif, dan yang tak terbaca sebagai angka', async () => {
  const { user } = await penggunaSiap();
  for (const jumlah of [0, -5, NaN, Infinity, 'banyak']) {
    await assert.rejects(
      () => store.addTransaction(user.id, { jenis: 'keluar', kategori: 'operasional', jumlah }, { aktor: 'manusia' }),
      (err) => err instanceof GalatMutasi && err.kode === 'jumlah',
      `jumlah ${String(jumlah)} harusnya ditolak`,
    );
  }
});

test('jumlah di atas batas dirapikan ke batas, bukan ditolak — semantik sama dengan rute', async () => {
  const { user } = await penggunaSiap();
  const row = await store.addTransaction(
    user.id,
    { jenis: 'keluar', kategori: 'prive', jumlah: 5e12 },
    { aktor: 'manusia' },
  );
  assert.equal(row.jumlah, 1e12, 'penjepitan ke 1e12 adalah perilaku rute yang dipertahankan');
});

test('tanggal di luar jendela ditolak dengan kode terpisah', async () => {
  const { user } = await penggunaSiap();
  await assert.rejects(
    () => store.addTransaction(user.id, { jenis: 'keluar', kategori: 'operasional', jumlah: 1000, tanggal: '2999-01-01' }, { aktor: 'manusia' }),
    (err) => err instanceof GalatMutasi && err.kode === 'tanggal-masa-depan',
  );
  await assert.rejects(
    () => store.addTransaction(user.id, { jenis: 'keluar', kategori: 'operasional', jumlah: 1000, tanggal: '2019-01-01' }, { aktor: 'manusia' }),
    (err) => err instanceof GalatMutasi && err.kode === 'tanggal-terlalulama',
  );
  await assert.rejects(
    () => store.addTransaction(user.id, { jenis: 'keluar', kategori: 'operasional', jumlah: 1000, tanggal: '20-07-2026' }, { aktor: 'manusia' }),
    (err) => err instanceof GalatMutasi && err.kode === 'tanggal-bentuk',
  );
});

test('tanggal yang tidak diisi berarti hari ini — di rute maupun di mutator', async () => {
  const { user } = await penggunaSiap();
  const row = await store.addTransaction(user.id, { jenis: 'masuk', kategori: 'penjualan', jumlah: 5000 }, { aktor: 'manusia' });
  const hariIni = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10); // WIB
  assert.equal(row.tanggal, hariIni);
});

/* ----------------------------------------------- Pra-syarat & keadaan basi */

test('target yang sudah tiada: mutator mengembalikan null — dan rute tidak pernah menjawab 201 kosong', async () => {
  assert.equal(await store.addTransaction('usr_tidak_ada', barisHariIni(), { aktor: 'manusia' }), null);

  // Kode akses ikut mati bersama penggunanya, jadi lewat rute keadaan ini
  // tertangkap autentikasi (401). Cabang 404 di rute adalah benteng untuk
  // jendela balap yang tidak bisa dijangkau uji ujung-ke-ujung — keberadaan
  // cabang itu dijamin oleh `null` di atas, bukan oleh jalur HTTP.
  const { user, accessCode } = await penggunaSiap();
  await store.deleteUser(user.id);
  const res = await minta('/api/cashbook', { method: 'POST', kode: accessCode, body: JSON.stringify(barisHariIni()) });
  assert.equal(res.status, 401);
});

/* --------------------------------------------------------- Hidrasi demo */

test('hidrasi demo menolak peserta sungguhan — pintu belakang ke buku kas nyata tertutup', async () => {
  const { user } = await penggunaSiap();
  await assert.rejects(
    () => store.terapkanDemo(user.id, { profile: { namaUsaha: 'Palsu' } }),
    (err) => err instanceof GalatMutasi && err.kode === 'bukan-demo' && err.status === 403,
  );
  assert.equal(user.profile, null, 'profil peserta tidak tersentuh');

  const demo = await store.createUser({ name: 'Demo Sah', batch: 'DEMO' });
  const hasil = await store.terapkanDemo(demo.user.id, { profile: { namaUsaha: 'Warung Demo' } });
  assert.equal(hasil.profile.namaUsaha, 'Warung Demo', 'akun DEMO tetap terhidrasi seperti biasa');
});

/* --------------------------------------------- Perilaku rute tetap utuh */

test('rute lama tetap berperilaku sama: 201, ringkasan, dan baris yang terbaca GET', async () => {
  const { user, accessCode } = await penggunaSiap('Bu Utuh');
  const res = await minta('/api/cashbook', { method: 'POST', kode: accessCode, body: JSON.stringify(barisHariIni({ jenis: 'masuk', kategori: 'penjualan', jumlah: 50_000, keterangan: '' })) });
  assert.equal(res.status, 201);
  const isi = await res.json();
  assert.equal(isi.transaction.jumlah, 50_000);
  assert.ok(isi.summary, 'ringkasan tetap ikut');

  const daftar = await minta('/api/cashbook', { kode: accessCode });
  const rows = (await daftar.json()).transactions;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].origin, 'manual', 'medan tambahan mengalir apa adanya ke GET');
});

test('validasi rute yang ramah tidak berubah — kalimat dan statusnya persis seperti dulu', async () => {
  const { accessCode } = await penggunaSiap();
  const kasus = [
    [{ jenis: 'lain', kategori: 'penjualan', jumlah: 1000 }, 400, /harus "masuk" atau "keluar"/],
    [{ jenis: 'masuk', kategori: 'bukan-kategori', jumlah: 1000 }, 400, /tidak dikenali/],
    [{ jenis: 'masuk', kategori: 'penjualan', jumlah: 0 }, 400, /lebih dari 0/],
    [{ jenis: 'masuk', kategori: 'penjualan', jumlah: 1000, tanggal: '2999-01-01' }, 400, /masa depan/],
  ];
  for (const [body, status, pola] of kasus) {
    const res = await minta('/api/cashbook', { method: 'POST', kode: accessCode, body: JSON.stringify(body) });
    assert.equal(res.status, status, JSON.stringify(body));
    assert.match((await res.json()).error, pola);
  }
});
