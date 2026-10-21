// Month-wise close. Each Tally booking month moves
//   Open -> Under Review (user submits) -> Finalized (Admin) -> FAMS Uploaded (Admin)
// and an Admin can send a month back (Under Review -> Open) or re-open a
// finalized month with a reason. Finalizing keeps the month's FAMS rows as a
// numbered version with a fingerprint; re-finalizing also keeps the
// changes-only rows against the previous version.
const crypto = require('crypto');
const { pool, withTransaction } = require('../config/db');
const { httpError } = require('../utils/httpError');
const { logActivity } = require('../utils/activity');
const { text, round2, formatDate, formatDateTime, parseDate } = require('../utils/values');
const { CLOSED, monthLabel, parseMonth, currentMonth, lastClosedMonth } = require('../utils/months');
const { getLWMComparison, buildFAMSItems, FAMS_TEMPLATE_HEADERS } = require('./reportService');
const { runAll } = require('../utils/runAll');

const fail = (message, status = 400) => httpError(status, message);
const ERROR_COL = FAMS_TEMPLATE_HEADERS.indexOf('Error Remark');
const who = (user) => user.name || user.username;

function monthOf(value) {
  const m = parseMonth(value);
  if (!m || !/^\d{4}-\d{2}$/.test(String(value))) throw fail('Invalid month.');
  return m;
}

// Per-month record figures: { 'YYYY-MM': { records, amount, pending, completed, creditNotes } }
async function monthStats(db = pool, month = null) {
  const { rows } = await db.query(
    `SELECT book_month, COUNT(*)::int AS records, COALESCE(SUM(amount), 0) AS amount,
       SUM(CASE WHEN status = 'Completed' THEN 0 ELSE 1 END)::int AS pending,
       SUM(CASE WHEN amount < 0 THEN 1 ELSE 0 END)::int AS credit_notes
     FROM fa_records ${month ? 'WHERE book_month = $1' : ''} GROUP BY book_month`,
    month ? [month] : []
  );
  const out = {};
  rows.forEach((r) => {
    out[r.book_month] = { records: r.records, amount: round2(Number(r.amount)), pending: r.pending, completed: r.records - r.pending, creditNotes: r.credit_notes };
  });
  return out;
}

const periodOut = (p, stats = {}) => ({
  month: p.book_month,
  label: monthLabel(p.book_month),
  status: p.status,
  version: p.version,
  records: stats.records || 0,
  amount: stats.amount || 0,
  pending: stats.pending || 0,
  completed: stats.completed || 0,
  creditNotes: stats.creditNotes || 0,
  submittedBy: p.submitted_by || '',
  submittedAt: p.submitted_at ? formatDateTime(p.submitted_at) : '',
  finalizedBy: p.finalized_by || '',
  finalizedAt: p.finalized_at ? formatDateTime(p.finalized_at) : '',
  lwmRemark: p.lwm_remark || '',
  famsReference: p.fams_reference || '',
  famsUploadedOn: p.fams_uploaded_on ? formatDate(p.fams_uploaded_on) : '',
  famsUploadedBy: p.fams_uploaded_by || '',
  reopenedBy: p.reopened_by || '',
  reopenedAt: p.reopened_at ? formatDateTime(p.reopened_at) : '',
  reopenReason: p.reopen_reason || '',
});

/**
 * Months for entry screens: those the user may book into (Open; Under Review
 * for Admin), plus the current and next month when they are not closed yet,
 * and the default (the current month if open, else the newest open month).
 */
async function bookingMonths(user) {
  const { rows } = await pool.query('SELECT book_month, status FROM month_periods ORDER BY book_month DESC');
  const last = await lastClosedMonth(pool);
  const statusOf = Object.fromEntries(rows.map((r) => [r.book_month, r.status]));
  const now = currentMonth();
  const [y, m] = now.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  const candidates = new Set([...rows.map((r) => r.book_month), now, next]);
  const months = [...candidates].sort().reverse()
    .map((month) => ({ month, label: monthLabel(month), status: statusOf[month] || 'Open' }))
    .filter((x) => (x.status === 'Open' && !(last && !statusOf[x.month] && x.month < last)) || (x.status === 'Under Review' && user.isAdmin));
  const def = months.find((x) => x.month === now) || months.filter((x) => x.month <= now)[0] || months[months.length - 1] || null;
  return { months, defaultMonth: def ? def.month : null, lastClosed: last, lastClosedLabel: last ? monthLabel(last) : '' };
}

// listMonths: every month with its figures, newest first
async function listMonths() {
  const [periods, stats] = await Promise.all([pool.query('SELECT * FROM month_periods ORDER BY book_month DESC'), monthStats()]);
  return { months: periods.rows.map((p) => periodOut(p, stats[p.book_month])), currentMonth: currentMonth() };
}

/**
 * The checks a month must pass before it can be finalized:
 *   pending   - every record has its Qty Plotting
 *   credit    - every credit note has Against Invoice No or Asset Code
 *   tally     - LWM uploaded and matched (an Admin may accept a difference with a remark)
 *   fams      - no FAMS row with an Error Remark
 */
async function monthChecks(month, db = pool) {
  const [stats, credit, lwm, fams] = await runAll(db, [
    () => monthStats(db, month),
    () => db.query(
      `SELECT COUNT(*)::int AS n FROM qty_lines q JOIN fa_records f ON f.fa_id = q.fa_id
       WHERE f.book_month = $1 AND q.product_amount < 0 AND TRIM(q.against_invoice_no) = '' AND TRIM(q.against_asset_code) = ''`,
      [month]
    ),
    () => getLWMComparison(month, db),
    () => buildFAMSItems({ bookMonth: month }, db),
  ]);
  const s = stats[month] || { records: 0, pending: 0 };
  const errorRows = fams.items.filter((i) => text(i.values[ERROR_COL]));
  const diffs = lwm.rows.filter((r) => r.status !== 'Matched');
  const checks = [
    {
      id: 'records', label: 'Month has records', ok: s.records > 0,
      detail: s.records ? `${s.records} record(s)` : 'No records are booked in this month.',
    },
    {
      id: 'pending', label: 'Qty Plotting complete', ok: s.records > 0 && s.pending === 0,
      detail: s.pending ? `${s.pending} record(s) still pending Qty Plotting.` : 'All records are plotted.',
    },
    {
      id: 'credit', label: 'Credit notes linked', ok: credit.rows[0].n === 0,
      detail: credit.rows[0].n ? `${credit.rows[0].n} credit note line(s) without Against Invoice No / Asset Code.` : 'Every credit note has its original invoice or asset code.',
    },
    {
      id: 'tally', label: 'Tally (LWM) matched', ok: lwm.matched, overridable: true,
      detail: !lwm.hasTallyData ? 'Tally figures for this month are not uploaded (LWM Reconciliation).'
        : diffs.length ? `${diffs.length} expense head(s) differ; total difference ${lwm.totalDifference.toFixed(2)}.` : 'FA and Tally match for every expense head.',
    },
    {
      id: 'fams', label: 'FAMS template has no errors', ok: fams.items.length > 0 && errorRows.length === 0,
      detail: !fams.items.length ? 'No FAMS rows yet (Qty Plotting needed).'
        : errorRows.length ? `${errorRows.length} of ${fams.items.length} FAMS row(s) have an Error Remark (fix the masters).` : `${fams.items.length} FAMS row(s), no errors.`,
    },
  ];
  return { checks, lwm, famsItems: fams.items, famsErrors: errorRows.slice(0, 50).map((i) => ({ faCode: i.faCode, error: i.values[ERROR_COL] })) };
}

// getMonth: one month with its checks, versions, history and (Admin) change history
async function getMonth(user, value) {
  const month = monthOf(value);
  const { rows } = await pool.query('SELECT * FROM month_periods WHERE book_month = $1', [month]);
  const stats = await monthStats(pool, month);
  const p = rows[0] || { book_month: month, status: 'Open', version: 0 };
  const [checks, events, snaps, changes] = await Promise.all([
    monthChecks(month),
    pool.query('SELECT * FROM month_events WHERE book_month = $1 ORDER BY event_id DESC', [month]),
    pool.query(
      'SELECT version, kind, record_count, line_count, total_amount, fingerprint, change_count, created_by, created_at FROM month_snapshots WHERE book_month = $1 ORDER BY version DESC',
      [month]
    ),
    user.isAdmin
      ? pool.query('SELECT * FROM change_history WHERE book_month = $1 ORDER BY change_id DESC LIMIT 500', [month])
      : Promise.resolve({ rows: [] }),
  ]);
  return {
    ...periodOut(p, stats[month]),
    checks: checks.checks,
    lwm: { hasTallyData: checks.lwm.hasTallyData, totalFA: checks.lwm.totalFA, totalTally: checks.lwm.totalTally, totalDifference: checks.lwm.totalDifference, rows: checks.lwm.rows.filter((r) => r.status !== 'Matched') },
    famsErrors: checks.famsErrors,
    events: events.rows.map((e) => ({
      action: e.action, from: e.status_from, to: e.status_to, by: e.name || e.username, details: e.details, at: formatDateTime(e.created_at),
    })),
    versions: snaps.rows.map((v) => ({
      version: v.version, kind: v.kind, records: v.record_count, lines: v.line_count, amount: Number(v.total_amount),
      fingerprint: v.fingerprint, changes: v.change_count, by: v.created_by, at: formatDateTime(v.created_at),
    })),
    changeHistory: changes.rows.map((c) => ({
      faCode: c.fa_code, field: c.field, oldValue: c.old_value, newValue: c.new_value, source: c.source, by: c.name || c.username, at: formatDateTime(c.created_at),
    })),
  };
}

// Locks the month row (creating it if needed) for a status change
async function lockPeriod(db, month) {
  await db.query('INSERT INTO month_periods (book_month) VALUES ($1) ON CONFLICT DO NOTHING', [month]);
  return (await db.query('SELECT * FROM month_periods WHERE book_month = $1 FOR UPDATE', [month])).rows[0];
}

async function addEvent(db, user, month, action, from, to, details = '') {
  await db.query(
    'INSERT INTO month_events (book_month, action, status_from, status_to, username, name, details) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [month, action, from, to, user.username || '', user.name || '', details]
  );
  await logActivity(user, `Month ${action}`, 'Month-wise Data', '', '', '', `${monthLabel(month)}: ${from} -> ${to}${details ? `. ${details}` : ''}`, db);
}

const failedChecks = (checks, ids) => checks.filter((c) => ids.includes(c.id) && !c.ok);

// submitMonth: Open -> Under Review (any user), when the month's own work is done
async function submitMonth(user, value) {
  const month = monthOf(value);
  return withTransaction(async (db) => {
    const p = await lockPeriod(db, month);
    if (p.status !== 'Open') throw fail(`${monthLabel(month)} is ${p.status}; only an Open month can be submitted.`, 409);
    const { checks } = await monthChecks(month, db);
    const bad = failedChecks(checks, ['records', 'pending', 'credit', 'fams']);
    if (bad.length) throw fail(`Cannot submit ${monthLabel(month)}: ${bad.map((c) => c.detail).join(' ')}`, 409);
    await db.query("UPDATE month_periods SET status = 'Under Review', submitted_by = $2, submitted_at = NOW(), updated_at = NOW() WHERE book_month = $1", [month, who(user)]);
    await addEvent(db, user, month, 'Submitted', 'Open', 'Under Review');
    return { success: true, message: `${monthLabel(month)} submitted for review. It is now locked for users.` };
  });
}

// sendBack (Admin): Under Review -> Open, with a reason
async function sendBack(user, value, reason) {
  const month = monthOf(value);
  if (text(reason).length < 3) throw fail('Give the reason for sending the month back.');
  return withTransaction(async (db) => {
    const p = await lockPeriod(db, month);
    if (p.status !== 'Under Review') throw fail(`${monthLabel(month)} is not under review.`, 409);
    await db.query("UPDATE month_periods SET status = 'Open', updated_at = NOW() WHERE book_month = $1", [month]);
    await addEvent(db, user, month, 'Sent Back', 'Under Review', 'Open', text(reason));
    return { success: true, message: `${monthLabel(month)} sent back. Users can change it again.` };
  });
}

// Fingerprint and totals of a set of FAMS items
function summarise(items, records, amount) {
  const sorted = [...items].sort((a, b) => a.lineId - b.lineId);
  return {
    sorted,
    fingerprint: crypto.createHash('sha256').update(JSON.stringify(sorted.map((i) => [i.lineId, i.values]))).digest('hex'),
    records, lines: items.length, amount: round2(amount),
  };
}

// Changes-only rows: lines added, changed (with the changed FAMS columns) or removed
function diffItems(before, after) {
  const prev = new Map(before.map((i) => [i.lineId, i]));
  const next = new Map(after.map((i) => [i.lineId, i]));
  const out = [];
  after.forEach((i) => {
    const old = prev.get(i.lineId);
    if (!old) { out.push({ type: 'Added', fields: '', faCode: i.faCode, values: i.values }); return; }
    const fields = FAMS_TEMPLATE_HEADERS.filter((h, c) => c !== ERROR_COL && String(old.values[c] ?? '') !== String(i.values[c] ?? ''));
    if (fields.length) out.push({ type: 'Changed', fields: fields.join(', '), faCode: i.faCode, values: i.values });
  });
  before.forEach((i) => { if (!next.has(i.lineId)) out.push({ type: 'Removed', fields: '', faCode: i.faCode, values: i.values }); });
  return out;
}

async function saveSnapshot(db, user, month, version, kind, famsItems, changes = null) {
  const stats = (await monthStats(db, month))[month] || { records: 0, amount: 0 };
  const sum = summarise(famsItems, stats.records, stats.amount);
  await db.query(
    `INSERT INTO month_snapshots (book_month, version, kind, record_count, line_count, total_amount, fingerprint, fams_rows, changes, change_count, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [month, version, kind, sum.records, sum.lines, sum.amount, sum.fingerprint, JSON.stringify(sum.sorted),
      changes ? JSON.stringify(changes) : null, changes ? changes.length : 0, who(user)]
  );
  return sum;
}

/**
 * finalizeMonth (Admin): Open / Under Review -> Finalized. Every check must
 * pass; a Tally difference needs lwmRemark. Saves the FAMS rows as the next
 * version, and from version 2 on the changes-only rows against the previous one.
 */
async function finalizeMonth(user, value, { lwmRemark } = {}) {
  const month = monthOf(value);
  return withTransaction(async (db) => {
    const p = await lockPeriod(db, month);
    if (!['Open', 'Under Review'].includes(p.status)) throw fail(`${monthLabel(month)} is already ${p.status}.`, 409);
    const { checks, famsItems } = await monthChecks(month, db);
    const bad = failedChecks(checks, ['records', 'pending', 'credit', 'fams']);
    if (bad.length) throw fail(`Cannot finalize ${monthLabel(month)}: ${bad.map((c) => c.detail).join(' ')}`, 409);
    const tally = checks.find((c) => c.id === 'tally');
    const remark = text(lwmRemark);
    if (!tally.ok && remark.length < 3) throw fail(`${tally.detail} Enter a remark to finalize with this difference.`, 409);

    const version = p.version + 1;
    let changes = null;
    if (version > 1) {
      const prev = (await db.query('SELECT fams_rows FROM month_snapshots WHERE book_month = $1 AND version = $2', [month, p.version])).rows[0];
      changes = diffItems(prev ? prev.fams_rows : [], famsItems);
    }
    const sum = await saveSnapshot(db, user, month, version, 'finalized', famsItems, changes);
    await db.query(
      `UPDATE month_periods SET status = 'Finalized', version = $2, finalized_by = $3, finalized_at = NOW(), lwm_remark = $4,
         fams_reference = '', fams_uploaded_on = NULL, fams_uploaded_by = NULL, updated_at = NOW() WHERE book_month = $1`,
      [month, version, who(user), tally.ok ? '' : remark]
    );
    const extra = [`Version ${version}`, `${sum.records} record(s), ${sum.lines} FAMS row(s)`,
      changes ? `${changes.length} change(s) since version ${version - 1}` : '', tally.ok ? '' : `Tally difference accepted: ${remark}`].filter(Boolean).join('. ');
    await addEvent(db, user, month, 'Finalized', p.status, 'Finalized', extra);
    return {
      success: true, version, changes: changes ? changes.length : null,
      message: `${monthLabel(month)} finalized (version ${version}).${changes ? ` ${changes.length} change(s) since version ${version - 1} - download the changes-only file for FAMS.` : ' Download the FAMS file and upload it to FAMS.'}`,
    };
  });
}

// markFamsUploaded (Admin): Finalized -> FAMS Uploaded, with the FAMS reference and date
async function markFamsUploaded(user, value, { reference, uploadedOn } = {}) {
  const month = monthOf(value);
  const ref = text(reference);
  if (!ref) throw fail('Enter the FAMS upload reference (batch / ticket no).');
  const on = parseDate(uploadedOn) || parseDate(new Date());
  return withTransaction(async (db) => {
    const p = await lockPeriod(db, month);
    if (p.status !== 'Finalized') throw fail(`${monthLabel(month)} must be Finalized first.`, 409);
    await db.query(
      "UPDATE month_periods SET status = 'FAMS Uploaded', fams_reference = $2, fams_uploaded_on = $3, fams_uploaded_by = $4, updated_at = NOW() WHERE book_month = $1",
      [month, ref, on, who(user)]
    );
    await addEvent(db, user, month, 'FAMS Uploaded', 'Finalized', 'FAMS Uploaded', `Reference ${ref}, ${formatDate(on)}, version ${p.version}`);
    return { success: true, message: `${monthLabel(month)} marked as uploaded to FAMS.` };
  });
}

/**
 * reopenMonth (Admin): Finalized / FAMS Uploaded -> Open, with a reason. A month
 * finalized before snapshots existed gets its copy now (before any change),
 * so the next finalization can produce the changes-only file.
 */
async function reopenMonth(user, value, reason) {
  const month = monthOf(value);
  if (text(reason).length < 5) throw fail('Give the reason for re-opening (at least 5 characters).');
  return withTransaction(async (db) => {
    const p = await lockPeriod(db, month);
    if (!CLOSED.includes(p.status)) throw fail(`${monthLabel(month)} is ${p.status}; only a finalized month can be re-opened.`, 409);
    const has = await db.query('SELECT 1 FROM month_snapshots WHERE book_month = $1 AND version = $2', [month, p.version]);
    if (!has.rows.length) {
      const { items } = await buildFAMSItems({ bookMonth: month }, db);
      await saveSnapshot(db, user, month, Math.max(p.version, 1), 'baseline', items);
      if (p.version < 1) await db.query('UPDATE month_periods SET version = 1 WHERE book_month = $1', [month]);
    }
    await db.query(
      "UPDATE month_periods SET status = 'Open', reopened_by = $2, reopened_at = NOW(), reopen_reason = $3, updated_at = NOW() WHERE book_month = $1",
      [month, who(user), text(reason)]
    );
    await addEvent(db, user, month, 'Re-opened', p.status, 'Open', text(reason));
    return { success: true, message: `${monthLabel(month)} re-opened. Make the corrections, then finalize it again to get the changes-only FAMS file.` };
  });
}

// Workbook sheets of a saved version: its FAMS file, or its changes-only file
async function versionFile(value, version, kind) {
  const month = monthOf(value);
  const { rows } = await pool.query('SELECT * FROM month_snapshots WHERE book_month = $1 AND version = $2', [month, Number(version)]);
  const snap = rows[0];
  if (!snap) throw fail('That version does not exist.', 404);
  const label = `${monthLabel(month).replace(' ', '_')}_v${snap.version}`;
  if (kind === 'changes') {
    if (!snap.changes) throw fail('Version 1 has no changes-only file; use its FAMS file.', 404);
    return {
      fileName: `FAMS_Changes_${label}.xlsx`,
      rowCount: snap.changes.length,
      sheets: [{ name: 'FAMS Changes', rows: [['Change Type', 'Changed Fields', ...FAMS_TEMPLATE_HEADERS], ...snap.changes.map((c) => [c.type, c.fields, ...c.values])] }],
    };
  }
  return {
    fileName: `FAMS_${label}.xlsx`,
    rowCount: snap.fams_rows.length,
    sheets: [{ name: 'FAMS Template', rows: [FAMS_TEMPLATE_HEADERS, ...snap.fams_rows.map((i) => i.values)] }],
  };
}

// Change history of one FA record (Admin; FA Data > Details)
async function recordHistory(faCode) {
  const { rows } = await pool.query('SELECT * FROM change_history WHERE fa_code = $1 ORDER BY change_id DESC LIMIT 300', [text(faCode)]);
  return rows.map((c) => ({ field: c.field, oldValue: c.old_value, newValue: c.new_value, source: c.source, by: c.name || c.username, at: formatDateTime(c.created_at) }));
}

module.exports = {
  bookingMonths, listMonths, getMonth, monthChecks, submitMonth, sendBack, finalizeMonth, markFamsUploaded, reopenMonth,
  versionFile, recordHistory, diffItems,
};
