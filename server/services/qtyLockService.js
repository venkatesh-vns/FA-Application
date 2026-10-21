// Qty Plotting reservations: opening Plot Qty reserves the FA Code for that
// user; others do not get it until it is saved, released or lapses
// (LOCK_MINUTES without a keep-alive, e.g. the browser was closed).
const { pool, withTransaction } = require('../config/db');
const { httpError } = require('../utils/httpError');
const { logActivity } = require('../utils/activity');
const { text, formatDateTime } = require('../utils/values');

const LOCK_MINUTES = Number(process.env.QTY_LOCK_MINUTES) || 10;
const LIVE = `l.last_seen_at > NOW() - INTERVAL '${LOCK_MINUTES} minutes'`;

const lockedError = (name) => {
  const err = httpError(409, `This invoice is being plotted by ${name}.`);
  err.extra = { code: 'LOCKED', lockedBy: name };
  return err;
};

/**
 * Reserves an FA Code for the user (or renews the user's own reservation).
 * The user's other reservations are released: one invoice at a time.
 * Throws 409 LOCKED when another user holds it, 409 when it is already plotted.
 */
async function claim(user, faCode) {
  return withTransaction(async (db) => {
    const { rows } = await db.query('SELECT fa_id, status FROM fa_records WHERE fa_code = $1 FOR UPDATE', [text(faCode)]);
    const r = rows[0];
    if (!r) throw httpError(404, 'FA record not found. Refresh the list.');
    const plotted = await db.query('SELECT 1 FROM qty_lines WHERE fa_id = $1 LIMIT 1', [r.fa_id]);
    if (plotted.rows.length) throw httpError(409, 'Qty Plotting already exists for this FA Code. Refresh the list.');

    const held = await db.query(
      `SELECT l.user_id, u.name, u.username FROM qty_locks l JOIN users u ON u.user_id = l.user_id WHERE l.fa_id = $1 AND ${LIVE}`,
      [r.fa_id]
    );
    if (held.rows.length && held.rows[0].user_id !== user.userId) throw lockedError(held.rows[0].name || held.rows[0].username);

    await db.query('DELETE FROM qty_locks WHERE user_id = $1 AND fa_id <> $2', [user.userId, r.fa_id]);
    await db.query(
      `INSERT INTO qty_locks (fa_id, user_id) VALUES ($1, $2)
       ON CONFLICT (fa_id) DO UPDATE SET user_id = EXCLUDED.user_id, locked_at = NOW(), last_seen_at = NOW()`,
      [r.fa_id, user.userId]
    );
    return { success: true, faCode: text(faCode), minutes: LOCK_MINUTES };
  });
}

// Keeps the user's reservation alive while the Qty Plotting window is open
async function keepAlive(user, faCode) {
  const { rowCount } = await pool.query(
    `UPDATE qty_locks l SET last_seen_at = NOW() FROM fa_records f
     WHERE f.fa_id = l.fa_id AND f.fa_code = $1 AND l.user_id = $2`,
    [text(faCode), user.userId]
  );
  if (!rowCount) return claim(user, faCode); // lapsed or released: take it again if still free
  return { success: true };
}

// Releases a reservation: the user's own, or any (Admin)
async function release(user, faCode, { admin = false } = {}) {
  const { rows } = await pool.query(
    `DELETE FROM qty_locks l USING fa_records f, users u
     WHERE f.fa_id = l.fa_id AND u.user_id = l.user_id AND f.fa_code = $1 ${admin ? '' : 'AND l.user_id = $2'}
     RETURNING u.name, u.username, l.user_id`,
    admin ? [text(faCode)] : [text(faCode), user.userId]
  );
  if (admin && rows.length && rows[0].user_id !== user.userId) {
    await logActivity(user, 'Qty Lock Released', 'Qty Plotting', text(faCode), '', '', `Reservation of ${rows[0].name || rows[0].username} released by Admin`);
  }
  return { success: true, released: rows.length > 0, message: rows.length ? `${text(faCode)} is free for Qty Plotting again.` : 'The invoice was not reserved.' };
}

// Signing out ends the user's reservations
async function releaseAllOf(userId, db = pool) {
  await db.query('DELETE FROM qty_locks WHERE user_id = $1', [userId]);
}

// Live reservations by fa_id: { fa_id: { userId, name, at } }
async function liveLocks(db = pool) {
  const { rows } = await db.query(
    `SELECT l.fa_id, l.user_id, l.locked_at, u.name, u.username FROM qty_locks l JOIN users u ON u.user_id = l.user_id WHERE ${LIVE}`
  );
  return Object.fromEntries(rows.map((r) => [r.fa_id, { userId: r.user_id, name: r.name || r.username, at: formatDateTime(r.locked_at) }]));
}

// Throws when another user holds a live reservation on the record (saving Qty Plotting)
async function assertNotLockedByOther(db, user, faId) {
  const { rows } = await db.query(
    `SELECT l.user_id, u.name, u.username FROM qty_locks l JOIN users u ON u.user_id = l.user_id WHERE l.fa_id = $1 AND ${LIVE}`,
    [faId]
  );
  if (rows.length && rows[0].user_id !== user.userId) throw lockedError(rows[0].name || rows[0].username);
}

module.exports = { claim, keepAlive, release, releaseAllOf, liveLocks, assertNotLockedByOther, LOCK_MINUTES };
