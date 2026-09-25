/**
 * Uji regresi lapisan HTTP.
 *
 * Sebelumnya tidak ada satu pun uji yang benar-benar mengirim permintaan ke
 * server ini — semuanya menguji fungsi di dalamnya. Dua kesalahan nyata lolos
 * lewat celah itu: pembatas percobaan kode yang hanya menjaga satu rute, dan
 * pagar persetujuan yang bisa dilewati hanya dengan menyegarkan halaman.
 * Keduanya ada DI SAMBUNGAN antar bagian, bukan di dalam bagiannya.
 *
 *   npm test
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'nova-uji-'));
process.env.NOVA_DATA_DIR = DATA_DIR;
process.env.PORT = '0'; // biarkan sistem memilih port bebas
process.on('exit', () => rmSync(DATA_DIR, { recursive: true, force: true }));

const { store } = await import('../lib/store.js');
const { CONSENT_VERSION } = await import('../lib/consent.js');
const app = (await import('../server.js')).default;

/** Menyalakan server di port bebas untuk seluruh berkas uji ini. */
const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const BASE = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const { user, accessCode } = await store.createUser({ name: 'Bu Sari', business: 'Warung Bu Sari' });

const minta = (jalur, { kode, ...opts } = {}) =>
  fetch(BASE + jalur, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(kode ? { Authorization: `Bearer ${kode}` } : {}),
      ...(opts.headers ?? {}),
    },
  });

/* ============================================================= Persetujuan */

test('rute baca menyertakan teks persetujuan selama peserta belum setuju', async () => {
  const res = await minta('/api/me', { kode: accessCode });
  assert.equal(res.status, 200);
  const body = await res.json();
  /*
   * Tanpa medan ini, halaman yang dimuat ulang tidak punya cara tahu bahwa
   * persetujuan belum berlaku — dan dulu ia memang langsung masuk aplikasi,
   * lalu ditolak pada setiap penyimpanan tanpa pernah bisa menyetujui.
   */
  assert.ok(body.consent, 'jawaban harus membawa teks persetujuan yang belum disetujui');
  assert.equal(body.consent.versi, CONSENT_VERSION);
});

test('menyimpan tanpa persetujuan ditolak DAN diberi jalan keluarnya', async () => {
  for (const [jalur, opts] of [
    ['/api/cashbook', { method: 'POST', body: JSON.stringify({ jenis: 'masuk', kategori: 'penjualan', jumlah: 1000 }) }],
    ['/api/profile', { method: 'PUT', body: JSON.stringify({ namaUsaha: 'X' }) }],
    ['/api/progress', { method: 'PUT', body: JSON.stringify({ done: { 1: true } }) }],
  ]) {
    const res = await minta(jalur, { kode: accessCode, ...opts });
    assert.equal(res.status, 451, `${jalur} harus menolak penulisan tanpa persetujuan`);
    const body = await res.json();
    assert.ok(body.consent, `${jalur} harus ikut mengirim teks persetujuannya, bukan hanya pesan galat`);
    assert.equal(body.consentRequired, true);
  }
});

test('sesudah menyetujui, penulisan diterima', async () => {
  const setuju = await minta('/api/consent', {
    kode: accessCode, method: 'POST', body: JSON.stringify({ versi: CONSENT_VERSION }),
  });
  assert.equal(setuju.status, 200);

  const res = await minta('/api/cashbook', {
    kode: accessCode, method: 'POST',
    body: JSON.stringify({ jenis: 'masuk', kategori: 'penjualan', jumlah: 250_000, keterangan: 'Nasi rames' }),
  });
  assert.equal(res.status, 201);
  assert.equal((await minta('/api/me', { kode: accessCode }).then((r) => r.json())).consent, null);
});

/* ============================================================== Autentikasi */

test('kode yang salah ditolak di semua rute, bukan hanya di login', async () => {
  for (const jalur of ['/api/me', '/api/cashbook', '/api/chat', '/api/report']) {
    assert.equal((await minta(jalur, { kode: 'NOVA-SALA-H999' })).status, 401, `${jalur} harus menolak kode asing`);
  }
  assert.equal((await minta('/api/me')).status, 401, 'tanpa header Authorization pun harus ditolak');
});

/* ============================================================ Batas tanggal */

test('tanggal transaksi dibatasi di kedua ujungnya', async () => {
  const besok = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const depan = await minta('/api/cashbook', {
    kode: accessCode, method: 'POST',
    body: JSON.stringify({ jenis: 'masuk', kategori: 'penjualan', jumlah: 1000, tanggal: besok }),
  });
  assert.equal(depan.status, 400, 'tanggal di masa depan harus ditolak');

  /*
   * Batas bawah menangkap salah ketik tahun — "2016" alih-alih "2026". Tanpa
   * ini, satu transaksi salah ketik menyelipkan bulan asing ke daftar pilihan
   * bulan dan ke riwayat yang dibaca AI, dan peserta tidak punya cara menyadarinya.
   */
  const lampau = await minta('/api/cashbook', {
    kode: accessCode, method: 'POST',
    body: JSON.stringify({ jenis: 'masuk', kategori: 'penjualan', jumlah: 1000, tanggal: '2016-07-05' }),
  });
  assert.equal(lampau.status, 400, 'tanggal bertahun-tahun lampau harus ditolak');
  assert.match((await lampau.json()).error, /tahun/i, 'pesannya harus mengarahkan ke kemungkinan salah ketik tahun');
});

test('bulan yang diminta tidak bisa melampaui bulan berjalan', async () => {
  const res = await minta('/api/cashbook?month=2099-01', { kode: accessCode });
  const body = await res.json();
  assert.notEqual(body.month, '2099-01', 'bulan masa depan tidak pernah punya isi; melayaninya cuma menggambar bulan kosong');
});

/* =============================================================== Alamat lain */

test('alamat tak dikenal: JSON untuk API, halaman aplikasi untuk sisanya', async () => {
  const api = await fetch(`${BASE}/api/entah-apa`);
  assert.equal(api.status, 404);
  assert.match(api.headers.get('content-type') ?? '', /json/);

  // Peserta yang membuka tautan lama harus melihat aplikasinya, bukan JSON mentah.
  const halaman = await fetch(`${BASE}/dasbor`);
  assert.equal(halaman.status, 200);
  assert.match(halaman.headers.get('content-type') ?? '', /html/);
});

test('jawaban API tidak boleh tersimpan di cache peramban', async () => {
  const res = await minta('/api/me', { kode: accessCode });
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

/* ======================================================= Kurikulum & progres */

test('kurikulum disajikan sebagai skrip yang boleh di-cache, tanpa kode akses', async () => {
  /*
   * Sengaja di luar /api/: isinya sama untuk semua peserta dan tidak memuat
   * data pribadi, sementara seluruh /api/ bertanda `no-store` dan akan
   * mengunduh ulang 54 KB tiap kali halaman dibuka — biaya kuota yang tidak
   * pantas ditagihkan berulang ke ponsel peserta.
   */
  const res = await fetch(`${BASE}/modul.js`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /javascript/);
  assert.match(res.headers.get('cache-control') ?? '', /max-age=\d+/);

  const isi = await res.text();
  assert.match(isi, /window\.NOVA_MODUL=/);
  assert.match(isi, /window\.NOVA_JALUR=/);
});

test('progres hanya menerima nomor modul yang benar-benar ada', async () => {
  /*
   * Medan ini datang mentah dari peramban lalu terbaca sebagai `modulSelesai`
   * di users.csv dan `module_completed` di events.csv. Tanpa saringan, satu
   * permintaan boleh menitipkan kunci karangan, dan angka "modul selesai" di
   * data penelitian jadi tidak bisa dibedakan dari yang sungguhan.
   *
   * Jadwal belajar dimulai lebih dulu supaya yang diuji di sini tetap
   * penyaringan nomor asing, bukan gerbang jadwal — sesi 1 tidak akan pernah
   * bisa ditandai selesai selama pendamping belum memulai jalurnya
   * (gerbangnya sendiri diuji tersendiri di jadwal-rute.test.js).
   */

  const res = await minta('/api/progress', {
    kode: accessCode,
    method: 'PUT',
    body: JSON.stringify({
      done: { 101: true, 111: true, 999: true, '__proto__': true, 'bukan-angka': true, 0: true, 1: true },
    }),
  });
  assert.equal(res.status, 200);

  const { progress } = await res.json();
  assert.deepEqual(Object.keys(progress.done).sort(), ['101', '111'], 'nomor asing (termasuk nomor modul lama 1) harus dibuang');
  assert.equal({}.polluted, undefined, 'kunci __proto__ tidak boleh mencemari Object.prototype');
});

test('menyimpan progres tidak menghapus data checks yang sudah ada', async () => {
  /*
   * `store.saveProgress` punya penjaga `progress.checks ?? user.progress?.checks`
   * yang dimaksudkan menjaga data lama. Penjaga itu memakai `??` — yang hanya
   * menangkap null/undefined — sedangkan rutenya dulu SELALU mengirim `{}`,
   * sebuah nilai yang bukan nullish. Akibatnya penjaganya jadi kode mati, dan
   * setiap penyimpanan progres menghapus `checks` lama secara diam-diam.
   *
   * Tampilan memang tidak lagi memakai medan itu, tapi data peserta lama tidak
   * boleh dihapus oleh penyimpanan yang bahkan tidak menyebutnya.
   */
  const simpan = (body) =>
    minta('/api/progress', { kode: accessCode, method: 'PUT', body: JSON.stringify(body) });

  await simpan({ done: { 3: true }, checks: { 'catat-harian': true, 'pisah-uang': true } });
  const awal = await simpan({ done: { 3: true } }).then((r) => r.json());
  assert.deepEqual(
    awal.progress.checks,
    { 'catat-harian': true, 'pisah-uang': true },
    'checks lama terhapus oleh penyimpanan yang tidak menyebutnya',
  );

  // Yang MENGIRIM checks tetap boleh menggantinya — penjaganya bukan pembeku.
  const ganti = await simpan({ done: { 3: true }, checks: { 'tutup-buku': true } }).then((r) => r.json());
  assert.deepEqual(ganti.progress.checks, { 'tutup-buku': true });

  await simpan({ done: {} }); // kembalikan keadaan untuk uji berikutnya
});

test('modul yang ditandai batal selesai ikut terhapus', async () => {
  await minta('/api/progress', {
    kode: accessCode, method: 'PUT', body: JSON.stringify({ done: { 3: true } }),
  });
  const res = await minta('/api/progress', {
    kode: accessCode, method: 'PUT', body: JSON.stringify({ done: {} }),
  });
  const { progress } = await res.json();
  assert.deepEqual(Object.keys(progress.done), []);
});

/* ================================================== Data milik peserta utuh */

test('unduhan data peserta memuat buku kasnya dan bukan hash kodenya', async () => {
  const res = await minta('/api/my-data', { kode: accessCode });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition') ?? '', /attachment/);
  const data = await res.json();
  assert.equal('codeHash' in data, false);
  assert.ok(data.transactions.length >= 1, 'buku kasnya harus ikut — itu miliknya');
  assert.equal(data.id, user.id);
});

/* ============================== Pesan galat AI yang sampai ke layar peserta */

test('kunci API yang ditolak sampai ke peserta sebagai kalimat, bukan gumpalan JSON', async () => {
  /*
   * Rute ini dan /api/recommendations dulu menyaring `err.status` SENDIRI
   * sebelum memanggil describeError:
   *
   *   err.status ? { status: err.status, message: err.message } : describeError(err)
   *
   * Setiap galat SDK Anthropic juga punya `.status` (401, 403, 429), jadi
   * cabang kiri selalu yang terpakai dan seluruh terjemahan di describeError
   * menjadi kode mati. Akibatnya kunci API yang salah muncul di layar pemilik
   * warung sebagai `401 {"type":"error","error":{"type":"authentication_error"
   * ,"message":"invalid x-api-key"}}` — kalimat yang hanya berguna bagi
   * pendamping, di tempat yang justru tidak bisa dibaca pendamping.
   *
   * Diuji lewat rutenya, bukan lewat describeError langsung: yang rusak dulu
   * adalah pemanggilnya, dan uji yang memanggil describeError sendiri akan
   * tetap lulus meski bug-nya kembali.
   */
  const { createServer } = await import('node:http');
  const palsu = createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }));
    });
  });
  await new Promise((r) => palsu.listen(0, r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${palsu.address().port}`;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-uji';

  try {
    await minta('/api/consent', {
      kode: accessCode, method: 'POST', body: JSON.stringify({ versi: CONSENT_VERSION }),
    });

    const res = await minta('/api/chat', {
      kode: accessCode, method: 'POST', body: JSON.stringify({ message: 'halo' }),
    });
    const teks = await res.text();

    assert.match(teks, /event: error/, 'kegagalan harus dilaporkan sebagai peristiwa error');
    assert.match(teks, /kunci api/i, 'peserta harus diberi tahu apa yang perlu diperbaiki');
    assert.ok(
      !teks.includes('authentication_error') && !teks.includes('invalid x-api-key'),
      'pesan mentah dari SDK tidak boleh sampai ke layar peserta',
    );
  } finally {
    palsu.close();
    delete process.env.ANTHROPIC_BASE_URL;
  }
});
