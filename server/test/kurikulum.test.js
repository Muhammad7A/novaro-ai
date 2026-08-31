/**
 * Uji kurikulum modul.
 *
 * Yang dijaga di sini bukan isi materinya — itu urusan penulisnya — melainkan
 * hal-hal yang kalau rusak tidak membuat apa pun gagal, hanya membuat aplikasi
 * berbohong pelan-pelan: nomor modul yang bertabrakan dengan progres peserta
 * yang sudah tersimpan, daftar AI yang tidak lagi sama dengan daftar di layar,
 * dan sesi harian yang bolong.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  JALUR,
  KURIKULUM,
  MODUL_MAKS,
  MODUL_MIN,
  SESI_HARIAN,
  cariModul,
  materiModul,
  modulRingkasUntukAI,
  nomorModulSah,
  ringkasKemajuan,
} from '../lib/kurikulum.js';
import { MODUL_RINGKAS, chatSystem } from '../lib/prompts.js';

test('nomor modul unik — nomor ganda akan merusak progres peserta', () => {
  const nomor = KURIKULUM.map((m) => m.no);
  assert.equal(new Set(nomor).size, nomor.length, 'ada nomor modul yang dipakai dua kali');
});

test('sesi harian berurutan 1..7 tanpa bolong', () => {
  /*
   * Intervensi dipadatkan menjadi tujuh sesi harian (satu minggu) agar muat di
   * jendela sampai 31 Agustus 2026 — lihat catatan rancangan di kurikulum.js.
   * Kartu "sesi hari ini" mengambil sesi terkecil yang belum selesai, jadi satu
   * nomor yang bolong berarti peserta melompati satu hari intervensi tanpa ada
   * yang tahu.
   */
  const sesi = SESI_HARIAN.map((m) => m.sesi);
  assert.deepEqual(sesi, Array.from({ length: sesi.length }, (_, i) => i + 1));
  assert.equal(sesi.length, 7, 'jumlah sesi harian harus 7, sesuai rancangan penelitian');
});

test('semua modul sesi harian ada di jalur dasar, dan sebaliknya', () => {
  for (const m of KURIKULUM) {
    if (m.jalur === 'dasar') assert.ok(m.sesi != null, `modul ${m.no} di jalur dasar tanpa nomor sesi`);
    else assert.equal(m.sesi, null, `modul ${m.no} bukan jalur dasar tapi punya nomor sesi`);
  }
});

test('setiap modul punya jalur yang dikenal', () => {
  for (const m of KURIKULUM) {
    assert.ok(JALUR[m.jalur], `modul ${m.no} memakai jalur tak dikenal: ${m.jalur}`);
  }
});

test('tidak ada modul yang melewati batas micro-learning', () => {
  /*
   * Ulupui et al. (2021) — yang dikutip proposal — membatasi satu unit
   * micro-learning pada 5-10 menit, dan alasan penelitian ini ada justru karena
   * pelatihan konvensional gagal akibat information overload. Modul yang tumbuh
   * jadi 20 menit membatalkan premis intervensinya, bukan sekadar bikin panjang.
   *
   * Batasnya dibedakan sejak pemadatan 14 sesi menjadi 7: sesi harian adalah
   * hasil penggabungan dua topik, jadi 10-15 menit dan itu memang melewati
   * angka Ulupui — pertukaran yang disadari dan dicatat di kurikulum.js. Modul
   * pustaka tidak digabung, jadi tetap dijaga di 5-10 menit. Ambang 15 menit
   * juga yang disebut BAB 1 proposal, sehingga sesi harian tetap punya rujukan.
   */
  for (const m of KURIKULUM) {
    const [min, maks] = m.sesi != null ? [10, 15] : [5, 10];
    assert.ok(
      m.menit >= min && m.menit <= maks,
      `modul ${m.no} diperkirakan ${m.menit} menit — di luar ${min}-${maks}`,
    );
  }
});

test('setiap modul punya isi yang bisa dibaca tanpa video', () => {
  for (const m of KURIKULUM) {
    assert.ok(m.judul && m.ringkas, `modul ${m.no} kurang judul/ringkasan`);
    assert.ok(Array.isArray(m.isi) && m.isi.length >= 3, `modul ${m.no} isinya terlalu tipis`);
    assert.ok(m.praktik, `modul ${m.no} tidak punya langkah praktik`);
    for (const bagian of m.isi) {
      assert.ok(bagian.h, `modul ${m.no} punya bagian tanpa judul`);
      assert.ok(bagian.p || bagian.li, `modul ${m.no} bagian "${bagian.h}" kosong`);
    }
  }
});

test('medan video hanya diisi ID yang berbentuk wajar', () => {
  /*
   * Modul tanpa video sengaja tidak diberi tautan sama sekali. Tautan mati yang
   * berakhir di "Video unavailable" membuat peserta mengira aplikasinya rusak.
   */
  for (const m of KURIKULUM) {
    if (m.video === undefined) continue;
    assert.match(m.video, /^[A-Za-z0-9_-]{11}$/, `modul ${m.no} punya ID video yang tidak berbentuk ID YouTube`);
  }
});

test('nomorModulSah menolak yang bukan nomor modul', () => {
  assert.ok(nomorModulSah(1));
  assert.ok(nomorModulSah(String(MODUL_MAKS)));
  assert.ok(!nomorModulSah(MODUL_MAKS + 1));
  assert.ok(!nomorModulSah(MODUL_MIN - 1));
  assert.ok(!nomorModulSah('__proto__'));
  assert.ok(!nomorModulSah('2; DROP TABLE'));
  assert.ok(!nomorModulSah(null));
  assert.ok(!nomorModulSah(1.5));
});

test('cariModul mengembalikan modul yang benar', () => {
  assert.equal(cariModul(1).sesi, 1);
  assert.equal(cariModul('1').no, 1);
  assert.equal(cariModul(999), null);
});

test('daftar modul untuk AI diturunkan dari kurikulum, bukan disalin', () => {
  /*
   * Inti dari memindahkan kurikulum ke satu berkas. Kalau uji ini gagal,
   * berarti daftar di prompt sudah kembali menjadi kembaran yang bisa
   * menyimpang — dan AI akan menyarankan nomor modul yang isinya lain.
   */
  assert.equal(MODUL_RINGKAS, modulRingkasUntukAI());
  for (const m of KURIKULUM) {
    assert.ok(MODUL_RINGKAS.includes(`${m.no}. ${m.judul}`), `modul ${m.no} tidak muncul di daftar untuk AI`);
  }
});

test('daftar untuk AI tetap ramping — ia ikut terkirim tiap pertanyaan', () => {
  /*
   * Daftar ini duduk di system prompt dan dibayar berulang kali, ikut memakan
   * anggaran token harian peserta. Bentuk "judul + ringkasan" pernah diukur
   * 3.927 char (~1.007 token); bentuk sekarang ~1.350 char (~345 token).
   * Ambang ini menjaga supaya ringkasan tidak diam-diam masuk kembali.
   */
  assert.ok(
    MODUL_RINGKAS.length < 2000,
    `daftar modul untuk AI membengkak jadi ${MODUL_RINGKAS.length} char — periksa apakah ringkasan ikut terkirim`,
  );
});

test('pengelompokan jalur ikut terkirim ke AI', () => {
  // Tanpa ini model tidak bisa membedakan sesi harian dari pustaka, lalu
  // mengarahkan peserta hari ketiga ke modul titik impas.
  for (const j of Object.values(JALUR)) {
    assert.ok(MODUL_RINGKAS.includes(j.nama), `jalur "${j.nama}" tidak disebut di daftar untuk AI`);
  }
});

/* =================================================== Konteks belajar untuk AI */

test('ringkasKemajuan menyebut sesi yang sedang dijalani', () => {
  /*
   * Tanpa blok ini AI buta terhadap hari keberapa peserta berada, lalu bisa
   * mengarahkan peserta hari ketiga ke modul titik impas. Ini juga yang
   * memungkinkan jawabannya dikaitkan dengan materi hari itu — inti dari
   * menggabungkan micro-learning dengan AI.
   */
  const teks = ringkasKemajuan({ 1: true, 2: true });
  assert.match(teks, /2 dari 7 selesai/);
  assert.match(teks, /sesi 3/i, 'harus menyebut sesi berikutnya yang belum dikerjakan');
  assert.ok(teks.includes(SESI_HARIAN[2].judul));
});

test('ringkasKemajuan mengantar kembali ke sesi yang dilewati, bukan maju', () => {
  // Peserta melompat ke sesi 5 tanpa mengerjakan 2-4. Yang "sedang dijalani"
  // tetap sesi 2 — melompat tidak boleh berarti kehilangan tiga sesi.
  const teks = ringkasKemajuan({ 1: true, 5: true });
  assert.match(teks, /sesi 2/i);
});

test('ringkasKemajuan menangani peserta baru dan peserta yang sudah tamat', () => {
  assert.match(ringkasKemajuan({}), /0 dari 7/);
  assert.match(ringkasKemajuan({}), /sesi 1/i);

  const semua = Object.fromEntries(SESI_HARIAN.map((m) => [m.no, true]));
  assert.match(ringkasKemajuan(semua), /seluruh sesi harian sudah selesai/i);

  // Tidak boleh melempar saat progres berbentuk aneh.
  assert.ok(ringkasKemajuan(undefined).length > 0);
  assert.ok(ringkasKemajuan(null).length > 0);
});

test('materiModul memuat isi lengkap dan praktiknya', () => {
  const teks = materiModul(7); // Laporan bulanan dan berkas untuk KUR
  const m = cariModul(7);
  assert.match(teks, /MATERI MODUL YANG SEDANG DIBUKA PESERTA/);
  assert.ok(teks.includes(m.judul));
  assert.match(teks, /Praktik yang diminta modul ini:/);
  for (const bagian of m.isi) assert.ok(teks.includes(bagian.h), `bagian "${bagian.h}" hilang dari materi`);
});

test('materiModul menolak nomor yang tidak ada, tanpa melempar', () => {
  assert.equal(materiModul(999), '');
  assert.equal(materiModul('__proto__'), '');
  assert.equal(materiModul(undefined), '');
});

test('materi satu modul tetap layak dikirim dalam satu prompt', () => {
  /*
   * Materi ini hanya menyertai pertanyaan dari dalam modul, tapi harganya
   * tetap ditagihkan ke anggaran token harian peserta. PERKIRAAN.chatModul
   * disetel 4.500 (chat 3.500 + materi); kalau satu modul membengkak melewati
   * ambang ini, perkiraan itu tidak lagi benar dan anggarannya bocor.
   */
  for (const m of KURIKULUM) {
    const panjang = materiModul(m.no).length;
    assert.ok(panjang < 4600, `materi modul ${m.no} ${panjang} char — terlalu panjang untuk satu prompt`);
  }
});

test('konteks belajar masuk ke blok volatil, bukan blok yang di-cache', () => {
  /*
   * Kemajuan berubah setiap kali peserta menyelesaikan satu sesi. Kalau ia
   * ikut ke blok stabil, cache-nya batal justru pada hari-hari peserta paling
   * aktif — kebalikan dari yang diinginkan.
   */
  const metrics = { skor: 0, komponenSkor: [], ringkas: '' };
  const tanpa = chatSystem(null, metrics, '');
  const dengan = chatSystem(null, metrics, '', {
    kemajuan: ringkasKemajuan({ 1: true }),
    materi: materiModul(2),
  });

  assert.equal(dengan.length, 2);

  /*
   * Sifat yang sebenarnya dijaga: blok stabil HARUS sama persis, ada atau
   * tidak ada konteks belajar. Memeriksa "apakah blok stabil memuat kata
   * KEMAJUAN BELAJAR" salah sasaran — PERAN memang menyebut nama blok itu di
   * dalam instruksinya, dan itu bagian yang tidak berubah.
   */
  assert.equal(dengan[0].text, tanpa[0].text, 'awalan yang di-cache tidak boleh berubah oleh konteks belajar');

  assert.ok(dengan[1].text.includes('KEMAJUAN BELAJAR PESERTA'));
  assert.ok(dengan[1].text.includes('MATERI MODUL YANG SEDANG DIBUKA PESERTA'));
  assert.ok(dengan[1].text.includes('Sesi harian: 1 dari 7'), 'datanya, bukan sekadar judul bloknya');
});

test('chat tanpa konteks belajar tetap berjalan seperti sebelumnya', () => {
  const metrics = { skor: 0, komponenSkor: [], ringkas: '' };
  const blok = chatSystem(null, metrics, '');
  assert.equal(blok.length, 2);
  assert.ok(!blok[1].text.includes('KEMAJUAN BELAJAR'));
  assert.ok(!blok[1].text.includes('MATERI MODUL'));
});
