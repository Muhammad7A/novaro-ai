/**
 * Uji instrumen validasi Ahli IT & Infrastruktur Sistem.
 *
 * Menguji:
 *   1. Jumlah 25 butir dalam 6 aspek arsitektur, keamanan, DB, performa, AI, audit.
 *   2. Perhitungan skor kelayakan, batas kategori, dan sanitasi pengiriman.
 *   3. Kewajiban komentar pada skor <= 2.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ASPEK_IT,
  BIDANG_IT,
  BUTIR_IT,
  INSTRUMEN_IT_VERSI,
  JUMLAH_BUTIR_IT,
  KATEGORI_IT,
  KESIMPULAN_IT,
  SKALA_IT,
  SKOR_MAKSIMUM_PENUH_IT,
  butirAspekIT,
  cariAspekIT,
  cariButirIT,
  hitungHasilIT,
  instrumenIT,
  kategoriKelayakanIT,
  periksaPengirimanIT,
  persentaseKelayakanIT,
  rekapValidasiIT,
  skorSah,
} from '../lib/validasi-it.js';

test('jumlah butir IT tepat 25 butir dalam 6 aspek', () => {
  assert.equal(JUMLAH_BUTIR_IT, 25);
  assert.equal(SKOR_MAKSIMUM_PENUH_IT, 125);
  assert.equal(ASPEK_IT.length, 6);
});

test('kode butir unik IT01 - IT25', () => {
  const kode = BUTIR_IT.map((b) => b.kode);
  assert.equal(new Set(kode).size, 25);
  for (let i = 1; i <= 25; i++) {
    const k = `IT${String(i).padStart(2, '0')}`;
    assert.ok(kode.includes(k), `kode ${k} harus ada`);
  }
});

test('setiap aspek IT memiliki butir yang terdefinisi', () => {
  for (const a of ASPEK_IT) {
    const butir = butirAspekIT(a.kunci);
    assert.ok(butir.length >= 4, `aspek ${a.kunci} harus memiliki minimal 4 butir`);
  }
});

test('setiap butir IT memiliki pernyataan jelas dan rujukan sistem', () => {
  for (const b of BUTIR_IT) {
    assert.ok(b.pernyataan && b.pernyataan.length > 30, `pernyataan ${b.kode} terlalu pendek`);
    assert.ok(b.rujukan && b.rujukan.length > 5, `rujukan ${b.kode} tidak jelas`);
    assert.ok(cariAspekIT(b.aspek), `aspek ${b.aspek} pada ${b.kode} tidak ditemukan`);
  }
});

test('instrumenIT() mengembalikan struktur lengkap untuk frontend', () => {
  const inst = instrumenIT();
  assert.equal(inst.versi, INSTRUMEN_IT_VERSI);
  assert.equal(inst.jenis, 'it');
  assert.equal(inst.jumlahButir, 25);
  assert.equal(inst.skorMaksimum, 125);
  assert.equal(inst.aspek.length, 6);
  assert.ok(inst.bidang.length >= 5);
});

test('skorSah hanya menerima bilangan bulat 1-5', () => {
  assert.equal(skorSah(1), true);
  assert.equal(skorSah(5), true);
  assert.equal(skorSah(3), true);
  assert.equal(skorSah(0), false);
  assert.equal(skorSah(6), false);
  assert.equal(skorSah('4'), true);
  assert.equal(skorSah('abc'), false);
  assert.equal(skorSah(null), false);
});

test('perhitungan kelayakan IT persentase dan kategori', () => {
  assert.equal(persentaseKelayakanIT(125, 125), 100);
  assert.equal(persentaseKelayakanIT(25, 125), 20);
  assert.equal(persentaseKelayakanIT(100, 125), 80);

  assert.equal(kategoriKelayakanIT(100).kunci, 'sangat-layak');
  assert.equal(kategoriKelayakanIT(85).kunci, 'sangat-layak');
  assert.equal(kategoriKelayakanIT(80).kunci, 'layak');
  assert.equal(kategoriKelayakanIT(65).kunci, 'layak');
  assert.equal(kategoriKelayakanIT(60).kunci, 'cukup-layak');
  assert.equal(kategoriKelayakanIT(20).kunci, 'tidak-layak');
});

test('hitungHasilIT menghitung skor total dan per aspek', () => {
  const jawaban = {};
  for (const b of BUTIR_IT) {
    jawaban[b.kode] = { skor: 5, komentar: '' };
  }
  const hasil = hitungHasilIT(jawaban);
  assert.equal(hasil.lengkap, true);
  assert.equal(hasil.skorDiperoleh, 125);
  assert.equal(hasil.persentase, 100);
  assert.equal(hasil.kategori.kunci, 'sangat-layak');
  assert.equal(hasil.aspek.length, 6);
  assert.equal(hasil.aspek[0].persentase, 100);
});

test('periksaPengirimanIT memvalidasi kelengkapan data validator dan butir', () => {
  const hariIni = '2026-08-23';
  const jawaban = {};
  for (const b of BUTIR_IT) {
    jawaban[b.kode] = { skor: 4, komentar: '' };
  }

  const valid = periksaPengirimanIT(
    {
      validator: {
        nama: 'Dr. Eng. Ahli Cloud & Keamanan',
        institusi: 'Fakultas Ilmu Komputer',
        jabatan: 'Lektor Kepala',
        bidang: ['Infrastruktur Cloud & DevOps', 'Keamanan Siber & Privasi Data (Cybersecurity)'],
        tanggalValidasi: '2026-08-23',
      },
      jawaban,
      kesimpulan: 'layak-tanpa-revisi',
      catatanUmum: 'Infrastruktur Cloud Run & PostgreSQL berjalan sangat baik dan aman.',
      rekomendasi: 'Pertahankan sistem alert error rate.',
      materiPerluRevisi: [],
    },
    { hariIni },
  );

  assert.equal(valid.errors.length, 0);
  assert.ok(valid.data);
  assert.equal(valid.data.validator.nama, 'Dr. Eng. Ahli Cloud & Keamanan');
});

test('periksaPengirimanIT mewajibkan komentar pada skor 1 atau 2', () => {
  const jawaban = {};
  for (const b of BUTIR_IT) {
    jawaban[b.kode] = { skor: 4, komentar: '' };
  }
  jawaban['IT01'] = { skor: 2, komentar: '' }; // Tanpa komentar

  const invalid = periksaPengirimanIT({
    validator: {
      nama: 'Ahli IT',
      bidang: ['Infrastruktur Cloud & DevOps'],
      tanggalValidasi: '2026-08-23',
    },
    jawaban,
    kesimpulan: 'layak-revisi-kecil',
  });

  assert.ok(invalid.errors.length > 0);
  assert.match(invalid.errors.join(' '), /IT01/);
});

test('rekapValidasiIT mengagregasi beberapa penilaian validator IT', () => {
  const form1 = {
    jenis: 'it',
    jawaban: Object.fromEntries(BUTIR_IT.map((b) => [b.kode, { skor: 4 }])),
  };
  const form2 = {
    jenis: 'it',
    jawaban: Object.fromEntries(BUTIR_IT.map((b) => [b.kode, { skor: 5 }])),
  };

  const rekap = rekapValidasiIT([form1, form2]);
  assert.equal(rekap.jumlahValidator, 2);
  assert.equal(rekap.lembarLengkap, 2);
  assert.equal(rekap.skorDiperoleh, 100 + 125);
  assert.equal(rekap.persentase, 90);
  assert.equal(rekap.kategori.kunci, 'sangat-layak');
  assert.equal(rekap.butir.length, 25);
  assert.equal(rekap.aspek.length, 6);
});
