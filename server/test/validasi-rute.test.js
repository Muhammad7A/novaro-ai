/**
 * Uji lapisan HTTP dan penyimpanan lembar validasi materi.
 *
 * Yang dijaga di sini ada DI SAMBUNGAN antar bagian, tempat uji fungsi tidak
 * pernah sampai:
 *
 *   - lembar validasi tidak boleh bisa dititipkan tanpa kode;
 *   - kode peserta tidak boleh membuka lembar validasi, dan sebaliknya;
 *   - angka yang tersimpan harus hasil hitungan SERVER, bukan angka yang
 *     dikirim peramban — kalau tidak, satu permintaan yang disusun tangan bisa
 *     menyisipkan "100% Sangat Layak" ke data penelitian;
 *   - data peserta tidak boleh tersentuh sama sekali oleh jalur ini.
 *
 *   npm test
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'nova-validasi-uji-'));
process.env.NOVA_DATA_DIR = DATA_DIR;
process.env.PORT = '0';
process.env.VALIDASI_KODE = 'kode-validasi-uji-9f3a';
process.on('exit', () => rmSync(DATA_DIR, { recursive: true, force: true }));

const { store } = await import('../lib/store.js');
const { validasiStore } = await import('../lib/validasi-store.js');
const { BUTIR, JUMLAH_BUTIR, SKOR_MAKSIMUM_PENUH } = await import('../lib/validasi.js');
const app = (await import('../server.js')).default;

const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const BASE = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const KODE = process.env.VALIDASI_KODE;

const minta = (jalur, { kode, ...opts } = {}) =>
  fetch(BASE + jalur, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(kode ? { Authorization: `Bearer ${kode}` } : {}),
      ...(opts.headers ?? {}),
    },
  });

const jawabanSemua = (n, komentar = '') =>
  Object.fromEntries(BUTIR.map((b) => [b.kode, { skor: n, komentar }]));

const lembar = (ubah = {}) => ({
  validator: {
    nama: 'Dr. Uji Validator',
    institusi: 'Universitas Uji',
    jabatan: 'Dosen',
    bidang: ['Akuntansi / keuangan', 'Pendidikan & pembelajaran'],
    tanggalValidasi: new Date().toISOString().slice(0, 10),
  },
  jawaban: jawabanSemua(4),
  kesimpulan: 'layak-revisi-kecil',
  catatanUmum: 'Materi sudah runtut.',
  rekomendasi: 'Perjelas satuan pada contoh HPP.',
  materiPerluRevisi: [{ bagian: 'Modul 5', catatan: 'Tambahkan satuan pada tiap baris.' }],
  ...ubah,
});

/* ============================================================== Halaman */

test('halaman /validasi tersaji sebagai HTML tanpa perlu kode', () => {
  // Halamannya sendiri hanya formulir kosong; isinya baru dimuat setelah kode
  // diterima. Kalau halamannya ikut dijaga kode, validator tidak punya tempat
  // untuk mengetikkan kodenya.
  return minta('/validasi').then(async (res) => {
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /html/);
    const isi = await res.text();
    assert.match(isi, /Validasi Materi/);
  });
});

/* ========================================================== Penjagaan kode */

test('instrumen dan pengiriman ditolak tanpa kode validasi', async () => {
  assert.equal((await minta('/api/validasi/instrumen')).status, 401);
  const kirim = await minta('/api/validasi/kirim', { method: 'POST', body: JSON.stringify(lembar()) });
  assert.equal(kirim.status, 401);
});

test('kode peserta tidak membuka lembar validasi', async () => {
  const { accessCode } = await store.createUser({ name: 'Bu Sari', business: 'Warung Bu Sari' });
  const res = await minta('/api/validasi/instrumen', { kode: accessCode });
  assert.equal(res.status, 401, 'kode peserta tidak boleh dipakai sebagai kode validator');
});

test('kode validasi tidak membuka data peserta', async () => {
  for (const jalur of ['/api/me', '/api/cashbook', '/api/report']) {
    assert.equal((await minta(jalur, { kode: KODE })).status, 401, `${jalur} tidak boleh terbuka oleh kode validasi`);
  }
});

test('instrumen terbuka dengan kode yang benar, lengkap dengan butir dan kriterianya', async () => {
  const res = await minta('/api/validasi/instrumen', { kode: KODE });
  assert.equal(res.status, 200);
  const { instrumen } = await res.json();
  assert.equal(instrumen.jumlahButir, JUMLAH_BUTIR);
  assert.equal(instrumen.skorMaksimum, SKOR_MAKSIMUM_PENUH);
  assert.equal(instrumen.aspek.length, 12);
  assert.equal(instrumen.kategori.length, 5);
  assert.ok(instrumen.aspek[0].butir[0].pernyataan);
  assert.ok(instrumen.aspek[0].butir[0].rujukan);
});

/* ============================================================ Pengiriman */

test('lembar lengkap tersimpan, dan hasilnya dihitung server', async () => {
  const res = await minta('/api/validasi/kirim', { kode: KODE, method: 'POST', body: JSON.stringify(lembar()) });
  assert.equal(res.status, 201);
  const body = await res.json();

  assert.match(body.id, /^val_[0-9a-f]{12}$/);
  assert.equal(body.hasil.skorDiperoleh, JUMLAH_BUTIR * 4);
  assert.equal(body.hasil.skorMaksimum, SKOR_MAKSIMUM_PENUH);
  assert.equal(body.hasil.persentase, 80);
  assert.equal(body.hasil.kategori.label, 'Layak');
  assert.equal(body.hasil.lengkap, true);

  const tersimpan = await validasiStore.cari(body.id);
  assert.equal(tersimpan.validator.nama, 'Dr. Uji Validator');
  assert.equal(tersimpan.hasil.persentase, 80);
  assert.equal(tersimpan.kesimpulan, 'layak-revisi-kecil');
  assert.equal(tersimpan.materiPerluRevisi.length, 1);
  assert.equal(Object.keys(tersimpan.jawaban).length, JUMLAH_BUTIR);
});

test('angka yang dikirim peramban tidak dipercaya — server menghitung ulang', async () => {
  /*
   * Kalau `hasil` dari badan permintaan ikut tersimpan, satu permintaan yang
   * disusun tangan bisa menitipkan "125/125, 100%, Sangat Layak" tanpa satu pun
   * butir dinilai tinggi — dan hasil validasi penelitian ini menjadi karangan
   * yang tidak bisa dibedakan dari yang sungguhan.
   */
  const curang = lembar({
    jawaban: jawabanSemua(3),
    hasil: { skorDiperoleh: 125, skorMaksimum: 125, persentase: 100, kategori: { label: 'Sangat Layak' } },
    skorDiperoleh: 125,
    persentase: 100,
  });
  const res = await minta('/api/validasi/kirim', { kode: KODE, method: 'POST', body: JSON.stringify(curang) });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.hasil.persentase, 60, 'yang berlaku adalah jawaban butirnya, bukan angka kiriman');
  assert.equal(body.hasil.kategori.label, 'Cukup Layak');

  const tersimpan = await validasiStore.cari(body.id);
  assert.equal(tersimpan.hasil.persentase, 60);
  assert.equal(tersimpan.hasil.skorDiperoleh, JUMLAH_BUTIR * 3);
});

test('lembar yang belum lengkap ditolak beserta daftar butir yang kosong', async () => {
  const kurang = lembar();
  delete kurang.jawaban.B02;
  const res = await minta('/api/validasi/kirim', { kode: KODE, method: 'POST', body: JSON.stringify(kurang) });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /B02/);
  assert.ok(Array.isArray(body.errors));
});

test('identitas validator yang kosong ditolak', async () => {
  const tanpaNama = lembar();
  tanpaNama.validator.nama = '';
  const res = await minta('/api/validasi/kirim', { kode: KODE, method: 'POST', body: JSON.stringify(tanpaNama) });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /nama validator/i);
});

test('jawaban dan komentar setiap butir benar-benar tersimpan', async () => {
  const isi = lembar();
  isi.jawaban.B05 = { skor: 2, komentar: 'Contoh HPP perlu menyebutkan satuan tiap baris.' };
  isi.jawaban.B22 = { skor: 3, komentar: 'Kategori "beli alat" belum ada di aplikasi.' };

  const res = await minta('/api/validasi/kirim', { kode: KODE, method: 'POST', body: JSON.stringify(isi) });
  assert.equal(res.status, 201);
  const { id } = await res.json();

  const tersimpan = await validasiStore.cari(id);
  assert.equal(tersimpan.jawaban.B05.skor, 2);
  assert.match(tersimpan.jawaban.B05.komentar, /satuan/);
  assert.equal(tersimpan.jawaban.B22.komentar, 'Kategori "beli alat" belum ada di aplikasi.');
});

/* =========================================================== Penyimpanan */

test('setiap lembar bertambah, tidak menimpa lembar sebelumnya', async () => {
  const sebelum = (await validasiStore.daftar()).length;
  await minta('/api/validasi/kirim', {
    kode: KODE, method: 'POST', body: JSON.stringify(lembar({ validator: { ...lembar().validator, nama: 'Validator Kedua' } })),
  });
  await minta('/api/validasi/kirim', {
    kode: KODE, method: 'POST', body: JSON.stringify(lembar({ validator: { ...lembar().validator, nama: 'Validator Ketiga' } })),
  });
  const daftar = await validasiStore.daftar();
  assert.equal(daftar.length, sebelum + 2);
  assert.equal(new Set(daftar.map((d) => d.id)).size, daftar.length, 'nomor lembar harus unik');
});

test('hasil validasi ditulis ke berkasnya sendiri, bukan ke data peserta', () => {
  /*
   * Berkas terpisah bukan sekadar kerapian: penulisan yang keliru di jalur baru
   * ini tidak boleh bisa merusak users.json, yang berisi pembukuan peserta dan
   * tidak bisa dikumpulkan dua kali.
   */
  assert.equal(validasiStore.FILE_PATH, path.join(DATA_DIR, 'validasi.json'));
  const isiValidasi = JSON.parse(readFileSync(validasiStore.FILE_PATH, 'utf8'));
  assert.ok(Array.isArray(isiValidasi.hasil) && isiValidasi.hasil.length >= 1);
  assert.equal('users' in isiValidasi, false);

  const isiPeserta = JSON.parse(readFileSync(store.DB_PATH, 'utf8'));
  assert.ok(Array.isArray(isiPeserta.users));
  assert.equal('hasil' in isiPeserta, false, 'lembar validasi tidak boleh menyelip ke berkas peserta');
  for (const u of isiPeserta.users) {
    assert.equal('validasi' in u, false, 'data peserta tidak boleh tersentuh jalur validasi');
  }
});

test('lembar bisa dihapus satu per satu bila salah kirim', async () => {
  const daftar = await validasiStore.daftar();
  const target = daftar.at(-1).id;
  assert.equal(await validasiStore.hapus(target), true);
  assert.equal(await validasiStore.cari(target), null);
  assert.equal(await validasiStore.hapus('val_tidakada'), false);
});

/* ================================================= Bila kode belum diatur */

test('tanpa VALIDASI_KODE, rutenya menolak dengan penjelasan — bukan diam-diam terbuka', async () => {
  const simpan = process.env.VALIDASI_KODE;
  delete process.env.VALIDASI_KODE;
  try {
    const res = await minta('/api/validasi/instrumen', { kode: 'apa saja' });
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.belumAktif, true);
    assert.match(body.error, /VALIDASI_KODE/);

    const kirim = await minta('/api/validasi/kirim', { kode: 'apa saja', method: 'POST', body: JSON.stringify(lembar()) });
    assert.equal(kirim.status, 503, 'pengiriman pun harus tertutup selama kodenya belum diatur');
  } finally {
    process.env.VALIDASI_KODE = simpan;
  }
});
