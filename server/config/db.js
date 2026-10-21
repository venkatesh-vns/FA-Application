// Database connection: every setting comes from server/.env (or the
// environment), so the same build runs on-premises and in the cloud.
//   DATABASE_URL          postgres://user:password@host:5432/dbname (optional; wins over the DB_* values)
//   DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
//   DB_SSL                false (default) | true / require (encrypted) | verify (encrypted + certificate check)
//   DB_SSL_CA             path of the server's CA certificate (.pem) for DB_SSL=verify
//   DB_POOL_MAX           connections per app process (default 20)
//   APP_TIME_ZONE         time zone of the business (default Asia/Kolkata)
const fs = require('fs');
require('dotenv').config();

// Timestamps are stored as local business time. Pin the app process and every
// database session to APP_TIME_ZONE, so a cloud server running on UTC shows
// and saves exactly the same times as the office server.
const TIME_ZONE = process.env.APP_TIME_ZONE || 'Asia/Kolkata';
process.env.TZ = TIME_ZONE;

const { Pool, types } = require('pg');

// Return DATE columns as plain 'YYYY-MM-DD' strings. The default converts
// them to JS Dates at local midnight, which can shift the day in transit.
types.setTypeParser(types.builtins.DATE, (value) => value);

function sslOption(prefix = 'DB_') {
  const mode = String(process.env[`${prefix}SSL`] || process.env.DB_SSL || 'false').toLowerCase();
  if (['false', '0', 'no', 'off', 'disable', ''].includes(mode)) return false;
  const caFile = process.env[`${prefix}SSL_CA`] || process.env.DB_SSL_CA;
  if (mode === 'verify' || mode === 'verify-full') {
    return { rejectUnauthorized: true, ...(caFile ? { ca: fs.readFileSync(caFile, 'utf8') } : {}) };
  }
  return { rejectUnauthorized: false }; // encrypted; certificate not checked (most managed databases)
}

/**
 * pg Pool settings from the environment. prefix 'ARCHIVE_DB_' reads the
 * archive database settings, falling back to the main DB_* values.
 */
function dbConfig(prefix = 'DB_', overrides = {}) {
  const get = (key) => process.env[`${prefix}${key}`] || process.env[`DB_${key}`];
  const url = prefix === 'DB_' ? process.env.DATABASE_URL : process.env[`${prefix}URL`];
  const base = url
    ? { connectionString: url }
    : { user: get('USER'), password: get('PASSWORD'), host: get('HOST') || 'localhost', port: parseInt(get('PORT'), 10) || 5432, database: get('NAME') };
  return {
    ...base,
    ssl: sslOption(prefix),
    max: Number(process.env.DB_POOL_MAX) || 20,
    connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS) || 10000,
    idleTimeoutMillis: 30000,
    ...overrides,
  };
}

// every new connection works in the business time zone
function createPool(config) {
  const p = new Pool({ ...config, options: `-c timezone=${TIME_ZONE.replace(/[^A-Za-z0-9_/+-]/g, '')}` });
  p.on('error', (err) => { console.error('Unexpected database error:', err.message); });
  return p;
}

// PostgreSQL connection pool
const pool = createPool(dbConfig());

// getPool kept for naming consistency with the rest of the app;
// simply returns the shared pg Pool instance.
async function getPool() {
  return pool;
}

// Runs fn(client) inside BEGIN/COMMIT, rolling back if it throws.
// Models accept the client as their `db` argument so a record change and
// its audit row are saved together or not at all.
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Where the app is connected (no password), for Settings and the start-up log
function connectionSummary() {
  const c = dbConfig();
  if (c.connectionString) {
    try {
      const u = new URL(c.connectionString);
      return { host: u.hostname, port: Number(u.port) || 5432, database: u.pathname.replace(/^\//, ''), user: decodeURIComponent(u.username), ssl: Boolean(c.ssl) };
    } catch { return { host: '(DATABASE_URL)', port: '', database: '', user: '', ssl: Boolean(c.ssl) }; }
  }
  return { host: c.host, port: c.port, database: c.database, user: c.user, ssl: Boolean(c.ssl) };
}

module.exports = { pool, getPool, withTransaction, dbConfig, createPool, connectionSummary, TIME_ZONE };
