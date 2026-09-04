/**
 * Adapter MongoDB untuk penyimpanan pengguna.
 *
 * ------------------------------------------------------------------
 * SATU BENTUK DOKUMEN
 *
 * Satu pengguna = satu dokumen: `{ _id: user.id, ...user }`. Seluruh
 * medan pengguna (transaksi, chat, progres, jejak, usage) ikut apa adanya —
 * sama seperti kolom `data` JSONB di jalur PostgreSQL, tidak ada skema
 * kedua yang bisa menyimpang dari bentuk pengguna di aplikasi.
 *
 * ------------------------------------------------------------------
 * SEMANTIK TULIS: UPSERT + HAPUS-YANG-TIDAK-ADA
 *
 * `simpanSemua` menulis SEMUA pengguna yang ada di memori (upsert), lalu
 * menghapus dokumen yang id-nya tidak ada di memori. Dua bagian itu
 * bersama-sama yang membuat `deleteUser` sungguh-sungguh menghapus —
 * tanpa bagian kedua, pengguna yang dihapus hidup lagi saat proses
 * menyala ulang. Operasi berurutan tanpa transaksi: MongoDB standalone
 * tidak mendukung transaksi, dan pada aplikasi satu-penulis (antrean
 * dalam proses) jendela antara keduanya seketika tertutup oleh flush
 * berikutnya. Replika set terkelola menyediakan transaksi bila kelak
 * diperlukan — belum dibutuhkan pada skala pilot ini.
 *
 * Semua fungsi menerima KOLEKSI sebagai parameter, bukan mengimpor
 * koneksi — sehingga semantiknya teruji dengan koleksi palsu tanpa
 * server Mongo sungguhan (lihat test/penyimpanan.test.js).
 */
import { JENIS_PENYIMPANAN } from './db.js';

/** Pengguna → dokumen Mongo. `_id` dipakai sebagai kunci utama. */
export function docDariUser(user) {
  const salinan = { ...user };
  return { _id: String(user.id), ...salinan };
}

/** Dokumen Mongo → pengguna. `id` selalu diturunkan dari `_id`. */
export function userDariDoc(doc) {
  if (!doc || typeof doc !== 'object') return null;
  const { _id, ...rest } = doc;
  if (_id == null) return null;
  return { ...rest, id: String(_id) };
}

/**
 * Memuat seluruh pengguna dari koleksi.
 *
 * @returns {Promise<{users: Array, rusak: number}>} `rusak` menghitung
 *   dokumen yang bentuknya tidak dikenali — dibuang, bukan menggagalkan
 *   seluruh proses: satu dokumen korup tidak boleh menyembunyikan
 *   sembilan belas pengguna lain.
 */
export async function muatSemua(col) {
  const docs = await col.find({}).toArray();
  const users = [];
  let rusak = 0;
  for (const d of docs) {
    const u = userDariDoc(d);
    if (u) users.push(u);
    else rusak += 1;
  }
  return { users, rusak };
}

/**
 * Menyimpan seluruh isi memori ke koleksi: upsert semua + hapus sisanya.
 *
 * Daftar kosong sah — berarti semua pengguna memang sudah dihapus —
 * dan pada kasus itu hanya `deleteMany` yang berjalan (bulkWrite kosong
 * ditolak driver).
 */
export async function simpanSemua(col, users = []) {
  const daftar = users.filter((u) => u && u.id != null);
  if (daftar.length) {
    const ops = daftar.map((u) => ({
      replaceOne: { filter: { _id: String(u.id) }, replacement: docDariUser(u), upsert: true },
    }));
    await col.bulkWrite(ops, { ordered: false });
  }
  const ids = daftar.map((u) => String(u.id));
  await col.deleteMany(ids.length ? { _id: { $nin: ids } } : {});
}

/**
 * Muat, dan bila koleksi masih kosong, tabur dari sumber berkas sebelum
 * membaca ulang — perilaku yang sama dengan jalur PostgreSQL. Sumber
 * taburan dikirim sebagai fungsi supaya adapter tetap murni tanpa
 * membaca berkas sendiri.
 *
 * @param {object} col koleksi Mongo (atau tiruannya di uji)
 * @param {() => Promise<Array>} bacaSeed mengembalikan daftar pengguna taburan (boleh kosong)
 */
export async function muatAtauSeed(col, bacaSeed) {
  const pertama = await muatSemua(col);
  if (pertama.users.length || pertama.rusak) return pertama;

  const seed = (await bacaSeed()) ?? [];
  if (seed.length) {
    await simpanSemua(col, seed);
    return muatSemua(col);
  }
  return pertama;
}

/** Penjaga kecil untuk pemanggil di luar adapter: jalan hanya di jalur mongo. */
export function pastikanJalurMongo() {
  if (JENIS_PENYIMPANAN !== 'mongo') {
    throw new Error('Jalur penyimpanan bukan MongoDB — adapter ini hanya untuk jalur mongo.');
  }
}
