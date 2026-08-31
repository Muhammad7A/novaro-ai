/**
 * Uji regresi anggaran token.
 *
 * Yang dijaga di sini bukan hanya "batasnya bekerja", tapi dua keputusan yang
 * mudah sekali dibalik saat merapikan kode nanti — dan dua-duanya merugikan
 * peserta kalau terbalik:
 *
 *   1. Jatah diperiksa SEBELUM permintaan dikirim, memakai perkiraan biaya.
 *      Kalau hanya diperiksa sesudahnya, satu klik "Perbarui rekomendasi"
 *      seharga 6.000 token masih bisa lewat dengan sisa jatah 200.
 *   2. Token baca-cache dihitung sepersepuluh, sesuai tarifnya. Kalau dihitung
 *      penuh, peserta yang paling rajin mencatat — bukunya paling panjang, jadi
 *      awalannya paling banyak tercache — justru paling cepat kehabisan jatah.
 *
 *   npm test
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { ANGGARAN, PERKIRAAN, awalMinggu, cekAnggaran, hitungToken, pangkasLog, ringkasAnggaran } from '../lib/anggaran.js';

const log = (...pasangan) => pasangan.map(([tanggal, token]) => ({ tanggal, token }));
// Rabu, 15 Juli 2026. Pukul 12.00 WIB.
const RABU = new Date('2026-07-15T05:00:00Z');

/* ------------------------------------------------------------ Perhitungan */

test('token dihitung sesuai tarif tiap jenisnya', () => {
  assert.equal(hitungToken({ input_tokens: 1000, output_tokens: 500 }), 1500);

  /*
   * 10.000 token baca-cache ditagih sekitar sepersepuluh, jadi dihitung 1.000.
   * Menghitungnya penuh akan menghukum peserta yang bukunya paling panjang —
   * padahal merekalah yang biaya per pertanyaannya paling murah.
   */
  assert.equal(hitungToken({ cache_read_input_tokens: 10_000 }), 1000);
  assert.equal(hitungToken({ cache_creation_input_tokens: 1000 }), 1250);
  assert.equal(hitungToken(undefined), 0);
  assert.equal(hitungToken({ input_tokens: 'x' }), 0);
});

test('peserta dengan riwayat panjang tidak lebih cepat kehabisan jatah', () => {
  // Pertanyaan yang sama, dua peserta. Yang kedua punya awalan besar yang tercache.
  const baru = hitungToken({ input_tokens: 2900, output_tokens: 260 });
  const rajin = hitungToken({ input_tokens: 700, cache_read_input_tokens: 3000, output_tokens: 260 });
  assert.ok(rajin < baru, 'peserta yang paling rajin mencatat tidak boleh dihukum oleh anggarannya sendiri');
});

/* ------------------------------------------------------------- Jendelanya */

test('minggu dimulai hari Senin', () => {
  assert.equal(awalMinggu('2026-07-15'), '2026-07-13'); // Rabu -> Senin
  assert.equal(awalMinggu('2026-07-13'), '2026-07-13'); // Senin -> dirinya sendiri
  assert.equal(awalMinggu('2026-07-19'), '2026-07-13'); // Minggu -> Senin sebelumnya
  assert.equal(awalMinggu('2026-07-20'), '2026-07-20'); // Senin berikutnya
});

test('pemakaian dihitung per hari dan per minggu kalender', () => {
  const r = ringkasAnggaran(
    log(['2026-07-15', 4000], ['2026-07-14', 6000], ['2026-07-13', 5000], ['2026-07-12', 9000]),
    RABU,
  );
  assert.equal(r.harian.terpakai, 4000, 'hanya hari ini');
  // 12 Juli hari Minggu — minggu sebelumnya, tidak ikut.
  assert.equal(r.mingguan.terpakai, 15_000, 'Senin sampai hari ini saja');
  assert.equal(r.harian.sisa, ANGGARAN.harian - 4000);
  assert.equal(r.mingguan.sisa, ANGGARAN.mingguan - 15_000);
  assert.equal(r.sisa, Math.min(r.harian.sisa, r.mingguan.sisa), 'yang membatasi adalah yang terkecil');
});

test('catatan lama dibuang, catatan dalam jendela disimpan', () => {
  const dipangkas = pangkasLog(log(['2026-07-15', 1], ['2026-07-05', 1], ['2026-06-01', 1]), RABU);
  assert.deepEqual(dipangkas.map((e) => e.tanggal), ['2026-07-15', '2026-07-05']);
});

/* ------------------------------------------------------------ Penolakannya */

test('jatah diperiksa dengan perkiraan biaya, bukan sesudah tagihannya jatuh', () => {
  // Sisa 500 token. Chat diperkirakan 3.500.
  const hampirHabis = log(['2026-07-15', ANGGARAN.harian - 500]);
  const tolak = cekAnggaran(hampirHabis, PERKIRAAN.chat, RABU);
  assert.ok(tolak, 'permintaan yang jelas tidak muat harus ditolak SEBELUM dikirim');
  assert.equal(tolak.jenis, 'harian');

  // Sisa banyak: lewat.
  assert.equal(cekAnggaran(log(['2026-07-15', 1000]), PERKIRAAN.chat, RABU), null);
});

test('rekomendasi yang mahal ditolak walau chat masih muat', () => {
  // Sisa 4.000: cukup untuk satu chat (3.500), tidak cukup untuk rekomendasi (6.000).
  const sisa4rb = log(['2026-07-15', ANGGARAN.harian - 4000]);
  assert.equal(cekAnggaran(sisa4rb, PERKIRAAN.chat, RABU), null, 'chat masih muat');
  assert.ok(cekAnggaran(sisa4rb, PERKIRAAN.rekomendasi, RABU), 'rekomendasi tidak muat dan harus ditolak lebih dulu');
});

test('batas mingguan menutup lebih dulu daripada batas harian', () => {
  /*
   * 7 x batas harian jauh melebihi batas mingguan, jadi yang benar-benar
   * membatasi adalah yang mingguan — dan pesannya harus menyebut yang itu,
   * bukan menyuruh peserta menunggu "besok pagi" untuk jatah yang tidak akan
   * kembali sampai Senin.
   */
  const nyaris = log(
    ['2026-07-13', ANGGARAN.harian],
    ['2026-07-14', ANGGARAN.harian],
    ['2026-07-15', ANGGARAN.mingguan - 2 * ANGGARAN.harian - 100],
  );
  const tolak = cekAnggaran(nyaris, PERKIRAAN.chat, RABU);
  assert.ok(tolak);
  assert.equal(tolak.jenis, 'mingguan');
  assert.match(tolak.pesan, /minggu ini/);
});

test('pesan penolakan menenangkan, bukan menakuti', () => {
  const tolak = cekAnggaran(log(['2026-07-15', ANGGARAN.harian]), PERKIRAAN.chat, RABU);
  // Peserta harus tahu bahwa pembukuannya sendiri tidak ikut terkunci — kalau
  // dia mengira aplikasinya rusak, dia berhenti mencatat, dan pilotnya selesai.
  assert.match(tolak.pesan, /buku kas|laporan|modul/i, 'harus menyebut bahwa fitur lain tetap jalan');
  assert.match(tolak.pesan, /besok/i, 'harus menyebut kapan jatahnya kembali');
  assert.doesNotMatch(tolak.pesan, /token/i, 'peserta tidak perlu tahu istilah token');
});

test('hari baru mengembalikan jatah', () => {
  const kemarinHabis = log(['2026-07-14', ANGGARAN.harian]);
  assert.equal(cekAnggaran(kemarinHabis, PERKIRAAN.chat, RABU), null, 'jatah harian harus penuh lagi keesokan harinya');
});
