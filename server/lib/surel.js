/**
 * Pengirim surel — satu titik keluar, jujur soal apa yang terjadi.
 *
 * ------------------------------------------------------------------
 * PRINSIP: TIDAK PERNAH PURA-PURA TERKIRIM.
 *
 * Sampai penyedia surel sungguhan dikonfigurasi (MAIL_PROVIDER + kuncinya),
 * tautan ajaib TIDAK dikirim ke mana pun. Menjawab "terkirim" sementara
 * tautannya tidak sampai siapa-siapa adalah kebohoran kecil yang mahal:
 * pengguna menunggu surel yang tidak pernah datang, lalu menuduh spam,
 * lalu kehilangan kepercayaan pada jalur masuknya. Lebih baik terang:
 *
 *   MAIL_PROVIDER tidak diatur → mode DEV: tautan dicatat di log server
 *       (log.info 'surel') sebagai `DEV-LINK`. Jalur bisa diuji penuh dari
 *       log lokal; produksi tanpa penyedia akan terlihat keras di log.
 *   MAIL_PROVIDER=test → kotak keluar di memori (KOTAK_KELUAR) — dipakai
 *       uji otomatis untuk membaca tautan tanpa jaringan.
 *   MAIL_PROVIDER=smtp|resend|... → slot penyedia; belum ada implementasi —
 *       dikonfigurasi saja akan ditolak keras saat start rute (bukan diam).
 */
import { log } from './log.js';

/** Kotak keluar mode test: { to, subject, text, ts }[] — hanya terisi saat MAIL_PROVIDER=test. */
export const KOTAK_KELUAR = [];

const PENYEDIA_DIKENAL = new Set(['test']);

export function penyediaTerkonfigurasi() {
  const p = String(process.env.MAIL_PROVIDER ?? '').trim().toLowerCase();
  return p === '' ? null : p;
}

/**
 * Mengirim satu surel. Mengembalikan { terkirim: boolean, mode: string }.
 *
 * Satu-satunya mode yang menjawab terkirim=true adalah test (kotak keluar
 * benar-benar menerima isinya). Mode DEV menjawab terkirim=false — tautan
 * hidup di log, bukan di inbox siapa pun.
 */
export async function kirimSurel({ to, subject, text }) {
  const penyedia = penyediaTerkonfigurasi();

  if (penyedia === 'test') {
    KOTAK_KELUAR.push({ to, subject, text, ts: new Date().toISOString() });
    return { terkirim: true, mode: 'test' };
  }

  if (!penyedia) {
    log.info('surel', 'DEV-LINK — penyedia surel belum dikonfigurasi; tautan hanya ada di log ini', { to, subject });
    return { terkirim: false, mode: 'dev' };
  }

  // Penyedia dikenal namun belum diimplementasikan: gagal keras, bukan diam.
  log.error('surel', 'MAIL_PROVIDER dikenal tetapi belum diimplementasikan', { penyedia });
  throw new Error(`Mail provider '${penyedia}' is not implemented yet.`);
}
