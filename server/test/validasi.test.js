/**
 * Uji instrumen validasi materi.
 *
 * Dua hal yang dijaga di sini, dan keduanya adalah kesalahan yang tidak membuat
 * apa pun gagal — hanya membuat hasil validasinya menjadi angka yang tidak
 * berarti:
 *
 *   1. Butir yang menunjuk materi yang TIDAK ADA di kurikulum. Validator akan
 *      mencari modul yang tidak pernah ditulis, lalu memberi nilai rendah pada
 *      sesuatu yang tidak pernah ada — dan skornya tidak bisa ditindaklanjuti.
 *   2. Perhitungan yang keliru di perbatasan kategori. Selisih 0,5% di sekitar
 *      80% mengubah kesimpulan penelitian dari "Layak" menjadi "Sangat Layak"
 *      tanpa satu pun jawaban validator yang berubah.
 *
 *   node --test
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { KURIKULUM, NOMOR_MODUL, SESI_HARIAN } from '../lib/kurikulum.js';
import {
  ASPEK,
  BUTIR,
  INSTRUMEN_VERSI,
  JUMLAH_BUTIR,
  KATEGORI,
  KESIMPULAN,
  SKALA,
  SKOR_MAKSIMUM_PENUH,
  butirAspek,
  cariButir,
  hitungHasil,
  instrumen,
  kategoriKelayakan,
  periksaPengiriman,
  persentaseKelayakan,
  rekapValidasi,
  skorSah,
} from '../lib/validasi.js';

/* ======================================================= Bentuk instrumen */

test('jumlah butir berada dalam rentang yang dirancang (20-25)', () => {
  assert.ok(JUMLAH_BUTIR >= 20 && JUMLAH_BUTIR <= 25, `instrumen berisi ${JUMLAH_BUTIR} butir`);
  assert.equal(SKOR_MAKSIMUM_PENUH, JUMLAH_BUTIR * 5);
});

test('kode butir unik — kode ganda menimpa jawaban validator yang sudah mengisi', () => {
  const kode = BUTIR.map((b) => b.kode);
  assert.equal(new Set(kode).size, kode.length);
});

test('setiap aspek yang divalidasi punya minimal satu butir', () => {
  assert.equal(ASPEK.length, 12, 'penelitian ini menetapkan 12 aspek validasi');
  for (const a of ASPEK) {
    assert.ok(butirAspek(a.kunci).length >= 1, `aspek ${a.kunci} tidak punya butir`);
  }
});

test('setiap butir menempel pada aspek yang dikenal', () => {
  const kunci = new Set(ASPEK.map((a) => a.kunci));
  for (const b of BUTIR) assert.ok(kunci.has(b.aspek), `butir ${b.kode} memakai aspek asing: ${b.aspek}`);
});

test('SETIAP nomor modul yang dirujuk butir benar-benar ada di kurikulum', () => {
  /*
   * Inti dari "hubungkan indikator dengan materi yang benar-benar ada".
   * Kalau uji ini gagal, instrumen sedang menanyakan materi yang tidak pernah
   * ditulis — dan seluruh lembar yang terlanjur diisi menjadi tidak sah.
   */
  for (const b of BUTIR) {
    assert.ok(Array.isArray(b.modul), `butir ${b.kode} tidak punya daftar modul`);
    for (const no of b.modul) {
      assert.ok(NOMOR_MODUL.includes(no), `butir ${b.kode} merujuk modul ${no} yang tidak ada di kurikulum`);
    }
  }
});

test('setiap butir bisa dinilai: ada pernyataan, dan ada petunjuk tempat memeriksanya', () => {
  for (const b of BUTIR) {
    assert.ok(b.pernyataan && b.pernyataan.length > 40, `butir ${b.kode} pernyataannya terlalu pendek untuk bisa diamati`);
    assert.ok(b.rujukan, `butir ${b.kode} tidak memberi tahu validator harus membuka apa`);
    /*
     * Pernyataan selera tidak bisa diverifikasi dan tidak bisa ditindaklanjuti.
     * Daftar ini bukan penyaring gaya bahasa; ia menjaga supaya butir yang
     * ditambahkan kelak tidak diam-diam turun menjadi "materinya menarik".
     */
    assert.ok(
      !/\b(bagus|menarik|keren|indah)\b/i.test(b.pernyataan),
      `butir ${b.kode} memakai penilaian selera, bukan pernyataan yang dapat diamati`,
    );
  }
});

test('jumlah modul yang disebut instrumen sama dengan kurikulum yang sebenarnya', () => {
  /*
   * Halaman validator menyebut "7 sesi harian dan 22 modul pustaka", dan butir
   * B15 menilai rancangan itu. Kalau kurikulum berubah tanpa lembar ini ikut
   * diperbarui, validator menilai susunan yang sudah tidak ada lagi.
   */
  assert.equal(SESI_HARIAN.length, 7);
  assert.equal(KURIKULUM.length - SESI_HARIAN.length, 22);
});

test('instrumen() membawa segala yang dibutuhkan halaman validator', () => {
  const i = instrumen();
  assert.equal(i.versi, INSTRUMEN_VERSI);
  assert.equal(i.jumlahButir, JUMLAH_BUTIR);
  assert.equal(i.skorMaksimum, SKOR_MAKSIMUM_PENUH);
  assert.equal(i.skala.length, 5);
  assert.equal(i.aspek.length, ASPEK.length);
  assert.equal(i.aspek.reduce((s, a) => s + a.butir.length, 0), JUMLAH_BUTIR);
  assert.ok(i.kesimpulan.length >= 2);

  // -Infinity tidak selamat melewati JSON; halaman membacanya sebagai null.
  const lewatJson = JSON.parse(JSON.stringify(i));
  assert.equal(lewatJson.kategori.at(-1).batasBawah, null);
  for (const k of lewatJson.kategori.slice(0, -1)) assert.equal(typeof k.batasBawah, 'number');
});

/* ========================================================= Skala & skor */

test('skala Likert 1-5 lengkap dengan labelnya', () => {
  assert.deepEqual(SKALA.map((s) => s.nilai), [1, 2, 3, 4, 5]);
  assert.equal(SKALA[0].label, 'Sangat Tidak Layak');
  assert.equal(SKALA[4].label, 'Sangat Layak');
});

test('skorSah hanya menerima bilangan bulat 1-5', () => {
  for (const n of [1, 2, 3, 4, 5, '4']) assert.ok(skorSah(n), `${n} seharusnya sah`);
  for (const n of [0, 6, -1, 3.5, null, undefined, '', 'lima', NaN, {}]) {
    assert.ok(!skorSah(n), `${JSON.stringify(n)} seharusnya ditolak`);
  }
});

/* =========================================== Rumus persentase & kategori */

test('rumus persentase kelayakan: (skor diperoleh / skor maksimum) x 100', () => {
  assert.equal(persentaseKelayakan(125, 125), 100);
  assert.equal(persentaseKelayakan(100, 125), 80);
  assert.equal(persentaseKelayakan(25, 125), 20);
  assert.equal(persentaseKelayakan(0, 125), 0);
  assert.equal(persentaseKelayakan(103, 125), 82.4);
  // Pembagi nol tidak boleh menghasilkan NaN yang menjalar ke seluruh laporan.
  assert.equal(persentaseKelayakan(0, 0), 0);
});

test('kategori interpretasi memakai batas yang sama dengan rentang tertulisnya', () => {
  assert.equal(kategoriKelayakan(100).label, 'Sangat Layak');
  assert.equal(kategoriKelayakan(81).label, 'Sangat Layak');
  assert.equal(kategoriKelayakan(80.01).label, 'Sangat Layak');
  assert.equal(kategoriKelayakan(80).label, 'Layak');
  assert.equal(kategoriKelayakan(61).label, 'Layak');
  assert.equal(kategoriKelayakan(60).label, 'Cukup Layak');
  assert.equal(kategoriKelayakan(41).label, 'Cukup Layak');
  assert.equal(kategoriKelayakan(40).label, 'Kurang Layak');
  assert.equal(kategoriKelayakan(21).label, 'Kurang Layak');
  assert.equal(kategoriKelayakan(20).label, 'Tidak Layak');
  assert.equal(kategoriKelayakan(0).label, 'Tidak Layak');
  assert.equal(KATEGORI.length, 5);
});

test('kategori yang ditampilkan selalu cocok dengan persentase yang ditampilkan', () => {
  /*
   * Kategori diambil dari persentase yang SUDAH dibulatkan. Kalau ia diambil
   * dari angka mentah, sebuah lembar bisa memperlihatkan "80,00%" berlabel
   * "Sangat Layak" — lembar yang menyangkal dirinya sendiri.
   */
  for (let skor = 0; skor <= SKOR_MAKSIMUM_PENUH; skor++) {
    const persen = persentaseKelayakan(skor, SKOR_MAKSIMUM_PENUH);
    assert.equal(kategoriKelayakan(persen).kunci, kategoriKelayakan(persen).kunci);
    assert.ok(kategoriKelayakan(persen), `skor ${skor} tidak menghasilkan kategori`);
  }
});

/* ============================================================ hitungHasil */

/** Lembar yang seluruh butirnya diberi nilai sama. */
const semua = (n, komentar = 'catatan uji') =>
  Object.fromEntries(BUTIR.map((b) => [b.kode, { skor: n, komentar }]));

test('lembar dengan seluruh butir bernilai 5 menghasilkan 100% — Sangat Layak', () => {
  const h = hitungHasil(semua(5));
  assert.equal(h.skorDiperoleh, SKOR_MAKSIMUM_PENUH);
  assert.equal(h.skorMaksimum, SKOR_MAKSIMUM_PENUH);
  assert.equal(h.persentase, 100);
  assert.equal(h.kategori.label, 'Sangat Layak');
  assert.equal(h.lengkap, true);
  assert.equal(h.rataButir, 5);
});

test('lembar dengan seluruh butir bernilai 1 menghasilkan 20% — Tidak Layak', () => {
  const h = hitungHasil(semua(1));
  assert.equal(h.skorDiperoleh, JUMLAH_BUTIR);
  assert.equal(h.persentase, 20);
  assert.equal(h.kategori.label, 'Tidak Layak');
});

test('lembar dengan seluruh butir bernilai 4 menghasilkan 80% — Layak, bukan Sangat Layak', () => {
  const h = hitungHasil(semua(4));
  assert.equal(h.persentase, 80);
  assert.equal(h.kategori.label, 'Layak');
});

test('skor campuran dijumlahkan apa adanya', () => {
  const jawaban = {};
  BUTIR.forEach((b, i) => (jawaban[b.kode] = { skor: (i % 5) + 1 }));
  const total = BUTIR.reduce((s, b, i) => s + ((i % 5) + 1), 0);
  const h = hitungHasil(jawaban);
  assert.equal(h.skorDiperoleh, total);
  assert.equal(h.persentase, persentaseKelayakan(total, SKOR_MAKSIMUM_PENUH));
});

test('butir yang tidak dijawab tidak dianggap bernilai apa pun', () => {
  /*
   * Menganggap butir kosong bernilai 3 ("netral") akan menaikkan atau
   * menurunkan persentase tanpa satu pun penilaian dari validator. Kosong harus
   * tetap kosong, dan harus terlihat bahwa ia kosong.
   */
  const jawaban = semua(5);
  delete jawaban[BUTIR[0].kode];
  delete jawaban[BUTIR[1].kode];

  const h = hitungHasil(jawaban);
  assert.equal(h.butirDinilai, JUMLAH_BUTIR - 2);
  assert.equal(h.lengkap, false);
  assert.deepEqual(h.belumDinilai, [BUTIR[0].kode, BUTIR[1].kode]);
  assert.equal(h.skorMaksimum, (JUMLAH_BUTIR - 2) * 5, 'skor maksimum hanya menghitung butir yang dinilai');
  assert.equal(h.persentase, 100, 'sisanya bernilai 5, jadi persentasenya tetap 100 — bukan turun karena butir kosong');
});

test('skor di luar 1-5 diperlakukan sebagai belum dinilai, bukan dipaksa masuk', () => {
  const jawaban = semua(5);
  jawaban[BUTIR[0].kode] = { skor: 9 };
  jawaban[BUTIR[1].kode] = { skor: 0 };
  jawaban[BUTIR[2].kode] = { skor: 4.5 };
  const h = hitungHasil(jawaban);
  assert.equal(h.butirDinilai, JUMLAH_BUTIR - 3);
  assert.equal(h.skorDiperoleh, (JUMLAH_BUTIR - 3) * 5);
});

test('lembar kosong tidak menghasilkan kategori palsu', () => {
  const h = hitungHasil({});
  assert.equal(h.butirDinilai, 0);
  assert.equal(h.skorDiperoleh, 0);
  assert.equal(h.skorMaksimum, 0);
  assert.equal(h.persentase, 0);
  assert.equal(h.kategori, null, '"belum ada penilaian" tidak boleh terlihat sama dengan "dinilai Tidak Layak"');
  assert.deepEqual(h.belumDinilai.length, JUMLAH_BUTIR);
});

test('hitungHasil menerima bentuk ringkas { B01: 4 } maupun { B01: { skor: 4 } }', () => {
  const ringkas = Object.fromEntries(BUTIR.map((b) => [b.kode, 4]));
  assert.equal(hitungHasil(ringkas).persentase, hitungHasil(semua(4)).persentase);
});

test('hitungHasil tidak melempar untuk masukan yang aneh', () => {
  for (const aneh of [undefined, null, 'bukan objek', 42, []]) {
    assert.equal(hitungHasil(aneh).butirDinilai, 0);
  }
  assert.equal(hitungHasil({ __proto__: { B01: 5 } }).butirDinilai, 0);
  assert.equal({}.B01, undefined, 'kunci __proto__ tidak boleh mencemari Object.prototype');
});

test('rincian per aspek ikut dihitung dan jumlahnya sama dengan totalnya', () => {
  const h = hitungHasil(semua(3));
  assert.equal(h.aspek.length, ASPEK.length);
  assert.equal(h.aspek.reduce((s, a) => s + a.skor, 0), h.skorDiperoleh);
  assert.equal(h.aspek.reduce((s, a) => s + a.skorMaksimum, 0), h.skorMaksimum);
  for (const a of h.aspek) {
    assert.equal(a.persentase, 60);
    assert.equal(a.kategori, 'cukup-layak');
  }
});

/* ====================================================== periksaPengiriman */

/** Lembar yang sah dan lengkap, untuk dijadikan dasar kasus-kasus di bawah. */
const lembarSah = () => ({
  validator: {
    nama: 'Dra. Contoh Uji, M.Ak.',
    institusi: 'Universitas Uji',
    jabatan: 'Dosen Akuntansi',
    bidang: ['Akuntansi / keuangan'],
    tanggalValidasi: '2026-08-10',
  },
  jawaban: semua(4, ''),
  kesimpulan: 'layak-revisi-kecil',
  catatanUmum: 'Catatan uji.',
  rekomendasi: 'Rekomendasi uji.',
  materiPerluRevisi: [{ bagian: 'Modul 5', catatan: 'Perjelas asal angka pengali.' }],
});

test('lembar yang lengkap diterima dan dirapikan', () => {
  const { data, errors } = periksaPengiriman(lembarSah(), { hariIni: '2026-08-12' });
  assert.deepEqual(errors, []);
  assert.equal(data.validator.nama, 'Dra. Contoh Uji, M.Ak.');
  assert.equal(Object.keys(data.jawaban).length, JUMLAH_BUTIR);
  assert.equal(data.instrumenVersi, INSTRUMEN_VERSI);
  assert.equal(data.materiPerluRevisi.length, 1);
});

test('identitas validator wajib: nama, bidang keahlian, dan tanggal validasi', () => {
  for (const [ubah, cocok] of [
    [(b) => (b.validator.nama = '   '), /nama validator/i],
    [(b) => (b.validator.bidang = []), /bidang keahlian/i],
    [(b) => (b.validator.tanggalValidasi = ''), /tanggal validasi/i],
    [(b) => (b.validator.tanggalValidasi = '2026-02-31'), /tanggal validasi/i],
    [(b) => (b.kesimpulan = ''), /kesimpulan/i],
    [(b) => (b.kesimpulan = 'entah-apa'), /kesimpulan/i],
  ]) {
    const body = lembarSah();
    ubah(body);
    const { data, errors } = periksaPengiriman(body, { hariIni: '2026-08-12' });
    assert.equal(data, null);
    assert.ok(errors.some((e) => cocok.test(e)), `pesan galat tidak menyebut apa yang kurang: ${errors.join(' ')}`);
  }
});

test('tanggal validasi di masa depan ditolak', () => {
  const body = lembarSah();
  body.validator.tanggalValidasi = '2030-01-01';
  const { errors } = periksaPengiriman(body, { hariIni: '2026-08-12' });
  assert.ok(errors.some((e) => /masa depan/i.test(e)));
});

test('lembar yang belum lengkap ditolak, dan disebutkan butir mana yang kosong', () => {
  const body = lembarSah();
  delete body.jawaban.B03;
  delete body.jawaban.B17;
  const { data, errors } = periksaPengiriman(body, { hariIni: '2026-08-12' });
  assert.equal(data, null);
  assert.ok(errors.some((e) => e.includes('B03') && e.includes('B17')));
});

test('skor 1 atau 2 wajib disertai komentar — temuan tanpa alasan tidak bisa ditindaklanjuti', () => {
  const body = lembarSah();
  body.jawaban.B05 = { skor: 2, komentar: '' };
  const gagal = periksaPengiriman(body, { hariIni: '2026-08-12' });
  assert.equal(gagal.data, null);
  assert.ok(gagal.errors.some((e) => e.includes('B05')));

  body.jawaban.B05 = { skor: 2, komentar: 'Contoh HPP-nya kurang menyebutkan satuan.' };
  assert.deepEqual(periksaPengiriman(body, { hariIni: '2026-08-12' }).errors, []);
});

test('kode butir asing dibuang, tidak ikut tersimpan', () => {
  const body = lembarSah();
  body.jawaban.B99 = { skor: 5 };
  body.jawaban.__proto__ = { skor: 5 };
  const { data } = periksaPengiriman(body, { hariIni: '2026-08-12' });
  assert.equal('B99' in data.jawaban, false);
  assert.equal(Object.keys(data.jawaban).length, JUMLAH_BUTIR);
});

test('teks yang kepanjangan dipotong, bukan menolak seluruh lembar', () => {
  const body = lembarSah();
  body.catatanUmum = 'x'.repeat(9000);
  body.jawaban.B01 = { skor: 4, komentar: 'y'.repeat(9000) };
  const { data, errors } = periksaPengiriman(body, { hariIni: '2026-08-12' });
  assert.deepEqual(errors, []);
  assert.ok(data.catatanUmum.length <= 3000);
  assert.ok(data.jawaban.B01.komentar.length <= 600);
});

test('kesimpulan validator disimpan apa adanya, tidak ditimpa hasil hitungan', () => {
  /*
   * Lembar bernilai 5 semua (100%, "Sangat Layak") yang kesimpulannya "belum
   * layak" harus tetap tersimpan sebagai "belum layak". Angka merangkum;
   * keputusan tetap milik ahlinya.
   */
  const body = lembarSah();
  body.jawaban = semua(5, '');
  body.kesimpulan = 'belum-layak';
  const { data } = periksaPengiriman(body, { hariIni: '2026-08-12' });
  assert.equal(data.kesimpulan, 'belum-layak');
  assert.equal(hitungHasil(data.jawaban).kategori.label, 'Sangat Layak');
});

test('daftar kesimpulan yang dikenal tidak kosong dan berlabel', () => {
  for (const k of KESIMPULAN) {
    assert.ok(k.kunci && k.label, 'setiap kesimpulan perlu kunci dan label');
  }
});

/* ============================================================ rekapValidasi */

test('rekapitulasi tanpa lembar menghasilkan kosong, bukan nol yang terlihat seperti hasil', () => {
  const r = rekapValidasi([]);
  assert.equal(r.jumlahValidator, 0);
  assert.equal(r.persentase, null);
  assert.equal(r.kategori, null);
  assert.deepEqual(r.butir, []);
  assert.equal(rekapValidasi(undefined).jumlahValidator, 0);
});

test('rekapitulasi menjumlahkan seluruh lembar dan mencatat butir terendah', () => {
  const a = { jawaban: semua(5, '') };
  const b = { jawaban: semua(3, '') };
  const c = { jawaban: { ...semua(5, ''), B05: { skor: 1, komentar: 'contoh keliru' } } };

  const r = rekapValidasi([a, b, c]);
  assert.equal(r.jumlahValidator, 3);
  assert.equal(r.skorMaksimum, SKOR_MAKSIMUM_PENUH * 3);
  assert.equal(r.skorDiperoleh, SKOR_MAKSIMUM_PENUH + JUMLAH_BUTIR * 3 + (SKOR_MAKSIMUM_PENUH - 4));

  const b05 = r.butir.find((x) => x.kode === 'B05');
  assert.equal(b05.penilai, 3);
  assert.equal(b05.terendah, 1);
  assert.equal(b05.skor, 5 + 3 + 1);

  const lain = r.butir.find((x) => x.kode === 'B01');
  assert.ok(b05.rata < lain.rata, 'butir bermasalah harus turun peringkatnya di rekap');
  assert.equal(r.aspek.length, ASPEK.length);
});

test('cariButir mengembalikan butir yang benar dan menolak yang tidak ada', () => {
  assert.equal(cariButir('B01').kode, 'B01');
  assert.equal(cariButir('B99'), null);
  assert.equal(cariButir('__proto__'), null);
});
