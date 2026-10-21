const { pool } = require('../config/db');

/**
 * Appends one Activity Log row (logActivity_). `user` is req.user.
 * Like the original, a logging failure never blocks the main transaction,
 * unless `db` is a transaction client: then it rolls back with the change.
 */
async function logActivity(user, action, module, faCode = '', invNo = '', expenseHead = '', details = '', db = null) {
  const sql = `INSERT INTO activity_log (username, name, action, module, fa_code, inv_no, expense_head, details)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`;
  const params = [user?.username || '', user?.name || '', action, module, faCode || '', invNo || '', expenseHead || '', details || ''];
  if (db) return db.query(sql, params);
  try {
    await pool.query(sql, params);
  } catch (err) {
    // Activity logging must never block the main transaction.
  }
  return undefined;
}

module.exports = { logActivity };
