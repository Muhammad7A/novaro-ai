/**
 * Uji susunan film Putar Ulang (lib/putar-ulang.js).
 *
 * Berkas ini dipakai dua dunia — diimpor uji node dan dimuat peramban
 * sebagai window.NOVA_PUTAR (pola simulasi-kur.js) — jadi yang diuji di
 * sini adalah satu-satunya versi hitungannya:
 *   - pengelompokan transaksi per hari dan urutannya,
 *   - kumulatif saldo vs laba (prive/cicilan hanya menyentuh saldo),
 *   - titik skor bulanan menempel di hari terakhir bulannya,
 *   - dan hari terbaik hanya dari hari yang benar-benar ada penjualannya.
 *
 *   npm test
 */
import assert from 'node:assert/strict';
import test from 'node:test';

const { susunFilmKas } = await import('../lib/putar-ulang.js');

const masuk = (tanggal, jumlah, keterangan = 'Penjualan', createdAt = `${tanggal}T10:00:00.000Z`) =>
  ({ tanggal, jenis: 'masuk', kategori: 'penjualan', jumlah, keterangan, createdAt });
const keluar = (tanggal, kategori, jumlah, createdAt = `${tanggal}T11:00:00.000Z`) =>
  ({ tanggal, jenis: 'keluar', kategori, jumlah, keterangan: kategori, createdAt });

test('transaksi acak diurutkan per tanggal lalu dikelompokkan per hari', () => {
  const film = susunFilmKas([
    masuk('2026-08-03', 200_000),
    masuk('2026-08-01', 100_000, 'A', '2026-08-01T09:00:00.000Z'),
    masuk('2026-08-01', 150_000, 'B', '2026-08-01T15:00:00.000Z'),
  ]);

  assert.deepEqual(film.hari.map((h) => h.tanggal), ['2026-08-01', '2026-08-03']);
  assert.equal(film.hari[0].rows.length, 2);
  assert.equal(film.hari[0].rows[0].keterangan, 'A', 'sehari pun urutan mengikuti waktu catat');
  assert.equal(film.hari[0].rows[1].keterangan, 'B');
});

test('saldo mengurangi semua keluaran; laba hanya mengurangi biaya usaha', () => {
  const film = susunFilmKas([
    masuk('2026-08-01', 1_000_000),
    keluar('2026-08-01', 'belanja-bahan', 300_000),
    keluar('2026-08-01', 'prive', 200_000),
    keluar('2026-08-02', 'cicilan', 100_000),
  ]);

  // Saldo: 1.000.000 − 300.000 − 200.000 − 100.000 = 400.000.
  // Laba: 1.000.000 − 300.000 = 700.000 — prive dan cicilan bukan biaya.
  assert.equal(film.hari.at(-1).saldo, 400_000);
  assert.equal(film.totalLaba, 700_000);
  assert.equal(film.hari.at(-1).omzet, 1_000_000);
});

test('titik skor menempel di hari terakhir bulannya, bukan tanggal 1', () => {
  const film = susunFilmKas(
    [
      masuk('2026-07-31', 100_000),
      masuk('2026-08-01', 100_000),
      masuk('2026-08-29', 100_000),
    ],
    [
      { bulan: '2026-07', skor: 61 },
      { bulan: '2026-08', skor: 74 },
    ],
  );

  // Indeks hari: 0 = 31 Jul, 1 = 1 Agu, 2 = 29 Agu.
  assert.deepEqual(film.skorTitik, [
    { idx: 0, skor: 61, bulan: '2026-07' },
    { idx: 2, skor: 74, bulan: '2026-08' },
  ]);
});

test('bulan tanpa catatan tidak menghasilkan titik skor; titik terurut walaupan masuk acak', () => {
  const film = susunFilmKas(
    [masuk('2026-08-10', 50_000)],
    [
      { bulan: '2026-08', skor: 70 },
      { bulan: '2026-06', skor: 55 }, // Juni kosong — tidak dikarang
    ],
  );

  assert.deepEqual(film.skorTitik, [{ idx: 0, skor: 70, bulan: '2026-08' }]);
});

test('hari terbaik hanya dari hari yang benar-benar ada penjualannya', () => {
  const film = susunFilmKas([
    keluar('2026-08-01', 'operasional', 50_000),
    masuk('2026-08-02', 300_000),
    masuk('2026-08-03', 750_000),
  ]);

  assert.equal(film.terbaik.m, 750_000);
  assert.equal(film.terbaik.h.tanggal, '2026-08-03');
});

test('buku kas kosong: film kosong tanpa kejutan, bukan galat', () => {
  const film = susunFilmKas([], [{ bulan: '2026-08', skor: 70 }]);

  assert.deepEqual(film.hari, []);
  assert.deepEqual(film.skorTitik, []);
  assert.equal(film.totalLaba, 0);
  assert.equal(film.terbaik, null);
});
