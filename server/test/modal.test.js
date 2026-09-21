/**
 * Uji batas modal (M3) — kategori 'modal-masuk' dikeluarkan dari laba.
 *
 * Keputusan 2026-09-13: uang pindahan pemilik ke kas usaha (setoran awal,
 * tambahan modal) BUKAN penghasilan. Sebelum kategori ini ada, catatan itu
 * terpaksa masuk "penjualan" (menggelembungkan omzet + laba) atau
 * "lain-masuk" (tetap ikut laba lewat laba:true) — dan scan nota memetakan
 * "modal masuk" ke lain-masuk. Kini:
 *
 *   - laba bersih dihitung dari penjualan + lain-masuk SAJA;
 *   - saldo kas TETAP menghitung modal — uang nyata memang berpindah;
 *   - semua konsumen laba (skor, garis waktu, fokus, KUR, kartu) membaca
 *     SATU sumber: summarizeMonth → computeMetrics — diuji lewat identitas
 *     angka, bukan lewat menyalin rumusnya ke sini;
 *   - baris historis TIDAK di-retrofit: yang pernah dicatat lain-masuk
 *     tetap lain-masuk dan tetap terhitung sesuai catatannya.
 *
 *   npm test
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'nova-modal-uji-'));
process.env.NOVA_DATA_DIR = DATA_DIR;
process.env.PORT = '0';
process.on('exit', () => rmSync(DATA_DIR, { recursive: true, force: true }));

const { store } = await import('../lib/store.js');
const { CONSENT_VERSION } = await import('../lib/consent.js');
const { KATEGORI, isValidKategori, summarizeMonth, tanggalWIB } = await import('../lib/cashbook.js');
const { computeMetrics } = await import('../lib/metrics.js');
const { petakanKategori, sanitasiHasilNota } = await import('../lib/nota.js');
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

const hariIni = tanggalWIB();
const bulanIni = hariIni.slice(0, 7);
const hari = (n) => `${bulanIni}-${String(n).padStart(2, '0')}`;
// Hari ke-berapa bulan ini (WIB). Fixture dibangun relatif terhadap angka ini:
// tes M3 pernah date-rot karena mengasumsikan cakupan catatan ≥ 0,6 berlaku
// pada hari ke-13 — asumsi yang kedaluwarsa seiring kalender berjalan.
const hariBerjalan = Number(hariIni.slice(8, 10));
const hKe = (n) => Math.min(n, hariBerjalan);

async function penggunaSiap(nama = 'Bu Modal') {
  const { user, accessCode } = await store.createUser({ name: nama });
  await store.saveConsent(user.id, CONSENT_VERSION);
  return { user, accessCode };
}

/* ------------------------------------------- Enum: gerbang diperluas sadar */

test('modal-masuk sah untuk jenis masuk, tidak sah untuk keluar — enum tetap tertutup', async () => {
  assert.equal(isValidKategori('masuk', 'modal-masuk'), true);
  assert.equal(isValidKategori('keluar', 'modal-masuk'), false, 'penarikan modal bukan kategori baru — itu prive');
  // Enum tetap tertutup: id lain yang mirip tetap tidak sah.
  assert.equal(isValidKategori('masuk', 'modal'), false);
  assert.equal(isValidKategori('masuk', 'gaji'), false);
  assert.equal(KATEGORI.masuk['modal-masuk'].laba, false, 'modal tidak boleh ikut laba rugi');
  assert.equal(KATEGORI.masuk['modal-masuk'].label, 'Modal');
});

test('mutator menerima modal-masuk — pin gerbang enum yang diperluas', async () => {
  const { user } = await penggunaSiap();
  const row = await store.addTransaction(
    user.id,
    { jenis: 'masuk', kategori: 'modal-masuk', jumlah: 2_000_000, keterangan: 'setoran awal', tanggal: hari(hKe(5)) },
    { aktor: 'manusia' },
  );
  assert.equal(row.kategori, 'modal-masuk');
  assert.equal(row.origin, 'manual', 'asal baris tetap ditetapkan server');

  await assert.rejects(
    () => store.addTransaction(user.id, { jenis: 'keluar', kategori: 'modal-masuk', jumlah: 1000 }, { aktor: 'manusia' }),
    (err) => err.kode === 'kategori',
    'modal-masuk tidak sah untuk keluar — di mutator pun',
  );
});

/* --------------------------------------- Modal mengubah kas, bukan laba */

test('modal masuk mengubah saldo kas dan total masuk — laba bersih sama sekali tidak bergeser', async () => {
  const { user } = await penggunaSiap();
  await store.addTransaction(user.id, { jenis: 'masuk', kategori: 'penjualan', jumlah: 1_000_000, tanggal: hari(hKe(5)) }, { aktor: 'manusia' });
  await store.addTransaction(user.id, { jenis: 'keluar', kategori: 'belanja-bahan', jumlah: 400_000, tanggal: hari(hKe(5)) }, { aktor: 'manusia' });

  const trx0 = await store.getTransactions(user.id);
  const s0 = summarizeMonth(trx0, bulanIni);

  await store.addTransaction(user.id, { jenis: 'masuk', kategori: 'modal-masuk', jumlah: 2_000_000, tanggal: hari(hKe(5)) }, { aktor: 'manusia' });
  const s1 = summarizeMonth(await store.getTransactions(user.id), bulanIni);

  assert.equal(s0.labaBersih, 600_000);
  assert.equal(s1.labaBersih, 600_000, 'laba bersih tidak berubah oleh modal');
  assert.equal(s0.penjualan, 1_000_000);
  assert.equal(s1.penjualan, 1_000_000, 'modal tidak ikut penjualan');
  assert.equal(s0.lainMasuk, 0);
  assert.equal(s1.lainMasuk, 0, 'modal tidak ikut lain-masuk');
  assert.equal(s1.modalMasuk, 2_000_000, 'kolom modal sendiri, terbaca');
  assert.equal(s0.modalMasuk, 0);
  assert.equal(s1.totalMasuk - s0.totalMasuk, 2_000_000, 'uang nyata masuk ke total');
  assert.equal(s1.saldoKas - s0.saldoKas, 2_000_000, 'saldo kas naik persis sebesar modal');
  // Kolom setara sebulan ikut membawa modal — satu sumber untuk semua tampilan.
  // Faktor internalnya mentah (hariBulan/hariBerjalan); pembulatan 4 desimal
  // hanya untuk tampilan faktornya.
  assert.equal(
    s1.setara.modalMasuk,
    Math.round(s1.modalMasuk * (s1.hariBulan / s1.hariBerjalan)),
  );
});

test('skor kesehatan dan omzet tidak tersentuh modal — identitas satu sumber computeMetrics', async () => {
  const { user } = await penggunaSiap();
  // Satu catatan per hari berjalan → cakupan 1,0 (bulan andal) pada tanggal
  // berapa pun; jalur metrik yang diuji selalu jalur yang sama.
  for (let h = 1; h <= hariBerjalan; h += 1) {
    await store.addTransaction(user.id, { jenis: 'masuk', kategori: 'penjualan', jumlah: 300_000, tanggal: hari(h) }, { aktor: 'manusia' });
  }
  await store.addTransaction(user.id, { jenis: 'keluar', kategori: 'operasional', jumlah: 50_000, tanggal: hari(2) }, { aktor: 'manusia' });

  const s1 = summarizeMonth(await store.getTransactions(user.id), bulanIni);
  const m1 = computeMetrics({}, s1, s1);
  // Identitas SATU SUMBER: metrik membaca kolom ringkasan yang sama, bukan
  // rumus kedua. Modal dikecualikan di summarizeMonth — di sininya selesai.
  assert.equal(m1.omzet, s1.setara.penjualan + s1.setara.lainMasuk);
  assert.equal(m1.labaBersih, s1.setara.labaBersih);
  assert.equal(m1.saldoKas, s1.setara.saldoKas);

  // Modal pada hari yang SUDAH tercatat → hariTercatat tetap, skor murni
  // menguji efek modal (bukan efek hari catatan baru).
  await store.addTransaction(user.id, { jenis: 'masuk', kategori: 'modal-masuk', jumlah: 2_000_000, tanggal: hari(hariBerjalan) }, { aktor: 'manusia' });
  const s2 = summarizeMonth(await store.getTransactions(user.id), bulanIni);
  const m2 = computeMetrics({}, s2, s2);

  assert.equal(m2.omzet, m1.omzet, 'omzet tidak berubah oleh modal');
  assert.equal(m2.labaBersih, m1.labaBersih, 'laba bersih tidak berubah oleh modal');
  assert.equal(m2.marginBersih, m1.marginBersih);
  assert.equal(m2.skorKesehatan, m1.skorKesehatan, 'skor kesehatan tidak berubah oleh modal');
  assert.equal(m2.berjalan.omzet, m1.berjalan.omzet);
  assert.equal(m2.berjalan.labaBersih, m1.berjalan.labaBersih);
  assert.equal(m2.berjalan.saldoKas - m1.berjalan.saldoKas, 2_000_000, 'uang nyata tetap terlihat di saldo kas');
  assert.equal(m2.saldoKas > m1.saldoKas, true, 'setara sebulan ikut naik — modal adalah uang');
});

/* --------------------------------------------------------- Rute ujung-ke-ujung */

test('rute: modal-masuk tersimpan seperti ketukan biasa, laba di semua laporan tetap jujur', async () => {
  const { user, accessCode } = await penggunaSiap('Bu Rute');
  // /api/me hanya mengembalikan metrik bagi pengguna yang punya profil.
  await store.saveProfile(user.id, {
    namaUsaha: 'Warung Rute', jenisUsaha: 'kuliner', pencatatan: 'aplikasi',
    tujuan: 'rapikan-keuangan', omzetBulanan: 5_000_000,
  });
  const dorong = (kategori, jumlah, tanggal) =>
    minta('/api/cashbook', { method: 'POST', kode: accessCode, body: JSON.stringify({ jenis: 'masuk', kategori, jumlah, keterangan: '', tanggal }) });

  for (let h = 1; h <= hariBerjalan; h += 1) await dorong('penjualan', 300_000, hari(h));
  const dasbor0 = await minta('/api/cashbook', { kode: accessCode }).then((r) => r.json());
  const me0 = await minta('/api/me', { kode: accessCode }).then((r) => r.json());

  const res = await dorong('modal-masuk', 2_000_000, hari(hariBerjalan));
  assert.equal(res.status, 201);
  const { transaction: row } = await res.json();
  assert.equal(row.kategori, 'modal-masuk');
  assert.equal(row.origin, 'manual');

  const dasbor1 = await minta('/api/cashbook', { kode: accessCode }).then((r) => r.json());
  assert.equal(dasbor1.summary.labaBersih, dasbor0.summary.labaBersih, 'laba di dasbor tidak berubah oleh modal');
  assert.equal(dasbor1.summary.saldoKas - dasbor0.summary.saldoKas, 2_000_000);
  assert.equal(dasbor1.summary.modalMasuk, 2_000_000);
  // Sumber chip kategori SPA adalah payload ini — Modal muncul tanpa menyentuh tampilan.
  assert.equal(dasbor1.kategori.masuk['modal-masuk'].label, 'Modal');

  const me1 = await minta('/api/me', { kode: accessCode }).then((r) => r.json());
  assert.equal(me1.metrics.omzet, me0.metrics.omzet, 'omzet di metrik tidak berubah oleh modal');
  assert.equal(me1.metrics.berjalan.labaBersih, me0.metrics.berjalan.labaBersih);
  assert.equal(me1.metrics.berjalan.saldoKas - me0.metrics.berjalan.saldoKas, 2_000_000);

  // Kolom kategori tampil apa adanya di unduhan data — tanpa pemborosan.
  const milik = await minta('/api/my-data', { kode: accessCode }).then((r) => r.json());
  assert.ok(milik.transactions.some((t) => t.kategori === 'modal-masuk' && t.jumlah === 2_000_000));

  // Penarikan modal tetap ditolak rute — itu prive, bukan kategori baru.
  const tarik = await minta('/api/cashbook', {
    method: 'POST', kode: accessCode,
    body: JSON.stringify({ jenis: 'keluar', kategori: 'modal-masuk', jumlah: 1000, tanggal: hari(hKe(8)) }),
  });
  assert.equal(tarik.status, 400);
});

/* -------------------------------------------- Baris historis tidak di-retrofit */

test('tidak ada retrofit: catatan lama tetap apa catatannya, dihitung sesuai catatannya', async () => {
  const { user, accessCode } = await penggunaSiap('Bu Lama');
  // Simulasi baris prabel batas modal: setoran modal 2jt yang dulu hanya
  // bisa dicatat "lain-masuk" — dan waktu itu memang ikut laba.
  await store.addTransaction(user.id, { jenis: 'masuk', kategori: 'lain-masuk', jumlah: 2_000_000, keterangan: 'modal usaha', tanggal: hari(hKe(3)) }, { aktor: 'manusia' });
  await store.addTransaction(user.id, { jenis: 'masuk', kategori: 'penjualan', jumlah: 500_000, tanggal: hari(hKe(4)) }, { aktor: 'manusia' });

  // Penulisan baru sesudah batas — memastikan siklus muat/tulis berjalan.
  await store.addTransaction(user.id, { jenis: 'keluar', kategori: 'operasional', jumlah: 20_000, tanggal: hari(hKe(5)) }, { aktor: 'manusia' });

  const trx = await store.getTransactions(user.id);
  const lama = trx.find((t) => t.keterangan === 'modal usaha');
  assert.equal(lama.kategori, 'lain-masuk', 'baris historis tidak diam-diam diganti kategorinya');

  const s = summarizeMonth(trx, bulanIni);
  assert.equal(s.lainMasuk, 2_000_000, 'baris lama tetap dihitung di lain-masuk');
  assert.equal(s.labaBersih, 2_480_000, 'dan tetap terhitung laba — catatan lama dihormati, bukan diubah diam-diam');
  assert.equal(s.modalMasuk, 0, 'tidak ada baris yang diretrofit jadi modal-masuk');
  assert.equal(trx.filter((t) => t.kategori === 'modal-masuk').length, 0);
});

/* ----------------------------------------------- Pemetaan scan-nota (nota.js) */

test('scan nota: kata kunci modal/setoran → modal-masuk; refund/cashback tetap lain-masuk', () => {
  assert.equal(petakanKategori('modal masuk', 'masuk'), 'modal-masuk');
  assert.equal(petakanKategori('setoran modal', 'masuk'), 'modal-masuk');
  assert.equal(petakanKategori('tambahan modal usaha', 'masuk'), 'modal-masuk');
  assert.equal(petakanKategori('modal-masuk', 'masuk'), 'modal-masuk', 'id baku dari model yang patuh skema');
  assert.equal(petakanKategori('refund barang', 'masuk'), 'lain-masuk', 'pengembalian bukan modal');
  assert.equal(petakanKategori('cashback', 'masuk'), 'lain-masuk');
  assert.equal(petakanKategori('modal', 'keluar'), null, 'kategori masuk tidak bocor ke keluar');
});

test('sanitasi hasil nota membawa modal-masuk sebagai usulan — bukan tersimpan', () => {
  const hasil = sanitasiHasilNota(
    { type: 'income', amount: 'Rp 2.000.000', category: 'modal', description: 'setoran awal pemilik', merchant: '', date: hari(1), confidence: 0.9 },
    { hariIni },
  );
  assert.equal(hasil.jenis, 'masuk');
  assert.equal(hasil.kategori, 'modal-masuk');
  assert.equal(hasil.jumlah, 2_000_000);
  // Usulan tetap usulan: tidak ada jalur dari sini ke penyimpanan — yang
  // disimpan tetap hanya lewat rute /api/cashbook dengan ketukan manusia.
});

/* --------------------------------------------------- Jejak tetap kompatibel */

test('transaction_added untuk modal memakai meta kosakata tertutup yang sama', async () => {
  const { user } = await penggunaSiap();
  await store.addTransaction(user.id, { jenis: 'masuk', kategori: 'modal-masuk', jumlah: 2_000_000, tanggal: hari(hKe(5)) }, { aktor: 'manusia' });
  const ev = (await store.getEvents(user.id)).find((e) => e.type === 'transaction_added');
  assert.equal(ev.meta.kategori, 'modal-masuk');
  assert.equal(ev.meta.origin, 'manual');
  const teks = JSON.stringify(ev);
  assert.doesNotMatch(teks, /2000000/, 'meta peristiwa tetap buta nominal');
});
