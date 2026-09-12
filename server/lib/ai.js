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
 *
 * Pembacaan stream di kedua implementasi dibatasi batas waktu aplikasi yang
 * sama (lib/batas-stream.js): stream yang terputus di tengah atau kehabisan
 * waktu gagal dengan galat bertipe — tidak pernah mengembalikan teks setengah
 * jalan, sehingga tidak ada yang sempat tersimpan.
 */
import { backendAI } from './backend.js';
import * as claude from './claude.js';
import * as gemini from './gemini.js';

export { BACKEND_SAH, backendAI } from './backend.js';
export { batasStreamMs } from './batas-stream.js';

function impl() {
  return backendAI() === 'gemini' ? gemini : claude;
}

/**
 * Nama model yang sedang dipakai — untuk banner, /api/health, dan jejak SSE.
 *
 * Jalur Claude mendelegasikan ke getModel() — fungsi yang SAMA dengan yang
 * memilih model pada tiap permintaan. Memakai konstanta `MODEL` di sini dulu
 * melaporkan `claude-3-5-sonnet-20241022` ketika runtime sebenarnya memanggil
 * `claude-3-5-sonnet-v2@20241022` lewat Vertex: identitas yang tampil di
 * kesehatan, jejak SSE, dan bukti live tidak pernah cocok dengan tagihan.
 * Identitas hanya jujur bila ia DITURUNKAN dari pemilihnya sendiri.
 */
export function modelAktif() {
  return backendAI() === 'gemini' ? gemini.modelAktif() : claude.getModel();
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
