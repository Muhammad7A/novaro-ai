/**
 * Jadwal belajar — SELF-PACED sejak keputusan 2026-09-13 (RESEARCH-DEPENDENCY-REMOVAL.md).
 *
 * ------------------------------------------------------------------
 * KENAPA BERKAS INI MASIH ADA (dan kenapa isinya sekarang kecil)
 *
 * Dulu di sini hidup gerbang maju satu-sesi-per-hari yang tanggal mulainya
 * ditetapkan pendamping (`npm run users -- mulai`) — instrumen intervensi
 * tujuh hari untuk kohort riset, lengkap dengan perhitungan hari, saklar
 * UNLOCK_ALL_MODULES, dan pesan "sesi terbuka pada <tanggal>". Semua itu
 * dihapus: V3 adalah produk komersial, dan pacing paksa harian adalah desain
 * eksperimen, bukan kebutuhan pengguna.
 *
 * Yang DIJAGA persis adalah nama-nama fungsi dan BENTUK payload `belajar`:
 * /api/me, /api/cashbook, kartu fokus, konteks modul AI, dan frontend membaca
 * shape ini di banyak tempat. Mengubah bentuknya berarti menyentuh SPA 4.4k
 * baris tanpa alasan — jadi isinya yang berubah (selalu terbuka), bentuknya
 * yang diwariskan.
 *
 *   - `sesiTerbuka()`  → JUMLAH_SESI (semuanya)
 *   - `modulTerbuka()` → benar selama nomornya benar-benar ada; nomor asing
 *     tetap tidak pernah lolos sebagai materi
 *   - `ringkasJadwal()`→ bentuk lama, `semuaTerbuka: true`
 *   - `jadwalUntukAI()`→ satu baris netral untuk prompt
 */
import { SESI_HARIAN, cariModul } from './kurikulum.js';

/** Jumlah sesi pada jalur dasar. */
export const JUMLAH_SESI = SESI_HARIAN.length;

/**
 * Nomor sesi tertinggi yang terbuka — self-paced: semuanya, sejak hari pertama.
 * Dibatasi JUMLAH_SESI (bukan angka bebas) supaya perbandingan
 * `sesi <= sesiTerbuka` tidak pernah menyaksikan nomor yang tidak ada.
 */
export function sesiTerbuka() {
  return JUMLAH_SESI;
}

/**
 * Modul boleh dibuka bila nomornya benar-benar ada. Pustaka maupun sesi harian
 * berlaku sama; yang ditolak hanya nomor yang tidak dikenal.
 */
export function modulTerbuka(no) {
  return Boolean(cariModul(no));
}

/** Tidak ada lagi "tanggal terbuka" — null untuk kompatibilitas bentuk payload. */
export function tanggalSesiTerbuka() {
  return null;
}

/**
 * Ringkasan untuk /api/me, /api/cashbook, dan tanggapan modul — bentuk lama,
 * isi self-paced. `dimulai: true` tanpa syarat: tidak ada lagi status
 * "belum dimulai" yang membuat satu sesi pun terkunci.
 */
export function ringkasJadwal() {
  return {
    mulaiPada: null,
    dimulai: true,
    hariKe: null,
    sesiTerbuka: JUMLAH_SESI,
    jumlahSesi: JUMLAH_SESI,
    sesiBerikut: null,
    berikutTerbukaPada: null,
    semuaTerbuka: true,
  };
}

/**
 * Satu baris untuk prompt AI. Dulu baris ini melarang model menyuruh peserta
 * membaca sesi yang belum terbuka; kini justru perlu diberi tahu bahwa semua
 * jalur bebas diakses, agar model tidak mewarisi kebiasaan lama menahan-nahan.
 */
export function jadwalUntukAI() {
  return '- Seluruh sesi belajar terbuka (self-paced): peserta boleh membaca modul mana pun, kapan saja.';
}
