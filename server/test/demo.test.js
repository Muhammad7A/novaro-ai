/**
 * Uji data demo: generator, hidrasi saat start, dan rute /api/demo.
 *
 * Akun demo adalah wajah aplikasi bagi juri dan calon pendamping — ujian
 * terpentingnya bukan "apakah menghasilkan data", melainkan "apakah data itu
 * sah menurut seluruh pemeriksaan yang akan dikenakan padanya": kategori yang
 * dikenal, tanggal yang tidak melampaui hari ini, bentuk rekomendasi yang
 * persis seperti skema, dan — di atas semuanya — bahwa peserta penelitian
 * B1/B2 tidak pernah tersentuh.
 *
 *   npm test
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'nova-uji-demo-'));
process.env.NOVA_DATA_DIR = DATA_DIR;
process.env.PORT = '0';
process.on('exit', () => rmSync(DATA_DIR, { recursive: true, force: true }));

const { store } = await import('../lib/store.js');
const { CONSENT_VERSION } = await import('../lib/consent.js');
const { isValidKategori, tanggalWIB } = await import('../lib/cashbook.js');
const { KODE_DEMO, PERSONA_DEMO, personaDemo, isiDemoPenuh, lanjutkanDemo, ringkasBulan } = await import('../lib/demo-data.js');
const modul = await import('../lib/kurikulum.js');

/* ================================================== Generator (murni) */

test('setiap persona menghasilkan riwayat yang sah untuk seluruh pemeriksaan kas', () => {
  const hariIni = tanggalWIB();
  for (const persona of PERSONA_DEMO) {
    const d = isiDemoPenuh(persona, hariIni);
    assert.ok(d.transactions.length > 100, `${persona.nama}: terlalu sedikit transaksi (${d.transactions.length})`);
    for (const t of d.transactions) {
      assert.ok(t.tanggal <= hariIni, `${persona.nama}: transaksi di masa depan ${t.tanggal}`);
      assert.ok(t.tanggal >= d.transactions[0].tanggal, 'tanggal sebelum awal riwayat');
      assert.ok(isValidKategori(t.jenis, t.kategori), `${persona.nama}: kategori asing ${t.jenis}/${t.kategori}`);
      assert.ok(Number.isFinite(t.jumlah) && t.jumlah > 0, 'jumlah harus positif');
      assert.ok(t.keterangan.length > 0 && t.keterangan.length <= 120, 'keterangan kosong/kepanjangan');
    }
    // Ada penjualan DI HARI INI — demo yang menua adalah demo yang lupa hari ini.
    assert.ok(d.transactions.some((t) => t.tanggal === hariIni && t.kategori === 'penjualan'), `${persona.nama}: tidak ada penjualan hari ini`);
    assert.equal(d.consent.versi, CONSENT_VERSION);
    assert.ok(d.mulaiPada <= hariIni);
  }
});

test('generator deterministik — akun yang sama menghasilkan angka yang sama', () => {
  const hariIni = '2026-08-30';
  const a = isiDemoPenuh(PERSONA_DEMO[0], hariIni);
  const b = isiDemoPenuh(PERSONA_DEMO[0], hariIni);
  assert.deepEqual(a.transactions, b.transactions);
  assert.deepEqual(a.recommendations.targetBulanIni, b.recommendations.targetBulanIni);
});

test('ekonomi persona masuk akal: laba positif, margin 10–60 persen', () => {
  const hariIni = tanggalWIB();
  for (const persona of PERSONA_DEMO) {
    const d = isiDemoPenuh(persona, hariIni);

    /*
     * Ekonomi dinilai di bulan yang SUDAH HABIS, bukan bulan berjalan.
     * Hari-hari pertama bulan otomatis dipenuhi biaya tetap kepala bulan
     * (upah mingguan, listrik tgl 1) sehingga margin bulan berjalan sempit —
     * itu artefak kalender penempatan biaya, bukan ekonomi persona yang
     * sedang diuji. Riwayat 92 hari selalu memuat minimal satu bulan penuh.
     */
    const bulanBerjalan = hariIni.slice(0, 7);
    const bulanUji = [...new Set(d.transactions.map((t) => t.tanggal.slice(0, 7)))]
      .filter((b) => b !== bulanBerjalan)
      .sort()
      .pop();
    assert.ok(bulanUji, persona.nama + ': riwayat harus memuat bulan lengkap');
    const r = ringkasBulan(d.transactions, bulanUji);
    assert.ok(r.penjualan > 1_000_000, `${persona.nama}: omzet bulan terlalu kecil`);
    assert.ok(r.laba > 0, `${persona.nama}: demo tidak boleh rugi`);
    assert.ok(r.margin >= 10 && r.margin <= 60, `${persona.nama}: margin ${r.margin.toFixed(1)}% di luar rentang wajar`);
  }
});

test('rekomendasi mengikuti bentuk skema persis', () => {
  const PRIORITAS = ['tinggi', 'sedang', 'rendah'];
  const d = isiDemoPenuh(PERSONA_DEMO[1], '2026-08-30');
  const rec = d.recommendations;
  assert.equal(typeof rec.ringkasan, 'string');
  assert.ok(rec.rekomendasi.length >= 3 && rec.rekomendasi.length <= 5);
  for (const r of rec.rekomendasi) {
    assert.ok(r.judul && PRIORITAS.includes(r.prioritas) && r.alasan);
    assert.ok(Array.isArray(r.langkah) && r.langkah.length >= 2 && r.langkah.length <= 4);
    assert.ok(r.dampak && modul.nomorModulSah(r.modulTerkait));
  }
  assert.ok(Array.isArray(rec.peringatan));
  assert.equal(rec.targetBulanIni.length, 3);
});

test('progres hanya memuat modul yang sah dan jumlah sesi persona-nya', () => {
  for (const persona of PERSONA_DEMO) {
    const d = isiDemoPenuh(persona, '2026-08-30');
    const sesi = modul.KURIKULUM.filter((k) => k.sesi != null);
    const selesaiSesi = sesi.filter((k) => d.progress.done[k.no]).length;
    assert.equal(selesaiSesi, persona.sesiSelesai, `${persona.nama}: jumlah sesi selesai tidak sesuai`);
    for (const no of Object.keys(d.progress.done)) assert.ok(modul.nomorModulSah(no));
  }
});

test('personaDemo menolak yang bukan akun DEMO', () => {
  assert.equal(personaDemo({ id: 'x', batch: 'B1' }), null);
  assert.equal(personaDemo(null), null);
  assert.ok(personaDemo({ id: 'apapun', batch: 'DEMO' }));
});

test('lanjutkanDemo tidak menyentuh riwayat lama dan berhenti di hari ini', () => {
  const hariIni = tanggalWIB();
  const p = PERSONA_DEMO[0];
  const awal = isiDemoPenuh(p, hariIni);
  // Tidak ada yang perlu dilanjutkan pada hari yang sama.
  assert.equal(lanjutkanDemo(p, { ...awal, demoMeta: awal.demoMeta }, hariIni), null);

  // Simulasi server yang lama tidak menyala: transaksi terakhir 5 hari lalu
  // DAN penanda hidrasinya juga tertinggal di sana.
  const potong = awal.transactions.slice(0, -5);
  const basi = {
    ...awal,
    transactions: potong,
    demoMeta: { ...awal.demoMeta, generatedHingga: potong.at(-1).tanggal },
  };
  const lanjut = lanjutkanDemo(p, basi, hariIni);
  assert.ok(lanjut);
  assert.equal(lanjut.transactions.at(-1).tanggal, hariIni);
  // Riwayat lama tidak diubah — hanya ditambah.
  assert.deepEqual(lanjut.transactions.slice(0, potong.length), potong);
});

/* ============================================ Hidrasi & rute (lapisan HTTP) */

const app = (await import('../server.js')).default;
const { pastikanDemoSiap } = await import('../server.js');

const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const BASE = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const minta = (jalur, { kode, ...opts } = {}) =>
  fetch(BASE + jalur, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(kode ? { Authorization: `Bearer ${kode}` } : {}),
      ...(opts.headers ?? {}),
    },
  });

test('sebelum ada akun demo terisi, /api/demo menjawab 503 yang menjelaskan', async () => {
  const res = await minta('/api/demo', { method: 'POST' });
  assert.equal(res.status, 503);
  const data = await res.json();
  assert.match(data.error, /belum siap/i);
});

test('hidrasi mengisi akun DEMO tanpa menyentuh peserta penelitian', async () => {
  const demoA = await store.createUser({ name: 'Demo A', business: '', batch: 'DEMO' });
  const demoB = await store.createUser({ name: 'Demo B', business: '', batch: 'DEMO' });
  const peserta = await store.createUser({ name: 'Peserta Asli', business: 'Warung', batch: 'B1' });

  /*
   * Rute /api/demo hanya membagikan kode yang tercantum di KODE_DEMO — dua
   * akun uji ini dipasangkan ke dua kode pertama, seperti akun demo
   * sungguhan di produksi. Format numerik 101–120 sah untuk setAccessCode.
   */
  assert.ok(await store.setAccessCode(demoA.user.id, KODE_DEMO[0]));
  assert.ok(await store.setAccessCode(demoB.user.id, KODE_DEMO[1]));
  // Format yang salah ditolak keras — kode yang salah bentuk tidak pernah
  // bisa dicocokkan, dan kegagalannya justru paling sulit dicari.
  assert.equal(await store.setAccessCode(demoA.user.id, 'bukan-kode'), false);

  /*
   * Hidrasi sekaligus PENYEDIAAN: kode 101–120 dipastikan terikat (dua kode
   * pertama sudah dipakai akun uji, sisanya membuat akun baru), lalu semua
   * akun DEMO diisi. B1 tidak pernah tersentuh.
   */
  const siap = await pastikanDemoSiap();
  assert.equal(siap, KODE_DEMO.length);

  const a = await store.findUserById(demoA.user.id);
  const p = await store.findUserById(peserta.user.id);
  assert.ok(a.profile, 'akun demo belum terisi');
  assert.ok(a.transactions.length > 100);
  assert.equal(a.demoMeta.generatedHingga, tanggalWIB());
  assert.ok(a.consent, 'akun demo harus sudah menyetujui — jangan minta lagi');
  assert.equal(p.profile ?? null, null, 'peserta penelitian TIDAK boleh tersentuh');
  assert.equal((p.transactions ?? []).length, 0);

  // Hidrasi kedua kali: idempoten, tidak menambah transaksi apa pun.
  await pastikanDemoSiap();
  const a2 = await store.findUserById(demoA.user.id);
  assert.equal(a2.transactions.length, a.transactions.length);
});

test('/api/demo menyerahkan sesi sah — kode bisa dipakai sebagai Bearer', async () => {
  const res = await minta('/api/demo', { method: 'POST' });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.demo, true);
  assert.ok(data.code, 'kode akses harus ikut agar peramban bisa menyimpannya');
  assert.ok(data.user.profile, 'akun demo yang dipilih harus sudah terisi');
  assert.equal(data.consent, null, 'persetujuan demo tidak diminta dua kali');

  const saya = await minta('/api/me', { kode: data.code });
  assert.equal(saya.status, 200);
  const isi = await saya.json();
  assert.ok(isi.metrics, 'akun demo harus punya metrik');
  assert.ok(isi.user.progress && Object.keys(isi.user.progress.done ?? {}).length > 0);
  // Kode B1/B2 tidak pernah dibagikan lewat sini.
  const semua = await store.listUsers();
  const kodeDibagikan = semua.find((u) => u.batch !== 'DEMO' && u.id === data.user.id);
  assert.equal(kodeDibagikan, undefined);
});

test('rotasi membagi beberapa akun demo secara bergantian', async () => {
  const pertama = await (await minta('/api/demo', { method: 'POST' })).json();
  const kedua = await (await minta('/api/demo', { method: 'POST' })).json();
  assert.notEqual(pertama.user.id, kedua.user.id, 'dua permintaan beruntun harus ke akun berbeda');
});

test('pembatas demo menolak penebakan tanpa henti', async () => {
  /*
   * Jumlah tepatnya tidak disebut keras di sini: beberapa permintaan demo
   * sebelumnya di berkas uji ini ikut dihitung pembatas (satu jendela per
   * proses). Yang diuji adalah sifatnya: masih lega di awal, pasti menolak
   * jauh sebelum menjadi beban, dan penolakannya menjelaskan diri.
   */
  const status = [];
  for (let i = 0; i < 30; i += 1) {
    const res = await minta('/api/demo', { method: 'POST' });
    status.push(res.status);
    if (res.status === 429) break;
  }
  assert.equal(status[0], 200);
  assert.ok(status.includes(429), 'harus menolak sebelum 30 permintaan beruntun');
});

test('KODE_DEMO: dua puluh kode numerik 101–120 berurutan', () => {
  assert.equal(KODE_DEMO.length, 20);
  KODE_DEMO.forEach((kode, i) => {
    assert.equal(kode, String(101 + i), `urutan ke-${i} harusnya kode ${101 + i}`);
    assert.match(kode, /^\d{3}$/);
  });
});

/* ============================================ Kode demo 101–120 lewat /api/login */

/*
 * Seluruh matriks diminta tugas: tiap kode 101–120 harus menghasilkan
 * login SUKSES lewat rute /api/login yang sama dengan peserta, dan token
 * Bearer-nya (kodenya sendiri) harus membuka sesi sah di /api/me.
 *
 * Login BERHASIL tidak mengisi pembatas percobaan (yang dihitung hanya
 * kegagalan), jadi dua puluh login beruntun aman dijalankan di sini.
 */
test('seluruh kode 101–120 berhasil login dan membuka sesi terautentikasi', async () => {
  const idTerenang = new Set();
  for (const kode of KODE_DEMO) {
    const res = await minta('/api/login', { method: 'POST', body: JSON.stringify({ code: kode }) });
    assert.equal(res.status, 200, `kode ${kode} harus berhasil login`);
    const data = await res.json();
    assert.ok(data.user?.id, `kode ${kode}: sesi harus membawa identitas`);
    assert.ok(data.user.profile, `kode ${kode}: akun demo harus sudah terisi data`);
    assert.equal(data.consent, null, `kode ${kode}: persetujuan tidak diminta ulang`);
    assert.ok(data.metrics, `kode ${kode}: metrik keuangan harus terisi`);

    idTerenang.add(data.user.id);

    // Token = kode itu sendiri: panggilan berikutnya harus sah.
    const saya = await minta('/api/me', { kode });
    assert.equal(saya.status, 200, `Bearer ${kode} harus membuka sesi`);
    const isi = await saya.json();
    assert.equal(isi.user.id, data.user.id, 'sesi harus akun yang sama dengan login');
  }
  assert.equal(idTerenang.size, 20, 'dua puluh kode harus dua puluh akun berbeda');
});

test('kode contoh dari daftar tugas: 101, 105, 110, 115, 120 masing-masing masuk', async () => {
  for (const kode of ['101', '105', '110', '115', '120']) {
    const res = await minta('/api/login', { method: 'POST', body: JSON.stringify({ code: kode }) });
    assert.equal(res.status, 200, `kode ${kode} gagal`);
  }
});

test('kode 999 tidak dikenal: ditolak seperti kode peserta asing', async () => {
  const res = await minta('/api/login', { method: 'POST', body: JSON.stringify({ code: '999' }) });
  assert.equal(res.status, 401);
  const data = await res.json();
  assert.ok(data.error, 'penolakan harus menyertakan pesan yang bisa dibaca');
});

test('kode kosong: ditolak, tanpa membocorkan apa pun', async () => {
  const res = await minta('/api/login', { method: 'POST', body: JSON.stringify({ code: '' }) });
  assert.equal(res.status, 401);
});

test('login peserta penelitian dengan kode NOVA tetap bekerja seperti sebelumnya', async () => {
  const { user, accessCode } = await store.createUser({ name: 'Peserta Masih Ada', business: 'Warung Tetap', batch: 'B2' });
  const res = await minta('/api/login', { method: 'POST', body: JSON.stringify({ code: accessCode }) });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.user.id, user.id);
  assert.match(accessCode, /^NOVA-/, 'kode peserta tetap berformat NOVA');
});

test('akun demo tidak saling membuka dan tidak melihat data peserta', async () => {
  const login101 = await minta('/api/login', { method: 'POST', body: JSON.stringify({ code: '101' }) }).then((r) => r.json());
  const login102 = await minta('/api/login', { method: 'POST', body: JSON.stringify({ code: '102' }) }).then((r) => r.json());
  assert.notEqual(login101.user.id, login102.user.id, 'kode berbeda = akun berbeda');

  // Ekspor data (unduh milik sendiri) hanya berisi akun pemilik token:
  // yang diuji identitas pemiliknya, bukan isi angkanya — ID transaksi
  // memang dihash dari isi, jadi dua akun sepola bisa sah ber-ID sama.
  const milik101 = await minta('/api/my-data', { kode: '101' }).then((r) => r.json());
  const dilihat102 = await minta('/api/my-data', { kode: '102' }).then((r) => r.json());
  assert.equal(milik101.id, login101.user.id);
  assert.equal(dilihat102.id, login102.user.id);

  // Dan peserta sungguhan tidak pernah bisa dijamah kode demo.
  const { user: peserta } = await store.createUser({ name: 'P', business: '', batch: 'B1' });
  await store.addTransaction(peserta.id, { tanggal: tanggalWIB(), jenis: 'masuk', kategori: 'penjualan', keterangan: 'trx rahasia', jumlah: 999999 });
  const curi = await minta('/api/me', { kode: '101' }).then((r) => r.json());
  assert.notEqual(curi.user.id, peserta.id);
  assert.ok(!JSON.stringify(curi).includes('trx rahasia'), 'kode demo tidak boleh melihat data peserta');
});

/*
 * INVARIANT demo-ready: TIDAK ADA akun demo yang hanya berupa "akun bisa
 * masuk tetapi isinya kosong". Juri yang mengetik 106 tak boleh menerima
 * dasbor kosong — jadi setelah hidrasi, SETIAP kode 101–120 wajib punya
 * pembukuan berpemasukan dan berpengeluaran, metrik berskor, rekomendasi,
 * riwayat konsultasi, dan progres kelas. Uji ini penggembosnya: kalau satu
 * saja akun menjadi kosong karena perubahan mana pun, uji ini yang berteriak.
 */
test('seluruh 20 akun demo terisi penuh — siap dipertunjukkan tanpa diisi dulu', async () => {
  const { computeMetrics } = await import('../lib/metrics.js');
  for (const kode of KODE_DEMO) {
    const u = await store.findByAccessCode(kode);
    assert.ok(u, `kode ${kode}: akun tidak ditemukan`);
    assert.ok(u.profile, `kode ${kode}: profil usaha kosong`);

    const trx = u.transactions ?? [];
    const masuk = trx.filter((t) => t.jenis === 'masuk');
    const keluar = trx.filter((t) => t.jenis === 'keluar');
    assert.ok(trx.length >= 50, `kode ${kode}: hanya ${trx.length} transaksi`);
    assert.ok(masuk.length > 0 && masuk.some((t) => t.jumlah > 0), `kode ${kode}: tidak ada pemasukan`);
    assert.ok(keluar.length > 0 && keluar.some((t) => t.jumlah > 0), `kode ${kode}: tidak ada pengeluaran`);

    // Metrik persis seperti yang dihitung rute: profil + ringkasan bulan ini.
    const { summarizeMonth } = await import('../lib/cashbook.js');
    const ringkasan = summarizeMonth(trx, tanggalWIB());
    const m = computeMetrics(u.profile, null, ringkasan);
    assert.ok(Number.isFinite(m.skorKesehatan) && m.skorKesehatan > 0, `kode ${kode}: skor kesehatan kosong`);
    assert.ok(m.omzet > 0, `kode ${kode}: omzet kosong`);

    assert.ok((u.recommendations?.rekomendasi ?? []).length >= 3, `kode ${kode}: rekomendasi kosong`);
    assert.ok((u.chat ?? []).length >= 2, `kode ${kode}: riwayat konsultasi kosong`);
    assert.ok(Object.keys(u.progress?.done ?? {}).length > 0, `kode ${kode}: progres kelas kosong`);
  }
});
