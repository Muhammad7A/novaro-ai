/**
 * Autentikasi identitas baru: token sesi + tautan ajaib (magic link) surel.
 *
 * ------------------------------------------------------------------
 * KENAPA INI DIPISAH KE BERKAS SENDIRI
 *
 * Autentikasi aplikasi ini berbasis kode akses: satu rahasia dibagikan
 * pendamping, diketik sekali, lalu ikut header SETIAP permintaan. Model itu
 * sederhana dan cocok untuk pilot — tapi tidak punya tempat bagi identitas
 * email, tidak punya kredensial yang bisa dicabut, dan tidak punya slot
 * bagi OAuth. Edisi enterprise butuh ketiganya.
 *
 * Desain di sini menambah lapisan, TIDAK mengganti yang lama:
 *
 *   kode akses  — tetap sah, tetap dijaga guard.js (jalur legacy/migrasi);
 *   token sesi  — `sesi_<24-byte base64url>`, dicabut bisa, kedaluwarsa
 *                 30 hari, disimpan HASH di data pengguna (pola tokenKartu);
 *   magic link  — `ml_<24-byte base64url>`, sekali pakai, umur 15 menit;
 *   OAuth       — slot penyedia di lib/oauth.js, gagal-tutup sebelum
 *                 dikonfigurasi (pola gerbang proposal, bukan pura-pura).
 *
 * Kredensial baru TIDAK pernah disimpan mentah — hash sha256 tanpa
 * pelipatan huruf besar (base64url peka kapital; hashCode milik kode akses
 * melipat karena kode memang huruf besar semua).
 */
import { createHash, randomBytes } from 'node:crypto';

/** Umur tautan ajaib: 15 menit — cukup untuk menyalin dari surel, cukup pendek untuk tidak menjadi kredensial kedua yang berumur panjang. */
export const TTL_MAGIC_LINK_MS = 15 * 60 * 1000;
/** Umur sesi: 30 hari — perangkat yang dipercaya tidak disuruh masuk ulang tiap hari, tapi tetap bukan selamanya. */
export const TTL_SESI_MS = 30 * 24 * 60 * 60 * 1000;
/** Sesi aktif maksimum per pengguna — perangkat kelima mengeluarkan yang paling tua. */
export const MAKS_SESI = 5;

const FORMAT_EMAIL = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;

/**
 * Menormalkan dan memvalidasi alamat surel.
 *
 * @returns {string|null} surel ternormalkan (huruf kecil), atau null bila bentuknya bukan surel.
 */
export function emailSah(masukan) {
  const email = String(masukan ?? '').trim().toLowerCase();
  if (email.length > 254) return null;
  return FORMAT_EMAIL.test(email) ? email : null;
}

/** Token acak berprefiks — 24 byte (192-bit) base64url, cukup di atas ambang tak-tertebak seperti token kartu (144-bit). */
export function tokenBaru(prefiks) {
  return `${prefiks}_${randomBytes(24).toString('base64url')}`;
}

/** Hash token untuk disimpan. Tanpa trim, tanpa pelipatan kapital — token dipakai apa adanya. */
export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

/** Bentuk sah token sesi yang tiba di header Authorization. */
export const FORMAT_TOKEN_SESI = /^sesi_[A-Za-z0-9_-]{20,}$/;

/**
 * Sesi baru siap disimpan pada `user.sessions`.
 * Pemanggil menaruh hasil `hashToken(token)`; token mentah tidak pernah
 * dikembalikan ke penyimpanan.
 */
export function entriSesi(token, kini = Date.now()) {
  return {
    hash: hashToken(token),
    dibuat: new Date(kini).toISOString(),
    kedaluwarsa: new Date(kini + TTL_SESI_MS).toISOString(),
  };
}

export const sesiKedaluwarsa = (s, kini = Date.now()) => new Date(s.kedaluwarsa).getTime() <= kini;

/** Tautan ajaib baru siap disimpan — sekali pakai, berumur pendek. */
export function entriMagicLink(token, kini = Date.now()) {
  return {
    hash: hashToken(token),
    dibuat: new Date(kini).toISOString(),
    kedaluwarsa: new Date(kini + TTL_MAGIC_LINK_MS).toISOString(),
    dipakai: null,
  };
}

export const magicLinkHidup = (m, kini = Date.now()) =>
  !m.dipakai && new Date(m.kedaluwarsa).getTime() > kini;
