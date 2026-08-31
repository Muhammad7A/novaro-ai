/**
 * Pencatatan peristiwa server.
 *
 * Dua bentuk keluaran, dipilih lewat `LOG_FORMAT`:
 *
 *   teks  (bawaan)  "[keamanan] kode akses salah dari 1.2.3.4"
 *                   Untuk mata manusia — saat mengembangkan, dan saat menonton
 *                   `journalctl -f` di server sendiri.
 *
 *   json  (produksi) {"severity":"WARNING","message":"…","komponen":"keamanan"}
 *                   Untuk Cloud Logging. Ia membaca stdout baris per baris, dan
 *                   mengenali medan `severity` beserta medan tambahan apa pun
 *                   sebagai data yang bisa disaring.
 *
 * KENAPA INI PERLU DI GCP
 *
 * Dengan teks polos, seluruh baris masuk sebagai severity DEFAULT — termasuk
 * kegagalan. Akibatnya dua hal yang sama-sama merugikan: peringatan tidak bisa
 * dijadikan dasar alert, dan mencari "apa yang terjadi pada peserta X kemarin"
 * berarti membaca ribuan baris dengan mata. Untuk pilot yang berjalan tanpa
 * penjaga, log yang tidak bisa disaring hampir sama dengan tidak ada log.
 *
 * Yang TIDAK ditulis ke sini, dan tidak boleh: kode akses, isi percakapan,
 * nominal transaksi, dan nama peserta. Log berumur panjang, sering ikut
 * terkirim ke layanan pemantauan, dan tidak dijaga seketat berkas datanya.
 * `usr_xxx` sudah cukup untuk menelusuri; ia memang dibuat untuk itu.
 */

const JSON_MODE = String(process.env.LOG_FORMAT ?? '').toLowerCase() === 'json';

/** Padanan severity Cloud Logging untuk tiap tingkat yang dipakai di sini. */
const TINGKAT = {
  info: { severity: 'INFO', tulis: console.log },
  warn: { severity: 'WARNING', tulis: console.warn },
  error: { severity: 'ERROR', tulis: console.error },
};

function keluarkan(tingkat, komponen, pesan, data) {
  const { severity, tulis } = TINGKAT[tingkat] ?? TINGKAT.info;

  if (!JSON_MODE) {
    const ekor = data && Object.keys(data).length ? ` ${JSON.stringify(data)}` : '';
    tulis(`[${komponen}] ${pesan}${ekor}`);
    return;
  }

  /*
   * Satu baris, satu obyek JSON. Cloud Logging memecah keluaran per baris;
   * JSON yang tercetak berbaris-baris akan terbaca sebagai beberapa catatan
   * rusak, bukan satu catatan utuh.
   */
  tulis(JSON.stringify({ severity, komponen, message: pesan, ...(data ?? {}) }));
}

export const log = {
  info: (komponen, pesan, data) => keluarkan('info', komponen, pesan, data),
  warn: (komponen, pesan, data) => keluarkan('warn', komponen, pesan, data),
  error: (komponen, pesan, data) => keluarkan('error', komponen, pesan, data),

  /** Baris polos untuk banner saat start — selalu teks, apa pun LOG_FORMAT. */
  banner: (baris) => console.log(baris),

  /** Untuk uji: apakah keluaran sedang dalam bentuk JSON? */
  jsonMode: () => JSON_MODE,
};
