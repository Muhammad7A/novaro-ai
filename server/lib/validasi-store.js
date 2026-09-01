/**
 * Penyimpanan hasil validasi materi — berkas JSON tersendiri.
 *
 * SENGAJA TERPISAH dari `store.js`.
 *
 * Data peserta (`users.json`) memuat pembukuan keuangan orang sungguhan dan
 * merupakan bahan mentah penelitian ini. Validasi materi adalah pekerjaan lain,
 * dikerjakan orang lain, pada waktu yang lain, dan tidak punya satu pun kaitan
 * dengan isi buku kas siapa pun. Menaruh keduanya di satu berkas berarti setiap
 * kali seorang validator menekan "Kirim", seluruh data peserta ikut ditulis
 * ulang — dan satu kesalahan di jalur yang sama sekali baru ini bisa merusak
 * data yang tidak bisa dikumpulkan dua kali.
 *
 * Berkasnya: `<NOVA_DATA_DIR>/validasi.json`, mengikuti folder data yang sama
 * sehingga ikut tercakup pencadangan dan tidak pernah masuk repositori
 * (`.gitignore` sudah mengabaikan seluruh isi `server/data/`).
 *
 * Cara menulisnya menyalin pola `store.js`: tulis ke berkas sementara lalu
 * rename (atomik), diserialkan lewat satu antrean dalam proses, dan dijaga
 * kunci berkas antar proses supaya server dan perintah CLI tidak saling menimpa.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { denganKunci } from './kunci.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.NOVA_DATA_DIR
  ? path.resolve(process.env.NOVA_DATA_DIR)
  : path.join(HERE, '..', 'data');
const FILE_PATH = path.join(DATA_DIR, 'validasi.json');

const KOSONG = { version: 1, hasil: [] };

let antrean = Promise.resolve();

/** Membaca berkas dari disk setiap kali. Tanpa cache — penulisannya jarang. */
async function baca() {
  try {
    const parsed = JSON.parse(await readFile(FILE_PATH, 'utf8'));
    if (parsed?.hasil && !Array.isArray(parsed.hasil)) {
      throw new Error(`Berkas ${FILE_PATH} tidak berbentuk data validasi Novaro.`);
    }
    return { ...KOSONG, ...parsed, hasil: parsed.hasil ?? [] };
  } catch (err) {
    if (err.code === 'ENOENT') return structuredClone(KOSONG);
    throw err;
  }
}

async function tulis(db) {
  await mkdir(DATA_DIR, { recursive: true });
  const tmp = `${FILE_PATH}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(db, null, 2), 'utf8');
  await rename(tmp, FILE_PATH); // atomik pada filesystem yang sama
}

function ubah(mutator) {
  const jalan = antrean.then(() =>
    denganKunci(FILE_PATH, async () => {
      const db = await baca();
      const hasil = await mutator(db);
      await tulis(db);
      return hasil;
    }),
  );
  antrean = jalan.then(
    () => undefined,
    () => undefined,
  );
  return jalan;
}

export const validasiStore = {
  FILE_PATH,

  /**
   * Menyimpan satu lembar validasi.
   *
   * Hanya menambah, tidak pernah menimpa: dua validator yang kebetulan bernama
   * sama tetap menghasilkan dua baris. Lembar yang keliru dihapus dengan sadar
   * lewat `npm run validasi -- hapus <id>`, bukan tertimpa diam-diam.
   */
  async simpan(lembar) {
    const baris = {
      id: `val_${randomBytes(6).toString('hex')}`,
      dikirimPada: new Date().toISOString(),
      ...lembar,
    };
    await ubah((db) => {
      db.hasil = [...(db.hasil ?? []), baris];
    });
    return baris;
  },

  /** Seluruh lembar, terlama dulu. Salinan lepas — pemanggil boleh mengubahnya. */
  async daftar() {
    const db = await baca();
    return structuredClone(db.hasil ?? []);
  },

  async cari(id) {
    const db = await baca();
    return structuredClone((db.hasil ?? []).find((h) => h.id === id) ?? null);
  },

  async hapus(id) {
    return ubah((db) => {
      const sebelum = (db.hasil ?? []).length;
      db.hasil = (db.hasil ?? []).filter((h) => h.id !== id);
      return db.hasil.length < sebelum;
    });
  },
};
