/**
 * Batas waktu aplikasi untuk membaca stream jawaban AI.
 *
 * ------------------------------------------------------------------
 * KENAPA BERKAS INI ADA
 *
 * Batas waktu di SDK menjaga SALURAN, bukan PEMBACAAN: ia mengukur
 * sambungan, bukan "berapa lama satu jawaban boleh mengalir". Sementara itu
 * stream yang ditutup prematur oleh perantara mana pun bisa BERAKHIR secara
 * sah di mata iterasi `for await` — teks setengah jalan, usage nol, tanpa
 * satu pun galat. Tanpa batas aplikasi, hasil setengah itu terbaca sukses
 * dan sempat tersimpan; tanpa deteksi potongan, ia tersimpan sebagai
 * jawaban yang tampak selesai.
 *
 * Kontraknya dipakai kedua adapter (claude.js, gemini.js):
 *   - `tandaBatasStream` menggabungkan sinyal pembatal rute (peserta
 *     menutup aplikasi) dengan batas waktu aplikasi menjadi SATU sinyal,
 *     plus janji yang menolak saat batasnya tercapai;
 *   - stream yang putus di tengah atau kehabisan waktu melempar GALAT
 *     BERTIP (code AI_STREAM_TERPOTONG / AI_STREAM_TIMEOUT, status 502
 *     mengikuti konvensi galat adapter yang sudah ada) — bukan teks parsial.
 *     Tidak ada pemetaan status atau pengembalian jatah laju di sini; itu
 *     milik describeError dan rute sebagaimana adanya.
 *
 * Batasnya SATU angka untuk seluruh permukaan AI (bawaan 60 detik), bisa
 * dinaikkan lewat NOVA_AI_STREAM_TIMEOUT_MS tanpa mengubah kode — dipakai
 * juga oleh uji otomatis supaya tidak menunggu satu menit penuh. Catatan
 * untuk pemantauan produksi: penyusunan rekomendasi yang sah bisa lebih
 * lama dari batas bawaan; naikkan lewat env, jangan per-permukaan.
 */
const BATAS_BAWAAN_MS = 60_000;

/** Batas pembacaan stream aktif dalam milidetik — env NOVA_AI_STREAM_TIMEOUT_MS menimpa. */
export function batasStreamMs() {
  const n = Number(process.env.NOVA_AI_STREAM_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : BATAS_BAWAAN_MS;
}

/** Stream penyedia putus/berakhir sebelum jawabannya tuntas. */
export function galatStreamTerpotong() {
  const err = new Error('Sambungan ke layanan AI terputus sebelum jawabannya selesai. Coba lagi sebentar lagi.');
  err.code = 'AI_STREAM_TERPOTONG';
  err.status = 502;
  return err;
}

/** Pembacaan stream melebihi batas waktu aplikasi. */
export function galatStreamHabis() {
  const err = new Error('Layanan AI terlalu lama menjawab sehingga dibatalkan. Coba lagi sebentar lagi.');
  err.code = 'AI_STREAM_TIMEOUT';
  err.status = 502;
  return err;
}

/**
 * Satu batas waktu + satu sinyal gabungan untuk satu pembacaan stream.
 *
 * `sinyal` menggabungkan sinyal rute dengan batas waktu: yang mana pun lebih
 * dulu, sambungan penyedia ikut diputus. `janjiBatas` menolak saat batas
 * waktu tercapai — untuk di-perlombaan-kan dengan pembacaan stream, supaya
 * stream yang diam-diam menggantung pun tetap gagal tepat waktu walau abort
 * saja tidak cukup menghentikannya. `habis()` membedakan pembatalan karena
 * batas waktu dari pembatalan karena peserta pergi. `selesai()` WAJIB
 * dipanggil di finally pemanggilnya supaya pewaktunya mati.
 */
export function tandaBatasStream(signalLuar) {
  const controller = new AbortController();
  let habis = false;
  let tolakSekarang = () => {};
  const janjiBatas = new Promise((_, tolak) => {
    tolakSekarang = () => tolak(galatStreamHabis());
  });

  const saatHabis = () => {
    habis = true;
    controller.abort();
    tolakSekarang();
  };
  const timer = setTimeout(saatHabis, batasStreamMs());
  timer.unref?.();

  const saatLuar = () => controller.abort(signalLuar?.reason);
  if (signalLuar) {
    if (signalLuar.aborted) saatLuar();
    else signalLuar.addEventListener('abort', saatLuar, { once: true });
  }

  return {
    sinyal: controller.signal,
    habis: () => habis,
    janjiBatas,
    selesai: () => {
      clearTimeout(timer);
      signalLuar?.removeEventListener('abort', saatLuar);
    },
  };
}
