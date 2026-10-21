// Year-End Archive: preview checks, backup + copy + check + delete, masters
// untouched, archived months locked, view / export, restore exactly as before
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-archive-test-'));
process.env.BACKUP_DIR = backupDir;
const { setup, line, newFA, plot } = require('./helpers');

let ctx;
let userToken;
test.before(async () => {
  ctx = await setup();
  await ctx.api('POST', '/users', { username: 'clerk.a', password: 'pw', name: 'Clerk' });
  userToken = await ctx.login('clerk.a', 'pw');
});
test.after(async () => { await ctx.close(); fs.rmSync(backupDir, { recursive: true, force: true }); });

const q1 = async (sql, p = []) => (await ctx.pool.query(sql, p)).rows[0];
const count = async (tbl, where = 'TRUE', p = []) => (await q1(`SELECT COUNT(*)::int AS n FROM ${tbl} WHERE ${where}`, p)).n;
const MASTERS = ['branch_master', 'category_master', 'description_master', 'po_master', 'client_cc_master', 'ledgers', 'products', 'users', 'fa_code_counters'];
const masterCounts = async () => Object.fromEntries(await Promise.all(MASTERS.map(async (t) => [t, await count(t)])));

test('Year-End Archive: archive FY 2025-26, view it, restore it exactly', async () => {
  // masters
  await ctx.api('POST', '/masters/branch', { 'Cost Center': 'CC-1', Branch: 'Whitefield', 'Branch Code': 'BLR01', Location: 'Bengaluru' });
  await ctx.api('POST', '/masters/po', { 'PO No': 'PO-1', 'Client As Per PO': 'Acme' });
  await ctx.api('POST', '/ledgers', { expenseHead: 'Furniture', mapping: 'Taggable', active: 'Yes' });

  // FY 2025-26 data (May, Jun 2025), a month before it (Mar 2025) and one in the current FY
  const a = await newFA(ctx, { invNo: 'A-1', date: '2025-05-10', bookMonth: '2025-05', amount: 1000 });
  const b = await newFA(ctx, { invNo: 'A-2', date: '2025-06-02', bookMonth: '2025-06', amount: 600 });
  const c = await newFA(ctx, { invNo: 'A-3', date: '2025-06-03', bookMonth: '2025-06', amount: -100 });
  const before = await newFA(ctx, { invNo: 'OLD-1', date: '2025-03-05', bookMonth: '2025-03', amount: 50 });
  const now = await newFA(ctx, { invNo: 'NOW-1', date: '2026-05-05', bookMonth: '2026-05', amount: 70 });
  await plot(ctx, a, [line({ productAmount: 400 }), line({ product: 'Chair', productAmount: 600 })]);
  await plot(ctx, b, [line({ productAmount: 600 })]);
  await plot(ctx, c, [], { againstInvoiceNo: 'A-1', againstAssetCode: a });
  const rec = (await ctx.api('GET', `/fa/${b}`)).body;
  await ctx.api('PUT', `/fa/${b}`, { ...rec.raw, date: '2025-06-02', vendor: 'Edited Vendor', products: rec.products }); // change history
  await ctx.upload('/lwm/upload', [['Expanse Head', 'Amount'], ['Computers', '1500']], ctx.adminToken, 'l.xlsx', { month: '2025-06' });

  // preview: not finalized yet; current FY refused; users not allowed
  let pre = (await ctx.api('POST', '/archive/preview', { fromMonth: '2025-04', toMonth: '2026-03' })).body;
  assert.deepStrictEqual([pre.ok, pre.label, pre.confirmText, pre.records, pre.lines], [false, 'FY 2025-26', 'ARCHIVE FY 2025-26', 3, 4]);
  assert.match(pre.problems.join(' '), /not finalized yet: May 2025 \(Open\), Jun 2025 \(Open\)/);
  const cur = (await ctx.api('POST', '/archive/preview', { fromMonth: '2026-04', toMonth: '2026-05' })).body;
  assert.match(cur.problems.join(' '), /Only months before the current financial year/);
  assert.strictEqual((await ctx.api('POST', '/archive/preview', { fromMonth: '2025-04', toMonth: '2026-03' }, userToken)).status, 403);

  // close the months (as Month-wise Data would) and keep some month history
  await ctx.pool.query("UPDATE month_periods SET status = 'Finalized', version = 1, finalized_by = 'Admin' WHERE book_month IN ('2025-03', '2025-05', '2025-06')");
  await ctx.pool.query("INSERT INTO month_events (book_month, action, status_from, status_to, name) VALUES ('2025-06', 'Finalized', 'Open', 'Finalized', 'Admin')");
  pre = (await ctx.api('POST', '/archive/preview', { fromMonth: '2025-04', toMonth: '2026-03' })).body;
  assert.deepStrictEqual([pre.ok, pre.amount, pre.months.map((m) => m.month)], [true, 1500, ['2025-05', '2025-06']]);

  const mastersBefore = await masterCounts();
  const snapshot = await q1("SELECT to_jsonb(f) AS j FROM fa_records f WHERE fa_code = $1", [b]);
  const linesBefore = await count('qty_lines');

  // wrong confirmation: nothing happens
  const wrong = await ctx.api('POST', '/archive', { fromMonth: '2025-04', toMonth: '2026-03', confirm: 'yes' });
  assert.deepStrictEqual([wrong.status, wrong.body.message], [400, 'Type ARCHIVE FY 2025-26 to confirm.']);
  assert.strictEqual(await count('fa_records', "book_month BETWEEN '2025-04' AND '2026-03'"), 3);

  // archive
  const done = await ctx.api('POST', '/archive', { fromMonth: '2025-04', toMonth: '2026-03', confirm: 'archive fy 2025-26' });
  assert.strictEqual(done.status, 200, done.body.message);
  assert.match(done.body.message, /FY 2025-26 archived: 3 record\(s\) and 4 line\(s\)/);
  for (const [tbl, where] of [['fa_records', "book_month BETWEEN '2025-04' AND '2026-03'"], ['lwm_tally', "book_month = '2025-06'"],
    ['month_periods', "book_month IN ('2025-05', '2025-06')"], ['month_events', "book_month = '2025-06'"], ['change_history', 'fa_code = $1']]) {
    assert.strictEqual(await count(tbl, where, tbl === 'change_history' ? [b] : []), 0, tbl);
  }
  assert.strictEqual(await count('qty_lines'), linesBefore - 4);
  assert.deepStrictEqual(await masterCounts(), mastersBefore, 'masters unchanged');
  assert.strictEqual(await count('fa_records', 'fa_code = ANY($1)', [[before, now]]), 2, 'other months untouched');
  const list = (await ctx.api('GET', '/archive')).body;
  const run = list.runs[0];
  assert.deepStrictEqual([run.status, run.records, run.lines, run.amount, run.tableCounts.change_history > 0], ['archived', 3, 4, 1500, true]);
  assert.ok(fs.existsSync(run.backupFile) && run.backupBytes > 0, 'backup file written');
  assert.match((await q1("SELECT details FROM activity_log WHERE action = 'Year-End Archive' ORDER BY log_id DESC LIMIT 1")).details, /FY 2025-26: 3 record/);

  // archived months cannot be booked into or archived again
  const blocked = await ctx.api('POST', '/fa', { invNo: 'X', date: '2025-05-20', poNo: 'P', costCenter: 'C', amount: 5, vendor: 'V', expenseHead: 'E', bookMonth: '2025-05' });
  assert.match(blocked.body.message, /May 2025 is archived \(Year-End Archive: FY 2025-26\)/);
  assert.match((await ctx.api('POST', '/archive/preview', { fromMonth: '2025-06', toMonth: '2025-06' })).body.problems.join(' '), /already archived/);

  // view, details, export from the archive database
  const page = (await ctx.api('GET', `/archive/${run.runId}/records?size=2`)).body;
  assert.deepStrictEqual([page.total, page.rows.map((r) => r.invNo)], [3, ['A-1', 'A-2']]);
  assert.deepStrictEqual((await ctx.api('GET', `/archive/${run.runId}/records?search=edited%20vendor`)).body.rows.map((r) => r.faCode), [b]);
  const detail = (await ctx.api('GET', `/archive/${run.runId}/records/${a}`)).body;
  assert.deepStrictEqual(detail.products.map((p) => [p.product, p.productAmount]), [['Laptop', 400], ['Chair', 600]]);
  assert.ok((await ctx.api('GET', `/archive/${run.runId}/records/${b}`)).body.history.some((h) => h.field === 'Vendor' && h.newValue === 'Edited Vendor'));
  const exp = await ctx.download(`/archive/${run.runId}/export`);
  assert.strictEqual(exp.status, 200);
  assert.deepStrictEqual(exp.rows.slice(1).map((r) => r[1]), ['A-1', 'A-1', 'A-2', 'A-3']);

  // restore: wrong confirmation, then exactly as before
  assert.strictEqual((await ctx.api('POST', `/archive/${run.runId}/restore`, { confirm: 'x' })).body.message, 'Type RESTORE FY 2025-26 to confirm.');
  const back = await ctx.api('POST', `/archive/${run.runId}/restore`, { confirm: 'RESTORE FY 2025-26' });
  assert.strictEqual(back.status, 200, back.body.message);
  assert.deepStrictEqual((await q1("SELECT to_jsonb(f) AS j FROM fa_records f WHERE fa_code = $1", [b])).j, snapshot.j, 'record identical');
  assert.strictEqual(await count('qty_lines'), linesBefore);
  assert.strictEqual(await count('change_history', 'fa_code = $1', [b]) > 0, true);
  assert.deepStrictEqual((await q1("SELECT status FROM month_periods WHERE book_month = '2025-06'")).status, 'Finalized');
  assert.strictEqual(await count('lwm_tally', "book_month = '2025-06'"), 1);
  assert.strictEqual((await ctx.api('GET', '/archive')).body.runs[0].status, 'restored');
  assert.strictEqual((await ctx.api('GET', `/archive/${run.runId}/records`)).status, 409); // archive copy removed after restore
  assert.match((await q1("SELECT details FROM activity_log WHERE action = 'Archive Restored' ORDER BY log_id DESC LIMIT 1")).details, /3 record/);
  // Qty Plotting still works on restored data views
  assert.strictEqual((await ctx.api('GET', `/fa/${a}`)).body.products.length, 2);
});
