// Login, Raw Data, FA Codes, Qty Plotting, credit notes, edit, delete,
// export and Admin bulk edit, against the rules in Code.gs
const test = require('node:test');
const assert = require('node:assert');
const { setup, faBody, line, newFA, plot } = require('./helpers');

let ctx;
test.before(async () => { ctx = await setup(); });
test.after(async () => { await ctx.close(); });

test('login: wrong password, session required, one sign-in per user', async () => {
  const bad = await ctx.api('POST', '/auth/login', { username: 'admin', password: 'nope' }, null);
  assert.strictEqual(bad.status, 401);
  assert.strictEqual(bad.body.message, 'Invalid username or password.');
  const anon = await ctx.api('GET', '/fa', undefined, null);
  assert.strictEqual(anon.status, 401);
  assert.match(anon.body.message, /Session expired/);

  // one sign-in per user ID: a second browser is refused while the first is open (no take-over)
  await ctx.api('POST', '/users', { username: 'solo', password: 'pw', name: 'Solo' });
  const t1 = await ctx.login('solo', 'pw');
  const edge = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0';
  const tryLogin = (extra = {}) => fetch(`${ctx.base}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': edge }, body: JSON.stringify({ username: 'solo', password: 'pw', ...extra }),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));
  const again = await tryLogin({ force: true }); // force is no longer honoured
  assert.deepStrictEqual([again.status, again.body.code], [409, 'ALREADY_SIGNED_IN']);
  assert.match(again.body.message, /User ID solo is already signed in on another browser or computer/);
  assert.ok(again.body.since && again.body.lastActive);
  assert.strictEqual((await ctx.api('GET', '/auth/me', undefined, t1)).status, 200); // the signed-in session is untouched
  // the attempt is logged and shown once to the signed-in user
  const log = await ctx.pool.query("SELECT details FROM activity_log WHERE action = 'Login Blocked' ORDER BY log_id DESC LIMIT 1");
  assert.match(log.rows[0].details, /attempt from Edge on Windows/);
  const notice = (await ctx.api('POST', '/auth/ping', { active: false }, t1)).body;
  assert.deepStrictEqual(notice.blockedAttempts.map((a) => a.device), ['Edge on Windows']);
  assert.deepStrictEqual((await ctx.api('POST', '/auth/ping', {}, t1)).body.blockedAttempts, []);

  // logout ends the session, so the next sign-in is allowed
  await ctx.api('POST', '/auth/logout', undefined, t1);
  assert.strictEqual((await ctx.api('GET', '/auth/me', undefined, t1)).status, 401);
  const t3 = await ctx.login('solo', 'pw');

  // the browser was closed (no check-in for 3+ minutes): a new sign-in replaces that session
  await ctx.pool.query("UPDATE sessions SET last_ping_at = NOW() - INTERVAL '4 minutes' WHERE ended_at IS NULL AND user_id = (SELECT user_id FROM users WHERE username = 'solo')");
  const t4 = await ctx.login('solo', 'pw');
  assert.strictEqual((await ctx.api('GET', '/auth/me', undefined, t3)).body.code, 'SESSION_REPLACED');

  // Admin ends a session (e.g. a PC left signed in); users cannot; not your own
  const list = (await ctx.api('GET', '/users')).body;
  assert.match(list.find((u) => u.username === 'solo').session.device, /^$|on/);
  assert.strictEqual(list.find((u) => u.username === 'admin').session !== null, true);
  assert.strictEqual((await ctx.api('POST', '/users/solo/sign-out', undefined, t4)).status, 403);
  assert.match((await ctx.api('POST', '/users/admin/sign-out')).body.message, /your own session/);
  const ended = await ctx.api('POST', '/users/solo/sign-out');
  assert.match(ended.body.message, /has been signed out/);
  assert.deepStrictEqual((await ctx.api('GET', '/auth/me', undefined, t4)).body.code, 'SESSION_ENDED_BY_ADMIN');
  assert.strictEqual((await ctx.api('GET', '/users')).body.find((u) => u.username === 'solo').session, null);
  assert.ok(await ctx.login('solo', 'pw'));
});

test('saveFAData: required fields, zero amount and month-wise FA Codes', async () => {
  const missing = await ctx.api('POST', '/fa', faBody({ poNo: '' }));
  assert.strictEqual(missing.body.message, 'PO No is required.');
  const zero = await ctx.api('POST', '/fa', faBody({ amount: 0 }));
  assert.strictEqual(zero.body.message, 'Amount cannot be zero.');

  const a = await ctx.api('POST', '/fa', faBody({ date: '2026-09-15' }));
  assert.deepStrictEqual([a.status, a.body.faCode, a.body.message], [200, 'SEP20260001', 'FA data saved successfully.']);
  assert.strictEqual(await newFA(ctx, { date: '30/09/2026' }), 'SEP20260002');
  assert.strictEqual(await newFA(ctx, { date: '2026-10-01' }), 'OCT20260001');
  assert.strictEqual(await newFA(ctx, { date: '2026-09-01', amount: -500 }), 'SEP20260003'); // credit notes allowed

  const list = (await ctx.api('GET', '/fa')).body;
  assert.strictEqual(list[0].date, '15/09/2026');
  assert.strictEqual(list[0].status, 'Pending');
  const range = (await ctx.api('GET', '/fa/date-range')).body;
  assert.deepStrictEqual(range, { fromDate: '01/09/2026', toDate: '01/10/2026' });
});

test('simultaneous saves never share an FA Code', async () => {
  const res = await Promise.all(Array.from({ length: 12 }, (_, i) => ctx.api('POST', '/fa', faBody({ invNo: `C-${i}`, date: '2026-11-05' }))));
  const codes = res.map((r) => r.body.faCode).sort();
  assert.deepStrictEqual(codes, Array.from({ length: 12 }, (_, i) => `NOV2026${String(i + 1).padStart(4, '0')}`));
});

test('bulk upload: header check, valid rows saved, invalid rows reported', async () => {
  const HEAD = ['Inv No', 'Date', 'PO No', 'Cost Center', 'Amount', 'Vendor', 'Expense Head', 'Narration'];
  const noNarration = await ctx.upload('/fa/bulk-upload', [HEAD.slice(0, 7), ['x', '1/1/2026', 'p', 'c', '1', 'v', 'e']]);
  assert.strictEqual(noNarration.body.message, 'Missing column: narration');

  const res = await ctx.upload('/fa/bulk-upload', [HEAD,
    ['B-1', '05/12/2026', 'PO-9', 'CC-1', '1,200.50', 'Vendor X', 'Computers', 'ok'],
    ['B-2', '05/12/2026', '', 'CC-1', '500', 'Vendor X', 'Computers', ''],
    [], // blank rows are ignored
    ['B-3', '31/02/2026', 'PO-9', 'CC-1', '500', 'Vendor X', 'Computers', ''],
    ['B-4', new Date(Date.UTC(2026, 11, 6)), 'PO-9', 'CC-2', '300', 'Vendor Y', 'Furniture', ''],
  ]);
  assert.strictEqual(res.status, 200, res.body.message);
  assert.strictEqual(res.body.saved, 2);
  assert.strictEqual(res.body.message, '2 bulk record(s) saved successfully.');
  assert.deepStrictEqual(res.body.errors.map((e) => e.slice(0, 6)), ['Row 3:', 'Row 4:']);
  const recs = (await ctx.api('GET', '/fa')).body.filter((r) => r.invNo.startsWith('B-'));
  assert.deepStrictEqual(recs.map((r) => [r.faCode, r.amount, r.date]), [['DEC20260001', 1200.5, '05/12/2026'], ['DEC20260002', 300, '06/12/2026']]);
});

test('upload: works when the uploads folder does not exist yet (installed release)', async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const dir = path.join(os.tmpdir(), `fa-uploads-missing-${Date.now()}`);
  const before = process.env.UPLOAD_DIR;
  process.env.UPLOAD_DIR = dir;
  try {
    const res = await ctx.upload('/fa/bulk-upload', [['Inv No', 'Date', 'PO No', 'Cost Center', 'Amount', 'Vendor', 'Expense Head', 'Narration'],
      ['U-1', '05/12/2026', 'PO-9', 'CC-1', '100', 'Vendor X', 'Computers', '']]);
    assert.strictEqual(res.status, 200, res.body.message);
    assert.strictEqual(res.body.saved, 1);
    assert.ok(fs.existsSync(dir), 'the uploads folder is created'); // the file itself is deleted in the background
  } finally {
    if (before === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = before;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Qty Plotting: totals must match exactly, Product Amount drives Unit Price, no second plotting', async () => {
  const code = await newFA(ctx, { invNo: 'Q-1', amount: 1000 });
  const pending = (await ctx.api('GET', '/qty/pending')).body.records;
  assert.ok(pending.some((r) => r.faCode === code));

  const off = await plot(ctx, code, [line({ productAmount: 999.98 })]);
  assert.strictEqual(off.body.message, 'Qty Plotting total (999.98) must exactly match FA Amount (1000.00).');
  const noTag = await plot(ctx, code, [line({ taggable: '' })]);
  assert.strictEqual(noTag.body.message, 'Please select Taggable or Non Taggable in row 1.');
  const badGst = await plot(ctx, code, [line({ gstPercent: 120 })]);
  assert.strictEqual(badGst.body.message, 'GST % must be between 0 and 100 in row 1.');

  const ok = await plot(ctx, code, [
    line({ product: 'Laptop', quantity: 3, productAmount: 900, unitPrice: 1 }),
    line({ product: 'Bag', quantity: 2, taggable: 'Non Taggable', productAmount: '', unitPrice: 50, gstPercent: '' }),
  ]);
  assert.strictEqual(ok.status, 200, ok.body.message);
  assert.strictEqual(ok.body.message, 'Qty Plotting saved successfully.');

  const again = await plot(ctx, code);
  assert.strictEqual(again.body.message, 'Qty Plotting already exists for this FA Code.');

  const rec = (await ctx.api('GET', `/fa/${code}`)).body;
  assert.strictEqual(rec.raw.status, 'Completed');
  assert.deepStrictEqual(rec.products.map((p) => [p.product, p.unitPrice, p.productAmount, p.gstPercent]),
    [['Laptop', 300, 900, 18], ['Bag', 50, 100, 0]]);
  const row = (await ctx.api('GET', '/fa')).body.find((r) => r.faCode === code);
  assert.strictEqual(row.qtyPlottedBy, 'Administrator');
  assert.match(row.qtyCreatedAt, /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/);
  // only Taggable products go to the Product Master
  const products = (await ctx.api('GET', '/products')).body;
  assert.ok(products.includes('Laptop') && !products.includes('Bag'));
});

test('negative amount: one credit-note line against an invoice or asset code', async () => {
  const code = await newFA(ctx, { invNo: 'CN-1', amount: -250, expenseHead: 'Computers' });
  const none = await plot(ctx, code, []);
  assert.strictEqual(none.body.message, 'For negative amount, Against Invoice No or Against Asset Code is required.');
  const ok = await plot(ctx, code, [], { againstInvoiceNo: 'INV-1' });
  assert.strictEqual(ok.status, 200, ok.body.message);
  const p = (await ctx.api('GET', `/fa/${code}`)).body.products;
  assert.deepStrictEqual(p.map((x) => [x.product, x.quantity, x.taggable, x.unitPrice, x.productAmount, x.againstInvoiceNo]),
    [['Computers (Credit Not/Reversal)', 1, 'Non Taggable', 250, -250, 'INV-1']]);
});

test('original invoice lookup for a reversal: any month, amount match first, already reversed shown', async () => {
  const older = await newFA(ctx, { invNo: 'Nov/Inv/40', date: '2025-11-09', amount: 5000, vendor: 'Ram Dawan' });
  const other = await newFA(ctx, { invNo: 'Nov/Inv/40', date: '2025-11-09', amount: 1200, expenseHead: 'Interiors' });
  await newFA(ctx, { invNo: 'Nov/Inv/400', date: '2026-10-02', amount: 900 });
  await plot(ctx, older);
  const rev = await newFA(ctx, { invNo: 'Nov/Inv/40(Reversal)', date: '2026-10-05', amount: -1200 });

  const short = (await ctx.api('GET', '/fa/original-invoices?q=N')).body;
  assert.deepStrictEqual(short.records, []);
  const res = (await ctx.api('GET', `/fa/original-invoices?q=${encodeURIComponent('nov/inv/40')}&amount=-1200&exclude=${rev}`)).body;
  // the reversal itself (negative) is never offered; exact Inv No before Nov/Inv/400
  assert.deepStrictEqual(res.records.map((r) => r.faCode), [other, older, res.records[2].faCode]);
  assert.strictEqual(res.records[2].invNo, 'Nov/Inv/400');
  assert.deepStrictEqual([res.records[0].amountMatches, res.records[1].amountMatches], [true, false]);
  assert.strictEqual(res.records[1].products[0].product, 'Laptop');

  // same amount on two expense heads (e.g. SGST / CGST): the reversal's head comes first
  const sgst = await newFA(ctx, { invNo: 'GST/7', amount: 300, expenseHead: 'Interiors - SGST' });
  const cgst = await newFA(ctx, { invNo: 'GST/7', amount: 300, expenseHead: 'Interiors - CGST' });
  const byHead = (await ctx.api('GET', '/fa/original-invoices?q=GST/7&amount=-300&expenseHead=interiors%20-%20cgst')).body.records;
  assert.deepStrictEqual(byHead.map((r) => [r.faCode, r.sameHead]), [[cgst, true], [sgst, false]]);

  await plot(ctx, rev, [], { againstInvoiceNo: 'Nov/Inv/40', againstAssetCode: other });
  const after = (await ctx.api('GET', '/fa/original-invoices?q=Nov%2FInv%2F40%25')).body; // % is matched literally
  assert.deepStrictEqual(after.records, []);
  const again = (await ctx.api('GET', '/fa/original-invoices?q=Nov/Inv/40')).body.records.find((r) => r.faCode === other);
  assert.deepStrictEqual([again.reversed, again.balance], [1200, 0]);
});

test('Ledger Master: Non Taggable heads are plotted automatically; inactive mappings are not', async () => {
  const save = await ctx.api('POST', '/ledgers', { expenseHead: 'Repairs', mapping: 'Non Taggable', active: 'Yes' });
  assert.strictEqual(save.body.message, 'Ledger mapping added successfully.');
  const upd = await ctx.api('POST', '/ledgers', { expenseHead: 'repairs ', mapping: 'Non Taggable', active: 'Yes' });
  assert.strictEqual(upd.body.message, 'Ledger mapping updated successfully.');
  await ctx.api('POST', '/ledgers', { expenseHead: 'Interiors', mapping: 'Non Taggable', active: 'No' });
  const bad = await ctx.api('POST', '/ledgers', { expenseHead: 'X', mapping: 'Maybe' });
  assert.strictEqual(bad.body.message, 'Mapping must be Taggable or Non Taggable.');

  const r1 = await newFA(ctx, { invNo: 'R-1', expenseHead: 'Repairs', amount: 750 });
  const r2 = await newFA(ctx, { invNo: 'R-2', expenseHead: 'Interiors', amount: 400 });
  const r3 = await newFA(ctx, { invNo: 'R-3', expenseHead: 'Repairs', amount: -50 });
  const pending = (await ctx.api('GET', '/qty/pending')).body;
  assert.ok(pending.mapped >= 1);
  const codes = pending.records.map((r) => r.faCode);
  assert.ok(!codes.includes(r1) && codes.includes(r2) && codes.includes(r3));
  const p = (await ctx.api('GET', `/fa/${r1}`)).body;
  assert.strictEqual(p.raw.status, 'Completed');
  assert.deepStrictEqual(p.products.map((x) => [x.product, x.quantity, x.taggable, x.productAmount]), [['Repairs', 1, 'Non Taggable', 750]]);
});

test('Edit: lines updated in place, record becomes Completed, totals checked', async () => {
  const code = await newFA(ctx, { invNo: 'E-1', amount: 600 });
  const base = { ...faBody({ invNo: 'E-1', amount: 600 }) };
  const off = await ctx.api('PUT', `/fa/${code}`, { ...base, products: [line({ productAmount: 500 })] });
  assert.strictEqual(off.body.message, 'Qty Plotting total (500.00) must exactly match FA Amount (600.00).');
  const none = await ctx.api('PUT', `/fa/${code}`, { ...base, products: [] });
  assert.strictEqual(none.body.message, 'At least one Qty Plotting row is required.');

  const ok = await ctx.api('PUT', `/fa/${code}`, { ...base, invNo: 'E-1b', products: [line({ productAmount: 400 }), line({ product: 'Mouse', productAmount: 200 })] });
  assert.strictEqual(ok.body.message, 'FA and Qty Plotting data updated successfully.');
  const first = (await ctx.api('GET', `/fa/${code}`)).body;
  assert.strictEqual(first.raw.status, 'Completed');
  assert.strictEqual(first.raw.invNo, 'E-1b');

  const shrink = await ctx.api('PUT', `/fa/${code}`, { ...base, products: [line({ product: 'Desk', productAmount: 600 })] });
  assert.strictEqual(shrink.status, 200);
  const after = (await ctx.api('GET', `/fa/${code}`)).body.products;
  assert.deepStrictEqual(after.map((p) => [p.lineId, p.product]), [[first.products[0].lineId, 'Desk']]);
});

test('Delete removes the record and its lines', async () => {
  const code = await newFA(ctx, { invNo: 'D-1', amount: 100 });
  await plot(ctx, code);
  const res = await ctx.api('DELETE', `/fa/${code}`);
  assert.deepStrictEqual([res.body.message, res.body.qtyDeleted], ['FA record deleted successfully.', 1]);
  assert.strictEqual((await ctx.api('GET', `/fa/${code}`)).status, 404);
});

test('Export and Admin bulk edit round trip', async () => {
  await ctx.api('POST', '/masters/po', { 'PO No': 'PO-77', 'Client As Per PO': 'Globex' });
  const code = await newFA(ctx, { invNo: 'X-1', poNo: 'PO-77', amount: 300 });
  await plot(ctx, code, [line({ productAmount: 100 }), line({ product: 'Chair', productAmount: 200 })]);
  const boq = await newFA(ctx, { invNo: 'X-2', poNo: 'BOQ', amount: 50 });

  const exp = await ctx.download('/fa/export');
  const [head, ...rows] = exp.rows;
  assert.strictEqual(head.length, 21); // + Tally Booking Month (reference only)
  assert.strictEqual(head[20], 'Tally Booking Month');
  const mine = rows.filter((r) => r[0] === code);
  assert.deepStrictEqual(mine.map((r) => [r[4], r[6], r[10]]), [['Globex', '300', 'Laptop'], ['Globex', '', 'Chair']]);
  assert.strictEqual(rows.find((r) => r[0] === boq)[4], 'Common area');

  // change the vendor and the second line's product name
  const edited = [head, ...mine.map((r, i) => r.map((v, c) => (c === 7 ? 'New Vendor' : c === 10 && i === 1 ? 'Stool' : v)))];
  const res = await ctx.upload('/fa/bulk-edit', [...edited, ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '999999', '']]);
  assert.strictEqual(res.status, 200, res.body.message);
  assert.deepStrictEqual([res.body.updatedRaw, res.body.updatedQty, res.body.errors.length], [1, 2, 1]);
  const after = (await ctx.api('GET', `/fa/${code}`)).body;
  assert.strictEqual(after.raw.vendor, 'New Vendor');
  assert.deepStrictEqual(after.products.map((p) => p.product), ['Laptop', 'Stool']);

  const wrong = await ctx.upload('/fa/bulk-edit', [['FA Code', 'Vendor'], [code, 'x']]);
  assert.strictEqual(wrong.body.message, 'Invalid FA export headers. Please use Export FA Data and edit that Excel file.');
});

test('Users: Admin only; inactive users cannot log in', async () => {
  const add = await ctx.api('POST', '/users', { username: 'clerk', password: 'pw1', name: 'Clerk', role: 'User' });
  assert.strictEqual(add.body.message, 'User added successfully.');
  const dup = await ctx.api('POST', '/users', { username: 'CLERK', password: 'x' });
  assert.strictEqual(dup.body.message, 'Username already exists.');

  const t = await ctx.login('clerk', 'pw1');
  assert.strictEqual((await ctx.api('GET', '/users', undefined, t)).body.message, 'Only Admin can view users.');
  assert.strictEqual((await ctx.upload('/fa/bulk-edit', [['x']], t)).body.message, 'Only Admin can bulk edit FA Data.');
  assert.strictEqual((await ctx.api('POST', '/fa-bulk-delete', { faCodes: ['X'], mode: 'all' }, t)).body.message, 'Only Admin can delete FA records in bulk.');
  assert.strictEqual((await ctx.api('POST', '/fa', faBody({ invNo: 'U-1' }), t)).status, 200);
  assert.strictEqual((await ctx.api('GET', '/masters/branch', undefined, t)).status, 200);

  const upd = await ctx.api('PUT', '/users/clerk', { name: 'Clerk One', role: 'User', active: 'No', password: '' });
  assert.strictEqual(upd.body.message, 'User updated successfully.');
  assert.strictEqual((await ctx.api('GET', '/fa', undefined, t)).status, 401);
  const login = await ctx.api('POST', '/auth/login', { username: 'clerk', password: 'pw1' }, null);
  assert.strictEqual(login.body.message, 'This user account is inactive.');
  const self = await ctx.api('PUT', '/users/admin', { role: 'User' });
  assert.match(self.body.message, /cannot remove your own Admin role/);
});

test('Bulk delete of filtered records: Qty Plotting only, or the records (Admin)', async () => {
  const a = await newFA(ctx, { invNo: 'BD-1', amount: 100, costCenter: 'CC-BD' });
  const b = await newFA(ctx, { invNo: 'BD-2', amount: 200, costCenter: 'CC-BD' });
  await plot(ctx, a);
  await plot(ctx, b);

  const none = await ctx.api('POST', '/fa-bulk-delete', { faCodes: [a], mode: 'maybe' });
  assert.strictEqual(none.body.message, 'Choose what to delete.');

  const qty = await ctx.api('POST', '/fa-bulk-delete', { faCodes: [a, b], mode: 'qty', filter: 'Cost Center: CC-BD' });
  assert.strictEqual(qty.status, 200, qty.body.message);
  assert.deepStrictEqual([qty.body.records, qty.body.qtyDeleted], [2, 2]);
  const rec = (await ctx.api('GET', `/fa/${a}`)).body;
  assert.deepStrictEqual([rec.raw.status, rec.products.length, rec.raw.qtyPlottedBy], ['Pending', 0, '']);
  assert.ok((await ctx.api('GET', '/qty/pending')).body.records.some((r) => r.faCode === a));

  await ctx.api('POST', '/users', { username: 'bd.user', password: 'pw', name: 'BD' });
  const t = await ctx.login('bd.user', 'pw');
  const denied = await ctx.api('POST', '/fa-bulk-delete', { faCodes: [a], mode: 'all' }, t);
  assert.strictEqual(denied.body.message, 'Only Admin can delete FA records in bulk.');

  const all = await ctx.api('POST', '/fa-bulk-delete', { faCodes: [a, b, 'NOPE00000001'], mode: 'all' });
  assert.deepStrictEqual([all.body.records, all.body.notFound], [2, 1]);
  assert.strictEqual((await ctx.api('GET', `/fa/${b}`)).status, 404);
  const log = await ctx.pool.query("SELECT details FROM activity_log WHERE action = 'FA Bulk Delete' ORDER BY log_id DESC LIMIT 1");
  assert.match(log.rows[0].details, /2 FA record\(s\)/);
});

test('Qty Plotting reservation: one user at a time, released on save / cancel / sign out / lapse; Admin can release', async () => {
  await ctx.api('POST', '/users', { username: 'ravi.q', password: 'pw', name: 'Ravi' });
  await ctx.api('POST', '/users', { username: 'sita.q', password: 'pw', name: 'Sita' });
  const ravi = await ctx.login('ravi.q', 'pw');
  const sita = await ctx.login('sita.q', 'pw');
  const a = await newFA(ctx, { invNo: 'LK-1', amount: 100 });
  const b = await newFA(ctx, { invNo: 'LK-2', amount: 200 });
  const mine = async (token) => (await ctx.api('GET', '/qty/pending', undefined, token)).body.records.filter((r) => r.faCode === a || r.faCode === b);

  assert.strictEqual((await ctx.api('POST', `/qty/lock/${a}`, undefined, ravi)).status, 200);
  const taken = await ctx.api('POST', `/qty/lock/${a}`, undefined, sita);
  assert.deepStrictEqual([taken.status, taken.body.code, taken.body.message], [409, 'LOCKED', 'This invoice is being plotted by Ravi.']);
  assert.deepStrictEqual((await mine(sita)).map((r) => [r.invNo, r.lockedBy, r.lockedByMe]), [['LK-1', 'Ravi', false], ['LK-2', '', false]]);
  assert.strictEqual((await mine(ravi))[0].lockedByMe, true);
  // saving is refused for the other user too
  const steal = await plot(ctx, a, undefined, {});
  assert.match(steal.body.message, /being plotted by Ravi/); // admin token, not the holder

  // one invoice at a time: Ravi moving to LK-2 frees LK-1
  await ctx.api('POST', `/qty/lock/${b}`, undefined, ravi);
  assert.strictEqual((await ctx.api('POST', `/qty/lock/${a}`, undefined, sita)).status, 200);
  // cancel releases
  await ctx.api('DELETE', `/qty/lock/${a}`, undefined, sita);
  assert.strictEqual((await mine(ravi))[0].lockedBy, '');

  // keep-alive; a lapsed reservation is free for others
  assert.strictEqual((await ctx.api('POST', `/qty/lock/${b}/keep`, undefined, ravi)).status, 200);
  await ctx.pool.query("UPDATE qty_locks SET last_seen_at = NOW() - INTERVAL '11 minutes'");
  assert.strictEqual((await mine(sita))[1].lockedBy, '');
  assert.strictEqual((await ctx.api('POST', `/qty/lock/${b}`, undefined, sita)).status, 200);

  // Admin releases Sita's reservation; a user cannot release someone else's
  assert.strictEqual((await ctx.api('DELETE', `/qty/lock/${b}?any=1`, undefined, ravi)).body.released, false);
  assert.strictEqual((await ctx.api('DELETE', `/qty/lock/${b}?any=1`)).body.released, true);

  // saving by the holder ends the reservation; signing out ends them too
  await ctx.api('POST', `/qty/lock/${b}`, undefined, ravi);
  const rec = (await ctx.api('GET', `/fa/${b}`)).body.raw;
  const saved = await ctx.api('POST', '/qty', { faCode: b, invNo: rec.invNo, expenseHead: rec.expenseHead, vendor: rec.vendor, products: [line({ productAmount: 200 })] }, ravi);
  assert.strictEqual(saved.status, 200, saved.body.message);
  assert.strictEqual((await ctx.pool.query('SELECT COUNT(*)::int AS n FROM qty_locks')).rows[0].n, 0);
  assert.match((await ctx.api('POST', `/qty/lock/${b}`, undefined, sita)).body.message, /already exists/);
  await ctx.api('POST', `/qty/lock/${a}`, undefined, sita);
  await ctx.api('POST', '/auth/logout', undefined, sita);
  assert.strictEqual((await ctx.pool.query('SELECT COUNT(*)::int AS n FROM qty_locks')).rows[0].n, 0);
});

test('FA Data page: server-side filters, search, paging; Delete Filtered by filter with the count the user saw', async () => {
  for (let i = 1; i <= 7; i++) await newFA(ctx, { invNo: `PG-${i}`, costCenter: i <= 5 ? 'CC-PG' : 'CC-PX', amount: 100 * i, bookMonth: 'Sep-2026' });
  const p1 = (await ctx.api('GET', '/fa/page?costCenter=cc-pg&size=2&page=1')).body;
  assert.deepStrictEqual([p1.total, p1.amount, p1.rows.length, p1.rows[0].invNo, p1.completed], [5, 1500, 2, 'PG-1', 0]);
  const p3 = (await ctx.api('GET', '/fa/page?costCenter=cc-pg&size=2&page=3')).body;
  assert.deepStrictEqual(p3.rows.map((r) => r.invNo), ['PG-5']);
  const found = (await ctx.api('GET', '/fa/page?search=pg-7')).body;
  assert.deepStrictEqual(found.rows.map((r) => [r.invNo, r.bookMonthLabel, r.monthStatus]), [['PG-7', 'Sep 2026', 'Open']]);
  assert.strictEqual((await ctx.api('GET', '/fa/page?search=sep%202026&costCenter=CC-PX')).body.total, 2); // month label searchable
  assert.strictEqual((await ctx.api('GET', '/fa/page?months=2026-09&costCenter=CC-PX&status=Pending')).body.total, 2);
  const opts = (await ctx.api('GET', '/fa/filter-options')).body;
  assert.ok(opts.costCenters.includes('CC-PG') && opts.months.some((m) => m.month === '2026-09' && m.label === 'Sep 2026'));

  const changed = await ctx.api('POST', '/fa-bulk-delete', { filters: { costCenter: ['CC-PX'] }, expectedCount: 1, mode: 'all' });
  assert.deepStrictEqual([changed.status, /has changed \(now 2/.test(changed.body.message)], [409, true]);
  assert.match((await ctx.api('POST', '/fa-bulk-delete', { filters: {}, mode: 'all' })).body.message, /Choose a filter first/);
  const del = await ctx.api('POST', '/fa-bulk-delete', { filters: { costCenter: ['CC-PX'] }, expectedCount: 2, mode: 'all', filter: 'Cost Center: CC-PX' });
  assert.deepStrictEqual([del.status, del.body.records], [200, 2]);
  assert.strictEqual((await ctx.api('GET', '/fa/page?costCenter=CC-PX')).body.total, 0);
});

test('idle sign-out: 30 minutes without activity; background requests do not count; ping keeps it alive', async () => {
  await ctx.api('POST', '/users', { username: 'idle.u', password: 'pw', name: 'Idle' });
  const token = await ctx.login('idle.u', 'pw');
  const age = (min) => ctx.pool.query("UPDATE sessions SET last_seen_at = NOW() - ($1 || ' minutes')::interval WHERE user_id = (SELECT user_id FROM users WHERE username = 'idle.u') AND ended_at IS NULL", [String(min)]);
  const bg = async (url) => {
    const res = await fetch(`${ctx.base}${url}`, { headers: { Authorization: `Bearer ${token}`, 'X-Background': '1' } });
    return res.status;
  };
  // a background refresh 20 minutes in does not reset the clock ...
  await age(20);
  assert.strictEqual(await bg('/qty/pending'), 200);
  const seen = (await ctx.pool.query("SELECT EXTRACT(EPOCH FROM NOW() - last_seen_at) AS s FROM sessions WHERE user_id = (SELECT user_id FROM users WHERE username = 'idle.u') AND ended_at IS NULL")).rows[0].s;
  assert.ok(Number(seen) > 19 * 60);
  // ... a ping while the user types does
  assert.strictEqual((await ctx.api('POST', '/auth/ping', { active: true }, token)).body.idleMinutes, 30);
  await age(29);
  assert.strictEqual((await ctx.api('GET', '/auth/me', undefined, token)).status, 200);
  // 31 minutes without activity: signed out, and told why (also afterwards)
  await age(31);
  const out = await ctx.api('GET', '/auth/me', undefined, token);
  assert.deepStrictEqual([out.status, out.body.code, out.body.message], [401, 'SESSION_IDLE', 'You were signed out after 30 minutes without activity.']);
  assert.strictEqual((await ctx.api('GET', '/fa/page', undefined, token)).body.code, 'SESSION_IDLE');
  // the next sign-in is not asked about the old session
  assert.ok(await ctx.login('idle.u', 'pw'));
});
