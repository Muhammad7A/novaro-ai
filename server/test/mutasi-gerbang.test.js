/*
 * Gerbang kepercayaan mutator buku kas — lantai tulis uang.
 *
 * Kontrak yang dipatok di sini (Session A, lib/store.js `addTransaction` +
 * `GalatMutasi`; keputusan arsitektur §9.1, §19 kelas 1/3/4/6, §21.8):
 *
 *   1. Validasi deterministik hidup DI MUTATOR, bukan hanya di rute —
 *      pemanggil internal (CLI, otomasi, pemanggil masa depan) tidak bisa
 *      membeli jalan pintas dengan melewati HTTP.
 *   2. MESIN TIDAK PERNAH MENULIS PENGHASILAN — dan hari ini mesin tidak
 *      menulis apa pun: asal `rule`/`transfer` belum punya penulisnya.
 *   3. Asal baris (`origin`) DITETAPKAN server — apa pun yang dibawa tubuh
 *      permintaan atau pemanggil lalui dibuang; provenance palsu tidak pernah
 *      sampai ke buku (stop-ship §21.8).
 *   4. `requestId` membuat satu niat tidak bisa menjadi dua baris — ketukan
 *      ganda dan kirim ulang ditolak `duplikat` (409).
 *   5. Mutasi yang DITOLAK tidak meninggalkan apa pun: tidak baris setengah
 *      jadi, tidak peristiwa yatim, tidak tulisan ke disk.
 *
 * Rute boleh menolak lebih dulu demi kalimat ramah — rute BUKAN penegak
 * terakhir. Uji di sini menyerang mutatornya langsung, persis seperti yang
 * akan dilakukan pemanggil internal yang lalai atau jahat.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'nova-uji-gerbang-'));
process.env.NOVA_DATA_DIR = DATA_DIR;
process.env.PORT = '0';
process.env.NOVA_AI_BACKEND = 'anthropic';
process.env.ANTHROPIC_API_KEY = '';
delete process.env.GOOGLE_CLOUD_PROJECT;
process.on('exit', () => rmSync(DATA_DIR, { recursive: true, force: true }));

const { store, GalatMutasi } = await import('../lib/store.js');
const app = (await import('../server.js')).default;

const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const BASE = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const { user, accessCode } = await store.createUser({ name: 'Bu Gerbang', business: 'Warung Gerbang', batch: 'B1' });
await store.saveConsent(user.id, 2);
const hariIni = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

const tolakan = async (janjian, eksekusi) => {
  const sebelum = (await store.getTransactions(user.id)).length;
  const peristiwaSebelum = (await store.getEvents(user.id)).length;
  try {
    await eksekusi();
    assert.fail(`seharusnya ditolak (${janjian})`);
  } catch (err) {
    assert.ok(err instanceof GalatMutasi, `penolakan harus GalatMutasi, bukan ${err?.name}`);
    assert.equal(err.kode, janjian.kode, janjian.pesan ?? 'kode penolakan');
    assert.equal(err.status, janjian.status, 'status HTTP penolakan');
  }
  // Mutasi yang ditolak tidak meninggalkan apa pun — tidak baris, tidak
  // peristiwa yatim, dan (karena cache dibuang saat lempar) tidak tulisan.
  assert.equal((await store.getTransactions(user.id)).length, sebelum, 'tidak boleh ada baris sisa');
  assert.equal((await store.getEvents(user.id)).length, peristiwaSebelum, 'tidak boleh ada peristiwa yatim');
};

/* ─────────────────────────── Aktor: siapa yang menulis ─────────────────── */

test('tanpa pernyataan aktor, tulisan ditolak — diam-dianggap-manusia adalah celah', async () => {
  await tolakan(
    { kode: 'aktor-tidak-sah', status: 400 },
    () => store.addTransaction(user.id, { tanggal: hariIni, jenis: 'keluar', kategori: 'operasional', jumlah: 10_000 }),
  );
});

test('mesin tidak menulis penghasilan — invarian stop-ship T1', async () => {
  await tolakan(
    { kode: 'mesin-penghasilan', status: 403 },
    () => store.addTransaction(user.id, { tanggal: hariIni, jenis: 'masuk', kategori: 'penjualan', jumlah: 50_000 }, { aktor: 'mesin' }),
  );
});

test('mesin hari ini tidak menulis apa pun — pengeluaran pun belum punya asal sah', async () => {
  await tolakan(
    { kode: 'mesin-tanpa-asal', status: 403 },
    () => store.addTransaction(user.id, { tanggal: hariIni, jenis: 'keluar', kategori: 'operasional', jumlah: 5_000 }, { aktor: 'mesin' }),
  );
});

/* ─────────────────  Validasi di batas tulis, bukan hanya di rute ───────── */

test('pemanggil internal tidak bisa melewati pemeriksaan jenis dan kategori', async () => {
  await tolakan(
    { kode: 'jenis', status: 400 },
    () => store.addTransaction(user.id, { tanggal: hariIni, jenis: 'pemasukan', kategori: 'penjualan', jumlah: 1 }, { aktor: 'manusia' }),
  );
  await tolakan(
    { kode: 'kategori', status: 400 },
    () => store.addTransaction(user.id, { tanggal: hariIni, jenis: 'keluar', kategori: 'hadiah langsung', jumlah: 1 }, { aktor: 'manusia' }),
  );
});

test('jumlah nol, negatif, dan tak terbaca ditolak di mutator — bukan didiamkan', async () => {
  for (const jumlah of [0, -5_000, NaN, 'banyak']) {
    await tolakan(
      { kode: 'jumlah', status: 400 },
      () => store.addTransaction(user.id, { tanggal: hariIni, jenis: 'keluar', kategori: 'operasional', jumlah }, { aktor: 'manusia' }),
    );
  }
});

test('jumlah raksasa dijepit ke batas kontrak, bukan ditolak diam-diam atau diterima utuh', async () => {
  const baris = await store.addTransaction(user.id, {
    tanggal: hariIni, jenis: 'keluar', kategori: 'operasional', jumlah: 5e12,
  }, { aktor: 'manusia' });
  assert.equal(baris.jumlah, 1e12, 'sama dengan semantik asNumber di rute');
});

test('jendela tanggal ditegakkan mutator: masa depan dan terlalu lampau ditolak', async () => {
  await tolakan(
    { kode: 'tanggal-masa-depan', status: 400 },
    () => store.addTransaction(user.id, { tanggal: '2999-01-01', jenis: 'keluar', kategori: 'operasional', jumlah: 1 }, { aktor: 'manusia' }),
  );
  await tolakan(
    { kode: 'tanggal-terlalulama', status: 400 },
    () => store.addTransaction(user.id, { tanggal: '2001-01-01', jenis: 'keluar', kategori: 'operasional', jumlah: 1 }, { aktor: 'manusia' }),
  );
});

/* ─────────────────────────── Provenance: siapa punya asal ──────────────── */

test('asal dan medan milik-server dari tubuh permintaan dibuang, bukan diwarisi', async () => {
  const baris = await store.addTransaction(user.id, {
    tanggal: hariIni, jenis: 'masuk', kategori: 'penjualan', jumlah: 12_345,
    // Sisipan palsu — kalau satu pun ikut tersimpan, provenance bisa dipalsukan:
    id: 'trx_palsu', origin: 'nota', proposalId: 'pp_01', requestId: 'siup-an-jangan', voided: false,
  }, { aktor: 'manusia' });

  assert.match(baris.id, /^trx_[0-9a-f]{12}$/, 'id baru dibuat server');
  assert.equal(baris.origin, 'manual', 'satu-satunya asal sah hari ini adalah ketukan manusia');
  assert.equal(baris.proposalId, undefined);
  assert.equal(baris.voided, undefined);
  assert.equal(baris.requestId, undefined, 'requestId di tubuh bukan di opts — dibuang, bukan dipakai');
});

/* ───────────────────────────  Duplikat: satu niat, satu baris ──────────── */

test('id permintaan yang sama ditolak sebagai duplikat — ketukan ganda bukan dua baris', async () => {
  const args = [{ tanggal: hariIni, jenis: 'keluar', kategori: 'operasional', jumlah: 7_500 }, { aktor: 'manusia', requestId: 'ketukan-2026-09-11-a' }];
  await store.addTransaction(user.id, ...args);
  await tolakan({ kode: 'duplikat', status: 409 }, () => store.addTransaction(user.id, ...args));

  const sisa = (await store.getTransactions(user.id)).filter((t) => t.requestId === 'ketukan-2026-09-11-a');
  assert.equal(sisa.length, 1, 'persis satu baris dari satu niat');
});

test('id permintaan yang sama tetap duplikat walau isinya diganti — niat, bukan isi, yang dihitung', async () => {
  const opts = { aktor: 'manusia', requestId: 'ketukan-2026-09-11-b' };
  await store.addTransaction(user.id, { tanggal: hariIni, jenis: 'keluar', kategori: 'operasional', jumlah: 1_000 }, opts);
  await tolakan(
    { kode: 'duplikat', status: 409 },
    () => store.addTransaction(user.id, { tanggal: hariIni, jenis: 'keluar', kategori: 'prive', jumlah: 9_999 }, opts),
  );
});

test('id permintaan berbentuk asing ditolak, bukan didiamkan tanpa perlindungan', async () => {
  await tolakan(
    { kode: 'id-permintaan', status: 400 },
    () => store.addTransaction(user.id, { tanggal: hariIni, jenis: 'keluar', kategori: 'operasional', jumlah: 1_000 }, { aktor: 'manusia', requestId: 'x'.repeat(200) }),
  );
});

/* ───────────────────────────  Pintu belakang demo ──────────────────────── */

test('hidrasi demo tidak bisa menyentuh akun peserta sungguhan', async () => {
  await tolakan(
    { kode: 'bukan-demo', status: 403 },
    () => store.terapkanDemo(user.id, { name: 'Warung Sintetis' }),
  );
});

/* ────────────────────────  Rute HTTP: kontrak ujung-ke-ujung ───────────── */

async function simpan(isi, headers = {}) {
  return fetch(`${BASE}/api/cashbook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessCode}`, ...headers },
    body: JSON.stringify(isi),
  });
}

test('lewat HTTP: X-Request-Id yang sama ditolak 409 bertipe — dan buku hanya berisi satu', async () => {
  const isi = { tanggal: hariIni, jenis: 'keluar', kategori: 'operasional', keterangan: 'Listrik', jumlah: 20_000 };
  const pertama = await simpan(isi, { 'x-request-id': 'uijikirim-001' });
  assert.equal(pertama.status, 201, 'ketukan pertama diterima');

  const kedua = await simpan(isi, { 'x-request-id': 'uijikirim-001' });
  assert.equal(kedua.status, 409);
  const badan = await kedua.json();
  assert.equal(badan.kode, 'duplikat');

  const diBuku = (await store.getTransactions(user.id)).filter((t) => t.keterangan === 'Listrik');
  assert.equal(diBuku.length, 1);
});

test('lewat HTTP: provenance palsu di tubuh tidak pernah sampai ke baris', async () => {
  const jawaban = await simpan({
    tanggal: hariIni, jenis: 'masuk', kategori: 'penjualan', jumlah: 45_000,
    origin: 'nota', proposalId: 'pp_tiruan', voided: true, id: 'trx_tiruan',
  });
  assert.equal(jawaban.status, 201);

  const baris = (await store.getTransactions(user.id)).find((t) => t.jumlah === 45_000 && t.jenis === 'masuk');
  assert.equal(baris.origin, 'manual');
  assert.equal(baris.proposalId, undefined);
  assert.equal(baris.voided, undefined);
  assert.match(baris.id, /^trx_[0-9a-f]{12}$/);
});

test('lewat HTTP: X-Request-Id asing ditolak 400 bertipe dari mutator, bukan rute', async () => {
  const jawaban = await simpan(
    { tanggal: hariIni, jenis: 'keluar', kategori: 'operasional', jumlah: 1_000 },
    { 'x-request-id': 'ada spasi tidak sah' },
  );
  assert.equal(jawaban.status, 400);
  const badan = await jawaban.json();
  assert.equal(badan.kode, 'id-permintaan');
});
