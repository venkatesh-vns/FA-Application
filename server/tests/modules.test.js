// Masters, LWM, dashboard, FAMS Template, import
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const ExcelJS = require('exceljs');
const { setup, faBody, line, newFA, plot } = require('./helpers');

let ctx;
test.before(async () => { ctx = await setup(); });
test.after(async () => { await ctx.close(); });

test('Masters: definitions, save / update / delete, Description rule', async () => {
  const defs = (await ctx.api('GET', '/masters')).body;
  assert.deepStrictEqual(defs.map((d) => d.type), ['branch', 'category', 'description', 'po', 'clientcc']);
  assert.strictEqual(defs.find((d) => d.type === 'po').title, 'PO Client Master');
  assert.strictEqual((await ctx.api('GET', '/masters/client')).body.message, 'Invalid Master type.');
  assert.deepStrictEqual(defs.find((d) => d.type === 'branch').headers, ['Cost Center', 'Branch', 'Branch Code', 'Location']);

  const missing = await ctx.api('POST', '/masters/po', { 'PO Date': 'X' });
  assert.strictEqual(missing.body.message, 'PO No is required.');
  assert.strictEqual((await ctx.api('POST', '/masters/po', { 'PO No': 'PO-A', Status: 'Active' })).body.message, 'Record created.');
  const [poA] = (await ctx.api('GET', '/masters/po')).body;
  const upd = await ctx.api('POST', '/masters/po', { ...poA, 'Client As Per PO': 'Acme' });
  assert.strictEqual(upd.body.message, 'Record updated.');
  assert.strictEqual((await ctx.api('GET', '/masters/po')).body[0]['Client As Per PO'], 'Acme');

  await ctx.api('POST', '/masters/description', { 'Product / Asset Description': 'Laptop', 'Expense Head': 'Computers', AssetDescriptionOne: 'ignored' });
  assert.strictEqual((await ctx.api('GET', '/masters/description')).body[0].AssetDescriptionOne, 'Computers');

  const del = await ctx.api('DELETE', `/masters/po/${poA.row}`);
  assert.strictEqual(del.body.message, 'Record deleted.');
  assert.strictEqual((await ctx.api('GET', '/masters/nope')).body.message, 'Invalid Master type.');
});

test('Masters: bulk upload is additive and needs the exact headers; bulk edit by Row Number', async () => {
  const wrong = await ctx.upload('/masters/category/bulk-upload', [['Expense Head', 'Level 1']]);
  assert.strictEqual(wrong.body.message, 'Invalid headers. Expected: Expense Head, Asset Category Level I, Asset Category Level II');
  const up = await ctx.upload('/masters/category/bulk-upload', [
    ['Expense Head', 'Asset Category Level I', 'Asset Category Level II'],
    ['Computers', 'IT Assets', 'Laptops'], ['', 'skip', ''], ['Furniture', 'F&F', ''],
  ]);
  assert.strictEqual(up.body.message, '2 new master record(s) added. Existing records were retained.');
  const again = await ctx.upload('/masters/category/bulk-upload', [['Expense Head', 'Asset Category Level I', 'Asset Category Level II'], ['Vehicles', 'Vehicles', '']]);
  assert.strictEqual(again.status, 200);
  assert.strictEqual((await ctx.api('GET', '/masters/category')).body.length, 3);

  const exp = await ctx.download('/masters/category/export');
  assert.deepStrictEqual(exp.rows[0], ['Row Number', 'Expense Head', 'Asset Category Level I', 'Asset Category Level II']);
  const edited = exp.rows.map((r, i) => (i === 2 ? [r[0], r[1], r[2], 'Chairs'] : r));
  const res = await ctx.upload('/masters/category/bulk-edit', [...edited, ['0', 'x', '', '']]);
  assert.strictEqual(res.body.updated, 3);
  assert.deepStrictEqual(res.body.errors, ['File row 5: invalid Row Number.']);
  assert.strictEqual((await ctx.api('GET', '/masters/category')).body[1]['Asset Category Level II'], 'Chairs');
});

test('PO Client Master: Cost Center via Export + Bulk Edit; older files without it still work', async () => {
  const OLD = ['PO No', 'PO Date', 'Client As Per PO', 'Client As Per PMO', 'Status'];
  const NEW = ['PO No', 'PO Date', 'Client As Per PO', 'Client As Per PMO', 'Cost Center', 'Status'];
  assert.deepStrictEqual((await ctx.api('GET', '/masters')).body.find((d) => d.type === 'po').headers, NEW);

  // a template saved before the column existed: added with a blank Cost Center
  const old = await ctx.upload('/masters/po/bulk-upload', [OLD, ['CC-PO-1', '01/04/2026', 'Acme', 'Acme Corp', 'Active'], ['CC-PO-2', '', 'Beta', 'Beta Ltd', 'Active']]);
  assert.strictEqual(old.status, 200, old.body.message);
  const added = (await ctx.api('GET', '/masters/po')).body.filter((r) => r['PO No'].startsWith('CC-PO-'));
  assert.deepStrictEqual(added.map((r) => [r['PO No'], r['Cost Center'], r.Status]), [['CC-PO-1', '', 'Active'], ['CC-PO-2', '', 'Active']]);

  // Export Master has the column; the user fills it and uploads with Bulk Edit
  const exp = await ctx.download('/masters/po/export');
  assert.deepStrictEqual(exp.rows[0], ['Row Number', ...NEW]);
  const filled = exp.rows.map((r, i) => (i && String(r[1]).startsWith('CC-PO-') ? [...r.slice(0, 5), `CC-${r[1].slice(-1)}00`, r[6]] : r));
  const edit = await ctx.upload('/masters/po/bulk-edit', filled);
  assert.strictEqual(edit.status, 200, edit.body.message);
  assert.deepStrictEqual(edit.body.errors, []);
  let po = (await ctx.api('GET', '/masters/po')).body.filter((r) => r['PO No'].startsWith('CC-PO-'));
  assert.deepStrictEqual(po.map((r) => [r['Cost Center'], r['Client As Per PMO'], r.Status]), [['CC-100', 'Acme Corp', 'Active'], ['CC-200', 'Beta Ltd', 'Active']]);

  // an export saved before the column existed: other columns change, the Cost Center stays
  const oldExport = [['Row Number', ...OLD], [po[0].row, 'CC-PO-1', '01/04/2026', 'Acme', 'Acme Corp', 'Inactive']];
  assert.strictEqual((await ctx.upload('/masters/po/bulk-edit', oldExport)).body.updated, 1);
  po = (await ctx.api('GET', '/masters/po')).body.filter((r) => r['PO No'] === 'CC-PO-1');
  assert.deepStrictEqual([po[0]['Cost Center'], po[0].Status], ['CC-100', 'Inactive']);

  // Add / Edit form
  await ctx.api('POST', '/masters/po', { ...po[0], 'Cost Center': 'CC-900' });
  assert.strictEqual((await ctx.api('GET', '/masters/po')).body.find((r) => r['PO No'] === 'CC-PO-1')['Cost Center'], 'CC-900');
  // wrong headers are still refused
  const wrong = await ctx.upload('/masters/po/bulk-edit', [['Row Number', 'PO No', 'Cost Center'], ['1', 'x', 'y']]);
  assert.match(wrong.body.message, /Invalid Master export headers/);
});

test('LWM: per Tally month; upload replaces that month only; FA - Tally per expense head', async () => {
  await newFA(ctx, { invNo: 'L-1', expenseHead: 'Computers', amount: 1000 });
  await newFA(ctx, { invNo: 'L-2', expenseHead: 'computers', amount: 500 });
  await newFA(ctx, { invNo: 'L-3', expenseHead: 'Vehicles', amount: 300 });
  const up = (rows, month = '2026-09') => ctx.upload('/lwm/upload', rows, ctx.adminToken, 'lwm.xlsx', { month });
  const empty = (await ctx.api('GET', '/lwm?month=2026-09')).body;
  assert.deepStrictEqual([empty.hasTallyData, empty.monthLabel], [false, 'Sep 2026']);

  const missing = await up([['Ledger', 'Amount'], ['x', '1']]);
  assert.strictEqual(missing.body.message, 'Missing column: Expanse Head');
  const noMonth = await ctx.upload('/lwm/upload', [['Expanse Head', 'Amount'], ['Old', '1']]);
  assert.strictEqual(noMonth.body.message, 'Choose the Tally Booking Month.');
  await up([['Expanse Head', 'Amount'], ['Old', '1']]);
  await up([['Expanse Head', 'Amount'], ['Other month', '9']], '2026-08');
  const ok = await up([['Expanse Head', 'Amount'], ['Computers', '1,500'], ['Furniture', '200'], ['', '5']]);
  assert.strictEqual(ok.body.message, '2 Tally row(s) uploaded for Sep 2026. The previous upload of that month was replaced.');
  assert.deepStrictEqual(ok.body.errors, ['Row 4: Expanse Head is blank.']);

  const cmp = (await ctx.api('GET', '/lwm?month=2026-09')).body;
  assert.deepStrictEqual(cmp.rows.map((r) => [r.expenseHead, r.faAmount, r.tallyAmount, r.difference, r.status]), [
    ['Computers', 1500, 1500, 0, 'Matched'],
    ['Furniture', 0, 200, -200, 'Difference'],
    ['Vehicles', 300, 0, 300, 'Difference'],
  ]);
  assert.deepStrictEqual([cmp.totalFA, cmp.totalTally, cmp.totalDifference, cmp.matched], [1800, 1700, 100, false]);
  assert.strictEqual((await ctx.api('GET', '/lwm?month=2026-08')).body.totalTally, 9); // other month untouched
  await ctx.api('DELETE', '/lwm?month=2026-09');
  assert.strictEqual((await ctx.api('GET', '/lwm?month=2026-09')).body.hasTallyData, false);
  assert.strictEqual((await ctx.api('GET', '/lwm?month=2026-08')).body.hasTallyData, true);
  await ctx.api('DELETE', '/lwm?month=2026-08');
});

test('Dashboard: totals, ledger and building summaries', async () => {
  await ctx.api('POST', '/masters/branch', { 'Cost Center': 'CC-1', Branch: 'Whitefield', 'Branch Code': 'BLR01', Location: 'Bengaluru' });
  const code = await newFA(ctx, { invNo: 'DB-1', amount: 3000, costCenter: 'CC-1' });
  await plot(ctx, code, [line({ quantity: 2, productAmount: 2000 }), line({ product: 'Cable', taggable: 'Non Taggable', productAmount: 1000 })]);
  const d = (await ctx.api('GET', '/dashboard')).body;
  assert.deepStrictEqual([d.totalFA, d.completedFA, d.pendingFA, d.totalAmount, d.plottedAmount], [4, 1, 3, 4800, 3000]);
  const tag = d.ledgerSummary.find((l) => l.type === 'Taggable');
  assert.deepStrictEqual([tag.costCenter, tag.ledger, tag.quantity, tag.amount, tag.products[0].product], ['CC-1', 'Computers', 2, 2000, 'Laptop']);
  assert.deepStrictEqual(d.buildingSummary.map((b) => [b.building, b.type, b.faCount]), [['Whitefield', 'Non-Taggable', 1], ['Whitefield', 'Taggable', 1]]);
});

test('FAMS Template: 91 columns, master lookups and Error Remark', async () => {
  await ctx.api('POST', '/masters/po', { 'PO No': 'PO-1', 'PO Date': '01/09/2026', 'Client As Per PO': 'Acme', 'Client As Per PMO': 'Acme Corp', Status: 'Active' });
  await ctx.api('POST', '/masters/clientcc', { 'Client As Per PMO': 'Acme Corp', 'Cost Center': 'CC-1', Status: 'Active' });
  await ctx.api('POST', '/masters/description', { 'Product / Asset Description': 'Laptop', 'Expense Head': 'Computers', AssetDescriptionTwo: 'Notebook', 'Asset Category Level II': 'Laptops' });
  const file = await ctx.download('/fams/template');
  assert.strictEqual(file.status, 200);
  const [head, ...rows] = file.rows;
  assert.strictEqual(head.length, 91); // as FAMS_TEMPLATE_HEADERS in Code.gs
  const col = (name) => head.indexOf(name);
  const laptop = rows.find((r) => r[col('Asset Description*')] === 'Laptop');
  assert.deepStrictEqual(
    ['Branch*', 'ClientName', 'Purchase Order Date', 'Asset Category Level I*', 'Asset Category Level II', 'AssetDescriptionTwo', 'Is Multiple Entries*', 'Physical Verification*', 'Consider Cost Per Qty for 100% Dep', 'TotalInvoiceAmount', 'Error Remark']
      .map((h) => laptop[col(h)]),
    ['BLR01', 'Acme Corp', '01/09/2026', 'IT Assets', 'Laptops', 'Notebook', 'Yes', 'Yes', 'Yes', '3000', ''] // line amount 2000 < 5000
  );
  const cable = rows.find((r) => r[col('Asset Description*')] === 'Cable');
  assert.strictEqual(cable[col('Error Remark')], 'Asset Description not found in Description Master');
  assert.strictEqual(cable[col('Consider Cost Per Qty for 100% Dep')], 'Yes');
});

test('Import from the Google Sheets workbook', async () => {
  const wb = new ExcelJS.Workbook();
  const add = (name, rows) => { const ws = wb.addWorksheet(name); rows.forEach((r) => ws.addRow(r)); };
  const d = (y, m, day, h = 0) => new Date(Date.UTC(y, m - 1, day, h));
  add('Raw Data', [
    ['FA Code', 'Inv No', 'Date', 'PO No', 'Cost Center', 'Amount', 'Vendor', 'Expense Head', 'Narration', 'Status', 'Created At', 'Updated At'],
    ['MAR20250007', 'I-7', d(2025, 3, 5), 'PO-1', 'CC-1', 1000, 'V', 'Computers', 'n', 'Completed', d(2025, 3, 6, 10), d(2025, 3, 6, 11)],
    ['MAR20250008', 'I-8', d(2025, 3, 6), 'PO-1', 'CC-1', 500, 'V', 'Computers', '', 'Pending', d(2025, 3, 6, 10), ''],
    ['BAD', 'I-9', d(2025, 3, 6), 'PO-1', 'CC-1', 500, 'V', 'Computers', '', 'Pending', '', ''],
  ]);
  add('Qty Plotting', [
    ['FA Code', 'Inv No', 'Expense Head', 'Vendor', 'Product', 'Quantity', 'Taggable', 'Unit Price', 'Product Amount', 'Against Invoice No', 'Against Asset Code', 'Created At', 'Updated At', 'GST %'],
    ['MAR20250007', 'I-7', 'Computers', 'V', 'Monitor', 2, 'Taggable', 500, 1000, '', '', d(2025, 3, 7, 9), d(2025, 3, 7, 9), 18],
  ]);
  add('Users', [['Username', 'Password', 'Name', 'Role', 'Active', 'Email ID', 'Department'], ['admin', 'x', 'A', 'Admin', 'Yes'], ['ravi', 'ravi@123', 'Ravi', 'User', 'Yes', 'r@x.com', 'Finance']]);
  add('Ledger Master', [['Expense Head', 'Mapping', 'Active'], ['Software', 'Non Taggable', 'Yes']]);
  add('Activity Log', [['Timestamp', 'Username', 'Name', 'Action', 'Module', 'FA Code', 'Inv No', 'Expense Head', 'Details'],
    [d(2025, 3, 7, 9), 'ravi', 'Ravi', 'Qty Plotting', 'Qty Plotting', 'MAR20250007', 'I-7', 'Computers', 'Qty Plotting created']]);
  add('PO Master', [['PO No', 'PO Date', 'Client As Per PO', 'Client As Per PMO', 'Status'], ['PO-1', d(2025, 2, 1), 'Acme', 'Acme Corp', 'Active']]);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-import-'));
  const file = path.join(dir, 'FA Management.xlsx');
  await wb.xlsx.writeFile(file);
  try {
    const run = (...args) => execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'importSheets.js'), `--file=${file}`, ...args], { env: process.env, encoding: 'utf8' });
    assert.match(run('--dry-run'), /Dry run/);
    assert.strictEqual((await ctx.api('GET', '/fa/MAR20250007')).status, 404);

    const out = run();
    assert.match(out, /"records": 2/);
    assert.match(out, /"users": 1/);
    assert.match(out, /FA Code 'BAD'/);
    const rec = (await ctx.api('GET', '/fa/MAR20250007')).body;
    assert.deepStrictEqual([rec.raw.status, rec.raw.date, rec.products[0].product, rec.products[0].gstPercent], ['Completed', '05/03/2025', 'Monitor', 18]);
    const row = (await ctx.api('GET', '/fa')).body.find((r) => r.faCode === 'MAR20250007');
    assert.deepStrictEqual([row.qtyCreatedAt, row.qtyPlottedBy], ['07/03/2025 09:00:00', 'Ravi']);
    assert.ok((await ctx.api('GET', '/masters/po')).body.some((p) => p['PO Date'] === '01/02/2025'));
    assert.ok(await ctx.login('ravi', 'ravi@123'));
    // imported months before the current month are Finalized
    assert.deepStrictEqual([row.bookMonth, row.monthStatus], ['2025-03', 'Finalized']);
    const locked = await ctx.api('POST', '/fa', faBody({ invNo: 'N-0', date: '2025-03-20' }));
    assert.match(locked.body.message, /Mar 2025 is finalized/);
    // FA Codes continue after the imported ones; booked in an open Tally month
    assert.strictEqual(await newFA(ctx, { invNo: 'N-1', date: '2025-03-20', bookMonth: 'Sep-2026' }), 'MAR20250009');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Dashboard filters by cost center and invoice date', async () => {
  const all = (await ctx.api('GET', '/dashboard')).body;
  assert.ok(all.costCenters.includes('CC-1'));
  const cc = (await ctx.api('GET', '/dashboard?costCenter=cc-1')).body;
  assert.ok(cc.totalFA > 0 && cc.totalFA <= all.totalFA);
  assert.ok(cc.ledgerSummary.every((l) => l.costCenter === 'CC-1'));
  assert.deepStrictEqual(cc.costCenters, all.costCenters); // the filter list never shrinks
  const none = (await ctx.api('GET', '/dashboard?from=2099-01-01')).body;
  assert.deepStrictEqual([none.totalFA, none.totalAmount, none.ledgerSummary.length, none.dateRange.fromDate], [0, 0, 0, '']);
  const range = (await ctx.api('GET', '/dashboard?from=2026-09-01&to=2026-09-30')).body;
  assert.ok(range.dateRange.fromDate.endsWith('/09/2026') && range.dateRange.toDate.endsWith('/09/2026'));
});

test('Dashboard accepts several cost centers', async () => {
  const one = (await ctx.api('GET', '/dashboard?costCenter=CC-1')).body;
  const all = (await ctx.api('GET', '/dashboard')).body;
  const other = all.costCenters.find((c) => c !== 'CC-1');
  const two = (await ctx.api('GET', `/dashboard?costCenter=CC-1&costCenter=${encodeURIComponent(other)}`)).body;
  const second = (await ctx.api('GET', `/dashboard?costCenter=${encodeURIComponent(other)}`)).body;
  assert.strictEqual(two.totalFA, one.totalFA + second.totalFA);
});

test('Period Reports: month / quarter / financial year groups and period exports', async () => {
  // financial year runs April - March: Mar 2027 is Q4 of FY 2026-27, Apr 2027 starts FY 2027-28
  await newFA(ctx, { invNo: 'PR-1', date: '2027-03-31', amount: 1000, costCenter: 'CC-PR', expenseHead: 'Computers' });
  const cn = await newFA(ctx, { invNo: 'PR-2', date: '2027-04-01', amount: -200, costCenter: 'CC-PR', expenseHead: 'Computers' });
  await newFA(ctx, { invNo: 'PR-3', date: '2027-04-15', amount: 500, costCenter: 'CC-PR', expenseHead: 'Furniture' });
  await plot(ctx, cn, [], { againstInvoiceNo: 'PR-1' });

  const r = (await ctx.api('GET', '/reports/period?from=2027-03-01&to=2027-04-30&costCenter=cc-pr')).body;
  assert.deepStrictEqual([r.totals.records, r.totals.amount, r.totals.pending, r.totals.creditNotes, r.totals.creditAmount], [3, 1300, 2, 1, -200]);
  assert.deepStrictEqual(r.months.map((m) => [m.month, m.quarter, m.records]), [['Mar 2027', 'Q4 FY 2026-27', 1], ['Apr 2027', 'Q1 FY 2027-28', 2]]);
  assert.deepStrictEqual(r.years.map((y) => [y.fy, y.amount]), [['FY 2026-27', 1000], ['FY 2027-28', 300]]);
  assert.deepStrictEqual(r.expenseHeads.map((h) => h.expenseHead), ['Computers', 'Furniture']);
  assert.strictEqual(r.recordCount, 3);
  const recs = (await ctx.api('GET', '/reports/period/records?from=2027-03-01&to=2027-04-30&costCenter=cc-pr&size=2&page=2')).body;
  assert.deepStrictEqual([recs.total, recs.rows.length, recs.rows[0].invNo], [3, 1, 'PR-3']);
  const found = (await ctx.api('GET', '/reports/period/records?from=2027-03-01&to=2027-04-30&search=pr-2')).body;
  assert.deepStrictEqual(found.rows.map((x) => x.invNo), ['PR-2']);
  assert.ok(r.costCenterOptions.includes('CC-PR'));

  const q = 'from=2027-04-01&to=2027-06-30&costCenter=CC-PR';
  const detail = await ctx.download(`/reports/period/export?type=detail&${q}&label=Q1 FY 2027-28`);
  assert.strictEqual(detail.status, 200);
  assert.match(detail.headers.get('content-disposition'), /FA_Data_Q1_FY_2027-28\.xlsx/);
  assert.deepStrictEqual(detail.rows.slice(1).map((x) => x[1]).sort(), ['PR-2', 'PR-3']);

  const all = await ctx.download(`/reports/period/export?type=complete&${q}&label=Q1`);
  assert.deepStrictEqual(Object.keys(all.sheets), ['Summary', 'Month-wise', 'Quarter-wise', 'Financial Year-wise',
    'Expense Head-wise', 'Cost Center-wise', 'Product-wise', 'FA Data', 'FAMS Template']);
  assert.strictEqual(all.sheets['FAMS Template'].length, 2); // header + the one plotted line (PR-2)

  const fams = await ctx.api('GET', '/reports/period/export?type=fams&from=2099-01-01');
  assert.strictEqual(fams.body.message, 'No Qty Plotting data in the selected period.');
  const log = await ctx.pool.query("SELECT details FROM activity_log WHERE action = 'Period Report Exported' ORDER BY log_id DESC LIMIT 1");
  assert.match(log.rows[0].details, /Complete Workbook, Period: Q1/);
});
