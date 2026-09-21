/**
 * Uji identitas AI — Sesi D (kepercayaan identitas & tampilan).
 *
 * Identitas model bukan kosmetik: dia yang tampil di /api/health, jejak SSE,
 * banner, dan (sejak Sesi D) stempel provenansi pada keluaran AI yang
 * tersimpan. Kesalahan identitas di sini adalah dusta yang menggiring
 * kesimpulan salah — bukti live yang mengaku Gemini padahal tagihannya
 * Claude, atau sebaliknya. Yang dipatrikan di berkas ini:
 *
 *   1. identitas runtime TURUNAN dari pemilih model yang benar-benar
 *      dipakai permintaan (bukan konstanta yang kebetulan mirip),
 *   2. tiap jalur (anthropic / vertex / gemini) terlapor sebagai dirinya,
 *   3. identitas yang tidak dikenal GAGAL KERAS — tidak pernah diberi label
 *      penyedia yang dikarang agar tampilan terlihat lengkap.
 *
 * Batch berikutnya di berkas yang sama: provenansi tersimpan (D2), jendela
 * umur Fokus Harian (D3), kejujuran tampilan publik (D4).
 *
 *   npm test
 */
import assert from 'node:assert/strict';
import test from 'node:test';

/** Menjalankan fn dengan env sementara, lalu memulihkannya apa pun yang terjadi. */
function denganEnv(nilai, fn) {
  const asli = {};
  for (const [k, v] of Object.entries(nilai)) {
    asli[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(asli)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** Impor segar per kasus uji — konvensi berkas uji lain di repo ini. */
const aiSegar = () => import(`../lib/ai.js?u=${Math.random()}`);
const claudeSegar = () => import(`../lib/claude.js?u=${Math.random()}`);

test('identitas jalur anthropic langsung: sama dengan model yang dikirim ke penyedia', async () => {
  const ai = await aiSegar();
  const claude = await claudeSegar();
  denganEnv({ NOVA_AI_BACKEND: 'anthropic', GOOGLE_CLOUD_PROJECT: undefined }, () => {
    /*
     * Ikatan sumber-ke-target: yang dilaporkan WAJIB keluaran fungsi yang
     * sama dengan yang memilih model pada tiap permintaan sungguhan.
     */
    assert.equal(ai.modelAktif(), claude.getModel());
    assert.equal(ai.modelAktif(), claude.MODEL);
  });
});

test('identitas jalur Vertex: claude-v2@, dan TIDAK tertukar identifier API langsung', async () => {
  const ai = await aiSegar();
  const claude = await claudeSegar();
  denganEnv({ NOVA_AI_BACKEND: 'vertex', GOOGLE_CLOUD_PROJECT: 'proyek-uji' }, () => {
    const nama = ai.modelAktif();
    assert.equal(nama, claude.getModel(), 'identitas = pemilih model permintaan');
    assert.ok(nama.includes('@'), 'identifier Vertex membawa sufiks @versi');
    assert.notEqual(
      nama,
      claude.MODEL,
      'regresi terdahulu: vertex melaporkan konstanta API langsung — dusta identitas pada health, SSE, dan bukti live',
    );
  });
});

test('identitas jalur Gemini: bawaan gemini-2.5-flash, dan GEMINI_MODEL dihormati', async () => {
  const ai = await aiSegar();
  denganEnv({ NOVA_AI_BACKEND: 'gemini', GOOGLE_CLOUD_PROJECT: 'proyek-uji', GEMINI_MODEL: undefined }, () => {
    assert.equal(ai.modelAktif(), 'gemini-2.5-flash');
  });
  denganEnv({ NOVA_AI_BACKEND: 'gemini', GOOGLE_CLOUD_PROJECT: 'proyek-uji', GEMINI_MODEL: 'gemini-2.5-pro' }, () => {
    assert.equal(ai.modelAktif(), 'gemini-2.5-pro');
  });
});

test('backend tak dikenal gagal keras — identitas tidak pernah dikarang demi tampilan lengkap', async () => {
  const ai = await aiSegar();
  denganEnv({ NOVA_AI_BACKEND: 'chatgpt', GOOGLE_CLOUD_PROJECT: 'proyek-uji' }, () => {
    assert.throws(() => ai.modelAktif(), /tidak dikenali/i);
  });
});

/* ------------------------------------------------------------------ D2 — provenansi tersimpan */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const DIR_DATA = mkdtempSync(path.join(tmpdir(), 'nova-uji-ident-'));
process.env.NOVA_DATA_DIR = DIR_DATA;
process.on('exit', () => rmSync(DIR_DATA, { recursive: true, force: true }));

const { store } = await import('../lib/store.js');
const { susunRekomendasi } = await import(`../lib/demo-data.js?u=${Math.random()}`);

const { user: pemilik } = await store.createUser({ name: 'Bu Iden', business: 'Warung Iden', batch: 'B1' });
await store.saveConsent(pemilik.id, CONSENT_VERSION);

const REKOMENDASI_SAH = {
  ringkasan: 'Kondisi cukup sehat.',
  rekomendasi: [{ judul: 'Rapikan pencatatan', prioritas: 'sedang', alasan: 'Catatan belum rapat.', langkah: ['Catat harian'], dampak: 'Laporan lebih akurat.', modulTerkait: 3 }],
  peringatan: ['Kas sering minus akhir pekan.'],
  targetBulanIni: ['Catat setiap hari'],
};

test('keluaran AI hidup tersimpan dengan sumber "ai" dan model yang benar-benar dipakai', async () => {
  const tersimpan = await store.simpanRekomendasi(pemilik.id, REKOMENDASI_SAH, { input_tokens: 10, output_tokens: 5 }, {
    model: 'claude-3-5-sonnet-v2@20241022',
  });
  assert.equal(tersimpan.sumber, 'ai');
  assert.equal(tersimpan.model, 'claude-3-5-sonnet-v2@20241022');
  assert.equal(typeof tersimpan.generatedAt, 'string');
  // Peristiwa yang terdaftar di jejak tidak berubah — Sesi C tidak tersentuh.
  const jejak = await store.getEvents(pemilik.id);
  const rek = jejak.filter((e) => e.type === 'recommendations_generated');
  assert.ok(rek.length >= 1);
});

test('provenansi yang tidak diketahui TIDAK dikarang — kekosongan tetap kekosongan', async () => {
  const { user: pemilik2 } = await store.createUser({ name: 'Bpk Absen', business: 'Kedai Absen', batch: 'B1' });
  await store.saveConsent(pemilik2.id, CONSENT_VERSION);
  const tersimpan = await store.simpanRekomendasi(pemilik2.id, REKOMENDASI_SAH, null);
  assert.equal(tersimpan.sumber, 'ai');
  assert.equal('model' in tersimpan, false, 'tanpa informasi model, tidak ada medan model karangan');
});

test('rekam percakapan lama tetap utuh; identitas hanya menempel pada pesan asisten baru', async () => {
  const { user: p3 } = await store.createUser({ name: 'Bu Obrol', business: 'Warung Obrol', batch: 'B1' });
  await store.saveConsent(p3.id, CONSENT_VERSION);
  // Giliran LAMA (tanpa model) — harus tetap terbaca persis seperti adanya.
  await store.simpanGiliranChat(p3.id, [
    { role: 'user', content: 'pagi', ts: '2026-01-01T00:00:00.000Z' },
    { role: 'assistant', content: 'pagi juga', ts: '2026-01-01T00:00:01.000Z' },
  ], null);
  // Giliran BARU membawa identitas.
  await store.simpanGiliranChat(p3.id, [
    { role: 'user', content: 'lapa', ts: '2026-01-02T00:00:00.000Z' },
    { role: 'assistant', content: 'ini jawaban', ts: '2026-01-02T00:00:01.000Z' },
  ], null, { model: 'gemini-2.5-flash' });

  const obrolan = await store.getChat(p3.id);
  assert.equal(obrolan.length, 4);
  assert.equal('model' in obrolan[1], false, 'pesan lama tidak diretrofit');
  assert.equal(obrolan[3].model, 'gemini-2.5-flash', 'pesan asisten baru distempel identitas runtime');
  assert.equal('model' in obrolan[2], false, 'pesan peserta tidak pernah distempel identitas model');
});

test('soal latihan AI baru membawa model; kunci jawaban tidak ikut ke klien', async () => {
  const { user: p4 } = await store.createUser({ name: 'Bu Soal', business: 'Katering Soal', batch: 'B1' });
  await store.saveConsent(p4.id, CONSENT_VERSION);
  const soal = await store.aturLatihanAI(p4.id, 3, {
    pertanyaan: 'Berapa HPP bila bahan 40rb dan porsi 100?', pilihan: ['400', '500'], kunci: 'A', konsep: 'HPP', penjelasan: '40jt/100',
  }, { model: 'claude-3-5-sonnet-20241022' });
  assert.equal(soal.model, 'claude-3-5-sonnet-20241022');
  const dibaca = await store.bacaLatihanAI(p4.id, 3);
  assert.equal(dibaca.kunci, 'A', 'rekam berprovenansi tetap menyimpan kunci di sisi server');
});

test('benih demo menyatakan dirinya "contoh" — bukan keluaran AI', () => {
  const benih = susunRekomendasi({ id: 'uji', nama: 'Bu Demo', omzet: 5_000_000 }, [], '2026-09-01');
  assert.equal(benih.sumber, 'contoh');
  assert.equal('model' in benih, false, 'konten kurasi tidak boleh mengaku model mana pun');
  assert.equal(typeof benih.generatedAt, 'string', 'tanggal benih tetap ada, sebagai tanggal benih');
});

/* --------------------------------------------------- D3 — jendela umur Fokus */

const { susunFokusHarian } = await import('../lib/fokus-harian.js');

const KINI = new Date('2026-09-12T04:00:00.000Z');
const berumur = (hari) => new Date(KINI.getTime() - hari * 86_400_000).toISOString();
const METRIK_FOKUS = {
  sumber: 'catatan', saldoKas: 2_000_000, rugi: false, prive: 0,
  labaBersih: 1_500_000, marginBersih: 25, statusCicilan: 'aman',
  komponenSkor: [{ aspek: 'Margin laba bersih', poin: 10, maks: 25, catatan: 'Masih bisa naik' }],
};
const FOKUS_DASAR = { punyaProfil: true, metrics: METRIK_FOKUS, kini: KINI };
const REK_DENGAN_PERINGATAN = (generatedAt) => ({
  peringatan: ['Kas sering minus tiap akhir pekan.'],
  rekomendasi: [{ judul: 'X', modulTerkait: 9 }],
  generatedAt,
});

test('Fokus: peringatan AI dalam jendela umur tetap layak diangkat', () => {
  const k = susunFokusHarian({ ...FOKUS_DASAR, rekomendasi: REK_DENGAN_PERINGATAN(berumur(10)) });
  assert.equal(k.id, 'peringatan-rekomendasi', '10 hari < 30 hari — masih relevan');
  assert.match(k.alasan, /Kas sering minus/);
});

test('Fokus: peringatan AI di luar jendela umur tidak diputar ulang sebagai segar', () => {
  const k = susunFokusHarian({ ...FOKUS_DASAR, rekomendasi: REK_DENGAN_PERINGATAN(berumur(31)) });
  assert.notEqual(k.id, 'peringatan-rekomendasi', '31 hari > jendela 30 hari');
  assert.equal(k.id, 'komponen-skor', 'aliran jatuh ke aturan deterministik berikutnya');
});

test('Fokus: tanggal absen, rusak, atau dari masa depan gagal-aman ke luar jendela', () => {
  for (const generatedAt of [undefined, null, 'bukan-tanggal', '2027-01-01T00:00:00.000Z']) {
    const k = susunFokusHarian({ ...FOKUS_DASAR, rekomendasi: REK_DENGAN_PERINGATAN(generatedAt) });
    assert.notEqual(
      k.id,
      'peringatan-rekomendasi',
      `generatedAt=${String(generatedAt)} tidak boleh lolos sebagai "peringatan terakhir"`,
    );
  }
});

/* -------------------------------------------- D4 — kejujuran tampilan publik */

import { readFileSync } from 'node:fs';
import { CONSENT_VERSION } from '../lib/consent.js';

const bacaPublik = (nama) => readFileSync(new URL(`../public/${nama}`, import.meta.url), 'utf8');

test('index.html tidak lagi mengklaim model yang tidak ia tahu', () => {
  const html = bacaPublik('index.html');
  assert.ok(!/AI\s+Gemini/i.test(html), 'label model keras-kode = dusta identitas di 2 dari 3 jalur backend');
  assert.ok(!html.includes('berdasarkan profil usaha terbaru'), 'klaim kesegaran tanpa dasar dihapus');
  // Dan identitas runtime memang DIBACA dari server, bukan dikarang:
  assert.ok(html.includes('state.model'), 'state.model ada — identitas dari /api/login dan bingkai done');
});

test('kartu publik menyebut asal-usul catatan AI, bukan mengatasnamakan pemilik', () => {
  const html = bacaPublik('kartu.html');
  assert.ok(html.includes('analisis AI'), 'atribusi AI eksplisit ada');
  assert.ok(html.includes('insightSumber'), 'pilihan kepala catatan mengikuti sumbernya');
  assert.ok(!/Catatan utama/.test(html), 'kepala generik yang menyamakan catatan AI dengan catatan pemilik sudah tiada');
});

/* ------------------------------------------------- D5/G — persetujuan v4 */

test('persetujuan v4: semua pemroses disebut, kerangka komersial, dan versi lama wajib menyetujui ulang', async () => {
  const { CONSENT_VERSION, CONSENT_TEXT, hasConsented } = await import('../lib/consent.js');
  /*
   * Dua keputusan pemilik menaikkan versi ke 4: D5 (opsi 2) mewajibkan SEMUA
   * pemroses disebut, dan RESEARCH-DEPENDENCY-REMOVAL.md (2026-09-13) mengganti
   * kerangka "peserta pilot" dengan ketentuan layanan komersial. Menurunkan
   * versi di sini berarti membatalkan keduanya; naikkan lagi hanya dengan
   * keputusan baru.
   */
  assert.equal(CONSENT_VERSION, 4);
  const semua = JSON.stringify(CONSENT_TEXT).toLowerCase();
  assert.match(semua, /claude|anthropic/, 'jalur Anthropic tetap disebut');
  assert.match(semua, /gemini|google/, 'jalur Gemini (Vertex AI, Google Cloud) ikut disebut');
  assert.equal(hasConsented({ consent: { versi: CONSENT_VERSION - 1 } }), false, 'persetujuan versi sebelumnya HARUS melihat layar persetujuan lagi');
  assert.equal(hasConsented({ consent: { versi: CONSENT_VERSION } }), true);
});

