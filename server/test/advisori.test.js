/**
 * Uji memori advisori — riwayat nasihat yang append-only (Sesi G, fase 1).
 *
 * Yang dijaga di sini:
 *   - write-through: rekomendasi yang tersimpan juga direkam sebagai advisori
 *     dalam SATU penulisan — slot `user.recommendations` dan seluruh konsumennya
 *     (/api/me, fokus aturan 7, kartu) tidak berubah perilaku;
 *   - checkup tercatat di bawah sanitizer yang sama, tanpa menyentuh slot mana pun;
 *   - provenansi warisan Sesi D: `model` hanya ikut bila benar-benar diketahui;
 *   - no-retrofit: pengguna lama tanpa `advisori`/`featureVersions` tetap utuh;
 *   - trim per jenis ter-pin (plafon toko satu-berkas), yang tertua yang pergi;
 *   - gagal flush = TIDAK ADA yang ter-append, kebenaran tetap di disk
 *     (disiplin kegagalan.test.js, seam EISDIR/EPERM di jalur tmp flush);
 *   - demo tidak menciptakan riwayat — ruang pamer tetap ruang pamer;
 *   - evaluasiAdvisori murni dan gagal-aman: sebagian bulan tidak pernah
 *     dibandingkan dengan bulan penuh (disiplin setara).
 *
 *   npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'nova-uji-advisori-'));
process.env.NOVA_DATA_DIR = DATA_DIR;
process.env.PORT = '0';
process.env.NOVA_AI_BACKEND = 'anthropic';
process.env.ANTHROPIC_API_KEY = '';
delete process.env.GOOGLE_CLOUD_PROJECT;
process.on('exit', () => rmSync(DATA_DIR, { recursive: true, force: true }));

const { store } = await import('../lib/store.js');
const { sanitasiRekomendasi } = await import('../lib/rekomendasi.js');
const { sanitasiCheckup } = await import('../lib/checkup.js');
const {
  buatAdvisori, digestDasarAngka, evaluasiAdvisori, evaluasiTertunda,
  bulanCheckpoint, EVALUASI_MAKS, MAKS_PER_JENIS,
} = await import('../lib/advisori.js');
const { CONSENT_VERSION } = await import('../lib/consent.js');

/** Kebenaran disk — bukan isi cache: baca users.json langsung. */
const penggunaDisk = async (id) => {
  const raw = JSON.parse(readFileSync(path.join(DATA_DIR, 'users.json'), 'utf8'));
  return raw.users.find((u) => u.id === id);
};

/** Keluaran sanitasiRekomendasi yang sah — satu-satunya bentuk yang boleh masuk. */
const rekomendasiBersih = () => sanitasiRekomendasi({
  ringkasan: 'Laba bulan ini sehat, tapi prive mendekati laba.',
  rekomendasi: [{
    judul: 'Rapikan pemisahan uang usaha',
    prioritas: 'tinggi',
    alasan: 'Prive bulan ini hampir menyamai laba bersih.',
    langkah: ['Tentukan prive tetap mingguan', 'Catat setiap pengambilan'],
    dampak: 'Kas usaha tidak terkikis diam-diam.',
    modulTerkait: 23,
  }],
  peringatan: ['Prive hampir menyamai laba bersih bulan ini.'],
  targetBulanIni: ['Tetapkan prive mingguan'],
});
// Bentuk usage asli dari penyedia: snake_case — bentuk yang dibaca catatUsage.
const USAGE = { input_tokens: 10, output_tokens: 5 };

/* --------------------------------------------------- Write-through rekomendasi */

test('write-through: rekomendasi tersimpan juga sebagai advisori — slot tak berubah', async () => {
  const { user } = await store.createUser({ name: 'Bu Advi', business: 'Warung Advi', batch: 'B1' });
  await store.saveConsent(user.id, CONSENT_VERSION);
  const bersih = rekomendasiBersih();

  await store.simpanRekomendasi(user.id, bersih, USAGE, { model: 'gemini-2.5-flash' });

  const u = await store.findUserById(user.id);
  assert.equal(u.advisori.length, 1);
  const a = u.advisori[0];
  assert.match(a.id, /^adv_[0-9a-f]{12}$/);
  assert.equal(a.jenis, 'rekomendasi');
  assert.equal(a.sumber, 'ai');
  assert.equal(a.model, 'gemini-2.5-flash');
  // Isi = keluaran sanitizer PERSIS — bukan slot berstempel.
  assert.deepEqual(a.isi, bersih);
  for (const stempel of ['generatedAt', 'sumber', 'model']) {
    assert.ok(!(stempel in a.isi), `stempel "${stempel}" tidak boleh tersalin ke dalam isi`);
  }
  // Jendela berlaku = dibuat + 30 hari, persis.
  assert.equal(Date.parse(a.berlakuHingga) - Date.parse(a.dibuat), 30 * 86_400_000);
  // Dasar angka adalah sidik, bukan salinan.
  assert.match(a.dasarAngka.bulan, /^\d{4}-\d{2}$/);
  assert.match(a.dasarAngka.hash, /^sha256:[0-9a-f]{64}$/);

  // Slot lama tetap persis bentuknya: generatedAt, sumber, model, isi sanitizer.
  assert.equal(u.recommendations.ringkasan, bersih.ringkasan);
  assert.equal(u.recommendations.sumber, 'ai');
  assert.equal(u.recommendations.model, 'gemini-2.5-flash');
  assert.ok(u.recommendations.generatedAt);

  // Konsumen slot tidak melihat memori: publicUser tidak membocorkannya.
  const pub = store.publicUser(u);
  assert.ok(!('advisori' in pub), 'riwayat advisori tidak boleh bocor ke proyeksi publik');
  assert.ok(!('featureVersions' in pub), 'stempel skema tidak boleh bocor ke proyeksi publik');

  // Eventnya contentless: tiga medan tertutup, tanpa nominal, tanpa teks.
  const ev = u.events.filter((e) => e.type === 'advisori_dibuat');
  assert.equal(ev.length, 1);
  assert.deepEqual(ev[0].meta, { id: a.id, jenis: 'rekomendasi', sumber: 'ai' });
});

test('satu penulisan: usage, slot, dan advisori berangkat bersama', async () => {
  const { user } = await store.createUser({ name: 'Bu Satu', business: 'Warung Satu', batch: 'B1' });
  await store.saveConsent(user.id, CONSENT_VERSION);
  await store.simpanRekomendasi(user.id, rekomendasiBersih(), USAGE, { model: 'm-1' });

  const disk = await penggunaDisk(user.id);
  assert.equal(disk.usage.requests, 1);
  assert.equal(disk.usage.inputTokens, 10);
  assert.equal(disk.advisori.length, 1, 'advisori ikut penulisan yang sama, bukan penulisan kedua');
  assert.ok(disk.recommendations, 'slot tersimpan dalam flush yang sama');
});

/* ------------------------------------------------------------------- Checkup */

test('checkup tercatat: sanitizer sama, tanpa slot, usage dalam satu penulisan', async () => {
  const { user } = await store.createUser({ name: 'Bu Cek', business: 'Warung Cek', batch: 'B1' });
  await store.saveConsent(user.id, CONSENT_VERSION);
  const hasil = sanitasiCheckup({
    item: [{ tipe: 'perhatian', teks: 'Prive bulan ini tinggi.' }, { tipe: 'ok', teks: 'Ritme mencatat rapat.' }],
    insight: 'Pertahankan ritme mencatat, atur prive mingguan.',
  });

  const rekam = await store.simpanCheckup(user.id, hasil, USAGE, { model: 'claude-sonnet-4-5' });

  const u = await store.findUserById(user.id);
  const a = u.advisori.find((x) => x.id === rekam.id);
  assert.ok(a, 'rekam yang dikembalikan adalah yang tersimpan');
  assert.equal(a.jenis, 'checkup');
  assert.deepEqual(a.isi, hasil);
  assert.equal(a.model, 'claude-sonnet-4-5');
  assert.equal(u.usage.requests, 1, 'usage ikut penulisan yang sama');
  // Checkup tidak menyentuh slot rekomendasi.
  assert.equal(u.recommendations, null);
  const ev = u.events.find((e) => e.type === 'advisori_dibuat');
  assert.deepEqual(ev.meta, { id: a.id, jenis: 'checkup', sumber: 'ai' });
});

test('tanpa identitas model: medan model tidak pernah dikarang', async () => {
  const { user } = await store.createUser({ name: 'Bu Tanpa', business: 'Warung Tanpa', batch: 'B1' });
  await store.saveConsent(user.id, CONSENT_VERSION);

  await store.simpanRekomendasi(user.id, rekomendasiBersih(), USAGE); // tanpa provensi
  await store.simpanCheckup(user.id, sanitasiCheckup({ item: [{ tipe: 'ok', teks: 'x' }], insight: 'y' }), USAGE);

  const u = await store.findUserById(user.id);
  assert.equal(u.advisori.length, 2);
  for (const a of u.advisori) {
    assert.ok(!('model' in a), 'model yang tidak diketahui tidak boleh direkam sebagai sesuatu');
    assert.equal(a.sumber, 'ai');
  }
});

/* ---------------------------------------------------------------------- Demo */

test('hidrasi demo tidak menciptakan advisori — ruang pamer tetap ruang pamer', async () => {
  const { user } = await store.createUser({ name: 'Demo Advi', business: '', batch: 'DEMO' });
  await store.terapkanDemo(user.id, {
    recommendations: { ringkasan: 'susunan kurasi', rekomendasi: [], peringatan: [], targetBulanIni: [], sumber: 'contoh' },
  });

  const u = await store.findUserById(user.id);
  assert.equal(u.advisori.length, 0, 'benih demo menulis slot lewat patch, bukan pintu advisori');
  assert.equal(u.events.filter((e) => e.type === 'advisori_dibuat').length, 0);
  assert.equal(u.recommendations.sumber, 'contoh');
});

/* ----------------------------------------------------------------- Trim policy */

test('trim: kap per jenis — yang tertua dibuang saat menulis yang ke-25', async () => {
  const { user } = await store.createUser({ name: 'Bu Trim', business: 'Warung Trim', batch: 'B1' });
  await store.saveConsent(user.id, CONSENT_VERSION);

  for (let i = 0; i < MAKS_PER_JENIS + 2; i++) {
    await store.simpanRekomendasi(user.id, rekomendasiBersih(), USAGE);
  }

  const u = await store.findUserById(user.id);
  const rekomendasi = u.advisori.filter((a) => a.jenis === 'rekomendasi');
  assert.equal(rekomendasi.length, MAKS_PER_JENIS, 'kap per jenis terpegah di 24');

  // Id tertua ada di jejak event (jejak tidak pernah dipangkas) tapi sudah
  // tidak ada di riwayat — bukti yang dibuang adalah yang TERTUA, bukan acak.
  const idEvent = u.events.filter((e) => e.type === 'advisori_dibuat').map((e) => e.meta.id);
  const idRekam = new Set(rekomendasi.map((a) => a.id));
  assert.equal(idEvent.length, MAKS_PER_JENIS + 2);
  assert.ok(!idRekam.has(idEvent[0]), 'rekam tertua harus pergi');
  assert.ok(idRekam.has(idEvent.at(-1)), 'rekam termuda harus tinggal');
  // Urutan tersisa tetap terlama dulu.
  const urutan = rekomendasi.map((a) => Date.parse(a.dibuat));
  for (let i = 1; i < urutan.length; i++) assert.ok(urutan[i - 1] <= urutan[i], 'riwayat terbaca seperti pembukuan');
});

test('trim per jenis: checkup tidak tersapu kap rekomendasi', async () => {
  const { user } = await store.createUser({ name: 'Bu Campur', business: 'Warung Campur', batch: 'B1' });
  await store.saveConsent(user.id, CONSENT_VERSION);
  for (let i = 0; i < MAKS_PER_JENIS; i++) {
    await store.simpanRekomendasi(user.id, rekomendasiBersih(), USAGE);
  }
  await store.simpanCheckup(user.id, sanitasiCheckup({ item: [{ tipe: 'ok', teks: 'x' }], insight: 'y' }), USAGE);
  await store.simpanCheckup(user.id, sanitasiCheckup({ item: [{ tipe: 'ok', teks: 'z' }], insight: 'w' }), USAGE);

  const u = await store.findUserById(user.id);
  assert.equal(u.advisori.filter((a) => a.jenis === 'rekomendasi').length, MAKS_PER_JENIS);
  assert.equal(u.advisori.filter((a) => a.jenis === 'checkup').length, 2);
  assert.equal(u.advisori.length, MAKS_PER_JENIS + 2);
});

/* ---------------------------------------------------------- Kegagalan flush */

test('gagal flush: tidak ada yang ter-append — disk tetap kebenaran, coba ulang tepat sekali', async () => {
  const { user } = await store.createUser({ name: 'Bu Gagal', business: 'Warung Gagal', batch: 'B1' });
  await store.saveConsent(user.id, CONSENT_VERSION);
  const sebelum = await store.findUserById(user.id);

  /*
   * Seam yang sama dengan kegagalan.test.js E5: direktori tepat di jalur berkas
   * sementara yang dihitung flush() sendiri (users.json.<pid>.tmp) — tulisan
   * gagal sebelum rename. Model kegagalan nyata: disk penuh / EIO.
   */
  const seam = path.join(DATA_DIR, `users.json.${process.pid}.tmp`);
  mkdirSync(seam);
  try {
    await assert.rejects(
      () => store.simpanRekomendasi(user.id, rekomendasiBersih(), USAGE, { model: 'm-gagal' }),
      'flush yang gagal harus menolak seluruh mutasi, bukan diam',
    );
  } finally {
    rmSync(seam, { recursive: true, force: true });
  }

  // Kebenaran disk: tidak ada rekam, tidak ada slot baru, tidak ada usage baru.
  const disk = await penggunaDisk(user.id);
  assert.equal(disk.advisori.length, 0, 'rekam yang penulisannya gagal tidak boleh tersisa');
  assert.equal(disk.recommendations, sebelum.recommendations);
  assert.equal(disk.usage.requests, sebelum.usage.requests);
  assert.equal(disk.events.filter((e) => e.type === 'advisori_dibuat').length, 0);

  // Setelah pulih, percobaan ulang mendarat TEPAT SEKALI (cache sudah dibuang — fix E-1).
  await store.simpanRekomendasi(user.id, rekomendasiBersih(), USAGE, { model: 'm-pulih' });
  const pulih = await penggunaDisk(user.id);
  assert.equal(pulih.advisori.length, 1);
  assert.equal(pulih.events.filter((e) => e.type === 'advisori_dibuat').length, 1);
  assert.equal(pulih.usage.requests, sebelum.usage.requests + 1);
});

/* ---------------------------------------------------------- Sidik dasar angka */

test('digest dasar: profil dan buku kas menentukan — chat dan jejak tidak', async () => {
  const { user } = await store.createUser({ name: 'Bu Sidik', business: 'Warung Sidik', batch: 'B1' });
  await store.saveConsent(user.id, CONSENT_VERSION);
  await store.saveProfile(user.id, { namaUsaha: 'Warung Sidik', omzetBulanan: 5_000_000 });
  await store.appendChat(user.id, [{ role: 'user', content: 'halo' }]);

  const a = digestDasarAngka(await store.findUserById(user.id));
  const b = digestDasarAngka(await store.findUserById(user.id));
  assert.deepEqual(b, a, 'state yang sama = sidik yang sama (deterministik)');

  // Chat bertambah: sidik tidak bergerak — yang membentuk angka bukan percakapan.
  await store.appendChat(user.id, [{ role: 'assistant', content: 'ya' }]);
  assert.equal(digestDasarAngka(await store.findUserById(user.id)).hash, a.hash);

  // Buku kas bergerak: sidik bergerak.
  await store.addTransaction(user.id, {
    tanggal: '2026-09-01', jenis: 'keluar', kategori: 'operasional', jumlah: 12_000,
  }, { aktor: 'manusia' });
  assert.notEqual(digestDasarAngka(await store.findUserById(user.id)).hash, a.hash);
});

/* -------------------------------------------------------- evaluasiAdvisori */

const m = (laba, margin, kas, lengkap = true) => ({
  labaBersih: laba, marginBersih: margin, saldoKas: kas, bulanLengkap: lengkap,
});
const advisoriUji = () => buatAdvisori({
  jenis: 'rekomendasi',
  isi: { ringkasan: 'r', rekomendasi: [{ judul: 'a' }, { judul: 'b' }], peringatan: [], targetBulanIni: [] },
  dasarAngka: { bulan: '2026-08', hash: 'sha256:aa' },
  kini: new Date('2026-08-20T03:00:00Z'),
});

test('evaluasi: bulan saran vs bulan berikutnya — arah per dimensi, gagal-aman per butir', () => {
  const hasil = evaluasiAdvisori(advisoriUji(), {
    '2026-08': m(1_000_000, 8, 500_000),
    '2026-09': m(1_250_000, 9.5, 420_000),
  }, { kini: new Date('2026-09-25T03:00:00Z') });

  assert.equal(hasil.status, 'terukur');
  assert.equal(hasil.metode, 'komparsi-bulan');
  assert.equal(hasil.bulanDasar, '2026-08');
  assert.equal(hasil.bulanCek, '2026-09');
  assert.deepEqual(hasil.dimensi.labaBersih, { dasar: 1_000_000, kini: 1_250_000, status: 'membaik' });
  assert.equal(hasil.dimensi.marginBersih.status, 'membaik');
  assert.equal(hasil.dimensi.saldoKas.status, 'memburuk');
  // Atribusi per butir saran bukan kerja v1 — jujur tak-terukur, bentuk tetap stabil.
  assert.deepEqual(hasil.perItem, [{ indeks: 0, status: 'tak-terukur' }, { indeks: 1, status: 'tak-terukur' }]);
});

test('evaluasi: angka sama = tetap — tanpa ambang baru', () => {
  const hasil = evaluasiAdvisori(advisoriUji(), {
    '2026-08': m(1_000_000, 8, 500_000),
    '2026-09': m(1_000_000, 8, 500_000),
  });
  assert.equal(hasil.dimensi.labaBersih.status, 'tetap');
  assert.equal(hasil.dimensi.marginBersih.status, 'tetap');
  assert.equal(hasil.dimensi.saldoKas.status, 'tetap');
});

test('evaluasi gagal-aman: bulan belum lengkap tidak pernah dibandingkan (disiplin setara)', () => {
  const dasar = { '2026-08': m(1_000_000, 8, 500_000) };
  const cekBelum = { '2026-09': m(900_000, 7, 100_000, false) };
  assert.equal(evaluasiAdvisori(advisoriUji(), { ...dasar, ...cekBelum }).status, 'tak-terukur');
  assert.equal(evaluasiAdvisori(advisoriUji(), {
    '2026-08': m(1_000_000, 8, 500_000, false),
    '2026-09': m(900_000, 7, 100_000),
  }).status, 'tak-terukur');
});

test('evaluasi gagal-aman: bulan hilang, jenis tanpa metode, bulan dasar tak tercatat', () => {
  // Hanya bulan periksa yang ada — angka bulan saran tidak tersedia.
  assert.equal(evaluasiAdvisori(advisoriUji(), { '2026-09': m(1, 1, 1) }).status, 'tak-terukur');
  // Hanya bulan dasar — belum ada bulan periksa.
  assert.equal(evaluasiAdvisori(advisoriUji(), { '2026-08': m(1, 1, 1) }).status, 'tak-terukur');

  // Checkup belum punya metode bulanan.
  const cek = buatAdvisori({
    jenis: 'checkup', isi: { item: [], insight: 'i' },
    dasarAngka: { bulan: '2026-08', hash: 'sha256:aa' }, kini: new Date('2026-08-20T03:00:00Z'),
  });
  assert.equal(evaluasiAdvisori(cek, { '2026-08': m(1, 1, 1), '2026-09': m(2, 2, 2) }).status, 'tak-terukur');

  // Rekam lama tanpa sidik bulan.
  const tanpaBulan = advisoriUji();
  delete tanpaBulan.dasarAngka;
  assert.equal(evaluasiAdvisori(tanpaBulan, { '2026-08': m(1, 1, 1), '2026-09': m(2, 2, 2) }).status, 'tak-terukur');
});

/* -------------------------------------------------- Checkpoint read-time (murni) */

const advisoriBulan = (bulan) => buatAdvisori({
  jenis: 'rekomendasi',
  isi: { ringkasan: 'r', rekomendasi: [{ judul: 'a' }], peringatan: [], targetBulanIni: [] },
  dasarAngka: { bulan, hash: 'sha256:aa' },
  kini: new Date('2026-08-20T03:00:00Z'),
});

test('checkpoint: jatuh tempo hanya setelah bulan periksa lewat — WIB yang memutuskan', () => {
  const adv = advisoriBulan('2026-08');
  const peta = { '2026-08': m(1_000_000, 8, 500_000), '2026-09': m(1_100_000, 8.5, 480_000) };

  // Masih bulan periksa (2026-09): hasilnya memang belum ada — nol rekam.
  assert.deepEqual(evaluasiTertunda([adv], [], peta, { kini: new Date('2026-09-15T04:00:00Z') }), []);
  // Tepat pergantian hari WIB: 31 Agu 18:00 UTC = 1 Sep 01:00 WIB → masih '2026-09', belum.
  assert.deepEqual(evaluasiTertunda([adv], [], peta, { kini: new Date('2026-08-31T18:00:00Z') }), []);
  // 30 Sep 18:00 UTC = 1 Okt 01:00 WIB → bulan periksa lewat → jatuh tempo.
  const due = evaluasiTertunda([adv], [], peta, { kini: new Date('2026-09-30T18:00:00Z') });
  assert.equal(due.length, 1);
  assert.equal(due[0].status, 'terukur');
  // Sekali per checkpoint: yang sudah bernilai tidak pernah diulang.
  assert.deepEqual(evaluasiTertunda([adv], due, peta, { kini: new Date('2026-11-01T04:00:00Z') }), []);
});

test('checkpoint: input rusak/absen tetap ter-append — kejujuran, bukan keheningan', () => {
  // Peta kosong saat jatuh tempo: tak-terukur TETAP dikembalikan untuk di-append.
  const kosong = evaluasiTertunda([advisoriBulan('2026-08')], [], {}, { kini: new Date('2026-10-05T04:00:00Z') });
  assert.equal(kosong.length, 1);
  assert.equal(kosong[0].status, 'tak-terukur');
  assert.match(kosong[0].sebab, /belum tersedia/);

  // Rekam rusak tanpa bulan dasar: jatuh tempo seketika, kejujurannya direkam.
  const rusak = advisoriBulan('2026-08');
  delete rusak.dasarAngka;
  const kena = evaluasiTertunda([rusak], [], {}, { kini: new Date('2026-09-15T04:00:00Z') });
  assert.equal(kena.length, 1);
  assert.match(kena[0].sebab, /bulan dasar/);
});

test('checkpoint: checkup tidak menjadwal penilaian — belum punya metode, bukan input rusak', () => {
  const cek = buatAdvisori({
    jenis: 'checkup', isi: { item: [], insight: 'i' },
    dasarAngka: { bulan: '2026-08', hash: 'sha256:aa' }, kini: new Date('2026-08-20T03:00:00Z'),
  });
  assert.deepEqual(evaluasiTertunda([cek], [], {}, { kini: new Date('2026-11-01T04:00:00Z') }), []);
});

test('bulanCheckpoint: bulan berikutnya, December menggulung tahun', () => {
  assert.equal(bulanCheckpoint('2026-08'), '2026-09');
  assert.equal(bulanCheckpoint('2026-12'), '2027-01');
  assert.equal(bulanCheckpoint('aneh'), null);
  assert.equal(bulanCheckpoint(undefined), null);
});

test('trim evaluasi di store: 48 terbaru, dan id idempoten tidak pernah kembar', async () => {
  const { user } = await store.createUser({ name: 'Bu Trim Hasil', business: 'Warung Trim Hasil', batch: 'B1' });
  for (let i = 0; i < EVALUASI_MAKS + 2; i++) {
    await store.tambahEvaluasiAdvisori(user.id, [{
      advisoriId: `adv_${String(i).padStart(12, '0')}`,
      metode: 'komparsi-bulan', status: 'tak-terukur', dinilaiAt: new Date().toISOString(),
    }]);
  }
  let u = await store.findUserById(user.id);
  assert.equal(u.evaluasiAdvisori.length, EVALUASI_MAKS);
  assert.equal(u.evaluasiAdvisori.at(-1).advisoriId, 'adv_000000000049', 'yang termuda tinggal');

  // Id yang sudah bernilai tidak diulang — juga dari pemanggil yang lalai.
  await store.tambahEvaluasiAdvisori(user.id, [{ advisoriId: 'adv_000000000049', metode: 'komparsi-bulan', status: 'terukur' }]);
  u = await store.findUserById(user.id);
  assert.equal(u.evaluasiAdvisori.length, EVALUASI_MAKS);
  assert.equal(u.evaluasiAdvisori.filter((e) => e.advisoriId === 'adv_000000000049').length, 1);
  assert.equal(u.evaluasiAdvisori.at(-1).status, 'tak-terukur', 'rekam pertama yang menang, bukan penimpaan');
});

/* ------------------------------------------------------------- No-retrofit */

test('retrofit nol: pengguna lama tanpa advisori utuh, lalu distempel saat tulis pertama', async () => {
  /*
   * Bentuk pra-Sesi G: tanpa `advisori`, tanpa `featureVersions`, baris
   * transaksi tanpa `origin`. Direktori datanya sendiri supaya instansi toko
   * yang segar membaca bentuk lama itu tanpa menyentuh pengguna uji lain.
   */
  const dirLama = mkdtempSync(path.join(tmpdir(), 'nova-uji-advi-lama-'));
  process.env.NOVA_DATA_DIR = dirLama;
  try {
    const kode = 'NOVA-ADVI-TEST1';
    const { hashCode } = store;
    const penggunaLama = {
      id: 'usr_lama000001',
      name: 'Bu Lama', business: 'Warung Lama', batch: 'B1',
      codeHash: hashCode(kode),
      createdAt: '2026-07-01T00:00:00.000Z',
      profile: null, profileHistory: [], mulaiPada: null,
      recommendations: null,
      chat: [], transactions: [], progress: {}, events: [],
      usage: { requests: 0, inputTokens: 0, outputTokens: 0 },
    };
    writeFileSync(path.join(dirLama, 'users.json'), JSON.stringify({ version: 1, users: [penggunaLama] }), 'utf8');

    const { store: storeLama } = await import('../lib/store.js?advi-lama=' + Math.random());
    const lama = await storeLama.findByAccessCode(kode);
    assert.ok(lama, 'pengguna bentuk lama tetap bisa masuk');
    assert.ok(!('advisori' in lama), 'pembacaan tidak boleh meretrofit bentuk lama');
    assert.ok(!('featureVersions' in lama));

    await storeLama.saveConsent(lama.id, CONSENT_VERSION);
    await storeLama.simpanRekomendasi(lama.id, rekomendasiBersih(), USAGE, { model: 'm-lama' });

    const u = await storeLama.findUserById(lama.id);
    assert.equal(u.advisori.length, 1, 'tulisan pertama menciptakan riwayat apa adanya');
    assert.deepEqual(u.featureVersions, { advisori: 1 }, 'stempel M1-lite set-if-absent, sekali');
    // Pengguna lama yang menulis kembali disimpan sebagai bentuk BARU di disk —
    // tanpa migrasi, tanpa mengubah siapa pun selain dia.
    const disk = JSON.parse(readFileSync(path.join(dirLama, 'users.json'), 'utf8'));
    assert.equal(disk.users.length, 1);
    assert.equal(disk.users[0].advisori.length, 1);
  } finally {
    process.env.NOVA_DATA_DIR = DATA_DIR;
    rmSync(dirLama, { recursive: true, force: true });
  }
});
