// JSON Web Tokens (HS256, RFC 7519) signed with JWT_SECRET from the settings.
// The token carries the user id and a session id; the session itself is kept in
// the database, so single login, idle sign-out and Admin sign-out still apply.
const crypto = require('crypto');

let warned = false;
function secret() {
  const s = process.env.JWT_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is missing or shorter than 32 characters in the settings (.env).');
  }
  // development / tests: one random secret per run
  if (!process.env.JWT_SECRET_RUNTIME) process.env.JWT_SECRET_RUNTIME = crypto.randomBytes(48).toString('hex');
  if (!warned && process.env.NODE_ENV !== 'test') { console.warn('JWT_SECRET not set: using a temporary secret (sign-ins end when the server restarts).'); warned = true; }
  return process.env.JWT_SECRET_RUNTIME;
}

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const fromB64url = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function signJwt(payload, expiresInSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + expiresInSeconds, iss: 'fa-management' };
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const data = `${head}.${b64url(JSON.stringify(body))}`;
  return `${data}.${b64url(crypto.createHmac('sha256', secret()).update(data).digest())}`;
}

// The payload of a valid, unexpired token signed with our secret; otherwise null
function verifyJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts;
  let header;
  let payload;
  try {
    header = JSON.parse(fromB64url(head).toString('utf8'));
    payload = JSON.parse(fromB64url(body).toString('utf8'));
  } catch { return null; }
  if (header.alg !== 'HS256') return null; // never 'none' or other algorithms
  const expected = crypto.createHmac('sha256', secret()).update(`${head}.${body}`).digest();
  const given = fromB64url(sig);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

module.exports = { signJwt, verifyJwt };
