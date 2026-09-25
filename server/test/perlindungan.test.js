/**
 * Uji regresi untuk perlindungan peserta.
 *
 * Dua hal yang dijaga di sini bukan fitur, melainkan syarat menjalankan pilot:
 * persetujuan yang benar-benar mengikat, dan cadangan yang benar-benar bisa
 * dipulihkan. Keduanya baru ketahuan gagal justru pada saat paling tidak boleh
 * gagal — waktu ada peserta yang menarik diri, dan waktu ada data yang hilang.
 *
 *   npm test
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

/*
 * Uji TIDAK BOLEH menyentuh data peserta. Direktori data dialihkan ke folder
 * sementara SEBELUM store.js dimuat — `node --test` menjalankan tiap berkas uji
 * di proses terpisah, jadi tiap berkas dapat direktorinya sendiri.
 */
const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'nova-uji-'));
process.env.NOVA_DATA_DIR = DATA_DIR;
process.on('exit', () => rmSync(DATA_DIR, { recursive: true, force: true }));

const DB_PATH = path.join(DATA_DIR, 'users.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backup');

/** Store dengan basis data kosong, terpisah per uji. */
async function storeSegar() {
  await rm(DATA_DIR, { recursive: true, force: true });
  await mkdir(DATA_DIR, { recursive: true });
  return (await import(`../lib/store.js?uji=${Math.random()}`)).store;
}

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';

import { CONSENT_TEXT, CONSENT_VERSION, hasConsented } from '../lib/consent.js';
/* ------------------------------------------------------------ Persetujuan */

test('teks persetujuan menyebut hal-hal yang wajib diberitahukan', () => {
  const semua = JSON.stringify(CONSENT_TEXT).toLowerCase();
  // Bukan uji gaya bahasa — ini daftar hal yang tidak boleh hilang dari teksnya.
  assert.match(semua, /cash book|records/, 'harus menyebut data apa yang disimpan');
  assert.match(semua, /claude|anthropic/, 'harus menyebut data dikirim ke layanan AI mana');
  assert.match(semua, /gemini|google/, 'dan jalur Gemini (Vertex AI, Google Cloud) ikut disebut — versi 2 dulu menyebut SATU pemroses padahal ada tiga jalur');
  assert.match(semua, /terms of service/, 'kerangka komersial: layanan, bukan uji coba (v4+)');
  assert.match(semua, /delete/, 'harus menyebut hak menghapus data');
  assert.match(semua, /improve the service/, 'pemakaian data kini untuk layanan pengguna, bukan penelitian (v4+)');
  assert.doesNotMatch(semua, /research|pilot study|participant/, 'sisa framing riset tidak boleh kembali ke teks persetujuan');
  assert.ok(CONSENT_TEXT.poin.length >= 4, 'teks terlalu ringkas untuk disebut informed consent');
});

test('teks persetujuan tidak boleh mengklaim lebih dari yang benar', () => {
  /*
   * Versi 1 berbunyi "Namamu dan kode aksesmu TIDAK ikut dikirim", sementara
   * yang benar-benar terkirim ke Anthropic mencakup nama usaha, lokasi, teks
   * bebas "tantangan", dan keterangan transaksi. Untuk warung mikro, nama usaha
   * praktis adalah nama pemiliknya; bersama lokasi ia menunjuk satu orang.
   */
  const semua = JSON.stringify(CONSENT_TEXT).toLowerCase();
  assert.match(semua, /notes/, 'keterangan transaksi (notes) ikut terkirim — harus disebut');
  assert.match(semua, /challenge/, 'teks bebas "challenge" ikut terkirim — harus disebut');
  assert.match(semua, /business name/, 'harus menyatakan nama usaha TIDAK dikirim');
  assert.match(semua, /location/, 'harus menyatakan lokasi TIDAK dikirim');
});

test('data pengenal peserta tidak pernah sampai ke prompt AI', async () => {
  /*
   * Uji inilah yang membuat kalimat persetujuan di atas benar. Ia memeriksa teks
   * yang BENAR-BENAR dikirim, bukan niatnya.
   *
   * Bukti bahwa keduanya memang pengenal: `scripts/export.js --anonymize`
   * menghapus persis medan-medan ini sebelum data boleh dibagikan.
   */
  const { chatSystem, recommendationRequest } = await import('../lib/prompts.js');
  const { computeMetrics } = await import('../lib/metrics.js');

  const profile = {
    namaUsaha: 'Warung Bu Sari Banyumanik',
    lokasi: 'Jl. Prof Soedarto, Banyumanik, Semarang',
    jenisUsaha: 'kuliner',
    produkUtama: 'Nasi rames, ayam geprek',
    lamaUsahaBulan: 36,
    pencatatan: 'buku',
    tujuan: 'ajukan-kur',
    tantangan: 'Sulit memisahkan uang usaha dan pribadi',
    omzetBulanan: 27000000,
  };
  const metrics = computeMetrics(profile);
  const terkirim =
    chatSystem(profile, metrics, '').map((b) => b.text).join('\n') +
    '\n' +
    recommendationRequest(profile, metrics);

  assert.ok(!terkirim.includes('Warung Bu Sari'), 'nama usaha bocor ke prompt AI');
  assert.ok(!/Banyumanik|Soedarto/.test(terkirim), 'lokasi bocor ke prompt AI');

  // Yang memang mengubah mutu nasihat tetap ikut — pemangkasannya ditujukan
  // pada pengenal, bukan pada isi.
  assert.match(terkirim, /Nasi rames/, 'produk utama seharusnya tetap dikirim');
  assert.match(terkirim, /memisahkan uang usaha/, 'tantangan seharusnya tetap dikirim');
});

test('persetujuan terikat pada versi teksnya', async () => {
  const store = await storeSegar();
  const { user } = await store.createUser({ name: 'Bu Sari' });

  assert.equal(hasConsented(user), false, 'pengguna baru belum menyetujui apa pun');

  await store.saveConsent(user.id, CONSENT_VERSION);
  const setelah = await store.findByAccessCode(null); // sengaja null → tidak ketemu
  assert.equal(setelah, null);

  const db = await store.dump();
  const tersimpan = db.users.find((u) => u.id === user.id);
  assert.equal(hasConsented(tersimpan), true);
  assert.equal(tersimpan.consent.versi, CONSENT_VERSION);
  assert.match(tersimpan.consent.agreedAt, /^\d{4}-\d{2}-\d{2}T/);

  /*
   * Ini inti dari kenapa versi disimpan: kalau teksnya berubah, orang yang
   * menyetujui teks lama TIDAK otomatis dianggap menyetujui yang baru.
   */
  assert.equal(hasConsented({ consent: { versi: CONSENT_VERSION - 1 } }), false, 'persetujuan versi lama tidak boleh dianggap berlaku');
  assert.equal(hasConsented({ consent: { versi: CONSENT_VERSION + 1 } }), false);
  assert.equal(hasConsented({}), false);
});

test('persetujuan tercatat sebagai peristiwa', async () => {
  const store = await storeSegar();
  const { user } = await store.createUser({ name: 'Bu Sari' });
  await store.saveConsent(user.id, CONSENT_VERSION);

  const ev = (await store.getEvents(user.id)).find((e) => e.type === 'consent_given');
  assert.ok(ev, 'persetujuan harus meninggalkan jejak waktu');
  assert.equal(ev.meta.versi, CONSENT_VERSION);
});

/* ------------------------------------------- Data milik peserta & penarikan */

test('unduhan data peserta tidak memuat hash kode akses', async () => {
  const store = await storeSegar();
  const { user } = await store.createUser({ name: 'Bu Sari', business: 'Warung' });
  await store.addTransaction(user.id, {
    tanggal: '2026-07-20', jenis: 'masuk', kategori: 'penjualan', jumlah: 400_000, keterangan: '',
  }, { aktor: 'manusia' });

  const data = await store.exportUser(user.id);
  assert.ok(data, 'peserta harus bisa mengambil datanya sendiri');
  assert.equal('codeHash' in data, false, 'hash kode akses tidak boleh ikut terunduh');
  assert.equal(data.transactions.length, 1, 'buku kasnya harus ikut — itu miliknya');
  assert.ok(data.diunduhPada);
});

test('menarik diri benar-benar menghapus, bukan menandai nonaktif', async () => {
  const store = await storeSegar();
  const { user, accessCode } = await store.createUser({ name: 'Bu Sari' });
  await store.saveConsent(user.id, CONSENT_VERSION);
  await store.addTransaction(user.id, {
    tanggal: '2026-07-20', jenis: 'masuk', kategori: 'penjualan', jumlah: 400_000, keterangan: '',
  }, { aktor: 'manusia' });

  assert.ok(await store.findByAccessCode(accessCode));
  assert.equal(await store.deleteUser(user.id), true);

  assert.equal(await store.findByAccessCode(accessCode), null, 'kode akses lama tidak boleh berlaku lagi');
  assert.equal(await store.exportUser(user.id), null);

  // Tidak boleh ada sisa di mana pun — termasuk di ekspor penelitian berikutnya.
  const sisa = JSON.stringify(await store.dump());
  assert.doesNotMatch(sisa, new RegExp(user.id), 'masih ada jejak peserta yang sudah menarik diri');
});

/* ---------------------------------------------------------------- Cadangan */

test('cadangan bisa dibuat, didaftar, dan dipulihkan', async () => {
  const store = await storeSegar();
  const { listBackups, restoreBackup, runBackup } = await import(`../lib/backup.js?uji=${Math.random()}`);

  const { user } = await store.createUser({ name: 'Bu Sari' });
  await store.addTransaction(user.id, {
    tanggal: '2026-07-20', jenis: 'masuk', kategori: 'penjualan', jumlah: 400_000, keterangan: '',
  }, { aktor: 'manusia' });

  const dibuat = await runBackup({ quiet: true });
  assert.equal(dibuat.pengguna, 1);

  const daftar = await listBackups();
  assert.ok(daftar.some((b) => b.file === dibuat.file));

  // Bencana: berkas data hilang.
  await rm(DB_PATH, { force: true });
  assert.equal(existsSync(DB_PATH), false);

  const pulih = await restoreBackup(dibuat.file);
  assert.equal(pulih.pengguna, 1);

  const isi = JSON.parse(await readFile(DB_PATH, 'utf8'));
  assert.equal(isi.users[0].transactions.length, 1, 'buku kas peserta harus kembali utuh');
});

test('berkas data rusak tidak pernah menimpa cadangan yang sehat', async () => {
  await storeSegar();
  const { runBackup } = await import(`../lib/backup.js?uji=${Math.random()}`);

  /*
   * Menyalin berkas rusak ke folder cadangan akan mendorong keluar salinan sehat
   * yang masih ada — cadangan yang justru menghapus satu-satunya data utuh.
   * Karena itu sumber diperiksa dulu, dan pencadangan dibatalkan bila tidak terbaca.
   */
  await writeFile(DB_PATH, '{ ini bukan json valid', 'utf8');

  const hasil = await runBackup({ quiet: true });
  assert.equal(hasil.skipped, 'data-rusak', 'pencadangan harus dibatalkan, bukan menyalin berkas rusak');
});

test('pemulihan menyimpan dulu data yang sedang berjalan', async () => {
  const store = await storeSegar();
  const { restoreBackup, runBackup } = await import(`../lib/backup.js?uji=${Math.random()}`);

  const { user } = await store.createUser({ name: 'Peserta Lama' });
  const lama = await runBackup({ quiet: true });

  // Data berjalan berubah setelah cadangan dibuat.
  await store.createUser({ name: 'Peserta Baru' });
  assert.equal((await store.dump()).users.length, 2);

  const pulih = await restoreBackup(lama.file);

  assert.ok(pulih.salinanSebelumnya, 'data sebelum pemulihan harus ikut disimpan');
  const disimpan = JSON.parse(await readFile(path.join(BACKUP_DIR, pulih.salinanSebelumnya), 'utf8'));
  assert.equal(disimpan.users.length, 2, 'salah pilih berkas tidak boleh berarti kehilangan babak kedua');
  assert.equal(JSON.parse(await readFile(DB_PATH, 'utf8')).users.length, 1);
  assert.ok(user.id);
});

test('pemulihan MENUNGGU kunci berkas, tidak menulis menembusnya', async () => {
  /*
   * `restoreBackup` dulu menulis langsung ke berkas data TANPA mengambil kunci
   * yang dipatuhi store.js. Satu siklus tulis yang sedang berjalan bisa menimpa
   * hasil pemulihan tanpa satu pun pesan:
   *
   *   server : update() → kunci → load() (data lama) → mutasi …
   *   restore:                          → rename (data pulihan mendarat)
   *   server : … → flush() → menimpa dengan data lama   ← PEMULIHAN HILANG
   *
   * PANDUAN-PILOT justru menyuruh memulihkan saat server MASIH HIDUP, jadi
   * jendela itu prosedur tertulis — dan ia terbuka tepat ketika pengelola sudah
   * berada dalam masalah.
   *
   * Diuji dengan MENAHAN kuncinya, bukan dengan mengadu balapan: balapan
   * sungguhan jendelanya beberapa mikrodetik dan akan lolos hampir setiap kali
   * dijalankan, sehingga ujinya lulus tanpa membuktikan apa pun.
   */
  const store = await storeSegar();
  const { restoreBackup, runBackup } = await import(`../lib/backup.js?uji=${Math.random()}`);

  const { user: lama } = await store.createUser({ name: 'Peserta Lama' });
  const cadangan = await runBackup({ quiet: true });

  const { user: baru } = await store.createUser({ name: 'Peserta Sesudah Cadangan' });
  assert.equal(JSON.parse(await readFile(DB_PATH, 'utf8')).users.length, 2);

  // Proses lain sedang di tengah siklus baca-ubah-tulis: kuncinya dipegang.
  const lockPath = `${DB_PATH}.lock`;
  await writeFile(lockPath, `${process.pid}\n`, { flag: 'wx' });

  let selesai = false;
  const pemulihan = restoreBackup(cadangan.file).then((r) => {
    selesai = true;
    return r;
  });

  await new Promise((r) => setTimeout(r, 250));
  assert.equal(selesai, false, 'pemulihan berjalan terus padahal kunci dipegang proses lain');
  assert.equal(
    JSON.parse(await readFile(DB_PATH, 'utf8')).users.length,
    2,
    'berkas data sudah ditimpa padahal kunci masih dipegang — pemulihan menembus kunci',
  );

  // Proses lain selesai dan melepas kuncinya.
  await rm(lockPath, { force: true });
  await pemulihan;

  const akhir = JSON.parse(await readFile(DB_PATH, 'utf8'));
  assert.deepEqual(akhir.users.map((u) => u.id), [lama.id], 'pemulihan harus jadi setelah kunci lepas');
  assert.ok(baru.id);
});

test('cadangan pada detik yang sama tetap terurut menurut waktu pembuatannya', async () => {
  /*
   * Dua cadangan dalam detik yang sama diberi akhiran `-2`, `-3`, dst. Diurut
   * sebagai teks biasa, akhiran itu mendarat SEBELUM berkas dasarnya — pada
   * posisi yang sama `-` (0x2D) lebih kecil daripada `.` (0x2E). Akibatnya
   * `prune()` membuang berkas yang salah, dan daftar cadangan menaruh urutan
   * terbalik tepat ketika pengelola sedang memilih berkas untuk dipulihkan.
   */
  const { kunciUrut } = await import('../lib/backup.js');
  const acak = [
    'users-2026-08-12T02-06-06.json',
    'users-2026-08-12T02-06-05-10.json',
    'users-2026-08-12T02-06-05.json',
    'users-2026-08-12T02-06-05-2.json',
  ];
  assert.deepEqual(
    [...acak].sort((a, b) => kunciUrut(a).localeCompare(kunciUrut(b))),
    [
      'users-2026-08-12T02-06-05.json',
      'users-2026-08-12T02-06-05-2.json',
      'users-2026-08-12T02-06-05-10.json',   // sepuluh, bukan sebelum dua
      'users-2026-08-12T02-06-06.json',
    ],
  );
  // Nama yang tidak berbentuk cadangan tidak boleh membuat pengurutannya kacau.
  assert.ok(kunciUrut('berkas-asing.json') > kunciUrut('users-2026-08-12T02-06-06.json'));
});

test('rekomendasi dan pemakaian tokennya tersimpan dalam satu penulisan', async () => {
  /*
   * Dua panggilan berturut-turut berarti dua kali SELURUH berkas basis data
   * ditulis ulang untuk satu peristiwa. Digabung juga menghapus jendela di mana
   * rekomendasinya sudah tersimpan tapi tokennya belum terhitung ke anggaran.
   */
  const store = await storeSegar();
  const { user } = await store.createUser({ name: 'Bu Sari' });

  const hasil = await store.simpanRekomendasi(
    user.id,
    { rekomendasi: [{ judul: 'Pisahkan uang usaha' }], peringatan: [] },
    { input_tokens: 1200, output_tokens: 300 },
  );

  assert.ok(hasil.generatedAt, 'rekomendasi harus tersimpan');
  const db = await store.dump();
  const tersimpan = db.users.find((u) => u.id === user.id);
  assert.equal(tersimpan.usage.inputTokens, 1200, 'token harus ikut tercatat pada penulisan yang sama');
  assert.equal(tersimpan.usage.outputTokens, 300);
  assert.equal(tersimpan.usage.requests, 1);
  assert.ok(tersimpan.tokenLog.length >= 1, 'jejak anggaran harian harus ikut terisi');
  assert.ok(tersimpan.events.some((e) => e.type === 'recommendations_generated'));
});

test('satu giliran chat menyimpan pesan, jejak, dan token sekaligus', async () => {
  const store = await storeSegar();
  const { user } = await store.createUser({ name: 'Bu Sari' });

  await store.simpanGiliranChat(
    user.id,
    [
      { role: 'user', content: 'berapa laba saya', ts: new Date().toISOString() },
      { role: 'assistant', content: 'Laba bersihmu Rp 7.490.000.', ts: new Date().toISOString() },
    ],
    { input_tokens: 2500, output_tokens: 400 },
    { modul: 4 },
  );

  const tersimpan = (await store.dump()).users.find((u) => u.id === user.id);
  assert.equal(tersimpan.chat.length, 2);
  assert.equal(tersimpan.usage.inputTokens, 2500);
  const jejak = tersimpan.events.find((e) => e.type === 'chat_turn');
  assert.ok(jejak, 'giliran chat harus meninggalkan jejak');
  assert.equal(jejak.meta.modul, 4, 'nomor modul pemicu pertanyaan harus ikut tercatat');
});
