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
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

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

/* ------------------------------------------- Token verifikasi signup (W1) */

/**
 * Token verifikasi pendaftaran mandiri — HMAC bernegara-minimal, disiplin
 * yang sama dengan lib/proposal.js (awalan versi + payload base64url + mac
 * hex, TTL pendek, galat bertipe) — DITULIS DI SINI, modul autentikasi,
 * BUKAN modul kripto kedua: kredensial auth punya satu rumah.
 *
 *   su1.<base64url payload>.<hex hmac-sha256>
 *   payload: { v: 1, email, iat, exp, jti }
 *
 * Bedanya dengan token proposal: email ikut DI DALAM payload — token tiba
 * hanya di milik surel itu, dan verifikasi tak perlu mencari keadaan
 * penerbitan. Sekali-pakai dengan label jujur: jti TIDAK disimpan di
 * mana pun — bukti konsumsinya adalah `emailVerifiedAt` terisi pada akun
 * (keberadaan baris, pola proposal §21.4); putaran kedua = 409 duplikat.
 */
export const TOKEN_SIGNUP_VER = 1;
export const PREFIX_TOKEN_SIGNUP = `su${TOKEN_SIGNUP_VER}`;
export const TTL_SIGNUP_MS = 15 * 60 * 1000;

/** Gerbang fitur signup: rahasia HMAC dari env; tanpanya fitur OFF fail-closed. */
export function rahasiaSignup() {
  const r = (process.env.NOVA_SIGNUP_SECRET ?? '').trim();
  return r ? r : null;
}

export function signupTersedia() {
  return rahasiaSignup() !== null;
}

/** requestHash = HMAC-SHA256(email, rahasia) — unreversible tanpa rahasia, aman untuk jejak/ekspor anonim. */
export function hashPermintaan(email) {
  return createHmac('sha256', rahasiaSignup() ?? '').update(String(email).toLowerCase()).digest('hex');
}

const hexSama = (a, b) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));

const galatToken = (kode, pesan) => {
  const e = new Error(pesan);
  e.kode = kode;
  e.status = 401;
  return e;
};

/**
 * Menerbitkan token verifikasi untuk satu surel — atau null bila rahasia
 * belum dipasang (pemanggil memperlakukan null sebagai fitur off).
 */
export function terbitkanTokenSignup(email, { kini = Date.now() } = {}) {
  const rahasia = rahasiaSignup();
  if (!rahasia) return null;
  const iat = kini;
  const payload = {
    v: TOKEN_SIGNUP_VER,
    email: String(email).toLowerCase(),
    iat,
    exp: iat + TTL_SIGNUP_MS,
    jti: randomBytes(12).toString('hex'),
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const mac = createHmac('sha256', rahasia).update(`${PREFIX_TOKEN_SIGNUP}.${body}`).digest('hex');
  return `${PREFIX_TOKEN_SIGNUP}.${body}.${mac}`;
}

/**
 * Membuka token verifikasi: bentuk, versi, HMAC, kedaluwarsa. TIDAK memeriksa
 * konsumsi — keberadaan `emailVerifiedAt` adalah urusan mutator store.
 *
 * @returns {{email: string, exp: number}}
 * @throws {Error} kode 'token-tak-sah' | 'token-kedaluwarsa' (status 401)
 */
export function bukaTokenSignup(token, { kini = Date.now() } = {}) {
  const bagian = String(token ?? '').split('.');
  if (bagian.length !== 3 || bagian[0] !== PREFIX_TOKEN_SIGNUP || !bagian[1] || !bagian[2]) {
    throw galatToken('token-tak-sah', 'This signup link is not valid. Request a new one.');
  }
  const mac = createHmac('sha256', rahasiaSignup() ?? '').update(`${bagian[0]}.${bagian[1]}`).digest('hex');
  if (!hexSama(bagian[2], mac)) {
    throw galatToken('token-tak-sah', 'This signup link is not valid. Request a new one.');
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(bagian[1], 'base64url').toString('utf8'));
  } catch {
    throw galatToken('token-tak-sah', 'This signup link is not valid. Request a new one.');
  }
  if (payload?.v !== TOKEN_SIGNUP_VER || !emailSah(payload.email)) {
    throw galatToken('token-tak-sah', 'This signup link is not valid. Request a new one.');
  }
  if (typeof payload.exp !== 'number' || kini > payload.exp) {
    throw galatToken('token-kedaluwarsa', 'This signup link has expired. Request a new one.');
  }
  return { email: payload.email, exp: payload.exp };
}
