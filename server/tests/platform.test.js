// On-premises / cloud readiness: JWT sessions, settings, own password,
// health check, business time zone independent of the server's clock
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { setup } = require('./helpers');

let ctx;
test.before(async () => { ctx = await setup(); });
test.after(async () => { await ctx.close(); });

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

test('sign-in issues a signed JWT; forged, altered or unsigned tokens are refused', async () => {
  const token = ctx.adminToken;
  const [h, p, s] = token.split('.');
  assert.ok(h && p && s, 'three parts');
  const header = JSON.parse(Buffer.from(h, 'base64url'));
  const payload = JSON.parse(Buffer.from(p, 'base64url'));
  assert.deepStrictEqual([header.alg, header.typ, payload.iss, typeof payload.sub, payload.sid.length], ['HS256', 'JWT', 'fa-management', 'number', 64]);
  assert.ok(payload.exp > payload.iat);
  assert.ok(!JSON.stringify(payload).toLowerCase().includes('password'));
  assert.strictEqual((await ctx.api('GET', '/auth/me', undefined, token)).status, 200);

  const tampered = `${h}.${b64({ ...payload, sub: 999 })}.${s}`;
  const unsigned = `${b64({ alg: 'none', typ: 'JWT' })}.${p}.`;
  const otherKey = `${h}.${p}.${crypto.createHmac('sha256', 'x'.repeat(40)).update(`${h}.${p}`).digest('base64url')}`;
  const expired = (() => {
    const body = b64({ ...payload, exp: Math.floor(Date.now() / 1000) - 10 });
    return `${h}.${body}.${s}`;
  })();
  for (const bad of [tampered, unsigned, otherKey, expired, 'garbage', `${h}.${p}`]) {
    assert.strictEqual((await ctx.api('GET', '/auth/me', undefined, bad)).status, 401, bad.slice(0, 20));
  }
  // the database row holds only a hash of the session id, never the token
  const row = (await ctx.pool.query('SELECT token_hash FROM sessions WHERE token_hash = $1', [crypto.createHash('sha256').update(payload.sid).digest('hex')])).rows;
  assert.strictEqual(row.length, 1);
});

test('a sign-in made before the JWT update keeps working until it ends', async () => {
  const raw = crypto.randomBytes(32).toString('hex');
  await ctx.api('POST', '/users', { username: 'legacy', password: 'pw123456', name: 'Legacy' });
  const uid = (await ctx.pool.query("SELECT user_id FROM users WHERE username = 'legacy'")).rows[0].user_id;
  await ctx.pool.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '1 hour')",
    [crypto.createHash('sha256').update(raw).digest('hex'), uid]);
  assert.strictEqual((await ctx.api('GET', '/auth/me', undefined, raw)).body.user.username, 'legacy');
});

test('health check, Settings (Admin sees the connection, never the password), own password change', async () => {
  const health = (await ctx.api('GET', '/health', undefined, null)).body;
  assert.deepStrictEqual([health.database, typeof health.version], ['connected', 'string']);

  const admin = (await ctx.api('GET', '/settings')).body;
  assert.strictEqual(admin.session.idleMinutes, 30);
  assert.deepStrictEqual(Object.keys(admin.system.database).sort(), ['database', 'host', 'port', 'ssl', 'user']);
  assert.ok(!JSON.stringify(admin).includes(process.env.DB_PASSWORD || '#none#'));

  await ctx.api('POST', '/users', { username: 'pw.user', password: 'first-pass', name: 'Pw' });
  const t = await ctx.login('pw.user', 'first-pass');
  const mine = (await ctx.api('GET', '/settings', undefined, t)).body;
  assert.deepStrictEqual([mine.me.username, mine.system], ['pw.user', undefined]);
  assert.match((await ctx.api('POST', '/auth/change-password', { currentPassword: 'nope', newPassword: 'second-pass' }, t)).body.message, /current password is not correct/);
  assert.match((await ctx.api('POST', '/auth/change-password', { currentPassword: 'first-pass', newPassword: 'short' }, t)).body.message, /at least 8/);
  const ok = await ctx.api('POST', '/auth/change-password', { currentPassword: 'first-pass', newPassword: 'second-pass' }, t);
  assert.strictEqual(ok.status, 200, ok.body.message);
  await ctx.api('POST', '/auth/logout', undefined, t);
  assert.ok(await ctx.login('pw.user', 'second-pass'));
});

test('times are business time (APP_TIME_ZONE) whatever the server clock: app process and database session', async () => {
  const zone = process.env.APP_TIME_ZONE || 'Asia/Kolkata';
  assert.strictEqual(process.env.TZ, zone);
  assert.strictEqual((await ctx.pool.query('SHOW TIME ZONE')).rows[0].TimeZone, zone);
  // a timestamp saved now shows the current business time
  await ctx.pool.query("INSERT INTO activity_log (username, name, action, module) VALUES ('tz', 'tz', 'TZ check', 'Test')");
  const saved = (await ctx.pool.query("SELECT logged_at FROM activity_log WHERE action = 'TZ check' ORDER BY log_id DESC LIMIT 1")).rows[0].logged_at;
  const { formatDateTime } = require('../utils/values');
  const now = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
  assert.strictEqual(formatDateTime(saved).slice(11, 16), now);
});
