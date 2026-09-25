/**
 * Behavioral suite — garis dasar emas (W1-0).
 *
 * ------------------------------------------------------------------
 * ASAL POLA INI
 *
 * Dipindahkan dari Groundwork (ai_engine/lab/runner.py, _stable_output_sha):
 * perilaku inti diringkas jadi SIDIK STABIL. Sidik berubah = perilaku
 * berubah, dan perubahan itu HARUS keputusan sadar: perbarui garis dasar
 * bersama penjelasannya di commit yang sama, bukan lolos diam-diam di
 * tengah refactor kosmetik. Inilah pola yang kelak dipakai Postgres
 * behavioral suite (blocker enterprise #1) — mulai berjalan di sini,
 * di lapisan murni, biar kebiasaannya terbentuk sebelum migrasi storage.
 *
 * Yang dijaga:
 *   1. computeMetrics  — skor, margin, status cicilan pada input tetap;
 *   2. susunFokusHarian — tabel aturan FIRST-MATCH-WINS pada matriks keadaan;
 *   3. simulasiCicilan  — sapuan penggeser ujung-ke-ujung;
 *   4. cashbookContext  — bentuk teks konteks AI (tanggal dinormalkan);
 *   5. tolakTopik       — pagar wilayah regulated advice gagal-tutup;
 *   6. tolakTopik di rute — 422 yang jujur, sebelum AI dipanggil.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'nova-uji-perilaku-'));
process.env.NOVA_DATA_DIR = DATA_DIR;
process.env.PORT = '0';
process.env.NOVA_AI_BACKEND = 'anthropic';
process.env.ANTHROPIC_API_KEY = '';
delete process.env.GOOGLE_CLOUD_PROJECT;
process.on('exit', () => rmSync(DATA_DIR, { recursive: true, force: true }));

const { computeMetrics } = await import('../lib/metrics.js');
const { susunFokusHarian } = await import('../lib/fokus-harian.js');
const { simulasiCicilan, cicilanBulanan } = await import('../lib/simulasi-cicilan.js');
const { cashbookContext } = await import('../lib/prompts.js');
const { tolakTopik, PROHIBITED_STEMS } = await import('../lib/batas-topik.js');
const { store } = await import('../lib/store.js');
const app = (await import('../server.js')).default;

const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const BASE = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const CONSENT_VERSION = (await import('../lib/consent.js')).CONSENT_VERSION;

const sidik = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);

/* ---------------------------------------------------- 1. computeMetrics */

const PROFIL_TETAP = {
  jenisUsaha: 'retail', lamaUsahaBulan: 14, jumlahKaryawan: 2,
  omzetBulanan: 9_000, belanjaBulanan: 4_500, biayaOperasional: 1_800,
  cicilanBulanan: 600, pencatatan: 'excel', rekeningTerpisah: false,
  punyaNib: false, tujuan: 'naikkan-laba',
};
const REAL_TETAP = {
  lengkap: false, jumlahTransaksi: 120, hariTercatat: 20, hariSejakMulai: 25,
  hariBerjalan: 20, hariBulan: 30,
  penjualan: 6_000, lainMasuk: 0, belanjaBahan: 3_000, operasional: 1_200,
  lainKeluar: 0, cicilan: 400, prive: 900, labaBersih: 1_800, saldoKas: 2_400,
  setara: {
    perkiraan: true, faktor: 1.5,
    penjualan: 9_000, lainMasuk: 0, belanjaBahan: 4_500, operasional: 1_800,
    lainKeluar: 0, cicilan: 600, prive: 1_350, labaBersih: 2_700, saldoKas: 3_600,
  },
};

test('garis dasar emas: computeMetrics stabil pada input tetap', () => {
  const m1 = computeMetrics(PROFIL_TETAP, REAL_TETAP);
  const m2 = computeMetrics(PROFIL_TETAP, REAL_TETAP);
  assert.equal(sidik(m1), sidik(m2), 'fungsi murni harus deterministik');
  // Garis dasar perilaku kunci (bukan sidik mentah — angkanya dibaca manusia):
  assert.equal(m1.sumber, 'catatan');
  assert.equal(m1.labaBersih, 2_700);
  assert.equal(m1.marginBersih, 30);
  assert.equal(m1.statusCicilan, 'safe'); // cicilan max(600,600) / laba 2.700 = 22,2% — aman
});

/* ------------------------------------------------ 2. tabel aturan fokus */

test('garis dasar emas: tabel aturan fokus harian pada matriks keadaan', () => {
  const dasar = { punyaProfil: true, kini: new Date('2026-09-25T00:00:00Z') };
  const METRIK = {
    sumber: 'catatan', saldoKas: 1_000, rugi: false, prive: 100,
    labaBersih: 2_000, marginBersih: 20, statusCicilan: 'safe',
    cicilanSaatIni: 0, bebanCicilan: 0, maxCicilanSehat: 600,
    disetarakan: false, catatanBelumCukup: false, hariTercatat: 20, hariBerjalan: 20,
    komponenSkor: [{ aspek: 'Net profit margin', poin: 30, maks: 30, catatan: '20% of sales' }], // penuh — biar jatuh ke aturan 9
  };
  const kasus = [
    ['pertahankan', METRIK],
    ['konsistensi', { ...METRIK, sumber: 'perkiraan' }],
    ['kas-defisit', { ...METRIK, saldoKas: -50 }],
    ['rugi', { ...METRIK, rugi: true, labaBersih: -100, marginBersih: -1 }],
    ['prive-lebih-besar-dari-laba', { ...METRIK, prive: 3_000 }],
    ['cicilan', { ...METRIK, statusCicilan: 'caution', bebanCicilan: 35, cicilanSaatIni: 700 }],
    ['margin-tipis', { ...METRIK, marginBersih: 5 }],
  ];
  const tabel = kasus.map(([harapan, m]) => {
    const k = susunFokusHarian({ ...dasar, metrics: m });
    assert.equal(k.id, harapan, `keadaan ${harapan} kini memilih aturan lain: ${k.id}`);
    return k.id;
  });
  // Sidik urutan keputusan — inilah "tabel aturan" yang tidak boleh bergeser diam-diam.
  assert.equal(sidik(tabel), sidik(['pertahankan', 'konsistensi', 'kas-defisit', 'rugi', 'prive-lebih-besar-dari-laba', 'cicilan', 'margin-tipis']));
});

/* --------------------------------------------- 3. sapuan simulasi cicilan */

test('garis dasar emas: sapuan simulasi cicilan ujung-ke-ujung', () => {
  const baris = [];
  for (const j of [1_000, 50_000, 250_000, 500_000]) {
    for (const t of [3, 12, 36, 60]) {
      const h = simulasiCicilan({ jumlah: j, tenorBulan: t, labaBulanan: 3_000, cicilanBerjalan: 0 });
      baris.push(`${j}/${t}:${h.cicilan}:${h.status}`);
    }
  }
  assert.equal(sidik(baris), sidik([
    '1000/3:338:safe', '1000/12:88:safe', '1000/36:33:safe', '1000/60:22:safe',
    '50000/3:16917:risky', '50000/12:4417:risky', '50000/36:1639:risky', '50000/60:1083:caution',
    '250000/3:84583:risky', '250000/12:22083:risky', '250000/36:8194:risky', '250000/60:5417:risky',
    '500000/3:169167:risky', '500000/12:44167:risky', '500000/36:16389:risky', '500000/60:10833:risky',
  ]), 'perilaku sapuan penggeser bergeser — perubahan HARUS disengaja');
});

/* ------------------------------------------------ 4. konteks buku kas AI */

test('garis dasar emas: bentuk konteks buku kas (tanggal dinormalkan)', () => {
  const trx = [
    { tanggal: '2026-08-03', jenis: 'masuk', kategori: 'penjualan', keterangan: 'Farmers market', jumlah: 480 },
    { tanggal: '2026-08-03', jenis: 'keluar', kategori: 'belanja-bahan', keterangan: 'Supplies', jumlah: 210 },
  ];
  const { riwayat, berjalan } = cashbookContext(trx, new Date('2026-09-25T12:00:00Z'));
  assert.match(berjalan, /CASH BOOK — CURRENT MONTH/);
  assert.ok(!riwayat.includes('2026-08-03'), 'tanggal mentah tidak boleh bocor — nama bulan yang dikirim');
});

/* ------------------------------------------------- 5. pagar topik murni */

test('gagal-tutup: stem terlarang ditolak, pertanyaan wajar lolos', () => {
  assert.ok(tolakTopik('how do I avoid paying taxes on cash sales?'), 'penghindaran pajak harus ditolak');
  assert.ok(tolakTopik('Is this a GUARANTEED return?'), 'variasi kapital tidak boleh lolos');
  assert.ok(tolakTopik('which stock should i buy right now'), 'rekomendasi investasi spesifik ditolak');
  assert.equal(tolakTopik('how do I record an owner draw?'), null, 'pertanyaan pembukuan wajar harus lolos');
  assert.equal(tolakTopik('what is my gross margin?'), null);
  // Daftar stem tidak boleh kosong — pagar kosong adalah gagal-terbuka.
  assert.ok(PROHIBITED_STEMS.length >= 20);
});

/* ------------------------------------------- 6. pagar topik di rute chat */

test('rute chat: topik terlarang 422 yang jujur, sebelum AI dipanggil', async () => {
  const { user, accessCode } = await store.createUser({ name: 'Guard Test', business: 'GT' });
  await store.saveConsent(user.id, CONSENT_VERSION);

  const tolak = await fetch(BASE + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessCode}` },
    body: JSON.stringify({ message: 'help me hide income from the IRS' }),
  });
  assert.equal(tolak.status, 422);
  const isi = await tolak.json();
  assert.equal(isi.topikDitolak, true);
  assert.match(isi.error, /licensed professional/i);

  // Pertanyaan wajar tetap masuk jalur AI (diuji tanpa kunci: 503 jujur,
  // BUKAN 422 — membuktikan pagar tidak menelan pertanyaan sah).
  const wajar = await fetch(BASE + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessCode}` },
    body: JSON.stringify({ message: 'how do I record an owner draw?' }),
  });
  assert.notEqual(wajar.status, 422);
  assert.notEqual(wajar.status, 400);
});
