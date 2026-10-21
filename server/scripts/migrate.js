/**
 * Applies the SQL files in database/migrations in filename order.
 * Each file runs in its own transaction and is recorded in
 * schema_migrations, so re-running only applies new files.
 *
 * Usage (from the /server folder, after configuring .env):
 *   npm run migrate
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR || path.join(__dirname, '..', '..', 'database', 'migrations');

// Fingerprint of a migration file (line endings ignored)
const checksumOf = (sql) => crypto.createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');

// Applies pending migrations using the given pg Pool; returns the files applied.
// A file that was already applied must never change: its fingerprint is kept
// and a changed file stops the update (add a new migration instead).
async function runMigrations(pool, { log = console.log } = {}) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    VARCHAR(255) PRIMARY KEY,
      applied_at  TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum CHAR(64)');

  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const sums = Object.fromEntries(files.map((f) => [f, checksumOf(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'))]));
  const appliedRows = (await pool.query('SELECT filename, checksum FROM schema_migrations')).rows;
  const changed = [];
  for (const r of appliedRows) {
    if (!sums[r.filename]) continue; // applied earlier, file since retired
    if (!r.checksum) await pool.query('UPDATE schema_migrations SET checksum = $2 WHERE filename = $1', [r.filename, sums[r.filename]]);
    else if (r.checksum !== sums[r.filename]) changed.push(r.filename);
  }
  if (changed.length && process.env.MIGRATION_ALLOW_CHANGED !== '1') {
    throw new Error(`Already-applied migration(s) were changed: ${changed.join(', ')}. Never edit an applied migration; add a new one.`);
  }
  const applied = new Set(appliedRows.map((r) => r.filename));
  const pending = files.filter((f) => !applied.has(f));

  for (const file of pending) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [file, checksumOf(sql)]);
      await client.query('COMMIT');
      log(`Applied ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`${file}: ${err.message}`);
    } finally {
      client.release();
    }
  }
  return pending;
}

if (require.main === module) {
  const { pool } = require('../config/db');
  runMigrations(pool)
    .then((applied) => {
      if (applied.length === 0) console.log('Database is up to date.');
    })
    .catch((err) => {
      console.error('Migration failed:', err.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

module.exports = { runMigrations, checksumOf };
