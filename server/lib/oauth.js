/**
 * Slot OAuth — gagal-tutup sebelum dikonfigurasi, tidak pernah pura-pura.
 *
 * ------------------------------------------------------------------
 * STATUS: INFRASTRUKTUR DULU, IMPLEMENTASI MENYUSUL (keputusan owner
 * 2026-09-25: "bikin infra OAuth dulu sebelum implementasi OAuth").
 *
 * Yang hidup hari ini: pendaftaran penyedia, pemeriksaan konfigurasi,
 * penyusunan URL otorisasi, dan rute start/callback yang menjawab JUJUR
 * (503 + pesan jelas) selama kunci belum terpasang — pola yang sama dengan
 * gerbang proposal scan (NOVA_PROPOSAL_SCAN): tanpa rahasia, jalurnya mati
 * terang-terangan, bukan menyala setengah.
 *
 * Yang menyusul: penukaran kode (token exchange) dan pembuatan akun dari
 * identitas Google. Saat itu terpasang, callback tinggal menelepon
 * store.terbitkanSesi(userId, 'oauth') — bentuk sesinya sudah siap.
 */

/** Penyedia yang dikenal. Kunci dibaca SAAT DIPANGGIL agar bisa diuji tanpa re-import. */
export const PENYEDIA_OAUTH = {
  google: {
    id: 'google',
    // Titik akhir tetap milik Google — bukan rahasia, bagian dari spesifikasi.
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    scope: 'openid email profile',
    clientId: () => process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() || null,
    clientSecret: () => process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() || null,
  },
};

/** Apakah penyedia ini siap dipakai? Butuh client id + secret + host publik untuk redirect URI. */
export function penyediaSiap(nama, publicHost) {
  const p = PENYEDIA_OAUTH[nama];
  if (!p) return false;
  return Boolean(p.clientId() && p.clientSecret() && publicHost);
}

/** Alamat otorisasi lengkap dengan state — atau null bila belum siap. */
export function urlOtorisasi(nama, { state, redirectUri }) {
  const p = PENYEDIA_OAUTH[nama];
  if (!p || !p.clientId()) return null;
  const u = new URL(p.authorizationUrl);
  u.searchParams.set('client_id', p.clientId());
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', p.scope);
  u.searchParams.set('state', state);
  return u.toString();
}

/** Redirect URI bentuk tetap untuk host publik ini. */
export const uriPanggilanBalik = (publicHost) => `https://${publicHost}/api/auth/oauth/callback`;

/**
 * Penukaran kode otorisasi → identitas penyedia.
 *
 * BELUM DIIMPLEMENTASIKAN — sengaja melempar, bukan mengembalikan data kosong:
 * pemanggilnya (rute) wajib tahu jalur ini belum hidup, dan pengguna wajib
 * menerima 503 yang jujur alih-alih masuk dengan identitas kosong.
 */
export async function tukarKode(/* nama, kode, redirectUri */) {
  throw new Error('OAuth token exchange is not implemented yet (infra-first phase).');
}
