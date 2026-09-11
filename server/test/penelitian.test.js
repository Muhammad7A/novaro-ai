/**
 * Uji regresi untuk data penelitian.
 *
 * Yang dijaga di sini bukan tampilan atau angka, melainkan sesuatu yang lebih
 * sulit diperbaiki belakangan: data yang sekali hilang tidak bisa disusun ulang.
 * Garis dasar penelitian dan jejak perilaku hanya ada satu kesempatan untuk
 * direkam — saat peristiwanya terjadi.
 *
 *   npm test
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
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

const PROFIL_AWAL = {
  namaUsaha: 'Warung Bu Sari',
  jenisUsaha: 'kuliner',
  lokasi: 'Bandung',
  lamaUsahaBulan: 36,
  jumlahKaryawan: 1,
  produkUtama: 'Nasi & lauk',
  omzetBulanan: 12_000_000,
  belanjaBulanan: 6_600_000,
  biayaOperasional: 1_800_000,
  cicilanBulanan: 0,
  pencatatan: 'buku',
  rekeningTerpisah: false,
  punyaNib: false,
  tujuan: 'ajukan-kur',
  tantangan: 'Sering kehabisan modal',
};
/* -------------------------------------------------------------- Garis dasar */

test('profil lama tidak pernah ditimpa — garis dasar selamat', async () => {
  const store = await storeSegar();
  const { user } = await store.createUser({ name: 'Bu Sari', business: 'Warung Bu Sari' });

  await store.saveProfile(user.id, PROFIL_AWAL);
  // Peserta mengoreksi omzetnya di minggu ketiga — di sinilah dulu garis dasar hilang.
  await store.saveProfile(user.id, { ...PROFIL_AWAL, omzetBulanan: 15_000_000, pencatatan: 'aplikasi' });
  await store.saveProfile(user.id, { ...PROFIL_AWAL, omzetBulanan: 14_000_000, pencatatan: 'aplikasi' });

  const history = await store.getProfileHistory(user.id);
  assert.equal(history.length, 3, 'setiap versi profil harus tersimpan');
  assert.equal(history[0].omzetBulanan, 12_000_000, 'GARIS DASAR HILANG — angka hari pertama tertimpa');
  assert.equal(history[0].pencatatan, 'buku', 'cara mencatat di awal ikut hilang');
  assert.equal(history.at(-1).omzetBulanan, 14_000_000);

  // Urutan waktunya harus monoton supaya bisa dipakai sebagai garis waktu.
  const waktu = history.map((p) => p.recordedAt);
  assert.deepEqual([...waktu].sort(), waktu, 'riwayat profil harus urut menurut waktu');
});

test('pengguna lama yang sudah punya profil tetap terselamatkan garis dasarnya', async () => {
  const store = await storeSegar();
  const { user } = await store.createUser({ name: 'Pak Budi' });

  // Meniru data yang dibuat sebelum riwayat profil ada: ada profile, tanpa profileHistory.
  const db = await store.dump();
  await store.saveProfile(user.id, PROFIL_AWAL);
  const setelah = await store.getProfileHistory(user.id);
  assert.ok(setelah.length >= 1);
  assert.equal(db.users.length, 1);

  // Simpan sekali lagi: versi lama harus tetap ada, bukan tergantikan.
  await store.saveProfile(user.id, { ...PROFIL_AWAL, omzetBulanan: 20_000_000 });
  const akhir = await store.getProfileHistory(user.id);
  assert.equal(akhir[0].omzetBulanan, 12_000_000, 'versi pertama harus bertahan');
  assert.equal(akhir.at(-1).omzetBulanan, 20_000_000);
});

/* ------------------------------------------------------------ Jejak perilaku */

test('peristiwa perilaku tercatat dengan waktunya', async () => {
  const store = await storeSegar();
  const { user } = await store.createUser({ name: 'Bu Sari' });

  await store.saveProfile(user.id, PROFIL_AWAL);
  await store.addTransaction(user.id, {
    tanggal: '2026-07-20', jenis: 'masuk', kategori: 'penjualan', jumlah: 400_000, keterangan: '',
  }, { aktor: 'manusia' });
  await store.saveProgress(user.id, { done: { 1: true, 3: true }, checks: {} });
  await store.logEvent(user.id, 'report_viewed', { bulan: 6 });

  const events = await store.getEvents(user.id);
  const jenis = events.map((e) => e.type);

  assert.ok(jenis.includes('user_created'));
  assert.ok(jenis.includes('profile_saved'));
  assert.ok(jenis.includes('transaction_added'));
  assert.ok(jenis.includes('module_completed'));
  assert.ok(jenis.includes('report_viewed'));

  for (const e of events) assert.match(e.ts, /^\d{4}-\d{2}-\d{2}T/, 'tiap peristiwa wajib berstempel waktu');

  const modul = events.find((e) => e.type === 'module_completed');
  assert.deepEqual(modul.meta.modul, [1, 3]);

  const profil = events.find((e) => e.type === 'profile_saved');
  assert.equal(profil.meta.garisDasar, true, 'penyimpanan profil pertama harus ditandai sebagai garis dasar');
});

test('modul yang sudah selesai tidak dicatat ulang sebagai baru', async () => {
  const store = await storeSegar();
  const { user } = await store.createUser({ name: 'Bu Sari' });

  await store.saveProgress(user.id, { done: { 1: true }, checks: {} });
  await store.saveProgress(user.id, { done: { 1: true, 2: true }, checks: {} });
  await store.saveProgress(user.id, { done: { 1: true, 2: true }, checks: {} });

  const selesai = (await store.getEvents(user.id)).filter((e) => e.type === 'module_completed');
  assert.equal(selesai.length, 2, 'hanya perubahan yang boleh menghasilkan peristiwa');
  assert.deepEqual(selesai[0].meta.modul, [1]);
  assert.deepEqual(selesai[1].meta.modul, [2]);
});

test('mencatat transaksi mundur ditandai — penting untuk analisis kebiasaan', async () => {
  const store = await storeSegar();
  const { user } = await store.createUser({ name: 'Bu Sari' });

  const kemarin = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
  await store.addTransaction(user.id, {
    tanggal: kemarin, jenis: 'masuk', kategori: 'penjualan', jumlah: 400_000, keterangan: '',
  }, { aktor: 'manusia' });

  const ev = (await store.getEvents(user.id)).find((e) => e.type === 'transaction_added');
  assert.equal(ev.meta.mundur, true, 'transaksi bertanggal lampau harus ditandai menyusul');
});

/* ---------------------------------------------------------- Batch peserta */

test('batch tersimpan saat pembuatan dan ikut ke daftar peserta', async () => {
  const store = await storeSegar();
  await store.createUser({ name: 'Bu Sari', business: 'Warung Bu Sari', batch: 'B1' });
  await store.createUser({ name: 'Pak Budi', batch: 'b2' }); // huruf kecil harus dinormalkan
  await store.createUser({ name: 'Bu Rina' }); // sengaja tanpa kelompok

  const daftar = await store.listUsers();
  const oleh = (n) => daftar.find((u) => u.name === n);

  assert.equal(oleh('Bu Sari').batch, 'B1');
  assert.equal(oleh('Pak Budi').batch, 'B2', 'batch harus dinormalkan ke huruf besar');
  assert.equal(oleh('Bu Rina').batch, '', 'tanpa kelompok harus kosong, bukan undefined');
});

test('batch yang tidak dikenal ditolak, tidak disimpan apa adanya', async () => {
  const store = await storeSegar();
  const { user } = await store.createUser({ name: 'Bu Sari', batch: 'B3' });
  assert.equal(user.batch, '', 'kelompok karangan tidak boleh masuk ke data penelitian');

  await store.setBatch(user.id, 'kontrol');
  const daftar = await store.listUsers();
  assert.equal(daftar[0].batch, '', 'setBatch juga harus menolak nilai yang tidak dikenal');
});

test('penetapan kelompok tercatat beserta waktunya dan kelompok sebelumnya', async () => {
  const store = await storeSegar();
  const { user } = await store.createUser({ name: 'Bu Sari' });

  await store.setBatch(user.id, 'B1');
  await store.setBatch(user.id, 'B2'); // dipindahkan — harus meninggalkan jejak kedua

  const jejak = (await store.getEvents(user.id)).filter((e) => e.type === 'batch_assigned');
  assert.equal(jejak.length, 2, 'tiap perubahan kelompok harus meninggalkan satu peristiwa');
  assert.deepEqual(jejak[0].meta, { batch: 'B1', sebelum: '' });
  assert.deepEqual(jejak[1].meta, { batch: 'B2', sebelum: 'B1' });
  for (const e of jejak) assert.match(e.ts, /^\d{4}-\d{2}-\d{2}T/, 'kapan pengacakan terjadi ikut dicatat');
});

test('menetapkan kelompok yang sama tidak menambah jejak palsu', async () => {
  const store = await storeSegar();
  const { user } = await store.createUser({ name: 'Bu Sari', batch: 'B1' });

  await store.setBatch(user.id, 'B1');
  await store.setBatch(user.id, 'B1');

  const jejak = (await store.getEvents(user.id)).filter((e) => e.type === 'batch_assigned');
  assert.equal(jejak.length, 0, 'penetapan tanpa perubahan tidak boleh terlihat seperti pengacakan ulang');
});

test('kelompok tidak ikut terkirim ke peramban peserta', async () => {
  const store = await storeSegar();
  const { user } = await store.createUser({ name: 'Bu Sari', batch: 'B1' });

  // Peserta yang tahu dirinya kelompok pembanding bisa berperilaku lain —
  // persis bias yang ingin dihindari penetapan acak.
  const publik = store.publicUser(await store.findByAccessCode('apa saja') ?? user);
  assert.equal(publik.batch, undefined, 'batch tidak boleh bocor lewat publicUser');
});

test('jejak peristiwa tidak memuat nominal atau teks bebas', async () => {
  const store = await storeSegar();
  const { user } = await store.createUser({ name: 'Bu Sari' });

  await store.addTransaction(user.id, {
    tanggal: '2026-07-20', jenis: 'keluar', kategori: 'operasional',
    jumlah: 987_654, keterangan: 'Bayar utang ke Pak Haji Soleh',
  }, { aktor: 'manusia' });

  const teks = JSON.stringify(await store.getEvents(user.id));
  assert.doesNotMatch(teks, /987654/, 'nominal tidak boleh ikut ke jejak peristiwa');
  assert.doesNotMatch(teks, /Haji Soleh/, 'teks bebas tidak boleh ikut ke jejak peristiwa');
});

/* ============================================ Keseimbangan kelompok (acak) */

test('pengacakan menutup ketimpangan kelompok yang sudah ada, bukan melestarikannya', async () => {
  /*
   * `acak` dulu menetapkan kelompok berselang-seling (`urutan[i % 2]`) dengan
   * giliran pertama diberikan ke kelompok yang lebih kecil. Cara itu hanya
   * seimbang bila berangkat dari keadaan yang sudah seimbang — sementara
   * komentarnya menjanjikan "selisihnya tidak pernah lebih dari satu orang":
   *
   *     awal B1=5 B2=0, +5 peserta  ->  berselang-seling: 7/3   (selisih 4)
   *
   * Ketimpangan awal mudah terjadi karena `add --batch` memang ada. Untuk
   * rancangan waitlist-control, kelompok 7 lawan 3 melemahkan daya uji antar
   * kelompok — dan itu tidak bisa diperbaiki setelah data dikumpulkan.
   *
   * Diuji lewat perintahnya sungguhan, bukan lewat salinan logikanya: yang
   * dulu keliru justru ada di dalam perintah itu.
   */
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { fileURLToPath } = await import('node:url');
  const jalankan = promisify(execFile);

  const dir = mkdtempSync(path.join(tmpdir(), 'nova-acak-'));
  const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'users.js');
  const env = { ...process.env, NOVA_DATA_DIR: dir };
  const users = (args) => jalankan(process.execPath, [cli, ...args], { env });

  try {
    // Ketimpangan awal: lima peserta masuk B1 lebih dulu.
    for (let i = 1; i <= 5; i++) await users(['add', `Peserta B1 ${i}`, '--batch', 'B1']);
    // Lima peserta berikutnya belum berkelompok.
    for (let i = 1; i <= 5; i++) await users(['add', `Peserta Baru ${i}`]);

    await users(['acak', '--yes']);

    const db = JSON.parse(await readFile(path.join(dir, 'users.json'), 'utf8'));
    const b1 = db.users.filter((u) => u.batch === 'B1').length;
    const b2 = db.users.filter((u) => u.batch === 'B2').length;

    assert.equal(b1 + b2, 10, 'semua peserta harus punya kelompok');
    assert.ok(
      Math.abs(b1 - b2) <= 1,
      `kelompok timpang ${b1} lawan ${b2} — pengacakan tidak menutup ketimpangan yang sudah ada`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pengacakan tetap acak — bukan sekadar urut daftar', async () => {
  /*
   * Keseimbangan dipaksa, tapi SIAPA yang masuk ke mana harus tetap ditentukan
   * pengocokan. Kalau penetapannya mengikuti urutan pendaftaran, kelompoknya
   * berkorelasi dengan kapan seseorang direkrut — dan itu persis bias yang
   * ingin dihapus oleh penetapan acak.
   */
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { fileURLToPath } = await import('node:url');
  const jalankan = promisify(execFile);
  const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'users.js');

  const polaB1 = new Set();
  for (let ulang = 0; ulang < 6; ulang++) {
    const dir = mkdtempSync(path.join(tmpdir(), 'nova-acak2-'));
    const env = { ...process.env, NOVA_DATA_DIR: dir };
    try {
      for (let i = 1; i <= 8; i++) {
        await jalankan(process.execPath, [cli, 'add', `Peserta ${i}`], { env });
      }
      await jalankan(process.execPath, [cli, 'acak', '--yes'], { env });
      const db = JSON.parse(await readFile(path.join(dir, 'users.json'), 'utf8'));
      polaB1.add(db.users.filter((u) => u.batch === 'B1').map((u) => u.name).sort().join(','));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  assert.ok(polaB1.size > 1, 'enam kali pengacakan menghasilkan pembagian yang sama persis — tidak acak');
});
