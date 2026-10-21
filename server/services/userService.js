// Login and user management (login, logout, getUsers, addUser, updateUser).
// Passwords are stored as bcrypt hashes instead of plain text.
const bcrypt = require('bcryptjs');
const { pool, withTransaction } = require('../config/db');
const { httpError } = require('../utils/httpError');
const { logActivity } = require('../utils/activity');
const { text, formatDateTime } = require('../utils/values');
const { createSession, openSessions, endOtherSessions, IDLE_MINUTES, OPEN_MINUTES, OPEN_SQL } = require('../middleware/auth');

const fail = (message, status = 400) => httpError(status, message);

// Rough browser / OS name for the "already signed in" message
function deviceOf(userAgent) {
  const ua = String(userAgent || '');
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS'
    : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  return [browser, os].filter(Boolean).join(' on ');
}

/**
 * One sign-in per user ID, for Admins too: while the user is signed in on a
 * browser that is open (checked in within OPEN_MINUTES), a new sign-in is
 * refused (409 ALREADY_SIGNED_IN), recorded, and shown to the signed-in user.
 * A session whose browser was closed, or that is idle, is replaced. An Admin
 * can end someone's session from Users.
 */
async function login(username, password, { userAgent = '', ip = '' } = {}) {
  username = text(username);
  password = String(password || '');
  if (!username || !password) throw fail('Username and password are required.');
  const { rows } = await pool.query('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [username]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) throw fail('Invalid username or password.', 401);
  if (user.active === 'No') throw fail('This user account is inactive.', 403);

  const who = { username: user.username, name: user.name };
  const open = await openSessions(user.user_id);
  if (open.length) {
    const device = deviceOf(userAgent) || 'another browser';
    await pool.query('INSERT INTO login_attempts (user_id, device, ip) VALUES ($1, $2, $3)', [user.user_id, device.slice(0, 100), String(ip).slice(0, 64)]);
    await logActivity(who, 'Login Blocked', 'Login', '', '', '', `Already signed in on ${deviceOf(open[0].user_agent) || 'another browser'}; attempt from ${device}${ip ? ` (${ip})` : ''}`);
    const err = fail(`User ID ${user.username} is already signed in on another browser or computer.`, 409);
    err.extra = {
      code: 'ALREADY_SIGNED_IN',
      device: deviceOf(open[0].user_agent),
      since: open[0].created_at,
      lastActive: open[0].last_seen_at,
      openMinutes: OPEN_MINUTES,
    };
    throw err;
  }
  await endOtherSessions(user.user_id); // sessions of closed browsers / idle ones
  const token = await createSession(user.user_id, userAgent);
  await logActivity(who, 'Login', 'Login');
  return { success: true, token, username: user.username, name: user.name, role: user.role, idleMinutes: IDLE_MINUTES };
}

// Ends only this browser's session, as before
async function logout(tokenHash) {
  // signing out also frees the invoices reserved for Qty Plotting
  await pool.query('DELETE FROM qty_locks WHERE user_id IN (SELECT user_id FROM sessions WHERE token_hash = $1)', [tokenHash]);
  await pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
  return { success: true };
}

const userOut = (u) => ({ username: u.username, name: u.name, role: u.role, active: u.active, email: u.email || '', department: u.department || '' });

// Users with their current sign-in: browser, since, last active
async function getUsers() {
  const { rows } = await pool.query(
    `SELECT u.*, o.created_at AS session_since, o.last_seen_at AS session_seen, o.user_agent AS session_agent
     FROM users u
     LEFT JOIN LATERAL (SELECT s.* FROM sessions s WHERE s.user_id = u.user_id AND ${OPEN_SQL} ORDER BY s.last_ping_at DESC LIMIT 1) o ON TRUE
     ORDER BY u.user_id`
  );
  return rows.map((u) => ({
    ...userOut(u),
    session: u.session_since
      ? { device: deviceOf(u.session_agent), since: formatDateTime(u.session_since), lastActive: u.session_seen }
      : null,
  }));
}

// signOutUser (Admin): ends another user's sessions now (e.g. a PC left signed in)
async function signOutUser(admin, username) {
  const { rows } = await pool.query('SELECT user_id, username, name FROM users WHERE LOWER(username) = LOWER($1)', [text(username)]);
  const user = rows[0];
  if (!user) throw fail('User not found.', 404);
  if (user.user_id === admin.userId) throw fail('This is your own session. Use Sign out at the bottom of the menu.');
  const ended = await pool.query(
    "UPDATE sessions SET ended_at = NOW(), ended_reason = 'admin' WHERE user_id = $1 AND ended_at IS NULL AND expires_at > NOW()",
    [user.user_id]
  );
  await pool.query('DELETE FROM qty_locks WHERE user_id = $1', [user.user_id]);
  await logActivity(admin, 'Session Ended by Admin', 'Users', '', '', '', `${user.username}: ${ended.rowCount} session(s) signed out`);
  return {
    success: true,
    message: ended.rowCount ? `${user.name || user.username} has been signed out. They can sign in again now.` : `${user.name || user.username} was not signed in.`,
  };
}

const roleOf = (value) => (text(value) === 'Admin' ? 'Admin' : 'User');

async function addUser(admin, user) {
  if (!user) throw fail('User data is required.');
  const username = text(user.username);
  const password = String(user.password || '');
  if (!username || !password) throw fail('Username and password are required.');
  const exists = await pool.query('SELECT 1 FROM users WHERE LOWER(username) = LOWER($1)', [username]);
  if (exists.rows.length) throw fail('Username already exists.');
  const role = roleOf(user.role);
  await pool.query(
    `INSERT INTO users (username, password_hash, name, role, active, email, department) VALUES ($1, $2, $3, $4, 'Yes', $5, $6)`,
    [username, await bcrypt.hash(password, 10), text(user.name) || username, role, text(user.email) || null, text(user.department) || null]
  );
  await logActivity(admin, 'User Created', 'Users', '', '', '', `Created user: ${username} (${role})`);
  return { success: true, message: 'User added successfully.' };
}

/**
 * updateUser: username cannot change; a blank password keeps the current one.
 * Making a user inactive, or changing the password, ends their sessions.
 */
async function updateUser(admin, user) {
  if (!user || !text(user.username)) throw fail('Username is required.');
  return withTransaction(async (db) => {
    const current = (await db.query('SELECT * FROM users WHERE LOWER(username) = LOWER($1) FOR UPDATE', [text(user.username)])).rows[0];
    if (!current) throw fail('User not found.');
    const role = user.role ? roleOf(user.role) : current.role;
    const active = user.active ? (text(user.active) === 'No' ? 'No' : 'Yes') : current.active;
    if (current.user_id === admin.userId && (role !== 'Admin' || active === 'No')) {
      throw fail('You cannot remove your own Admin role or make yourself inactive.');
    }
    const password = user.password === undefined || user.password === '' ? null : String(user.password);
    await db.query(
      `UPDATE users SET name=$1, role=$2, active=$3, email=$4, department=$5,
         password_hash = COALESCE($6, password_hash), updated_at = NOW() WHERE user_id = $7`,
      [text(user.name) || current.name, role, active, text(user.email) || null, text(user.department) || null,
        password ? await bcrypt.hash(password, 10) : null, current.user_id]
    );
    if (password || active === 'No') await db.query('DELETE FROM sessions WHERE user_id = $1', [current.user_id]);
    await logActivity(admin, 'User Updated', 'Users', '', '', '', `Updated user: ${current.username}`, db);
    return { success: true, message: 'User updated successfully.' };
  });
}

module.exports = { login, logout, getUsers, addUser, updateUser, signOutUser };

// changeOwnPassword: any user, with the current password; at least 8 characters
async function changeOwnPassword(user, { currentPassword, newPassword } = {}) {
  const next = String(newPassword || '');
  if (next.length < 8) throw fail('The new password must have at least 8 characters.');
  const { rows } = await pool.query('SELECT password_hash FROM users WHERE user_id = $1', [user.userId]);
  if (!rows[0] || !(await bcrypt.compare(String(currentPassword || ''), rows[0].password_hash))) throw fail('The current password is not correct.', 400);
  if (await bcrypt.compare(next, rows[0].password_hash)) throw fail('The new password must be different from the current one.');
  await pool.query('UPDATE users SET password_hash = $2 WHERE user_id = $1', [user.userId, await bcrypt.hash(next, 10)]);
  await logActivity(user, 'Password Changed', 'Settings', '', '', '', 'Own password changed');
  return { success: true, message: 'Your password has been changed.' };
}

module.exports.changeOwnPassword = changeOwnPassword;
