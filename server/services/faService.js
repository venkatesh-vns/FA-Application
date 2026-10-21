// Raw Data and Qty Plotting, ported function by function from Code.gs:
// saveFAData, saveBulkData, getFAData, getFARecord, getPendingRecords,
// autoMapNonTaggableLedgers_, saveQtyPlotting, validateProducts_,
// updateFARecord, deleteFARecord, exportFAData, updateFABulkEdit,
// getUploadDateRange, getProductNames.
const { pool, withTransaction } = require('../config/db');
const { httpError } = require('../utils/httpError');
const { logActivity } = require('../utils/activity');
const { normalizeKey, text, toNumber, round2, parseDate, formatDate, formatDateTime } = require('../utils/values');
const { nextFACode } = require('./faCode');
const qtyLocks = require('./qtyLockService');
const { recordFilter } = require('../utils/recordFilter');
const { monthLabel, parseMonth, assertMonthEditable, assertMonthsEditable, recordChanges } = require('../utils/months');

const fail = (message) => httpError(400, message);
const money2 = (n) => Number(n).toFixed(2);

// ------------------------------------------------------------
// Raw Data
// ------------------------------------------------------------

// Cleaned Raw Data fields from a form / upload row
function rawFields(data = {}) {
  return {
    invNo: text(data.invNo),
    date: data.date,
    poNo: text(data.poNo),
    costCenter: text(data.costCenter),
    amount: toNumber(data.amount),
    vendor: text(data.vendor),
    expenseHead: text(data.expenseHead),
    narration: text(data.narration),
    bookMonth: data.bookMonth,
  };
}

// Tally Booking Month of a form / upload row: as given, else `fallback`,
// else the invoice month. Throws when a given value cannot be read.
function bookMonthOf(value, isoDate, fallback) {
  if (text(value)) {
    const m = parseMonth(value);
    if (!m) throw fail(`Tally Booking Month '${text(value)}' is invalid (use e.g. Oct-2026).`);
    return m;
  }
  return parseMonth(fallback) || isoDate.slice(0, 7);
}

async function insertRecord(db, f, isoDate, bookMonth) {
  const faCode = await nextFACode(db, isoDate);
  await db.query(
    `INSERT INTO fa_records (fa_code, inv_no, inv_date, po_no, cost_center, amount, vendor, expense_head, narration, book_month)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [faCode, f.invNo, isoDate, f.poNo, f.costCenter, round2(f.amount), f.vendor, f.expenseHead, f.narration, bookMonth]
  );
  return faCode;
}

// Single entry (saveFAData)
async function saveFAData(user, data) {
  if (!data) throw fail('No FA data received.');
  const f = rawFields(data);
  if (!f.invNo) throw fail('Invoice No is required.');
  if (!f.date) throw fail('Date is required.');
  if (!f.poNo) throw fail('PO No is required.');
  if (!f.costCenter) throw fail('Cost Center is required.');
  if (!f.vendor) throw fail('Vendor is required.');
  if (!f.expenseHead) throw fail('Expense Head is required.');
  if (f.amount === 0) throw fail('Amount cannot be zero.');
  const isoDate = parseDate(f.date);
  if (!isoDate) throw fail('Invalid date for FA Code generation.');
  const bookMonth = bookMonthOf(f.bookMonth, isoDate);

  const faCode = await withTransaction(async (db) => {
    await assertMonthEditable(db, user, bookMonth, { create: true });
    const code = await insertRecord(db, f, isoDate, bookMonth);
    await logActivity(user, 'Upload', 'Raw Data', code, f.invNo, f.expenseHead, `Manual Raw Data upload, Tally month ${monthLabel(bookMonth)}`, db);
    return code;
  });
  return { success: true, faCode, message: 'FA data saved successfully.' };
}

// Bulk upload (saveBulkData): valid rows saved, invalid rows reported
// defaultMonth: Tally Booking Month for rows without one (chosen on the Upload screen)
async function saveBulkData(user, records, defaultMonth) {
  if (!Array.isArray(records) || !records.length) throw fail('No bulk records received.');
  if (text(defaultMonth) && !parseMonth(defaultMonth)) throw fail('Tally Booking Month is invalid.');
  const errors = [];
  const monthOk = {}; // month -> '' (editable) or the lock message
  const saved = await withTransaction(async (db) => {
    let count = 0;
    for (let index = 0; index < records.length; index++) {
      const f = rawFields(records[index]);
      const isoDate = parseDate(f.date);
      if (!f.invNo || !f.date || !f.poNo || !f.costCenter || f.amount === 0 || !f.vendor || !f.expenseHead) {
        errors.push(`Row ${index + 2}: missing/invalid required fields.`);
        continue;
      }
      if (!isoDate) {
        errors.push(`Row ${index + 2}: invalid Date '${text(f.date)}' (use DD/MM/YYYY).`);
        continue;
      }
      let bookMonth;
      try {
        bookMonth = bookMonthOf(f.bookMonth, isoDate, defaultMonth);
      } catch (err) {
        errors.push(`Row ${index + 2}: ${err.message}`);
        continue;
      }
      if (monthOk[bookMonth] === undefined) {
        try {
          await assertMonthEditable(db, user, bookMonth, { create: true });
          monthOk[bookMonth] = '';
        } catch (err) {
          monthOk[bookMonth] = err.message;
        }
      }
      if (monthOk[bookMonth]) {
        errors.push(`Row ${index + 2}: ${monthOk[bookMonth]}`);
        continue;
      }
      const code = await insertRecord(db, f, isoDate, bookMonth);
      await logActivity(user, 'Upload', 'Bulk Upload', code, f.invNo, f.expenseHead, 'Bulk CSV upload', db);
      count += 1;
    }
    return count;
  });
  return { success: true, saved, errors, message: `${saved} bulk record(s) saved successfully.` };
}

const BULK_COLUMNS = ['inv no', 'date', 'po no', 'cost center', 'amount', 'vendor', 'expense head', 'narration'];

// Uploaded Excel rows -> records for saveBulkData (uploadBulkCSV)
function bulkRecordsFromRows(rows) {
  if (!rows || rows.length < 2) throw fail('File does not contain any data rows.');
  const headers = rows[0].map((h) => text(h).toLowerCase());
  BULK_COLUMNS.forEach((name) => {
    if (!headers.includes(name)) throw fail(`Missing column: ${name}`);
  });
  const idx = (name) => headers.indexOf(name);
  // optional column; rows without it use the month chosen on the Upload screen
  const monthCol = headers.findIndex((h) => h === 'tally booking month' || h === 'booking month');
  const out = rows.slice(1)
    .filter((row) => row.some((v) => text(v) !== ''))
    .map((row) => ({
      invNo: row[idx('inv no')], date: row[idx('date')], poNo: row[idx('po no')], costCenter: row[idx('cost center')],
      amount: row[idx('amount')], vendor: row[idx('vendor')], expenseHead: row[idx('expense head')], narration: row[idx('narration')],
      bookMonth: monthCol >= 0 ? row[monthCol] : '',
    }));
  if (!out.length) throw fail('No valid rows found.');
  return out;
}

// ------------------------------------------------------------
// FA Data list and single record
// ------------------------------------------------------------

function rowOut(r) {
  return {
    faCode: r.fa_code,
    invNo: r.inv_no,
    date: formatDate(r.inv_date),
    poNo: r.po_no,
    costCenter: r.cost_center,
    amount: Number(r.amount),
    vendor: r.vendor,
    expenseHead: r.expense_head,
    narration: r.narration,
    status: r.status,
    qtyCreatedAt: r.plotted_at ? formatDateTime(r.plotted_at) : '',
    qtyPlottedBy: r.plotted_by || '',
    bookMonth: r.book_month,
    bookMonthLabel: monthLabel(r.book_month),
    monthStatus: r.month_status || 'Open',
  };
}

const WITH_MONTH = 'SELECT f.*, mp.status AS month_status FROM fa_records f LEFT JOIN month_periods mp ON mp.book_month = f.book_month';

// getFAData: every live record, in entry order
async function getFAData() {
  const { rows } = await pool.query(`${WITH_MONTH} ORDER BY f.fa_id`);
  return rows.map(rowOut);
}

/**
 * getFAPage: one page of FA Data for the filters (cost centers, Tally months,
 * invoice dates, status, search), with the count, amount and plotted count
 * of everything the filters match. size up to 500.
 */
async function getFAPage(filters = {}) {
  const { where, params } = recordFilter(filters);
  const size = Math.min(Math.max(Number(filters.size) || 10, 1), 500);
  const page = Math.max(Number(filters.page) || 1, 1);
  const [sum, rows] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS total, COALESCE(SUM(f.amount), 0) AS amount,
         SUM(CASE WHEN f.status = 'Completed' THEN 1 ELSE 0 END)::int AS completed FROM fa_records f ${where}`,
      params
    ),
    pool.query(
      `SELECT f.*, mp.status AS month_status FROM fa_records f LEFT JOIN month_periods mp ON mp.book_month = f.book_month
       ${where} ORDER BY f.fa_id LIMIT ${size} OFFSET ${(page - 1) * size}`,
      params
    ),
  ]);
  const s = sum.rows[0];
  return { rows: rows.rows.map(rowOut), total: s.total, amount: round2(Number(s.amount)), completed: s.completed || 0, page, size };
}

// Choices for the FA Data filters: cost centers and Tally months (newest first)
async function getFAFilterOptions() {
  const [cc, months] = await Promise.all([
    pool.query("SELECT DISTINCT TRIM(cost_center) AS cc FROM fa_records WHERE TRIM(cost_center) <> '' ORDER BY 1"),
    pool.query(`SELECT f.book_month, COALESCE(mp.status, 'Open') AS status, COUNT(*)::int AS n
       FROM fa_records f LEFT JOIN month_periods mp ON mp.book_month = f.book_month GROUP BY 1, 2 ORDER BY 1 DESC`),
  ]);
  return {
    costCenters: cc.rows.map((r) => r.cc),
    months: months.rows.map((r) => ({ month: r.book_month, label: monthLabel(r.book_month), status: r.status, records: r.n })),
  };
}

const lineOut = (l) => ({
  lineId: l.line_id,
  product: l.product,
  quantity: Number(l.quantity),
  taggable: l.taggable,
  unitPrice: Number(l.unit_price),
  productAmount: Number(l.product_amount),
  gstPercent: Number(l.gst_pct),
  againstInvoiceNo: l.against_invoice_no,
  againstAssetCode: l.against_asset_code,
});

async function findRecord(faCode, db = pool, lock = false) {
  const { rows } = lock
    ? await db.query('SELECT * FROM fa_records WHERE fa_code = $1 FOR UPDATE', [text(faCode)])
    : await db.query(`${WITH_MONTH} WHERE f.fa_code = $1`, [text(faCode)]);
  return rows[0];
}

async function linesOf(faId, db = pool) {
  return (await db.query('SELECT * FROM qty_lines WHERE fa_id = $1 ORDER BY line_no, line_id', [faId])).rows;
}

// getFARecord: { raw, products }
async function getFARecord(faCode) {
  if (!text(faCode)) throw fail('FA Code is required.');
  const r = await findRecord(faCode);
  if (!r) throw httpError(404, 'FA record not found.');
  return { raw: rowOut(r), products: (await linesOf(r.fa_id)).map(lineOut) };
}

// ------------------------------------------------------------
// Qty Plotting
// ------------------------------------------------------------

/**
 * Pending records of a Non Taggable ledger (active in the Ledger Master) are
 * plotted automatically as one line: product = expense head, qty 1, full
 * amount (autoMapNonTaggableLedgers_). Only positive amounts.
 */
async function autoMapNonTaggable(db) {
  const { rows } = await db.query(
    `SELECT f.* FROM fa_records f
     JOIN ledgers l ON LOWER(TRIM(l.expense_head)) = LOWER(TRIM(f.expense_head))
     WHERE l.mapping = 'Non Taggable' AND l.active <> 'No'
       AND f.status = 'Pending' AND f.amount > 0
       AND NOT EXISTS (SELECT 1 FROM qty_lines q WHERE q.fa_id = f.fa_id)
       AND NOT EXISTS (SELECT 1 FROM month_periods mp WHERE mp.book_month = f.book_month AND mp.status <> 'Open')
     ORDER BY f.fa_id
     FOR UPDATE OF f SKIP LOCKED`
  );
  for (const r of rows) {
    await db.query(
      `INSERT INTO qty_lines (fa_id, line_no, product, quantity, taggable, unit_price, product_amount, gst_pct)
       VALUES ($1, 1, $2, 1, 'Non Taggable', $3, $3, 0)`,
      [r.fa_id, r.expense_head, r.amount]
    );
    await db.query("UPDATE fa_records SET status = 'Completed', updated_at = NOW(), plotted_at = NOW() WHERE fa_id = $1", [r.fa_id]);
  }
  return rows.length;
}

// getPendingRecords: auto-mapping first, then what still needs plotting
// Each record says who has it reserved for Qty Plotting (lockedBy, lockedByMe)
async function getPendingRecords(user = null) {
  const mapped = await withTransaction((db) => autoMapNonTaggable(db));
  const locks = await qtyLocks.liveLocks();
  const { rows } = await pool.query(
    `${WITH_MONTH}
     WHERE f.status <> 'Completed' AND NOT EXISTS (SELECT 1 FROM qty_lines q WHERE q.fa_id = f.fa_id)
       AND COALESCE(mp.status, 'Open') IN ('Open', 'Under Review')
     ORDER BY f.fa_id`
  );
  return {
    mapped,
    lockMinutes: qtyLocks.LOCK_MINUTES,
    records: rows.map((r) => {
      const l = locks[r.fa_id];
      return { ...rowOut(r), lockedBy: l ? l.name : '', lockedAt: l ? l.at : '', lockedByMe: Boolean(l && user && l.userId === user.userId) };
    }),
  };
}

/**
 * validateProducts_: description, quantity > 0, Taggable / Non Taggable,
 * Product Amount not negative, GST % 0-100. When Product Amount is given,
 * Unit Price = Product Amount / Quantity.
 */
function validateProducts(products) {
  return products.map((p, index) => {
    const n = index + 1;
    const description = text(p.product ?? p.description);
    const quantity = toNumber(p.quantity);
    const taggable = text(p.taggable);
    const entered = p.productAmount === '' || p.productAmount === null || p.productAmount === undefined ? null : toNumber(p.productAmount);
    let unitPrice = toNumber(p.unitPrice);
    const gstPercent = p.gstPercent === '' || p.gstPercent === null || p.gstPercent === undefined ? 0 : toNumber(p.gstPercent);
    if (!description) throw fail(`Product / Asset Description is required in row ${n}.`);
    if (quantity <= 0) throw fail(`Quantity must be greater than zero in row ${n}.`);
    if (taggable !== 'Taggable' && taggable !== 'Non Taggable') throw fail(`Please select Taggable or Non Taggable in row ${n}.`);
    if (entered !== null && entered < 0) throw fail(`Product Amount cannot be negative in row ${n}.`);
    if (entered !== null && quantity > 0) unitPrice = entered / quantity;
    if (unitPrice < 0) throw fail(`Unit Price cannot be negative in row ${n}.`);
    if (gstPercent < 0 || gstPercent > 100) throw fail(`GST % must be between 0 and 100 in row ${n}.`);
    return {
      product: description,
      quantity,
      taggable,
      unitPrice,
      productAmount: entered === null ? quantity * unitPrice : entered,
      gstPercent,
      againstInvoiceNo: text(p.againstInvoiceNo),
      againstAssetCode: text(p.againstAssetCode),
    };
  });
}

// A negative amount is a credit note / reversal: one Non Taggable line
// referring to the original invoice or asset
function creditNoteLine(expenseHead, amount, againstInvoiceNo, againstAssetCode) {
  const ai = text(againstInvoiceNo);
  const aa = text(againstAssetCode);
  if (!ai && !aa) throw fail('For negative amount, Against Invoice No or Against Asset Code is required.');
  return [{
    product: `${expenseHead} (Credit Not/Reversal)`, quantity: 1, taggable: 'Non Taggable',
    unitPrice: Math.abs(amount), productAmount: amount, gstPercent: 0, againstInvoiceNo: ai, againstAssetCode: aa,
  }];
}

function checkTotal(products, amount) {
  const total = products.reduce((s, p) => s + Number(p.productAmount || 0), 0);
  if (amount > 0 && Math.abs(total - amount) > 0.01) {
    throw fail(`Qty Plotting total (${money2(total)}) must exactly match FA Amount (${money2(amount)}).`);
  }
  return total;
}

// Taggable product names go to the Product Master (saveProductName_)
async function saveProductNames(db, products) {
  for (const p of products) {
    if (p.product && p.taggable === 'Taggable') {
      await db.query(
        `INSERT INTO products (product_name) SELECT $1::varchar
         WHERE NOT EXISTS (SELECT 1 FROM products WHERE LOWER(product_name) = LOWER($1::varchar))`,
        [p.product]
      );
    }
  }
}

async function insertLine(db, faId, lineNo, p, createdAt = null) {
  await db.query(
    `INSERT INTO qty_lines (fa_id, line_no, product, quantity, taggable, unit_price, product_amount, gst_pct,
       against_invoice_no, against_asset_code, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11, NOW()))`,
    [faId, lineNo, p.product, p.quantity, p.taggable, p.unitPrice, round2(p.productAmount), p.gstPercent,
      p.againstInvoiceNo || '', p.againstAssetCode || '', createdAt]
  );
}

// saveQtyPlotting: first plotting of a Pending record
async function saveQtyPlotting(user, data) {
  if (!data) throw fail('No Qty Plotting data received.');
  const faCode = text(data.faCode);
  const invNo = text(data.invNo);
  const expenseHead = text(data.expenseHead);
  const vendor = text(data.vendor);
  if (!faCode || !invNo || !expenseHead || !vendor) throw fail('FA Code, Invoice No, Expense Head and Vendor are required.');

  return withTransaction(async (db) => {
    const r = await findRecord(faCode, db, true);
    if (!r) throw fail('FA record not found.');
    await assertMonthEditable(db, user, r.book_month);
    await qtyLocks.assertNotLockedByOther(db, user, r.fa_id);
    const amount = Number(r.amount);
    let products;
    if (amount < 0) {
      products = creditNoteLine(expenseHead, amount, data.againstInvoiceNo, data.againstAssetCode);
    } else {
      if (!Array.isArray(data.products) || !data.products.length) throw fail('At least one product is required.');
      products = validateProducts(data.products);
    }
    const total = checkTotal(products, amount);
    if ((await linesOf(r.fa_id, db)).length) throw fail('Qty Plotting already exists for this FA Code.');

    for (let i = 0; i < products.length; i++) await insertLine(db, r.fa_id, i + 1, products[i]);
    await db.query(
      "UPDATE fa_records SET status = 'Completed', updated_at = NOW(), plotted_at = NOW(), plotted_by = $2 WHERE fa_id = $1",
      [r.fa_id, user.name || user.username]
    );
    await saveProductNames(db, products);
    await db.query('DELETE FROM qty_locks WHERE fa_id = $1', [r.fa_id]); // saved: the reservation ends
    await logActivity(user, 'Qty Plotting', 'Qty Plotting', faCode, invNo, expenseHead, 'Qty Plotting created', db);
    return { success: true, message: 'Qty Plotting saved successfully.', faCode, total };
  });
}

// ------------------------------------------------------------
// Edit, delete
// ------------------------------------------------------------

/**
 * updateFARecord (FA Data > Edit): saves the record and its products, which
 * must add up to a positive amount; the record becomes Completed. Existing
 * lines are updated in place (keeping their created date), surplus lines are
 * removed and extra lines added.
 */
// [field, old, new] of the FA fields (for change_history)
function rawChanges(r, f, isoDate, bookMonth) {
  return [
    ['Inv No', r.inv_no, f.invNo], ['Date', formatDate(r.inv_date), formatDate(isoDate)], ['PO No', r.po_no, f.poNo],
    ['Cost Center', r.cost_center, f.costCenter], ['Amount', money2(r.amount), money2(f.amount)], ['Vendor', r.vendor, f.vendor],
    ['Expense Head', r.expense_head, f.expenseHead], ['Narration', r.narration, f.narration],
    ['Tally Booking Month', monthLabel(r.book_month), monthLabel(bookMonth)],
  ];
}

const num = (v) => String(Number(Number(v).toFixed(4)));
const lineText = (l) => `${l.product} x ${num(l.quantity)} = ${money2(l.productAmount ?? l.product_amount)}`;

// [field, old, new] of one product line: old = qty_lines row, p = new values
function lineChanges(n, old, p) {
  const pre = `Line ${n} `;
  return [
    [`${pre}Product`, old.product, p.product], [`${pre}Qty`, num(old.quantity), num(p.quantity)],
    [`${pre}Taggable`, old.taggable, p.taggable], [`${pre}Unit Price`, money2(old.unit_price), money2(p.unitPrice)],
    [`${pre}Product Amount`, money2(old.product_amount), money2(p.productAmount)], [`${pre}GST %`, num(old.gst_pct), num(p.gstPercent ?? p.gst)],
    [`${pre}Against Invoice No`, old.against_invoice_no, p.againstInvoiceNo ?? p.refInv ?? ''],
    [`${pre}Against Asset Code`, old.against_asset_code, p.againstAssetCode ?? p.refAsset ?? ''],
  ];
}

async function updateFARecord(user, data) {
  if (!data) throw fail('No update data received.');
  const faCode = text(data.faCode);
  const f = rawFields(data);
  if (!faCode || !f.invNo || !data.date || !f.poNo || !f.costCenter || !f.vendor || !f.expenseHead) throw fail('Please fill all required FA fields.');
  if (f.amount === 0) throw fail('Amount cannot be zero.');
  const isoDate = parseDate(data.date);
  if (!isoDate) throw fail('Date is invalid.');

  let products;
  if (f.amount < 0) {
    const np = (Array.isArray(data.products) && data.products[0]) || {};
    products = creditNoteLine(f.expenseHead, f.amount, np.againstInvoiceNo || data.againstInvoiceNo, np.againstAssetCode || data.againstAssetCode);
  } else {
    if (!Array.isArray(data.products) || !data.products.length) throw fail('At least one Qty Plotting row is required.');
    products = validateProducts(data.products);
  }
  checkTotal(products, f.amount);

  return withTransaction(async (db) => {
    const r = await findRecord(faCode, db, true);
    if (!r) throw fail('FA record not found.');
    await assertMonthEditable(db, user, r.book_month);
    const bookMonth = text(data.bookMonth) ? bookMonthOf(data.bookMonth, isoDate) : r.book_month;
    if (bookMonth !== r.book_month) await assertMonthEditable(db, user, bookMonth, { create: true });
    await db.query(
      `UPDATE fa_records SET inv_no=$1, inv_date=$2, po_no=$3, cost_center=$4, amount=$5, vendor=$6, expense_head=$7,
         narration=$8, book_month=$10, status='Completed', updated_at=NOW(), plotted_at = COALESCE(plotted_at, NOW())
       WHERE fa_id=$9`,
      [f.invNo, isoDate, f.poNo, f.costCenter, round2(f.amount), f.vendor, f.expenseHead, f.narration, r.fa_id, bookMonth]
    );
    const existing = await linesOf(r.fa_id, db);
    const hist = { faCode, bookMonth, source: 'FA Data Edit' };
    await recordChanges(db, user, { ...hist, changes: rawChanges(r, f, isoDate, bookMonth) });
    for (let i = 0; i < Math.max(existing.length, products.length); i++) {
      const old = existing[i];
      const p = products[i];
      if (old && p) await recordChanges(db, user, { ...hist, lineId: old.line_id, changes: lineChanges(i + 1, old, p) });
      else if (old) await recordChanges(db, user, { ...hist, lineId: old.line_id, changes: [[`Line ${i + 1}`, lineText(old), '(removed)']] });
      else await recordChanges(db, user, { ...hist, changes: [[`Line ${i + 1}`, '(added)', lineText(p)]] });
    }
    const common = Math.min(existing.length, products.length);
    for (let i = 0; i < common; i++) {
      const p = products[i];
      await db.query(
        `UPDATE qty_lines SET line_no=$2, product=$3, quantity=$4, taggable=$5, unit_price=$6, product_amount=$7, gst_pct=$8,
           against_invoice_no=$9, against_asset_code=$10, updated_at=NOW()
         WHERE line_id=$1`,
        [existing[i].line_id, i + 1, p.product, p.quantity, p.taggable, p.unitPrice, round2(p.productAmount), p.gstPercent, p.againstInvoiceNo || '', p.againstAssetCode || '']
      );
    }
    for (let i = existing.length - 1; i >= products.length; i--) {
      await db.query('DELETE FROM qty_lines WHERE line_id = $1', [existing[i].line_id]);
    }
    for (let i = existing.length; i < products.length; i++) await insertLine(db, r.fa_id, i + 1, products[i]);
    await saveProductNames(db, products);
    await logActivity(user, 'Qty Plotting Update', 'FA Data Edit', faCode, f.invNo, f.expenseHead, 'FA and Qty Plotting updated', db);
    return { success: true, message: 'FA and Qty Plotting data updated successfully.', faCode };
  });
}

// deleteFARecord: the record and its Qty Plotting lines
async function deleteFARecord(user, faCode) {
  if (!text(faCode)) throw fail('FA Code is required.');
  return withTransaction(async (db) => {
    const r = await findRecord(faCode, db, true);
    if (!r) throw fail('FA record not found.');
    await assertMonthEditable(db, user, r.book_month);
    const del = await db.query('DELETE FROM qty_lines WHERE fa_id = $1', [r.fa_id]);
    await recordChanges(db, user, {
      faCode: r.fa_code, bookMonth: r.book_month, source: 'FA Data Delete',
      changes: [['Record', `${r.inv_no} | ${r.expense_head} | ${money2(r.amount)} | ${del.rowCount} line(s)`, 'Deleted']],
    });
    await db.query('DELETE FROM fa_records WHERE fa_id = $1', [r.fa_id]);
    await logActivity(user, 'FA Deleted', 'FA Data', r.fa_code, r.inv_no, r.expense_head,
      `Amount ${money2(r.amount)}; ${del.rowCount} Qty Plotting row(s) deleted`, db);
    return { success: true, message: 'FA record deleted successfully.', qtyDeleted: del.rowCount };
  });
}

/**
 * Bulk delete for the records shown by the FA Data filter (Admin).
 *   mode 'qty' - removes their Qty Plotting lines; the records go back to Pending
 *   mode 'all' - deletes the records together with their Qty Plotting lines
 * `filter` is the filter text shown to the user, kept in the Activity Log.
 */
// The records are given as faCodes, or as filters (FA Data filters) with the
// count the user saw (expectedCount): if the list changed meanwhile, nothing is deleted.
async function bulkDeleteFA(user, { faCodes, filters, expectedCount, mode, filter } = {}) {
  let codes = [...new Set((Array.isArray(faCodes) ? faCodes : []).map(text).filter(Boolean))];
  if (filters && typeof filters === 'object') {
    const { where, params } = recordFilter(filters);
    if (!where) throw fail('Choose a filter first.');
    codes = (await pool.query(`SELECT f.fa_code FROM fa_records f ${where} ORDER BY f.fa_id`, params)).rows.map((r) => r.fa_code);
    if (expectedCount !== undefined && Number(expectedCount) !== codes.length) {
      throw httpError(409, `The filtered list has changed (now ${codes.length} record(s)). Refresh and check before deleting.`);
    }
  }
  if (!codes.length) throw fail('No FA records selected.');
  if (mode !== 'qty' && mode !== 'all') throw fail('Choose what to delete.');
  if (codes.length > 20000) throw fail('Too many records at once. Narrow the filter.');

  return withTransaction(async (db) => {
    const { rows } = await db.query(
      `SELECT f.fa_id, f.fa_code, f.amount, f.book_month, f.inv_no, (SELECT COUNT(*) FROM qty_lines q WHERE q.fa_id = f.fa_id)::int AS lines
       FROM fa_records f WHERE f.fa_code = ANY($1) FOR UPDATE`, [codes]);
    if (!rows.length) throw fail('None of the selected FA records were found. Refresh and try again.');
    await assertMonthsEditable(db, user, rows.map((r) => r.book_month));
    const ids = rows.map((r) => r.fa_id);
    for (const r of rows) {
      if (mode === 'qty' && !r.lines) continue;
      await recordChanges(db, user, {
        faCode: r.fa_code, bookMonth: r.book_month, source: 'FA Data Bulk Delete',
        changes: [mode === 'all'
          ? ['Record', `${r.inv_no} | ${money2(r.amount)} | ${r.lines} line(s)`, 'Deleted']
          : ['Qty Plotting', `${r.lines} line(s)`, 'Removed - record is Pending again']],
      });
    }
    const lines = await db.query('DELETE FROM qty_lines WHERE fa_id = ANY($1)', [ids]);
    let message;
    if (mode === 'all') {
      await db.query('DELETE FROM fa_records WHERE fa_id = ANY($1)', [ids]);
      message = `${rows.length} FA record(s) and ${lines.rowCount} Qty Plotting row(s) deleted.`;
    } else {
      await db.query(
        "UPDATE fa_records SET status = 'Pending', plotted_at = NULL, plotted_by = NULL, updated_at = NOW() WHERE fa_id = ANY($1)",
        [ids]
      );
      message = `Qty Plotting removed from ${rows.length} FA record(s) (${lines.rowCount} row(s)). They are Pending again.`;
    }
    const total = rows.reduce((s, r) => s + Number(r.amount), 0);
    await logActivity(user, mode === 'all' ? 'FA Bulk Delete' : 'Qty Plotting Bulk Delete', 'FA Data', '', '', '',
      `${message} Amount ${money2(total)}. Filter: ${text(filter) || '-'}`, db);
    return { success: true, message, records: rows.length, qtyDeleted: lines.rowCount, notFound: codes.length - rows.length };
  });
}

// ------------------------------------------------------------
// Export and Admin bulk edit
// ------------------------------------------------------------

const EXPORT_HEADERS = ['FA Code', 'Inv No', 'Date', 'PO No', 'Client Name', 'Cost Center', 'Amount', 'Vendor', 'Expense Head',
  'Narration', 'Product / Asset Description', 'Qty', 'Taggable / Non Taggable', 'Unit Price', 'Product Amount', 'GST %',
  'Against Invoice No', 'Against Asset Code', 'FA Row Number', 'Qty Row Number', 'Tally Booking Month'];
// Bulk edit reads the first 20 columns; Tally Booking Month is for reference only
// (older exports without it are accepted too)
const BULK_EDIT_HEADERS = EXPORT_HEADERS.slice(0, 20);

/**
 * exportFAData: one row per product line (a record without lines gets one
 * row); Amount only on a record's first row. Client Name = PO Master 'Client
 * As Per PO' for the PO No, or 'Common area' when PO No is BOQ. 'FA Row
 * Number' / 'Qty Row Number' identify the record and line for bulk edit.
 */
// Optional filters (Period Reports): from / to invoice date, costCenter
async function exportFAData(filters = {}) {
  const { rows } = await exportFAStream(filters);
  const out = [];
  for await (const row of rows) out.push(row);
  return out;
}

const EXPORT_BATCH = 2000; // records per query

/**
 * FA Data export as a stream: { count, rows } where rows yields the header and
 * then one row per product line, reading EXPORT_BATCH records at a time.
 */
async function exportFAStream(filters = {}) {
  const { where, params } = recordFilter(filters);
  const and = where ? `${where} AND` : 'WHERE';
  const [counted, po] = await Promise.all([
    pool.query(
      `SELECT (SELECT COUNT(*) FROM qty_lines q JOIN fa_records f ON f.fa_id = q.fa_id ${where})
             + (SELECT COUNT(*) FROM fa_records f ${and} NOT EXISTS (SELECT 1 FROM qty_lines q WHERE q.fa_id = f.fa_id)) AS n`,
      params
    ),
    pool.query('SELECT po_no, client_as_per_po FROM po_master ORDER BY id'),
  ]);
  const poMap = {};
  po.rows.forEach((p) => { if (text(p.po_no)) poMap[normalizeKey(p.po_no)] = text(p.client_as_per_po); });
  const batchSql = `SELECT f.* FROM fa_records f ${and} f.fa_id > $${params.length + 1} ORDER BY f.fa_id LIMIT ${EXPORT_BATCH}`;

  async function* rows() {
    yield EXPORT_HEADERS;
    let lastId = 0;
    for (;;) {
      const raw = await pool.query(batchSql, [...params, lastId]);
      if (!raw.rows.length) return;
      lastId = raw.rows[raw.rows.length - 1].fa_id;
      const lines = await pool.query('SELECT * FROM qty_lines WHERE fa_id = ANY($1) ORDER BY fa_id, line_no, line_id', [raw.rows.map((r) => r.fa_id)]);
      const byFa = {};
      lines.rows.forEach((l) => { (byFa[l.fa_id] = byFa[l.fa_id] || []).push(l); });
      yield* exportRowsOf(raw.rows, byFa, poMap);
      if (raw.rows.length < EXPORT_BATCH) return;
    }
  }
  return { count: Number(counted.rows[0].n), rows: rows() };
}

// Export rows of a batch of records
function exportRowsOf(records, byFa, poMap) {
  const out = [];
  records.forEach((r) => {
    const clientName = normalizeKey(r.po_no) === 'boq' ? 'Common area' : (poMap[normalizeKey(r.po_no)] || '');
    const base = [r.fa_code, r.inv_no, formatDate(r.inv_date), r.po_no, clientName, r.cost_center];
    const ps = byFa[r.fa_id] || [];
    if (!ps.length) {
      out.push([...base, Number(r.amount), r.vendor, r.expense_head, r.narration, '', '', '', '', '', '', '', '', r.fa_id, '', monthLabel(r.book_month)]);
      return;
    }
    ps.forEach((q, i) => {
      out.push([...base, i === 0 ? Number(r.amount) : '', r.vendor, r.expense_head, r.narration, q.product, Number(q.quantity),
        q.taggable, Number(q.unit_price), Number(q.product_amount), Number(q.gst_pct), q.against_invoice_no, q.against_asset_code,
        r.fa_id, q.line_id, monthLabel(r.book_month)]);
    });
  });
  return out;
}

// Edited export rows -> records keyed by header (bulkEditFAData)
function bulkEditRecordsFromRows(rows) {
  if (!rows || !rows.length) throw fail('Excel file is empty.');
  const headers = rows[0].map((h) => text(h).replace(/^﻿/, ''));
  const extra = headers.slice(BULK_EDIT_HEADERS.length).filter(Boolean);
  if (headers.slice(0, BULK_EDIT_HEADERS.length).join('||') !== BULK_EDIT_HEADERS.join('||') || extra.some((h) => h !== 'Tally Booking Month')) {
    throw fail('Invalid FA export headers. Please use Export FA Data and edit that Excel file.');
  }
  return rows.slice(1)
    .filter((r) => r.some((v) => text(v)))
    .map((r) => Object.fromEntries(BULK_EDIT_HEADERS.map((h, i) => [h, text(r[i])])));
}

/**
 * updateFABulkEdit (Admin): each row updates its FA record (by FA Row Number)
 * and, when Qty Row Number is given, that product line. Blank Inv No or
 * Amount keep the current value; the other FA fields are required. Status
 * is kept. A row with errors is skipped and reported.
 */
async function updateFABulkEdit(user, records) {
  if (!Array.isArray(records) || !records.length) throw fail('No FA records received.');
  const errors = [];
  let updatedRaw = 0;
  let updatedQty = 0;
  const processed = new Set();
  const monthOk = {}; // month -> '' (editable) or the lock message

  await withTransaction(async (db) => {
    for (let index = 0; index < records.length; index++) {
      const item = records[index];
      const fileRow = index + 2;
      const faId = Number(item['FA Row Number'] || 0);
      const lineId = Number(item['Qty Row Number'] || 0);
      const current = faId > 0 ? (await db.query('SELECT * FROM fa_records WHERE fa_id = $1', [faId])).rows[0] : null;
      if (!current) { errors.push(`File row ${fileRow}: invalid FA Row Number.`); continue; }
      if (monthOk[current.book_month] === undefined) {
        try {
          await assertMonthEditable(db, user, current.book_month);
          monthOk[current.book_month] = '';
        } catch (err) {
          monthOk[current.book_month] = err.message;
        }
      }
      if (monthOk[current.book_month]) { errors.push(`File row ${fileRow}: ${current.fa_code} - ${monthOk[current.book_month]}`); continue; }

      const inv = text(item['Inv No']) || current.inv_no;
      const dateValue = text(item.Date);
      const po = text(item['PO No']);
      const cc = text(item['Cost Center']);
      const amount = text(item.Amount) === '' ? Number(current.amount) : toNumber(item.Amount);
      const vendor = text(item.Vendor);
      const expense = text(item['Expense Head']);
      const narration = text(item.Narration);
      const isoDate = parseDate(dateValue);
      if (!inv || !dateValue || !po || !cc || !vendor || !expense || amount === 0) { errors.push(`File row ${fileRow}: required FA fields missing/invalid.`); continue; }
      if (!isoDate) { errors.push(`File row ${fileRow}: invalid Date '${dateValue}'.`); continue; }

      let line = null;
      if (lineId > 0) {
        const q = (await db.query('SELECT * FROM qty_lines WHERE line_id = $1', [lineId])).rows[0];
        if (!q || q.fa_id !== faId) { errors.push(`File row ${fileRow}: invalid Qty Row Number.`); continue; }
        const product = text(item['Product / Asset Description']);
        const quantity = toNumber(item.Qty);
        const tag = text(item['Taggable / Non Taggable']);
        const unit = toNumber(item['Unit Price']);
        const productAmount = text(item['Product Amount']) === '' ? quantity * unit : toNumber(item['Product Amount']);
        const gst = text(item['GST %']) === '' ? 0 : toNumber(item['GST %']);
        if (!product || quantity <= 0 || (tag !== 'Taggable' && tag !== 'Non Taggable')) { errors.push(`File row ${fileRow}: invalid Qty Plotting fields.`); continue; }
        if (amount < 0) {
          const refInv = text(item['Against Invoice No']);
          const refAsset = text(item['Against Asset Code']);
          if (!refInv && !refAsset) { errors.push(`File row ${fileRow}: negative amount requires Against Invoice No or Against Asset Code.`); continue; }
          line = { lineId, product: `${expense} (Credit Not/Reversal)`, quantity: 1, taggable: 'Non Taggable', unitPrice: Math.abs(amount), productAmount: amount, gst: 0, refInv, refAsset };
        } else {
          line = { lineId, product, quantity, taggable: tag, unitPrice: unit, productAmount, gst, refInv: text(item['Against Invoice No']), refAsset: text(item['Against Asset Code']) };
        }
        line.old = q;
      }

      const hist = { faCode: current.fa_code, bookMonth: current.book_month, source: 'FA Bulk Edit' };
      if (!processed.has(faId)) {
        const next = { invNo: inv, poNo: po, costCenter: cc, amount, vendor, expenseHead: expense, narration };
        await recordChanges(db, user, { ...hist, changes: rawChanges(current, next, isoDate, current.book_month) });
      }
      if (line) await recordChanges(db, user, { ...hist, lineId: line.lineId, changes: lineChanges(line.old.line_no, line.old, line) });

      await db.query(
        `UPDATE fa_records SET inv_no=$1, inv_date=$2, po_no=$3, cost_center=$4, amount=$5, vendor=$6, expense_head=$7,
           narration=$8, updated_at=NOW() WHERE fa_id=$9`,
        [inv, isoDate, po, cc, round2(amount), vendor, expense, narration, faId]
      );
      if (!processed.has(faId)) { processed.add(faId); updatedRaw += 1; }
      if (line) {
        await db.query(
          `UPDATE qty_lines SET product=$2, quantity=$3, taggable=$4, unit_price=$5, product_amount=$6, gst_pct=$7,
             against_invoice_no=$8, against_asset_code=$9, updated_at=NOW() WHERE line_id=$1`,
          [line.lineId, line.product, line.quantity, line.taggable, line.unitPrice, round2(line.productAmount), line.gst, line.refInv, line.refAsset]
        );
        if (line.taggable === 'Taggable') await saveProductNames(db, [line]);
        updatedQty += 1;
      }
    }
    await logActivity(user, 'FA Bulk Edit', 'FA Data', '', '', '', `Updated Raw: ${updatedRaw}, Qty: ${updatedQty}`, db);
  });

  return {
    success: true, updatedRaw, updatedQty, errors,
    message: `FA bulk edit completed. Raw records updated: ${updatedRaw}, Qty rows updated: ${updatedQty}${errors.length ? `, ${errors.length} row(s) skipped.` : ''}`,
  };
}

// ------------------------------------------------------------
// Small lookups
// ------------------------------------------------------------

// getUploadDateRange: earliest and latest invoice Date in Raw Data
async function getUploadDateRange() {
  const { rows } = await pool.query('SELECT MIN(inv_date) AS from_date, MAX(inv_date) AS to_date FROM fa_records');
  return { fromDate: formatDate(rows[0].from_date), toDate: formatDate(rows[0].to_date) };
}

/**
 * Original invoices for a credit note / reversal: positive FA records of any
 * month whose Inv No contains `q`. Each comes with its products and what was
 * already reversed against its FA Code (the Against Asset Code), so the user
 * can pick by amount. Exact Inv No first, then the records whose amount or
 * remaining amount equals the credit note amount, then the same Expense Head
 * (e.g. the CGST line of an invoice with SGST and CGST records), then the newest.
 */
async function findOriginalInvoices({ q, amount, exclude, expenseHead } = {}) {
  const term = text(q);
  if (term.length < 2) return { records: [] };
  const like = `%${term.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const { rows } = await pool.query(
    `SELECT f.*,
       COALESCE((SELECT -SUM(q.product_amount) FROM qty_lines q
                 WHERE q.product_amount < 0 AND LOWER(TRIM(q.against_asset_code)) = LOWER(f.fa_code)), 0) AS reversed
     FROM fa_records f
     WHERE f.amount > 0 AND LOWER(f.inv_no) LIKE $1 AND f.fa_code <> $2
     ORDER BY (LOWER(TRIM(f.inv_no)) = LOWER($3)) DESC, f.inv_date DESC, f.fa_id DESC
     LIMIT 50`,
    [like, text(exclude), term]
  );
  const lines = rows.length
    ? (await pool.query('SELECT * FROM qty_lines WHERE fa_id = ANY($1) ORDER BY line_no, line_id', [rows.map((r) => r.fa_id)])).rows
    : [];
  const target = Math.abs(toNumber(amount));
  const records = rows.map((r) => {
    const reversed = round2(Number(r.reversed));
    const balance = round2(Number(r.amount) - reversed);
    return {
      ...rowOut(r),
      reversed,
      balance,
      amountMatches: target > 0 && (Math.abs(Number(r.amount) - target) < 0.01 || Math.abs(balance - target) < 0.01),
      exact: normalizeKey(r.inv_no) === normalizeKey(term),
      sameHead: Boolean(text(expenseHead)) && normalizeKey(r.expense_head) === normalizeKey(expenseHead),
      products: lines.filter((l) => l.fa_id === r.fa_id).map((l) => ({
        product: l.product, quantity: Number(l.quantity), taggable: l.taggable, productAmount: Number(l.product_amount),
      })),
    };
  });
  records.sort((a, b) => (b.exact - a.exact) || (b.amountMatches - a.amountMatches) || (b.sameHead - a.sameHead));
  return { records: records.slice(0, 20), more: rows.length > 20 };
}

// getProductNames: Product Master names for the product suggestions
async function getProductNames() {
  const { rows } = await pool.query('SELECT product_name FROM products ORDER BY product_id');
  return rows.map((r) => r.product_name);
}

module.exports = {
  saveFAData,
  saveBulkData,
  bulkRecordsFromRows,
  getFAData,
  getFAPage,
  getFAFilterOptions,
  getFARecord,
  getPendingRecords,
  autoMapNonTaggable,
  validateProducts,
  saveQtyPlotting,
  updateFARecord,
  deleteFARecord,
  bulkDeleteFA,
  exportFAData,
  exportFAStream,
  exportRowsOf,
  bulkEditRecordsFromRows,
  updateFABulkEdit,
  getUploadDateRange,
  getProductNames,
  findOriginalInvoices,
  EXPORT_HEADERS,
  saveProductNames,
};
