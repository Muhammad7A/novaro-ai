/**
 * Uji injeksi kegagalan (Batch 3 / Session E).
 *
 * Uji lain menjawab "apakah sistem bekerja saat dependensinya kooperatif".
 * Berkas ini menjawab kebalikannya: apakah sistem tetap BISA DIPERCAYA saat
 * penyedia, sambungan, anggaran, atau penyimpanan gagal — tidak ada kegagalan
 * yang diam-diam menjadi sukses palsu, keadaan rusak, atau perilaku tak
 * terkendali. Rancangannya direkam di SESSION-E-FAILURE-INJECTION.md; yang
 * dipatuhi di sini hanyalah invarian yang tidak berubah oleh keputusan
 * pemilik modul (lihat Temuan E-1/E-2 di laporan itu).
 *
 * Satu penyedia palsu untuk SELURUH berkas: klien Anthropic di lib/claude.js
 * di-cache per backend, jadi port yang berubah antar uji meninggalkan klien
 * menunjuk server mati (jebakan yang didokumentasikan rekomendasi.test.js).
 * Perilakunya diganti per uji lewat variabel `perilaku`.
 *
 *   npm test
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'nova-kegagalan-'));
process.env.NOVA_DATA_DIR = DATA_DIR;
process.env.PORT = '0';
/*
 * Dibaca saat modul dimuat (server.js:72) — WAJIB terpasang sebelum import
 * server. Sengaja kecil (3/jam) supaya "penolakan anggaran tidak mengonsumsi
 * jatah laju" bisa dibuktikan dengan lima permintaan, bukan empat puluh.
 */
process.env.RATE_LIMIT_PER_HOUR = '3';
process.env.NOVA_AI_BACKEND = 'anthropic';
process.env.ANTHROPIC_API_KEY = 'sk-ant-uji';
delete process.env.GOOGLE_CLOUD_PROJECT;
process.on('exit', () => rmSync(DATA_DIR, { recursive: true, force: true }));

const DB_PATH = path.join(DATA_DIR, 'users.json');

const { store, GalatMutasi } = await import('../lib/store.js');
const { CONSENT_VERSION } = await import('../lib/consent.js');
const app = (await import('../server.js')).default;

const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const BASE = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

/* ------------------------------------------------------------------ Peserta */

const buatPeserta = async (nama, { profil = false } = {}) => {
  const { user, accessCode } = await store.createUser({ name: nama, business: nama, batch: 'B1' });
  await store.saveConsent(user.id, CONSENT_VERSION);
  if (profil) {
    await store.saveProfile(user.id, {
      namaUsaha: nama, jenisUsaha: 'kuliner', pencatatan: 'buku',
      tujuan: 'naikkan-laba', omzetBulanan: 5_000_000,
    });
  }
  return { id: user.id, accessCode };
};

const harian = await buatPeserta('Bu Harian');
const mingguan = await buatPeserta('Bu Mingguan');
const derai = await buatPeserta('Bu Derai');
const putus = await buatPeserta('Bu Putus');
const putusRek = await buatPeserta('Bu Putus Rek', { profil: true });
const potong = await buatPeserta('Bu Potong', { profil: true });
const lambat = await buatPeserta('Bu Lambat');
const tengah = await buatPeserta('Bu Tengah');
const simpanGagal = await buatPeserta('Bu Simpan', { profil: true });
const tokoPulih = await buatPeserta('Bu Pulih');

/* ----------------------------------------------------------- Penyedia palsu */

let perilaku = 'happy'; // mode penyedia untuk permintaan berikutnya
let hitungan = 0; // berapa kali penyedia benar-benar dihubungi
let deltaHulu = 0; // delta yang sudah ditulis penyedia (untuk penjajakan abort)
let huluTertutup = null; // waktu sambungan hulu tertutup; null = masih terbuka

const penyedia = createServer((req, res) => {
  hitungan += 1;
  req.on('data', () => {});
  req.on('end', () => {
    const usage = { input_tokens: 10, output_tokens: 5 };
    const mode = perilaku;
    const w = (t, d) => res.write(`event: ${t}\ndata: ${JSON.stringify(d)}\n\n`);
    const mulai = () => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      w('message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5', content: [], stop_reason: null, usage } });
      w('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    };
    const selesaiNormal = () => {
      w('content_block_stop', { type: 'content_block_stop', index: 0 });
      w('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage });
      w('message_stop', { type: 'message_stop' });
      res.end();
      huluTertutup = Date.now();
    };

    res.on('close', () => {
      huluTertutup = Date.now();
    });

    if (mode === 'destroy') {
      // Penyedia mati di tengah aliran: sambungan dihancurkan, bukan ditutup.
      mulai();
      w('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'sebagian ' } });
      deltaHulu += 1;
      setTimeout(() => res.destroy(), 30);
      return;
    }
    if (mode === 'truncate') {
      // Sambungan ditutup rapi TANPA message_delta / message_stop.
      mulai();
      w('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'sebagian ' } });
      w('content_block_stop', { type: 'content_block_stop', index: 0 });
      res.end();
      return;
    }
    if (mode === 'dribble' || mode === 'dribble-abort') {
      // Jawaban teknis hidup tapi menetes. dribble selesai; dribble-abort
      // menetes terus sampai sambungannya ditutup pihak mana pun.
      mulai();
      let i = 0;
      const timer = setInterval(() => {
        w('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `potongan ${i} ` } });
        i += 1;
        deltaHulu = i;
        if (mode === 'dribble' && i >= 4) {
          clearInterval(timer);
          selesaiNormal();
        }
      }, 30);
      res.on('close', () => clearInterval(timer));
      return;
    }
    mulai();
    // happy = penyedia SEHAT: jawaban JSON utuh untuk rekomendasi — tanpa
    // delta ini generateRecommendations membaca teks kosong dan gagal 502
    // SEBELUM menyentuh penyimpanan (kegagalan yang membuat uji kemarin
    // lulus karena alasan yang salah).
    w('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: JSON.stringify(REK_SAH) } });
    selesaiNormal();
  });
});
await new Promise((r) => penyedia.listen(0, r));
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${penyedia.address().port}`;
test.after(() => {
  penyedia.close();
  delete process.env.ANTHROPIC_BASE_URL;
});

/* ------------------------------------------------------------------ Pemantu */

const minta = (jalur, { kode, ...opts } = {}) =>
  fetch(BASE + jalur, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(kode ? { Authorization: `Bearer ${kode}` } : {}),
      ...(opts.headers ?? {}),
    },
  });

/** Urai tubuh SSE menjadi daftar {ev, data} — bentuk yang dikirim rute chat. */
const bacaSSE = async (res) => {
  const teks = await res.text();
  const acara = [];
  for (const blok of teks.split('\n\n')) {
    const ev = blok.match(/^event: (.+)$/m)?.[1];
    if (!ev) continue;
    const baris = blok.match(/^data: (.+)$/m)?.[1];
    acara.push({ ev, data: baris ? JSON.parse(baris) : null });
  }
  return acara;
};

/** Tunggu sampai `cek()` benar atau habis batasnya — tanpa tidur terkalibrasi. */
const tungguHingga = async (cek, batasMs = 4000) => {
  for (let i = 0; i < batasMs / 20 && !cek(); i += 1) await new Promise((r) => setTimeout(r, 20));
  return cek();
};

/** Kebenaran DISK — bukan cache toko (lihat Temuan E-1). Konvensi ketahanan. */
const penggunaDisk = async (id) => {
  const db = JSON.parse(await readFile(DB_PATH, 'utf8'));
  return db.users.find((u) => u.id === id);
};

/** Satu toko baru — cache modulnya sendiri, seperti "proses lain". */
const prosesBaru = async () => (await import(`../lib/store.js?p=${Math.random()}`)).store;

const REK_SAH = {
  ringkasan: 'Usaha untung tetapi kas sering menipis.',
  rekomendasi: [{ judul: 'Rapikan pemisahan uang', prioritas: 'sedang', alasan: 'Prive tidak tetap.', langkah: ['Tetapkan prive mingguan'], dampak: 'Kas berhenti tergerus.', modulTerkait: 1 }],
  peringatan: [],
  targetBulanIni: ['Catat setiap hari'],
};
const USAGE_UJI = { input_tokens: 10, output_tokens: 5 }; // hitungToken = 15

/* ===================================================== E1 — Anggaran habis */

test('anggaran harian habis: 429 di gerbang rute, penyedia tidak dihubungi', async () => {
  // Jalur akuntansi yang sama dengan produksi: 100.000 token hari ini
  // melampaui anggaran harian bawaan (60.000) tapi belum menyentuh mingguan.
  await store.recordUsage(harian.id, { input_tokens: 100_000 });

  hitungan = 0;
  const res = await minta('/api/chat', { kode: harian.accessCode, method: 'POST', body: JSON.stringify({ message: 'halo' }) });
  assert.equal(res.status, 429);
  const body = await res.json();
  assert.equal(body.anggaranHabis, 'harian', 'jenis jendela yang habis harus terbaca di jawaban');
  assert.equal(hitungan, 0, 'penyedia tidak boleh dihubungi saat anggaran sudah habis');

  const u = await penggunaDisk(harian.id);
  assert.equal(u.tokenLog.length, 1);
  assert.equal(u.tokenLog[0].token, 100_000, 'penolakan tidak boleh mengubah jejak pemakaian — naik atau turun');
  assert.equal(u.usage.requests, 1, 'hanya penyemaian yang tercatat — penolakan bukan pemakaian');
  assert.equal((u.events ?? []).filter((e) => e.type === 'anggaran_habis').length, 1);
});

test('anggaran mingguan habis dilaporkan sebagai mingguan, bukan harian', async () => {
  // 400.000 menghabiskan keduanya; cekAnggaran memeriksa mingguan lebih dulu
  // karena pengisinya lebih lamai — tertukar berarti peserta diberi tahu
  // "besok pagi penuh lagi" padahal jatahnya belum pulih sampai Senin.
  await store.recordUsage(mingguan.id, { input_tokens: 400_000 });

  const res = await minta('/api/chat', { kode: mingguan.accessCode, method: 'POST', body: JSON.stringify({ message: 'halo' }) });
  assert.equal(res.status, 429);
  assert.equal((await res.json()).anggaranHabis, 'mingguan');
});

test('derai penolakan anggaran tidak mengonsumsi jatah laju dan tidak membanjiri jejak', async () => {
  /*
   * RATE_LIMIT dibatasi 3/jam di kepala berkas. Kalau penolakan anggaran
   * mengonsumsi slot laju, permintaan ke-4 dan ke-5 berganti pesan menjadi
   * "Batas pemakaian AI tercapai" — artinya peserta kehilangan kuota laju
   * untuk penolakan yang bukan salahnya. Dedup `jedaMs` dijaga bersamaan:
   * enam penolakan adalah SATU peristiwa `anggaran_habis`, bukan enam.
   */
  await store.recordUsage(derai.id, { input_tokens: 400_000 });

  hitungan = 0;
  for (let i = 0; i < 5; i += 1) {
    const res = await minta('/api/chat', { kode: derai.accessCode, method: 'POST', body: JSON.stringify({ message: 'halo' }) });
    assert.equal(res.status, 429);
    const body = await res.json();
    assert.ok(
      body.anggaranHabis && !/Batas pemakaian AI tercapai/.test(body.error ?? ''),
      `permintaan ${i + 1} harus ditolak anggaran, bukan jatah laju`,
    );
  }
  assert.equal(hitungan, 0, 'penyedia tidak pernah dihubungi sepanjang derai');

  const u = await penggunaDisk(derai.id);
  assert.equal((u.events ?? []).filter((e) => e.type === 'anggaran_habis').length, 1,
    'dedup 1 jam harus menahan banjir peristiwa — tiap peristiwa menulis ulang seluruh berkas');
});

/* ============================================ E2 — Penyedia mati di tengah */

test('chat: sambungan penyedia hancur di tengah aliran — satu akhir, tidak ada yang tersimpan', async () => {
  perilaku = 'destroy';
  hitungan = 0;

  const res = await minta('/api/chat', { kode: putus.accessCode, method: 'POST', body: JSON.stringify({ message: 'halo' }) });
  assert.equal(res.status, 200, 'SSE: kepala sudah terkirim sebelum penyedia mati');

  const acara = await bacaSSE(res);
  const nama = acara.map((a) => a.ev);
  assert.ok(nama.includes('error'), 'kegagalan harus tiba sebagai event error');
  assert.match(
    acara.find((a) => a.ev === 'error')?.data?.error ?? '',
    /terputus/,
    'galat transport harus sampai sebagai kalimat terpotong (502), bukan "tak terduga" (500)',
  );
  assert.ok(!nama.includes('done'), 'done setelah aliran patah adalah sukses palsu');

  const u = await penggunaDisk(putus.id);
  assert.deepEqual(u.chat ?? [], [], 'tidak ada giliran setengah jadi yang tersimpan');
  assert.equal(u.tokenLog ?? null, null,
    'usage tidak pernah tiba dari penyedia — mencatatnya berarti mengarang angka tagihan');
  assert.ok(!(u.events ?? []).some((e) => e.type === 'chat_turn'));
  assert.equal(hitungan, 1, 'tepat satu panggilan hulu — aliran yang sudah mengalir tidak boleh diulang SDK');
});

test('rekomendasi: penyedia mati di tengah aliran — ditolak, tidak ada yang tersimpan', async () => {
  perilaku = 'destroy';
  hitungan = 0;

  const res = await minta('/api/recommendations', { kode: putusRek.accessCode, method: 'POST' });
  assert.equal(res.status, 502, 'sambungan yang sudah mengalir lalu mati = jawaban terpotong (502), bukan 500');
  const body = await res.json();
  assert.match(body.error, /terputus/, 'kalimat galat yang dijanjikan galat bertipe, bukan "tak terduga"');

  const u = await penggunaDisk(putusRek.id);
  assert.equal(u.recommendations ?? null, null);
  assert.equal(u.tokenLog ?? null, null);
  assert.ok(!(u.events ?? []).some((e) => e.type === 'recommendations_generated'));
  assert.equal(hitungan, 1);
});

/* =============================================== E3 — SSE terpotong rapi */

test('penyedia menutup aliran tanpa menyelesaikannya: ditolak, tidak ada yang tersimpan', async () => {
  /*
   * Sisi lain dari destroy: FIN rapi tanpa message_delta/message_stop.
   * Beda dengan kasus rekomendasi.test.js (SSE UTUH berisi JSON rusak —
   * milik pembersih); di sini alirannya tidak pernah selesai sampai ke SDK.
   */
  perilaku = 'truncate';
  hitungan = 0;

  const res = await minta('/api/recommendations', { kode: potong.accessCode, method: 'POST' });
  assert.equal(res.status, 502, 'aliran yang berhenti sebelum waktunya = terpotong (502), bukan 500');

  const u = await penggunaDisk(potong.id);
  assert.equal(u.recommendations ?? null, null, 'setengah aliran tidak boleh tersimpan sebagai rekomendasi');
  assert.equal(u.tokenLog ?? null, null);
  assert.equal(hitungan, 1);
});

/* =========================================== E4 — Aliran menetes & batal */

test('aliran yang lambat tetap selesai utuh dan terhitung sekali', async () => {
  /*
   * Tidak ada batas waktu buatan di rute — satu-satunya tenggat adalah
   * 120 detik milik SDK. Aliran yang menetes HARUS selesai: batas waktu
   * yang diselipkan di rute justru memotong penyusunan yang sah.
   */
  perilaku = 'dribble';
  hitungan = 0;

  const res = await minta('/api/chat', { kode: lambat.accessCode, method: 'POST', body: JSON.stringify({ message: 'halo' }) });
  const acara = await bacaSSE(res);

  const teks = acara.filter((a) => a.ev === 'delta').map((a) => a.data.text).join('');
  assert.equal(teks, 'potongan 0 potongan 1 potongan 2 potongan 3 ', 'seluruh tetesan harus sampai berurutan');

  const selesai = acara.find((a) => a.ev === 'done');
  assert.ok(selesai, 'aliran lambat harus menuntungkan event done');
  assert.equal(selesai.data.terpotong, false);
  assert.ok(Number.isFinite(selesai.data.anggaran?.sisa), 'sisa anggaran ikut dikirim saat done');

  const u = await penggunaDisk(lambat.id);
  assert.equal(u.chat.length, 2, 'giliran pertanyaan+jawaban tersimpan utuh');
  assert.equal(u.tokenLog.length, 1);
  assert.equal(u.tokenLog[0].token, 15, '10 masuk + 5 keluar = 15 token terhitung — tepat sekali');
  assert.equal(u.usage.inputTokens, 10);
});

test('peserta pergi di tengah aliran lambat: hulu berhenti, tidak ada yang tertinggal', async () => {
  perilaku = 'dribble-abort';
  hitungan = 0;
  deltaHulu = 0;
  huluTertutup = null;

  const batal = new AbortController();
  const jawaban = minta('/api/chat', {
    kode: tengah.accessCode, method: 'POST', body: JSON.stringify({ message: 'halo' }), signal: batal.signal,
  }).catch(() => null);

  await tungguHingga(() => deltaHulu > 0, 3000);
  assert.ok(deltaHulu > 0, 'prasyarat: aliran memang sudah menetes sebelum pembatalan');

  batal.abort(); // peserta menutup aplikasi
  await jawaban;

  assert.ok(await tungguHingga(() => huluTertutup !== null),
    'peserta sudah pergi tapi panggilan hulu masih mengalir — tokennya tetap ditagih');
  assert.equal(hitungan, 1);

  const u = await penggunaDisk(tengah.id);
  assert.deepEqual(u.chat ?? [], [], 'tidak ada giliran yang tersimpan dari aliran yang dibatalkan');
  assert.equal(u.tokenLog ?? null, null);
  assert.ok(!(u.events ?? []).some((e) => e.type === 'chat_turn'));
});

/* ============================================ E5 — Penyimpanan gagal */

test('penyimpanan gagal setelah AI sukses: tidak ada sukses palsu, disk utuh, kunci lepas', async () => {
  /*
   * Seam: direktori tepat di jalur sementara yang dihitung flush() sendiri
   * (users.json.<pid>.tmp) — writeFile gagal EISDIR sebelum rename. Model
   * kegagalan nyata (disk penuh/EIO): berkas lama utuh, tulisan baru mustahil.
   * Tidak ada kode produksi yang disentuh.
   */
  perilaku = 'happy';
  hitungan = 0;

  const seam = path.join(DATA_DIR, `users.json.${process.pid}.tmp`);
  await mkdir(seam);
  try {
    const res = await minta('/api/recommendations', { kode: simpanGagal.accessCode, method: 'POST' });
    // 500, BUKAN 502: penyedia sehat (happy = JSON sah, tepat satu panggilan);
    // yang gagal penyimpanannya — galat tanpa status milik disk, bukan galat
    // penyedia. Pembeda ini yang dulu membuat uji lulus karena alasan salah
    // (penyedia tanpa delta mengirim 502 yang juga lolos ">= 500").
    assert.equal(res.status, 500, 'AI sukses tapi penyimpanan gagal — ditolak sebagai galat server');
    assert.equal(hitungan, 1, 'penyedia memang sempat sukses — kegagalannya murni di penyimpanan');
    const body = await res.json();
    assert.ok(body.error);

    const u = await penggunaDisk(simpanGagal.id);
    assert.equal(u.recommendations ?? null, null, 'tidak ada rekomendasi yang sampai ke disk');
    assert.equal(u.tokenLog ?? null, null, 'pemakaian yang gagal ditulis tidak boleh tercatat di disk');
    assert.ok(!(u.events ?? []).some((e) => e.type === 'recommendations_generated'));
    assert.equal(existsSync(`${DB_PATH}.lock`), false, 'kunci berkas harus selalu lepas meski flush gagal');

    const db = JSON.parse(await readFile(DB_PATH, 'utf8'));
    assert.ok(Array.isArray(db.users) && db.users.length >= 1, 'berkas data tetap basis data yang utuh dan terbaca');
  } finally {
    await rm(seam, { recursive: true, force: true });
  }
});

test('kegagalan tulis tidak mendarat diam-diam lewat penulisan proses lain', async () => {
  /*
   * Mutasi yang DITOLAK ke pemanggilnya tidak boleh ikut tertulis oleh
   * penulisan instance toko yang lain (yang membaca kebenaran disk). Bukinya
   * hitungan PERSIS-sekali: kalau mutasi Bu Simpan yang ditolak 500 itu
   * sempat mendarat lewat pintu mana pun, peristinya dua, pemakaiannya dua.
   * Invarian ini jujur di bawah perilaku cache saat ini maupun sesudah
   * Temuan E-1 ditangani — yang dijaga kebenaran disk, bukan cache satu proses.
   */
  const toko = await prosesBaru();
  await toko.simpanRekomendasi(simpanGagal.id, REK_SAH, USAGE_UJI);

  const u = await penggunaDisk(simpanGagal.id);
  assert.equal((u.events ?? []).filter((e) => e.type === 'recommendations_generated').length, 1,
    'tepat satu peristiwa — milik tulisan proses lain ini saja');
  assert.equal(u.usage.requests, 1, 'tepat satu pemakaian — milik tulisan proses lain ini saja');
  assert.equal(u.tokenLog[0].token, 15);
});

test('penyimpanan gagal di tingkat toko: penolakan menyeluruh, disk tak tersentuh', async () => {
  const toko = await prosesBaru();
  const { user } = await toko.createUser({ name: 'Bu Toko' });

  const seam = path.join(DATA_DIR, `users.json.${process.pid}.tmp`);
  await mkdir(seam);
  try {
    await assert.rejects(
      () => toko.simpanRekomendasi(user.id, REK_SAH, USAGE_UJI),
      'pemanggil harus menerima penolakan, bukan janji yang seolah sukses',
    );
    const u = await penggunaDisk(user.id);
    assert.equal(u.recommendations ?? null, null);
    assert.equal(u.tokenLog ?? null, null);
    assert.ok(!(u.events ?? []).some((e) => e.type === 'recommendations_generated'));
  } finally {
    await rm(seam, { recursive: true, force: true });
  }
});

test('setelah pulih, penulisan ulang mendarat tepat sekali dari kebenaran disk', async () => {
  /*
   * Proses baru = cache kosong = disk yang kebaca. Inilah janji yang boleh
   * dipegang peserta: gagal hari ini, coba lagi, keadaannya SATU — bukan dua.
   * Pasangan lintas-prosesnya dari sisi DALAM proses diuji di bawah
   * (Seksi E6) sesudah Temuan E-1 dijatuhkan: flush yang gagal kini
   * membuang cache, sama seperti mutator yang gagal.
   */
  const toko = await prosesBaru();
  await toko.simpanRekomendasi(tokoPulih.id, REK_SAH, USAGE_UJI);

  const u = await penggunaDisk(tokoPulih.id);
  assert.ok(u.recommendations, 'rekomendasi akhirnya tersimpan');
  assert.equal(u.recommendations.rekomendasi.length, 1, 'semantik timpa: tidak ada penggandaan isi');
  assert.equal((u.events ?? []).filter((e) => e.type === 'recommendations_generated').length, 1,
    'tepat satu peristiwa — kegagalan sebelumnya tidak menggandakan keadaan');
  assert.equal(u.usage.requests, 1, 'pemakaian tercatat tepat sekali');
  assert.equal(u.tokenLog[0].token, 15);
});

/* ================= E6 — Temuan E-1 dijatuhkan: flush gagal membuang cache */

test('flush gagal: pembacaan sesaat kemudian mengembalikan keadaan lama, bukan mutasi yang ditolak', async () => {
  /*
   * Dulu (Temuan E-1): flush yang gagal meninggalkan mutasi di cache — dan
   * sidik berkas masih cocok dengan berkas lama yang utuh — sehingga
   * pembacaan DALAM PROSES YANG SAMA menyajikan mutasi yang DITOLAK ke
   * pemanggilnya seolah sudah nyata. Kini cache dibuang, aturan yang sama
   * dengan mutator yang gagal.
   */
  const gagal = await buatPeserta('Bu E Satu');
  await store.recordUsage(gagal.id, { input_tokens: 10 }); // keadaan lama: 10 token

  const seam = path.join(DATA_DIR, `users.json.${process.pid}.tmp`);
  await mkdir(seam);
  try {
    await assert.rejects(() => store.recordUsage(gagal.id, { input_tokens: 1_000_000 }));

    // Pembacaan dalam proses yang sama — inilah yang dulu menyajikan hantu.
    const log = await store.getTokenLog(gagal.id);
    assert.equal(log.length, 1);
    assert.equal(log[0].token, 10, 'tokenLog yang terbaca = keadaan lama, bukan 1.000.010');
    const dariToko = (await store.listUsers()).find((u) => u.id === gagal.id);
    assert.equal(dariToko.usage.inputTokens, 10, 'usage agregat = keadaan lama');
    // Disk tentu sama — dua sumber kebenaran tidak boleh berbeda.
    assert.equal((await penggunaDisk(gagal.id)).usage.inputTokens, 10);
  } finally {
    await rm(seam, { recursive: true, force: true });
  }

  // Penulisan sukses berikutnya dalam proses yang sama tidak boleh ikut
  // meng-commit mutasi yang ditolak itu (dulu: usage mendarat lewat pintu belakang).
  await store.logEvent(gagal.id, 'login');
  const u = await penggunaDisk(gagal.id);
  assert.equal(u.usage.inputTokens, 10, 'mutasi yang ditolak tidak mendarat diam-diam');
  assert.equal(u.tokenLog[0].token, 10);
});

test('requestId dedup tidak 409 untuk percobaan ulang yang tidak pernah persist', async () => {
  /*
   * Interaksi paling berbahaya dari Temuan E-1: baris gagal flush tetap
   * terbaca dari cache, lalu dedup requestId menjawab `duplikat` untuk
   * percobaan ulang atas transaksi yang BELUM PERNAH ADA di disk. Kini
   * retry yang sah diterima, dan dedup tetap nyata untuk yang sudah persist.
   */
  const rekonsiliasi = await buatPeserta('Bu Rekonsiliasi');
  const baris = {
    tanggal: '2026-08-01', jenis: 'keluar', kategori: 'operasional',
    keterangan: 'rekonsiliasi', jumlah: 5_000,
  };
  const idPermintaan = 'rekonsiliasi-2026.09.12-01';

  const seam = path.join(DATA_DIR, `users.json.${process.pid}.tmp`);
  await mkdir(seam);
  try {
    await assert.rejects(
      () => store.addTransaction(rekonsiliasi.id, baris, { aktor: 'manusia', requestId: idPermintaan }),
      'flush gagal harus sampai ke pemanggil sebagai penolakan',
    );
  } finally {
    await rm(seam, { recursive: true, force: true });
  }

  // Percobaan ulang DENGAN requestId yang sama — dulu 409 duplikat palsu.
  const baris1 = await store.addTransaction(rekonsiliasi.id, baris, { aktor: 'manusia', requestId: idPermintaan });
  assert.ok(baris1, 'retry yang tidak pernah persist harus diterima, bukan dianggap duplikat');

  const u = await penggunaDisk(rekonsiliasi.id);
  const barisPersist = (u.transactions ?? []).filter((t) => t.requestId === idPermintaan);
  assert.equal(barisPersist.length, 1, 'tepat satu baris — retry tidak menggandakan transaksi');

  // Yang SUDAH persist tetap terjaga dedup-nya.
  await assert.rejects(
    () => store.addTransaction(rekonsiliasi.id, baris, { aktor: 'manusia', requestId: idPermintaan }),
    (err) => err instanceof GalatMutasi && err.kode === 'duplikat' && err.status === 409,
    'setelah persist, requestId yang sama harus tetap ditolak sebagai duplikat',
  );
});

test('rekomendasi: retry dalam proses yang sama setelah heal mendarat tepat sekali', async () => {
  /*
   * Pasangan dalam-proses dari uji lintas-proses di atas. Dulu tidak bisa
   * diuji jujur: mutasi gagal flush menetap di cache, jadi retry mendarat
   * DOBEL (satu dari cache hantu, satu dari retry). Kini hanya mutasi baru.
   */
  const pulih = await buatPeserta('Bu Pulih Dalam Proses', { profil: true });
  perilaku = 'happy';
  hitungan = 0;

  const seam = path.join(DATA_DIR, `users.json.${process.pid}.tmp`);
  await mkdir(seam);
  try {
    const gagal = await minta('/api/recommendations', { kode: pulih.accessCode, method: 'POST' });
    assert.equal(gagal.status, 500, 'kegagalan penyimpanan = galat server (bukan 502 penyedia — penyedia sehat)');
    assert.equal(hitungan, 1);
  } finally {
    await rm(seam, { recursive: true, force: true });
  }

  const sukses = await minta('/api/recommendations', { kode: pulih.accessCode, method: 'POST' });
  assert.equal(sukses.status, 200);

  const u = await penggunaDisk(pulih.id);
  assert.equal((u.events ?? []).filter((e) => e.type === 'recommendations_generated').length, 1,
    'tepat satu peristiwa — kegagalan sebelumnya tidak ikut mendarat');
  assert.equal(u.usage.requests, 1, 'pemakaian tercatat tepat sekali dari retry yang berhasil');
  assert.equal(u.tokenLog[0].token, 15);
  assert.equal(u.recommendations.rekomendasi.length, 1);
});

/* ===================== E7 — E-2: transport → 502 eksak, dan refund-nya */

test('galat bertipe stream lewat describeError sebagai 502, juga lewat dispatcher ai.js', async () => {
  const { galatStreamTerpotong, galatStreamHabis } = await import('../lib/batas-stream.js');
  const claude = await import('../lib/claude.js');
  const ai = await import('../lib/ai.js');

  for (const galat of [galatStreamTerpotong(), galatStreamHabis()]) {
    const hasil = claude.describeError(galat);
    assert.equal(hasil.status, 502, `${galat.code} harus 502 — bukan 500 "tak terduga"`);
    assert.equal(ai.describeError(galat).status, 502, 'dispatcher ai.js harus meneruskan 502 yang sama');
    assert.ok(
      [502, 503, 429].includes(hasil.status),
      '502 = kegagalan layanan → jalur refund jatah laju di server.js harus aktif',
    );
  }
});

test('batas waktu stream aplikasi: 502 bertipe, bukan menggantung selamanya', async () => {
  /*
   * Deadline dari commit B (NOVA_AI_STREAM_TIMEOUT_MS dibaca per pemanggilan,
   * jadi bisa dipasang sementara). Penyedia terus menetes tanpa ujung —
   * permintaan harus berakhir sendiri dengan galat bertipe.
   */
  const tenggat = await buatPeserta('Bu Tenggat', { profil: true });
  perilaku = 'dribble-abort';
  hitungan = 0;
  process.env.NOVA_AI_STREAM_TIMEOUT_MS = '150';
  try {
    const res = await minta('/api/recommendations', { kode: tenggat.accessCode, method: 'POST' });
    assert.equal(res.status, 502);
    assert.match((await res.json()).error, /terlalu lama/);
    const u = await penggunaDisk(tenggat.id);
    assert.equal(u.recommendations ?? null, null);
    assert.equal(u.tokenLog ?? null, null);
    assert.equal(hitungan, 1);
  } finally {
    delete process.env.NOVA_AI_STREAM_TIMEOUT_MS;
  }
});

test('jatah laju dikembalikan pada kegagalan transport — peserta tidak kehilangan kuota', async () => {
  /*
   * Janji komentar rateLimit() (server.js): "pengguna tidak boleh kehilangan
   * kuota untuk kegagalan yang bukan salahnya". RATE_LIMIT file ini 3/jam.
   * Tanpa refund, kegagalan keempat sudah berganti menjadi "Batas pemakaian
   * AI tercapai". Dengan refund, semua kegagalan tetap 502 penyedia — dan
   * saat penyedia sembuh, permintaan berikutnya LANGSUNG berhasil.
   */
  const refund = await buatPeserta('Bu Refund', { profil: true });
  perilaku = 'destroy';
  hitungan = 0;

  for (let i = 0; i < 4; i += 1) {
    const res = await minta('/api/recommendations', { kode: refund.accessCode, method: 'POST' });
    assert.equal(res.status, 502, `kegagalan ${i + 1} harus tetap galat penyedia, bukan 429 jatah laju`);
    assert.doesNotMatch((await res.json()).error ?? '', /Batas pemakaian AI tercapai/);
  }

  perilaku = 'happy';
  const sembuh = await minta('/api/recommendations', { kode: refund.accessCode, method: 'POST' });
  assert.equal(sembuh.status, 200, 'penyedia sembuh → langsung berhasil, jatah laju tak pernah habis oleh kegagalan');

  const u = await penggunaDisk(refund.id);
  assert.equal((u.events ?? []).filter((e) => e.type === 'recommendations_generated').length, 1);
  assert.equal(u.usage.requests, 1);
});

test('gemini: sambungan yang sudah terjalin lalu putus dengan galat tak berstatus = terpotong 502', async () => {
  /*
   * Simetris dengan pernahTerhubung di claude.js. Tanpa klasifikasi ini,
   * galat iterasi tak berstatus jatuh ke "kesalahan tak terduga" (500) dan
   * jatah laju tidak dikembalikan. Identitas penyedia (ApiError/status)
   * tetap lewat apa adanya untuk describeError.
   */
  const { bacaStream } = await import(`../lib/gemini.js?u=${Math.random()}`);
  const { ApiError } = await import('@google/genai');

  const putusTengah = async function* () {
    yield { text: 'sebagian ' };
    throw new Error('socket hang up');
  };
  await assert.rejects(
    () => bacaStream(async () => putusTengah()),
    (err) => err.code === 'AI_STREAM_TERPOTONG' && err.status === 502,
  );

  // Identitas penyedia TIDAK boleh ditelan klasifikasi.
  const apiError = new ApiError({ message: 'backend error', status: 503 });
  const lewat = async function* () {
    yield { text: 'sebagian ' };
    throw apiError;
  };
  await assert.rejects(() => bacaStream(async () => lewat()), (err) => err === apiError);
});
