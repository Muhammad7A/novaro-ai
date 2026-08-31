/**
 * Kunci berkas antar-proses — dipakai bersama oleh SEMUA yang menulis data.
 *
 * ------------------------------------------------------------------
 * KENAPA INI DIPISAH KE BERKAS SENDIRI
 *
 * Kuncinya dulu hidup di dalam `store.js` sebagai fungsi privat, sehingga hanya
 * `store.js` yang mematuhinya. `backup.js` menulis ke berkas data yang SAMA —
 * saat memulihkan cadangan — tanpa pernah mengambil kunci itu, dan itu membuka
 * lubang yang paling merugikan justru pada saat paling genting:
 *
 *     server : update() → ambil kunci → load() (data lama) → mutasi …
 *     restore:                                → rename (data pulihan mendarat)
 *     server : … → flush() → menimpa dengan data lama + mutasi
 *                                              ↑ PEMULIHAN HILANG, tanpa pesan
 *
 * Dan panduan pilot justru menyuruh memulihkan SAAT SERVER MASIH HIDUP
 * (`npm run backup -- restore` lalu `pm2 restart`), jadi jendela itu bukan
 * kemungkinan teoretis melainkan prosedur yang tertulis.
 *
 * Sekarang kuncinya berdiri sendiri, dan siapa pun yang menyentuh berkas data
 * memakainya. Kunci yang hanya dipatuhi sebagian penulis bukan kunci.
 *
 * ------------------------------------------------------------------
 * BENTUKNYA
 *
 * Kunci berbasis berkas (`open` mode `wx` — gagal bila berkasnya sudah ada),
 * bukan kunci dalam memori: yang perlu diselaraskan adalah dua PROSES yang
 * berbeda (server dan perintah CLI), bukan dua permintaan dalam satu proses.
 *
 * Kunci yang ditinggalkan proses yang mati dianggap basi setelah 30 detik —
 * lebih lama dari operasi apa pun di sini, dan cukup singkat supaya pilot tidak
 * pernah macet gara-gara satu proses yang di-kill.
 */
import { mkdir, open, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as tidur } from 'node:timers/promises';

const TUNGGU_MS = 5000;
const BASI_MS = 30_000;

/**
 * Menjalankan `fn` sambil memegang kunci untuk `berkas`.
 *
 * @param {string} berkas Jalur berkas data yang dijaga (bukan jalur kuncinya).
 * @param {() => Promise<any>} fn
 */
export async function denganKunci(berkas, fn) {
  const lockPath = `${berkas}.lock`;
  const dir = path.dirname(berkas);
  const batas = Date.now() + TUNGGU_MS;

  for (;;) {
    let fh = null;
    try {
      await mkdir(dir, { recursive: true });
      fh = await open(lockPath, 'wx');
      await fh.write(`${process.pid}\n`);
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const s = await stat(lockPath).catch(() => null);
      if (s && Date.now() - s.mtimeMs > BASI_MS) {
        await unlink(lockPath).catch(() => {});
        continue;
      }
      if (Date.now() > batas) {
        throw new Error(
          `Berkas data sedang dikunci proses lain (${lockPath}). Tutup perintah yang sedang berjalan, ` +
            'atau hapus berkas kunci itu bila tidak ada proses lain yang hidup.',
        );
      }
      await tidur(15 + Math.floor(Math.random() * 35));
      continue;
    }
    try {
      return await fn();
    } finally {
      await fh.close().catch(() => {});
      await unlink(lockPath).catch(() => {});
    }
  }
}
