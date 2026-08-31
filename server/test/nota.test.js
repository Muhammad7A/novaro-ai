/**
 * Uji fitur scan nota (foto → AI → konfirmasi).
 *
 * Invariant yang dijaga berkas ini, di atas segalanya: hasil scan TIDAK
 * PERNAH menyimpan apa pun. Rute /api/scan-nota hanya boleh mengembalikan
 * usulan; penyimpanan hanya lewat /api/cashbook yang sama dengan input
 * manual, setelah peserta menekan tombolnya sendiri.
 *
 * Sesuai konvensi uji repo ini, layanan AI TIDAK PERNAH dipanggil — yang
 * diuji: (1) fungsi murni pembersih hasil AI di lib/nota.js secara menyeluruh
 * (di situlah semua keputusan keamanan hasil AI hidup), dan (2) semua pagar
 * rute yang bekerja SEBELUM panggilan AI (autentikasi, berkas, ukuran,
 * AI belum diatur). Env disanitasi sebelum server diimpor agar keadaan
 * "AI belum diatur" pasti tercapai di mesin mana pun.
 *
 *   npm test
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'nova-uji-nota-'));

// Sanitasi env SEBELUM server.js diimpor — dotenv tidak menimpa variabel
// yang sudah ada, jadi kondisi "AI belum diatur" dijamin tercapai.
process.env.NOVA_DATA_DIR = DATA_DIR;
process.env.PORT = '0';
process.env.NOVA_AI_BACKEND = 'anthropic';
process.env.ANTHROPIC_API_KEY = '';
delete process.env.GOOGLE_CLOUD_PROJECT;
delete process.env.VERTEX_PROJECT_ID;
delete process.env.GCP_PROJECT;
delete process.env.PROJECT_ID;
process.on('exit', () => rmSync(DATA_DIR, { recursive: true, force: true }));

const { store } = await import('../lib/store.js');
const { CONSENT_VERSION } = await import('../lib/consent.js');
const { KATEGORI } = await import('../lib/cashbook.js');
const { kenaliGambar, parseNotaJson, petakanKategori, sanitasiHasilNota, tingkatKeyakinan } = await import('../lib/nota.js');

const HARI_INI = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

/* ================================================== Kenali gambar */

test('magic number menentukan jenis gambar, bukan header klien', () => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(64),
  ]);
  const webp = Buffer.concat([Buffer.from('RIFF....WEBP', 'binary'), Buffer.alloc(64)]);

  assert.equal(kenaliGambar(jpeg), 'image/jpeg');
  assert.equal(kenaliGambar(png), 'image/png');
  assert.equal(kenaliGambar(webp), 'image/webp');
  // Byte acak, teks, tubuh kosong, potongan kecil — semua bukan gambar.
  assert.equal(kenaliGambar(Buffer.from('BUKAN GAMBAR SAMA SEKALI — hanya teks panjang')), null);
  assert.equal(kenaliGambar(Buffer.alloc(0)), null);
  assert.equal(kenaliGambar(Buffer.from([0xff, 0xd8])), null); // JPEG terpotong
  assert.equal(kenaliGambar(null), null);
});

/* ================================================== Parse JSON model */

test('parseNotaJson: JSON murni, berfence, dan dibungkus kalimat — semuanya terbaca', () => {
  assert.deepEqual(parseNotaJson('{"amount":1}'), { amount: 1 });
  assert.deepEqual(parseNotaJson('```json\n{"amount":1}\n```'), { amount: 1 });
  assert.deepEqual(parseNotaJson('Berikut hasilnya:\n{"amount":1}\nSemoga membantu.'), { amount: 1 });
});

test('parseNotaJson: teks tanpa JSON dan JSON rusak ditolak dengan galat siap-tampil', () => {
  for (const teks of ['Maaf, saya tidak bisa membaca nota itu.', '{ "amount": ', '']) {
    try {
      parseNotaJson(teks);
      assert.fail('harusnya melempar');
    } catch (err) {
      assert.equal(err.status, 502);
      assert.match(err.message, /tidak terbaca/i);
    }
  }
});

/* ================================================== Pemetaan kategori */

test('kategori baku tidak pernah dikarang — hanya yang sudah ada di KATEGORI', () => {
  // Kata kunci nota pilihan juri
  assert.equal(petakanKategori('bahan makanan', 'keluar'), 'belanja-bahan');
  assert.equal(petakanKategori('sembako grosir', 'keluar'), 'belanja-bahan');
  assert.equal(petakanKategori('beras minyak telur', 'keluar'), 'belanja-bahan');
  assert.equal(petakanKategori('pertalite spbu', 'keluar'), 'operasional');
  assert.equal(petakanKategori('token listrik pln', 'keluar'), 'operasional');
  assert.equal(petakanKategori('gas 3kg', 'keluar'), 'operasional');
  assert.equal(petakanKategori('cicilan koperasi', 'keluar'), 'cicilan');
  // Model yang patuh skema dan menjawab id baku langsung — diterima.
  assert.equal(petakanKategori('belanja-bahan', 'keluar'), 'belanja-bahan');
  // Tidak ada pemetaan yang masuk akal → null, bukan kategori baru.
  assert.equal(petakanKategori('jasa courier instan', 'keluar'), null);
  assert.equal(petakanKategori('', 'keluar'), null);
  assert.equal(petakanKategori('bahan', 'jenis-palsu'), null, 'jenis tidak sah → null');
  // Kata kunci masuk: hanya kategori masuk yang boleh.
  assert.equal(petakanKategori('penjualan mingguan', 'masuk'), 'penjualan');
  assert.equal(petakanKategori('penjualan', 'keluar'), null, 'kategori masuk tidak bocor ke keluar');
});

test('seluruh kategori hasil pemetaan benar-benar ada di KATEGORI aplikasi', () => {
  for (const jenis of ['masuk', 'keluar']) {
    for (const [kategori] of Object.entries(KATEGORI[jenis])) {
      // Id baku harus selalu diterima petanya sendiri — kontrak pemetaan.
      assert.equal(petakanKategori(kategori, jenis), kategori);
    }
  }
});

/* ================================================== Keyakinan */

test('tingkat keyakinan mengikuti ambang: 0.85 / 0.60', () => {
  assert.equal(tingkatKeyakinan(0.9), 'ok');
  assert.equal(tingkatKeyakinan(0.85), 'ok');
  assert.equal(tingkatKeyakinan(0.84), 'warning');
  assert.equal(tingkatKeyakinan(0.6), 'warning');
  assert.equal(tingkatKeyakinan(0.59), 'low');
  assert.equal(tingkatKeyakinan(0), 'low');
  assert.equal(tingkatKeyakinan(undefined), 'low');
});

/* ================================================== Sanitasi hasil */

const HASIL_BAIK = {
  type: 'expense',
  amount: 120000,
  category: 'sembako',
  description: 'Belanja mingguan',
  merchant: 'Warung Makmur',
  date: '2026-08-30',
  confidence: 0.92,
};

test('hasil AI yang baik diteruskan utuh sesuai bentuk aplikasi', () => {
  const h = sanitasiHasilNota(HASIL_BAIK, { hariIni: '2026-08-31' });
  assert.deepEqual(h, {
    jenis: 'keluar',
    jumlah: 120000,
    kategori: 'belanja-bahan',
    keterangan: 'Belanja mingguan',
    merchant: 'Warung Makmur',
    tanggal: '2026-08-30',
    confidence: 0.92,
    tingkat: 'ok',
  });
});

test('income dikonversi ke masuk; type asing tidak pernah meledakkan apa pun', () => {
  assert.equal(sanitasiHasilNota({ ...HASIL_BAIK, type: 'income' }, { hariIni: HARI_INI }).jenis, 'masuk');
  assert.equal(sanitasiHasilNota({ ...HASIL_BAIK, type: 'entahlah' }, { hariIni: HARI_INI }).jenis, 'keluar');
});

test('angka: 0, negatif, NaN, dan melebihi batas → null, bukan dikoreksi diam-diam', () => {
  const h = (amount) => sanitasiHasilNota({ ...HASIL_BAIK, amount }, { hariIni: HARI_INI }).jumlah;
  assert.equal(h(0), null);
  assert.equal(h(-5000), null);
  assert.equal(h('bukan angka'), null);
  assert.equal(h(null), null);
  assert.equal(h(undefined), null);
  assert.equal(h(2e12), 1e12, 'dipotong ke batas yang sama dengan rute cashbook');
  // Bentuk angka Indonesia dan marketplace tetap dibaca benar.
  assert.equal(h('120.000'), 120000);
  assert.equal(h('120,000'), 120000);
  assert.equal(h('Rp 1.200.000'), 1200000);
  assert.equal(h(120000.4), 120000, 'dibulatkan ke rupiah');
});

test('tanggal: format salah, masa depan, dan terlalu lama → null', () => {
  const h = (date) => sanitasiHasilNota({ ...HASIL_BAIK, date }, { hariIni: '2026-08-31' }).tanggal;
  assert.equal(h('31/08/2026'), null);
  assert.equal(h('2026-13-40'), null);
  assert.equal(h('2027-01-01'), null, 'tidak boleh di masa depan');
  assert.equal(h('2019-01-01'), null, 'lewat batas 5 tahun rute cashbook');
  assert.equal(h(null), null);
  assert.equal(h('2026-08-30'), '2026-08-30');
});

test('kategori asing dan teks kepanjangan: null dan terpotong, tidak pernah meledak', () => {
  const h = sanitasiHasilNota(
    {
      ...HASIL_BAIK,
      category: 'langganan streaming asia',
      description: 'x'.repeat(500),
      merchant: 'y'.repeat(300),
      confidence: 7,
    },
    { hariIni: HARI_INI },
  );
  assert.equal(h.kategori, null);
  assert.equal(h.keterangan.length, 120);
  assert.equal(h.merchant.length, 80);
  assert.equal(h.confidence, 1, 'clamp ke 1');
});

test('obyek asing dari model ditolak dengan galat siap-tampil', () => {
  for (const mentah of [null, 'teks', 42, [], undefined]) {
    try {
      sanitasiHasilNota(mentah, { hariIni: HARI_INI });
      assert.fail('harusnya melempar');
    } catch (err) {
      assert.equal(err.status, 502);
    }
  }
});

/* ================================================== Rute /api/scan-nota */

const app = (await import('../server.js')).default;

const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const BASE = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const { user, accessCode } = await store.createUser({ name: 'Bu Scan', business: 'Warung Bu Scan' });
await store.saveConsent(user.id, CONSENT_VERSION);
// Profil usaha: /api/me hanya mengirim metrik bila profil terisi — sama
// dengan peserta sungguhan yang mengisi formulir sebelum mencatat.
await store.saveProfile(user.id, {
  namaUsaha: 'Warung Bu Scan',
  jenisUsaha: 'kuliner',
  lokasi: 'Semarang',
  lamaUsahaBulan: 12,
  jumlahKaryawan: 0,
  produkUtama: 'Nasi rames',
  omzetBulanan: 5000000,
  belanjaBulanan: 2500000,
  biayaOperasional: 500000,
  cicilanBulanan: 0,
  pencatatan: 'aplikasi',
  rekeningTerpisah: false,
  punyaNib: false,
  tujuan: 'rapikan-keuangan',
  tantangan: '',
});

const JPEG_SAH = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);

const mintaScan = ({ kode = accessCode, body = JPEG_SAH, tipe = 'image/jpeg', ...opts } = {}) =>
  fetch(BASE + '/api/scan-nota', {
    method: 'POST',
    ...opts,
    headers: {
      ...(kode ? { Authorization: `Bearer ${kode}` } : {}),
      ...(tipe ? { 'Content-Type': tipe } : {}),
      ...(opts.headers ?? {}),
    },
    ...(body ? { body } : {}),
  });

test('tanpa kode akses: 401, bukan pesan galat AI', async () => {
  const res = await mintaScan({ kode: '' });
  assert.equal(res.status, 401);
});

test('kode asing: 401', async () => {
  const res = await mintaScan({ kode: 'NOVA-AAAA-BBBB' });
  assert.equal(res.status, 401);
});

test('tanpa tubuh: 400 yang menjelaskan', async () => {
  const res = await mintaScan({ body: null, tipe: 'image/jpeg' });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /tidak terkirim|tidak terbaca/i);
});

test('content-type teks: ditolak sebagai berkas tidak terbaca (parser raw dilewati)', async () => {
  const res = await mintaScan({ body: 'ini bukan gambar', tipe: 'text/plain' });
  assert.equal(res.status, 400);
});

test('byte korup berlabel jpeg: ditolak via pemeriksaan isi, bukan header', async () => {
  const res = await mintaScan({ body: Buffer.from('PNG-PALSU-yang-berisi-teks-biasa-panjang-agar-melewati-ambang-minimal-byte'), tipe: 'image/jpeg' });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /bukan gambar/i);
});

test('foto kebesaran: 413 dengan kalimat yang bisa ditindaklanjuti', async () => {
  const besar = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(5 * 1024 * 1024)]);
  const res = await mintaScan({ body: besar });
  assert.equal(res.status, 413);
  assert.match((await res.json()).error, /kebesaran/i);
});

test('gambar sah + AI belum diatur: 503 yang jujur soal sebabnya', async () => {
  const res = await mintaScan();
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /AI/);
});

test('INVARIANT: seluruh percobaan scan tidak pernah membuat satu transaksi pun', async () => {
  const trx = await store.getTransactions(user.id);
  assert.equal(trx.length, 0);
});

test('konfirmasi → rute cashbook LAMA tetap satu-satunya pintu simpan', async () => {
  /*
   * Persis alur peserta: hasil scan adalah USULAN; yang disimpan adalah
   * angka SETELAH dia mengedit (120.000 dari AI, dia simpan 125.000).
   * Bila hasil simpan menyimpang dari ini berarti fitur scan membuat
   * jalur kedua — dan itu bug, bukan fitur.
   */
  const usulan = sanitasiHasilNota(HASIL_BAIK, { hariIni: HARI_INI });
  assert.equal(usulan.jumlah, 120000); // angka dari AI

  const res = await fetch(BASE + '/api/cashbook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessCode}` },
    body: JSON.stringify({
      jenis: usulan.jenis,
      kategori: 'belanja-bahan', // peserta mengganti kategori hasil null AI
      jumlah: 125000, // peserta mengoreksi angka
      keterangan: usulan.merchant,
      tanggal: HARI_INI,
    }),
  });
  assert.equal(res.status, 201);
  const data = await res.json();
  assert.equal(data.transaction.jumlah, 125000, 'yang tersimpan adalah nilai hasil konfirmasi');
  assert.equal(data.transaction.kategori, 'belanja-bahan');
  assert.ok(data.metrics, 'metrik ikut terbarui seperti input manual');
  assert.equal(data.summary.penjualan, 0);
  assert.ok(data.summary.belanjaBahan >= 125000);

  // dan dashboard/percakapan AI membaca dari sumber yang sama:
  const saya = await fetch(BASE + '/api/me', { headers: { Authorization: `Bearer ${accessCode}` } });
  const isi = await saya.json();
  assert.ok(isi.metrics, 'metrik pengguna terisi dari transaksi hasil konfirmasi');
});
