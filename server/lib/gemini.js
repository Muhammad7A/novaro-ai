/**
 * Pembungkus Gemini di Vertex AI — jalur AI alternatif.
 *
 * ------------------------------------------------------------------
 * KENAPA BERKAS INI ADA
 *
 * Model Claude di Vertex dijual sebagai *partner model*, dan kredit percobaan
 * Google Cloud tidak menanggungnya. Gemini adalah produk Google langsung, jadi
 * kredit itu berlaku. Untuk penelitian yang anggarannya sudah habis, itu bukan
 * penghematan kecil melainkan satu-satunya cara fitur AI tetap menyala.
 *
 * ------------------------------------------------------------------
 * KONTRAKNYA SENGAJA SAMA PERSIS DENGAN lib/claude.js
 *
 * `streamChat()` dan `generateRecommendations()` mengembalikan bentuk yang
 * identik — termasuk `usage` bergaya Anthropic (`input_tokens`,
 * `output_tokens`, …), karena `lib/anggaran.js` menghitung jatah token peserta
 * dari nama-nama medan itu. Kalau bentuknya berbeda sedikit saja, seluruh
 * anggaran harian dan mingguan diam-diam terbaca nol: peserta tidak pernah
 * kena batas, dan tagihan berjalan tanpa rem. Penerjemahan nama medan
 * dikerjakan di sini, di satu tempat, bukan disebar ke pemanggilnya.
 */
import { ApiError, GoogleGenAI } from '@google/genai';

import {
  CHECKUP_SCHEMA,
  LATIHAN_AI_SCHEMA,
  NOTA_SCHEMA,
  RECOMMENDATION_SCHEMA,
  chatSystem,
  checkupRequest,
  checkupSystem,
  latihanAiRequest,
  latihanAiSystem,
  notaRequest,
  notaSystem,
  recommendationRequest,
  recommendationSystem,
} from './prompts.js';

import { parseNotaJson } from './nota.js';

/**
 * Model bawaan.
 *
 * Flash dipilih, bukan Pro: penelitian ini kehabisan anggaran, dan beban
 * kerjanya — menjelaskan pembukuan sederhana kepada pemilik warung — bukan
 * penalaran berat. Ganti lewat GEMINI_MODEL bila perlu.
 */
export function modelAktif() {
  return (process.env.GEMINI_MODEL ?? '').trim() || 'gemini-2.5-flash';
}

export function getProjectId() {
  return (
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.VERTEX_PROJECT_ID ||
    process.env.GCP_PROJECT ||
    process.env.PROJECT_ID ||
    ''
  ).trim();
}

export function isConfigured() {
  return Boolean(getProjectId());
}

let client = null;

function getClient() {
  const project = getProjectId();
  if (!project) {
    const err = new Error('GOOGLE_CLOUD_PROJECT / VERTEX_PROJECT_ID belum diisi, padahal jalur AI disetel ke Gemini.');
    err.code = 'NO_API_KEY';
    throw err;
  }
  if (!client) {
    /*
     * `vertexai: true` memakai Application Default Credentials, bukan kunci
     * API — di Cloud Run itu service account layanan, tanpa rahasia yang perlu
     * dipasang. Jalur kunci API Gemini (AI Studio) sengaja TIDAK dipakai:
     * pemakaiannya tidak masuk tagihan Google Cloud, jadi kreditnya tidak
     * berlaku, dan justru itulah alasan berkas ini ada.
     */
    client = new GoogleGenAI({
      vertexai: true,
      project,
      location: (process.env.CLOUD_ML_REGION ?? process.env.VERTEX_REGION ?? '').trim() || 'us-central1',
    });
  }
  return client;
}

/* --------------------------------------------------- Penerjemah bentuk data */

/**
 * Riwayat gaya Anthropic -> gaya Gemini.
 *
 * Perbedaan yang mudah terlewat: peran model bernama `model`, bukan
 * `assistant`. Nilai yang salah tidak ditolak sebagai galat — ia diperlakukan
 * sebagai giliran pengguna, sehingga model membaca jawabannya sendiri seolah
 * ucapan peserta dan percakapan pelan-pelan kehilangan arah.
 */
function keIsiGemini(history, message) {
  const isi = history.slice(-16).map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: String(m.content ?? '') }],
  }));
  isi.push({ role: 'user', parts: [{ text: message }] });
  return isi;
}

/**
 * usageMetadata Gemini -> bentuk yang dibaca lib/anggaran.js.
 *
 * `thoughtsTokenCount` DIJUMLAHKAN ke keluaran. Token penalaran ditagih seperti
 * keluaran biasa tetapi dilaporkan terpisah; mengabaikannya membuat jatah
 * peserta terbaca lebih kecil daripada yang sebenarnya dipakai — persis jenis
 * kebocoran yang tidak terlihat sampai tagihannya datang.
 *
 * Diekspor semata agar kontrak ini bisa diuji langsung: menirukan SDK Google
 * dari luar tidak mungkin dilakukan dengan rapi pada modul ESM, dan medan yang
 * salah nama di sini tidak menimbulkan galat apa pun — ia hanya membuat jatah
 * token terbaca nol.
 */
export function keUsage(meta) {
  const n = (v) => Number(v) || 0;
  return {
    input_tokens: n(meta?.promptTokenCount),
    output_tokens: n(meta?.candidatesTokenCount) + n(meta?.thoughtsTokenCount),
    cache_read_input_tokens: n(meta?.cachedContentTokenCount),
    cache_creation_input_tokens: 0,
  };
}

/** Alasan berhenti yang berarti "ditolak", bukan "selesai". */
const DITOLAK = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION']);

/** Menerjemahkan galat SDK menjadi pesan berbahasa Indonesia + kode HTTP. */
export function describeError(err) {
  if (err?.code === 'NO_API_KEY') {
    return { status: 503, message: err.message };
  }
  /*
   * Kredensial ADC yang hilang atau tanpa peran roles/aiplatform.user tidak
   * datang sebagai ApiError — ia dilempar google-auth-library sebagai Error
   * biasa, tanpa `status`. Tanpa cabang ini ia jatuh ke "kesalahan tak
   * terduga", dan pendamping tidak punya satu pun petunjuk bahwa yang kurang
   * adalah satu baris IAM.
   */
  if (/credential|oauth|could not load the default/i.test(err?.message ?? '')) {
    return {
      status: 503,
      message:
        'Server tidak bisa memperoleh kredensial Google Cloud. Periksa service account layanan ini dan peran roles/aiplatform.user.',
    };
  }
  if (err instanceof ApiError) {
    if (err.status === 401 || err.status === 403) {
      return {
        status: 503,
        message: 'Akses ke Vertex AI ditolak. Periksa peran roles/aiplatform.user dan apakah Vertex AI API sudah dinyalakan.',
      };
    }
    if (err.status === 404) {
      return {
        status: 503,
        message: `Model ${modelAktif()} tidak ditemukan di region ${process.env.CLOUD_ML_REGION || 'global'}. Periksa nama model dan region.`,
      };
    }
    if (err.status === 429) {
      return { status: 429, message: 'Layanan AI sedang penuh. Coba lagi sebentar lagi ya.' };
    }
    const status = err.status >= 500 ? 502 : 400;
    return { status, message: `Layanan AI menolak permintaan (${err.status}). ${err.message ?? ''}`.trim() };
  }
  // Galat yang dilempar aplikasi ini sendiri sudah membawa status siap-tampil.
  if (err?.status) {
    return { status: err.status, message: err.message };
  }
  return { status: 500, message: 'Terjadi kesalahan tak terduga di server.' };
}

/* ------------------------------------------------------------------ Chat */

export async function streamChat({
  profile,
  metrics,
  cashbook = '',
  belajar = {},
  history,
  message,
  onText,
  signal,
}) {
  const ai = getClient();

  const stream = await ai.models.generateContentStream({
    model: modelAktif(),
    contents: keIsiGemini(history, message),
    config: {
      systemInstruction: chatSystem(profile, metrics, cashbook, belajar),
      maxOutputTokens: 4000,
      // Konsultasi singkat: penalaran dimatikan supaya jawaban muncul cepat
      // dan tidak memakan jatah token peserta. Rekomendasi memakai penalaran.
      thinkingConfig: { thinkingBudget: 0 },
      abortSignal: signal,
    },
  });

  let teks = '';
  let usage = null;
  let alasan = null;
  for await (const bagian of stream) {
    if (bagian.text) {
      teks += bagian.text;
      onText(bagian.text);
    }
    // Potongan terakhir yang membawanya adalah yang lengkap.
    if (bagian.usageMetadata) usage = bagian.usageMetadata;
    const f = bagian.candidates?.[0]?.finishReason;
    if (f) alasan = f;
  }

  if (DITOLAK.has(alasan)) {
    const err = new Error(
      'Pertanyaan ini ditolak oleh sistem keamanan AI. Coba tanyakan dengan kalimat lain, atau tanyakan hal seputar keuangan usahamu.',
    );
    err.status = 422;
    throw err;
  }

  return { text: teks.trim(), usage: keUsage(usage), terpotong: alasan === 'MAX_TOKENS' };
}

/* --------------------------------------------------------- Rekomendasi */

export async function generateRecommendations({
  profile,
  metrics,
  cashbook = '',
  belajar = {},
  signal,
}) {
  const ai = getClient();

  const stream = await ai.models.generateContentStream({
    model: modelAktif(),
    contents: [{ role: 'user', parts: [{ text: recommendationRequest(profile, metrics) }] }],
    config: {
      systemInstruction: recommendationSystem(profile, metrics, cashbook, belajar),
      maxOutputTokens: 32768,
      responseMimeType: 'application/json',
      /*
       * `responseJsonSchema`, BUKAN `responseSchema`. Yang terakhir memakai
       * tipe Schema milik Google (subset OpenAPI) dan menolak sebagian kata
       * kunci; yang pertama menerima JSON Schema apa adanya, sehingga
       * RECOMMENDATION_SCHEMA dipakai bersama tanpa disalin ke bentuk kedua
       * yang bisa menyimpang diam-diam dari aslinya.
       */
      responseJsonSchema: RECOMMENDATION_SCHEMA,
      abortSignal: signal,
    },
  });

  let teks = '';
  let usage = null;
  let alasan = null;
  for await (const bagian of stream) {
    if (bagian.text) teks += bagian.text;
    if (bagian.usageMetadata) usage = bagian.usageMetadata;
    const f = bagian.candidates?.[0]?.finishReason;
    if (f) alasan = f;
  }

  if (DITOLAK.has(alasan)) {
    const err = new Error('Permintaan ditolak oleh sistem keamanan AI. Coba ubah isian profil usaha.');
    err.status = 422;
    throw err;
  }

  teks = teks.trim();
  if (alasan === 'MAX_TOKENS' || !teks) {
    const err = new Error('Jawaban AI terpotong. Coba jalankan ulang pembuatan rekomendasi.');
    err.status = 502;
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(teks);
  } catch {
    const err = new Error('AI mengembalikan format yang tidak terbaca. Coba lagi.');
    err.status = 502;
    throw err;
  }

  return { data: parsed, usage: keUsage(usage) };
}

/* --------------------------------------------------- Ekstraksi nota (foto) */

/**
 * Membaca foto nota dan mengembalikan JSON terstruktur.
 *
 * `gemini-2.5-flash` multimodal sejak awal — satu bagian `inlineData`
 * ditambahkan ke permintaan yang sama polanya dengan rekomendasi di atas.
 * Penalaran dimatikan (thinkingBudget 0): membaca nota adalah penglihatan
 * + ekstraksi, bukan penalaran berat, dan hasilnya harus cepat — peserta
 * sedang berdiri memegang ponsel menunggu "Sedang membaca nota...".
 *
 * Teks jawaban TIDAK dipercaya mentah-mentah: dilempar ke parseNotaJson +
 * sanitasiHasilNota (lib/nota.js) oleh pemanggilnya. Di sini hanya
 * memanggil dan menerjemahkan bentuk.
 *
 * @param {{imageBase64: string, mimeType: string, signal?: AbortSignal}} opts
 * @returns {Promise<{data: object, usage: object}>}
 */
export async function analyzeNota({ imageBase64, mimeType, signal }) {
  const ai = getClient();

  const stream = await ai.models.generateContentStream({
    model: modelAktif(),
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: imageBase64 } },
          { text: notaRequest() },
        ],
      },
    ],
    config: {
      systemInstruction: notaSystem(),
      maxOutputTokens: 1000,
      responseMimeType: 'application/json',
      responseJsonSchema: NOTA_SCHEMA,
      thinkingConfig: { thinkingBudget: 0 },
      abortSignal: signal,
    },
  });

  let teks = '';
  let usage = null;
  let alasan = null;
  for await (const bagian of stream) {
    if (bagian.text) teks += bagian.text;
    if (bagian.usageMetadata) usage = bagian.usageMetadata;
    const f = bagian.candidates?.[0]?.finishReason;
    if (f) alasan = f;
  }

  if (DITOLAK.has(alasan)) {
    const err = new Error('Foto nota ditolak oleh sistem keamanan AI. Coba foto ulang dengan sudut yang berbeda.');
    err.status = 422;
    throw err;
  }

  teks = teks.trim();
  if (alasan === 'MAX_TOKENS' || !teks) {
    const err = new Error('Hasil baca nota terpotong. Coba foto lebih dekat pada bagian totalnya.');
    err.status = 502;
    throw err;
  }

  return { data: parseNotaJson(teks), usage: keUsage(usage) };
}

/**
 * Soal latihan personal dari materi modul + angka peserta sendiri.
 * Kontraknya sama persis dengan lib/claude.js — hanya bentuk pemanggilan
 * API-nya yang mengikuti Gemini.
 *
 * @param {{materiTeks: string, angkaTeks: string, signal?: AbortSignal}} opts
 * @returns {Promise<{data: object, usage: object}>}
 */
export async function analyzeLatihanAi({ materiTeks, angkaTeks, signal }) {
  const ai = getClient();

  const stream = await ai.models.generateContentStream({
    model: modelAktif(),
    contents: [{ role: 'user', parts: [{ text: latihanAiRequest() }] }],
    config: {
      systemInstruction: latihanAiSystem(materiTeks, angkaTeks),
      maxOutputTokens: 1500,
      responseMimeType: 'application/json',
      responseJsonSchema: LATIHAN_AI_SCHEMA,
      thinkingConfig: { thinkingBudget: 0 },
      abortSignal: signal,
    },
  });

  let teks = '';
  let usage = null;
  let alasan = null;
  for await (const bagian of stream) {
    if (bagian.text) teks += bagian.text;
    if (bagian.usageMetadata) usage = bagian.usageMetadata;
    const f = bagian.candidates?.[0]?.finishReason;
    if (f) alasan = f;
  }

  if (DITOLAK.has(alasan)) {
    const err = new Error('Permintaan soal latihan ditolak sistem keamanan AI. Coba lagi sebentar.');
    err.status = 422;
    throw err;
  }

  teks = teks.trim();
  if (alasan === 'MAX_TOKENS' || !teks) {
    const err = new Error('Hasil soal latihan terpotong. Coba lagi sebentar.');
    err.status = 502;
    throw err;
  }

  return { data: parseNotaJson(teks), usage: keUsage(usage) };
}

/* ------------------------------------------------- Check-up keuangan (AI) */

/**
 * Check-up keuangan: AI menilai STATUS dari angka yang diberikan aplikasi,
 * bukan menghitung sendiri. Pola persis generateRecommendations — dialirkan
 * demi jam dinding, JSON terstruktur lewat responseJsonSchema, penalaran
 * dimatikan karena penilaiannya pendek dan harus cepat.
 *
 * @param {{metricsTeks: string, perubahanTeks: string, signal?: AbortSignal}} opts
 * @returns {Promise<{data: object, usage: object}>}
 */
export async function analyzeCheckup({ metricsTeks, perubahanTeks, signal }) {
  const ai = getClient();

  const stream = await ai.models.generateContentStream({
    model: modelAktif(),
    contents: [{ role: 'user', parts: [{ text: checkupRequest() }] }],
    config: {
      systemInstruction: checkupSystem([metricsTeks, perubahanTeks].filter(Boolean).join('\n\n')),
      maxOutputTokens: 2000,
      responseMimeType: 'application/json',
      responseJsonSchema: CHECKUP_SCHEMA,
      thinkingConfig: { thinkingBudget: 0 },
      abortSignal: signal,
    },
  });

  let teks = '';
  let usage = null;
  let alasan = null;
  for await (const bagian of stream) {
    if (bagian.text) teks += bagian.text;
    if (bagian.usageMetadata) usage = bagian.usageMetadata;
    const f = bagian.candidates?.[0]?.finishReason;
    if (f) alasan = f;
  }

  if (DITOLAK.has(alasan)) {
    const err = new Error('Permintaan check-up ditolak sistem keamanan AI. Coba lagi sebentar.');
    err.status = 422;
    throw err;
  }

  teks = teks.trim();
  if (alasan === 'MAX_TOKENS' || !teks) {
    const err = new Error('Hasil check-up terpotong. Coba lagi sebentar.');
    err.status = 502;
    throw err;
  }

  return { data: parseNotaJson(teks), usage: keUsage(usage) };
}
