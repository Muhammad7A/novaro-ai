/**
 * Uji rute memori advisori — GET /api/advisori/riwayat + hook checkpoint
 * di /api/fokus, plus kejujuran tampilan Riwayat Saran (Sesi G fase 2).
 *
 * Yang dijaga:
 *   - gerbang rute: 401 tanpa kode, 451 tanpa persetujuan (versi kini);
 *   - checkpoint berjalan SAAT DIBACA: rekam yang jatuh tempo dievaluasi dan
 *     ter-append TEPAT SEKALI di satu penulisan; input yang tak tersedia
 *     menghasilkan 'tak-terukur' yang tetap ter-append (kejujuran);
 *   - angka hasil hanya pernah dihitung dari bulan LENGKAP dan cukup rapat
 *     (isMonthComplete + isMonthReliable — ambang kernel, nol ambang baru);
 *   - deteksi konteks deterministik tampil di riwayat (prive > laba);
 *   - HTML Riwayat Saran jujur: hasil selalu berlabel "dihitung sistem dari
 *     angka buku kas", teks AI selalu berstempel, tidak ada versi karangan.
 *
 *   npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'nova-uji-advi-rute-'));
process.env.NOVA_DATA_DIR = DATA_DIR;
process.env.PORT = '0';
process.env.NOVA_AI_BACKEND = 'anthropic';
process.env.ANTHROPIC_API_KEY = '';
delete process.env.GOOGLE_CLOUD_PROJECT;
process.on('exit', () => rmSync(DATA_DIR, { recursive: true, force: true }));

const { store } = await import('../lib/store.js');
const { sanitasiRekomendasi } = await import('../lib/rekomendasi.js');
const { periksaMetaJejak } = await import('../lib/jejak.js');
const { CONSENT_VERSION } = await import('../lib/consent.js');
const app = (await import('../server.js')).default;

const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const BASE = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const AKAR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const minta = (jalur, { kode, ...opts } = {}) =>
  fetch(BASE + jalur, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(kode ? { Authorization: `Bearer ${kode}` } : {}),
      ...(opts.headers ?? {}),
    },
  });

/** Kebenaran disk — baca users.json langsung, bukan cache server. */
const penggunaDisk = (id) => {
  const raw = JSON.parse(readFileSync(path.join(DATA_DIR, 'users.json'), 'utf8'));
  return raw.users.find((u) => u.id === id);
};

/**
 * Menggeser bulan dasar satu advisori langsung di disk — cara jujur untuk
 * menguji checkpoint yang jatuh tempo tanpa menunggu bulan sungguhan berganti.
 * Server mendeteksi perubahan lewat sidik berkas dan membaca ulang.
 */
function geserBulanDasar(userId, bulan) {
  const file = path.join(DATA_DIR, 'users.json');
  const db = JSON.parse(readFileSync(file, 'utf8'));
  const u = db.users.find((x) => x.id === userId);
  u.advisori[0].dasarAngka.bulan = bulan;
  writeFileSync(file, JSON.stringify(db, null, 2), 'utf8');
  /*
   * Sidik berkas = ino:size:mtimeMs. Suntingan luar yang UKURANNYA SAMA
   * ('2026-09' → '2026-07' sama panjang) dan jatuh di milidetik yang sama
   * dengan flush server bisa lolos deteksi — server melayani cache basinya
   * dan checkpoint dianggap belum jatuh tempo. Majukan mtime eksplisit supaya
   * suntingan luar selalu terlihat. (Keterbatasan perlengkapan uji, bukan
   * jalur produksi: pengedit luar sungguhan selalu melewati kunci berkas.)
   */
  const kini = new Date();
  utimesSync(file, kini, new Date(kini.getTime() + 10));
}

/**
 * Menyemai satu bulan LENGKAP dan cukup rapat: ≥19 hari tercatat (cakupan
 * ≥ 0,6) dan ≥10 transaksi — ambang kernel, tanpa lebih. Prive besar pada
 * Agustus membuat deteksi 'prive-melebihi-laba' dan arah kas 'memburuk'.
 */
async function semaiBulan(userId, bulan, { priveBesar = false } = {}) {
  for (let hari = 1; hari <= 21; hari++) {
    const tanggal = `${bulan}-${String(hari).padStart(2, '0')}`;
    await store.addTransaction(userId, {
      tanggal, jenis: 'masuk', kategori: 'penjualan', jumlah: 100_000,
    }, { aktor: 'manusia' });
  }
  await store.addTransaction(userId, {
    tanggal: `${bulan}-02`, jenis: 'keluar', kategori: 'operasional',
    keterangan: 'belanja bahan', jumlah: priveBesar ? 100_000 : 300_000,
  }, { aktor: 'manusia' });
  if (priveBesar) {
    await store.addTransaction(userId, {
      tanggal: `${bulan}-03`, jenis: 'keluar', kategori: 'prive',
      keterangan: 'ambil untuk pribadi', jumlah: 5_000_000,
    }, { aktor: 'manusia' });
  }
}

const rekomendasiBersih = () => sanitasiRekomendasi({
  ringkasan: 'Laba sehat — pertahankan ritme mencatat.',
  rekomendasi: [{
    judul: 'Tetapkan prive mingguan', prioritas: 'sedang',
    alasan: 'Prive terakhir besar.', langkah: ['Tentukan jadwal prive'],
    dampak: 'Kas lebih tertib.', modulTerkait: 23,
  }],
  peringatan: [], targetBulanIni: [],
});

/* ------------------------------------------------------------ Peserta uji */

const utama = await store.createUser({ name: 'Bu Utama', business: 'Warung Utama', batch: 'B1' });
await store.saveConsent(utama.user.id, CONSENT_VERSION);
await store.saveProfile(utama.user.id, { namaUsaha: 'Warung Utama', jenisUsaha: 'kuliner', pencatatan: 'buku', tujuan: 'naikkan-laba', omzetBulanan: 5_000_000 });
await semaiBulan(utama.user.id, '2026-07');
await semaiBulan(utama.user.id, '2026-08', { priveBesar: true });

const tanpaSetuju = await store.createUser({ name: 'Bu Setuju', business: '', batch: 'B2' });

const kosong = await store.createUser({ name: 'Bu Kosong', business: '', batch: 'B2' });
await store.saveConsent(kosong.user.id, CONSENT_VERSION);

const tanpaBuku = await store.createUser({ name: 'Bu Tanpa Buku', business: '', batch: 'B2' });
await store.saveConsent(tanpaBuku.user.id, CONSENT_VERSION);
await store.simpanRekomendasi(tanpaBuku.user.id, rekomendasiBersih(), { input_tokens: 5, output_tokens: 5 }, { model: 'm-uji' });

const fokusUser = await store.createUser({ name: 'Bu Fokus', business: '', batch: 'B2' });
await store.saveConsent(fokusUser.user.id, CONSENT_VERSION);

await store.simpanRekomendasi(utama.user.id, rekomendasiBersih(), { input_tokens: 5, output_tokens: 5 }, { model: 'm-uji' });

/* ------------------------------------------------------------------ Gerbang */

test('riwayat: 401 tanpa kode akses', async () => {
  const res = await minta('/api/advisori/riwayat');
  assert.equal(res.status, 401);
});

test('riwayat: 451 tanpa persetujuan versi kini', async () => {
  const res = await minta('/api/advisori/riwayat', { kode: tanpaSetuju.accessCode });
  assert.equal(res.status, 451);
});

test('riwayat kosong: bentuk jujur, deteksi null — bulan kosong tidak dikarang', async () => {
  const res = await minta('/api/advisori/riwayat', { kode: kosong.accessCode });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.riwayat, []);
  assert.equal(body.deteksi, null);
});

test('riwayat: rekam tampil berstempel, hasil belum jatuh tempo — bukan hasil karangan', async () => {
  const res = await minta('/api/advisori/riwayat', { kode: utama.accessCode });
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(body.riwayat.length, 1);
  const a = body.riwayat[0];
  assert.equal(a.jenis, 'rekomendasi');
  assert.equal(a.sumber, 'ai');
  assert.equal(a.model, 'm-uji');
  assert.equal(a.berlaku, true);
  assert.ok(a.ringkasan.length > 0);
  // Bulan checkpoint-nya masih berjalan: tidak ada hasil yang dikarang.
  assert.equal(a.evaluasi, null);
});

test('deteksi konteks: prive melebihi laba terdeteksi dari bulan lengkap — deterministik', async () => {
  const res = await minta('/api/advisori/riwayat', { kode: utama.accessCode });
  const body = await res.json();
  assert.equal(body.deteksi?.id, 'prive-melebihi-laba');
  assert.match(body.deteksi.alasan, /prive/i);
});

/* -------------------------------------------------- Checkpoint saat dibaca */

test('checkpoint jatuh tempo: dievaluasi dan ter-append sekali — angka dari buku kas', async () => {
  geserBulanDasar(utama.user.id, '2026-07'); // bulan periksa = 2026-08, sudah lewat

  const res = await minta('/api/advisori/riwayat', { kode: utama.accessCode });
  assert.equal(res.status, 200);
  const body = await res.json();
  const e = body.riwayat[0].evaluasi;
  assert.ok(e, 'hasil ikut dalam jawaban yang sama');
  assert.equal(e.status, 'terukur');
  assert.equal(e.metode, 'komparsi-bulan');
  assert.equal(e.bulanDasar, '2026-07');
  assert.equal(e.bulanCek, '2026-08');
  // Agustus laba lebih besar (prive tidak mengurangi laba) — membaik.
  assert.equal(e.dimensi.labaBersih.status, 'membaik');
  // Kas Agustus menyusut tajam karena prive besar — memburuk, jujur.
  assert.equal(e.dimensi.saldoKas.status, 'memburuk');

  // Kebenaran disk: SATU rekam evaluasi + jejak eventnya.
  const disk = penggunaDisk(utama.user.id);
  assert.equal(disk.evaluasiAdvisori.length, 1);
  assert.equal(disk.events.filter((ev) => ev.type === 'evaluasi_advisori').length, 1);
  assert.equal(disk.events.at(-1).meta.status, 'terukur');

  // Pembacaan kedua: tidak ada yang di-append ulang.
  await minta('/api/advisori/riwayat', { kode: utama.accessCode });
  assert.equal(penggunaDisk(utama.user.id).evaluasiAdvisori.length, 1);
});

test('checkpoint tanpa buku kas: tak-terukur tetap ter-append — kejujuran, bukan keheningan', async () => {
  geserBulanDasar(tanpaBuku.user.id, '2026-07');

  const res = await minta('/api/advisori/riwayat', { kode: tanpaBuku.accessCode });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.riwayat[0].evaluasi.status, 'tak-terukur');

  const disk = penggunaDisk(tanpaBuku.user.id);
  assert.equal(disk.evaluasiAdvisori.length, 1, 'ketiadaan hasil terlihat, bukan hening');
  assert.equal(disk.evaluasiAdvisori[0].status, 'tak-terukur');
});

test('hook /api/fokus: checkpoint ikut berjalan saat fokus dibaca', async () => {
  await store.simpanRekomendasi(fokusUser.user.id, rekomendasiBersih(), { input_tokens: 5, output_tokens: 5 }, { model: 'm-uji' });
  geserBulanDasar(fokusUser.user.id, '2026-07');

  const res = await minta('/api/fokus', { kode: fokusUser.accessCode });
  assert.equal(res.status, 200);
  assert.ok((await res.json()).fokus);

  const disk = penggunaDisk(fokusUser.user.id);
  assert.equal(disk.evaluasiAdvisori.length, 1, 'fokus membawa checkpoint yang jatuh tempo');
});

/* ---------------------------------------------------- Tap "saya sudah coba" */

const tapUser = await store.createUser({ name: 'Bu Tap', business: '', batch: 'B2' });
await store.saveConsent(tapUser.user.id, CONSENT_VERSION);
await store.simpanRekomendasi(tapUser.user.id, rekomendasiBersih(), { input_tokens: 5, output_tokens: 5 }, { model: 'm-uji' });
const advTap = (await store.findUserById(tapUser.user.id)).advisori[0].id;

test('tap: 401 tanpa kode; 451 tanpa persetujuan; 400 id asing; 404 id tak ada', async () => {
  const kosong = await minta('/api/advisori/tindak', { method: 'POST', body: JSON.stringify({ advisoriId: advTap }) });
  assert.equal(kosong.status, 401);

  const belum = await store.createUser({ name: 'Belum Tap', business: '', batch: 'B2' });
  const t451 = await minta('/api/advisori/tindak', { kode: belum.accessCode, method: 'POST', body: JSON.stringify({ advisoriId: advTap }) });
  assert.equal(t451.status, 451);

  const asing = await minta('/api/advisori/tindak', { kode: tapUser.accessCode, method: 'POST', body: JSON.stringify({ advisoriId: 'bukan-id' }) });
  assert.equal(asing.status, 400);

  const hantu = await minta('/api/advisori/tindak', { kode: tapUser.accessCode, method: 'POST', body: JSON.stringify({ advisoriId: 'adv_000000000000' }) });
  assert.equal(hantu.status, 404);
});

test('tap: satu ketukan = satu peristiwa; tap kedua id sama = no-op idempoten', async () => {
  const t1 = await minta('/api/advisori/tindak', { kode: tapUser.accessCode, method: 'POST', body: JSON.stringify({ advisoriId: advTap }) });
  assert.equal(t1.status, 200);
  assert.deepEqual(await t1.json(), { sudah: false });

  // Kebenaran disk: peristiwa contentless {id}, tanpa teks, tanpa nominal.
  let disk = penggunaDisk(tapUser.user.id);
  const tap = disk.events.filter((e) => e.type === 'advisori_ditindaki');
  assert.equal(tap.length, 1);
  assert.deepEqual(tap[0].meta, { id: advTap });
  assert.deepEqual(periksaMetaJejak('advisori_ditindaki', tap[0].meta), []);

  // Riwayat membeberkannya dengan tanggal — sinyal eksplisit tampil apa adanya.
  const r1 = await (await minta('/api/advisori/riwayat', { kode: tapUser.accessCode })).json();
  assert.ok(r1.riwayat[0].ditindakiPada, 'riwayat membawa waktu tap');

  // Tap kedua: no-op — bukan peristiwa kedua, bukan penimpaan.
  const t2 = await minta('/api/advisori/tindak', { kode: tapUser.accessCode, method: 'POST', body: JSON.stringify({ advisoriId: advTap }) });
  assert.equal(t2.status, 200);
  assert.deepEqual(await t2.json(), { sudah: true });
  disk = penggunaDisk(tapUser.user.id);
  assert.equal(disk.events.filter((e) => e.type === 'advisori_ditindaki').length, 1, 'idempoten: satu keputusan, satu peristiwa');
});

test('tap: nol tulisan uang — transaksi dan slot tidak tersentuh', async () => {
  const sebelum = penggunaDisk(tapUser.user.id);
  await minta('/api/advisori/tindak', { kode: tapUser.accessCode, method: 'POST', body: JSON.stringify({ advisoriId: advTap }) });
  const sesudah = penggunaDisk(tapUser.user.id);
  assert.equal(sesudah.transactions.length, sebelum.transactions.length);
  assert.equal(sesudah.recommendations?.ringkasan, sebelum.recommendations?.ringkasan, 'slot tetap utuh — tap bukan tulisan uang');
});

test('HTML: tombol "Saya sudah coba" + label kejujuran + endpoint terekam', () => {
  const html = readFileSync(path.join(AKAR, 'public', 'index.html'), 'utf8');
  assert.match(html, /Saya sudah coba/, 'tombol satu-ketuknya ada');
  assert.match(html, /kamu menandai mencoba ini \(/, 'label kebenaran tampilan membaca data server');
  assert.match(html, /\/advisori\/tindak/, 'endpoint eksplisit yang dipanggil');
  assert.match(html, /renderTindakAdvisori/, 'hanya entri aktif yang menawarkan tombol');
  assert.doesNotMatch(html, /gemini/i);
});

/* --------------------------------------------------- Kejujuran tampilan */

test('HTML Riwayat Saran jujur: hasil berlabel sistem, teks AI berstempel', () => {
  const html = readFileSync(path.join(AKAR, 'public', 'index.html'), 'utf8');

  assert.match(html, /Riwayat Saran/, 'seksinya ada');
  assert.match(html, /loadRiwayat/, 'pemuatnya ada');
  // Label hasil — wajib hadir di SEMUA cabang render (belum tempo, tak-terukur, terukur).
  const hitungLabel = html.split('dihitung sistem dari angka buku kas').length - 1;
  assert.ok(hitungLabel >= 3, `label hasil wajib di semua cabang render (ditemukan ${hitungLabel})`);
  // Rambu identitas yang sama dengan seluruh aplikasi: tidak ada nama model statis.
  assert.doesNotMatch(html, /gemini/i);
  // Peringatan korelasi tampil — arah angka bukan janji sebab-akibat.
  assert.match(html, /bukan jaminan sebab-akibat/);
});
