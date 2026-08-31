import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Argumen CLI memang sebuah jalur berkas — tapi hanya berkas .json yang sah
// di sini, dan jalur relatif diselesaikan dari direktori kerja operator,
// bukan diam-diam dari tempat lain. Apa pun yang bukan itu ditolak jelas.
const argPath = process.argv[2];
if (argPath && !argPath.endsWith('.json')) {
  console.error('ERROR: berkas sumber harus berekstensi .json');
  process.exit(1);
}
const jsonPath = path.resolve(argPath || path.join(HERE, '..', 'server', 'data', 'users.json'));

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('ERROR: DATABASE_URL environment variable is required to run the migration.');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes('sslmode=disable') ? false : { rejectUnauthorized: false }
});

async function migrate() {
  console.log(`Reading data from ${jsonPath}...`);
  let data;
  try {
    const raw = await readFile(jsonPath, 'utf8');
    data = JSON.parse(raw);
  } catch (err) {
    console.error(`Could not read file: ${err.message}`);
    process.exit(1);
  }

  const users = data.users || [];
  console.log(`Found ${users.length} users to migrate.`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create table if not exists
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
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_code_hash ON users(code_hash);
    `);

    for (const user of users) {
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
      console.log(`Migrated user: ${id} (${name})`);
    }

    await client.query('COMMIT');
    console.log('Migration completed successfully!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`Migration failed: ${err.message}`);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
