import pg from 'pg';

const isPostgres = Boolean(process.env.DATABASE_URL);

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
