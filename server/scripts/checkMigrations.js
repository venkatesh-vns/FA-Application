/**
 * Migration safety check (run before every release): database changes must be
 * add-only so production data is never lost. A migration may not drop or empty
 * tables / columns, delete rows, rewrite existing rows or change a column's
 * type - unless the file explains why with a line
 *   -- allow-data-change: <reason>
 * which is then listed for review.
 *
 * Usage (from /server): npm run check-migrations
 */
const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR || path.join(__dirname, '..', '..', 'database', 'migrations');
const RULES = [
  [/\bDROP\s+(TABLE|SCHEMA|DATABASE|VIEW|INDEX)\b/i, 'drops a table, schema, view or index'],
  [/\bDROP\s+COLUMN\b/i, 'drops a column'],
  [/\bTRUNCATE\b/i, 'empties a table'],
  [/\bDELETE\s+FROM\b/i, 'deletes rows'],
  [/\bUPDATE\s+[\w."]+\s+SET\b/i, 'rewrites existing rows'],
  [/\bALTER\s+COLUMN\s+[\w"]+\s+(SET\s+DATA\s+)?TYPE\b/i, "changes a column's type"],
  [/\bRENAME\s+(COLUMN|TO)\b/i, 'renames a table or column'],
];

// SQL without comments and string / dollar-quoted bodies, so text inside them is not flagged
function codeOf(sql) {
  return sql
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, (m) => m.replace(/\b(UPDATE|DELETE|DROP|TRUNCATE)\b/gi, '_'))
    .replace(/--[^\n]*/g, '')
    .replace(/'(?:[^']|'')*'/g, "''");
}

function checkMigrations(dir = MIGRATIONS_DIR) {
  const problems = [];
  const reviewed = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const allow = sql.match(/--\s*allow-data-change:\s*(.+)/i);
    const code = codeOf(sql);
    const hits = RULES.filter(([re]) => re.test(code)).map(([, what]) => what);
    if (!hits.length) continue;
    if (allow) reviewed.push(`${file}: ${hits.join(', ')} - ${allow[1].trim()}`);
    else problems.push(`${file}: ${hits.join(', ')}. Add a new add-only migration, or explain with "-- allow-data-change: <reason>" and have it reviewed.`);
  }
  return { ok: problems.length === 0, problems, reviewed };
}

if (require.main === module) {
  const { ok, problems, reviewed } = checkMigrations();
  reviewed.forEach((r) => console.log(`REVIEWED  ${r}`));
  problems.forEach((p) => console.error(`BLOCKED   ${p}`));
  console.log(ok ? 'Migration check passed: database changes are add-only.' : 'Migration check FAILED.');
  process.exitCode = ok ? 0 : 1;
}

module.exports = { checkMigrations };
