// Full database backup with pg_dump (custom format, restorable with pg_restore).
// pg_dump is taken from PG_DUMP_PATH, else the PATH, else the newest
// "C:\Program Files\PostgreSQL\<version>\bin". Files go to BACKUP_DIR
// (default: <app>/backups).
const fs = require('fs');
const path = require('path');
const { execFile, execFileSync } = require('child_process');
const { httpError } = require('./httpError');

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '..', '..', 'backups');

function findPgDump() {
  if (process.env.PG_DUMP_PATH && fs.existsSync(process.env.PG_DUMP_PATH)) return process.env.PG_DUMP_PATH;
  try {
    const found = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['pg_dump'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    if (found) return found;
  } catch { /* not on PATH */ }
  if (process.platform === 'win32') {
    const root = 'C:\\Program Files\\PostgreSQL';
    if (fs.existsSync(root)) {
      const versions = fs.readdirSync(root).filter((v) => fs.existsSync(path.join(root, v, 'bin', 'pg_dump.exe')))
        .sort((a, b) => Number(b) - Number(a));
      if (versions.length) return path.join(root, versions[0], 'bin', 'pg_dump.exe');
    }
  }
  return null;
}

/**
 * Backs up the whole live database; resolves to { file, bytes }.
 * name: part of the file name, e.g. 'before_archive_FY_2025-26'.
 */
function backupDatabase(name) {
  const pgDump = findPgDump();
  if (!pgDump) {
    throw httpError(500, 'pg_dump was not found, so no backup could be taken. Set PG_DUMP_PATH in server\\.env to pg_dump.exe (PostgreSQL bin folder).');
  }
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const file = path.join(BACKUP_DIR, `${process.env.DB_NAME}_${String(name).replace(/[^A-Za-z0-9_-]+/g, '_')}_${stamp}.backup`);
  const args = ['-h', process.env.DB_HOST || 'localhost', '-p', String(process.env.DB_PORT || 5432), '-U', process.env.DB_USER, '-Fc', '-f', file, process.env.DB_NAME];
  return new Promise((resolve, reject) => {
    execFile(pgDump, args, { env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD || '' }, timeout: 30 * 60000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        reject(httpError(500, `Backup failed, nothing was archived: ${String(stderr || err.message).trim().slice(0, 300)}`));
        return;
      }
      resolve({ file, bytes: fs.statSync(file).size });
    });
  });
}

module.exports = { backupDatabase, findPgDump, BACKUP_DIR };
