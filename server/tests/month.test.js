// Month-wise close: Tally booking month, locks, finalize checks, versions,
// changes-only FAMS file, re-open, FAMS upload, change history
const test = require('node:test');
const assert = require('node:assert');
const { setup, faBody, line, newFA, plot } = require('./helpers');
const { parseMonth } = require('../utils/months');

let ctx;
let userToken;
test.before(async () => {
  ctx = await setup();
  // masters so the FAMS rows of CC-M / PO-M / Laptop have no Error Remark
  await ctx.api('POST', '/masters/po', { 'PO No': 'PO-M', 'PO Date': '01/09/2026', 'Client As Per PO': 'Acme', 'Client As Per PMO': 'Acme Corp', Status: 'Active' });
  await ctx.api('POST', '/masters/clientcc', { 'Client As Per PMO': 'Acme Corp', 'Cost Center': 'CC-M', Status: 'Active' });
  await ctx.api('POST', '/masters/branch', { 'Cost Center': 'CC-M', Branch: 'Whitefield', 'Branch Code': 'BLR01', Location: 'Bengaluru' });
  await ctx.upload('/masters/category/bulk-upload', [['Expense Head', 'Asset Category Level I', 'Asset Category Level II'], ['Computers', 'IT Assets', 'Laptops']]);
  for (const p of ['Laptop', 'Monitor']) {
    await ctx.api('POST', '/masters/description', { 'Product / Asset Description': p, 'Expense Head': 'Computers', AssetDescriptionTwo: p, 'Asset Category Level II': 'Laptops' });
  }
  await ctx.api('POST', '/users', { username: 'maker', password: 'pw', name: 'Maker', role: 'User' });
  userToken = await ctx.login('maker', 'pw');
});
test.after(async () => { await ctx.close(); });

const M = (o) => faBody({ poNo: 'PO-M', costCenter: 'CC-M', expenseHead: 'Computers', ...o });
const tally = (month, rows) => ctx.upload('/lwm/upload', [['Expanse Head', 'Amount'], ...rows], ctx.adminToken, 'lwm.xlsx', { month });

test('month text is read in the usual ways', () => {
  assert.deepStrictEqual(['Oct-2026', 'October 2026', 'oct 26', '10/2026', '2026-10', '15/10/2026', 'Sept-2026', 'x', '13/2026'].map(parseMonth),
    ['2026-10', '2026-10', '2026-10', '2026-10', '2026-10', '2026-10', '2026-09', null, null]);
});

test('Tally Booking Month: given, from the upload screen, or the invoice month; FA Code stays by invoice date', async () => {
  const a = await ctx.api('POST', '/fa', M({ invNo: 'BM-1', date: '2026-08-28', bookMonth: 'Sep-2026', amount: 1000 }));
  assert.strictEqual(a.body.faCode, 'AUG20260001');
  const rec = (await ctx.api('GET', `/fa/${a.body.faCode}`)).body.raw;
  assert.deepStrictEqual([rec.bookMonth, rec.bookMonthLabel, rec.monthStatus], ['2026-09', 'Sep 2026', 'Open']);
  const bad = await ctx.api('POST', '/fa', M({ invNo: 'BM-2', bookMonth: 'Smarch' }));
  assert.match(bad.body.message, /Tally Booking Month 'Smarch' is invalid/);

  const up = await ctx.upload('/fa/bulk-upload', [
    ['Inv No', 'Date', 'PO No', 'Cost Center', 'Amount', 'Vendor', 'Expense Head', 'Narration', 'Tally Booking Month'],
    ['BU-1', '20/09/2026', 'PO-M', 'CC-M', '500', 'V', 'Computers', '', ''],
    ['BU-2', '20/09/2026', 'PO-M', 'CC-M', '700', 'V', 'Computers', '', 'Nov-2026'],
    ['BU-3', '20/09/2026', 'PO-M', 'CC-M', '700', 'V', 'Computers', '', 'nope'],
  ], ctx.adminToken, 'b.xlsx', { bookMonth: '2026-09' });
  assert.strictEqual(up.body.saved, 2, JSON.stringify(up.body));
  assert.match(up.body.errors[0], /Row 4: Tally Booking Month 'nope' is invalid/);
  const months = Object.fromEntries((await ctx.api('GET', '/fa')).body.map((r) => [r.invNo, r.bookMonth]));
  assert.deepStrictEqual([months['BU-1'], months['BU-2']], ['2026-09', '2026-11']);
});

test('finalize: checks must pass; a Tally difference needs a remark; users cannot finalize', async () => {
  const month = '2026-09';
  let d = (await ctx.api('GET', `/months/${month}`)).body;
  const check = (id) => d.checks.find((c) => c.id === id);
  assert.deepStrictEqual([d.status, check('pending').ok, check('tally').ok], ['Open', false, false]);

  const early = await ctx.api('POST', `/months/${month}/finalize`, {});
  assert.strictEqual(early.status, 409);
  assert.match(early.body.message, /still pending Qty Plotting/);
  assert.strictEqual((await ctx.api('POST', `/months/${month}/finalize`, {}, userToken)).status, 403);

  for (const r of (await ctx.api('GET', '/fa')).body.filter((x) => x.bookMonth === month)) {
    await plot(ctx, r.faCode, [line({ productAmount: r.amount })]);
  }
  await tally(month, [['Computers', '1400']]); // FA 1500
  d = (await ctx.api('GET', `/months/${month}`)).body;
  assert.deepStrictEqual([check('pending').ok, check('fams').ok, check('tally').ok], [true, true, false], JSON.stringify(d.checks));
  const noRemark = await ctx.api('POST', `/months/${month}/finalize`, {});
  assert.match(noRemark.body.message, /Enter a remark to finalize with this difference/);

  // a user submits; the month is then locked for users, not for Admin
  const sub = await ctx.api('POST', `/months/${month}/submit`, undefined, userToken);
  assert.strictEqual(sub.status, 200, sub.body.message);
  const userEdit = await ctx.api('POST', '/fa', M({ invNo: 'LATE-1', bookMonth: month }), userToken);
  assert.match(userEdit.body.message, /Sep 2026 is under review and locked/);
  await tally(month, [['Computers', '1500']]); // Admin may still correct the Tally upload
  d = (await ctx.api('GET', `/months/${month}`)).body;
  assert.strictEqual(check('tally').ok, true);

  const fin = await ctx.api('POST', `/months/${month}/finalize`, {});
  assert.strictEqual(fin.status, 200, fin.body.message);
  assert.strictEqual(fin.body.version, 1);
  d = (await ctx.api('GET', `/months/${month}`)).body;
  assert.deepStrictEqual([d.status, d.version, d.versions.length, d.versions[0].lines], ['Finalized', 1, 1, 2]);
  assert.deepStrictEqual(d.events.map((e) => e.action), ['Finalized', 'Submitted']);
  const file = await ctx.download(`/months/${month}/versions/1/fams`);
  assert.strictEqual(file.rows.length, 3); // header + 2 lines
  assert.match(file.headers.get('content-disposition'), /FAMS_Sep_2026_v1\.xlsx/);
});

test('finalized month: locked for everyone, everywhere', async () => {
  const fa = (await ctx.api('GET', '/fa')).body.find((r) => r.invNo === 'BU-1');
  assert.strictEqual(fa.monthStatus, 'Finalized');
  const rec = (await ctx.api('GET', `/fa/${fa.faCode}`)).body;
  const tries = [
    await ctx.api('POST', '/fa', M({ invNo: 'NEW', bookMonth: '2026-09' })),
    await ctx.api('PUT', `/fa/${fa.faCode}`, { ...rec.raw, date: '2026-09-20', products: rec.products }),
    await ctx.api('DELETE', `/fa/${fa.faCode}`),
    await ctx.api('POST', '/fa-bulk-delete', { faCodes: [fa.faCode], mode: 'qty' }),
    await tally('2026-09', [['Computers', '1']]),
    await ctx.api('DELETE', '/lwm?month=2026-09'),
    await ctx.api('POST', '/fa', M({ invNo: 'OLD', bookMonth: '2026-08' })), // before the last finalized month
  ];
  tries.forEach((r, i) => assert.strictEqual(r.status, 409, `attempt ${i}: ${r.body.message}`));
  assert.match(tries[6].body.message, /Aug 2026 is before the last finalized month \(Sep 2026\)/);

  const exp = await ctx.download('/fa/export');
  const rows = exp.rows.filter((r) => r[1] === 'BU-1');
  const edited = [exp.rows[0], ...rows.map((r) => r.map((v, c) => (c === 7 ? 'Changed Vendor' : v)))];
  const be = await ctx.upload('/fa/bulk-edit', edited);
  assert.strictEqual(be.body.updatedRaw, 0);
  assert.match(be.body.errors[0], /Sep 2026 is finalized/);
  // Finalized months are not in the Qty Plotting queue
  assert.ok((await ctx.api('GET', '/qty/pending')).body.records.every((r) => r.bookMonth !== '2026-09'));
});

test('FAMS uploaded, re-open with a reason, corrections in history, changes-only file', async () => {
  const month = '2026-09';
  assert.match((await ctx.api('POST', `/months/${month}/fams-uploaded`, {})).body.message, /FAMS upload reference/);
  const up = await ctx.api('POST', `/months/${month}/fams-uploaded`, { reference: 'FAMS-B-77', uploadedOn: '2026-10-05' });
  assert.strictEqual(up.status, 200, up.body.message);
  let d = (await ctx.api('GET', `/months/${month}`)).body;
  assert.deepStrictEqual([d.status, d.famsReference, d.famsUploadedOn], ['FAMS Uploaded', 'FAMS-B-77', '05/10/2026']);

  assert.match((await ctx.api('POST', `/months/${month}/reopen`, { reason: 'x' })).body.message, /reason for re-opening/);
  assert.strictEqual((await ctx.api('POST', `/months/${month}/reopen`, { reason: 'Wrong qty on BU-1' }, userToken)).status, 403);
  const re = await ctx.api('POST', `/months/${month}/reopen`, { reason: 'Wrong qty on BU-1' });
  assert.strictEqual(re.status, 200, re.body.message);

  // correction: BU-1 gets two products instead of one; BM-1's vendor changes
  const all = (await ctx.api('GET', '/fa')).body;
  const bu1 = all.find((r) => r.invNo === 'BU-1');
  const bm1 = all.find((r) => r.invNo === 'BM-1');
  const r1 = (await ctx.api('GET', `/fa/${bu1.faCode}`)).body;
  const fix = await ctx.api('PUT', `/fa/${bu1.faCode}`, {
    ...r1.raw, date: '2026-09-20', products: [line({ productAmount: 300 }), line({ product: 'Monitor', productAmount: 200 })],
  });
  assert.strictEqual(fix.status, 200, fix.body.message);
  const r2 = (await ctx.api('GET', `/fa/${bm1.faCode}`)).body;
  await ctx.api('PUT', `/fa/${bm1.faCode}`, { ...r2.raw, date: '2026-08-28', vendor: 'Better Vendor', products: r2.products });

  const hist = (await ctx.api('GET', `/history/${bu1.faCode}`)).body;
  assert.ok(hist.some((h) => h.field === 'Line 1 Product Amount' && h.oldValue === '500.00' && h.newValue === '300.00'), JSON.stringify(hist));
  assert.ok(hist.some((h) => h.field === 'Line 2' && h.oldValue === '(added)'));
  assert.strictEqual((await ctx.api('GET', `/history/${bu1.faCode}`, undefined, userToken)).status, 403);

  const fin = await ctx.api('POST', `/months/${month}/finalize`, {});
  assert.strictEqual(fin.status, 200, fin.body.message);
  assert.strictEqual(fin.body.version, 2);
  // BU-1 line 1 changed amount, BU-1 line 2 added, BM-1 line vendor changed
  assert.strictEqual(fin.body.changes, 3);
  const ch = await ctx.download(`/months/${month}/versions/2/changes`);
  const [head, ...rows] = ch.rows;
  assert.deepStrictEqual(head.slice(0, 2), ['Change Type', 'Changed Fields']);
  assert.deepStrictEqual(rows.map((r) => r[0]).sort(), ['Added', 'Changed', 'Changed']);
  assert.ok(rows.some((r) => r[0] === 'Changed' && r[1] === 'Vendor'));
  assert.ok(rows.some((r) => r[0] === 'Changed' && /Amount\*/.test(r[1])));
  assert.strictEqual((await ctx.download(`/months/${month}/versions/1/changes`)).status, 404);

  d = (await ctx.api('GET', `/months/${month}`)).body;
  assert.deepStrictEqual(d.versions.map((v) => [v.version, v.changes]), [[2, 3], [1, 0]]);
  assert.ok(d.changeHistory.length >= 3);
  assert.deepStrictEqual(d.events.map((e) => e.action).slice(0, 3), ['Finalized', 'Re-opened', 'FAMS Uploaded']);
});

test('a month finalized before snapshots existed gets its copy when re-opened', async () => {
  await ctx.api('POST', '/fa', M({ invNo: 'LEG-1', date: '2026-11-03', bookMonth: '2026-11', amount: 400 }));
  for (const r of (await ctx.api('GET', '/fa')).body.filter((x) => x.bookMonth === '2026-11')) await plot(ctx, r.faCode, [line({ productAmount: r.amount })]);
  // as the migration does for older months: Finalized, version 1, no snapshot
  await ctx.pool.query("UPDATE month_periods SET status = 'Finalized', version = 1 WHERE book_month = '2026-11'");
  const re = await ctx.api('POST', '/months/2026-11/reopen', { reason: 'Correct LEG-1 amount' });
  assert.strictEqual(re.status, 200, re.body.message);
  const d = (await ctx.api('GET', '/months/2026-11')).body;
  assert.deepStrictEqual(d.versions.map((v) => [v.version, v.kind, v.lines]), [[1, 'baseline', 2]]);
});

test('booking months offered, and month list', async () => {
  const b = (await ctx.api('GET', '/months/booking', undefined, userToken)).body;
  assert.ok(b.months.every((m) => m.status === 'Open'));
  assert.ok(!b.months.some((m) => m.month === '2026-09'));
  assert.strictEqual(b.lastClosed, '2026-09');
  const list = (await ctx.api('GET', '/months')).body.months;
  assert.deepStrictEqual(list.find((m) => m.month === '2026-09').status, 'Finalized');
});

test('Period Reports: one month for users, several months for Admin only; by Tally month', async () => {
  const one = await ctx.api('GET', '/reports/period?fromMonth=2026-09&toMonth=2026-09', undefined, userToken);
  assert.strictEqual(one.status, 200);
  const recs = (await ctx.api('GET', '/reports/period/records?fromMonth=2026-09&toMonth=2026-09', undefined, userToken)).body;
  assert.deepStrictEqual(recs.rows.map((r) => r.invNo).sort(), ['BM-1', 'BU-1']);
  assert.strictEqual((await ctx.api('GET', '/reports/period/records?fromMonth=2026-04&toMonth=2027-03', undefined, userToken)).status, 403); // invoice in Aug, booked Sep
  const many = await ctx.api('GET', '/reports/period?fromMonth=2026-04&toMonth=2027-03', undefined, userToken);
  assert.deepStrictEqual([many.status, many.body.message], [403, 'Only Admin can view consolidated reports for several months.']);
  assert.strictEqual((await ctx.api('GET', '/reports/period?fromMonth=2026-04&toMonth=2027-03')).status, 200);
});
