/**
 * Uji Garis Waktu Kesehatan Usaha (/api/timeline).
 *
 * Aturan utamanya jujur pada data: hanya bulan yang BENAR-BENAR punya
 * catatan yang boleh muncul, urutannya kronologis, dan skornya WAJIB sama
 * dengan yang dihitung computeMetrics (rumus dasbor) untuk bulan yang sama.
 * Tidak ada bulan kosong yang dikarang, tidak ada skor yang ditebak.
 *
 *   npm test
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'nova-uji-tl-'));
process.env.NOVA_DATA_DIR = DATA_DIR;
process.env.PORT = '0';
process.env.NOVA_AI_BACKEND = 'anthropic';
process.env.ANTHROPIC_API_KEY = '';
delete process.env.GOOGLE_CLOUD_PROJECT;
process.on('exit', () => rmSync(DATA_DIR, { recursive: true, force: true }));

const { store } = await import('../lib/store.js');
const { computeMetrics } = await import('../lib/metrics.js');
const { summarizeMonth, lastMonths, isMonthReliable } = await import('../lib/cashbook.js');
const app = (await import('../server.js')).default;

const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const BASE = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const { user, accessCode } = await store.createUser({ name: 'Bu Garis', business: 'Warung Garis', batch: 'B1' });
await store.saveConsent(user.id, 2);
await store.saveProfile(user.id, {
  namaUsaha: 'Warung Garis', jenisUsaha: 'kuliner', pencatatan: 'aplikasi',
  tujuan: 'rapikan-keuangan', omzetBulanan: 5_000_000,
});

const hariIni = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const bulanIni = hariIni.slice(0, 7);

/** Tanggal pada bulan mundur ke-N dari sekarang (0 = bulan ini). */
const tanggalDiBulan = (mundur, tanggal) => {
  const [y, m] = bulanIni.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 - mundur, 1));
  return `${d.toISOString().slice(0, 7)}-${String(tanggal).padStart(2, '0')}`;
};

const tambahPenjualan = async (tanggal, jumlah) =>
  store.addTransaction(user.id, { tanggal, jenis: 'masuk', kategori: 'penjualan', keterangan: 'jualan', jumlah }, { aktor: 'manusia' });

const mintaTimeline = () => fetch(BASE + '/api/timeline', { headers: { Authorization: `Bearer ${accessCode}` } });

test('tanpa catatan sama sekali: garis waktu kosong yang jujur', async () => {
  const res = await mintaTimeline();
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.deepEqual(data.titik, [], 'tidak ada bulan yang dikarang');
  assert.equal(data.tren, null);
});

test('bulan tanpa catatan dilewati, bulan berisi tampil kronologis', async () => {
  // Bulan ini dan dua bulan lalu tercatat; satu bulan lalu SENGAJA kosong.
  // Hari bulan berjalan tidak boleh melewati HARI INI — mutator buku kas
  // menolak tanggal masa depan, dan itu perilaku yang benar: fixture lama
  // diam-diam menyuntik baris "besok" ketika dijalankan tanggal 1–11.
  const hariTerisi = Math.min(12, Number(hariIni.slice(8, 10)));
  for (let i = 1; i <= hariTerisi; i += 1) await tambahPenjualan(tanggalDiBulan(0, i), 400_000);
  for (let i = 1; i <= 14; i += 1) await tambahPenjualan(tanggalDiBulan(2, i), 420_000);

  const data = await mintaTimeline().then((r) => r.json());
  const bulan = data.titik.map((t) => t.bulan);
  const duaBulanLalu = tanggalDiBulan(2, 1).slice(0, 7);
  const satuBulanLalu = tanggalDiBulan(1, 1).slice(0, 7);

  assert.ok(bulan.includes(bulanIni), 'bulan berjalan ikut (sudah ada catatannya)');
  assert.ok(bulan.includes(duaBulanLalu));
  assert.ok(!bulan.includes(satuBulanLalu), 'bulan kosong tidak boleh muncul');
  assert.deepEqual(bulan, [...bulan].sort(), 'urutan harus kronologis (terlama dulu)');
});

test('skor tiap titik SAMA dengan computeMetrics untuk bulan yang sama', async () => {
  const data = await mintaTimeline().then((r) => r.json());
  const transactions = await store.getTransactions(user.id);
  for (const t of data.titik) {
    const ringkasan = summarizeMonth(transactions, t.bulan);
    const real = isMonthReliable(ringkasan) ? ringkasan : null;
    const metrics = computeMetrics(user.profile ?? {}, real, ringkasan);
    assert.equal(t.skor, metrics.skorKesehatan, `skor ${t.bulan} harus sama dengan rumus dasbor`);
    assert.equal(t.status, metrics.statusKesehatan);
  }
});

test('tren dihitung dari titik pertama ke titik terakhir, hanya bila ≥2 titik', async () => {
  const data = await mintaTimeline().then((r) => r.json());
  if (data.titik.length >= 2) {
    const harapan = data.titik.at(-1).skor - data.titik[0].skor;
    assert.equal(data.tren, harapan);
  } else {
    assert.equal(data.tren, null);
  }
});

test('tanpa kode akses: 401', async () => {
  const res = await fetch(BASE + '/api/timeline');
  assert.equal(res.status, 401);
});

test('rentang enam bulan tidak terlampaui', async () => {
  const data = await mintaTimeline().then((r) => r.json());
  assert.ok(data.titik.length <= lastMonths(6).length);
});
