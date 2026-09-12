/**
 * Rel proposal T1 surface #1 (scan-nota) — token HMAC sekali-pakai.
 *
 * ------------------------------------------------------------------
 * KENAPA BERKAS INI ADA
 *
 * Keputusan AI-TRUST-AUTOPILOT (B′, §9.2/§21.4, addendum 2026-09-12)
 * mengautorisasi T1 HANYA untuk scan-nota: usulan AI yang dikonfirmasi
 * manusia boleh lahir sebagai baris berasal-usul 'proposal' — tapi hanya
 * lewat token yang DITERBITKAN server saat scan dan DIKONSUMSI mutator saat
 * konfirmasi. Tanpa token, 'proposal' tidak bisa dipalsukan dari tubuh
 * permintaan: asal dan proposalId tidak pernah dipercaya dari luar mutator.
 *
 * ------------------------------------------------------------------
 * BENTUK TOKEN (§21.4 — keputusan irreversibel)
 *
 *   np1.<base64url(JSON payload)>.<hex hmac-sha256>
 *
 *   payload : { v: 1, id: 'prop_…', tier: 'ok'|'warning'|'low'|null,
 *               iat: ms, exp: ms }
 *   prefix  : np1 — tokenVersion melekat di awal supaya bentuk asing
 *             ditolak sebelum payload dibaca.
 *   hmac    : dihitung atas 'np1.<body>' dengan NOVA_PROPOSAL_SECRET.
 *
 * ------------------------------------------------------------------
 * LABEL JUJUR SOAL SEKALI PAKAI (jti)
 *
 * Tidak ada penyimpanan jti terpisah. Satu-satunya bukti konsumsi adalah
 * KEBERADAAN BARIS yang membawa proposalId itu — dicek mutator terhadap
 * buku kas pengguna yang sedang dikunci. Konsekuensinya dinyatakan terbuka:
 * token "sekali pakai DALAM TTL dan seumur toko" — bukan tanpa syarat.
 * Dua celah yang diakui:
 *   - token yang TIDAK PERNAH dikonfirmasi tidak meninggalkan jejak
 *     konsumsi (abandonment = shown-tanpa-baris, konvensi terdokumentasi
 *     §9.3 — bukan kebocoran: ia tidak pernah menjadi baris);
 *   - pada penyimpanan yang kehilangan datanya (JSON /tmp di Cloud Run),
 *     baris dan jti hilang bersama — di sana seluruh buku kasnya pun hilang.
 *
 * ------------------------------------------------------------------
 * GERBANG FITUR (default MATI)
 *
 * NOVA_PROPOSAL_SCAN === '1' (literal, konvensi NOVA_REQUIRE_PERSISTENT_
 * STORE) membuka penerbitan token. Build ≠ exposed: gerbang ini hanya boleh
 * dibuka window F setelah deploy kode ini dan rung uji-hidup-nya sendiri.
 * Rahasia dari env NOVA_PROPOSAL_SECRET; tanpa rahasia, penerbitan menolak
 * diri (null) dan jalur proposal mati dengan log galat — scan biasa tetap
 * hidup (degradasi jujur R6), tidak ada token lemah darurat.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Versi format token — naik = bentuk baru + keputusan sadar (§21.4). */
export const TOKEN_VERSION = 1;

/** Awalan token: np<versi>. */
export const PREFIX_TOKEN = `np${TOKEN_VERSION}`;

/**
 * Umur token. Pendek dengan sengaja: alur scan → konfirmasi berlangsung
 * hitungan menit; 15 menit cukup untuk peserta yang memotret, memeriksa,
 * lalu menyimpan — dan terlalu pendek untuk dipegang besok-besok.
 */
export const TTL_MS = 15 * 60 * 1000;

/** Stempel skema fitur (baris tabel fitur M1): rel proposal scan-nota. */
export const VERSI_FITUR_PROPOSAL_SCAN = 1;

/** Id proposal baru — pola sama dengan trx_/adv_ (diterima pola 'id' jejak). */
export function buatIdProposal() {
  return `prop_${randomBytes(6).toString('hex')}`;
}

/**
 * Gerbang exposure — default MATI; hanya literal '1' yang membuka.
 * Dibaca per panggilan (bukan diimpor sekali) supaya uji dan window F bisa
 * mengubahnya tanpa memutar ulang proses.
 */
export function proposalScanAktif() {
  return process.env.NOVA_PROPOSAL_SCAN === '1';
}

/** Rahasia HMAC dari env, atau null bila belum dipasang. */
export function rahasiaToken() {
  const r = (process.env.NOVA_PROPOSAL_SECRET ?? '').trim();
  return r ? r : null;
}

const b64url = (s) => Buffer.from(s, 'utf8').toString('base64url');
const hexSama = (a, b) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));

/**
 * Menerbitkan token untuk satu usulan scan — atau NULL bila rahasia belum
 * dipasang (fail-closed: penelepon wajib memperlakukan null sebagai "jalur
 * proposal tidak tersedia", bukan menerbitkan token tanpa kunci).
 *
 * @param {{proposalId: string, tingkat?: string|null}} usulan
 * @param {{kini?: Date}} opts jam penerbitan (selalu parameter — konvensi uji)
 */
export function terbitkanToken({ proposalId, tingkat = null }, { kini = new Date() } = {}) {
  const rahasia = rahasiaToken();
  if (!rahasia) return null;
  if (typeof proposalId !== 'string' || !/^prop_[0-9a-f]{12}$/.test(proposalId)) {
    throw new Error(`id proposal tidak sah: ${proposalId}`);
  }
  const iat = kini.getTime();
  const payload = { v: TOKEN_VERSION, id: proposalId, tier: tingkat ?? null, iat, exp: iat + TTL_MS };
  const body = b64url(JSON.stringify(payload));
  const mac = createHmac('sha256', rahasia).update(`${PREFIX_TOKEN}.${body}`).digest('hex');
  return `${PREFIX_TOKEN}.${body}.${mac}`;
}

/**
 * Galat token bertipe — kode + status siap rute, saudara GalatMutasi.
 * Dibungkus GalatMutasi oleh mutator toko (satu taksonomi di batas tulis).
 */
export class GalatToken extends Error {
  constructor(kode, status, message) {
    super(message);
    this.name = 'GalatToken';
    this.kode = kode;
    this.status = status;
  }
}

/**
 * Membuka dan memverifikasi token: bentuk, versi, HMAC, kedaluwarsa.
 * TIDAK memeriksa konsumsi — keberadaan baris (jti) adalah urusan mutator,
 * yang memegang buku kas terkunci. Verifikasi di sini murni kriptografis
 * dan temporal, supaya bisa diuji tanpa toko.
 *
 * @returns {{proposalId: string, tingkat: string|null, exp: number}}
 * @throws {GalatToken} token-tak-sah (400) / token-versi (400) / token-kedaluwarsa (400)
 */
export function bukaToken(token, { kini = new Date() } = {}) {
  const rahasia = rahasiaToken();
  const galat = (kode, msg) => new GalatToken(kode, 400, msg);

  const bagian = String(token ?? '').split('.');
  if (bagian.length !== 3 || bagian[0] !== PREFIX_TOKEN || !bagian[1] || !bagian[2]) {
    throw galat('token-tak-sah', 'Token usulan tidak dikenali bentuknya. Scan ulang notanya.');
  }
  const mac = createHmac('sha256', rahasia ?? '').update(`${bagian[0]}.${bagian[1]}`).digest('hex');
  if (!hexSama(bagian[2], mac)) {
    throw galat('token-tak-sah', 'Token usulan tidak lolos pemeriksaan. Scan ulang notanya.');
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(bagian[1], 'base64url').toString('utf8'));
  } catch {
    throw galat('token-tak-sah', 'Token usulan tidak terbaca. Scan ulang notanya.');
  }
  if (payload?.v !== TOKEN_VERSION) {
    throw new GalatToken('token-versi', 400, 'Versi token usulan tidak dikenali. Scan ulang notanya.');
  }
  if (typeof payload.id !== 'string' || !/^prop_[0-9a-f]{12}$/.test(payload.id)) {
    throw galat('token-tak-sah', 'Token usulan membawa id yang tidak sah.');
  }
  if (typeof payload.exp !== 'number' || kini.getTime() > payload.exp) {
    throw new GalatToken('token-kedaluwarsa', 400, 'Token usulan sudah kedaluwarsa. Scan ulang notanya bila masih ingin menyimpannya.');
  }
  return { proposalId: payload.id, tingkat: payload.tier ?? null, exp: payload.exp };
}

/**
 * Kosakata tertutup alasan penolakan eksplisit (proposal_rejected.alasan).
 * Kata pendek terdaftar — bukan teks bebas; menambah alasan = keputusan sadar
 * yang terlihat di diff ratsu/jejak.
 */
export const ALASAN_TOLAK_SAH = ['salah-jumlah', 'salah-kategori', 'bukan-transaksi', 'lainnya'];
