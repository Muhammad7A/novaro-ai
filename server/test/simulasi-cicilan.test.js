/**
 * Uji Simulasi Cicilan — penggeser jumlah & tenor di halaman Laporan.
 *
 * Rumusnya hidup di lib/simulasi-cicilan.js: berkas YANG SAMA diimpor uji
 * ini dan disajikan ke peramban lewat /simulasi-cicilan.js. Karena itu yang
 * diuji di sini persis hitungan yang dilihat pengguna — bukan tiruannya.
 *
 * Aturan ambang 30%/50% sengaja SATU SUMBER: metrics.js mengimpor
 * konstantanya dari simulasi-cicilan.js, jadi simulasi di halaman Laporan
 * dan skor kesehatan di dasbor tidak mungkin berbeda diam-diam.
 *
 *   npm test
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

const {
  RASIO_AMAN_PORSEN,
  RASIO_BERISIKO_PORSEN,
  BUNGA_TAHUNAN_DEFAULT,
  JUMLAH_MIN,
  JUMLAH_MAKS,
  LANGKAH_JUMLAH,
  TENOR_MIN,
  TENOR_MAKS,
  cicilanBulanan,
  statusBeban,
  simulasiCicilan,
} = await import('../lib/simulasi-cicilan.js');

/* ================================================== Rumus cicilan */

test('cicilan bulanan bunga flat: pokok/tenor + bunga 6% per tahun dibagi 12', () => {
  // $10.000, 12 bulan: 833,33 pokok + 50 bunga = 883,33 → 883
  assert.equal(cicilanBulanan(10_000, 12), 883);
  // $10.000, 6 bulan: 1.666,67 + 50 = 1.716,67 → 1.717
  assert.equal(cicilanBulanan(10_000, 6), 1_717);
  // Tenor makin panjang, cicilan makin ringan — selalu, tanpa kecuali.
  assert.ok(cicilanBulanan(10_000, 60) < cicilanBulanan(10_000, 36));
  assert.ok(cicilanBulanan(10_000, 36) < cicilanBulanan(10_000, 12));
  assert.ok(cicilanBulanan(10_000, 12) < cicilanBulanan(10_000, 3));
});

test('jumlah minimum dan maksimum penggeser menghasilkan cicilan yang masuk akal', () => {
  const kecil = cicilanBulanan(JUMLAH_MIN, TENOR_MAKS); // $1.000, 60 bln
  const besar = cicilanBulanan(JUMLAH_MAKS, TENOR_MIN); // $500rb, 3 bln
  assert.equal(JUMLAH_MIN, 1_000);
  assert.equal(JUMLAH_MAKS, 500_000);
  assert.ok(kecil > 0 && kecil < 100, `cicilan teringan ${kecil} harus kecil tapi nyata`);
  assert.ok(besar > JUMLAH_MAKS / TENOR_MIN, `cicilan terberat ${besar} wajib di atas pokok per bulan`);
  // Langkah penggeser harus membagi habis rentangnya — kalau tidak, nilai
  // terakhir penggeser tidak pernah mencapai JUMLAH_MAKS.
  assert.equal((JUMLAH_MAKS - JUMLAH_MIN) % LANGKAH_JUMLAH, 0);
});

test('tenor di luar 3–60 dan masukan tidak masuk akal ditolak dengan null', () => {
  assert.equal(cicilanBulanan(10_000, 0), null);
  assert.equal(cicilanBulanan(10_000, -12), null);
  assert.equal(cicilanBulanan(10_000, 4.5), null);
  assert.equal(cicilanBulanan(0, 12), null);
  assert.equal(cicilanBulanan(-1, 12), null);
  assert.equal(cicilanBulanan('bukan angka', 12), null);
  assert.equal(cicilanBulanan(NaN, 12), null);
  assert.equal(cicilanBulanan(10_000, NaN), null);
});

/* ================================================== Ambang & status */

test('ambang sama dengan aturan metrics.js: 30 aman, 30–50 hati-hati, >50 berisiko', () => {
  assert.deepEqual([RASIO_AMAN_PORSEN, RASIO_BERISIKO_PORSEN], [30, 50]);
  assert.equal(statusBeban(0), 'safe');
  assert.equal(statusBeban(15), 'safe');
  assert.equal(statusBeban(30), 'safe', 'tepat 30% masih safe — sama dengan bebanCicilan metrics');
  assert.equal(statusBeban(30.1), 'caution');
  assert.equal(statusBeban(50), 'caution');
  assert.equal(statusBeban(50.1), 'risky');
  assert.equal(statusBeban(999), 'risky');
  assert.equal(statusBeban(NaN), 'risky');
});

/* ================================================== Simulasi utuh */

test('simulasi menghitung rasio terhadap laba, bukan hanya cicilannya', () => {
  const h = simulasiCicilan({ jumlah: 10_000, tenorBulan: 12, labaBulanan: 4_000, cicilanBerjalan: 0 });
  assert.equal(h.cicilan, 883);
  assert.equal(h.rasioPorsen, 22.1); // 883 / 4.000
  assert.equal(h.status, 'safe');
  assert.equal(h.totalBayar, 883 * 12);
  assert.ok(h.totalBunga > 0 && h.totalBunga < 1_000, 'total bunga 6% flat satu tahun ≈ $600');
});

test('cicilan berjalan ikut menambah beban — pemberi pinjaman menilai seluruh cicilan', () => {
  const tanpaLama = simulasiCicilan({ jumlah: 10_000, tenorBulan: 12, labaBulanan: 4_000, cicilanBerjalan: 0 });
  const denganLama = simulasiCicilan({ jumlah: 10_000, tenorBulan: 12, labaBulanan: 4_000, cicilanBerjalan: 500 });
  assert.ok(denganLama.rasioPorsen > tanpaLama.rasioPorsen);
  assert.equal(denganLama.totalBeban, denganLama.cicilan + 500);
  // Cicilan lama bisa mengubah status tanpa mengubah cicilan barunya.
  assert.equal(denganLama.cicilan, tanpaLama.cicilan);
  assert.equal(statusBeban(tanpaLama.rasioPorsen), 'safe');
  assert.notEqual(statusBeban(denganLama.rasioPorsen), 'safe');
});

test('laba nol atau negatif: beban apa pun di atas nol terlalu berat, bukan 0%', () => {
  const labaNol = simulasiCicilan({ jumlah: 5_000, tenorBulan: 12, labaBulanan: 0 });
  assert.equal(labaNol.status, 'risky');
  assert.ok(labaNol.rasioPorsen >= 999);
  const rugi = simulasiCicilan({ jumlah: 5_000, tenorBulan: 12, labaBulanan: -2_000 });
  assert.equal(rugi.status, 'risky');
  // Tanpa cicilan simulasi, tidak ada beban → tidak perlu menakut-nakuti.
  const kosong = simulasiCicilan({ jumlah: 5_000, tenorBulan: 12, labaBulanan: 0 });
  assert.ok(kosong.cicilan > 0);
  const labaNull = simulasiCicilan({ jumlah: 5_000, tenorBulan: 12, labaBulanan: null });
  assert.equal(labaNull.status, 'risky');
});

test('skenario penggeser dari ujung ke ujung selalu menghasilkan hitungan sah', () => {
  /*
   * Nilai yang mungkin dicapai penggeser: langkahnya diskret, jadi yang
   * diuji adalah titik-titik yang benar-benar dilaluinya — ujung bawah,
   * ujung atas, dan beberapa titik tengah. Semuanya wajib menghasilkan
   * objek (bukan null) dengan status yang sah.
   */
  const STATUS = ['safe', 'caution', 'risky'];
  for (const langkahJumlah of [0, 1, 20, 50, 99]) {
    for (const tenor of [TENOR_MIN, 6, 12, 24, 36, 48, TENOR_MAKS]) {
      const jumlah = JUMLAH_MIN + langkahJumlah * LANGKAH_JUMLAH;
      const h = simulasiCicilan({ jumlah, tenorBulan: tenor, labaBulanan: 3_000, cicilanBerjalan: 0 });
      assert.ok(h, `${jumlah}/${tenor} bulan harus menghasilkan hitungan`);
      assert.ok(STATUS.includes(h.status), `${jumlah}/${tenor}: status asing ${h.status}`);
      assert.ok(h.cicilan > 0);
      assert.ok(h.totalBayar > jumlah, 'total bayar wajib di atas pokok (ada bunga)');
    }
  }
  // Titik terakhir penggeser harus betul-betul JUMLAH_MAKS.
  const langkahTerakhir = (JUMLAH_MAKS - JUMLAH_MIN) / LANGKAH_JUMLAH;
  assert.equal(JUMLAH_MIN + langkahTerakhir * LANGKAH_JUMLAH, JUMLAH_MAKS);
});

test('simulasiCicilan menolak masukan yang tidak bisa dihitung', () => {
  assert.equal(simulasiCicilan({ jumlah: 0, tenorBulan: 12, labaBulanan: 1_000 }), null);
  assert.equal(simulasiCicilan({ jumlah: 10_000, tenorBulan: 0, labaBulanan: 1_000 }), null);
  assert.equal(simulasiCicilan(null), null);
  assert.equal(simulasiCicilan(), null);
});

/* ============================================ Kontrak antarberkas & rute */

test('bunga memakai tarif flat ilustratif 6% per tahun', () => {
  assert.equal(BUNGA_TAHUNAN_DEFAULT, 0.06);
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'nova-uji-sim-'));
process.env.NOVA_DATA_DIR = DATA_DIR;
process.env.PORT = '0';
process.on('exit', () => rmSync(DATA_DIR, { recursive: true, force: true }));

const app = (await import('../server.js')).default;
const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});

test('/simulasi-cicilan.js disajikan sebagai berkas yang sama dengan yang diuji', async () => {
  const res = await fetch(`http://127.0.0.1:${server.address().port}/simulasi-cicilan.js`);
  assert.equal(res.status, 200);
  const teks = await res.text();
  assert.ok(teks.includes('function cicilanBulanan'), 'rumus harus ada di berkas yang disajikan');
  assert.ok(teks.includes('window.NOVA_SIMULASI'), 'peramban harus menerima API globalnya');
  assert.ok(!teks.includes('ANTHROPIC_API_KEY'), 'aset publik tidak membawa rahasia');
});

test.after(() => server.close());
