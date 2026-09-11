/**
 * Pembersih hasil rekomendasi AI — kerabat lib/checkup.js dan lib/nota.js.
 *
 * ------------------------------------------------------------------
 * KENAPA BERKAS INI ADA
 *
 * Rekomendasi adalah satu-satunya keluaran AI yang tersimpan: setelah rute
 * menerima JSON dari penyedia, ia langsung masuk `user.recommendations` dan
 * dibaca ulang oleh Saran, kartu Fokus harian (aturan 7 di lib/fokus-harian.js),
 * dan kartu publik. Skema `json_schema` milik penyedia adalah janji jaringan,
 * bukan pemeriksaan server — satu regresi penyedia (atau satu tubuh yang
 * disisipi di antara) lolos apa adanya ke disk dan mengalir ke tiga permukaan
 * tampilan. Karena itu keluarannya diverifikasi ulang DI SINI, di server,
 * sebelum disimpan — pola yang sama dengan check-up dan nota.
 *
 * Kontraknya sama dengan seluruh pembersih di aplikasi ini:
 *   - struktur yang rusak digagalkan dengan galat siap-tampil (502),
 *   - medan yang kepanjangan dipotong, bukan ditolak seluruhnya,
 *   - nilai di luar daftar jatuh ke nilai paling aman,
 *   - medan asing apa pun (termasuk angka karangan) tidak pernah ikut tersimpan
 *     — obyek hasil selalu DIBANGUN ULANG, bukan disebarkan.
 *
 * Tidak ada satu pun medan uang di skema rekomendasi, dan tidak ada yang
 * ditambahkan di sini: rekomendasi adalah nasihan berbentuk teks, bukan usulan
 * transaksi. Angka apa pun di dalam teksnya tetap teks — kartu angka di layar
 * berasal dari perhitungan server.
 */
import { MODUL_MAKS, MODUL_MIN } from './kurikulum.js';

const PRIORITAS_SAH = new Set(['tinggi', 'sedang', 'rendah']);
const POTONG = (v, maks) => String(v ?? '').trim().slice(0, maks);

/** Satu langkah: teks pendek, dan yang kosong dibuang — bukan disimpan kosong. */
function langkahSah(daftar) {
  if (!Array.isArray(daftar)) return [];
  return daftar
    .map((s) => POTONG(s, 200))
    .filter((s) => s.length > 0)
    .slice(0, 4);
}

/**
 * Mengubah keluaran mentah penyedia menjadi rekomendasi yang aman disimpan.
 *
 * @returns {{ringkasan: string, rekomendasi: Array, peringatan: string[],
 *            targetBulanIni: string[]}}
 */
export function sanitasiRekomendasi(mentah) {
  if (!mentah || typeof mentah !== 'object' || Array.isArray(mentah)) {
    const err = new Error('AI mengembalikan format rekomendasi yang tidak terbaca. Coba lagi.');
    err.status = 502;
    throw err;
  }

  /*
   * Ringkasan kosong atau daftar rekomendasi yang kosong berarti tubuh yang
   * tidak bisa dipakai apa pun — digagalkan, bukan disimpan setengah jadi.
   * (sanitasiCheckup menolak `item` kosong dengan alasan yang sama.)
   */
  const ringkasan = POTONG(mentah.ringkasan, 600);

  const rekomendasi = (Array.isArray(mentah.rekomendasi) ? mentah.rekomendasi : [])
    .filter((r) => r && typeof r === 'object' && !Array.isArray(r))
    .slice(0, 5)
    .map((r) => {
      const langkah = langkahSah(r.langkah);
      const judul = POTONG(r.judul, 80);
      const alasan = POTONG(r.alasan, 400);
      // Item tanpa judul dan tanpa alasan tidak membawa apa-apa ke layar —
      // dibuang daripada disimpan sebagai kartu hantu.
      if (!judul && !alasan) return null;
      /*
       * Rentang nomor modul diperiksa di sini, bukan dipercaya dari skema:
       * `minimum`/`maximum` sengaja tidak ada di RECOMMENDATION_SCHEMA, jadi
       * "Modul 47" dari model hanya bisa ditahan oleh kode. Di luar rentang
       * menjadi null — perender dan kartu fokus sudah memperlakukan null
       * sebagai "tanpa modul terkait".
       */
      const no = Number(r.modulTerkait);
      const modulTerkait = Number.isInteger(no) && no >= MODUL_MIN && no <= MODUL_MAKS ? no : null;
      return {
        judul,
        // Prioritas asing jatuh ke tengah: tidak menaikkan kejutan, tidak
        // menurunkan perhatian. Sama dengan penalti paling ringan yang jujur.
        prioritas: PRIORITAS_SAH.has(r.prioritas) ? r.prioritas : 'sedang',
        alasan,
        langkah,
        dampak: POTONG(r.dampak, 200),
        modulTerkait,
      };
    })
    .filter(Boolean);

  if (!ringkasan || !rekomendasi.length) {
    const err = new Error('Hasil rekomendasi tidak lengkap. Coba jalankan ulang.');
    err.status = 502;
    throw err;
  }

  const peringatan = (Array.isArray(mentah.peringatan) ? mentah.peringatan : [])
    .map((s) => POTONG(s, 200))
    .filter((s) => s.length > 0)
    .slice(0, 5);

  const targetBulanIni = (Array.isArray(mentah.targetBulanIni) ? mentah.targetBulanIni : [])
    .map((s) => POTONG(s, 200))
    .filter((s) => s.length > 0)
    .slice(0, 3);

  return { ringkasan, rekomendasi, peringatan, targetBulanIni };
}
