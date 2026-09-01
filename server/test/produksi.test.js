/**
 * Uji kesiapan produksi.
 *
 * Semua yang diuji di sini tidak pernah terlihat saat mengembangkan di laptop,
 * dan semuanya baru menggigit di server sungguhan:
 *
 *   - probe kesehatan yang menjawab "sehat" tanpa memeriksa apa pun akan
 *     membuat Load Balancer terus mengirim peserta ke instance yang datanya
 *     tidak bisa disimpan;
 *   - aset yang tidak dikompresi menghabiskan kuota prabayar peserta setiap
 *     kali aplikasi dibuka;
 *   - kompresi yang dipasang sembarangan justru MENAHAN aliran jawaban AI;
 *   - penulisan yang terpotong saat server dimatikan hilang tanpa pesan.
 *
 *   npm test
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'nova-produksi-uji-'));
process.env.NOVA_DATA_DIR = DATA_DIR;
process.env.PORT = '0';
process.on('exit', () => rmSync(DATA_DIR, { recursive: true, force: true }));

const { store } = await import('../lib/store.js');
const { periksaPenyimpanan } = await import('../lib/kesehatan.js');
const app = (await import('../server.js')).default;

const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const BASE = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

/* ==================================================== Probe kesehatan */

test('probe kesehatan benar-benar menyentuh penyimpanan', async () => {
  const res = await fetch(`${BASE}/api/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.penyimpanan.baca, 'ok');
  assert.equal(body.penyimpanan.tulis, 'ok');
  assert.equal(typeof body.penyimpanan.peserta, 'number');
});

test('probe kesehatan tidak membocorkan jalur folder data', async () => {
  // Rute ini terbuka tanpa kode akses; letak berkas di server bukan urusannya.
  const teks = await (await fetch(`${BASE}/api/health`)).text();
  assert.ok(!teks.includes(DATA_DIR), 'jalur folder tidak boleh ikut ke jawaban probe');
  assert.ok(!teks.includes('/'), 'tidak ada jalur berkas apa pun di jawaban');
});

test('jumlah peserta ikut dilaporkan — data hilang jadi terlihat dari pemantauan', async () => {
  const sebelum = (await periksaPenyimpanan()).peserta;
  await store.createUser({ name: 'Bu Sari', business: 'Warung Bu Sari' });
  // Cache hasil sehat sengaja pendek; dibaca ulang lewat store untuk kepastian.
  const users = await store.listUsers();
  assert.equal(users.length, sebelum + 1);
});

test('server MENOLAK menyala bila folder data tidak bisa dipakai', async () => {
  /*
   * Ini pemeriksaan yang paling menentukan di berkas ini.
   *
   * Disk yang belum ter-mount, NOVA_DATA_DIR yang salah ketik, atau folder
   * milik pengguna lain semuanya lolos pemeriksaan baca — lalu setiap
   * penyimpanan peserta gagal satu per satu sepanjang hari. Proses yang mati
   * berulang TERLIHAT; penyimpanan yang gagal diam-diam tidak.
   */
  const berkas = path.join(DATA_DIR, 'ini-berkas-bukan-folder');
  writeFileSync(berkas, 'x');

  const jalankan = promisify(execFile);
  let gagal = null;
  try {
    await jalankan(process.execPath, [path.join(HERE, '..', 'server.js')], {
      env: { ...process.env, NOVA_DATA_DIR: berkas, PORT: '0' },
      timeout: 15000,
    });
  } catch (err) {
    gagal = err;
  }

  assert.ok(gagal, 'server seharusnya berhenti, bukan menyala');
  assert.equal(gagal.code, 1, 'keluar dengan status 1 supaya systemd/Cloud Run menandainya gagal');
  const keluaran = `${gagal.stdout ?? ''}${gagal.stderr ?? ''}`;
  assert.match(keluaran, /SERVER TIDAK DINYALAKAN/);
  assert.match(keluaran, /NOVA_DATA_DIR/, 'pesannya harus menyebut apa yang perlu diperiksa');
});

/* ======================================================== Aset ter-gzip */

const ASET = ['/', '/modul.js', '/validasi'];

test('aset besar disajikan ter-gzip bila peramban menerimanya', async () => {
  for (const jalur of ASET) {
    const res = await fetch(BASE + jalur, { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(res.status, 200, jalur);
    assert.equal(res.headers.get('content-encoding'), 'gzip', `${jalur} harus ter-gzip`);
    assert.match(res.headers.get('vary') ?? '', /Accept-Encoding/i, `${jalur} wajib Vary — cache di tengah jalan bisa menyajikan gzip ke klien yang tidak mengerti gzip`);
    /*
     * `fetch` bawaan Node membuka gzip-nya sendiri, jadi badan yang terbaca di
     * sini sudah mentah lagi. Yang membuktikan kompresinya bekerja adalah
     * Content-Length (jumlah byte yang BENAR-BENAR melintasi jaringan) versus
     * panjang isi setelah dibuka.
     */
    const dikirim = Number(res.headers.get('content-length'));
    const setelahDibuka = Buffer.byteLength(await res.text(), 'utf8');
    assert.ok(dikirim > 0 && dikirim < setelahDibuka, `${jalur}: terkirim ${dikirim} byte untuk isi ${setelahDibuka} byte`);
  }
});

test('peramban yang tidak menerima gzip tetap dilayani apa adanya', async () => {
  const res = await fetch(`${BASE}/`, { headers: { 'Accept-Encoding': 'identity' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-encoding'), null);
  assert.match(await res.text(), /<!DOCTYPE html>/i);
});

test('gzip benar-benar memangkas ukurannya, bukan sekadar berjalan', async () => {
  const mentah = Number((await fetch(`${BASE}/modul.js`, { headers: { 'Accept-Encoding': 'identity' } })).headers.get('content-length'));
  const padat = Number((await fetch(`${BASE}/modul.js`, { headers: { 'Accept-Encoding': 'gzip' } })).headers.get('content-length'));
  assert.ok(padat < mentah * 0.5, `gzip hanya memangkas dari ${mentah} ke ${padat} — periksa apakah kompresinya benar-benar jalan`);
});

test('salinan yang sudah dipegang peramban dijawab 304, bukan diunduh ulang', async () => {
  const pertama = await fetch(`${BASE}/modul.js`);
  const etag = pertama.headers.get('etag');
  assert.ok(etag, 'ETag wajib ada supaya 304 mungkin terjadi');

  const kedua = await fetch(`${BASE}/modul.js`, { headers: { 'If-None-Match': etag } });
  assert.equal(kedua.status, 304);
  assert.equal((await kedua.text()).length, 0);
});

test('HEAD tidak membawa badan', async () => {
  const res = await fetch(`${BASE}/modul.js`, { method: 'HEAD' });
  assert.equal(res.status, 200);
  assert.equal((await res.text()).length, 0);
});

test('halaman aplikasi tidak boleh di-cache lama — perbaikan harus sampai ke peserta', async () => {
  const res = await fetch(`${BASE}/`);
  assert.match(res.headers.get('cache-control') ?? '', /no-cache/);
  // Kurikulum sebaliknya: sama untuk semua orang, boleh mengendap sebentar.
  assert.match((await fetch(`${BASE}/modul.js`)).headers.get('cache-control') ?? '', /max-age=\d+/);
});

test('alamat tak dikenal tetap menyajikan aplikasinya, dan tetap ter-gzip', async () => {
  const res = await fetch(`${BASE}/tautan-lama-yang-salah`, { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /html/);
  assert.equal(res.headers.get('content-encoding'), 'gzip');
});

/* ============================================ Aliran AI tidak ikut dipadatkan */

test('jawaban API tidak dikompresi — aliran chat tidak boleh tertahan', async () => {
  /*
   * Middleware kompresi umum menahan keluaran sampai penyangganya penuh. Untuk
   * Server-Sent Events itu berarti peserta menatap layar kosong sampai seluruh
   * jawaban selesai, lalu semuanya muncul sekaligus — persis kebalikan dari
   * alasan aliran itu dipakai. Karena itu kompresi di sini hanya menyentuh tiga
   * berkas statis, dan jalur /api/ dibiarkan utuh.
   */
  const res = await fetch(`${BASE}/api/health`, { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(res.headers.get('content-encoding'), null);
});

/* ======================================================== Mesin pencari */

test('seluruh aplikasi ditandai noindex, termasuk yang tidak punya meta tag', async () => {
  for (const jalur of ['/', '/modul.js', '/validasi', '/api/health']) {
    const res = await fetch(BASE + jalur);
    assert.match(res.headers.get('x-robots-tag') ?? '', /noindex/, `${jalur} belum ditandai noindex`);
  }
  const robots = await fetch(`${BASE}/robots.txt`);
  assert.equal(robots.status, 200);
  assert.match(await robots.text(), /Disallow: \//);
});

/* ============================================== Penulisan saat dimatikan */

test('antrean penulisan bisa ditunggu sampai kosong sebelum proses berhenti', async () => {
  /*
   * Tanpa ini, SIGTERM saat deploy ulang bisa memotong proses tepat di antara
   * "peserta menekan simpan" dan "berkas tertulis ke disk". Peserta yakin
   * catatannya tersimpan, dan tidak ada satu pun pesan yang mengatakan
   * sebaliknya.
   */
  const { user } = await store.createUser({ name: 'Pak Budi', business: 'Warung Budi' });

  // Sepuluh penulisan dilepas tanpa ditunggu, meniru permintaan yang menumpuk.
  for (let i = 0; i < 10; i++) {
    store.addTransaction(user.id, {
      tanggal: '2026-08-01', jenis: 'masuk', kategori: 'penjualan', keterangan: `uji ${i}`, jumlah: 1000 + i,
    });
  }

  await store.selesaikanPenulisan();

  const tersimpan = await store.getTransactions(user.id);
  assert.equal(tersimpan.length, 10, 'seluruh penulisan yang mengantre harus selesai sebelum proses boleh berhenti');
});

/* ================================================= Log yang bisa disaring */

test('log JSON memuat severity yang dikenali Cloud Logging', async () => {
  const jalankan = promisify(execFile);
  const skrip = `import { pathToFileURL } from 'url';
    const {log} = await import(pathToFileURL(${JSON.stringify(path.join(HERE, '..', 'lib', 'log.js'))}).href);
    log.warn('keamanan', 'kode akses salah', { ip: '1.2.3.4', percobaan: 3 });`;
  // Peringatan & galat keluar lewat stderr (console.warn/error) — dan itu
  // memang tempatnya: Cloud Logging membaca kedua aliran, lalu memakai medan
  // `severity` di dalam JSON-nya, bukan menebak dari alirannya.
  const { stdout, stderr } = await jalankan(process.execPath, ['--input-type=module', '-e', skrip], {
    env: { ...process.env, LOG_FORMAT: 'json' },
  });

  const baris = JSON.parse(`${stdout}${stderr}`.trim().split('\n').at(-1));
  assert.equal(baris.severity, 'WARNING');
  assert.equal(baris.komponen, 'keamanan');
  assert.equal(baris.ip, '1.2.3.4');
  assert.ok(baris.message);
});

test('tanpa LOG_FORMAT, log tetap berbentuk teks yang enak dibaca manusia', async () => {
  const jalankan = promisify(execFile);
  const skrip = `import { pathToFileURL } from 'url';
    const {log} = await import(pathToFileURL(${JSON.stringify(path.join(HERE, '..', 'lib', 'log.js'))}).href);
    log.warn('keamanan', 'kode akses salah', { ip: '1.2.3.4' });`;
  const env = { ...process.env };
  delete env.LOG_FORMAT;
  const { stdout, stderr } = await jalankan(process.execPath, ['--input-type=module', '-e', skrip], { env });
  const keluaran = `${stdout}${stderr}`.trim();
  assert.match(keluaran, /^\[keamanan\] kode akses salah/, 'bentuk teks dipakai saat mengembangkan & menonton journalctl');
  assert.ok(!keluaran.startsWith('{'), 'jangan JSON kalau tidak diminta');
});

/* ================================== Probe murah: parse penuh ditahan */

test('probe berulang tidak menghitung ulang peserta — parse penuhnya ditahan', async () => {
  /*
   * Menghitung peserta berarti mem-parse SELURUH users.json. Terukur pada 300
   * peserta: 571 ms sekali jalan — dan bila dilakukan tiap probe (tiap 15 detik,
   * selamanya) itu 3,8% satu inti CPU terpakai terus-menerus dan 287 GB dibaca
   * per hari, hanya untuk menjawab "apakah kamu sehat".
   *
   * Liveness tidak memerlukannya: `stat` + kepala berkas + satu penulisan uji
   * sudah membuktikan bisa-baca dan bisa-tulis, dengan biaya tetap berapa pun
   * besar datanya.
   *
   * Diuji lewat keluaran publik, bukan lewat pengukuran waktu (yang berbeda per
   * mesin dan membuat uji rapuh): `pesertaDiukurPada` hanya bergerak bila parse
   * penuh benar-benar terjadi. Cache hasil dimatikan supaya yang teruji adalah
   * penahan hitungan, bukan cache lapisan luarnya.
   */
  const dir = mkdtempSync(path.join(tmpdir(), 'nova-probe-'));
  writeFileSync(path.join(dir, 'users.json'), JSON.stringify({ version: 1, users: [{ id: 'usr_a' }, { id: 'usr_b' }] }, null, 2));

  const jalankan = promisify(execFile);
  const skrip = `import { pathToFileURL } from 'url';
    const k = await import(pathToFileURL(${JSON.stringify(path.join(HERE, '..', 'lib', 'kesehatan.js'))}).href);
    const cap = [];
    for (let i = 0; i < 10; i++) cap.push(await k.periksaPenyimpanan());
    console.log(JSON.stringify(cap.map((h) => ({ sehat: h.sehat, peserta: h.peserta, pada: h.pesertaDiukurPada }))));`;
  try {
    const { stdout } = await jalankan(process.execPath, ['--input-type=module', '-e', skrip], {
      // Cache hasil dimatikan; penahan hitungan dibiarkan panjang.
      env: { ...process.env, NOVA_DATA_DIR: dir, NOVA_HEALTH_CACHE_MS: '0', NOVA_HEALTH_COUNT_MS: '60000' },
    });
    const cap = JSON.parse(stdout.trim().split('\n').at(-1));
    assert.equal(cap.length, 10);
    assert.ok(cap.every((h) => h.sehat), 'sepuluh probe harus tetap menjawab sehat');
    assert.ok(cap.every((h) => h.peserta === 2), 'jumlah peserta harus tetap dilaporkan');
    const stempel = new Set(cap.map((h) => h.pada));
    assert.equal(
      stempel.size,
      1,
      `peserta dihitung ulang ${stempel.size} kali dalam sepuluh probe — parse penuhnya tidak ditahan`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('probe tetap menolak berkas data yang bukan basis data ini', async () => {
  /*
   * Penghematan di atas tidak boleh menghapus gunanya. Berkas yang isinya
   * bukan basis data Novaro harus tetap membuat probe menjawab 503,
   * karena instance seperti itu tidak boleh menerima peserta.
   */
  const dir = mkdtempSync(path.join(tmpdir(), 'nova-probe-'));
  writeFileSync(path.join(dir, 'users.json'), 'ini bukan json sama sekali');
  const jalankan = promisify(execFile);
  const skrip = `import { pathToFileURL } from 'url';
    const k = await import(pathToFileURL(${JSON.stringify(path.join(HERE, '..', 'lib', 'kesehatan.js'))}).href);
    const h = await k.periksaPenyimpanan();
    console.log(JSON.stringify(h));`;
  try {
    const { stdout } = await jalankan(process.execPath, ['--input-type=module', '-e', skrip], {
      env: { ...process.env, NOVA_DATA_DIR: dir },
    });
    const hasil = JSON.parse(stdout.trim().split('\n').at(-1));
    assert.equal(hasil.sehat, false, 'berkas yang bukan basis data harus membuat probe tidak sehat');
    assert.match(hasil.baca, /tidak-dikenali|rusak/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ================================= Negosiasi Accept-Encoding (q-value) */

test('klien yang MENOLAK gzip tidak pernah dikirimi gzip', async () => {
  /*
   * `Accept-Encoding: gzip;q=0` berarti "jangan kirim gzip" (RFC 9110 §12.5.3).
   * Penyaring lama cukup `/\bgzip\b/`, jadi header itu justru COCOK dan
   * klien menerima persis yang dia tolak — dan yang tampil di layarnya sampah
   * biner, bukan halaman. Kegagalannya total, bukan sebagian.
   */
  for (const header of ['gzip;q=0', 'br;q=1.0, gzip;q=0', '*, gzip;q=0', 'identity']) {
    const res = await fetch(`${BASE}/modul.js`, { headers: { 'Accept-Encoding': header } });
    assert.equal(res.status, 200, header);
    assert.equal(res.headers.get('content-encoding'), null, `"${header}" menolak gzip tapi tetap dikirimi gzip`);
    assert.match(await res.text(), /window\.NOVA_MODUL/, `"${header}" harus tetap menerima isi yang benar`);
  }
});

test('klien yang menerima apa saja (*) tetap dilayani ter-gzip', async () => {
  // Sisi sebaliknya: penyaring lama juga MELEWATKAN `*`, sehingga klien yang
  // sebenarnya sanggup menerima gzip mengunduh versi mentahnya.
  const res = await fetch(`${BASE}/modul.js`, { headers: { 'Accept-Encoding': '*' } });
  assert.equal(res.headers.get('content-encoding'), 'gzip');
});
