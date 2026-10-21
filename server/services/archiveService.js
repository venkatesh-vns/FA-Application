// Year-End Archive (Admin). A closed period (Tally booking months, before the
// current financial year) is:
//   1. backed up  - full pg_dump of the live database
//   2. copied     - its transaction rows into the archive database (JSON rows)
//   3. checked    - counts and total amount in the archive equal the live data
//   4. deleted    - from the live database, in one transaction
// Masters, users, the Activity Log and FA Code counters are never touched.
// An archived period can be viewed and exported from the archive database and
// restored into the live database (same FA Codes, lines and history).
const { pool, dbConfig, createPool, connectionSummary } = require('../config/db');
const { httpError } = require('../utils/httpError');
const { logActivity } = require('../utils/activity');
const { text, round2, formatDate, formatDateTime, normalizeKey } = require('../utils/values');
const { CLOSED, monthLabel, currentMonth } = require('../utils/months');
const { backupDatabase } = require('../utils/backup');

const fail = (message, status = 400) => httpError(status, message);
const ARCHIVE_DB = process.env.ARCHIVE_DB_NAME || `${connectionSummary().database}_archive`;
const LOCK_KEY = 73201; // pg advisory lock: one archive / restore at a time
const CHUNK = 2000;

// Transaction tables, in restore order (parents first). key = keyset column;
// where = rows of the period ($1 from month, $2 to month).
const PERIOD_RECORDS = 'SELECT fa_id FROM fa_records WHERE book_month BETWEEN $1 AND $2';
const TABLES = [
  { tbl: 'month_periods', key: 'book_month', where: 'book_month BETWEEN $1 AND $2' },
  { tbl: 'fa_records', key: 'fa_id', where: 'book_month BETWEEN $1 AND $2' },
  { tbl: 'qty_lines', key: 'line_id', where: `fa_id IN (${PERIOD_RECORDS})` },
  { tbl: 'lwm_tally', key: 'lwm_id', where: 'book_month BETWEEN $1 AND $2' },
  { tbl: 'month_events', key: 'event_id', where: 'book_month BETWEEN $1 AND $2' },
  { tbl: 'month_snapshots', key: 'snapshot_id', where: 'book_month BETWEEN $1 AND $2', chunk: 20 },
  {
    tbl: 'change_history', key: 'change_id',
    where: `(book_month BETWEEN $1 AND $2 OR fa_code IN (SELECT fa_code FROM fa_records WHERE book_month BETWEEN $1 AND $2))`,
  },
];

const isMonth = (v) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(v || ''));
const fyStartOf = (month) => {
  const [y, m] = month.split('-').map(Number);
  return `${m >= 4 ? y : y - 1}-04`;
};
const fyName = (start) => {
  const y = Number(start.slice(0, 4));
  return `FY ${y}-${String((y + 1) % 100).padStart(2, '0')}`;
};
function periodLabel(from, to) {
  const y = Number(from.slice(0, 4));
  if (from.endsWith('-04') && to === `${y + 1}-03`) return fyName(from);
  return from === to ? monthLabel(from) : `${monthLabel(from)} to ${monthLabel(to)}`;
}
const confirmOf = (verb, label) => `${verb} ${label}`.toUpperCase();

// ---------- archive database

let archivePool = null;
async function archiveDb() {
  if (archivePool) return archivePool;
  const exists = await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [ARCHIVE_DB]);
  if (!exists.rows.length) {
    try {
      await pool.query(`CREATE DATABASE "${ARCHIVE_DB.replace(/"/g, '')}"`);
    } catch (err) {
      throw fail(`The archive database "${ARCHIVE_DB}" does not exist and could not be created (${err.message}). Ask IT to create it for the app login.`, 500);
    }
  }
  // same server and login as the live database unless ARCHIVE_DB_* / ARCHIVE_DB_URL say otherwise
  let config = dbConfig('ARCHIVE_DB_', { database: ARCHIVE_DB });
  if (!process.env.ARCHIVE_DB_URL && process.env.DATABASE_URL) {
    const u = new URL(process.env.DATABASE_URL);
    u.pathname = `/${ARCHIVE_DB}`;
    config = { ...dbConfig('ARCHIVE_DB_'), connectionString: u.toString() };
  }
  archivePool = createPool(config);
  await archivePool.query(`
    CREATE TABLE IF NOT EXISTS archive_info (
      run_id INTEGER PRIMARY KEY, label VARCHAR(60) NOT NULL, from_month VARCHAR(7) NOT NULL, to_month VARCHAR(7) NOT NULL,
      source_db VARCHAR(100) NOT NULL, created_by VARCHAR(150) NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS archive_rows (
      row_id BIGSERIAL PRIMARY KEY, run_id INTEGER NOT NULL, tbl VARCHAR(40) NOT NULL, data JSONB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS archive_rows_run_idx ON archive_rows (run_id, tbl, row_id);
    CREATE INDEX IF NOT EXISTS archive_rows_fa_idx ON archive_rows (run_id, tbl, ((data->>'fa_id')::int));
  `);
  return archivePool;
}

// ---------- preview

/**
 * What archiving fromMonth..toMonth would move, and why it cannot be done:
 * months must be Finalized / FAMS Uploaded, before the current financial
 * year, not archived already.
 */
async function previewArchive({ fromMonth, toMonth } = {}) {
  if (!isMonth(fromMonth) || !isMonth(toMonth)) throw fail('Choose the From and To months.');
  if (fromMonth > toMonth) throw fail('From month is after To month.');
  const problems = [];
  const fyStart = fyStartOf(currentMonth());
  if (toMonth >= fyStart) problems.push(`Only months before the current financial year can be archived (${fyName(fyStart)} starts ${monthLabel(fyStart)}).`);

  const range = [fromMonth, toMonth];
  const [months, overlap, locks, counts] = await Promise.all([
    pool.query(
      `SELECT m.month, COALESCE(mp.status, 'Open') AS status,
         COALESCE(r.records, 0)::int AS records, COALESCE(r.amount, 0) AS amount, COALESCE(r.lines, 0)::int AS lines
       FROM (SELECT book_month AS month FROM month_periods WHERE book_month BETWEEN $1 AND $2
             UNION SELECT DISTINCT book_month FROM fa_records WHERE book_month BETWEEN $1 AND $2
             UNION SELECT DISTINCT book_month FROM lwm_tally WHERE book_month BETWEEN $1 AND $2) m
       LEFT JOIN month_periods mp ON mp.book_month = m.month
       LEFT JOIN (SELECT f.book_month, COUNT(*) AS records, SUM(f.amount) AS amount,
                    SUM((SELECT COUNT(*) FROM qty_lines q WHERE q.fa_id = f.fa_id)) AS lines
                  FROM fa_records f WHERE f.book_month BETWEEN $1 AND $2 GROUP BY 1) r ON r.book_month = m.month
       ORDER BY 1`, range
    ),
    pool.query("SELECT label FROM archive_runs WHERE status IN ('archived', 'running') AND from_month <= $2 AND to_month >= $1", range),
    pool.query(`SELECT COUNT(*)::int AS n FROM qty_locks WHERE fa_id IN (${PERIOD_RECORDS})`, range),
    Promise.all(TABLES.map((t) => pool.query(`SELECT COUNT(*)::int AS n FROM ${t.tbl} WHERE ${t.where}`, range))),
  ]);

  if (overlap.rows.length) problems.push(`Part of this period is already archived (${overlap.rows.map((r) => r.label).join(', ')}).`);
  const open = months.rows.filter((m) => !CLOSED.includes(m.status));
  if (open.length) {
    problems.push(`These months are not finalized yet: ${open.map((m) => `${monthLabel(m.month)} (${m.status})`).join(', ')}. Finalize them in Month-wise Data first.`);
  }
  if (locks.rows[0].n) problems.push('Someone is plotting an invoice of this period. Try again later.');
  const tableCounts = Object.fromEntries(TABLES.map((t, i) => [t.tbl, counts[i].rows[0].n]));
  if (!tableCounts.fa_records && !tableCounts.lwm_tally && !tableCounts.month_periods) problems.push('There is no data in this period.');

  const label = periodLabel(fromMonth, toMonth);
  const summary = months.rows.map((m) => ({
    month: m.month, label: monthLabel(m.month), status: m.status, records: m.records, lines: m.lines, amount: round2(Number(m.amount)),
  }));
  return {
    ok: problems.length === 0,
    problems,
    label,
    fromMonth,
    toMonth,
    confirmText: confirmOf('ARCHIVE', label),
    records: tableCounts.fa_records,
    lines: tableCounts.qty_lines,
    amount: round2(summary.reduce((s, m) => s + m.amount, 0)),
    tableCounts,
    months: summary,
  };
}

// ---------- archive

async function withLock(fn) {
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_KEY]);
    if (!rows[0].ok) throw fail('Another archive or restore is running. Try again in a few minutes.', 409);
    try {
      return await fn();
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

/**
 * archivePeriod (Admin): backup, copy, check, delete. confirm must be the
 * preview's confirmText. Returns the run.
 */
async function archivePeriod(user, { fromMonth, toMonth, confirm } = {}) {
  return withLock(async () => {
    const pre = await previewArchive({ fromMonth, toMonth });
    if (!pre.ok) throw fail(pre.problems.join(' '), 409);
    if (text(confirm).toUpperCase() !== pre.confirmText) throw fail(`Type ${pre.confirmText} to confirm.`);
    const who = user.name || user.username;
    const run = (await pool.query(
      'INSERT INTO archive_runs (from_month, to_month, label, created_by) VALUES ($1, $2, $3, $4) RETURNING run_id',
      [fromMonth, toMonth, pre.label, who]
    )).rows[0].run_id;
    const failRun = async (message) => {
      await pool.query("UPDATE archive_runs SET status = 'failed', error = $2, finished_at = NOW() WHERE run_id = $1", [run, String(message).slice(0, 1000)]);
    };

    // 1. backup
    let backup;
    try {
      backup = await backupDatabase(`before_archive_${pre.label}`);
      await pool.query('UPDATE archive_runs SET backup_file = $2, backup_bytes = $3 WHERE run_id = $1', [run, backup.file, backup.bytes]);
    } catch (err) {
      await failRun(err.message);
      throw err;
    }

    const adb = await archiveDb();
    const live = await pool.connect();
    const arch = await adb.connect();
    let archiveCommitted = false;
    try {
      await live.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      const range = [fromMonth, toMonth];
      // the months stay closed while we work (an Admin cannot re-open them meanwhile)
      const locked = await live.query('SELECT book_month, status FROM month_periods WHERE book_month BETWEEN $1 AND $2 FOR UPDATE', range);
      if (locked.rows.some((m) => !CLOSED.includes(m.status))) throw fail('A month of this period was re-opened meanwhile. Nothing was archived.', 409);

      // 2. copy, table by table, CHUNK rows at a time (rows as JSON made by PostgreSQL, exact)
      await arch.query('BEGIN');
      await arch.query(
        'INSERT INTO archive_info (run_id, label, from_month, to_month, source_db, created_by) VALUES ($1, $2, $3, $4, $5, $6)',
        [run, pre.label, fromMonth, toMonth, process.env.DB_NAME, who]
      );
      const copied = {};
      for (const t of TABLES) {
        copied[t.tbl] = 0;
        let last = null;
        for (;;) {
          const params = last === null ? range : [...range, last];
          const after = last === null ? '' : `AND ${t.key} > $3`;
          const { rows } = await live.query(
            `SELECT ${t.key} AS k, to_jsonb(x)::text AS j FROM ${t.tbl} x WHERE ${t.where} ${after} ORDER BY ${t.key} LIMIT ${t.chunk || CHUNK}`,
            params
          );
          if (!rows.length) break;
          last = rows[rows.length - 1].k;
          await arch.query(
            'INSERT INTO archive_rows (run_id, tbl, data) SELECT $1, $2, x FROM jsonb_array_elements($3::jsonb) x',
            [run, t.tbl, `[${rows.map((r) => r.j).join(',')}]`]
          );
          copied[t.tbl] += rows.length;
        }
      }

      // 3. check: every table's count, and the FA amount, are the same in the archive
      const check = await arch.query(
        `SELECT tbl, COUNT(*)::int AS n, SUM(CASE WHEN tbl = 'fa_records' THEN (data->>'amount')::numeric ELSE 0 END) AS amount
         FROM archive_rows WHERE run_id = $1 GROUP BY tbl`, [run]
      );
      const inArchive = Object.fromEntries(check.rows.map((r) => [r.tbl, r]));
      for (const t of TABLES) {
        if ((inArchive[t.tbl]?.n || 0) !== copied[t.tbl] || copied[t.tbl] !== pre.tableCounts[t.tbl]) {
          throw fail(`Check failed for ${t.tbl} (live ${pre.tableCounts[t.tbl]}, copied ${copied[t.tbl]}). Nothing was deleted.`, 500);
        }
      }
      const archivedAmount = round2(Number(inArchive.fa_records?.amount || 0));
      if (Math.abs(archivedAmount - pre.amount) > 0.01) throw fail(`Amount check failed (live ${pre.amount}, archive ${archivedAmount}). Nothing was deleted.`, 500);
      await arch.query('COMMIT');
      archiveCommitted = true;

      // 4. delete from live (children first), counts must match what was copied
      const del = async (sql) => (await live.query(sql, range)).rowCount;
      const deleted = {
        change_history: await del(`DELETE FROM change_history WHERE ${TABLES[6].where}`),
        month_snapshots: await del('DELETE FROM month_snapshots WHERE book_month BETWEEN $1 AND $2'),
        month_events: await del('DELETE FROM month_events WHERE book_month BETWEEN $1 AND $2'),
        lwm_tally: await del('DELETE FROM lwm_tally WHERE book_month BETWEEN $1 AND $2'),
        qty_lines: await del(`DELETE FROM qty_lines WHERE fa_id IN (${PERIOD_RECORDS})`),
        fa_records: await del('DELETE FROM fa_records WHERE book_month BETWEEN $1 AND $2'),
        month_periods: await del('DELETE FROM month_periods WHERE book_month BETWEEN $1 AND $2'),
      };
      for (const t of TABLES) {
        if (deleted[t.tbl] !== copied[t.tbl]) throw fail(`Delete check failed for ${t.tbl}. Nothing was deleted.`, 500);
      }
      await live.query(
        `UPDATE archive_runs SET status = 'archived', record_count = $2, line_count = $3, total_amount = $4, table_counts = $5,
           summary = $6, finished_at = NOW() WHERE run_id = $1`,
        [run, copied.fa_records, copied.qty_lines, archivedAmount, JSON.stringify(copied), JSON.stringify(pre.months)]
      );
      await logActivity(user, 'Year-End Archive', 'Year-End Archive', '', '', '',
        `${pre.label}: ${copied.fa_records} record(s), ${copied.qty_lines} line(s), amount ${archivedAmount.toFixed(2)} moved to ${ARCHIVE_DB}. Backup: ${backup.file}`, live);
      await live.query('COMMIT');
    } catch (err) {
      await live.query('ROLLBACK').catch(() => {});
      await arch.query('ROLLBACK').catch(() => {});
      if (archiveCommitted) await adb.query('DELETE FROM archive_rows WHERE run_id = $1', [run]).catch(() => {});
      if (archiveCommitted) await adb.query('DELETE FROM archive_info WHERE run_id = $1', [run]).catch(() => {});
      await failRun(err.message);
      throw err;
    } finally {
      live.release();
      arch.release();
    }
    return {
      success: true,
      runId: run,
      message: `${pre.label} archived: ${pre.records.toLocaleString('en-IN')} record(s) and ${pre.lines.toLocaleString('en-IN')} line(s) moved to the archive database. Masters are unchanged. Backup: ${backup.file}`,
    };
  });
}

// ---------- list, view, export

const runOut = (r) => ({
  runId: r.run_id, label: r.label, fromMonth: r.from_month, toMonth: r.to_month, status: r.status,
  records: r.record_count, lines: r.line_count, amount: Number(r.total_amount), tableCounts: r.table_counts, months: r.summary,
  backupFile: r.backup_file, backupBytes: Number(r.backup_bytes), error: r.error,
  createdBy: r.created_by, createdAt: formatDateTime(r.created_at), finishedAt: r.finished_at ? formatDateTime(r.finished_at) : '',
  restoredBy: r.restored_by || '', restoredAt: r.restored_at ? formatDateTime(r.restored_at) : '', restoreBackupFile: r.restore_backup_file,
  confirmRestore: confirmOf('RESTORE', r.label),
});

// Archive runs, and the months that could be archived (closed, before this FY)
async function listArchive() {
  const fyStart = fyStartOf(currentMonth());
  const [runs, months] = await Promise.all([
    pool.query('SELECT * FROM archive_runs ORDER BY run_id DESC'),
    pool.query(
      `SELECT m.book_month, m.status, (SELECT COUNT(*) FROM fa_records f WHERE f.book_month = m.book_month)::int AS records
       FROM month_periods m ORDER BY 1`
    ),
  ]);
  return {
    archiveDatabase: ARCHIVE_DB,
    currentFyStart: fyStart,
    currentFy: fyName(fyStart),
    runs: runs.rows.map(runOut),
    months: months.rows.map((m) => ({ month: m.book_month, label: monthLabel(m.book_month), status: m.status, records: m.records, archivable: m.book_month < fyStart })),
  };
}

async function archivedRun(runId) {
  const { rows } = await pool.query('SELECT * FROM archive_runs WHERE run_id = $1', [Number(runId)]);
  if (!rows[0]) throw fail('Archive not found.', 404);
  if (rows[0].status !== 'archived') throw fail(`This archive is ${rows[0].status}; it has no data to show.`, 409);
  return rows[0];
}

const recordOut = (d) => ({
  faCode: d.fa_code, invNo: d.inv_no, date: formatDate(d.inv_date), bookMonth: d.book_month, month: monthLabel(d.book_month),
  poNo: d.po_no, costCenter: d.cost_center, vendor: d.vendor, expenseHead: d.expense_head, amount: Number(d.amount),
  narration: d.narration, status: d.status, qtyPlottedBy: d.plotted_by || '',
});

// One page of an archived period's records (search in any field)
async function archivedRecords(runId, { page, size, search } = {}) {
  await archivedRun(runId);
  const adb = await archiveDb();
  const n = Math.min(Math.max(Number(size) || 10, 1), 500);
  const p = Math.max(Number(page) || 1, 1);
  const term = text(search).toLowerCase();
  const params = [Number(runId)];
  let cond = '';
  if (term) { params.push(`%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`); cond = `AND LOWER(data::text) LIKE $2`; }
  const [count, rows] = await Promise.all([
    adb.query(`SELECT COUNT(*)::int AS n FROM archive_rows WHERE run_id = $1 AND tbl = 'fa_records' ${cond}`, params),
    adb.query(`SELECT data FROM archive_rows WHERE run_id = $1 AND tbl = 'fa_records' ${cond} ORDER BY (data->>'fa_id')::int LIMIT ${n} OFFSET ${(p - 1) * n}`, params),
  ]);
  return { total: count.rows[0].n, page: p, size: n, rows: rows.rows.map((r) => recordOut(r.data)) };
}

// One archived record with its product lines and change history
async function archivedRecord(runId, faCode) {
  await archivedRun(runId);
  const adb = await archiveDb();
  const rec = (await adb.query("SELECT data FROM archive_rows WHERE run_id = $1 AND tbl = 'fa_records' AND data->>'fa_code' = $2", [Number(runId), text(faCode)])).rows[0];
  if (!rec) throw fail('Record not found in this archive.', 404);
  const [lines, hist] = await Promise.all([
    adb.query("SELECT data FROM archive_rows WHERE run_id = $1 AND tbl = 'qty_lines' AND (data->>'fa_id')::int = $2 ORDER BY (data->>'line_no')::int", [Number(runId), rec.data.fa_id]),
    adb.query("SELECT data FROM archive_rows WHERE run_id = $1 AND tbl = 'change_history' AND data->>'fa_code' = $2 ORDER BY (data->>'change_id')::int DESC", [Number(runId), text(faCode)]),
  ]);
  return {
    raw: recordOut(rec.data),
    products: lines.rows.map(({ data: l }) => ({
      product: l.product, quantity: Number(l.quantity), taggable: l.taggable, unitPrice: Number(l.unit_price), productAmount: Number(l.product_amount),
      gstPercent: Number(l.gst_pct), againstInvoiceNo: l.against_invoice_no, againstAssetCode: l.against_asset_code,
    })),
    history: hist.rows.map(({ data: h }) => ({ field: h.field, oldValue: h.old_value, newValue: h.new_value, by: h.name || h.username, source: h.source, at: formatDateTime(h.created_at) })),
  };
}

/**
 * FA Data export (same columns as FA Data > Export) of an archived period, as
 * a stream: { count, rows }.
 */
async function archivedExport(runId) {
  const run = await archivedRun(runId);
  const adb = await archiveDb();
  const { exportRowsOf, EXPORT_HEADERS } = require('./faService');
  const po = await pool.query('SELECT po_no, client_as_per_po FROM po_master ORDER BY id');
  const poMap = {};
  po.rows.forEach((r) => { if (text(r.po_no)) poMap[normalizeKey(r.po_no)] = text(r.client_as_per_po); });
  const id = Number(runId);
  async function* rows() {
    yield EXPORT_HEADERS;
    let last = 0;
    for (;;) {
      const recs = (await adb.query(
        `SELECT data FROM archive_rows WHERE run_id = $1 AND tbl = 'fa_records' AND (data->>'fa_id')::int > $2 ORDER BY (data->>'fa_id')::int LIMIT ${CHUNK}`, [id, last]
      )).rows.map((r) => r.data);
      if (!recs.length) return;
      last = recs[recs.length - 1].fa_id;
      const lines = (await adb.query(
        "SELECT data FROM archive_rows WHERE run_id = $1 AND tbl = 'qty_lines' AND (data->>'fa_id')::int = ANY($2) ORDER BY (data->>'fa_id')::int, (data->>'line_no')::int",
        [id, recs.map((r) => r.fa_id)]
      )).rows.map((r) => r.data);
      const byFa = {};
      lines.forEach((l) => { (byFa[l.fa_id] = byFa[l.fa_id] || []).push(l); });
      yield* exportRowsOf(recs, byFa, poMap);
      if (recs.length < CHUNK) return;
    }
  }
  // rows = one per product line, plus records without lines
  const counted = (await adb.query(
    `SELECT (SELECT COUNT(*) FROM archive_rows WHERE run_id = $1 AND tbl = 'qty_lines')
          + (SELECT COUNT(*) FROM archive_rows r WHERE r.run_id = $1 AND r.tbl = 'fa_records' AND NOT EXISTS (
               SELECT 1 FROM archive_rows l WHERE l.run_id = $1 AND l.tbl = 'qty_lines' AND (l.data->>'fa_id')::int = (r.data->>'fa_id')::int)) AS n`, [id]
  )).rows[0].n;
  const file = `Archive_FA_Data_${run.label.replace(/[^A-Za-z0-9-]+/g, '_')}.xlsx`;
  return { count: Number(counted), rows: rows(), fileName: file };
}

// ---------- restore

/**
 * restoreRun (Admin): puts an archived period back into the live database
 * (backup first). Refused when any of its records, lines or months exist in
 * the live database meanwhile. confirm must be 'RESTORE <label>'.
 */
async function restoreRun(user, runId, { confirm } = {}) {
  return withLock(async () => {
    const run = await archivedRun(runId);
    const expected = confirmOf('RESTORE', run.label);
    if (text(confirm).toUpperCase() !== expected) throw fail(`Type ${expected} to confirm.`);
    const adb = await archiveDb();
    const id = run.run_id;

    // clashes: the same months, FA Codes or ids in the live database
    const keys = (await adb.query(
      "SELECT array_agg((data->>'fa_id')::int) AS ids, array_agg(data->>'fa_code') AS codes FROM archive_rows WHERE run_id = $1 AND tbl = 'fa_records'", [id]
    )).rows[0];
    const [clashMonths, clashRecords] = await Promise.all([
      pool.query('SELECT book_month FROM month_periods WHERE book_month BETWEEN $1 AND $2 UNION SELECT DISTINCT book_month FROM fa_records WHERE book_month BETWEEN $1 AND $2', [run.from_month, run.to_month]),
      pool.query('SELECT fa_code FROM fa_records WHERE fa_id = ANY($1) OR fa_code = ANY($2) LIMIT 5', [keys.ids || [], keys.codes || []]),
    ]);
    if (clashMonths.rows.length) throw fail(`Cannot restore: the live database already has data for ${clashMonths.rows.map((r) => monthLabel(r.book_month)).join(', ')}.`, 409);
    if (clashRecords.rows.length) throw fail(`Cannot restore: FA Code(s) ${clashRecords.rows.map((r) => r.fa_code).join(', ')} already exist in the live database.`, 409);

    const backup = await backupDatabase(`before_restore_${run.label}`);
    const live = await pool.connect();
    try {
      await live.query('BEGIN');
      const restored = {};
      for (const t of TABLES) {
        const cols = (await live.query(
          'SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1', [t.tbl]
        )).rows.map((r) => r.column_name);
        restored[t.tbl] = 0;
        let last = 0;
        for (;;) {
          const { rows } = await adb.query(
            `SELECT row_id, data::text AS j FROM archive_rows WHERE run_id = $1 AND tbl = $2 AND row_id > $3 ORDER BY row_id LIMIT ${t.chunk || CHUNK}`,
            [id, t.tbl, last]
          );
          if (!rows.length) break;
          last = rows[rows.length - 1].row_id;
          // columns kept in the archive that exist in today's table (newer columns take their defaults)
          const keysOf = Object.keys(JSON.parse(rows[0].j));
          const use = cols.filter((c) => keysOf.includes(c)).map((c) => `"${c}"`).join(', ');
          const res = await live.query(
            `INSERT INTO ${t.tbl} (${use}) SELECT ${use} FROM jsonb_populate_recordset(NULL::${t.tbl}, $1::jsonb)`,
            [`[${rows.map((r) => r.j).join(',')}]`]
          );
          restored[t.tbl] += res.rowCount;
        }
        if (restored[t.tbl] !== (run.table_counts[t.tbl] || 0)) throw fail(`Restore check failed for ${t.tbl}. Nothing was restored.`, 500);
      }
      await live.query(
        "UPDATE archive_runs SET status = 'restored', restored_by = $2, restored_at = NOW(), restore_backup_file = $3 WHERE run_id = $1",
        [id, user.name || user.username, backup.file]
      );
      await logActivity(user, 'Archive Restored', 'Year-End Archive', '', '', '',
        `${run.label}: ${restored.fa_records} record(s), ${restored.qty_lines} line(s) restored to the live database. Backup: ${backup.file}`, live);
      await live.query('COMMIT');
    } catch (err) {
      await live.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      live.release();
    }
    // the period lives in the live database again; its archive copy is removed (backups remain)
    await adb.query('DELETE FROM archive_rows WHERE run_id = $1', [id]).catch(() => {});
    await adb.query('DELETE FROM archive_info WHERE run_id = $1', [id]).catch(() => {});
    return { success: true, message: `${run.label} restored: ${run.record_count.toLocaleString('en-IN')} record(s) are back in the live database as they were archived.` };
  });
}

async function closeArchive() {
  if (archivePool) { await archivePool.end(); archivePool = null; }
}

module.exports = {
  previewArchive, archivePeriod, listArchive, archivedRecords, archivedRecord, archivedExport, restoreRun, closeArchive, periodLabel, ARCHIVE_DB,
};
