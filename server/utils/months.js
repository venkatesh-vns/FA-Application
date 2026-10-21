// Tally booking months ('YYYY-MM'): labels, parsing, the edit lock of a
// month and field-level change history.
const { httpError } = require('./httpError');
const { text } = require('./values');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FULL = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const CLOSED = ['Finalized', 'FAMS Uploaded'];

const pad = (n) => String(n).padStart(2, '0');
const valid = (y, m) => y >= 2000 && y <= 2100 && m >= 1 && m <= 12;

// '2026-10' -> 'Oct 2026'
function monthLabel(month) {
  const m = String(month || '').match(/^(\d{4})-(\d{2})$/);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : String(month || '');
}

// The current calendar month, 'YYYY-MM'
function currentMonth(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

/**
 * Month from what a user typed or Excel holds, as 'YYYY-MM' (null if unreadable):
 * '2026-10', 'Oct-2026', 'Oct 2026', 'October 2026', '10/2026', '10-2026',
 * a date ('15/10/2026', '2026-10-15') or an Excel date cell.
 */
function parseMonth(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}`;
  }
  const t = text(value).toLowerCase().replace(/\s+/g, ' ');
  let m = t.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2}(?:[t ].*)?)?$/);
  if (m && valid(+m[1], +m[2])) return `${m[1]}-${pad(+m[2])}`;
  m = t.match(/^(\d{1,2})[/-](\d{4})$/);
  if (m && valid(+m[2], +m[1])) return `${m[2]}-${pad(+m[1])}`;
  m = t.match(/^\d{1,2}[/-](\d{1,2})[/-](\d{4})$/);
  if (m && valid(+m[2], +m[1])) return `${m[2]}-${pad(+m[1])}`;
  m = t.match(/^([a-z]+)[ ,'/-]*(\d{2}|\d{4})$/);
  if (m) {
    const i = FULL.findIndex((f) => f === m[1] || f.slice(0, 3) === m[1] || (m[1] === 'sept' && f === 'september'));
    const y = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
    if (i >= 0 && valid(y, i + 1)) return `${y}-${pad(i + 1)}`;
  }
  return null;
}

// The newest Finalized / FAMS Uploaded month, or null
async function lastClosedMonth(db) {
  const { rows } = await db.query('SELECT MAX(book_month) AS m FROM month_periods WHERE status = ANY($1)', [CLOSED]);
  return rows[0].m || null;
}

/**
 * Throws unless `user` may change data of `month`:
 *   Open          - everyone
 *   Under Review  - Admin only
 *   Finalized / FAMS Uploaded - nobody (an Admin re-opens the month first)
 * A month without a row yet is Open, unless it is before the newest closed
 * month; with `create` its row is added. Locks the row (FOR SHARE) so the month
 * cannot be finalized while this transaction saves.
 */
async function assertMonthEditable(db, user, month, { create = false } = {}) {
  if (!month) throw httpError(400, 'Tally Booking Month is required.');
  const { rows } = await db.query('SELECT status FROM month_periods WHERE book_month = $1 FOR SHARE', [month]);
  const label = monthLabel(month);
  if (!rows.length) {
    // moved to the archive database at year-end: restore it first
    const archived = await db.query(
      "SELECT label FROM archive_runs WHERE status = 'archived' AND $1 BETWEEN from_month AND to_month LIMIT 1",
      [month]
    );
    if (archived.rows.length) {
      throw httpError(409, `${label} is archived (Year-End Archive: ${archived.rows[0].label}). An Admin must restore it before it can be changed.`);
    }
    const last = await lastClosedMonth(db);
    if (last && month < last) {
      throw httpError(409, `${label} is before the last finalized month (${monthLabel(last)}). Choose an open month.`);
    }
    if (create) await db.query('INSERT INTO month_periods (book_month) VALUES ($1) ON CONFLICT DO NOTHING', [month]);
    return 'Open';
  }
  const { status } = rows[0];
  if (CLOSED.includes(status)) {
    throw httpError(409, `${label} is finalized. An Admin must re-open the month (Month-wise Data) before it can be changed.`);
  }
  if (status === 'Under Review' && !user?.isAdmin) {
    throw httpError(409, `${label} is under review and locked. Ask an Admin to send it back if changes are needed.`);
  }
  return status;
}

// Checks several months at once (e.g. bulk delete); one message for all locked ones
async function assertMonthsEditable(db, user, months) {
  const problems = [];
  for (const m of [...new Set(months)].sort()) {
    try {
      await assertMonthEditable(db, user, m);
    } catch (err) {
      problems.push(err.message);
    }
  }
  if (problems.length) throw httpError(409, problems.length === 1 ? problems[0] : `Locked months: ${problems.join(' ')}`);
}

const show = (v) => (v === null || v === undefined ? '' : String(v));

/**
 * Field-level change history. changes: [[field, oldValue, newValue], ...];
 * unchanged pairs are skipped. Returns how many rows were written.
 */
async function recordChanges(db, user, { faCode, bookMonth, lineId = null, source, changes }) {
  let n = 0;
  for (const [field, before, after] of changes) {
    if (show(before) === show(after)) continue;
    await db.query(
      `INSERT INTO change_history (fa_code, book_month, line_id, field, old_value, new_value, source, username, name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [faCode, bookMonth || '', lineId, field, show(before), show(after), source, user?.username || '', user?.name || '']
    );
    n += 1;
  }
  return n;
}

module.exports = {
  CLOSED, monthLabel, currentMonth, parseMonth, lastClosedMonth, assertMonthEditable, assertMonthsEditable, recordChanges,
};
