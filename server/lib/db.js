/**
 * Pemilih dan penyambung penyimpanan eksternal.
 *
 * ------------------------------------------------------------------
 * TIGA JENIS PENYIMPANAN, SATU URUTAN PRIORITAS
 *
 *   DATABASE_URL  → PostgreSQL (Cloud SQL / server sendiri)
 *   MONGO_URI     → MongoDB (penyimpanan terkelola Emergent)
 *   (kosong)      → berkas JSON di NOVA_DATA_DIR — dev, uji, CLI, preview
 *
 * Urutannya eksplisit dan murni (`pilihPenyimpanan`) supaya bisa diuji
 * tanpa server mana pun, dan supaya keduanya terisi sekaligus tidak
 * berubah-ubah diam-diam: PostgreSQL menang, seperti sebelumnya.
 *
 * ------------------------------------------------------------------
 * KENAPA MONGO ADA DI SINI
 *
 * Deployment produksi Emergent menyediakan MongoDB terkelola dan
 * menyuntikkan URI-nya lewat variabel lingkungan — sedangkan sistem
 * berkas pod-nya FANA: tiap redeploy mengganti container, dan seluruh
 * users.json lenyap bersamanya. Untuk mode demo kontes itu memang
 * diterima (akun demo menabur ulang sendiri); untuk pengguna sungguhan
 * itu kehilangan data yang tidak pernah memberi tahu siapa-siapa.
 * Jalur Mongo memakai bentuk beban/tulis yang sama dengan jalur
 * PostgreSQL: muat semua pengguna ke cache saat dibaca, simpan semua
 * saat ditulis — satu rumus, tiga tempat.
 *
 * ------------------------------------------------------------------
 * BATAS YANG DISADARI
 *
 * Arsitektur penyimpanan ini SATU PENULIS: cache utuh di memori, kunci
 * berkas antar proses, lalu tulis menyeluruh. Dua instance aplikasi
 * yang sama akan saling menimpa lewat cache masing-masing — dijalankan
 * dengan satu instance (lihat PRD). Kunci berkas tidak menjangkau
 * pod lain; yang menjamin kesatuan tulisan adalah antrian dalam proses.
 */
import pg from 'pg';

/*
 * Selektor murni — dibaca dari objek env, bukan dari process.env langsung,
 * supaya uji bisa memeriksa prioritas tanpa menyentuh lingkungan proses
 * dan tanpa memicu pembuatan koneksi apa pun.
 *
 * NOVA_STORAGE adalah PENGATURAN eksplisit tertinggi: platform deployment
 * (Emergent) menyuntikkan MONGO_URL otomatis ke setiap deployment, sehingga
 * menghapus berkas .env tidak pernah cukup untuk memilih jalur json.
 * `NOVA_STORAGE=json` menang atas injeksi apa pun — itu cara sah untuk
 * memaksa jalur berkas tanpa menyentuh konfigurasi platform.
 */
export function pilihPenyimpanan(env = process.env) {
  const eksplisit = String(env.NOVA_STORAGE ?? '').trim().toLowerCase();
  if (eksplisit === 'json' || eksplisit === 'mongo' || eksplisit === 'postgres') {
    return eksplisit;
  }
  if (String(env.DATABASE_URL ?? '').trim()) return 'postgres';
  const mongo = [
    'MONGO_URI',
    'MONGODB_URI',
    'MONGO_URL',
    'MONGODB_URL',
  ].find((k) => String(env[k] ?? '').trim());
  return mongo ? 'mongo' : 'json';
}

export const JENIS_PENYIMPANAN = pilihPenyimpanan();

export const MONGO_URI = ([
  process.env.MONGO_URI,
  process.env.MONGODB_URI,
  process.env.MONGO_URL,
  process.env.MONGODB_URL,
].find((v) => String(v ?? '').trim()) ?? '').trim() || null;

/** Nama basis data dan koleksi Mongo — konstanta, bukan konfigurasi. */
export const MONGO_DB = (process.env.MONGO_DB ?? '').trim() || null; // kosong = ikuti jalur URI
export const MONGO_KOLEKSI = 'users';

/* ------------------------------------------------------------- PostgreSQL */

const isPostgres = JENIS_PENYIMPANAN === 'postgres';

const rawConnectionString = process.env.DATABASE_URL;
const connectionString = rawConnectionString
  ? rawConnectionString.replace(/([?&])sslmode=[^&]*/, '$1').replace(/[?&]$/, '')
  : undefined;
const isCloudSqlSocket = rawConnectionString?.includes('/cloudsql/');
const isSslDisabled = rawConnectionString?.includes('sslmode=disable') || isCloudSqlSocket;

export const pool = isPostgres
  ? new pg.Pool({
      connectionString,
      ssl: isSslDisabled ? false : { rejectUnauthorized: false },
    })
  : null;

if (pool) {
  process.on('SIGTERM', () => pool.end());
  process.on('SIGINT', () => pool.end());
}

/**
 * Inisialisasi skema tabel PostgreSQL jika belum ada.
 */
export async function initDb() {
  if (!pool) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Tabel pengguna
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        business VARCHAR(255),
        batch VARCHAR(10),
        code_hash VARCHAR(255) UNIQUE NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        mulai_pada TIMESTAMPTZ,
        consent_versi VARCHAR(50),
        consent_agreed_at TIMESTAMPTZ,
        progress JSONB DEFAULT '{}'::jsonb,
        recommendations JSONB,
        data JSONB DEFAULT '{}'::jsonb
      );
    `);

    // Indeks untuk lookup cepat
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_code_hash ON users(code_hash);
    `);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/* ----------------------------------------------------------------- MongoDB */

let mongoClient = null;
let mongoCol = null;

/**
 * Koleksi `users` — koneksi dibuat malas dan dipakai ulang. Sekali gagal,
 * klien dibuang: kegagalan sambungan adalah keadaan yang layak dicoba
 * ulang dari nol, bukan keadaan yang bisa disembuhkan oleh klien setengah
 * jalan. (Driver v6 menyambung sendiri pada operasi pertama.)
 */
export async function mongoCollection() {
  if (mongoCol) return mongoCol;
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(MONGO_URI, {
    serverSelectionTimeoutMS: 10_000,
    retryWrites: true,
  });
  try {
    await client.connect();
  } catch (err) {
    await client.close().catch(() => {});
    throw err;
  }
  mongoClient = client;
  mongoCol = client.db(MONGO_DB || undefined).collection(MONGO_KOLEKSI);
  return mongoCol;
}

/** Menutup klien Mongo saat proses berhenti — pasangan pool.end() di atas. */
export async function tutupMongo() {
  if (!mongoClient) return;
  await mongoClient.close().catch(() => {});
  mongoClient = null;
  mongoCol = null;
}
if (JENIS_PENYIMPANAN === 'mongo') {
  process.on('SIGTERM', () => tutupMongo());
  process.on('SIGINT', () => tutupMongo());
}

/**
 * Inisialisasi koleksi Mongo — idempoten dan tidak destruktif.
 *
 * Hanya membuat indeks; `createIndex` tidak menghapus dan tidak menimpa
 * data. Indeks unik pada codeHash meniru UNIQUE di skema PostgreSQL:
 * satu kode akses hanya boleh dimiliki satu pengguna.
 */
export async function initMongo() {
  const col = await mongoCollection();
  await col.createIndex({ codeHash: 1 }, { unique: true });
}

/**
 * Uji sambungan nyata + jumlah peserta, per jenis penyimpanan.
 * Untuk json: dikembalikan null — pemeriksaannya milik lib/kesehatan.js
 * (baca/tulis berkas), bukan milik berkas ini.
 *
 * @returns {Promise<{ok: boolean, alasan?: string, peserta?: number}|null>}
 */
export async function pingPenyimpanan() {
  if (JENIS_PENYIMPANAN === 'postgres') {
    try {
      await initDb();
      const res = await pool.query('SELECT COUNT(*)::int AS n FROM users');
      return { ok: true, peserta: res.rows[0]?.n ?? 0 };
    } catch (err) {
      return { ok: false, alasan: err.code ?? err.message };
    }
  }
  if (JENIS_PENYIMPANAN === 'mongo') {
    try {
      await initMongo();
      const col = await mongoCollection();
      const peserta = await col.countDocuments({});
      return { ok: true, peserta };
    } catch (err) {
      /*
       * Hanya kode galat — bukan err.message. Jawaban /api/health terbuka
       * tanpa kode akses, dan pesan driver kadang menyebut host; identitas
       * infrastruktur bukan milik umum.
       */
      return { ok: false, alasan: err.code ?? 'tidak-terjangkau' };
    }
  }
  return null;
}
