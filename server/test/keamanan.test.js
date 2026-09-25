/**
 * Uji regresi lapisan pengamanan HTTP.
 *
 * Semua yang dijaga di sini berangkat dari satu kenyataan: kode akses peserta
 * ikut di header SETIAP permintaan, dan siapa pun yang membacanya mendapat
 * seluruh pembukuan keuangan orang itu.
 *
 *   npm test
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { forceHttps, periksaKodeAkses, resetLoginGuard, securityHeaders } from '../lib/guard.js';

/** Tiruan req/res secukupnya untuk menguji middleware. */
function bikin({ secure = false, method = 'POST', ip = '10.0.0.1', host = 'nova.test', url = '/api/login' } = {}) {
  const res = {
    headers: {},
    statusCode: null,
    body: null,
    redirectedTo: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    redirect(code, to) { this.statusCode = code; this.redirectedTo = to; return this; },
  };
  return { req: { secure, method, ip, originalUrl: url, path: url, headers: { host } }, res };
}

const jalankan = (mw, opts) => {
  const { req, res } = bikin(opts);
  let lanjut = false;
  mw(req, res, () => { lanjut = true; });
  return { req, res, lanjut };
};

/* ------------------------------------------------------------------ HTTPS */

test('permintaan HTTP polos tidak pernah dilayani apa adanya', () => {
  const { res, lanjut } = jalankan(forceHttps, { secure: false, method: 'GET', url: '/dasbor' });
  assert.equal(lanjut, false, 'permintaan tidak aman tidak boleh diteruskan');
  assert.equal(res.statusCode, 308);
  assert.equal(res.redirectedTo, 'https://nova.test/dasbor');
});

test('permintaan berisi data ditolak, bukan dialihkan', () => {
  /*
   * Mengalihkan POST akan tetap mengirim kode aksesnya sekali lewat jaringan
   * terbuka sebelum peramban mengulang ke HTTPS. Yang bocor tidak bisa ditarik
   * kembali, jadi permintaan seperti ini ditolak mentah-mentah.
   */
  const { res, lanjut } = jalankan(forceHttps, { secure: false, method: 'POST' });
  assert.equal(lanjut, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.redirectedTo, null, 'POST tidak boleh dialihkan — kodenya sudah terlanjur terkirim');
});

test('permintaan lewat HTTPS diteruskan', () => {
  const { lanjut } = jalankan(forceHttps, { secure: true });
  assert.equal(lanjut, true);
});

test('pengalihan tidak pernah menuju host yang dikarang penyerang', () => {
  /*
   * Header Host datang dari klien. Memantulkannya begitu saja menjadikan server
   * ini alat pengalih ke situs mana pun, di bawah nama domain program — dan
   * peserta memang diajari mengeklik tautan dari pendampingnya.
   */
  const jahat = jalankan(forceHttps, { secure: false, method: 'GET', host: 'situs-jahat.test\\@nova.test', url: '/' });
  assert.equal(jahat.res.redirectedTo, null, 'host aneh tidak boleh dijadikan tujuan pengalihan');
  assert.equal(jahat.res.statusCode, 400);

  // Host yang wajar tetap dilayani seperti biasa.
  const wajar = jalankan(forceHttps, { secure: false, method: 'GET', host: 'nova.test', url: '/dasbor' });
  assert.equal(wajar.res.redirectedTo, 'https://nova.test/dasbor');
});

/* --------------------------------------------------------- Header keamanan */

test('header keamanan terpasang, dan CSP menutup jalur skrip luar', () => {
  const { res, lanjut } = jalankan(securityHeaders, { secure: true });
  assert.equal(lanjut, true);

  const csp = res.headers['content-security-policy'];
  assert.ok(csp, 'CSP wajib ada');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/, 'halaman tidak boleh bisa dibingkai situs lain');
  assert.match(csp, /object-src 'none'/);
  // Inti pertahanannya: skrip hanya boleh dari domain sendiri.
  assert.doesNotMatch(csp, /script-src[^;]*https?:\/\//, 'CSP tidak boleh mengizinkan skrip dari domain luar');
  /*
   * TIDAK ADA domain luar sama sekali. Teks persetujuan peserta hanya menyebut
   * Anthropic sebagai pihak ketiga; menambahkan kembali font Google (atau
   * apa pun dari domain lain) membuat ponsel peserta menghubungi pihak yang
   * tidak pernah mereka setujui. Kalau baris ini gagal, teks persetujuannya
   * yang harus ikut diperbarui — bukan uji ini yang dilonggarkan.
   */
  assert.doesNotMatch(csp, /https?:\/\//, 'CSP tidak boleh memuat domain luar mana pun');

  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['x-frame-options'], 'DENY');
  assert.equal(res.headers['referrer-policy'], 'no-referrer');
});

test('jawaban API tidak boleh disimpan cache peramban', () => {
  // Isinya pembukuan keuangan, dijaga hanya oleh kode akses di header.
  const api = jalankan(securityHeaders, { secure: true, url: '/api/me' });
  assert.equal(api.res.headers['cache-control'], 'no-store');

  const halaman = jalankan(securityHeaders, { secure: true, url: '/' });
  assert.equal(halaman.res.headers['cache-control'], undefined, 'aset statis tetap boleh di-cache');
});

test('halaman aplikasi tidak memuat apa pun dari domain luar', async () => {
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const luar = [...html.matchAll(/(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)/gi)].map((m) => m[1]);
  // Tautan <a> ke YouTube memang disengaja — yang dilarang adalah SUMBER DAYA
  // yang ikut dimuat otomatis saat halaman dibuka.
  const dimuat = luar.filter((u) => !/youtube\.com\/watch/.test(u));
  assert.deepEqual(dimuat, [], `halaman memuat sumber daya dari luar: ${dimuat.join(', ')}`);
});

test('HSTS hanya dikirim lewat sambungan aman', () => {
  const aman = jalankan(securityHeaders, { secure: true });
  assert.ok(aman.res.headers['strict-transport-security'], 'HSTS wajib ada di HTTPS');

  /*
   * Mengirim HSTS lewat HTTP tidak ada gunanya, dan saat pengembangan lokal
   * justru mengunci localhost ke HTTPS di peramban selama berbulan-bulan.
   */
  const polos = jalankan(securityHeaders, { secure: false });
  assert.equal(polos.res.headers['strict-transport-security'], undefined);
});

/* --------------------------------------------------------- Pembatas login */

const MAKS = Number(process.env.LOGIN_MAX_ATTEMPTS) || 20;
const KODE_BENAR = 'NOVA-BENA-R123';
/** Pencari kode tiruan: hanya satu kode yang sah. */
const cari = async (kode) => (kode === KODE_BENAR ? { id: 'usr_1' } : null);
const coba = (ip, kode, jalur = '/api/login') => periksaKodeAkses(ip, kode, cari, jalur);

test('percobaan kode akses dibatasi per alamat IP', async (t) => {
  resetLoginGuard();
  t.after(resetLoginGuard);

  for (let i = 0; i < MAKS; i++) {
    const r = await coba('10.0.0.9', `SALAH-${i}`);
    assert.equal(r.status, 401, `percobaan ke-${i + 1} seharusnya ditolak biasa`);
  }

  const r = await coba('10.0.0.9', 'SALAH-lagi');
  assert.equal(r.status, 429, 'setelah batas terlampaui, penebakan harus dihentikan');
  assert.match(r.error, /Too many access code attempts/);
});

test('kode yang BENAR tetap diterima walau alamatnya sedang terkunci', async (t) => {
  resetLoginGuard();
  t.after(resetLoginGuard);

  /*
   * Ini inti perbaikannya, dan mudah dibalik tanpa sengaja saat merapikan kode.
   *
   * Operator seluler Indonesia memakai CGNAT: beberapa peserta bisa keluar lewat
   * satu alamat IP publik yang sama. Kalau kunci diperiksa SEBELUM kodenya,
   * satu tetangga yang salah menebak akan mengunci peserta yang kodenya sah —
   * termasuk yang sedang di tengah mencatat transaksi. Penebakan tetap terjaga
   * penuh karena penyerang justru tidak punya kode yang benar.
   */
  for (let i = 0; i < MAKS; i++) await coba('10.0.0.9', `SALAH-${i}`);
  assert.equal((await coba('10.0.0.9', 'SALAH-lagi')).status, 429, 'penebakan harus tetap berhenti');

  const sah = await coba('10.0.0.9', KODE_BENAR);
  assert.ok(sah.user, 'peserta dengan kode sah tidak boleh ikut terkunci di IP bersama');
});

test('kode yang benar mengosongkan hitungan percobaan', async (t) => {
  resetLoginGuard();
  t.after(resetLoginGuard);

  for (let i = 0; i < MAKS - 1; i++) await coba('10.0.0.5', `SALAH-${i}`);
  assert.ok((await coba('10.0.0.5', KODE_BENAR)).user);

  // Peserta yang salah ketik beberapa kali lalu berhasil tidak boleh
  // tersisa satu percobaan lagi sampai 15 menit ke depan.
  for (let i = 0; i < MAKS - 1; i++) {
    assert.equal((await coba('10.0.0.5', `SALAH-lagi-${i}`)).status, 401, 'hitungan seharusnya sudah kosong');
  }
});

test('satu IP yang diblokir tidak ikut memblokir peserta lain', async (t) => {
  resetLoginGuard();
  t.after(resetLoginGuard);

  for (let i = 0; i < MAKS; i++) await coba('10.0.0.1', `SALAH-${i}`);

  assert.equal((await coba('10.0.0.1', 'SALAH-x')).status, 429, 'IP penyerang harus terblokir');
  assert.equal((await coba('10.0.0.2', 'SALAH-x')).status, 401, 'peserta lain tidak boleh ikut terkunci');
});

test('pembatas berlaku juga di luar rute login', async (t) => {
  resetLoginGuard();
  t.after(resetLoginGuard);

  /*
   * Dulu hanya `/api/login` yang dijaga, sehingga menebak kode lewat
   * `GET /api/me` bisa dilakukan tanpa batas DAN tanpa meninggalkan satu baris
   * pun di log — pembatasnya bisa dilewati hanya dengan memilih rute lain.
   */
  for (let i = 0; i < MAKS; i++) await coba('10.0.0.7', `SALAH-${i}`, '/api/me');
  assert.equal((await coba('10.0.0.7', 'SALAH-x', '/api/me')).status, 429);
});
