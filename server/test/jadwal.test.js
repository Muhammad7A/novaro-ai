/**
 * Uji jadwal belajar — gerbang maju untuk tujuh sesi harian.
 *
 * Yang dijaga di sini adalah sifat yang membuat gerbangnya aman dipakai
 * penelitian, dan tiap satunya pernah menjadi kesalahan nyata di kelas alat
 * seperti ini:
 *
 *   - sesi kemarin TIDAK pernah menutup lagi (kalau ini rusak, peserta
 *     kehilangan materi permanen dan post-test menguji yang tak pernah diajarkan);
 *   - batas hari memakai kalender WIB, bukan UTC (kalau ini rusak, sesi baru
 *     terbuka pukul 07.00 pagi, bukan tengah malam);
 *   - jadwal yang belum ditetapkan tidak membuka apa pun, dan itu terlihat.
 *
 *   node --test
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { KURIKULUM, SESI_HARIAN } from '../lib/kurikulum.js';
import {
  JUMLAH_SESI,
  hariKe,
  jadwalUntukAI,
  modulTerbuka,
  ringkasJadwal,
  selisihHari,
  sesiTerbuka,
  tanggalSah,
  tanggalSesiTerbuka,
} from '../lib/jadwal.js';

/** Waktu UTC yang jatuh pada tanggal WIB tertentu, pada jam yang diminta. */
const wib = (tanggal, jam = 12) =>
  new Date(Date.parse(`${tanggal}T00:00:00Z`) + (jam - 7) * 3600 * 1000);

const MULAI = '2026-08-17';

/* ========================================================= Tanggal & selisih */

test('tanggalSah menolak yang bukan tanggal kalender', () => {
  assert.equal(tanggalSah('2026-08-17'), '2026-08-17');
  for (const buruk of ['2026-02-31', '2026-13-01', '17-08-2026', '2026-8-17', '', null, undefined, 'hari ini']) {
    assert.equal(tanggalSah(buruk), null, `${buruk} seharusnya ditolak`);
  }
});

test('selisih hari melewati pergantian bulan dan tahun', () => {
  assert.equal(selisihHari('2026-08-17', '2026-08-17'), 0);
  assert.equal(selisihHari('2026-08-30', '2026-09-02'), 3);
  assert.equal(selisihHari('2026-12-30', '2027-01-02'), 3);
  assert.equal(selisihHari('2026-08-20', '2026-08-17'), -3);
  assert.equal(selisihHari('bukan tanggal', '2026-08-17'), null);
});

/* ================================================================ hariKe */

test('hari pertama adalah tanggal mulai itu sendiri, bukan sesudahnya', () => {
  // Pendampingan dan sesi 1 terjadi pada hari yang sama.
  assert.equal(hariKe(MULAI, wib(MULAI)), 1);
  assert.equal(hariKe(MULAI, wib('2026-08-18')), 2);
  assert.equal(hariKe(MULAI, wib('2026-08-23')), 7);
});

test('batas hari mengikuti kalender WIB, bukan UTC', () => {
  /*
   * Ini bukan kerewelan. Pukul 00.30 WIB tanggal 18 masih 17.30 UTC tanggal 17.
   * Kalau batasnya UTC, sesi 2 baru terbuka pukul 07.00 pagi — dan peserta yang
   * membuka aplikasi subuh sebelum warung buka, salah satu kebiasaan yang justru
   * ingin diamati penelitian ini, diberi tahu sesinya belum terbuka padahal
   * harinya sudah berganti.
   */
  assert.equal(hariKe(MULAI, wib('2026-08-17', 23.5)), 1, '23.30 WIB masih hari ke-1');
  assert.equal(hariKe(MULAI, wib('2026-08-18', 0.5)), 2, '00.30 WIB sudah hari ke-2');
  assert.equal(hariKe(MULAI, wib('2026-08-18', 6)), 2, '06.00 WIB tetap hari ke-2');
});

test('jadwal yang belum ditetapkan tidak menghasilkan hari', () => {
  for (const kosong of [null, undefined, '', 'entah']) {
    assert.equal(hariKe(kosong, wib(MULAI)), null);
    assert.equal(sesiTerbuka(kosong, wib(MULAI)), 0);
  }
});

/* ========================================================== sesiTerbuka */

test('satu sesi terbuka per hari, dan berhenti di sesi terakhir', () => {
  const urut = [];
  for (let i = 0; i < 10; i++) {
    const hari = new Date(Date.parse(`${MULAI}T05:00:00Z`) + i * 86400000);
    urut.push(sesiTerbuka(MULAI, hari));
  }
  assert.deepEqual(urut, [1, 2, 3, 4, 5, 6, 7, 7, 7, 7], 'tidak boleh melewati jumlah sesi');
  assert.equal(JUMLAH_SESI, SESI_HARIAN.length);
});

test('jadwal yang ditetapkan untuk tanggal depan belum membuka apa pun', () => {
  // Pendamping boleh menetapkan "mulai Senin" pada hari Jumat.
  assert.equal(sesiTerbuka('2026-08-24', wib('2026-08-21')), 0);
  assert.equal(hariKe('2026-08-24', wib('2026-08-21')), -2, 'hitungan negatif tetap dilaporkan apa adanya');
});

/* ======================================================== modulTerbuka */

test('gerbangnya MAJU: sesi kemarin tidak pernah menutup lagi', () => {
  /*
   * Sifat paling penting di berkas ini. Praktik sesi 1 menyuruh peserta
   * membandingkan tebakannya di sesi 4, dan modul 2 mengajarkan bahwa catatan
   * cloud "bisa dibuka kapan saja". Penguncian mundur membuat aplikasi
   * membantah materinya sendiri — dan menghapus kemungkinan mengulang.
   */
  const hariKetujuh = wib('2026-08-23');
  for (const m of SESI_HARIAN) {
    assert.ok(modulTerbuka(m.no, MULAI, hariKetujuh), `sesi ${m.sesi} harus tetap terbuka di hari ke-7`);
  }
  // Bahkan sebulan kemudian.
  assert.ok(modulTerbuka(SESI_HARIAN[0].no, MULAI, wib('2026-09-20')));
});

test('sesi yang harinya belum tiba tertutup', () => {
  const hariKetiga = wib('2026-08-19');
  assert.ok(modulTerbuka(SESI_HARIAN[2].no, MULAI, hariKetiga), 'sesi 3 terbuka di hari ke-3');
  assert.ok(!modulTerbuka(SESI_HARIAN[3].no, MULAI, hariKetiga), 'sesi 4 belum');
  assert.ok(!modulTerbuka(SESI_HARIAN[6].no, MULAI, hariKetiga), 'sesi 7 apalagi');
});

test('22 modul pustaka tidak ikut digerbang waktu', () => {
  const pustaka = KURIKULUM.filter((m) => m.sesi == null);
  assert.equal(pustaka.length, 22);
  for (const m of pustaka) {
    assert.ok(modulTerbuka(m.no, null, wib(MULAI)), `modul pustaka ${m.no} tidak boleh ikut terkunci`);
    assert.ok(modulTerbuka(m.no, MULAI, wib(MULAI)));
  }
});

test('nomor modul yang tidak ada selalu tertutup', () => {
  // Tidak boleh lolos lewat cabang "bukan sesi harian, berarti bebas".
  for (const asing of [999, 0, -1, '__proto__', null, undefined, 1.5]) {
    assert.ok(!modulTerbuka(asing, MULAI, wib('2026-09-01')), `${asing} seharusnya tertutup`);
  }
});

test('tanpa jadwal, tidak satu pun sesi harian terbuka', () => {
  for (const m of SESI_HARIAN) {
    assert.ok(!modulTerbuka(m.no, null, wib(MULAI)), `sesi ${m.sesi} tidak boleh terbuka sebelum pendamping memulai`);
  }
});

/* ========================================================= Tanggal buka */

test('tanggal terbukanya tiap sesi bisa dihitung untuk diberitahukan', () => {
  assert.equal(tanggalSesiTerbuka(1, MULAI), '2026-08-17');
  assert.equal(tanggalSesiTerbuka(7, MULAI), '2026-08-23');
  assert.equal(tanggalSesiTerbuka(3, null), null);
  assert.equal(tanggalSesiTerbuka(0, MULAI), null);
});

/* ========================================================= ringkasJadwal */

test('ringkasan jadwal menjawab "kapan sesi berikutnya terbuka" dengan tanggal', () => {
  const j = ringkasJadwal({ mulaiPada: MULAI }, wib('2026-08-19'));
  assert.equal(j.dimulai, true);
  assert.equal(j.hariKe, 3);
  assert.equal(j.sesiTerbuka, 3);
  assert.equal(j.sesiBerikut, 4);
  assert.equal(j.berikutTerbukaPada, '2026-08-20');
  assert.equal(j.jumlahSesi, 7);
});

test('ringkasan jadwal peserta yang sudah tamat tidak menjanjikan sesi berikutnya', () => {
  const j = ringkasJadwal({ mulaiPada: MULAI }, wib('2026-09-01'));
  assert.equal(j.sesiTerbuka, 7);
  assert.equal(j.sesiBerikut, null);
  assert.equal(j.berikutTerbukaPada, null);
});

test('ringkasan jadwal peserta yang belum dimulai menyatakannya, bukan menebak', () => {
  const j = ringkasJadwal({}, wib(MULAI));
  assert.equal(j.dimulai, false);
  assert.equal(j.hariKe, null);
  assert.equal(j.sesiTerbuka, 0);
  assert.equal(ringkasJadwal(null, wib(MULAI)).dimulai, false);
});

/* ========================================================= Konteks AI */

test('AI diberi tahu sesi mana yang belum terbuka, beserta tanggalnya', () => {
  /*
   * Tanpa baris ini model bisa menyuruh peserta hari ke-2 "membaca sesi 5
   * dulu" — saran yang tidak bisa dijalankan, dan yang akan dibaca peserta
   * sebagai aplikasi rusak, bukan sebagai saran yang keliru.
   */
  const teks = jadwalUntukAI({ mulaiPada: MULAI }, wib('2026-08-18'));
  assert.match(teks, /hari ke-2/i);
  assert.match(teks, /sesi 3 baru terbuka 2026-08-19/i);
  assert.match(teks, /jangan menyuruhnya membaca sesi yang belum terbuka/i);
});

test('AI diberi tahu bila jadwal peserta belum dimulai', () => {
  assert.match(jadwalUntukAI({}, wib(MULAI)), /belum dimulai/i);
});

test('AI tidak diberi peringatan palsu saat seluruh sesi sudah terbuka', () => {
  const teks = jadwalUntukAI({ mulaiPada: MULAI }, wib('2026-09-01'));
  assert.match(teks, /seluruh 7 sesi harian sudah terbuka/i);
  assert.ok(!/belum terbuka/i.test(teks));
});
