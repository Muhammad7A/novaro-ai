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
