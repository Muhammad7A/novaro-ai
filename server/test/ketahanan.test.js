/**
 * Uji regresi untuk kesalahan yang lolos dari semua uji sebelumnya.
 *
 * Setiap berkas uji lain menguji satu hal yang dirancang; berkas ini menguji
 * hal-hal yang RUSAK di lapangan dan tidak tertangkap justru karena tiap uji
 * berjalan sendirian, di proses sendiri, dengan data sendiri. Yang diperiksa di
 * sini adalah sambungan antar bagian: dua proses menulis berkas yang sama,
 * angka negatif yang menempuh perjalanan sampai ke prompt, dan zona waktu yang
 * berpindah antar berkas.
 *
 *   npm test
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'nova-uji-'));
process.env.NOVA_DATA_DIR = DATA_DIR;
process.on('exit', () => rmSync(DATA_DIR, { recursive: true, force: true }));

const DB_PATH = path.join(DATA_DIR, 'users.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backup');

async function bersih() {
  await rm(DATA_DIR, { recursive: true, force: true });
  await mkdir(DATA_DIR, { recursive: true });
}
/** Satu "proses" store dengan cache modulnya sendiri. */
const prosesBaru = async () => (await import(`../lib/store.js?p=${Math.random()}`)).store;

/* ============================================================ Lintas proses */

test('pengguna yang ditambahkan proses lain tidak boleh hilang', async () => {
  await bersih();
  const server = await prosesBaru();
  const cli = await prosesBaru();

  // Server hidup dan sudah memuat datanya.
  const { user: lama } = await server.createUser({ name: 'Peserta Lama' });
  assert.equal((await server.listUsers()).length, 1);

  // Pendamping menjalankan `npm run users -- add` di terminal lain.
  const { accessCode } = await cli.createUser({ name: 'Peserta Baru' });

  // Satu peristiwa apa pun dari server dulu cukup untuk menimpa berkasnya.
  await server.logEvent(lama.id, 'login');

  const disk = JSON.parse(await readFile(DB_PATH, 'utf8'));
  assert.equal(disk.users.length, 2, 'PESERTA HILANG — penulisan server menimpa data dari proses lain');
  assert.ok(
    await server.findByAccessCode(accessCode),
    'kode akses peserta baru harus tetap berlaku; kode hanya ditampilkan sekali dan tidak bisa disusun ulang',
  );
});

test('perubahan dari proses lain langsung terbaca', async () => {
  await bersih();
  const server = await prosesBaru();
  const cli = await prosesBaru();

  const { user } = await server.createUser({ name: 'Bu Sari' });
  await server.listUsers(); // cache server terisi

  const kodeBaru = await cli.resetAccessCode(user.id); // `npm run users -- reset`
  assert.ok(await server.findByAccessCode(kodeBaru), 'server harus melihat kode hasil reset dari proses lain');
});

test('penulisan bersamaan dari banyak proses tidak ada yang hilang', async () => {
  await bersih();
  const proses = await Promise.all([prosesBaru(), prosesBaru(), prosesBaru()]);
  const { user } = await proses[0].createUser({ name: 'Bu Sari' });

  const tugas = [];
  for (let i = 0; i < 15; i++) {
    for (const [n, s] of proses.entries()) {
      tugas.push(
        s.addTransaction(user.id, {
          tanggal: '2026-07-20', jenis: 'masuk', kategori: 'penjualan', jumlah: 1000, keterangan: `p${n}-${i}`,
        }, { aktor: 'manusia' }),
      );
    }
  }
  await Promise.all(tugas);

  const trx = JSON.parse(await readFile(DB_PATH, 'utf8')).users[0].transactions;
  assert.equal(trx.length, 45, 'ada transaksi peserta yang tertimpa');
  assert.equal(new Set(trx.map((t) => t.keterangan)).size, 45, 'ada transaksi yang tertimpa diam-diam');
  assert.equal(existsSync(`${DB_PATH}.lock`), false, 'berkas kunci harus selalu dilepas');
});

test('berkas data yang rusak tidak diam-diam jadi basis data kosong', async () => {
  await bersih();
  await writeFile(DB_PATH, '{ "users": [ {"id":"usr_a"', 'utf8');
  const store = await prosesBaru();

  await assert.rejects(
    () => store.listUsers(),
    'berkas rusak harus melempar galat, BUKAN dibaca sebagai nol pengguna — kalau tidak, peserta berikutnya ditulis ke atas data yang masih bisa dipulihkan',
  );
});

/* =================================================== Angka negatif ke prompt */

test('kerugian sampai utuh ke konteks AI', async () => {
  const { formatRupiah, computeMetrics, metricsToText } = await import('../lib/metrics.js');

  assert.equal(formatRupiah(-2_500_000), '-$2,500,000', 'kerugian tidak boleh jadi $0');
  assert.equal(formatRupiah(0), '$0');
  assert.equal(formatRupiah(2_500_000), '$2,500,000');

  /*
   * Ini yang benar-benar terjadi sebelum diperbaiki: model diberi tahu bahwa
   * usaha ini sedang rugi, sekaligus diberi tahu bahwa ruginya Rp 0 — dan
   * seluruh rancangan aplikasi ini melarangnya menghitung sendiri.
   */
  const m = computeMetrics({
    omzetBulanan: 8_000_000, belanjaBulanan: 6_000_000, biayaOperasional: 4_500_000, pencatatan: 'buku',
  });
  const teks = metricsToText(m);
  assert.match(teks, /Net profit: -\$2,500,000/, 'besarnya kerugian harus terbaca model');
  assert.doesNotMatch(teks, /Net profit: \$0/);
});

test('kerugian bulanan terbaca di riwayat yang dikirim ke AI', async () => {
  const { cashbookContext } = await import('../lib/prompts.js');
  const sekarang = new Date('2026-07-15T05:00:00Z');
  const transaksi = [
    { tanggal: '2026-06-02', jenis: 'masuk', kategori: 'penjualan', jumlah: 1_000_000, createdAt: '2026-06-02T05:00:00Z' },
    { tanggal: '2026-06-03', jenis: 'keluar', kategori: 'operasional', jumlah: 4_000_000, createdAt: '2026-06-03T05:00:00Z' },
  ];
  const { riwayat } = cashbookContext(transaksi, sekarang);
  assert.match(riwayat, /-\$3,000,000/, 'bulan yang merugi harus tampil sebagai angka negatif, bukan $0');
});

/* ============================================================ Cicilan hilang */

test('cicilan di profil tidak lenyap saat buku kas mulai dipakai', async () => {
  const { computeMetrics } = await import('../lib/metrics.js');
  const { summarizeMonth } = await import('../lib/cashbook.js');

  // Sebulan penuh, tercatat rapat, TANPA satu pun transaksi kategori cicilan —
  // persis yang terjadi ketika angsuran dibayar lewat rekening.
  const transaksi = [];
  for (let d = 1; d <= 28; d++) {
    const tgl = `2026-06-${String(d).padStart(2, '0')}`;
    transaksi.push({ tanggal: tgl, jenis: 'masuk', kategori: 'penjualan', jumlah: 500_000, createdAt: `${tgl}T05:00:00Z` });
  }
  const juni = summarizeMonth(transaksi, '2026-06', new Date('2026-07-15T05:00:00Z'));
  const profil = { omzetBulanan: 14_000_000, cicilanBulanan: 1_500_000, pencatatan: 'buku' };

  const m = computeMetrics(profil, juni, juni);
  assert.equal(m.sumber, 'catatan', 'prasyarat: bulan ini memang sudah dipakai sebagai angka nyata');
  assert.equal(m.cicilanSaatIni, 1_500_000, 'utang yang diakui sendiri tidak boleh hilang begitu angka nyata dipakai');
  assert.equal(m.cicilanBelumTercatat, true, 'selisihnya harus ditandai agar bisa dijelaskan ke pengguna');
  assert.ok(m.bebanCicilan > 0, 'beban cicilan tidak boleh mendadak 0%');
});

/* ===================================================== Zona waktu di ekspor */

test('jeda pencatatan tidak pernah negatif untuk catatan subuh', async () => {
  const { tanggalWIB } = await import('../lib/cashbook.js');

  // Dicatat pukul 03.00 WIB tanggal 5 Juli → dalam UTC masih tanggal 4.
  assert.equal(tanggalWIB('2026-07-04T20:00:00.000Z'), '2026-07-05');
  assert.equal(tanggalWIB('2026-07-05T13:00:00.000Z'), '2026-07-05');

  const jeda = (createdAt, tanggal) => Math.round((new Date(tanggalWIB(createdAt)) - new Date(tanggal)) / 86400000);
  assert.equal(jeda('2026-07-04T20:00:00.000Z', '2026-07-05'), 0, 'mencatat subuh sebelum buka bukan "dicatat kemarin"');
  assert.equal(jeda('2026-07-05T13:00:00.000Z', '2026-07-05'), 0);
  assert.equal(jeda('2026-07-06T13:00:00.000Z', '2026-07-05'), 1, 'menyusul sehari harus tetap terhitung 1');
});

/* ================================================================= Cadangan */

test('jepretan pra-pemulihan tidak memakan jatah rotasi cadangan', async () => {
  await bersih();
  const store = await prosesBaru();
  const { listBackups, listSnapshots, restoreBackup, runBackup } = await import(`../lib/backup.js?u=${Math.random()}`);

  await store.createUser({ name: 'Bu Sari' });
  const c1 = await runBackup({ quiet: true });
  await store.createUser({ name: 'Pak Budi' });

  await restoreBackup(c1.file); // menghasilkan satu jepretan

  const cadangan = await listBackups();
  const jepretan = await listSnapshots();

  assert.equal(jepretan.length, 1, 'jepretan sebelum pemulihan harus tetap ada');
  assert.ok(
    cadangan.every((b) => !/sebelum-pulih/.test(b.file)),
    'jepretan tidak boleh ikut terhitung sebagai cadangan berkala — ia memakan jatah rotasi diam-diam',
  );
  assert.ok(
    !/sebelum-pulih/.test(cadangan[0]?.file ?? ''),
    'yang disarankan untuk dipulihkan tidak boleh jepretan pra-pemulihan',
  );
});

test('berkas yang bisa di-parse tapi bukan basis data tidak dicadangkan', async () => {
  await bersih();
  const { runBackup } = await import(`../lib/backup.js?u=${Math.random()}`);

  // JSON yang sah, tapi bukan basis data. Dulu ini disalin sebagai "0 pengguna"
  // dan mendorong keluar satu salinan sehat.
  await writeFile(DB_PATH, '{}', 'utf8');
  assert.equal((await runBackup({ quiet: true })).skipped, 'bukan-basis-data');
  assert.equal(existsSync(BACKUP_DIR), false, 'tidak boleh ada berkas cadangan yang dibuat');
});

/* ================================================= Jawaban AI yang terpotong */

test('jawaban yang berhenti karena kepanjangan ditandai, bukan disimpan diam-diam', async () => {
  const { streamChat } = await import(`../lib/claude.js?u=${Math.random()}`);

  /*
   * Dulu `stop_reason` dikembalikan lalu tidak pernah dibaca siapa pun.
   * Jawaban yang berhenti di tengah kalimat tersimpan ke riwayat dan tampil
   * dengan stempel waktu seolah-olah selesai — pemilik usaha membaca setengah
   * nasihat keuangan tanpa satu pun tanda bahwa ada lanjutannya.
   */
  const { server, url } = await palsuAnthropic('max_tokens');
  process.env.ANTHROPIC_BASE_URL = url;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-uji';
  process.env.NOVA_AI_BACKEND = 'anthropic';
  try {
    const hasil = await streamChat({
      profile: null, metrics: METRIK_KOSONG, history: [], message: 'halo', onText: () => {},
    });
    assert.equal(hasil.terpotong, true, 'jawaban terpotong harus ditandai');
    assert.ok(hasil.text.length > 0, 'bagian yang sudah benar tetap dikembalikan');
  } finally {
    server.close();
    delete process.env.TEST_IGNORE_NOVA_AI_BACKEND;
  }
});


test('penolakan sistem keamanan dilaporkan apa adanya, bukan "kesalahan tak terduga"', async () => {
  const { streamChat } = await import(`../lib/claude.js?u=${Math.random()}`);
  const { server, url } = await palsuAnthropic('refusal');
  process.env.ANTHROPIC_BASE_URL = url;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-uji';
  process.env.NOVA_AI_BACKEND = 'anthropic';
  try {
    await assert.rejects(
      () => streamChat({ profile: null, metrics: METRIK_KOSONG, history: [], message: 'halo', onText: () => {} }),
      (err) => {
        assert.equal(err.status, 422, 'penolakan bukan galat server — jangan 500');
        assert.match(err.message, /ditolak/i);
        return true;
      },
    );
  } finally {
    server.close();
    delete process.env.TEST_IGNORE_NOVA_AI_BACKEND;
  }
});

test('rekomendasi dikirim sebagai aliran, bukan permintaan biasa', async () => {
  /*
   * Jatah 32.000 token dengan penalaran adaptif bisa memakan waktu lebih lama
   * daripada batas waktu permintaan biasa (120 detik). Kegagalan itu yang
   * paling merugikan: peserta sudah menunggu, tokennya sudah terpakai di sisi
   * Anthropic, dan yang dia terima cuma pesan galat. Sambungan yang dialirkan
   * tidak pernah dianggap menggantung selama datanya masih mengalir — jadi
   * `stream: true` di sini bukan hiasan, melainkan syarat dari batas tokennya.
   */
  const { createServer } = await import('node:http');
  let diminta = null;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      diminta = JSON.parse(body || '{}');
      const usage = { input_tokens: 100, output_tokens: 50 };
      const isi = JSON.stringify({ ringkasan: 'x', rekomendasi: [{ judul: 'a', prioritas: 'tinggi', alasan: 'b', langkah: ['c'], dampak: 'd', modulTerkait: 1 }], peringatan: [], targetBulanIni: ['a', 'b', 'c'] });
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const w = (t, d) => res.write(`event: ${t}\ndata: ${JSON.stringify(d)}\n\n`);
      w('message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5', content: [], stop_reason: null, usage } });
      w('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
      w('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: isi } });
      w('content_block_stop', { type: 'content_block_stop', index: 0 });
      w('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage });
      w('message_stop', { type: 'message_stop' });
      res.end();
    });
  });
  await new Promise((r) => server.listen(0, r));

  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-uji';
  process.env.NOVA_AI_BACKEND = 'anthropic';
  try {
    const { generateRecommendations } = await import(`../lib/claude.js?u=${Math.random()}`);
    const { computeMetrics } = await import('../lib/metrics.js');
    const profil = { namaUsaha: 'W', jenisUsaha: 'kuliner', omzetBulanan: 12e6, pencatatan: 'buku', tujuan: 'ajukan-kur' };
    const { data } = await generateRecommendations({ profile: profil, metrics: computeMetrics(profil), cashbook: { riwayat: '', berjalan: '' } });

    assert.equal(diminta.stream, true, 'rekomendasi harus dialirkan — lihat catatan di atas');
    assert.equal(diminta.max_tokens, 32_000);
    assert.equal(diminta.output_config.format.type, 'json_schema', 'skema JSON harus ikut terkirim');
    assert.equal(data.rekomendasi.length, 1, 'JSON hasil aliran harus tetap terbaca utuh');
  } finally {
    server.close();
    delete process.env.TEST_IGNORE_NOVA_AI_BACKEND;
  }
});

const METRIK_KOSONG = {
  sumber: 'perkiraan', omzet: 0, hpp: 0, biaya: 0, labaKotor: 0, labaBersih: 0,
  marginKotor: 0, marginBersih: 0, maxCicilanSehat: 0, cicilanSaatIni: 0,
  skorKesehatan: 0, statusKesehatan: '-', komponenSkor: [], hariTercatat: 0, hariSejakMulai: 0,
};

/** Layanan Anthropic tiruan yang berhenti dengan alasan tertentu. */
async function palsuAnthropic(stopReason) {
  const { createServer } = await import('node:http');
  const usage = { input_tokens: 100, output_tokens: 20 };
  const server = createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const w = (t, d) => res.write(`event: ${t}\ndata: ${JSON.stringify(d)}\n\n`);
      w('message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5', content: [], stop_reason: null, usage } });
      w('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
      w('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Langkah pertama, pisahkan uang' } });
      w('content_block_stop', { type: 'content_block_stop', index: 0 });
      w('message_delta', { type: 'message_delta', delta: { stop_reason: stopReason }, usage });
      w('message_stop', { type: 'message_stop' });
      res.end();
    });
  });
  await new Promise((r) => server.listen(0, r));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

/* ============================================================ Prompt caching */

test('penanda cache hanya dipasang bila awalannya memang cukup panjang', async () => {
  const { chatSystem } = await import('../lib/prompts.js');
  const metrics = { sumber: 'perkiraan', omzet: 0, hpp: 0, biaya: 0, labaKotor: 0, labaBersih: 0,
    marginKotor: 0, marginBersih: 0, maxCicilanSehat: 0, cicilanSaatIni: 0, skorKesehatan: 0,
    statusKesehatan: '-', komponenSkor: [], hariTercatat: 0, hariSejakMulai: 0 };

  // Peserta baru: belum ada bulan yang selesai, jadi awalannya di bawah ambang.
  const baru = chatSystem(null, metrics, { riwayat: '', berjalan: 'BUKU KAS' });
  assert.equal(baru[0].cache_control, undefined, 'penanda cache di bawah ambang tidak berefek apa pun');

  // Peserta dengan riwayat panjang: penanda dipasang.
  const lama = chatSystem(null, metrics, { riwayat: 'RIWAYAT\n' + 'x'.repeat(5000), berjalan: 'BUKU KAS' });
  assert.deepEqual(lama[0].cache_control, { type: 'ephemeral' });
});

test('materi modul benar-benar sampai ke panggilan AI, dan hanya saat diminta', async () => {
  /*
   * Inti dari menggabungkan micro-learning dengan AI: pertanyaan yang diajukan
   * dari dalam sebuah modul dikirim BERSAMA materi modul itu, supaya jawabannya
   * menjelaskan hal yang sama dengan yang sedang dibaca peserta di layar — bukan
   * versi lain dari pengetahuan modelnya sendiri.
   *
   * Diuji di sini, bukan di tingkat prompt saja, karena yang gampang putus
   * adalah SAMBUNGANNYA: satu medan yang lupa diteruskan dari rute ke streamChat
   * membuat seluruh gagasan ini diam-diam tidak berefek apa pun, tanpa satu pun
   * uji yang gagal.
   */
  const { createServer } = await import('node:http');
  let diminta = null;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      diminta = JSON.parse(body || '{}');
      const usage = { input_tokens: 10, output_tokens: 5 };
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const w = (t, d) => res.write(`event: ${t}\ndata: ${JSON.stringify(d)}\n\n`);
      w('message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5', content: [], stop_reason: null, usage } });
      w('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
      w('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } });
      w('content_block_stop', { type: 'content_block_stop', index: 0 });
      w('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage });
      w('message_stop', { type: 'message_stop' });
      res.end();
    });
  });
  await new Promise((r) => server.listen(0, r));

  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-uji';
  process.env.NOVA_AI_BACKEND = 'anthropic';
  try {
    const { streamChat } = await import(`../lib/claude.js?u=${Math.random()}`);
    const { computeMetrics } = await import('../lib/metrics.js');
    const { materiModul, ringkasKemajuan } = await import('../lib/kurikulum.js');
    const profil = { namaUsaha: 'W', jenisUsaha: 'kuliner', omzetBulanan: 12e6, pencatatan: 'buku', tujuan: 'ajukan-kur' };
    const metrics = computeMetrics(profil);
    const dasar = { profile: profil, metrics, cashbook: { riwayat: '', berjalan: '' }, history: [], message: 'apa itu HPP?', onText() {} };

    /*
     * Yang diperiksa adalah ISI modulnya, bukan nama bloknya. PERAN sendiri
     * menyebut "MATERI MODUL YANG SEDANG DIBUKA PESERTA" di dalam instruksinya,
     * jadi mencari kalimat itu akan selalu ketemu — termasuk saat materinya
     * justru tidak dikirim. Kalimat penanda diambil dari isi modul 107.
     */
    const { cariModul } = await import('../lib/kurikulum.js');
    const penanda = cariModul(107).isi.find((s) => s.li)?.li[0];
    assert.ok(penanda, 'modul 7 harus punya butir daftar untuk dijadikan penanda');

    // Dengan konteks modul 107 (month-end close).
    await streamChat({ ...dasar, belajar: { kemajuan: ringkasKemajuan({ 101: true }), materi: materiModul(107) } });
    let sistem = diminta.system.map((b) => b.text).join('\n');
    assert.ok(sistem.includes(penanda), 'isi modul tidak sampai ke API');
    assert.ok(sistem.includes(cariModul(107).praktik), 'praktik modul tidak ikut terkirim');
    assert.match(sistem, /Daily sessions: 1 of 7/, 'kemajuan belajar tidak sampai ke API');

    // Tanpa konteks modul: materi TIDAK boleh ikut. Kalau ia selalu terkirim,
    // anggaran token harian peserta habis dalam dua pertanyaan.
    diminta = null;
    await streamChat({ ...dasar, belajar: { kemajuan: ringkasKemajuan({}) } });
    sistem = diminta.system.map((b) => b.text).join('\n');
    assert.ok(!sistem.includes(penanda), 'isi modul ikut terkirim padahal tidak diminta');
    assert.match(sistem, /Daily sessions: 0 of 7/, 'kemajuan tetap harus ikut pada tiap pertanyaan');
  } finally {
    server.close();
    delete process.env.TEST_IGNORE_NOVA_AI_BACKEND;
  }
});

/* ========================================== Pesan galat yang sampai ke peserta */

/*
 * Pasangan uji ini menjaga describeError dari SISI DALAM. Bahwa rute chat
 * benar-benar memakainya — bagian yang dulu rusak — dijaga di rute.test.js;
 * uji yang memanggil describeError sendiri akan tetap lulus meski pemanggilnya
 * kembali menyaring `err.status` lebih dulu.
 */

test('galat buatan aplikasi sendiri tetap dilewatkan apa adanya', async () => {
  /*
   * Sisi lain dari uji di atas. Cabang `err.status` di describeError ada DI
   * BAWAH cabang-cabang SDK, dan tugasnya menjaga kalimat yang memang sudah
   * ditulis untuk peserta (penolakan 422, jawaban terpotong 502) supaya tidak
   * tertukar dengan "Terjadi kesalahan tak terduga di server."
   */
  const { describeError } = await import(`../lib/claude.js?u=${Math.random()}`);
  const buatan = new Error('Pertanyaan ini ditolak oleh sistem keamanan AI.');
  buatan.status = 422;
  assert.deepEqual(describeError(buatan), { status: 422, message: buatan.message });
});

test('kunci contoh dari .env.example tidak boleh dianggap terpasang', async () => {
  /*
   * `.env` yang disalin dari `.env.example` tapi kuncinya lupa diganti dulu
   * lolos pemeriksaan "tidak kosong": banner saat start menulis "terpasang",
   * /api/login mengirim aiConfigured: true, dan aplikasi menampilkan Konsultan
   * AI seolah siap dipakai. Kesalahannya baru terlihat saat peserta pertama
   * bertanya — jauh dari tempat asalnya.
   */
  const { isConfigured } = await import(`../lib/claude.js?u=${Math.random()}`);
  const asli = process.env.ANTHROPIC_API_KEY;
  /*
   * Jalur Vertex membuat isConfigured() selalu true — kalau variabel ini bocor
   * dari lingkungan (Cloud Build, laptop yang pernah dipakai gcloud), seluruh
   * uji di bawah lulus tanpa membuktikan apa pun.
   */
  const asliProject = process.env.GOOGLE_CLOUD_PROJECT;
  delete process.env.GOOGLE_CLOUD_PROJECT;
  try {
    const contoh = (await readFile(new URL('../.env.example', import.meta.url), 'utf8'))
      .match(/^ANTHROPIC_API_KEY=(.*)$/m)?.[1]?.trim();
    assert.ok(contoh, '.env.example harus memuat baris ANTHROPIC_API_KEY');

    process.env.ANTHROPIC_API_KEY = contoh;
    assert.equal(isConfigured(), false, 'nilai contoh tidak boleh lolos sebagai kunci sungguhan');

    process.env.ANTHROPIC_API_KEY = '   ';
    assert.equal(isConfigured(), false, 'kunci kosong tetap harus ditolak');

    process.env.ANTHROPIC_API_KEY = `sk-ant-api03-${'A1b2C3d4'.repeat(11)}`;
    assert.equal(isConfigured(), true, 'kunci sungguhan harus tetap diterima');
  } finally {
    process.env.ANTHROPIC_API_KEY = asli;
    if (asliProject === undefined) delete process.env.GOOGLE_CLOUD_PROJECT;
    else process.env.GOOGLE_CLOUD_PROJECT = asliProject;
  }
});

test('backendAI memilih Vertex hanya bila GOOGLE_CLOUD_PROJECT benar-benar terisi', async () => {
  const { backendAI, isConfigured } = await import(`../lib/claude.js?u=${Math.random()}`);
  const asliProject = process.env.GOOGLE_CLOUD_PROJECT;
  const asliKunci = process.env.ANTHROPIC_API_KEY;
  try {
    process.env.TEST_IGNORE_NOVA_AI_BACKEND = '1';
    delete process.env.GOOGLE_CLOUD_PROJECT;
    assert.equal(backendAI(), 'anthropic', 'tanpa project harus tetap ke Anthropic langsung');

    // Spasi belaka bukan project. Tanpa .trim() nilai ini akan memilih Vertex,
    // lalu gagal di panggilan pertama dengan galat yang tidak menyebut sebabnya.
    process.env.GOOGLE_CLOUD_PROJECT = '   ';
    assert.equal(backendAI(), 'anthropic', 'project berisi spasi tidak boleh memilih Vertex');

    process.env.GOOGLE_CLOUD_PROJECT = 'project-nyata-123';
    assert.equal(backendAI(), 'vertex');

    // Di jalur Vertex tidak ada kunci untuk diperiksa; kunci contoh sekalipun
    // tidak boleh membuat layanan dianggap belum siap.
    process.env.ANTHROPIC_API_KEY = 'sk-ant-xxxxxxxx';
    assert.equal(isConfigured(), true, 'jalur Vertex tidak bergantung pada kunci API');
  } finally {
    if (asliProject === undefined) delete process.env.GOOGLE_CLOUD_PROJECT;
    else process.env.GOOGLE_CLOUD_PROJECT = asliProject;
    process.env.ANTHROPIC_API_KEY = asliKunci;
    delete process.env.TEST_IGNORE_NOVA_AI_BACKEND;
  }
});

test('kredensial Google yang gagal tidak boleh tampil sebagai gangguan jaringan', async () => {
  /*
   * Kredensial ADC yang hilang, kedaluwarsa, atau tanpa peran
   * roles/aiplatform.user datang dari SDK sebagai APIConnectionError — kelas
   * yang sama persis dengan kabel jaringan putus. Tanpa cabang khusus, yang
   * dibaca pendamping adalah "periksa koneksi internet server", dan berjam-jam
   * habis mengejar jaringan untuk sesuatu yang sebenarnya satu baris IAM.
   *
   * Bentuk galat di sini bukan karangan: ia disalin dari galat sungguhan yang
   * dilempar @anthropic-ai/vertex-sdk saat dipanggil tanpa kredensial.
   */
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const { describeError } = await import(`../lib/claude.js?u=${Math.random()}`);

  const galatKredensial = new Anthropic.APIConnectionError({
    message: 'Failed to acquire Google OAuth credentials.',
  });
  const hasil = describeError(galatKredensial);
  assert.equal(hasil.status, 503);
  assert.match(hasil.message, /kredensial Google Cloud/i);
  assert.doesNotMatch(hasil.message, /koneksi internet/i, 'jangan menuduh jaringan');

  // Gangguan jaringan sungguhan harus TETAP memakai pesan lamanya.
  const galatJaringan = new Anthropic.APIConnectionError({ message: 'Connection error.' });
  const hasilJaringan = describeError(galatJaringan);
  assert.equal(hasilJaringan.status, 502);
  assert.match(hasilJaringan.message, /koneksi internet/i);
});
