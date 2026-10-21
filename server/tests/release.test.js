// Version control: version and release notes, add-only migration check,
// changed-migration guard, staging approval
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { setup } = require('./helpers');
const { checkMigrations } = require('../scripts/checkMigrations');
const { runMigrations } = require('../scripts/migrate');

let ctx;
test.before(async () => { ctx = await setup(); });
test.after(async () => { delete process.env.APP_ENV; await ctx.close(); });

test('version and release notes are public (sign-in screen)', async () => {
  const info = (await ctx.api('GET', '/app-info', undefined, null)).body;
  assert.match(info.version, /^\d+\.\d+\.\d+$/);
  assert.strictEqual(info.version, JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'version.json'), 'utf8')).version);
  const notes = (await ctx.api('GET', '/release-notes', undefined, null)).body.notes;
  const mine = notes.find((n) => n.version === info.version);
  assert.ok(mine, 'RELEASE_NOTES.md has a section for the current version');
  assert.ok(notes.every((n, i) => i === 0 || n.version < notes[i - 1].version || n.version.length !== notes[i - 1].version.length), 'newest first');
  assert.ok(mine.sections.some((s) => s.title === 'Bug fixes' && s.items.length));
});

test('migration check: the shipped migrations are add-only; destructive SQL is blocked unless justified', () => {
  const real = checkMigrations();
  assert.deepStrictEqual(real.problems, []);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
  try {
    fs.writeFileSync(path.join(dir, '001_ok.sql'), "CREATE TABLE t (id INT);\n-- DROP TABLE t (only a comment)\nCREATE FUNCTION f() RETURNS trigger AS $$ BEGIN UPDATE t SET id = 1; RETURN NEW; END $$ LANGUAGE plpgsql;\nINSERT INTO t VALUES (1); -- 'DELETE FROM t' in a string is fine\n");
    fs.writeFileSync(path.join(dir, '002_bad.sql'), 'ALTER TABLE fa_records DROP COLUMN narration;\nDELETE FROM qty_lines;\n');
    fs.writeFileSync(path.join(dir, '003_reviewed.sql'), '-- allow-data-change: fills the new column\nUPDATE fa_records SET x = 1;\n');
    const r = checkMigrations(dir);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.problems.length, 1);
    assert.match(r.problems[0], /002_bad\.sql: drops a column, deletes rows/);
    assert.match(r.reviewed[0], /003_reviewed\.sql: rewrites existing rows - fills the new column/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an already-applied migration that was edited stops the update', async () => {
  const { rows } = await ctx.pool.query("SELECT checksum FROM schema_migrations WHERE filename = '001_initial.sql'");
  assert.match(rows[0].checksum, /^[0-9a-f]{64}$/);
  await ctx.pool.query("UPDATE schema_migrations SET checksum = repeat('0', 64) WHERE filename = '001_initial.sql'");
  await assert.rejects(runMigrations(ctx.pool, { log: () => {} }), /001_initial\.sql\. Never edit an applied migration/);
  await ctx.pool.query("UPDATE schema_migrations SET checksum = $1 WHERE filename = '001_initial.sql'", [rows[0].checksum]);
  assert.deepStrictEqual(await runMigrations(ctx.pool, { log: () => {} }), []);
});

test('Releases: approval only on staging, for the running version, with a test note', async () => {
  const { version } = (await ctx.api('GET', '/app-info', undefined, null)).body;
  await ctx.pool.query("INSERT INTO app_releases (version, environment, deployed_by) VALUES ($1, 'staging', 'deploy script')", [version]);
  const notStaging = await ctx.api('POST', `/releases/${version}/approve`, { note: 'tested' });
  assert.match(notStaging.body.message, /approved on the Staging \(SP\) environment/);

  process.env.APP_ENV = 'staging';
  assert.strictEqual((await ctx.api('GET', '/app-info', undefined, null)).body.environmentLabel, 'Staging (SP)');
  assert.match((await ctx.api('POST', '/releases/9.9.9/approve', { note: 'tested' })).body.message, /Only the version running here/);
  assert.match((await ctx.api('POST', `/releases/${version}/approve`, { note: '' })).body.message, /Write what was tested/);
  const ok = await ctx.api('POST', `/releases/${version}/approve`, { note: 'Qty Plotting and exports checked with users' });
  assert.strictEqual(ok.status, 200, ok.body.message);
  assert.match((await ctx.api('POST', `/releases/${version}/approve`, { note: 'again' })).body.message, /already approved/);
  const list = (await ctx.api('GET', '/releases')).body;
  assert.deepStrictEqual([list.releases[0].approvedBy, list.releases[0].approvalNote], ['Administrator', 'Qty Plotting and exports checked with users']);
  delete process.env.APP_ENV;
});
