/**
 * Penyimpanan data sederhana berbasis file JSON.
 *
 * Cocok untuk pilot 5–10 pengguna: tanpa database, mudah di-backup (satu file),
 * dan mudah dibaca manusia. Semua penulisan diserialkan lewat satu antrean dan
 * ditulis secara atomik (tulis ke file sementara lalu rename) supaya file tidak
 * pernah rusak walau ada dua permintaan bersamaan.
 */
import { randomBytes, createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { hitungToken, pangkasLog } from './anggaran.js';
import { JENIS, isValidKategori, tanggalTerlama, tanggalWIB } from './cashbook.js';
import { totalSoal } from './latihan.js';
import { pool, initDb, JENIS_PENYIMPANAN, mongoCollection } from './db.js';
import { muatAtauSeed, simpanSemua as simpanSemuaMongo } from './mongo-store.js';
import { denganKunci } from './kunci.js';

let dbInitialized = false;
async function ensureDb() {
  if (pool && !dbInitialized) {
    await initDb();
    dbInitialized = true;
  }
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
/*
 * Letak data bisa dialihkan lewat NOVA_DATA_DIR. Dipakai untuk memasang data di
 * volume terpisah saat deploy, dan — sama pentingnya — supaya uji otomatis
 * memakai direktorinya sendiri dan tidak pernah menyentuh data peserta sungguhan.
 */
const DATA_DIR = process.env.NOVA_DATA_DIR
  ? path.resolve(process.env.NOVA_DATA_DIR)
  : path.join(HERE, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'users.json');

const EMPTY_DB = { version: 1, users: [] };

let cache = null;
/** Sidik jari berkas saat `cache` diisi — dipakai mendeteksi perubahan dari proses lain. */
let cacheSidik = null;
let writeQueue = Promise.resolve();

/**
 * Kegagalan mutasi yang DINOLAK di batas tulis — bukan kecelakaan 500.
 *
 * Lantai kepercayaan pembukuan menuntut kegagalan yang BERTIPE: penelepon
 * internal yang mencoba menyelipkan baris tidak sah harus menerima penolakan
 * yang bisa diperiksa (`kode` + `status`), bukan galat asing yang identik
 * dengan kerusakan infrastruktur. Rute HTTP meneruskan `status` dan `kode`
 * apa adanya; taksonomi `{error}` + ekstra bertipe tidak berubah.
 *
 * Melempar di dalam mutator `update()` aman untuk buku kas: cache dibuang
 * dan TIDAK ADA yang tertulis ke disk — mutasi yang gagal tidak pernah
 * meninggalkan baris setengah jadi atau peristiwa yatim.
 */
export class GalatMutasi extends Error {
  /**
   * @param {string} kode   penanda mesin, kebab-case — `duplikat`, `mesin-penghasilan`, dst.
   * @param {number} status kode HTTP yang pantas untuk penolakan ini
   * @param {string} message kalimat siap tampilkan untuk pemanggilnya
   */
  constructor(kode, status, message) {
    super(message);
    this.name = 'GalatMutasi';
    this.kode = kode;
    this.status = status;
  }
}

function hashCode(code) {
  return createHash('sha256').update(String(code).trim().toUpperCase()).digest('hex');
}

/* ------------------------------------------------------------ Batch peserta */

/**
 * Kelompok peserta dalam rancangan waitlist control.
 *
 * B1 menerima perlakuan lebih dulu; B2 menyusul setelah post-test. Tanpa
 * penanda ini, ekspor penelitian hanya berisi `usr_xxx` acak dan tidak ada cara
 * memisahkan kedua kelompok saat analisis — uji apa pun antar kelompok menjadi
 * mustahil tanpa mencocokkan id satu per satu di luar sistem.
 *
 * String kosong berarti "belum ditetapkan", dan itu sengaja dibolehkan: peserta
 * biasanya didaftarkan lebih dulu, lalu diacak ke dalam kelompok setelah
 * perekrutan selesai. Membedakan "belum diacak" dari "B1" penting — keduanya
 * tidak boleh diam-diam menjadi hal yang sama di data penelitian.
 */
export const BATCH_SAH = ['B1', 'B2', 'DEMO'];

/** Menormalkan masukan batch menjadi 'B1', 'B2', atau '' (belum ditetapkan). */
export function normalBatch(nilai) {
  const t = String(nilai ?? '').trim().toUpperCase();
  return BATCH_SAH.includes(t) ? t : '';
}

/** Membuat kode akses yang mudah dibacakan lewat telepon, mis. NOVA-7K3M-9QX2. */
function generateAccessCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // tanpa I, O, 0, 1
  const pick = (n) =>
    Array.from(randomBytes(n))
      .map((b) => alphabet[b % alphabet.length])
      .join('');
  return `NOVA-${pick(4)}-${pick(4)}`;
}

/** Sidik jari berkas: cukup untuk tahu "apakah ini masih berkas yang sama, isi yang sama". */
async function sidikBerkas() {
  try {
    const s = await stat(DB_PATH);
    return `${s.ino}:${s.size}:${s.mtimeMs}`;
  } catch (err) {
    if (err.code === 'ENOENT') return 'kosong';
    throw err;
  }
}

/**
 * Sumber taburan basis data eksternal yang masih kosong: berkas JSON di
 * NOVA_DATA_DIR, lalu berkas seed bawaan — urutan yang sama untuk jalur
 * PostgreSQL maupun Mongo. Mengembalikan daftar pengguna (boleh kosong).
 */
async function bacaSeedDariBerkas() {
  try {
    const raw = await readFile(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.users) && parsed.users.length > 0) {
      return parsed.users;
    }
  } catch {}
  try {
    const rawSeed = await readFile(path.join(HERE, '..', 'data', 'users-seed.json'), 'utf8');
    const parsedSeed = JSON.parse(rawSeed);
    if (Array.isArray(parsedSeed?.users)) return parsedSeed.users;
  } catch {}
  return [];
}

/**
 * Memuat basis data, memakai cache HANYA bila berkasnya belum berubah.
 * Jika DATABASE_URL terpasang, membaca dari Cloud SQL / PostgreSQL;
 * jika MONGO_URI terpasang, dari MongoDB terkelola (Emergent produksi).
 */
async function load() {
  if (JENIS_PENYIMPANAN === 'mongo') {
    const col = await mongoCollection();
    const { users } = await muatAtauSeed(col, bacaSeedDariBerkas);
    return { version: 1, users };
  }

  if (pool) {
    await ensureDb();
    let res = await pool.query('SELECT * FROM users');
    if (res.rows.length === 0) {
      const seedUsers = await bacaSeedDariBerkas();
      if (seedUsers.length > 0) {
        await flush({ version: 1, users: seedUsers });
        res = await pool.query('SELECT * FROM users');
      }
    }
    const users = res.rows.map((row) => ({
      id: row.id,
      name: row.name,
      business: row.business,
      batch: row.batch,
      codeHash: row.code_hash,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
      mulaiPada: row.mulai_pada ? (typeof row.mulai_pada === 'string' ? row.mulai_pada.slice(0, 10) : new Date(row.mulai_pada).toISOString().slice(0, 10)) : null,
      consent: row.consent_versi ? { versi: row.consent_versi, agreedAt: row.consent_agreed_at ? new Date(row.consent_agreed_at).toISOString() : null } : null,
      progress: row.progress ?? {},
      recommendations: row.recommendations ?? null,
      ...(row.data ?? {})
    }));
    return { version: 1, users };
  }

  if (cache && (await sidikBerkas()) === cacheSidik) return cache;
  try {
    const raw = await readFile(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed?.users && !Array.isArray(parsed.users)) {
      throw new Error(`Berkas data ${DB_PATH} tidak berbentuk basis data Novaro.`);
    }
    cache = { ...EMPTY_DB, ...parsed, users: parsed.users ?? [] };
  } catch (err) {
    if (err.code !== 'ENOENT') {
      cache = null;
      cacheSidik = null;
      throw err;
    }
    cache = structuredClone(EMPTY_DB);
  }
  cacheSidik = await sidikBerkas();
  return cache;
}

async function flush(dbToFlush) {
  const db = dbToFlush ?? cache ?? (await load());
  if (JENIS_PENYIMPANAN === 'mongo') {
    await simpanSemuaMongo(await mongoCollection(), db.users);
    return;
  }
  if (pool) {
    await ensureDb();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const user of db.users) {
          const { id, name, business, batch, codeHash, createdAt, mulaiPada, consent, progress, recommendations, ...rest } = user;
          await client.query(
            `
            INSERT INTO users (id, name, business, batch, code_hash, created_at, mulai_pada, consent_versi, consent_agreed_at, progress, recommendations, data)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (id) DO UPDATE SET
              name = EXCLUDED.name,
              business = EXCLUDED.business,
              batch = EXCLUDED.batch,
              code_hash = EXCLUDED.code_hash,
              mulai_pada = EXCLUDED.mulai_pada,
              consent_versi = EXCLUDED.consent_versi,
              consent_agreed_at = EXCLUDED.consent_agreed_at,
              progress = EXCLUDED.progress,
              recommendations = EXCLUDED.recommendations,
              data = EXCLUDED.data;
            `,
            [
              id,
              name,
              business ?? null,
              batch ?? null,
              codeHash,
              createdAt ? new Date(createdAt) : new Date(),
              mulaiPada ? new Date(mulaiPada) : null,
              consent?.versi ?? null,
              consent?.agreedAt ? new Date(consent.agreedAt) : null,
              JSON.stringify(progress ?? {}),
              recommendations ? JSON.stringify(recommendations) : null,
              JSON.stringify(rest ?? {}),
            ]
          );
      }
      /*
       * Penghapusan menjalar: baris yang id-nya tidak lagi ada di memori
       * dihapus, supaya deleteUser benar-benar menghapus. Aman dari
       * pengosongan tak sengaja karena flush hanya pernah dipanggil
       * SETELAH load() dari backend yang sama dalam proses ini — memori
       * kosong berarti basis datanya memang kosong. (Blok ini pernah
       * dihapus demi mencegah pengosongan; tanpaunya, pengguna yang
       * dihapus hidup lagi setiap restart.)
       */
      const ids = db.users.map((u) => u.id);
      await client.query(
        ids.length ? 'DELETE FROM users WHERE NOT (id = ANY($1))' : 'DELETE FROM users',
        ids.length ? [ids] : [],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return;
  }

  await mkdir(DATA_DIR, { recursive: true });
  const tmp = `${DB_PATH}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(db, null, 2), 'utf8');
  await rename(tmp, DB_PATH); // atomik pada filesystem yang sama
  cacheSidik = await sidikBerkas(); // isi memori dan isi disk kini sama persis
}

/**
 * Menjalankan `mutator(db)` lalu menyimpan hasilnya.
 *
 * Dua lapis penjagaan: antrean dalam proses (supaya dua permintaan HTTP tidak
 * saling menimpa) dan kunci berkas antar proses (supaya server dan perintah CLI
 * tidak saling menimpa).
 */
function update(mutator) {
  const run = writeQueue.then(() =>
    denganKunci(DB_PATH, async () => {
      const db = await load(); // di dalam kunci: pasti isi terbaru dari disk
      let result;
      try {
        result = await mutator(db);
        cache = db;
      } catch (err) {
        /*
         * Mutator sempat mengubah `cache` sebelum gagal, tapi perubahan itu tidak
         * pernah sampai ke disk. Membiarkannya membuat memori dan file berbeda isi
         * sampai server di-restart — kesalahan yang tak terlihat dan sulit dilacak.
         * Cache dibuang supaya pembacaan berikutnya kembali ke kebenaran di disk.
         */
        cache = null;
        cacheSidik = null;
        throw err;
      }
      await flush(db);
      return result;
    }),
  );
  // Antrean tidak boleh berhenti gara-gara satu error.
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Mencatat satu peristiwa ke jejak pengguna. Dipanggil DI DALAM mutator yang
 * sedang berjalan supaya tidak menimbulkan penulisan kedua ke disk.
 *
 * Jejak ini sengaja append-only dan sengaja tidak memuat isi: nominal, nama
 * transaksi, dan isi percakapan sudah tersimpan di tempatnya sendiri. Yang
 * dicatat di sini hanya "apa yang terjadi, kapan" — itulah yang dibutuhkan
 * untuk menjawab apakah kebiasaan pengguna berubah, dan sejak kapan.
 */
function pushEvent(user, type, meta) {
  const ev = { ts: new Date().toISOString(), type };
  if (meta && Object.keys(meta).length) ev.meta = meta;
  /*
   * `push`, bukan `[...lama, baru]`.
   *
   * Bentuk sebar menyalin SELURUH jejak pada setiap peristiwa baru, jadi
   * biayanya tumbuh kuadratik terhadap panjang jejak — dan jejak ini memang
   * sengaja tidak pernah dipangkas. Terukur: menambahkan 2.000 peristiwa satu
   * per satu makan 10 ms dengan sebar dan di bawah 1 ms dengan push.
   *
   * Aman: fungsi ini hanya dipanggil DI DALAM mutator, atas obyek milik cache,
   * dan setiap pembacaan keluar lewat `salin()` yang sudah structuredClone.
   */
  (user.events ??= []).push(ev);
  return ev;
}

/**
 * Salinan lepas dari sebuah daftar di dalam cache.
 *
 * Pembacaan mengembalikan SALINAN, bukan rujukan hidup ke isi cache. Rujukan
 * hidup berarti satu penulisan di tempat oleh pemanggil (mis. `rows.sort()`)
 * diam-diam mengubah basis data tanpa pernah ditulis ke disk — perbedaan antara
 * memori dan berkas yang baru ketahuan berjam-jam kemudian.
 */
const salin = (nilai) => (nilai ? structuredClone(nilai) : []);

/*
 * `batch` sengaja TIDAK ikut ke sini.
 *
 * Peserta tidak perlu — dan sebaiknya tidak — tahu dirinya ada di kelompok mana.
 * Seseorang yang menyadari dirinya "kelompok pembanding" bisa berperilaku lain,
 * dan itu persis jenis bias yang dirancang untuk dihindari oleh penetapan acak.
 * Kelompoknya hanya dipakai pengelola: perintah CLI dan ekspor penelitian.
 */
function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    business: user.business ?? null,
    // Tanggal mulai ikut: peramban memakainya untuk mengatakan kapan sesi
    // berikutnya terbuka, dan itu bukan rahasia dari pesertanya sendiri.
    mulaiPada: user.mulaiPada ?? null,
    profile: user.profile ?? null,
    recommendations: user.recommendations ?? null,
    progress: user.progress ?? {},
    createdAt: user.createdAt,
  };
}

export const store = {
  DB_PATH,

  /**
   * Menunggu seluruh penulisan yang sedang mengantre selesai.
   *
   * Dipakai saat mematikan server. Tanpa ini, SIGTERM dari systemd atau dari
   * deploy ulang bisa memotong proses tepat di antara "peserta menekan simpan"
   * dan "berkas tertulis ke disk" — transaksi itu hilang tanpa satu pun pesan,
   * dan peserta yakin dia sudah mencatatnya.
   *
   * Penulisannya sendiri sudah atomik, jadi berkasnya tidak akan pernah rusak;
   * yang dijaga di sini adalah penulisan yang belum sempat dimulai.
   */
  async selesaikanPenulisan() {
    // Ditunggu dua kali: antrean bisa bertambah satu langkah tepat saat
    // menunggu, dan yang terakhir masuk juga berhak selesai.
    await writeQueue;
    await writeQueue;
  },
  hashCode,
  generateAccessCode,
  publicUser,

  async listUsers() {
    const db = await load();
    return db.users.map((u) => ({
      id: u.id,
      name: u.name,
      business: u.business ?? null,
      batch: u.batch ?? '',
      mulaiPada: u.mulaiPada ?? null,
      hasProfile: Boolean(u.profile),
      messages: u.chat?.length ?? 0,
      transaksi: u.transactions?.length ?? 0,
      usage: u.usage ?? { requests: 0, inputTokens: 0, outputTokens: 0 },
      createdAt: u.createdAt,
    }));
  },

  /**
   * Mencari pengguna dari kode akses mentah. Pencarian lewat hash — kode asli
   * tidak pernah disimpan.
   *
   * Yang dikembalikan adalah SALINAN, bukan obyek hidup di dalam cache. Rute
   * menyimpannya di `req.user`; kalau itu rujukan hidup, satu penulisan di tempat
   * (`req.user.profile.x = ...`) akan diam-diam mengubah basis data tanpa pernah
   * ditulis ke disk — persis jenis kesalahan yang paling sulit ditemukan nanti.
   * Semua perubahan resmi lewat `update()`.
   */
  async findByAccessCode(code) {
    if (!code) return null;
    const db = await load();
    const hash = hashCode(code);
    const user = db.users.find((u) => u.codeHash === hash);
    return user ? structuredClone(user) : null;
  },

  /**
   * Token kartu kesehatan — identitas PUBLIK yang bisa dibagikan.
   *
   * Sengaja bukan ID internal dan bukan kode akses: nilainya diundi 144-bit
   * sehingga tidak bisa ditebak, dan ia hanya membuka SATU proyeksi baca-saja
   * (ringkasan kartu), bukan akunnya. Disimpan sebagai medan biasa pada obyek
   * pengguna — di PostgreSQL masuk ke kolom `data` JSONB yang sudah ada, jadi
   * tidak ada migrasi skema sama sekali.
   */
  async aturTokenKartu(userId, token) {
    if (!/^kartu_[A-Za-z0-9_-]{20,}$/.test(String(token ?? ''))) return false;
    return update((db) => {
      const user = db.users.find((u) => u.id === userId);
      if (!user) return false;
      user.tokenKartu = token;
      return true;
    });
  },

  /** Token tidak dikenal → null. Bentuk pencariannya sama dengan kode akses. */
  async cariDenganTokenKartu(token) {
    if (!token) return null;
    const db = await load();
    const user = db.users.find((u) => u.tokenKartu === token);
    return user ? structuredClone(user) : null;
  },

  /**
   * Mengambil pengguna utuh (bukan hanya ringkasan) untuk keperluan demo.
   *
   * `listUsers` sengaja hanya mengirim ringkasan — ia dipakai oleh perintah CLI
   * yang tidak butuh pembukuan penuh tiap peserta. Hidrasi demo butuh sebaliknya:
   * membaca `transactions` dan `demoMeta` untuk tahu sejauh mana riwayatnya
   * sudah dibangkitkan. Seperti `findByAccessCode`, ini SALINAN.
   */
  async findUserById(id) {
    const db = await load();
    const user = db.users.find((u) => u.id === id);
    return user ? structuredClone(user) : null;
  },

  /**
   * Menerapkan patch data demo pada satu pengguna dalam SATU penulisan.
   *
   * Hidrasi demo menyentuh banyak medan sekaligus (transaksi, chat, progres,
   * rekomendasi). Melakukannya lewat metode penyimpan satu-per-satu berarti
   * belasan penulisan beruntun saat boot — dan tiap penulisannya menyalin
   * seluruh berkas data. Satu mutator, satu penulisan.
   *
   * Khusus demo: TIDAK ada pemeriksaan medan di sini — hidrasi menyusun
   * ratusan baris sekaligus di SATU penulisan. Yang dijaga adalah SIAPA yang
   * boleh disentuh, dan penjagaannya kini di sini (di batas tulis), bukan
   * hanya pada pemanggil: pengguna yang batch-nya bukan 'DEMO' ditolak dengan
   * `GalatMutasi('bukan-demo')`. Tanpa ini, satu kekeliruan pemanggil cukup
   * untuk menimpa pembukuan peserta sungguhan dengan data sintetis — jalur
   * demo tidak boleh menjadi pintu belakang ke buku kas yang nyata.
   */
  async terapkanDemo(userId, patch) {
    return update((db) => {
      const user = db.users.find((u) => u.id === userId);
      if (!user) return null;
      if (user.batch !== 'DEMO') {
        throw new GalatMutasi('bukan-demo', 403, 'Hidrasi demo hanya boleh menyentuh akun batch DEMO.');
      }
      Object.assign(user, patch);
      return publicUser(user);
    });
  },

  async createUser({ name, business = '', batch = '' }) {
    const code = generateAccessCode();
    const user = {
      id: `usr_${randomBytes(6).toString('hex')}`,
      name,
      business,
      batch: normalBatch(batch),
      codeHash: hashCode(code),
      createdAt: new Date().toISOString(),
      profile: null,
      profileHistory: [], // append-only: garis dasar penelitian tidak boleh hilang
      /*
       * Tanggal mulai jalur belajar, ditetapkan pendamping — BUKAN createdAt.
       * Peserta didaftarkan berhari-hari sebelum pendampingan, dan B2 menyusul
       * jauh di belakang B1; memulai hitungan sendiri saat pendaftaran berarti
       * hari ke-1 seseorang bisa jatuh sebelum pre-test-nya sendiri.
       */
      mulaiPada: null,
      recommendations: null,
      chat: [],
      transactions: [],
      progress: {},
      events: [], // append-only: "apa yang terjadi, kapan"
      usage: { requests: 0, inputTokens: 0, outputTokens: 0 },
    };
    await update((db) => {
      db.users.push(user);
      pushEvent(user, 'user_created', user.batch ? { batch: user.batch } : undefined);
    });
    return { user, accessCode: code }; // kode hanya bisa dilihat sekali, di sini
  },

  /**
   * Menetapkan atau mengubah kelompok peserta.
   *
   * Peristiwanya ikut dicatat BESERTA kelompok lama. Kapan pengacakan terjadi
   * adalah bagian dari catatan metodologi: pengacakan yang dilakukan setelah
   * pre-test bukan pengacakan yang sama dengan sebelum pre-test, dan penguji
   * berhak bisa memeriksanya. Tanpa jejak ini, urutannya tidak bisa dibuktikan
   * dari data mana pun setelah pilot selesai.
   */
  async setBatch(userId, batch) {
    const bersih = normalBatch(batch);
    return update((db) => {
      const user = db.users.find((u) => u.id === userId);
      if (!user) return null;
      const sebelum = user.batch ?? '';
      if (sebelum === bersih) return user.batch; // tidak ada perubahan: jangan mengotori jejak
      user.batch = bersih;
      pushEvent(user, 'batch_assigned', { batch: bersih, sebelum });
      return user.batch;
    });
  },

  /**
   * Menetapkan tanggal mulai jalur belajar peserta.
   *
   * Peristiwanya dicatat BESERTA tanggal sebelumnya, sama seperti `setBatch`.
   * Kapan jadwal seseorang dimulai adalah bagian dari catatan metodologi:
   * jadwal yang ditetapkan sebelum pre-test bukan hal yang sama dengan yang
   * ditetapkan sesudahnya, dan penguji berhak bisa memeriksanya dari data —
   * bukan dari ingatan pendamping.
   *
   * `null` mengosongkan kembali (mis. jadwal ditetapkan ke peserta yang keliru).
   */
  async setMulai(userId, tanggal) {
    return update((db) => {
      const user = db.users.find((u) => u.id === userId);
      if (!user) return null;
      const sebelum = user.mulaiPada ?? null;
      const baru = tanggal ?? null;
      if (sebelum === baru) return { mulaiPada: baru, berubah: false };
      user.mulaiPada = baru;
      pushEvent(user, 'belajar_dimulai', { mulaiPada: baru, sebelum });
      return { mulaiPada: baru, berubah: true };
    });
  },

  /**
   * Mengganti nama peserta (dan nama usahanya).
   *
   * Dipakai setelah `users -- massal`, ketika kartu kode yang tadinya
   * bernama "Peserta 07" sudah diserahkan kepada orang yang sebenarnya.
   * Nama lamanya ikut dicatat: siapa yang memegang kode mana adalah bagian
   * dari jejak perekrutan, bukan sekadar kolom tampilan.
   */
  async renameUser(userId, { name, business }) {
    return update((db) => {
      const user = db.users.find((u) => u.id === userId);
      if (!user) return null;
      const sebelum = { name: user.name, business: user.business ?? '' };
      user.name = String(name).trim();
      if (business !== undefined) user.business = String(business ?? '').trim();
      pushEvent(user, 'peserta_dinamai', { sebelum, sesudah: { name: user.name, business: user.business } });
      return structuredClone(user);
    });
  },

  async resetAccessCode(userId) {
    const code = generateAccessCode();
    const ok = await update((db) => {
      const user = db.users.find((u) => u.id === userId);
      if (!user) return false;
      user.codeHash = hashCode(code);
      return true;
    });
    return ok ? code : null;
  },

  /**
   * Memasang kode akses PILIHAN pada satu pengguna.
   *
   * Kebalikan resetAccessCode yang mengundi kode baru: ini untuk kode yang
   * memang sudah ditentukan di tempat lain — akun demo yang kodenya tercantum
   * di lib/demo-data.js, atau pemulihan dari daftar peserta. Formatnya tetap
   * diperiksa keras: dua bentuk yang sah hanyalah kode peserta berformat
   * NOVA-XXXX-XXXX dan kode demo tiga-enam digit (101–120). Spasi kosong atau
   * bentuk asing ditolak — satu kode yang salah bentuk tidak pernah bisa
   * dicocokkan, dan kegagalan seperti itu paling mahal ditemukan saat juri
   * sedang menunggu di depan layar.
   */
  async setAccessCode(userId, code) {
    if (!/^(NOVA-[A-Z0-9]{4}-[A-Z0-9]{4}|\d{3,6})$/.test(String(code ?? ''))) return false;
    return update((db) => {
      const user = db.users.find((u) => u.id === userId);
      if (!user) return false;
      user.codeHash = hashCode(code);
      return true;
    });
  },

  /**
   * Mencatat peristiwa yang tidak menyertai perubahan data lain (mis. login,
   * laporan dibuka). Menimbulkan satu penulisan tersendiri — karena itu hanya
   * dipakai untuk peristiwa yang memang berdiri sendiri, bukan untuk setiap
   * pembacaan halaman.
   *
   * `jedaMs` menahan pengulangan: membuka halaman laporan lalu mengganti pilihan
   * bulan tiga kali adalah SATU kali "peserta melihat laporan", bukan empat.
   * Tanpa ini jejak penelitian penuh dengan derai peristiwa yang sama dan tiap
   * satunya menulis ulang seluruh berkas data.
   */
  async logEvent(userId, type, meta, { jedaMs = 0 } = {}) {
    return update((db) => {
      const user = db.users.find((u) => u.id === userId);
      if (!user) return null;
      if (jedaMs > 0) {
        const batas = Date.now() - jedaMs;
        const terakhir = [...(user.events ?? [])].reverse().find((e) => e.type === type);
        if (terakhir && Date.parse(terakhir.ts) > batas) return terakhir;
      }
      return pushEvent(user, type, meta);
    });
  },

  /** Jejak peristiwa satu pengguna, terlama dulu. */
  async getEvents(userId) {
    const db = await load();
    return salin(db.users.find((u) => u.id === userId)?.events);
  },

  /** Seluruh versi profil, terlama dulu. Versi pertama adalah garis dasar. */
  async getProfileHistory(userId) {
    const db = await load();
    return salin(db.users.find((u) => u.id === userId)?.profileHistory);
  },

  /** Seluruh data mentah — hanya untuk alat ekspor, tidak dipakai rute mana pun. */
  async dump() {
    return structuredClone(await load());
  },

  /** Mencatat persetujuan peserta beserta versi teks yang dia setujui. */
  async saveConsent(userId, versi) {
    return update((db) => {
      const user = db.users.find((u) => u.id === userId);
      if (!user) return null;
      user.consent = { versi, agreedAt: new Date().toISOString() };
      pushEvent(user, 'consent_given', { versi });
      return user.consent;
    });
  },

  /**
   * Seluruh data satu pengguna, untuk diunduh sendiri olehnya.
   *
   * Buku kas ini miliknya — kalau dia berhenti dari program, dia berhak membawa
   * pembukuannya. Hash kode akses sengaja tidak ikut.
   */
  async exportUser(userId) {
    const db = await load();
    const u = db.users.find((x) => x.id === userId);
    if (!u) return null;
    const { codeHash, ...rest } = structuredClone(u);
    return { ...rest, diunduhPada: new Date().toISOString() };
  },

  async deleteUser(userId) {
    return update((db) => {
      const before = db.users.length;
      db.users = db.users.filter((u) => u.id !== userId);
      return db.users.length < before;
    });
  },

  /**
   * Menyimpan profil usaha — dan MENYIMPAN VERSI LAMANYA.
   *
   * Angka perkiraan yang diisi pengguna di hari pertama adalah garis dasar
   * penelitian ini: satu-satunya catatan tentang apa yang dia KIRA dia hasilkan,
   * sebelum buku kas menunjukkan apa yang benar-benar terjadi. Sebelumnya baris
   * ini menimpa profil begitu saja, jadi garis dasar itu hilang permanen pada
   * pertama kali seseorang mengoreksi omzetnya — dan tidak bisa disusun ulang
   * dari mana pun. Selisih perkiraan vs kenyataan justru temuan paling menarik
   * yang bisa dihasilkan aplikasi ini; ia tidak boleh ditimpa.
   */
  async saveProfile(userId, profile) {
    return update((db) => {
      const user = db.users.find((u) => u.id === userId);
      if (!user) return null;

      const now = new Date().toISOString();
      let history = user.profileHistory ?? [];

      // Pengguna lama yang sudah punya profil tapi belum punya riwayat:
      // selamatkan dulu versi yang masih ada sebelum menambah yang baru.
      if (!history.length && user.profile) {
        history = [{ ...user.profile, recordedAt: user.profile.updatedAt ?? user.createdAt ?? now }];
      }

      const pertama = history.length === 0;
      user.profileHistory = [...history, { ...profile, recordedAt: now }];
      user.profile = { ...profile, updatedAt: now };
      // Rekomendasi lama tidak lagi cocok dengan profil baru.
      user.recommendations = null;
      if (profile.namaUsaha) user.business = profile.namaUsaha;

      pushEvent(user, 'profile_saved', { versi: user.profileHistory.length, garisDasar: pertama });
      return user.profile;
    });
  },

  async saveRecommendations(userId, recommendations) {
    return update((db) => {
      const user = db.users.find((u) => u.id === userId);
      if (!user) return null;
      return simpanRekomendasiKe(user, recommendations);
    });
  },

  async getChat(userId) {
    const db = await load();
    return salin(db.users.find((u) => u.id === userId)?.chat);
  },

  async appendChat(userId, messages, { maxTurns = 60, modul = null } = {}) {
    return update((db) => {
      const user = db.users.find((u) => u.id === userId);
      if (!user) return null;
      user.chat = [...(user.chat ?? []), ...messages].slice(-maxTurns);
      /*
       * `modul` dicatat supaya bisa dijawab belakangan: materi mana yang
       * benar-benar memicu pertanyaan? Itu tidak bisa direkonstruksi dari
       * teks percakapannya saja setelah pilot selesai, dan justru ia salah
       * satu temuan yang paling berguna — modul yang paling banyak memicu
       * pertanyaan adalah modul yang paling kurang jelas.
       */
      pushEvent(user, 'chat_turn', modul ? { pesan: messages.length, modul } : { pesan: messages.length });
      return user.chat;
    });
  },

  async clearChat(userId) {
    return update((db) => {
      const user = db.users.find((u) => u.id === userId);
      if (!user) return null;
      const sebelum = user.chat?.length ?? 0;
      user.chat = [];
      pushEvent(user, 'chat_cleared', { pesan: sebelum });
      return true;
    });
  },

  /* ------------------------------------------------------------ Buku kas */

  async getTransactions(userId) {
    const db = await load();
    return salin(db.users.find((u) => u.id === userId)?.transactions);
  },

  /**
   * Mencatat satu transaksi ke buku kas — SATU-SATUNYA pintu tulis uang.
   *
   * LANTAI KEPERCAYAAN: pemeriksaan yang dulu hanya hidup di rute HTTP
   * (`server.js`) kini dipegang mutator ini. Rute boleh menolak lebih dulu
   * demi kalimat galat yang ramah, tapi rute bukan penegak terakhir —
   * pemanggil internal mana pun (alat CLI, otomasi, pemanggil AI masa depan)
   * melewati pemeriksaan yang sama di sini. Rinciannya:
   *
   *   - Daftar putih medan: baris dirakit dari `tanggal, jenis, kategori,
   *     keterangan, jumlah` SAJA. Apa pun lain di obyek masukan — termasuk
   *     `id`, `origin`, `proposalId`, `requestId`, `voided` — dibuang, bukan
   *     diwarisi. Medan siapa-punya-server tidak pernah bisa diselipkan dari
   *     tubuh permintaan maupun dari pemanggil lalai.
   *   - Aktor efektif WAJIB dinyatakan (`aktor: 'manusia' | 'mesin'`).
   *     Tanpa pernyataan, tulisan ditolak — diam-diam menganggap semua
   *     pemanggil manusia berarti invarian "mesin tak menulis penghasilan"
   *     bisa dilanggar hanya dengan tidak mengirim opsi.
   *   - MESIN TIDAK PERNAH MENULIS PENGHASILAN: baris `masuk` dari aktor
   *     mesin ditolak (kode `mesin-penghasilan`). Pemasukan hanya sah lewat
   *     konfirmasi manusia — prinsip "AI mengusulkan, manusia memutuskan".
   *   - `origin` DITETAPKAN DI SINI (`'manual'`), bukan diterima. Asal lain
   *     (`nota`, `rule`, `transfer`) menyusul bersama mesinya masing-masing
   *     — rute konfirmasi nota kelak menyerahkan token yang diverifikasi DI
   *     DALAM mutator ini, bukan string `origin` dari tubuh permintaan.
   *   - `requestId` (opsional, dari pemanggil): bila diisi, baris yang sudah
   *     membawa id permintaan yang sama pada pengguna yang sama membuat
   *     mutasi ini ditolak (`duplikat`, 409) — ketukan ganda dan kirim ulang
   *     tidak lagi bisa memalsukan dua baris dari satu niat. Tanpa id,
   *     pengulangan tidak terdeteksi: itu kelemahan yang diakui, bukan
   *     disembunyikan.
   *
   * Mengembalikan baris yang tersimpan, atau `null` bila penggunanya tidak
   * ada. Semua penolakan melempar `GalatMutasi`.
   *
   * @param {string} userId
   * @param {object} transaction { tanggal?, jenis, kategori, keterangan?, jumlah }
   * @param {{aktor: 'manusia'|'mesin', requestId?: string}} opts
   */
  async addTransaction(userId, transaction, { aktor, requestId } = {}) {
    return update((db) => {
      const user = db.users.find((u) => u.id === userId);
      if (!user) return null;
      const row = barisTransaksiSah(transaction, { aktor, requestId, transactionsLama: user.transactions });
      // push, bukan sebar — alasannya sama dengan pushEvent di bawah.
      (user.transactions ??= []).push(row);
      pushEvent(user, 'transaction_added', {
        jenis: row.jenis,
        kategori: row.kategori,
        tanggal: row.tanggal,
        mundur: row.tanggal < row.createdAt.slice(0, 10),
        // Asal mengikuti baris: jejak penelitian boleh memuat kosakata tertutup
        // ini — ia bukan nominal dan bukan teks bebas (lihat uji penelitian).
        origin: row.origin,
      });
      return row;
    });
  },

  async deleteTransaction(userId, transactionId) {
    return update((db) => {
      const user = db.users.find((u) => u.id === userId);
      if (!user?.transactions) return false;
      const before = user.transactions.length;
      const dihapus = user.transactions.find((t) => t.id === transactionId);
      user.transactions = user.transactions.filter((t) => t.id !== transactionId);
      const ok = user.transactions.length < before;
      if (ok) pushEvent(user, 'transaction_deleted', { jenis: dihapus?.jenis, kategori: dihapus?.kategori, tanggal: dihapus?.tanggal });
      return ok;
    });
  },

  async saveProgress(userId, progress) {
    return update((db) => {
      const user = db.users.find((u) => u.id === userId);
      if (!user) return null;
      const lama = user.progress?.done ?? {};
      const baru = Object.keys(progress.done ?? {}).filter((k) => progress.done[k] && !lama[k]);
      // `checks` tidak lagi dikirim tampilan, tapi data lama yang sudah ada
      // tidak dihapus begitu saja — menimpanya dengan {} adalah kehilangan diam-diam.
      // `praktik` demikian pula: ia ditulis SERVER (bukti tindakan nyata),
      // bukan dikirim peramban, jadi harus selamat dari setiap simpanan progres.
      user.progress = {
        ...progress,
        praktik: user.progress?.praktik ?? {},
        latihan: user.progress?.latihan ?? {},
        checks: progress.checks ?? user.progress?.checks ?? {},
      };
      if (baru.length) pushEvent(user, 'module_completed', { modul: baru.map(Number).sort((a, b) => a - b) });
      return user.progress;
    });
  },

  /**
   * Menyimpan hasil SATU jawaban latihan (nilai server, bukan self-report).
   * Jawaban salah tercatat untuk riset, tapi tidak pernah menimpa jawaban
   * yang benar — peserta boleh mencoba ulang sampai paham; yang dihitung
   * "lulus" adalah kondisi SEMUA soal benar.
   */
  async simpanJawabanLatihan(userId, no, index, benar, konsep) {
    return update((db) => {
      const user = db.users.find((u) => u.id === userId);
      if (!user) return null;
      user.progress = user.progress ?? {};
      user.progress.latihan = user.progress.latihan ?? {};
      const entri = user.progress.latihan[no] ?? { jawaban: {} };
      entri.jawaban = entri.jawaban ?? {};
      const sebelumnya = entri.jawaban[index]?.benar === true;
      entri.jawaban[index] = { benar: benar || sebelumnya, terakhir: new Date().toISOString() };

      const total = totalSoal(no);
      const benarCount = Object.values(entri.jawaban).filter((j) => j?.benar).length;
      let baruLulus = false;
      if (!entri.lulusPada && total > 0 && benarCount >= total) {
        entri.lulusPada = new Date().toISOString();
        baruLulus = true;
      }
      user.progress.latihan[no] = entri;

      pushEvent(user, 'latihan_dijawab', { modul: no, soal: index, benar: Boolean(benar), konsep: konsep ?? null });
      return { benarCount, total, lulus: Boolean(entri.lulusPada), baruLulus };
    });
  },

  /**
   * Soal tantangan AI tersimpan milik server (memuat kunci!) — sengaja
   * TIDAK ikut publicUser, jadi peramban tidak pernah menerimanya.
   */
  async aturLatihanAI(userId, no, soal, provensi = {}) {
    return update((db) => {
      const user = db.users.find((u) => u.id === userId);
      if (!user) return null;
      user.latihanAI = user.latihanAI ?? {};
      // Provenansi aditif: soal lama tanpa `model` tetap sah terbaca.
      user.latihanAI[no] = {
        ...soal,
        ...(provensi.model ? { model: provensi.model } : {}),
        pada: new Date().toISOString(),
        sudahJawab: false,
        hasilBenar: null,
      };
      pushEvent(user, 'latihan_ai_dibuat', { modul: no });
      return user.latihanAI[no];
    });
  },

  async bacaLatihanAI(userId, no) {
    return update((db) => db.users.find((u) => u.id === userId)?.latihanAI?.[no] ?? null);
  },

  async catatJawabanLatihanAI(userId, no, benar) {
    return update((db) => {
      const user = db.users.find((u) => u.id === userId);
      if (!user?.latihanAI?.[no]) return null;
      const soal = user.latihanAI[no];
      if (soal.sudahJawab) return { sudahJawab: true, hasilBenar: soal.hasilBenar };
      soal.sudahJawab = true;
      soal.hasilBenar = Boolean(benar);
      pushEvent(user, 'latihan_ai_dijawab', { modul: no, benar: Boolean(benar), konsep: soal.konsep ?? null });
      return { sudahJawab: true, hasilBenar: soal.hasilBenar };
    });
  },

  /**
   * Menandai praktik modul yang TERVERIFIKASI oleh tindakan nyata.
   *
   * Ini bukan self-report: pemanggilnya adalah server, saat event tindakan
   * (transaksi tercatat, laporan dibuka) benar-benar terjadi — lib/praktik.js
   * yang memutuskan modul mana yang layak ditandai. Klik tombol CTA tidak
   * pernah sampai ke sini.
   *
   * Tetap di dalam JSON `progress` — tidak ada skema baru yang perlu dimigrasi,
   * dan progres lama tanpa `praktik` tetap sah.
   */
  async tandaiPraktik(userId, nos, jenis) {
    return update((db) => {
      const user = db.users.find((u) => u.id === userId);
      if (!user) return null;
      user.progress = user.progress ?? {};
      user.progress.praktik = user.progress.praktik ?? {};
      const baru = [];
      for (const no of nos) {
        if (!user.progress.praktik[no]) {
          user.progress.praktik[no] = { pada: new Date().toISOString() };
          baru.push(Number(no));
        }
      }
      if (!baru.length) return null;
      pushEvent(user, 'praktik_terverifikasi', { modul: baru, aksi: jenis });
      return baru;
    });
  },

  /**
   * Menjumlahkan pemakaian token.
   *
   * Token yang dibaca dari cache dan token yang menulis cache datang di medan
   * TERPISAH dari `input_tokens`. Tanpa mencatat keduanya, angka pemakaian jadi
   * terlalu kecil begitu prompt caching bekerja — dan justru angka inilah yang
   * dipakai pengelola untuk memantau tagihan.
   */
  async recordUsage(userId, usage) {
    return update((db) => {
      const user = db.users.find((u) => u.id === userId);
      if (!user) return null;
      return catatUsage(user, usage);
    });
  },

  /**
   * Satu giliran percakapan: pesan, jejak peristiwa, dan pemakaian token —
   * dalam SATU penulisan.
   *
   * Dulu rute chat memanggil `appendChat` lalu `recordUsage`, dan tiap
   * panggilan menulis ulang SELURUH berkas basis data. Dua penulisan penuh
   * untuk satu giliran, padahal keduanya mengubah pengguna yang sama pada
   * momen yang sama. Menggabungkannya memotong separuh beban tulis pada jalur
   * yang paling sering dipakai — dan menghapus jendela di mana percakapan
   * sudah tersimpan tapi tokennya belum terhitung.
   */
  async simpanGiliranChat(userId, messages, usage, { maxTurns = 60, modul = null, model = null } = {}) {
    return update((db) => {
      const user = db.users.find((u) => u.id === userId);
      if (!user) return null;
      /*
       * Identitas model ikut pada pesan asistennya — aditif, dan hanya bila
       * pemanggil benar-benar mengetahuinya. Pesan lama tanpa `model` tetap
       * terbaca; peramban menampilkannya sebagai "AI" tanpa versi, bukan
       * versi karangan.
       */
      const berstempel = model
        ? messages.map((m) => (m.role === 'assistant' ? { ...m, model } : m))
        : messages;
      user.chat = [...(user.chat ?? []), ...berstempel].slice(-maxTurns);
      pushEvent(user, 'chat_turn', modul ? { pesan: messages.length, modul } : { pesan: messages.length });
      catatUsage(user, usage);
      return user.chat;
    });
  },

  /** Rekomendasi + pemakaian tokennya, juga dalam satu penulisan. */
  async simpanRekomendasi(userId, recommendations, usage, provensi = {}) {
    return update((db) => {
      const user = db.users.find((u) => u.id === userId);
      if (!user) return null;
      catatUsage(user, usage);
      return simpanRekomendasiKe(user, recommendations, provensi);
    });
  },

  /** Jejak pemakaian token harian, untuk memeriksa anggaran. */
  async getTokenLog(userId) {
    const db = await load();
    return salin(db.users.find((u) => u.id === userId)?.tokenLog);
  },
};

/* --------------------------------------------- Pembantu di dalam mutator */

/*
 * Bentuk sah satu baris buku kas. Konstanta di sini adalah KONTRAK, bukan
 * rincian implementasi: jumlah maksimum dan format tanggal harus tetap identik
 * dengan yang dijanjikan rute ke peramban — baris yang diterima mutator dan
 * baris yang diterima rute tidak boleh bisa berbeda.
 */
const POLA_TANGGAL = /^\d{4}-\d{2}-\d{2}$/;
const POLA_ID_PERMINTAAN = /^[A-Za-z0-9._:-]{1,128}$/;
const JUMLAH_MAKS = 1e12;

/**
 * Memvalidasi masukan transaksi dan merakit baris yang sah — penegak terakhir
 * sebelum uang menyentuh buku. Dipanggil DI DALAM mutator `addTransaction`,
 * atas keadaan pengguna yang terkunci, supaya pemeriksaan id permintaan tidak
 * punya jendela balapan dan kegagalan apa pun membuang seluruh mutasi.
 *
 * Urutan pemeriksaan disengaja: SIAPA penulisnya diperiksa SEBELUM APA yang
 * ditulisnya — pemanggil mesin mendapat penolakan aktornya meski isinya
 * kebetulan sah, karena pesan yang paling perlu sampai adalah "bukan jalurmu".
 *
 * Semantik angka sengaja sama dengan rute (`asNumber` di server.js): masukan
 * yang tak terbaca sebagai angka atau bernilai negatif menjadi 0 — dan 0
 * ditolak, bukan didiamkan.
 *
 * @param {object} masukan            medan mentah dari pemanggil
 * @param {{aktor?: string, requestId?: string, transactionsLama?: Array}} opts
 * @returns {object} baris lengkap siap dorong ke `user.transactions`
 * @throws {GalatMutasi} pada aktor tak sah, medan tidak sah, atau id permintaan yang sudah terpakai
 */
function barisTransaksiSah(masukan, { aktor, requestId, transactionsLama = [] } = {}) {
  if (aktor !== 'manusia' && aktor !== 'mesin') {
    throw new GalatMutasi('aktor-tidak-sah', 400, 'Aktor mutasi wajib dinyatakan: "manusia" atau "mesin".');
  }

  if (aktor === 'mesin') {
    // Invarian yang dijaga keras: PENGHASILAN hanya lewat konfirmasi manusia.
    // Pengeluaran oleh mesin belum punya asal yang bisa ditetapkan mutator
    // ('rule'/'transfer' menyusul bersama penulisnya masing-masing) — jadi
    // keduanya ditolak, dengan kode terpisah supaya jejaknya bisa dibedakan.
    if (masukan?.jenis === 'masuk') {
      throw new GalatMutasi('mesin-penghasilan', 403, 'Mesin tidak boleh mencatat pemasukan. Pemasukan hanya sah lewat konfirmasi manusia.');
    }
    throw new GalatMutasi('mesin-tanpa-asal', 403, 'Penulisan pengeluaran oleh mesin belum punya asal yang sah di mutator ini.');
  }

  const jenis = JENIS.includes(masukan?.jenis) ? masukan.jenis : null;
  if (!jenis) throw new GalatMutasi('jenis', 400, 'Jenis transaksi harus "masuk" atau "keluar".');
  if (!isValidKategori(jenis, masukan?.kategori)) {
    throw new GalatMutasi('kategori', 400, 'Kategori transaksi tidak dikenali.');
  }

  const angka = Number(masukan?.jumlah);
  const jumlah = Number.isFinite(angka) && angka > 0 ? Math.min(angka, JUMLAH_MAKS) : 0;
  if (jumlah <= 0) throw new GalatMutasi('jumlah', 400, 'Jumlah harus lebih dari 0.');

  const hariIni = tanggalWIB();
  /*
   * Tanggal yang TIDAK diisi berarti hari ini — sama dengan rute. Tapi tanggal
   * yang DIISI dalam bentuk asing ditolak, bukan didiamkan jadi hari ini: di
   * lapisan rute, diam-jadi-hari-ini adalah perlakuan ramah untuk salah ketik
   * manusia; di lantai mutator, bentuk asing dari pemanggil internal adalah
   * cacat kontrak dan harus terlihat, bukan terselubung.
   */
  let tanggal;
  const tanggalMasukan = masukan?.tanggal;
  if (tanggalMasukan == null || tanggalMasukan === '') {
    tanggal = hariIni;
  } else if (typeof tanggalMasukan !== 'string' || !POLA_TANGGAL.test(tanggalMasukan)) {
    throw new GalatMutasi('tanggal-bentuk', 400, 'Tanggal harus berbentuk YYYY-MM-DD.');
  } else {
    tanggal = tanggalMasukan;
  }
  if (tanggal > hariIni) {
    throw new GalatMutasi('tanggal-masa-depan', 400, 'Tanggal tidak boleh di masa depan.');
  }
  if (tanggal < tanggalTerlama()) {
    throw new GalatMutasi(
      'tanggal-terlalulama',
      400,
      `Tanggal terlalu lama. Periksa tahunnya — paling lama ${tanggalTerlama()}.`,
    );
  }

  const row = {
    id: `trx_${randomBytes(6).toString('hex')}`,
    tanggal,
    jenis,
    kategori: masukan.kategori,
    keterangan: String(masukan?.keterangan ?? '').trim().slice(0, 120),
    jumlah,
    createdAt: new Date().toISOString(),
    // Asal baris ditetapkan DI SINI dan hanya di sini. Tidak ada parameter
    // yang bisa mengaturnya — satu-satunya asal yang sah hari ini adalah
    // ketukan manusia di rute biasa.
    origin: 'manual',
  };

  if (requestId != null && requestId !== '') {
    const bersih = String(requestId);
    if (!POLA_ID_PERMINTAAN.test(bersih)) {
      throw new GalatMutasi('id-permintaan', 400, 'ID permintaan tidak sah (maksimal 128 karakter: huruf, angka, titik, garis, titik dua).');
    }
    if (transactionsLama.some((t) => t?.requestId === bersih)) {
      throw new GalatMutasi('duplikat', 409, 'Permintaan ini sudah pernah dicatat. Periksa buku kas sebelum mengirim ulang.');
    }
    row.requestId = bersih;
  }

  return row;
}

/**
 * Menjumlahkan pemakaian token pada obyek pengguna yang sedang dimutasi.
 *
 * Dipisah supaya bisa dipakai ulang oleh penulisan gabungan di atas tanpa
 * menimbulkan penulisan kedua ke disk.
 */
function catatUsage(user, usage) {
  const current = user.usage ?? {};
  const tambah = (medan, nilai) => (Number(current[medan]) || 0) + (Number(nilai) || 0);
  user.usage = {
    requests: tambah('requests', 1),
    inputTokens: tambah('inputTokens', usage?.input_tokens),
    outputTokens: tambah('outputTokens', usage?.output_tokens),
    cacheBacaTokens: tambah('cacheBacaTokens', usage?.cache_read_input_tokens),
    cacheTulisTokens: tambah('cacheTulisTokens', usage?.cache_creation_input_tokens),
  };

  /*
   * Jejak harian untuk anggaran token. Total kumulatif di atas tidak bisa
   * menjawab "berapa yang dipakai hari ini", dan itulah pertanyaan yang
   * menentukan boleh-tidaknya permintaan berikutnya.
   */
  const token = hitungToken(usage);
  const tanggal = tanggalWIB(new Date());
  const log = pangkasLog(user.tokenLog ?? []);
  const hariIni = log.find((e) => e.tanggal === tanggal);
  if (hariIni) hariIni.token += token;
  else log.push({ tanggal, token });
  user.tokenLog = log;

  return user.usage;
}

/**
 * Menyimpan rekomendasi pada obyek pengguna yang sedang dimutasi.
 *
 * Provenansi ikut distempel DI SINI, bukan di pemanggilnya, supaya satu-satunya
 * pintu ke `user.recommendations` tidak bisa meloloskan keluaran tanpa asal.
 * Medannya aditif; rekam lama (sebelum Sesi D) tanpa `sumber`/`model` tetap
 * terbaca apa adanya — kekosongan berarti "disusun sebelum pencatatan
 * identitas ada", bukan dusta bahwa ia keluaran AI segar.
 */
function simpanRekomendasiKe(user, recommendations, provensi = {}) {
  user.recommendations = {
    ...recommendations,
    generatedAt: new Date().toISOString(),
    // 'ai' = disusun AI hidup lewat rute; 'contoh' = benih demo susunan
    // kurasi — bukan keluaran model mana pun, dan tidak boleh mati sebagai
    // "AI" di permukaan mana pun yang membacanya.
    sumber: provensi.sumber ?? 'ai',
    // Model dicatat HANYA bila pemanggil benar-benar tahu; tidak pernah
    // ditebak dari konfigurasi saat dibaca.
    ...(provensi.model ? { model: provensi.model } : {}),
  };
  pushEvent(user, 'recommendations_generated', {
    jumlah: recommendations?.rekomendasi?.length ?? 0,
    peringatan: recommendations?.peringatan?.length ?? 0,
  });
  return user.recommendations;
}
