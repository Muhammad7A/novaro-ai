/**
 * Satu pintu ke lapisan AI, apa pun penyedianya.
 *
 * `server.js` dan `scripts/smoke.js` mengimpor dari sini, bukan dari
 * implementasi mana pun, sehingga menukar penyedia tidak menyentuh rute,
 * anggaran token, maupun penyimpanan.
 *
 * Ketiga jalur mengembalikan bentuk data yang sama persis — termasuk `usage`
 * bergaya Anthropic, karena `lib/anggaran.js` menghitung jatah peserta dari
 * nama-nama medan itu. Penerjemahannya dikerjakan di dalam masing-masing
 * implementasi, bukan di sini dan bukan di pemanggilnya.
 */
import { backendAI } from './backend.js';
import * as claude from './claude.js';
import * as gemini from './gemini.js';

export { BACKEND_SAH, backendAI } from './backend.js';

function impl() {
  return backendAI() === 'gemini' ? gemini : claude;
}

/** Nama model yang sedang dipakai — untuk banner, /api/health, dan jejak SSE. */
export function modelAktif() {
  return backendAI() === 'gemini' ? gemini.modelAktif() : claude.MODEL;
}

export function isConfigured() {
  return impl().isConfigured();
}

export function describeError(err) {
  /*
   * Galat dari backendAI() sendiri (NOVA_AI_BACKEND salah ketik) tidak boleh
   * dilempar lagi dari dalam penerjemah galat — di situ ia akan menutupi galat
   * asli yang sedang diterjemahkan.
   */
  let penerjemah;
  try {
    penerjemah = impl().describeError;
  } catch {
    return { status: 500, message: 'Jalur AI belum diatur dengan benar. Periksa NOVA_AI_BACKEND di server.' };
  }
  return penerjemah(err);
}

export function streamChat(opts) {
  return impl().streamChat(opts);
}

export function generateRecommendations(opts) {
  return impl().generateRecommendations(opts);
}

/**
 * Check-up keuangan: AI menilai status dari angka aplikasi.
 * Keluarannya melewati sanitasi di lib/checkup.js sebelum sampai ke pengguna.
 */
export function analyzeCheckup(opts) {
  return impl().analyzeCheckup(opts);
}

/**
 * Soal latihan personal dari materi modul + angka peserta.
 * Keluarannya melewati sanitasiLatihanAI di lib/latihan.js; penilaian
 * jawabannya tetap deterministik dan tidak pernah lewat AI.
 */
export function analyzeLatihanAi(opts) {
  return impl().analyzeLatihanAi(opts);
}

/**
 * Membaca foto nota → JSON terstruktur.
 *
 * Keluarannya TIDAK pernah disimpan langsung di sini: rute pemanggilnya
 * mewajibkan konfirmasi peserta dan menyimpan lewat rute cashbook yang
 * sama dengan input manual. Lapisan AI hanya pembaca, bukan pencatat.
 */
export function analyzeNota(opts) {
  return impl().analyzeNota(opts);
}
