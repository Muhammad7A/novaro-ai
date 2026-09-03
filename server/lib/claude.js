/**
 * Pembungkus Claude API (model Claude Sonnet 5).
 *
 * Kunci API hanya hidup di server ini — tidak pernah dikirim ke browser.
 */
import Anthropic from '@anthropic-ai/sdk';
import { AnthropicVertex } from '@anthropic-ai/vertex-sdk';

import { backendAI } from './backend.js';
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
import { sanitasiCheckup } from './checkup.js';

export function getModel() {
  return backendAI() === 'vertex' ? 'claude-3-5-sonnet-v2@20241022' : 'claude-3-5-sonnet-20241022';
}
export const MODEL = 'claude-3-5-sonnet-20241022';

let client = null;

// Pemilih jalur hidup di lib/backend.js supaya lib/ai.js dan berkas ini
// memakainya tanpa saling mengimpor melingkar. Di-ekspor ulang di sini karena
// sudah menjadi bagian dari permukaan modul ini.
export { backendAI } from './backend.js';

/*
 * Nilai isian di .env.example. Bentuknya `sk-ant-` diikuti huruf x belaka —
 * tidak ada kunci sungguhan yang berbentuk begitu, dan kunci uji (`sk-ant-uji`)
 * juga tidak.
 */
const KUNCI_CONTOH = /^sk-ant-x+$/i;

export function getProjectId() {
  return (
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.VERTEX_PROJECT_ID ||
    process.env.GCP_PROJECT ||
    process.env.PROJECT_ID ||
    ''
  ).trim();
}

/**
 * Apakah kunci API sudah diisi dengan kunci sungguhan?
 *
 * Memeriksa "tidak kosong" saja tidak cukup. Kalau server/.env disalin dari
 * .env.example tapi kuncinya lupa diganti, nilai contohnya ikut lolos: banner
 * saat start menulis "Kunci API: terpasang", /api/login mengirim
 * `aiConfigured: true`, dan aplikasi menampilkan Konsultan AI seolah siap.
 * Peserta baru mengetahui kuncinya belum diisi ketika pertanyaan pertamanya
 * gagal dengan 401 — jauh dari tempat kesalahannya sebenarnya.
 */
export function isConfigured() {
  /*
   * Di Vertex tidak ada kunci untuk diperiksa. Yang menentukan sah-tidaknya
   * adalah kredensial ADC, dan itu hanya bisa dibuktikan lewat panggilan
   * sungguhan — tidak ada cara memeriksanya serentak di sini tanpa menahan
   * proses start. Jadi yang diperiksa hanyalah yang bisa diperiksa; kegagalan
   * kredensial ditangkap describeError() dengan pesan yang menyebut IAM,
   * bukan pesan "periksa koneksi internet" yang menyesatkan.
   */
  if (backendAI() === 'vertex') return Boolean(getProjectId());

  const kunci = (process.env.ANTHROPIC_API_KEY ?? '').trim();
  return Boolean(kunci) && !KUNCI_CONTOH.test(kunci);
}

function getClient() {
  if (!isConfigured()) {
    const err = new Error(
      'ANTHROPIC_API_KEY belum diisi kunci sungguhan. Buka server/.env lalu ganti nilainya dengan kunci API dari console.anthropic.com.',
    );
    err.code = 'NO_API_KEY';
    throw err;
  }
  const backend = backendAI();
  if (!client || client._backend !== backend) {
    client =
      backend === 'vertex'
        ? /*
           * Tidak ada kunci yang diserahkan. Kredensial diambil sendiri dari
           * Application Default Credentials — di Cloud Run itu berarti service
           * account layanan ini, tanpa rahasia yang perlu dipasang atau bocor.
           *
           * `region` bawaan 'global'; SDK menyusun URL-nya sendiri dari nilai
           * ini (https://<region>-aiplatform.googleapis.com/v1), jadi region
           * yang tidak melayani Claude gagal sebagai 404, bukan sebagai galat
           * konfigurasi yang jelas.
           */
          new AnthropicVertex({
            projectId: getProjectId(),
            region: (process.env.CLOUD_ML_REGION ?? process.env.VERTEX_REGION ?? '').trim() || 'us-central1',
            maxRetries: 2,
            timeout: 120_000,
          })
        : new Anthropic({ maxRetries: 2, timeout: 120_000 });
    client._backend = backend;
  }
  return client;
}

/** Menerjemahkan error SDK menjadi pesan berbahasa Indonesia + kode HTTP. */
export function describeError(err) {
  if (err?.code === 'NO_API_KEY') {
    return { status: 503, message: err.message };
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return { status: 503, message: 'Kunci API Anthropic ditolak. Periksa nilai ANTHROPIC_API_KEY di server.' };
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return { status: 503, message: 'Kunci API tidak punya akses ke model ini.' };
  }
  if (err instanceof Anthropic.RateLimitError) {
    return { status: 429, message: 'Layanan AI sedang penuh. Coba lagi sebentar lagi ya.' };
  }
  /*
   * WAJIB di atas cabang APIConnectionError umum di bawahnya.
   *
   * Kredensial Google Cloud yang hilang, kedaluwarsa, atau tanpa peran
   * roles/aiplatform.user datang sebagai APIConnectionError — sama persis
   * dengan kabel jaringan yang putus. Tanpa cabang ini, pesan yang tampil
   * adalah "periksa koneksi internet server", dan pendamping akan mengejar
   * masalah jaringan selama berjam-jam untuk sesuatu yang sebenarnya satu
   * baris IAM. Ini kesalahan yang sama bentuknya dengan cerita kunci contoh
   * di komentar isConfigured() di atas: galat yang menunjuk ke tempat salah.
   */
  if (err instanceof Anthropic.APIConnectionError && /google|credential|oauth/i.test(err.message ?? '')) {
    return {
      status: 503,
      message:
        'Server tidak bisa memperoleh kredensial Google Cloud. Periksa service account layanan ini dan peran roles/aiplatform.user.',
    };
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return { status: 502, message: 'Server tidak bisa menghubungi layanan AI. Periksa koneksi internet server.' };
  }
  if (err instanceof Anthropic.APIError) {
    const status = err.status >= 500 ? 502 : 400;
    return { status, message: `Layanan AI menolak permintaan (${err.status}). ${err.message ?? ''}`.trim() };
  }
  /*
   * Galat yang dilempar aplikasi ini sendiri — penolakan sistem keamanan (422),
   * jawaban terpotong (502) — sudah membawa status dan kalimat siap-tampil,
   * jadi dipakai apa adanya alih-alih ditukar dengan "kesalahan tak terduga".
   *
   * URUTANNYA PENTING: pemeriksaan ini WAJIB di bawah seluruh cabang SDK.
   * Setiap galat SDK juga punya `.status` (401, 403, 429, …), jadi selama
   * pemeriksaan ini dilakukan lebih dulu, tidak satu pun cabang di atas pernah
   * tercapai. Itulah yang dulu terjadi di rute chat dan rekomendasi: keduanya
   * menyaring `err.status` sendiri SEBELUM memanggil fungsi ini, sehingga
   * kunci API yang ditolak sampai ke layar peserta sebagai gumpalan JSON
   * berbahasa Inggris — `401 {"type":"error","error":{...}}` — bukan sebagai
   * kalimat yang memberi tahu pendamping apa yang harus diperbaiki.
   */
  if (err?.status) {
    return { status: err.status, message: err.message };
  }
  return { status: 500, message: 'Terjadi kesalahan tak terduga di server.' };
}

/**
 * Konsultasi chat — dialirkan token demi token.
 * @param {{profile: object|null, metrics: object, history: Array, message: string,
 *          onText: (chunk: string) => void, signal?: AbortSignal}} opts
 * @returns {Promise<{text: string, usage: object, stopReason: string|null}>}
 */
export async function streamChat({ profile, metrics, cashbook = '', belajar = {}, history, message, onText, signal }) {
  const anthropic = getClient();

  const messages = [
    ...history.slice(-16).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: message },
  ];

  const stream = anthropic.messages.stream(
    {
      model: getModel(),
      max_tokens: 4000,
      system: chatSystem(profile, metrics, cashbook, belajar),
      messages,
      // Konsultasi singkat: matikan thinking dan pakai effort rendah supaya
      // jawaban muncul cepat. Rekomendasi (di bawah) memakai penalaran penuh.
      thinking: { type: 'disabled' },
      output_config: { effort: 'low' },
    },
    { signal },
  );

  stream.on('text', (delta) => onText(delta));

  const final = await stream.finalMessage();
  const text = final.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  /*
   * Alasan berhenti WAJIB diperiksa, sama seperti di rekomendasi.
   *
   * Dulu nilai ini dikembalikan lalu tidak pernah dibaca siapa pun. Akibatnya
   * jawaban yang terpotong di tengah kalimat tersimpan ke riwayat dan tampil
   * dengan stempel waktu seolah-olah selesai — pemilik usaha membaca setengah
   * nasihat keuangan tanpa satu pun tanda bahwa ada lanjutannya.
   */
  if (final.stop_reason === 'refusal') {
    const err = new Error(
      'Pertanyaan ini ditolak oleh sistem keamanan AI. Coba tanyakan dengan kalimat lain, atau tanyakan hal seputar keuangan usahamu.',
    );
    err.status = 422;
    throw err;
  }

  return { text, usage: final.usage, terpotong: final.stop_reason === 'max_tokens' };
}

/**
 * Rekomendasi personal berdasarkan profil usaha, dikembalikan sebagai JSON
 * terstruktur (structured outputs) sehingga selalu bisa di-parse.
 */
export async function generateRecommendations({ profile, metrics, cashbook = '', belajar = {}, signal }) {
  const anthropic = getClient();

  /*
   * DIALIRKAN (streaming), meski jawabannya baru dipakai setelah lengkap.
   *
   * Bukan demi menampilkan tulisan bertahap — rekomendasi memang baru berguna
   * setelah utuh — melainkan demi jam dinding. Permintaan biasa harus selesai
   * dalam satu batas waktu (di sini 120 detik); dengan jatah 32.000 token dan
   * penalaran adaptif, satu penyusunan yang panjang bisa melewatinya. Yang
   * terjadi kemudian adalah kegagalan yang paling merugikan: peserta sudah
   * menunggu, tokennya sudah terpakai di sisi Anthropic, dan yang dia terima
   * cuma pesan galat. Sambungan yang dialirkan tidak pernah dianggap
   * menggantung selama datanya masih mengalir.
   */
  /*
   * `signal` WAJIB diteruskan, dan inilah panggilan yang paling perlu.
   *
   * Rute chat sudah membatalkan panggilannya saat peserta menutup aplikasi;
   * rute ini dulu tidak — padahal justru di sinilah jatahnya paling besar
   * (`max_tokens: 32000` dengan penalaran adaptif) dan waktunya paling lama.
   * Peserta yang menutup peramban saat menunggu tetap membayar seluruh
   * penyusunan yang tidak akan pernah dia lihat, dan biayanya tidak pernah
   * tercatat di jejak token miliknya karena `recordUsage` tidak sempat jalan.
   */
  const stream = anthropic.messages.stream(
    {
      /*
       * Penalaran dan jawaban berbagi jatah yang sama, jadi angka ini bukan
       * target melainkan JARING PENGAMAN terhadap jawaban terpotong. Menaikkannya
       * tidak membuat model menulis lebih panjang dan tidak menaikkan biaya:
       * yang ditagih adalah token yang benar-benar dihasilkan (biasanya
       * 2.000–4.000), bukan batas ini.
       */
      max_tokens: 32000,
      model: getModel(),
      system: recommendationSystem(profile, metrics, cashbook, belajar),
      messages: [{ role: 'user', content: recommendationRequest(profile, metrics) }],
      // Analisis butuh penalaran lebih dalam daripada chat biasa.
      thinking: { type: 'adaptive' },
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: RECOMMENDATION_SCHEMA },
      },
    },
    { signal },
  );

  const response = await stream.finalMessage();

  if (response.stop_reason === 'refusal') {
    const err = new Error('Permintaan ditolak oleh sistem keamanan AI. Coba ubah isian profil usaha.');
    err.status = 422;
    throw err;
  }

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  if (response.stop_reason === 'max_tokens' || !text) {
    const err = new Error('Jawaban AI terpotong. Coba jalankan ulang pembuatan rekomendasi.');
    err.status = 502;
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const err = new Error('AI mengembalikan format yang tidak terbaca. Coba lagi.');
    err.status = 502;
    throw err;
  }

  return { data: parsed, usage: response.usage };
}

/**
 * Membaca foto nota dan mengembalikan JSON terstruktur.
 *
 * Satu-satunya perbedaan bentuk dari rekomendasi di atas: permintaannya
 * membawa blok gambar base64 di depan teksnya. Pola streaming yang sama
 * dipertahankan dengan alasan yang sama — peserta sedang menunggu dengan
 * ponsel di tangan, dan sambungan yang menggantung lebih buruk daripada
 * galat yang cepat.
 *
 * Teks jawaban TIDAK dipercaya mentah-mentah: dilempar ke parseNotaJson +
 * sanitasiHasilNota (lib/nota.js) oleh pemanggilnya.
 *
 * @param {{imageBase64: string, mimeType: string, signal?: AbortSignal}} opts
 * @returns {Promise<{data: object, usage: object}>}
 */
export async function analyzeNota({ imageBase64, mimeType, signal }) {
  const anthropic = getClient();

  const stream = anthropic.messages.stream(
    {
      max_tokens: 2000,
      model: getModel(),
      system: notaSystem(),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
            { type: 'text', text: notaRequest() },
          ],
        },
      ],
      // Membaca nota bukan penalaran berat; kecepatan lebih penting di sini.
      thinking: { type: 'disabled' },
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: NOTA_SCHEMA },
      },
    },
    { signal },
  );

  const response = await stream.finalMessage();

  if (response.stop_reason === 'refusal') {
    const err = new Error('Foto nota ditolak oleh sistem keamanan AI. Coba foto ulang dengan sudut yang berbeda.');
    err.status = 422;
    throw err;
  }

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  if (response.stop_reason === 'max_tokens' || !text) {
    const err = new Error('Hasil baca nota terpotong. Coba foto lebih dekat pada bagian totalnya.');
    err.status = 502;
    throw err;
  }

  return { data: parseNotaJson(text), usage: response.usage };
}

/**
 * Check-up keuangan: AI menilai STATUS dari angka yang diberikan aplikasi.
 * Pola streaming analyzeNota di atas, dengan konteks angka di system —
 * model hanya memberi status dan saran, bukan angka baru.
 *
 * @param {{metricsTeks: string, perubahanTeks: string, signal?: AbortSignal}} opts
 * @returns {Promise<{data: object, usage: object}>}
 */
export async function analyzeCheckup({ metricsTeks, perubahanTeks, signal }) {
  const anthropic = getClient();

  const stream = anthropic.messages.stream(
    {
      max_tokens: 2000,
      model: getModel(),
      system: checkupSystem([metricsTeks, perubahanTeks].filter(Boolean).join('\n\n')),
      messages: [{ role: 'user', content: checkupRequest() }],
      // Penilaian singkat atas data yang sudah disiapkan — kecepatan diutamakan.
      thinking: { type: 'disabled' },
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: CHECKUP_SCHEMA },
      },
    },
    { signal },
  );

  const response = await stream.finalMessage();

  if (response.stop_reason === 'refusal') {
    const err = new Error('Permintaan check-up ditolak sistem keamanan AI. Coba lagi sebentar.');
    err.status = 422;
    throw err;
  }

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  if (response.stop_reason === 'max_tokens' || !text) {
    const err = new Error('Hasil check-up terpotong. Coba lagi sebentar.');
    err.status = 502;
    throw err;
  }

  return { data: parseNotaJson(text), usage: response.usage };
}

/**
 * Soal latihan personal dari materi modul + angka peserta sendiri.
 * Pola streaming analyzeCheckup di atas — AI hanya MENYUSUN soal dari
 * angka yang dikirim; penilaiannya tetap deterministik di lib/latihan.js.
 *
 * @param {{materiTeks: string, angkaTeks: string, signal?: AbortSignal}} opts
 * @returns {Promise<{data: object, usage: object}>}
 */
export async function analyzeLatihanAi({ materiTeks, angkaTeks, signal }) {
  const anthropic = getClient();

  const stream = anthropic.messages.stream(
    {
      max_tokens: 1500,
      model: getModel(),
      system: latihanAiSystem(materiTeks, angkaTeks),
      messages: [{ role: 'user', content: latihanAiRequest() }],
      thinking: { type: 'disabled' },
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: LATIHAN_AI_SCHEMA },
      },
    },
    { signal },
  );

  const response = await stream.finalMessage();

  if (response.stop_reason === 'refusal') {
    const err = new Error('Permintaan soal latihan ditolak sistem keamanan AI. Coba lagi sebentar.');
    err.status = 422;
    throw err;
  }

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  if (response.stop_reason === 'max_tokens' || !text) {
    const err = new Error('Hasil soal latihan terpotong. Coba lagi sebentar.');
    err.status = 502;
    throw err;
  }

  return { data: parseNotaJson(text), usage: response.usage };
}
