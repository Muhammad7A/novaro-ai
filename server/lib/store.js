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
import { buatAdvisori, digestDasarAngka, EVALUASI_MAKS, pangkasAdvisori, VERSI_FITUR_ADVISORI } from './advisori.js';
import { ALASAN_TOLAK_SAH, bukaToken, GalatToken, VERSI_FITUR_PROPOSAL_SCAN } from './proposal.js';
import { JENIS, isValidKategori, tanggalTerlama, tanggalWIB } from './cashbook.js';
import { totalSoal } from './latihan.js';
import { pool, initDb, JENIS_PENYIMPANAN, mongoCollection } from './db.js';
import { muatAtauSeed, simpanSemua as simpanSemuaMongo } from './mongo-store.js';
import { denganKunci } from './kunci.js';
import { direktoriData } from './backup.js';
import {
  entriMagicLink,
  entriSesi,
  hashToken,
  magicLinkHidup,
  MAKS_SESI,
  sesiKedaluwarsa,
  tokenBaru,
} from './autentikasi.js';

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
 * Resolusinya SATU tempat sejak sesi G fase 4: direktoriData() di lib/backup.js
 * (M0-lite — dulu rumus yang sama disalin di beberapa berkas).
 */
const DATA_DIR = direktoriData();
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
export const BATCH_SAH = ['DEMO'];

/** Menormalkan masukan batch: 'DEMO' (showroom) atau '' (akun nyata). B1/B2 waitlist-control sudah dihapus — lihat RESEARCH-DEPENDENCY-REMOVAL.md. */
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
          const { id, name, business, batch, codeHash, createdAt, consent, progress, recommendations, ...rest } = user;
          await client.query(
            `
            INSERT INTO users (id, name, business, batch, code_hash, created_at, consent_versi, consent_agreed_at, progress, recommendations, data)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (id) DO UPDATE SET
              name = EXCLUDED.name,
              business = EXCLUDED.business,
              batch = EXCLUDED.batch,
              code_hash = EXCLUDED.code_hash,
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
      try {
        await flush(db);
      } catch (err) {
        /*
         * Aturan yang sama dengan mutator yang gagal, untuk kegagalan yang
         * datang belakangan: `db` yang sudah berubah tidak pernah sampai ke
         * disk, tapi `cache` masih memegangnya — dan sidik berkas masih
         * cocok dengan berkas lama yang utuh, jadi pembacaan berikutnya akan
         * melayani mutasi yang DITOLAK ke pemanggilnya seolah sudah nyata.
         * Lebih berbahaya lagi, penulisan sukses berikutnya akan meng-commit
         * diam-diam mutasi yang ditolak itu — dan dedup requestId-nya akan
         * menjawab `duplikat` untuk percobaan ulang yang belum pernah persist.
         * Cache dibuang: pembacaan kembali ke kebenaran disk.
         */
        cache = null;
        cacheSidik = null;
        throw err;
      }
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
 * Menempelkan satu sesi baru pada obyek pengguna HIDUP di dalam mutator.
 *
 * Token diundi di sini (parameter opsional hanya untuk konsumsiMagicLink yang
 * sudah mengundi) — maksimal MAKS_SESI sesi aktif, yang paling tua terlempar.
 * Event `sesi_dibuat` mencatat JALUR masuknya (kode/magic-link/oauth), tanpa
 * token, tanpa nomor: sesi berapa banyak dan lewat apa cukup, isinya tidak.
 */
function terbitkanSesiPada(user, jalur, tokenSudahAda) {
  const token = tokenSudahAda ?? tokenBaru('sesi');
  (user.sessions ??= []).push(entriSesi(token));
  if (user.sessions.length > MAKS_SESI) user.sessions = user.sessions.slice(-MAKS_SESI);
  pushEvent(user, 'sesi_dibuat', { jalur });
  return token;
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
    email: user.email ?? null,
    emailTerverifikasi: Boolean(user.emailVerifiedAt),
    business: user.business ?? null,
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

  /* ------------------------------------------- Identitas email + sesi (W3) */

  /**
   * Mencari pengguna berdasarkan surel ternormalkan.
   *
   * Surel adalah identitas UNIK: satu alamat satu akun. Pencarian di sini
   * dipakai jalur magic-link dan pemeriksaan bentrok saat memasang surel.
   */
  async findByEmail(email) {
    if (!email) return null;
    const db = await load();
    const user = db.users.find((u) => u.email === email);
    return user ? structuredClone(user) : null;
  },

  /**
   * Memasang surel pada akun — jalur migrasi pengguna kode akses.
   *
   * Surel belum terverifikasi sampai tautan ajaibnya benar-benar dipakai;
   * `emailVerifiedAt` diisi oleh konsumsiMagicLink, bukan di sini. Alamat
   * yang sudah milik akun lain ditolak eksplisit (409), bukan diam-diam
   * dipindahkan — kepemilikan identitas tidak boleh berpindah tanpa jejak.
   */
  async pasangEmail(userId, email) {
    return update((db) => {
      const pemilikLama = db.users.find((u) => u.email === email && u.id !== userId);
      if (pemilikLama) {
        throw new GalatMutasi('email-terpakai', 409, 'This email address is already linked to another account.');
      }
      const user = db.users.find((u) => u.id === userId);
      if (!user) return null;
      user.email = email;
      user.emailVerifiedAt = null;
      pushEvent(user, 'email_dipasang');
      return publicUser(user);
    });
  },

  /**
   * Menaruh satu tautan ajaib pada akun pemilik surel ini.
   *
   * Satu tautan aktif per akun — yang baru menimpa yang lama, jadi tabelnya
   * tidak pernah menumpuk tautan berumur panjang. Mengembalikan id pengguna
   * (untuk diteruskan ke surel) atau null bila surelnya tidak dikenal;
   * PEMANGGIL wajib merespons sama rata (anti-enumerasi).
   */
  async aturMagicLink(email, token) {
    return update((db) => {
      const user = db.users.find((u) => u.email === email);
      if (!user) return null;
      user.magicLink = entriMagicLink(token);
      pushEvent(user, 'magic_link_diminta');
      return user.id;
    });
  },

  /**
   * Mengambil tautan ajaib yang HIDUP (belum dipakai, belum kedaluwarsa)
   * untuk surel ini — dipakai rute /api/me/email yang mengirim ulang tautan
   * verifikasi tanpa menimpa yang lama, dan oleh uji untuk mengintip token.
   */
  async magicLinkAktif(email) {
    const user = await this.findByEmail(email);
    const m = user?.magicLink;
    return m && magicLinkHidup(m) ? m : null;
  },

  /**
   * Memeriksa token tautan ajaib: sekali pakai, berumur pendek.
   *
   * Diterima → tandai dipakai, surel kini TERVERIFIKASI (kepemilikan alamat
   * terbukti lewat jalur pengiriman), terbitkan sesi, dan kembalikan pengguna
   * + token sesi mentah (satu-satunya kali token keluar). Ditolak → null;
   * penelepon wajib menunda dan menjawab generik supaya token tidak bisa
   * dijelajahi dari bedanya jawaban.
   */
  async konsumsiMagicLink(token) {
    const hash = hashToken(token);
    return update((db) => {
      const user = db.users.find((u) => u.magicLink?.hash === hash);
      if (!user || !magicLinkHidup(user.magicLink)) return null;
      user.magicLink.dipakai = new Date().toISOString();
      user.emailVerifiedAt = user.magicLink.dipakai;
      pushEvent(user, 'magic_link_dipakai');
      const sesi = terbitkanSesiPada(user, 'magic-link');
      return { user: structuredClone(user), sesi };
    });
  },

  /**
   * Mencari pengguna dari token sesi — jalur utama header Authorization
   * edisi enterprise. Sesi kedaluwarsa dibuang malas saat tersentuh; token
   * yang tidak cocok apa pun → null (penelepon memakai guard yang sama
   * dengan kode akses, jadi penebakan tetap dibatasi dan tercatat).
   */
  async cariDenganSesi(token) {
    if (!token) return null;
    const hash = hashToken(token);
    const db = await load();
    const user = db.users.find((u) => u.sessions?.some((s) => s.hash === hash));
    if (!user) return null;
    const hidup = user.sessions.filter((s) => !sesiKedaluwarsa(s));
    if (hidup.some((s) => s.hash === hash)) return structuredClone(user);
    // Sesi ini kedaluwarsa — buang yang basi lalu jawab tidak-dikenal.
    update((d) => {
      const u = d.users.find((x) => x.id === user.id);
      if (u) u.sessions = (u.sessions ?? []).filter((s) => !sesiKedaluwarsa(s));
    }).catch(() => {});
    return null;
  },

  /** Mencabut satu sesi (keluar dari perangkat ini). Token lain milik akun yang sama tetap hidup. */
  async cabutSesi(token) {
    const hash = hashToken(token);
    return update((db) => {
      const user = db.users.find((u) => u.sessions?.some((s) => s.hash === hash));
      if (!user) return false;
      user.sessions = user.sessions.filter((s) => s.hash !== hash);
      pushEvent(user, 'sesi_dicabut');
      return true;
    });
  },

  /**
   * Menerbitkan sesi baru dari luar mutator (dipakai jalur OAuth nanti).
   * Token mentah kembali SATU kali; yang tersimpan hanya hash-nya.
   */
  async terbitkanSesi(userId, jalur) {
    const token = tokenBaru('sesi');
    const ok = await update((db) => {
      const user = db.users.find((u) => u.id === userId);
      if (!user) return false;
      terbitkanSesiPada(user, jalur, token);
      return true;
    });
    return ok ? token : null;
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
    const { user, accessCode: code } = bentukPenggunaBaru({ name, business, batch });
    await update((db) => {
      db.users.push(user);
      pushEvent(user, 'user_created', user.batch ? { batch: user.batch } : undefined);
    });
    return { user, accessCode: code }; // kode hanya bisa dilihat sekali, di sini
  },

  /**
   * Pendaftaran mandiri (self-serve signup, W1 exit gap #1) — identitas
   * PENDING: rekam pengguna lahir BELUM terverifikasi di sini, dan
   * verifikasinya (verifikasiSignup) yang mengangkat `emailVerifiedAt`.
   *
   * Single-use dengan label jujur (disiplin jti = keberadaan baris di
   * lib/proposal.js): sekali pakai token = keberadaan verifikasi itu sendiri
   * — putaran kedua menemukan `emailVerifiedAt` terisi dan ditolak 409.
   * Respons rute tetap NETRAL untuk surel yang sudah berakun — keberadaan
   * akun tidak boleh bisa dihitung dari bedanya jawaban; yang terjadi di
   * baliknya: akun lama hanya mencatat signup_requested (sinyal keamanan),
   * tanpa rekam baru, tanpa token baru yang berarti.
   *
   * @returns {{userId: string, sudah: boolean}} sudah = email terverifikasi (akun lama)
   */
  async mulaiSignup(email, requestHash) {
    return update((db) => {
      let user = db.users.find((u) => u.email === email);
      if (!user) {
        user = bentukPenggunaBaru({ name: '', business: '', batch: '' }).user;
        user.email = email;
        db.users.push(user);
        pushEvent(user, 'user_created');
      }
      return { userId: user.id, sudah: Boolean(user.emailVerifiedAt) };
    });
  },

  /**
   * Mengonsumsi verifikasi signup: mengangkat `emailVerifiedAt`, mencatat
   * signup_verified {userId}, dan menerbitkan sesi pertama — persis pola
   * konsumsiMagicLink. Satu-satunya jalan menaikkan verified dari jalur
   * signup; jalur magic-link/kode akses tidak tersentuh.
   *
   * @returns {{user: object, sesi: object}|null} null = akunnya lenyap
   * @throws {GalatMutasi} duplikat (409) bila sudah terverifikasi — replay
   */
  async verifikasiSignup(email) {
    return update((db) => {
      const user = db.users.find((u) => u.email === email);
      if (!user) return null;
      if (user.emailVerifiedAt) {
        throw new GalatMutasi('duplikat', 409, 'This signup link was already used. Sign in instead.');
      }
      user.emailVerifiedAt = new Date().toISOString();
      pushEvent(user, 'signup_verified', { userId: user.id });
      const sesi = terbitkanSesiPada(user, 'signup');
      return { user: structuredClone(user), sesi };
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
   * Simpan profil usaha (self-report pengguna).
   *
   * Sejak RESEARCH-DEPENDENCY-REMOVAL.md tidak ada lagi riwayat versi profil
   * (garis dasar riset): profil yang tersimpan selalu versi terakhir, dan
   * rekomendasi lama otomatis dilucuti karena tidak lagi cocok dengan profil
   * yang baru.
   */
  async saveProfile(userId, profile) {
    return update((db) => {
      const user = db.users.find((u) => u.id === userId);
      if (!user) return null;

      const now = new Date().toISOString();
      user.profile = { ...profile, updatedAt: now };
      // Rekomendasi lama tidak lagi cocok dengan profil baru.
      user.recommendations = null;
      if (profile.namaUsaha) user.business = profile.namaUsaha;

      pushEvent(user, 'profile_saved', {});
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
  async addTransaction(userId, transaction, { aktor, requestId, proposalToken } = {}) {
    return update((db) => {
      const user = db.users.find((u) => u.id === userId);
      if (!user) return null;
      const row = barisTransaksiSah(transaction, {
        aktor,
        requestId,
        proposalToken,
        transactionsLama: user.transactions,
      });
      // push, bukan sebar — alasannya sama dengan pushEvent di bawah.
      (user.transactions ??= []).push(row);
      if (row.origin === 'proposal') {
        // Stempel fitur M1: rel proposal scan-nota — set-if-absent, metadata.
        user.featureVersions ??= {};
        user.featureVersions['proposal-scan'] ??= VERSI_FITUR_PROPOSAL_SCAN;
      }
      pushEvent(user, 'transaction_added', {
        jenis: row.jenis,
        kategori: row.kategori,
        tanggal: row.tanggal,
        mundur: row.tanggal < row.createdAt.slice(0, 10),
        // Asal mengikuti baris: jejak penelitian boleh memuat kosakata tertutup
        // ini — ia bukan nominal dan bukan teks bebas (lihat uji penelitian).
        // proposalId TIDAK ikut di meta: join shown⋈row bekerja lewat baris
        // (proposal_shown membawa id yang sama) — tanpa memperluas skema event.
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

  /**
   * Checkup hasil AI diingat — keluaran sanitizer yang sama, satu penulisan
   * untuk usage + rekam advisori.
   *
   * Dulu checkup sengaja tidak pernah disimpan (hanya ke layar) — dan pembersih
   *nya tidak berubah sedikit pun. Yang berubah adalah nasihat yang menguap:
   * tanpa memori, tidak ada cara menjawab "checkup kemarin bilang apa, dan
   * apakah kejadiannya". Rekamannya append-only murni: checkup tidak menimpa
   * slot mana pun dan tidak pernah menyentuh transaksi.
   *
   * WIRED (keputusan owner YA 2026-09-13): rute checkup kini memanggil metode
   * ini menggantikan recordUsage-nya — keputusan Open Question #7 laporan
   * Sesi G dicatat di sana.
   */
  async simpanCheckup(userId, hasil, usage, provensi = {}) {
    return update((db) => {
      const user = db.users.find((u) => u.id === userId);
      if (!user) return null;
      catatUsage(user, usage);
      return rekamAdvisoriKe(user, {
        jenis: 'checkup',
        isi: hasil,
        sumber: provensi.sumber ?? 'ai',
        model: provensi.model ?? null,
      });
    });
  },

  /**
   * Menambahkan hasil checkpoint advisori — SATU penulisan untuk seluruh
   * batch yang jatuh tempo pada satu pembacaan.
   *
   * Idempoten dua lapis: pemanggil (evaluasiSaatDibaca) sudah menyaring id
   * yang terlanjur bernilai, dan mutator ini menyaring LAGI di dalam kunci —
   * dua pembacaan hampir bersamaan tidak menghasilkan rekam kembar.
   * Evaluasi yang statusnya 'tak-terukur' TETAP masuk: ketiadaan hasil yang
   * terlihat adalah kejujuran; keheningan adalah dusta.
   *
   * Rekamnya trim di 48 terbaru (EVALUASI_MAKS — sink dengan kap advisori).
   * Jejak eventnya tidak pernah dipangkas, jadi riwayat lengkap tetap ada.
   */
  async tambahEvaluasiAdvisori(userId, daftar) {
    return update((db) => {
      const user = db.users.find((u) => u.id === userId);
      if (!user || !Array.isArray(daftar) || !daftar.length) return [];
      const sudah = new Set((user.evaluasiAdvisori ?? []).map((e) => e?.advisoriId));
      const baru = daftar.filter((e) => e?.advisoriId && !sudah.has(e.advisoriId));
      if (!baru.length) return [];
      user.evaluasiAdvisori = [...(user.evaluasiAdvisori ?? []), ...baru].slice(-EVALUASI_MAKS);
      for (const e of baru) {
        pushEvent(user, 'evaluasi_advisori', { id: e.advisoriId, metode: e.metode, status: e.status });
      }
      return baru;
    });
  },

  /**
   * Satu tulis untuk rute scan saat fitur proposal aktif: pemakaian token
   * DAN peristiwa proposal_shown — menunggangi penulisan usage yang memang
   * sudah terjadi (§9.3: NOL tulisan baru; dulu rute memanggil recordUsage).
   *
   * Tanpa proposal (fitur mati / rahasia belum dipasang), rute tetap memakai
   * recordUsage biasa — jalur itu tidak berubah.
   *
   * @param {{id: string, tingkat?: string|null}} proposal id usulan + tingkat keyakinan
   */
  async catatProposalScan(userId, proposal, usage) {
    return update((db) => {
      const user = db.users.find((u) => u.id === userId);
      if (!user) return null;
      catatUsage(user, usage);
      pushEvent(user, 'proposal_shown',
        proposal?.tingkat ? { id: proposal.id, tier: proposal.tingkat } : { id: proposal.id });
      return user.usage;
    });
  },

  /**
   * Penolakan EKSPLISIT satu usulan — satu peristiwa, satu penulisan.
   *
   * Idempoten: usulan yang sudah pernah ditolak tidak menambah peristiwa
   * kedua (ketukan ganda pada tombol tolak bukan dua keputusan). Alasan
   * kosakata tertutup — bukan teks bebas; kosong diizinkan (menolak tanpa
   * memilih alasan tetap sah). TANPA delta event: penerimaan tetap diturunkan
   * dari shown ⋈ baris, bukan disimpan di sini.
   */
  async tolakProposal(userId, proposalId, alasan) {
    return update((db) => {
      const user = db.users.find((u) => u.id === userId);
      if (!user) return null;
      if (alasan != null && alasan !== '' && !ALASAN_TOLAK_SAH.includes(alasan)) {
        throw new GalatMutasi('alasan-tolak', 400, `Alasan penolakan tidak dikenali. Pilihannya: ${ALASAN_TOLAK_SAH.join(', ')}.`);
      }
      const pernah = (user.events ?? []).some((e) => e.type === 'proposal_rejected' && e.meta?.id === proposalId);
      if (pernah) return { sudah: true };
      pushEvent(user, 'proposal_rejected',
        alasan ? { id: proposalId, alasan } : { id: proposalId });
      return { sudah: false };
    });
  },

  /**
   * Hasil examiner sidecar interviu (W1 fase 3) — slot TUNGGAL terbaru,
   * satu penulisan untuk rekam + peristiwanya.
   *
   * verdict 'ok'|'insufficient' = keluaran sidecar; 'unavailable' = sidecar
   * tak terjangkau saat penutupan interviu — kegagalan yang dicatat jujur,
   * bukan crash. perArea (area string dari sidecar + angka) tinggal DI SINI:
   * untuk tampilan, bukan untuk jejak — kosakata area bukan milik skema
   * event yang contentless.
   */
  async simpanExaminer(userId, examiner) {
    return update((db) => {
      const user = db.users.find((u) => u.id === userId);
      if (!user) return null;
      user.examiner = {
        intakeId: examiner.intakeId,
        verdict: examiner.verdict,
        ...(Number.isFinite(examiner.coverage) ? { coverage: examiner.coverage } : {}),
        perArea: Array.isArray(examiner.perArea) ? examiner.perArea : [],
        pada: new Date().toISOString(),
      };
      pushEvent(user, 'interview_examined', {
        intakeId: examiner.intakeId,
        verdict: examiner.verdict,
        ...(Number.isFinite(examiner.coverage) ? { coverage: examiner.coverage } : {}),
      });
      return user.examiner;
    });
  },

  /** Jejak pemakaian token harian, untuk memeriksa anggaran. */
  async getTokenLog(userId) {
    const db = await load();
    return salin(db.users.find((u) => u.id === userId)?.tokenLog);
  },
};

/* --------------------------------------------- Pembantu di dalam mutator */

/**
 * Bentuk awal satu pengguna baru — SATU sumber untuk dua pintu pembuatan:
 * createUser (pendamping/CLI) dan mulaiSignup (pendaftaran mandiri). Dua
 * pintu, satu bentuk — medan baru pada rekam pengguna cukup ditambah di sini.
 */
function bentukPenggunaBaru({ name, business = '', batch = '' }) {
  const code = generateAccessCode();
  const user = {
    id: `usr_${randomBytes(6).toString('hex')}`,
    name,
    business,
    batch: normalBatch(batch),
    codeHash: hashCode(code),
    createdAt: new Date().toISOString(),
    profile: null,
    /*
     * Tanggal mulai jalur belajar, ditetapkan pendamping — BUKAN createdAt.
     * Peserta didaftarkan berhari-hari sebelum pendampingan, dan B2 menyusul
     * jauh di belakang B1; memulai hitungan sendiri saat pendaftaran berarti
     * hari ke-1 seseorang bisa jatuh sebelum pre-test-nya sendiri.
     */
    recommendations: null,
    chat: [],
    transactions: [],
    progress: {},
    events: [], // append-only: "apa yang terjadi, kapan"
    usage: { requests: 0, inputTokens: 0, outputTokens: 0 },
    // Riwayat nasihat (Sesi G — memori advisori): append-only, trim per jenis.
    // Pengguna lama tanpa medan ini tetap sah — jalur tulis mengisi apa adanya.
    advisori: [],
    // Stempel skema fitur (M1-lite): metadata era bentuk data, set-if-absent.
    // Tidak pernah menjadi penentu perilaku — jalur baca memutuskan dari
    // medan baris, bukan dari stempel.
    featureVersions: {},
  };
  return { user, accessCode: code };
}

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
 * Token proposal diperiksa PALING AKHIR: artefak sekali-pakai tidak boleh
 * terbakar oleh medan yang keliru — perbaiki medannya, token masih hidup
 * selama TTL-nya.
 *
 * Semantik angka sengaja sama dengan rute (`asNumber` di server.js): masukan
 * yang tak terbaca sebagai angka atau bernilai negatif menjadi 0 — dan 0
 * ditolak, bukan didiamkan.
 *
 * @param {object} masukan            medan mentah dari pemanggil
 * @param {{aktor?: string, requestId?: string, proposalToken?: string, transactionsLama?: Array}} opts
 * @returns {object} baris lengkap siap dorong ke `user.transactions`
 * @throws {GalatMutasi} pada aktor tak sah, medan tidak sah, id permintaan
 *   kembar, atau token proposal yang tak sah/kedaluwarsa/telah terpakai
 */
function barisTransaksiSah(masukan, { aktor, requestId, proposalToken, transactionsLama = [] } = {}) {
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

  /*
   * Konsumsi token proposal T1 surface #1 (scan-nota; addendum §25
   * 2026-09-12). Dua hal yang dipegang DI SINI, bukan di rute:
   *
   *   - origin 'proposal' hanya lahir dari token yang LULUS verifikasi
   *     (bentuk, versi, HMAC, TTL) — tubuh permintaan tidak punya parameter
   *     untuk menyetingnya; sisipan palsu sudah dibuang daftar putih di atas;
   *   - jti = KEBERADAAN BARIS: token yang id-nya sudah hidup di buku kas
   *     pengguna ini ditolak sebagai duplikat (409) — satu usulan, satu
   *     baris, selama TTL dan seumur toko (label jujur §21.4; tidak ada
   *     penyimpanan jti terpisah).
   *
   * Konsumsi adalah REKAM BARIS itu sendiri — mutator yang melempar tidak
   * pernah menulis apa pun, jadi token yang gagal karena medan lain tidak
   * hangus.
   */
  if (proposalToken != null && proposalToken !== '') {
    let isi;
    try {
      isi = bukaToken(proposalToken);
    } catch (err) {
      if (err instanceof GalatToken) {
        throw new GalatMutasi(err.kode, err.status, err.message);
      }
      throw err;
    }
    if (transactionsLama.some((t) => t?.proposalId === isi.proposalId)) {
      throw new GalatMutasi('duplikat', 409, 'Usulan ini sudah pernah disimpan. Periksa buku kas sebelum mengirim ulang.');
    }
    row.origin = 'proposal';
    row.proposalId = isi.proposalId;
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
  /*
   * Write-through memori advisori — di DALAM mutator yang sama, tanpa
   * penulisan kedua ke disk. Slot `recommendations` TETAP apa adanya: /api/me,
   * kartu fokus (aturan 7), dan kartu publik membacanya seperti kemarin.
   * Yang baru adalah riwayatnya: keluaran sanitizer yang sama direkam
   * append-only, jadi nasihat yang kemarin ditimpa kini tidak hilang.
   * (Benih demo tidak lewat sini — hidrasi demo menulis slot lewat patch,
   * sehingga ruang pamer tidak ikut menciptakan riwayat.)
   */
  rekamAdvisoriKe(user, {
    jenis: 'rekomendasi',
    isi: recommendations,
    sumber: provensi.sumber ?? 'ai',
    model: provensi.model ?? null,
  });
  return user.recommendations;
}

/**
 * Merekam satu advisori ke riwayat append-only pengguna yang sedang dimutasi.
 *
 * Dipanggil DI DALAM mutator (write-through rekomendasi, simpanCheckup) supaya
 * riwayat, slot, event, dan usage berangkat dalam SATU flush — tidak ada
 * jendela di mana riwayat sudah ada padahal nasihatnya gagal tersimpan, atau
 * sebaliknya. Trim per jenis dijalankan di sini: yang tertua dibuat pergi
 * sebelum yang baru menetap, dan kapnya diuji keras (plafon toko satu-berkas).
 */
function rekamAdvisoriKe(user, { jenis, isi, sumber, model, kini = new Date() }) {
  const rekam = buatAdvisori({
    jenis,
    isi,
    sumber,
    model: model ?? null,
    dasarAngka: digestDasarAngka(user, kini),
    kini,
  });
  user.advisori = pangkasAdvisori([...(user.advisori ?? []), rekam]);
  // Stempel skema M1-lite: set-if-absent pada shape baru, monotonik, metadata.
  user.featureVersions ??= {};
  user.featureVersions.advisori ??= VERSI_FITUR_ADVISORI;
  pushEvent(user, 'advisori_dibuat', { id: rekam.id, jenis: rekam.jenis, sumber: rekam.sumber });
  return rekam;
}
