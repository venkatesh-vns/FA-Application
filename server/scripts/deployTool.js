/**
 * Database steps of the release / deployment scripts (deploy\*.ps1). Each
 * command reads the settings of one environment from its config.env.
 *
 *   node deployTool.js backup          --env <config.env> --name <text>        -> {"file","bytes"}
 *   node deployTool.js refresh-staging --from <prod config.env> --env <staging config.env>
 *   node deployTool.js ping           --env <config.env>                      -> {"connected","server","records","users"}
 *   node deployTool.js migration-count --env <config.env>                      -> {"count"}
 *   node deployTool.js record          --env <config.env> --version 1.1.0 --environment staging
 *                                      --status deployed --by <name> [--backup f] [--migrations a,b] [--notes t]
 *   node deployTool.js check-approval  --env <staging config.env> --version 1.1.0
 *   node deployTool.js restore         --env <config.env> --file <backup>      (replaces the database contents)
 *   node deployTool.js schema          --env <config.env> --out <file.sql>     (database structure, no data)
 *   node deployTool.js backup-sql      --env <config.env> --out <file.sql>     (plain SQL backup)
 *
 * Prints one JSON line on success; on failure prints the reason and exits 1.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const dotenv = require('dotenv');

const args = process.argv.slice(2);
const command = args[0];
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const done = (obj) => { console.log(JSON.stringify(obj)); process.exit(0); };
const fail = (message) => { console.error(message); process.exit(1); };

function loadEnv(file) {
  if (!file || !fs.existsSync(file)) fail(`Settings file not found: ${file}`);
  return dotenv.parse(fs.readFileSync(file));
}

// pg_dump / pg_restore / psql next to each other in the PostgreSQL bin folder
function pgTool(name) {
  const { findPgDump } = require('../utils/backup');
  const dump = findPgDump();
  if (!dump) fail('PostgreSQL tools (pg_dump) not found. Set PG_DUMP_PATH in the environment settings.');
  const tool = path.join(path.dirname(dump), process.platform === 'win32' ? `${name}.exe` : name);
  if (!fs.existsSync(tool)) fail(`${name} not found next to ${dump}.`);
  return tool;
}

const pgArgs = (e) => ['-h', e.DB_HOST || 'localhost', '-p', String(e.DB_PORT || 5432), '-U', e.DB_USER];
const pgEnv = (e) => ({ ...process.env, PGPASSWORD: e.DB_PASSWORD || '' });
const run = (tool, list, e) => execFileSync(tool, list, { env: pgEnv(e), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, maxBuffer: 64 * 1024 * 1024 }).toString();

// a pg Pool for the environment (dotenv values into process.env first)
function poolFor(e) {
  Object.assign(process.env, e);
  return require('../config/db').pool;
}

async function main() {
  if (command === 'backup') {
    const e = loadEnv(opt('env'));
    Object.assign(process.env, e);
    const { backupDatabase } = require('../utils/backup');
    const out = await backupDatabase(opt('name') || 'backup');
    return done(out);
  }

  if (command === 'refresh-staging') {
    const prod = loadEnv(opt('from'));
    const stage = loadEnv(opt('env'));
    if (!stage.DB_NAME || stage.DB_NAME === prod.DB_NAME) fail('The staging database must be different from the production database.');
    if (!/staging/i.test(stage.DB_NAME)) fail(`Refusing to overwrite "${stage.DB_NAME}": the staging database name must contain "staging".`);
    const tmp = path.join(require('os').tmpdir(), `fa_staging_refresh_${Date.now()}.backup`);
    run(pgTool('pg_dump'), [...pgArgs(prod), '-Fc', '-f', tmp, prod.DB_NAME], prod);
    const psql = pgTool('psql');
    run(psql, [...pgArgs(stage), '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', `DROP DATABASE IF EXISTS "${stage.DB_NAME}" WITH (FORCE)`], stage);
    run(psql, [...pgArgs(stage), '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', `CREATE DATABASE "${stage.DB_NAME}"`], stage);
    run(pgTool('pg_restore'), [...pgArgs(stage), '--no-owner', '-d', stage.DB_NAME, tmp], stage);
    fs.unlinkSync(tmp);
    // nobody is signed in on the fresh copy
    const pool = poolFor(stage);
    await pool.query('DELETE FROM qty_locks');
    await pool.query('DELETE FROM sessions');
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM fa_records');
    await pool.end();
    return done({ refreshed: stage.DB_NAME, from: prod.DB_NAME, records: rows[0].n });
  }

  // Can the settings reach the database? Is it empty or does it hold FA data?
  if (command === 'ping') {
    const pool = poolFor(loadEnv(opt('env')));
    try {
      const v = (await pool.query("SELECT current_setting('server_version') AS v, current_database() AS db")).rows[0];
      const has = (await pool.query("SELECT to_regclass('public.fa_records') IS NOT NULL AS t, to_regclass('public.users') IS NOT NULL AS u")).rows[0];
      const records = has.t ? (await pool.query('SELECT COUNT(*)::int AS n FROM fa_records')).rows[0].n : 0;
      const users = has.u ? (await pool.query('SELECT COUNT(*)::int AS n FROM users')).rows[0].n : 0;
      await pool.end();
      return done({ connected: true, server: v.v, database: v.db, hasTables: has.t, records, users });
    } catch (err) {
      await pool.end().catch(() => {});
      return fail(`Cannot connect to the database: ${err.message}`);
    }
  }

  // After restoring a backup on another server: nobody is signed in, no invoice reserved
  if (command === 'reset-sessions') {
    const pool = poolFor(loadEnv(opt('env')));
    const s = await pool.query('DELETE FROM sessions');
    await pool.query('DELETE FROM qty_locks').catch(() => {});
    await pool.end();
    return done({ sessionsEnded: s.rowCount });
  }

  if (command === 'migration-count') {
    const pool = poolFor(loadEnv(opt('env')));
    let n = 0;
    try { n = (await pool.query('SELECT COUNT(*)::int AS n FROM schema_migrations')).rows[0].n; } catch { n = 0; }
    await pool.end();
    return done({ count: n });
  }

  if (command === 'record') {
    const pool = poolFor(loadEnv(opt('env')));
    const environment = opt('environment');
    const version = opt('version');
    const status = opt('status') || 'deployed';
    if (status === 'deployed') {
      await pool.query("UPDATE app_releases SET status = 'replaced' WHERE environment = $1 AND status = 'deployed'", [environment]);
    }
    await pool.query(
      'INSERT INTO app_releases (version, environment, status, deployed_by, backup_file, migrations, notes) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [version, environment, status, opt('by') || '', opt('backup') || '', opt('migrations') || '', opt('notes') || '']
    );
    await pool.end();
    return done({ recorded: version, environment, status });
  }

  if (command === 'check-approval') {
    const pool = poolFor(loadEnv(opt('env')));
    const version = opt('version');
    let row;
    try {
      row = (await pool.query(
        "SELECT approved_by, approved_at, approval_note FROM app_releases WHERE environment = 'staging' AND version = $1 AND approved_at IS NOT NULL ORDER BY release_id DESC LIMIT 1",
        [version]
      )).rows[0];
    } finally {
      await pool.end();
    }
    if (!row) fail(`Version ${version} is not approved on Staging (SP). Deploy it to staging, let users test it, then approve it in Administration > Releases.`);
    return done({ approved: version, by: row.approved_by, at: row.approved_at, note: row.approval_note });
  }

  // Database scripts for a new installation / pgAdmin: every table, index and
  // function (no data), plus the list of applied migrations
  if (command === 'schema') {
    const e = loadEnv(opt('env'));
    const out = opt('out');
    const dump = pgTool('pg_dump');
    const schema = run(dump, [...pgArgs(e), '--schema-only', '--no-owner', '--no-privileges', e.DB_NAME], e);
    const versions = run(dump, [...pgArgs(e), '--data-only', '--no-owner', '--inserts', '-t', 'schema_migrations', e.DB_NAME], e);
    const head = [
      '-- FA Management System - database structure (no data)',
      `-- Generated ${new Date().toISOString().slice(0, 10)} from ${e.DB_NAME}.`,
      '-- New installation: create an empty database, run this file (psql or pgAdmin Query Tool),',
      '-- then create the first Admin with: npm run seed (in the server folder).',
      '-- The application itself applies later database changes (database/migrations) at each deployment.',
      '', '',
    ].join('\n');
    fs.writeFileSync(out, `${head}${schema}\n-- applied database changes\n${versions}`);
    return done({ file: out, bytes: fs.statSync(out).size });
  }

  // Plain SQL backup (opens in any SQL tool; pgAdmin restores the .backup file too)
  if (command === 'backup-sql') {
    const e = loadEnv(opt('env'));
    const out = opt('out');
    run(pgTool('pg_dump'), [...pgArgs(e), '--no-owner', '--no-privileges', '-f', out, e.DB_NAME], e);
    return done({ file: out, bytes: fs.statSync(out).size });
  }

  if (command === 'restore') {
    const e = loadEnv(opt('env'));
    const file = opt('file');
    if (!file || !fs.existsSync(file)) fail(`Backup file not found: ${file}`);
    run(pgTool('pg_restore'), [...pgArgs(e), '--clean', '--if-exists', '--no-owner', '-d', e.DB_NAME, file], e);
    return done({ restored: e.DB_NAME, from: file });
  }

  return fail(`Unknown command "${command}".`);
}

main().catch((err) => fail(err.stderr ? String(err.stderr).trim() : err.message));
