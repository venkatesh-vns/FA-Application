const crypto = require('crypto');
const { pool } = require('../config/db');
const { signJwt, verifyJwt } = require('../utils/jwt');

// Longest a session can last, however active (12 hours: one working day)
const SESSION_SECONDS = Number(process.env.SESSION_SECONDS) || 43200;
// Signed out after this many minutes without activity. Activity = a request the
// user made, or the browser reporting keyboard / mouse use (POST /auth/ping).
// Automatic background requests (header X-Background: 1) do not count.
const IDLE_MINUTES = Number(process.env.SESSION_IDLE_MINUTES) || 30;
// A session is "open" (blocks a second sign-in) while its browser checked in
// within this many minutes; an open browser checks in every minute
const OPEN_MINUTES = Number(process.env.SESSION_OPEN_MINUTES) || 3;

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

// New session for a user (createSession_); returns its JWT. The database keeps
// only a hash of the session id (sid) carried in the token.
async function createSession(userId, userAgent = '', db = pool) {
  const sid = crypto.randomBytes(32).toString('hex');
  const token = signJwt({ sub: userId, sid }, SESSION_SECONDS);
  await db.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at, user_agent)
     VALUES ($1, $2, NOW() + ($3 || ' seconds')::interval, $4)`,
    [hashToken(sid), userId, String(SESSION_SECONDS), String(userAgent).slice(0, 300)]
  );
  return token;
}

// SQL condition (alias s): the session is open in a browser right now
const OPEN_SQL = `s.ended_at IS NULL AND s.expires_at > NOW()
  AND s.last_seen_at > NOW() - INTERVAL '${IDLE_MINUTES} minutes'
  AND s.last_ping_at > NOW() - INTERVAL '${OPEN_MINUTES} minutes'`;

// Sessions of a user that are open in a browser right now (newest first)
async function openSessions(userId, db = pool) {
  const { rows } = await db.query(
    `SELECT s.token_hash, s.created_at, s.last_seen_at, s.last_ping_at, s.user_agent FROM sessions s
     WHERE s.user_id = $1 AND ${OPEN_SQL} ORDER BY s.last_ping_at DESC`,
    [userId]
  );
  return rows;
}

// Ends every other open session of the user ('replaced'), and tidies old rows
async function endOtherSessions(userId, db = pool) {
  await db.query(
    "UPDATE sessions SET ended_at = NOW(), ended_reason = 'replaced' WHERE user_id = $1 AND ended_at IS NULL",
    [userId]
  );
  await db.query("DELETE FROM sessions WHERE expires_at < NOW() OR ended_at < NOW() - INTERVAL '1 day'");
}

// The session key of the request: the sid of a valid JWT, or (sign-ins made
// before JWTs) the token itself. null when missing or invalid.
const tokenOf = (req) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  if (!token.includes('.')) return /^[0-9a-f]{64}$/.test(token) ? token : null;
  const payload = verifyJwt(token);
  return payload && payload.sid ? payload.sid : null;
};

// Every route after login (getSession_). An inactive user's sessions end at once;
// a session replaced by a newer sign-in, ended by an Admin, or idle for IDLE_MINUTES, is told so.
async function authenticate(req, res, next) {
  const token = tokenOf(req);
  const expired = () => res.status(401).json({ success: false, code: 'SESSION_EXPIRED', message: 'Session expired. Please login again.' });
  if (!token) return expired();
  try {
    const hash = hashToken(token);
    const { rows } = await pool.query(
      `SELECT u.*, s.ended_at, s.ended_reason, s.last_seen_at, s.last_ping_at, (s.expires_at > NOW()) AS live,
         (s.last_seen_at < NOW() - ($2 || ' minutes')::interval) AS idle
       FROM sessions s JOIN users u ON u.user_id = s.user_id WHERE s.token_hash = $1`,
      [hash, String(IDLE_MINUTES)]
    );
    const row = rows[0];
    if (row && row.ended_reason === 'replaced') {
      return res.status(401).json({
        success: false,
        code: 'SESSION_REPLACED',
        message: 'You were signed out because this user signed in on another browser or computer.',
      });
    }
    if (row && row.ended_reason === 'idle') return idleOut(res);
    if (row && row.ended_reason === 'admin') {
      return res.status(401).json({ success: false, code: 'SESSION_ENDED_BY_ADMIN', message: 'An Admin signed you out. Please sign in again.' });
    }
    if (!row || !row.live || row.ended_at || row.active === 'No') return expired();
    if (row.idle) {
      // no activity for IDLE_MINUTES: end the session and free its Qty Plotting reservations
      await pool.query("UPDATE sessions SET ended_at = NOW(), ended_reason = 'idle' WHERE token_hash = $1", [hash]);
      await pool.query('DELETE FROM qty_locks WHERE user_id = $1', [row.user_id]);
      return idleOut(res);
    }
    // every request shows the browser is open (last_ping_at); a request the
    // user made also keeps the session alive (last_seen_at); at most one update per 30 s / minute
    const seen = req.headers['x-background'] !== '1' && Date.now() - new Date(row.last_seen_at).getTime() > 60000;
    const pinged = Date.now() - new Date(row.last_ping_at).getTime() > 30000;
    if (seen || pinged) {
      pool.query(
        'UPDATE sessions SET last_ping_at = NOW(), last_seen_at = CASE WHEN $2 THEN NOW() ELSE last_seen_at END WHERE token_hash = $1',
        [hash, seen]
      ).catch(() => {});
    }
    req.user = { userId: row.user_id, username: row.username, name: row.name, role: row.role, isAdmin: row.role === 'Admin' };
    req.tokenHash = hash;
    next();
  } catch (err) {
    next(err);
  }
}

function idleOut(res) {
  return res.status(401).json({
    success: false,
    code: 'SESSION_IDLE',
    message: `You were signed out after ${IDLE_MINUTES} minutes without activity.`,
  });
}

// The browser's check-in every minute: keeps "open" current, reports whether
// the user is working (typing / clicking), and collects the notices of refused
// sign-ins with this user ID since this session started
async function ping(req) {
  await pool.query(
    'UPDATE sessions SET last_ping_at = NOW(), last_seen_at = CASE WHEN $2 THEN NOW() ELSE last_seen_at END WHERE token_hash = $1',
    [req.tokenHash, Boolean(req.body && req.body.active === true)]
  );
  const { rows } = await pool.query(
    `UPDATE login_attempts a SET notified_at = NOW() FROM sessions s
     WHERE s.token_hash = $1 AND a.user_id = s.user_id AND a.notified_at IS NULL AND a.created_at >= s.created_at
     RETURNING a.device, a.created_at`,
    [req.tokenHash]
  );
  return { success: true, idleMinutes: IDLE_MINUTES, blockedAttempts: rows.map((r) => ({ device: r.device, at: r.created_at })) };
}

// Admin-only actions
const requireAdmin = (message) => (req, res, next) => {
  if (req.user.isAdmin) return next();
  res.status(403).json({ success: false, message });
};

module.exports = {
  createSession, openSessions, endOtherSessions, authenticate, requireAdmin, ping, hashToken, SESSION_SECONDS, IDLE_MINUTES, OPEN_MINUTES, OPEN_SQL,
};
