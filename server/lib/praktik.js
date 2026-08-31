/**
 * Praktik modul yang terverifikasi oleh tindakan nyata.
 *
 * ------------------------------------------------------------------
 * KENAPA BERKAS INI ADA
 *
 * "Praktik hari ini" selama ini hanya teks dalam kotak: tidak ada yang tahu
 * apakah pernah dikerjakan. Berkas ini menutupnya dengan cara yang jujur —
 * praktik TIDAK dianggap selesai karena pengguna menekan tombolnya, melainkan
 * karena TINDAKAN yang dimintanya benar-benar terjadi di aplikasi dan tercatat
 * oleh event server yang sudah ada:
 *
 *   - jenis 'transaksi' → terbukti oleh rute POST /api/cashbook yang berhasil
 *     (rute kini mencatat event transaksi_ditambahkan);
 *   - jenis 'laporan'   → terbukti oleh GET /api/report (event report_viewed
 *     yang sudah ada sejak awal).
 *
 * Yang DITANDAI hanyalah modul yang relevan dengan tindakan itu DAN yang sedang
 * menjadi perhatian pengguna: sudah ditandai selesai, atau sesi berikutnya
 * yang sedang dijalaninya. Satu transaksi yang dicatat tidak tiba-tiba
 * mengklaim seluruh praktik di seluruh modul.
 *
 * Klaim buka fitur dan tindakan juga dibedakan di data modulnya sendiri:
 * `aksi.terverifikasi` hanya diisi untuk pasangan praktik–aksi yang benar-
 * benar bisa dibuktikan dari event. Praktik di luar aplikasi (menghitung HPP
 * di kertas, menakar stok) tidak pernah diklaim terverifikasi.
 *
 * Murni: masuk peta done/sudah + jenis aksi, keluar daftar nomor modul yang
 * baru layak ditandai. Penandaannya sendiri dilakukan store.tandaiPraktik.
 */
import { KURIKULUM } from './kurikulum.js';

const JENIS_SAH = new Set(['transaksi', 'laporan']);

/**
 * Daftar nomor modul yang praktiknya baru terverifikasi oleh sebuah aksi.
 *
 * @param {{
 *   done?: Record<number|string, boolean>,
 *   sudah?: Record<number|string, object>,
 *   jenis: 'transaksi'|'laporan',
 *   sesiBerikutNo?: number|null,
 * }} p
 * @returns {number[]} nomor modul urut yang belum ditandai dan kini terbukti.
 */
export function modulPraktikTerverifikasi({
  done = {},
  sudah = {},
  jenis,
  sesiBerikutNo = null,
} = {}) {
  if (!JENIS_SAH.has(jenis)) return [];

  const hasil = [];
  for (const m of KURIKULUM) {
    if (m.aksi?.terverifikasi !== jenis) continue;
    if (sudah[m.no]) continue; // pernah ditandai — jangan dobel
    // Hanya modul yang sedang menjadi perhatian pengguna: selesai dibaca,
    // atau sesi berikutnya yang sedang dia jalani.
    if (!done[m.no] && m.no !== sesiBerikutNo) continue;
    hasil.push(m.no);
  }
  return hasil.sort((a, b) => a - b);
}
