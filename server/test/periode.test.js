/**
 * Uji regresi: setiap angka harus membawa periodenya.
 *
 * Semua kasus di bawah memakai usaha yang penjualannya BENAR-BENAR RATA —
 * Rp 400.000 setiap hari, tanpa satu pun hari yang berbeda. Apa pun yang
 * berubah-ubah dalam hasil hitungan berarti kesalahan periode, bukan kenyataan
 * usahanya. Itulah yang membuat kasus-kasus ini tajam.
 *
 *   node --test
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isMonthComplete,
  isMonthReliable,
  summarizeMonth,
  summarizeRange,
} from '../lib/cashbook.js';
import { computeMetrics, metricsToText } from '../lib/metrics.js';
import { cashbookContext, chatSystem } from '../lib/prompts.js';

const HARI = { jual: 400_000, bahan: 220_000, ops: 60_000 };
const LABA_HARIAN = HARI.jual - HARI.bahan - HARI.ops; // 120.000

let seq = 0;
/** Satu hari jualan. `dicatatPada` default = hari kejadiannya (pengguna rajin). */
function hari(tanggal, dicatatPada = tanggal) {
  const t = (jenis, kategori, jumlah) => ({
    id: `trx_${++seq}`,
    tanggal,
    jenis,
    kategori,
    jumlah,
    keterangan: '',
    createdAt: new Date(`${dicatatPada}T03:00:00.000Z`).toISOString(),
  });
  return [
    t('masuk', 'penjualan', HARI.jual),
    t('keluar', 'belanja-bahan', HARI.bahan),
    t('keluar', 'operasional', HARI.ops),
  ];
}

function bulan(month, sampaiTanggal) {
  const out = [];
  for (let d = 1; d <= sampaiTanggal; d++) out.push(...hari(`${month}-${String(d).padStart(2, '0')}`));
  return out;
}

const PROFIL = {
  namaUsaha: 'Warung Bu Sari',
  jenisUsaha: 'kuliner',
  pencatatan: 'buku',
  tujuan: 'ajukan-kur',
  lamaUsahaBulan: 36,
  rekeningTerpisah: true,
  punyaNib: true,
  omzetBulanan: 12_000_000,
  belanjaBulanan: 6_600_000,
  biayaOperasional: 1_800_000,
  cicilanBulanan: 0,
};

const pada = (tgl) => new Date(`2026-06-${String(tgl).padStart(2, '0')}T12:00:00Z`);

/* ------------------------------------------------------------------ Dasbor */

test('angka per bulan tidak berubah saat sumbernya beralih ke buku kas', () => {
  // Perkiraan pemilik kebetulan tepat: 30 hari x Rp 400rb = Rp 12 juta.
  const acuan = computeMetrics(PROFIL, null);
  assert.equal(acuan.sumber, 'perkiraan');
  assert.equal(acuan.omzet, 12_000_000);

  // Tanggal 8 adalah hari paling awal ambang `isMonthReliable` bisa terlampaui,
  // sekaligus hari paling rawan: 8/30 bulan dipakai sebagai "sebulan".
  for (const tgl of [8, 10, 15, 22, 30]) {
    const s = summarizeMonth(bulan('2026-06', tgl), '2026-06', pada(tgl));
    assert.ok(isMonthReliable(s), `tanggal ${tgl} seharusnya sudah cukup terisi`);

    const m = computeMetrics(PROFIL, s);
    assert.equal(m.sumber, 'catatan');
    assert.equal(m.omzet, acuan.omzet, `omzet melonjak/anjlok di tanggal ${tgl}`);
    assert.equal(m.labaBersih, acuan.labaBersih, `laba melonjak/anjlok di tanggal ${tgl}`);
    assert.equal(m.maxCicilanSehat, acuan.maxCicilanSehat, `batas cicilan berubah di tanggal ${tgl}`);
  }
});

test('angka apa adanya tetap tersedia, terpisah dan berlabel jelas', () => {
  const s = summarizeMonth(bulan('2026-06', 8), '2026-06', pada(8));
  const m = computeMetrics(PROFIL, s);

  assert.equal(m.disetarakan, true);
  assert.equal(m.bulanLengkap, false);
  assert.equal(m.hariBerjalan, 8);
  assert.equal(m.hariBulan, 30);
  assert.equal(m.berjalan.omzet, 8 * HARI.jual);
  assert.equal(m.berjalan.labaBersih, 8 * LABA_HARIAN);

  // Konteks untuk AI wajib menyebut kedua angka beserta periodenya.
  const teks = metricsToText(m);
  assert.match(teks, /baru berjalan 8 dari 30 hari/i);
  assert.match(teks, /SETARA SEBULAN PENUH/);
  assert.match(teks, /Jangan menyebut angka sebagian bulan itu sebagai penurunan usaha/);
});

test('bulan yang sudah habis tidak disetarakan sama sekali', () => {
  const s = summarizeMonth(bulan('2026-06', 30), '2026-06', pada(30));
  assert.equal(s.lengkap, true);
  assert.equal(s.setara.faktor, 1);
  assert.equal(s.setara.perkiraan, false);
  assert.equal(s.setara.labaBersih, s.labaBersih);
});

/* ------------------------------------------------- Kebiasaan mencatat/skor */

test('menyusul mencatat struk lama tidak pernah menurunkan nilai konsistensi', () => {
  // Mulai memakai aplikasi tanggal 15, rajin tiap hari sampai tanggal 18.
  const rajin = [15, 16, 17, 18].flatMap((d) => hari(`2026-06-${d}`));
  const sebelum = summarizeMonth(rajin, '2026-06', pada(18));
  assert.equal(sebelum.konsistensi, 1);

  // Tanggal 18 dia menyusul mencatat satu struk tertanggal 2.
  const sesudah = summarizeMonth([...rajin, ...hari('2026-06-02', '2026-06-18')], '2026-06', pada(18));
  assert.ok(
    sesudah.konsistensi >= sebelum.konsistensi,
    `mencatat lebih banyak justru menurunkan konsistensi: ${sebelum.konsistensi} -> ${sesudah.konsistensi}`,
  );

  const poin = (s) => computeMetrics(PROFIL, s).komponenSkor.find((k) => k.aspek === 'Kebiasaan mencatat').poin;
  assert.ok(poin(sesudah) >= poin(sebelum), 'poin kebiasaan mencatat turun setelah mencatat lebih banyak');
});

test('yang memang mulai mencatat sejak awal bulan tetap dinilai sejak awal bulan', () => {
  // Mulai tanggal 2, tapi hanya mencatat 3 hari sampai tanggal 18 — ini memang
  // tidak konsisten, dan harus tetap tercermin di nilainya.
  const jarang = ['02', '03', '04'].flatMap((d) => hari(`2026-06-${d}`));
  const s = summarizeMonth(jarang, '2026-06', pada(18));
  assert.equal(s.hariSejakMulai, 17);
  assert.ok(s.konsistensi < 0.25, `konsistensi ${s.konsistensi} seharusnya rendah`);
});

/* ----------------------------------------------------------- Konteks untuk AI */

test('tren tidak membandingkan bulan berjalan dengan bulan penuh', () => {
  const trx = [...bulan('2026-04', 30), ...bulan('2026-05', 31), ...bulan('2026-06', 8)];
  const { riwayat, berjalan } = cashbookContext(trx, pada(8));

  // Penjualan tidak berubah sedikit pun; tidak boleh ada klaim naik/turun.
  assert.doesNotMatch(riwayat, /penjualan turun/i);
  assert.match(riwayat, /Tren antar bulan penuh/);
  assert.match(berjalan, /BARU BERJALAN 8 dari 30 hari/);
});

test('pengeluaran terbesar digabung, bukan lima baris kembar', () => {
  const trx = bulan('2026-06', 8);
  const { berjalan } = cashbookContext(trx, pada(8));
  const baris = berjalan.split('\n').find((l) => l.includes('Pengeluaran terbesar'));

  assert.ok(baris, 'baris pengeluaran terbesar hilang');
  assert.match(baris, /8x/, 'belanja harian yang berulang seharusnya digabung dengan jumlah kalinya');
  const belanja = baris.match(/Belanja bahan \/ barang dagangan/g) ?? [];
  assert.ok(belanja.length <= 2, `masih ada baris kembar: ${baris}`);
});

/* --------------------------------------------- Jangkauan konteks & caching */

test('AI melihat SELURUH bulan yang dicatat, bukan tiga bulan terakhir', () => {
  /*
   * Pemilik usaha yang memindahkan dua tahun pembukuan fisik ke aplikasi ini
   * harus mendapat saran dari seluruh catatannya. Sebelum ini konteksnya
   * dipatok 3 bulan terakhir: 21 dari 24 bulan tidak pernah sampai ke model,
   * dan model tidak punya cara tahu bahwa ada yang tidak dilihatnya.
   */
  const trx = [];
  const bulanDiuji = [];
  for (let i = 0; i < 24; i++) {
    const d = new Date(2024, 6 + i, 1);
    const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    bulanDiuji.push(m);
    trx.push(...bulan(m, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  }

  const { riwayat } = cashbookContext(trx, new Date('2026-07-15T12:00:00Z'));
  const disebut = bulanDiuji.filter((m) => {
    const nama = new Date(Number(m.slice(0, 4)), Number(m.slice(5)) - 1, 1)
      .toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
    return riwayat.includes(nama);
  });

  assert.equal(disebut.length, 24, `hanya ${disebut.length} dari 24 bulan yang sampai ke AI`);
  assert.match(riwayat, /Cakupan riwayat: 24 bulan yang sudah selesai/);
  assert.match(riwayat, /tidak ada bulan yang disembunyikan darimu/);
});

test('riwayat yang stabil ditandai untuk caching, bulan berjalan tidak', () => {
  /*
   * Riwayatnya sengaja panjang (setahun penuh). Dengan dua bulan saja, awalannya
   * masih di bawah ambang 1024 token dan penandanya memang TIDAK dipasang —
   * lihat uji berikutnya. Menandai awalan yang terlalu pendek tidak menghasilkan
   * apa pun, jadi yang diuji di sini adalah keadaan saat caching benar-benar bisa
   * bekerja: penanda ada di blok stabil, dan tidak pernah di blok yang berubah.
   */
  const trx = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(2025, 5 + i, 1);
    const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    trx.push(...bulan(m, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  }
  trx.push(...bulan('2026-06', 8));
  const blocks = chatSystem(PROFIL, computeMetrics(PROFIL, null), cashbookContext(trx, pada(8)));

  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0].cache_control, { type: 'ephemeral' }, 'blok stabil tidak ditandai untuk caching');
  assert.equal(blocks[1].cache_control, undefined, 'blok yang berubah-ubah tidak boleh ditandai');

  // Yang stabil di depan, yang berubah tiap transaksi di belakang.
  assert.match(blocks[0].text, /Konsultan Nova/);
  assert.match(blocks[0].text, /RIWAYAT/);
  assert.doesNotMatch(blocks[0].text, /BULAN BERJALAN/);
  assert.match(blocks[1].text, /BULAN BERJALAN/);

});

test('riwayat panjang mendorong blok stabil melewati ambang cache', () => {
  /*
   * Ambang minimum prompt caching Sonnet 5 adalah 1024 token, dan blok peran
   * saja hanya sekitar 550 token — jadi penanda cache di aplikasi ini selama
   * ini diam-diam tidak berefek apa pun. Menggabungkan riwayat ke blok yang
   * sama barulah membentuk awalan yang cukup panjang untuk benar-benar tersimpan.
   *
   * Perkiraan kasar 3,3 karakter per token untuk bahasa Indonesia; count_tokens
   * tetap acuan sebenarnya, tapi uji ini menjaga arah perubahannya.
   */
  const perkiraanToken = (teks) => Math.round(teks.length / 3.3);
  const stabil = (trx, now) => chatSystem(PROFIL, computeMetrics(PROFIL, null), cashbookContext(trx, now))[0].text;

  const setahun = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(2025, 6 + i, 1);
    const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    setahun.push(...bulan(m, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  }
  const token12Bulan = perkiraanToken(stabil(setahun, new Date('2026-07-15T12:00:00Z')));
  assert.ok(token12Bulan >= 1024, `12 bulan riwayat hanya ~${token12Bulan} token, masih di bawah ambang 1024`);

  /*
   * Pengguna dengan riwayat pendek memang tidak akan tercache — awalannya
   * belum cukup panjang. Itu bukan masalah: prompt-nya juga masih murah.
   * Yang penting penandanya sudah di tempat yang benar begitu riwayatnya tumbuh.
   */
  const token3Bulan = perkiraanToken(stabil([...bulan('2026-04', 30), ...bulan('2026-05', 31)], pada(8)));
  assert.ok(token3Bulan < token12Bulan, 'riwayat lebih panjang seharusnya menghasilkan blok stabil lebih besar');
});

test('bulan berjalan tidak ikut ke blok yang di-cache', () => {
  // Blok stabil harus identik sebelum dan sesudah pengguna mencatat hari ini.
  const dasar = [...bulan('2026-04', 30), ...bulan('2026-05', 31)];
  const sebelum = cashbookContext([...dasar, ...bulan('2026-06', 8)], pada(9)).riwayat;
  const sesudah = cashbookContext([...dasar, ...bulan('2026-06', 9)], pada(9)).riwayat;

  assert.equal(sebelum, sesudah, 'mencatat transaksi hari ini membatalkan cache riwayat');
});

/* --------------------------------------------------------------- Laporan KUR */

test('rata-rata laba bulanan hanya dari bulan penuh', () => {
  const trx = [
    ...bulan('2026-03', 31),
    ...bulan('2026-04', 30),
    ...bulan('2026-05', 31),
    ...bulan('2026-06', 8), // bulan berjalan
  ];
  const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];
  const summaries = summarizeRange(trx, months, pada(8));

  const lengkap = summaries.filter(isMonthComplete);
  assert.equal(lengkap.length, 3, 'bulan kosong atau bulan berjalan ikut terhitung');

  const rata = Math.round(lengkap.reduce((s, m) => s + m.labaBersih, 0) / lengkap.length);
  const rataSebenarnya = Math.round((31 + 30 + 31) * LABA_HARIAN / 3);
  assert.equal(rata, rataSebenarnya);

  // Cara lama — dibagi jumlah bulan yang ada isinya — memang lebih kecil.
  const terisi = summaries.filter((s) => s.jumlahTransaksi > 0);
  const rataLama = Math.round(terisi.reduce((s, m) => s + m.labaBersih, 0) / terisi.length);
  assert.ok(rataLama < rata, 'kasus uji tidak lagi menangkap masalahnya');
});

test('bulan yang sudah habis tapi cuma tercatat sepotong tidak ikut dirata-rata', () => {
  /*
   * Kasus ini muncul dari uji lewat server sungguhan, tepat di tanggal terakhir
   * bulan: "bulan sudah lewat" ternyata tidak sama dengan "bulan sudah tercatat".
   * Bulan yang habis dengan 8 dari 31 hari terisi tetap saja bukan gambaran
   * sebulan, dan kalau ikut dibagi, rata-ratanya jatuh persis seperti semula.
   */
  const trx = [...bulan('2026-04', 30), ...bulan('2026-05', 31), ...bulan('2026-06', 8)];
  const summaries = summarizeRange(trx, ['2026-04', '2026-05', '2026-06'], pada(30));

  const juni = summaries.find((s) => s.month === '2026-06');
  assert.equal(juni.lengkap, true, 'tanggal 30 Juni: bulannya memang sudah habis');
  assert.equal(juni.hariTercatat, 8);
  assert.equal(isMonthComplete(juni), false, 'bulan bolong lolos ke rata-rata');

  const lengkap = summaries.filter(isMonthComplete);
  const rata = Math.round(lengkap.reduce((s, m) => s + m.labaBersih, 0) / lengkap.length);
  assert.equal(rata, Math.round((30 + 31) * LABA_HARIAN / 2));
});

test('bulan bolong tidak dipakai menggantikan perkiraan di dasbor', () => {
  const s = summarizeMonth(bulan('2026-06', 8), '2026-06', pada(30));
  assert.equal(isMonthReliable(s), false, '8 dari 30 hari tidak boleh dianggap mewakili sebulan');

  const m = computeMetrics(PROFIL, isMonthReliable(s) ? s : null, s);
  assert.equal(m.sumber, 'perkiraan');
  assert.equal(m.catatanBelumCukup, true, 'pengguna harus diberi tahu kenapa catatannya belum dipakai');
  assert.equal(m.hariTercatat, 8);
  assert.equal(m.hariBerjalan, 30);
  // Yang penting: angkanya tidak jadi 8/30 dari kenyataan.
  assert.equal(m.omzet, 12_000_000);
});

test('bulan tanpa catatan tidak boleh terbaca sebagai bulan berpenghasilan nol', () => {
  const summaries = summarizeRange(bulan('2026-05', 31), ['2026-04', '2026-05'], pada(8));
  const kosong = summaries.find((s) => s.month === '2026-04');

  assert.equal(kosong.jumlahTransaksi, 0);
  assert.equal(isMonthComplete(kosong), false, 'bulan kosong tidak boleh ikut dirata-rata');
});

test('baris dengan jenis tak dikenal dilewati, bukan dihitung sebagai uang keluar', () => {
  /*
   * Cabang `else` yang dulu ada memperlakukan apa pun yang bukan "masuk"
   * sebagai uang keluar — termasuk `"Masuk"` berhuruf besar atau medan yang
   * hilang dari berkas cadangan yang pernah disunting tangan. Pemasukan
   * Rp 900.000 terbaca sebagai pengeluaran Rp 900.000: saldo kas meleset
   * Rp 1,8 juta dari SATU baris, tanpa satu pun pesan.
   *
   * Melewatkannya membuat laporan lebih KECIL dari kenyataan, bukan terbalik —
   * arah yang sama dengan aturan cakupan bulan, karena aplikasi ini tidak boleh
   * pernah membesar-besarkan usaha di depan bank.
   */
  const dasar = { tanggal: '2026-08-05', kategori: 'penjualan', jumlah: 900_000, createdAt: '2026-08-05T03:00:00.000Z' };
  const rows = [
    { id: 't1', jenis: 'masuk', ...dasar },
    { id: 't2', jenis: 'Masuk', ...dasar },      // huruf besar
    { id: 't3', ...dasar },                      // medan hilang
    { id: 't4', jenis: 'entah', ...dasar },      // nilai asing
  ];

  const s = summarizeMonth(rows, '2026-08', new Date('2026-08-31T05:00:00.000Z'));

  assert.equal(s.totalMasuk, 900_000, 'hanya baris yang jenisnya sah yang dihitung');
  assert.equal(s.totalKeluar, 0, 'baris asing tidak boleh berbalik menjadi uang keluar');
  assert.equal(s.saldoKas, 900_000);
  assert.equal(s.jumlahTransaksi, 1, 'jumlah transaksi ikut menyaring supaya angkanya berdamai');
  assert.equal(s.barisDiabaikan, 3, 'kelainannya harus bisa ditemukan, bukan hilang diam-diam');
});

test('buku kas yang sehat tidak punya baris diabaikan', () => {
  const s = summarizeMonth(hari('2026-08-05'), '2026-08', new Date('2026-08-31T05:00:00.000Z'));
  assert.equal(s.barisDiabaikan, 0);
  assert.ok(s.jumlahTransaksi > 0);
});
