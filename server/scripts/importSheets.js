/**
 * One-time move of the Google Sheets data into PostgreSQL.
 *
 * In the FA Management spreadsheet choose File > Download > Microsoft Excel
 * (.xlsx). If you have used Archive, download the 'FA Management Archive'
 * spreadsheet too: its records are loaded as normal FA records. Then, from /server:
 *
 *   npm run import-sheets -- --file="FA Management.xlsx" --dry-run
 *   npm run import-sheets -- --file="FA Management.xlsx" --archive="FA Management Archive.xlsx"
 *
 * Sheets read (by name, columns in the Code.gs order): Users, Raw Data,
 * Qty Plotting, LWM Tally, Ledger Master, Product Master, Activity Log,
 * Branch Master, Category Master, Description Master,
 * PO Master (now PO Client Master), Client Cost Center Master. Missing sheets are skipped.
 *
 * - FA Codes and statuses are kept; FA Codes already in the database are skipped.
 * - Plain-text passwords from the Users sheet are stored as bcrypt hashes;
 *   usernames already in the database are skipped.
 * - Masters, LWM and Activity Log rows are added; run the import once.
 * - The FA Code counters continue after the highest imported code of each month.
 * Everything runs in one transaction: an error saves nothing. --dry-run checks
 * the files and reports what would be imported, then rolls back.
 */
require('dotenv').config();
const path = require('path');
const ExcelJS = require('exceljs');
const bcrypt = require('bcryptjs');
const { pool, withTransaction } = require('../config/db');
const { normalizeKey, text, toNumber, round2, parseDate, isInactive } = require('../utils/values');
const { MASTERS } = require('../services/masterService');

const arg = (name) => {
  const match = process.argv.find((a) => a.startsWith(`--${name}=`));
  return match ? match.split('=').slice(1).join('=') : null;
};
const DRY_RUN = process.argv.includes('--dry-run');
const pad = (n) => String(n).padStart(2, '0');

// Cell value -> plain JS value (Date | number | string)
function cellValue(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return cellValue(v.result);
    if ('text' in v) return cellValue(v.text);
    return '';
  }
  return String(v);
}

// Data rows (below the header) of each sheet, blank rows dropped
async function readWorkbook(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.resolve(file));
  const out = {};
  wb.worksheets.forEach((ws) => {
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row, n) => {
      if (n === 1) return;
      const cells = [];
      for (let c = 1; c <= Math.max(ws.columnCount, row.cellCount); c++) cells.push(cellValue(row.getCell(c).value));
      if (cells.some((v) => text(v) !== '')) rows.push({ n, cells });
    });
    out[ws.name.trim()] = rows;
  });
  return out;
}

// Google Sheets dates arrive as UTC dates holding the sheet's wall-clock time
const dateOf = (v) => (v instanceof Date ? `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}` : parseDate(v));
function timestampOf(v) {
  if (v instanceof Date) {
    return `${dateOf(v)} ${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}:${pad(v.getUTCSeconds())}`;
  }
  const m = text(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])} ${pad(m[4] || 0)}:${m[5] || '00'}:${m[6] || '00'}`;
  return null;
}
// Master cells are text; dates shown as DD/MM/YYYY
const masterText = (v) => (v instanceof Date ? `${pad(v.getUTCDate())}/${pad(v.getUTCMonth() + 1)}/${v.getUTCFullYear()}` : text(v));
const taggableOf = (v) => {
  const t = normalizeKey(v);
  if (t === 'taggable') return 'Taggable';
  if (t === 'non taggable' || t === 'nontaggable' || t === 'non-taggable') return 'Non Taggable';
  return '';
};

async function importUsers(db, rows, report) {
  for (const { n, cells } of rows) {
    const [username, password, name, role, active, email, department] = cells.map(text);
    if (!username || !password) { report.problems.push(`Users row ${n}: username and password are required.`); continue; }
    const r = await db.query(
      `INSERT INTO users (username, password_hash, name, role, active, email, department)
       SELECT $1::varchar, $2, $3, $4, $5, $6, $7 WHERE NOT EXISTS (SELECT 1 FROM users WHERE LOWER(username) = LOWER($1::varchar))`,
      [username, await bcrypt.hash(password, 10), name || username, normalizeKey(role) === 'admin' ? 'Admin' : 'User',
        isInactive(active) ? 'No' : 'Yes', email || null, department || null]
    );
    report.users += r.rowCount;
  }
}

async function importLedgers(db, rows, report) {
  for (const { n, cells } of rows) {
    const head = text(cells[0]);
    const mapping = taggableOf(cells[1]);
    if (!head || !mapping) { report.problems.push(`Ledger Master row ${n}: needs Expense Head and Taggable / Non Taggable.`); continue; }
    const r = await db.query(
      `INSERT INTO ledgers (expense_head, mapping, active) SELECT $1::varchar, $2, $3
       WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE LOWER(TRIM(expense_head)) = LOWER($1::varchar))`,
      [head, mapping, normalizeKey(cells[2]) === 'no' ? 'No' : 'Yes']
    );
    report.ledgers += r.rowCount;
  }
}

async function importProducts(db, rows, report) {
  for (const { cells } of rows) {
    const name = text(cells[0]);
    if (!name) continue;
    const r = await db.query(
      `INSERT INTO products (product_name) SELECT $1::varchar WHERE NOT EXISTS (SELECT 1 FROM products WHERE LOWER(product_name) = LOWER($1::varchar))`,
      [name]
    );
    report.products += r.rowCount;
  }
}

async function importMasters(db, sheets, report) {
  for (const [type, cfg] of Object.entries(MASTERS)) {
    const rows = sheets[cfg.sheet];
    if (!rows) continue;
    // the sheets have no columns that were added later (e.g. PO Cost Center)
    const cols = cfg.fields.filter(([h]) => !(cfg.optional || []).includes(h)).map(([, c]) => c);
    let count = 0;
    for (const { cells } of rows) {
      const values = cols.map((_, i) => masterText(cells[i]));
      if (!values[0]) continue;
      if (type === 'description') values[2] = values[1]; // AssetDescriptionOne = Expense Head
      await db.query(`INSERT INTO ${cfg.table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, values);
      count += 1;
    }
    report.masters[cfg.title] = count;
  }
}

/**
 * Raw Data + Qty Plotting into the live tables (or the archive tables).
 * plottedBy: FA Code -> name, from the Activity Log 'Qty Plotting' entries.
 */
async function importFA(db, rawRows, qtyRows, report, { archive = false, plottedBy = {} } = {}) {
  const faTable = archive ? 'fa_records_archive' : 'fa_records';
  const lineTable = archive ? 'qty_lines_archive' : 'qty_lines';
  const label = archive ? 'Archive Raw Data' : 'Raw Data';
  const idOf = {};

  for (const { n, cells } of rawRows) {
    const faCode = text(cells[0]).toUpperCase();
    const date = dateOf(cells[2]);
    const amount = toNumber(cells[5]);
    if (!/^[A-Z]{3}\d{4}\d{4,}$/.test(faCode)) { report.problems.push(`${label} row ${n}: FA Code '${text(cells[0])}' is not like SEP20260001.`); continue; }
    if (!date) { report.problems.push(`${label} row ${n} (${faCode}): Date is missing or invalid.`); continue; }
    if (amount === 0) { report.problems.push(`${label} row ${n} (${faCode}): Amount is zero.`); continue; }
    const exists = await db.query('SELECT 1 FROM fa_records WHERE fa_code = $1 UNION ALL SELECT 1 FROM fa_records_archive WHERE fa_code = $1', [faCode]);
    if (exists.rows.length) { report.skipped += 1; continue; }
    const createdAt = timestampOf(cells[10]);
    const updatedAt = timestampOf(cells[11]) || createdAt;
    const status = normalizeKey(cells[9]) === 'completed' ? 'Completed' : 'Pending';
    const values = [faCode, text(cells[1]), date, text(cells[3]), text(cells[4]), round2(amount), text(cells[6]), text(cells[7]),
      text(cells[8]), status, createdAt, updatedAt, plottedBy[faCode] || null];
    const sql = archive
      ? `INSERT INTO fa_records_archive (fa_id, fa_code, inv_no, inv_date, po_no, cost_center, amount, vendor, expense_head, narration,
           status, created_at, updated_at, plotted_by, archived_by)
         VALUES (nextval('fa_records_fa_id_seq'), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11::timestamp, NOW()), COALESCE($12::timestamp, NOW()), $13, 'import')
         RETURNING fa_id`
      : `INSERT INTO fa_records (fa_code, inv_no, inv_date, po_no, cost_center, amount, vendor, expense_head, narration,
           status, created_at, updated_at, plotted_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11::timestamp, NOW()), COALESCE($12::timestamp, NOW()), $13)
         RETURNING fa_id, book_month`;
    const r = await db.query(sql, values);
    idOf[faCode] = r.rows[0].fa_id;
    if (r.rows[0].book_month) report.months.add(r.rows[0].book_month);
    report[archive ? 'archivedRecords' : 'records'] += 1;
  }

  const lineNo = {};
  for (const { n, cells } of qtyRows) {
    const faCode = text(cells[0]).toUpperCase();
    const faId = idOf[faCode];
    if (!faId) {
      if (!report.skippedCodes.has(faCode)) report.problems.push(`${archive ? 'Archive ' : ''}Qty Plotting row ${n}: FA Code '${faCode}' was not imported from Raw Data; line skipped.`);
      continue;
    }
    lineNo[faId] = (lineNo[faId] || 0) + 1;
    const createdAt = timestampOf(cells[11]);
    await db.query(
      `INSERT INTO ${lineTable} (${archive ? 'line_id, ' : ''}fa_id, line_no, product, quantity, taggable, unit_price, product_amount,
         against_invoice_no, against_asset_code, created_at, updated_at, gst_pct)
       VALUES (${archive ? "nextval('qty_lines_line_id_seq'), " : ''}$1, $2, $3, $4, $5, $6, $7, $8, $9,
         COALESCE($10::timestamp, NOW()), COALESCE($11::timestamp, NOW()), $12)`,
      [faId, lineNo[faId], text(cells[4]), toNumber(cells[5]), taggableOf(cells[6]), toNumber(cells[7]), round2(toNumber(cells[8])),
        text(cells[9]), text(cells[10]), createdAt, timestampOf(cells[12]) || createdAt, toNumber(cells[13])]
    );
    if (lineNo[faId] === 1 && createdAt) await db.query(`UPDATE ${faTable} SET plotted_at = $2::timestamp WHERE fa_id = $1`, [faId, createdAt]);
    report[archive ? 'archivedLines' : 'lines'] += 1;
  }
}

async function run() {
  const file = arg('file');
  if (!file) {
    console.log('Usage: npm run import-sheets -- --file="FA Management.xlsx" [--archive="FA Management Archive.xlsx"] [--dry-run]');
    process.exitCode = 1;
    return;
  }
  const sheets = await readWorkbook(file);
  const archive = arg('archive') ? await readWorkbook(arg('archive')) : null;
  const report = {
    users: 0, ledgers: 0, products: 0, masters: {}, records: 0, lines: 0, archivedRecords: 0, archivedLines: 0,
    lwm: 0, activity: 0, skipped: 0, skippedCodes: new Set(), problems: [], months: new Set(),
  };

  // FA Codes already present: their lines are skipped quietly
  const existing = await pool.query('SELECT fa_code FROM fa_records UNION SELECT fa_code FROM fa_records_archive');
  existing.rows.forEach((r) => report.skippedCodes.add(r.fa_code));

  // 'Qty Plotted By' came from the Activity Log
  const plottedBy = {};
  (sheets['Activity Log'] || []).forEach(({ cells }) => {
    const code = text(cells[5]).toUpperCase();
    if (normalizeKey(cells[3]) === 'qty plotting' && code && !plottedBy[code]) plottedBy[code] = text(cells[2]) || text(cells[1]);
  });

  try {
    await withTransaction(async (db) => {
      if (sheets.Users) await importUsers(db, sheets.Users, report);
      if (sheets['Ledger Master']) await importLedgers(db, sheets['Ledger Master'], report);
      if (sheets['Product Master']) await importProducts(db, sheets['Product Master'], report);
      await importMasters(db, sheets, report);
      await importFA(db, sheets['Raw Data'] || [], sheets['Qty Plotting'] || [], report, { plottedBy });
      // Archiving was removed, so archived records become normal FA records again
      if (archive) await importFA(db, archive['Raw Data'] || [], archive['Qty Plotting'] || [], report, { plottedBy });

      for (const { cells } of sheets['LWM Tally'] || []) {
        if (!text(cells[0])) continue;
        await db.query('INSERT INTO lwm_tally (expense_head, amount, uploaded_at) VALUES ($1, $2, COALESCE($3::timestamp, NOW()))',
          [text(cells[0]), round2(toNumber(cells[1])), timestampOf(cells[2])]);
        report.lwm += 1;
      }
      // months before the current one are closed, as when month-wise close was introduced
      const closed = await db.query(
        `UPDATE month_periods SET status = 'Finalized', version = 1, finalized_by = 'System', finalized_at = NOW(),
           lwm_remark = 'Imported from Google Sheets.', updated_at = NOW()
         WHERE status = 'Open' AND version = 0 AND book_month < to_char(CURRENT_DATE, 'YYYY-MM') AND book_month = ANY($1)`,
        [[...report.months]]
      );
      report.finalizedMonths = closed.rowCount;
      for (const { cells } of sheets['Activity Log'] || []) {
        await db.query(
          `INSERT INTO activity_log (logged_at, username, name, action, module, fa_code, inv_no, expense_head, details)
           VALUES (COALESCE($1::timestamp, NOW()), $2, $3, $4, $5, $6, $7, $8, $9)`,
          [timestampOf(cells[0]), ...cells.slice(1, 9).map(text), ...Array(Math.max(0, 9 - cells.length)).fill('')].slice(0, 9)
        );
        report.activity += 1;
      }

      // counters continue after the highest code of each month
      await db.query(
        `INSERT INTO fa_code_counters (period, last_number)
         SELECT UPPER(SUBSTRING(fa_code FROM 1 FOR 7)), MAX(SUBSTRING(fa_code FROM 8)::INTEGER)
         FROM (SELECT fa_code FROM fa_records UNION ALL SELECT fa_code FROM fa_records_archive) c
         WHERE UPPER(fa_code) ~ '^[A-Z]{3}[0-9]{4}[0-9]+$' GROUP BY 1
         ON CONFLICT (period) DO UPDATE SET last_number = GREATEST(fa_code_counters.last_number, EXCLUDED.last_number)`
      );
      if (DRY_RUN) throw Object.assign(new Error('dry run'), { dryRun: true });
    });
  } catch (err) {
    if (!err.dryRun) throw err;
  }

  const { problems, skippedCodes, months, ...counts } = report;
  console.log(JSON.stringify(counts, null, 2));
  if (problems.length) {
    console.log(`\n${problems.length} row(s) not imported:`);
    problems.slice(0, 300).forEach((p) => console.log(`  - ${p}`));
  }
  console.log(DRY_RUN ? '\nDry run: nothing was saved.' : '\nImport saved.');
}

run()
  .catch((err) => {
    console.error('Import failed, nothing was saved:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
