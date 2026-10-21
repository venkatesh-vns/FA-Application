// Dashboard, LWM and FAMS Template, ported from Code.gs:
// getDashboardData, saveLWMData, resetLWMData, getLWMComparison,
// generateFAMSTemplate. (Data Archiving was removed on request.)
const { pool, withTransaction } = require('../config/db');
const { httpError } = require('../utils/httpError');
const { logActivity } = require('../utils/activity');
const { normalizeKey, text, toNumber, round2, parseDate, formatDate } = require('../utils/values');

const { recordFilter } = require('../utils/recordFilter');
const { runAll, reportQuery } = require('../utils/runAll');
const { monthLabel, parseMonth, currentMonth, assertMonthEditable } = require('../utils/months');

const fail = (message) => httpError(400, message);

// ------------------------------------------------------------
// Dashboard
// ------------------------------------------------------------

const assetType = (taggable) => {
  const t = normalizeKey(taggable);
  if (t === 'taggable') return 'Taggable';
  if (t === 'non taggable' || t === 'nontaggable') return 'Non-Taggable';
  return 'Unclassified';
};

/**
 * Totals of the live records, plus Qty Plotting summarised two ways:
 *   ledgerSummary   - Cost Center x Asset Type x Ledger, with its products
 *   buildingSummary - Building (Branch Master, by Cost Center) x Cost Center x Asset Type
 * Optional filters: costCenter (exact, any case), from / to (invoice date, YYYY-MM-DD).
 * `costCenters` lists every cost center for the filter, whatever is filtered.
 */
async function getDashboardData(filters = {}) {
  const { where: w, params } = recordFilter({ costCenter: filters.costCenter, from: filters.from, to: filters.to });
  // Qty Plotting summed in PostgreSQL by the stored values (fast hash grouping
  // over 300,000+ lines); case / space variants are merged below (normalizeKey)
  const [totals, groups, buildingRows, branches, ccList, range] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS total, COALESCE(SUM(f.amount), 0) AS amount,
        SUM(CASE WHEN f.status = 'Completed' THEN 1 ELSE 0 END)::int AS completed FROM fa_records f ${w}`, params),
    // Cost Center x Taggable x Ledger x Product
    reportQuery(`SELECT f.cost_center, q.taggable, f.expense_head, q.product, SUM(q.quantity) AS quantity, SUM(q.product_amount) AS amount
      FROM qty_lines q JOIN fa_records f ON f.fa_id = q.fa_id ${w} GROUP BY 1, 2, 3, 4`, params),
    // Cost Center x Taggable with the number of FA records (lines summed per record first)
    reportQuery(`SELECT f.cost_center, x.taggable, SUM(x.quantity) AS quantity, SUM(x.amount) AS amount, COUNT(*)::int AS fa_count
      FROM (SELECT q.fa_id, q.taggable, SUM(q.quantity) AS quantity, SUM(q.product_amount) AS amount
            FROM qty_lines q JOIN fa_records f ON f.fa_id = q.fa_id ${w} GROUP BY 1, 2) x
      JOIN fa_records f ON f.fa_id = x.fa_id GROUP BY 1, 2`, params),
    pool.query('SELECT * FROM branch_master ORDER BY id'),
    pool.query("SELECT DISTINCT TRIM(cost_center) AS cc FROM fa_records WHERE TRIM(cost_center) <> '' ORDER BY 1"),
    pool.query(`SELECT MIN(f.inv_date) AS from_date, MAX(f.inv_date) AS to_date FROM fa_records f ${w}`, params),
  ]);

  const t = totals.rows[0];
  const totalFA = t.total;
  const completedFA = t.completed || 0;
  const branchMap = {};
  branches.rows.forEach((b) => {
    const cc = normalizeKey(b.cost_center);
    if (cc) branchMap[cc] = { branch: text(b.branch), branchCode: text(b.branch_code), location: text(b.location) };
  });

  let plottedAmount = 0;
  const ledgerMap = {};
  groups.rows.forEach((g) => {
    const type = assetType(g.taggable);
    const cc = text(g.cost_center) || '(Blank Cost Center)';
    const ledger = text(g.expense_head) || '(Blank Ledger)';
    const product = text(g.product) || '(Blank Product)';
    const quantity = Number(g.quantity);
    const amount = Number(g.amount);
    plottedAmount += amount;
    const lk = normalizeKey(`${cc}|${type}|${ledger}`);
    if (!ledgerMap[lk]) ledgerMap[lk] = { ledger, type, costCenter: cc, quantity: 0, amount: 0, products: {} };
    const li = ledgerMap[lk];
    li.quantity += quantity;
    li.amount += amount;
    const pk = normalizeKey(product);
    if (!li.products[pk]) li.products[pk] = { product, quantity: 0, amount: 0 };
    li.products[pk].quantity += quantity;
    li.products[pk].amount += amount;
  });

  const buildingMap = {};
  buildingRows.rows.forEach((g) => {
    const type = assetType(g.taggable);
    const cc = text(g.cost_center) || '(Blank Cost Center)';
    const info = branchMap[normalizeKey(g.cost_center)] || {};
    const building = info.branch || info.location || '(Branch Not Mapped)';
    const bk = normalizeKey(`${building}|${cc}|${type}`);
    if (!buildingMap[bk]) buildingMap[bk] = { building, costCenter: cc, type, quantity: 0, amount: 0, faCount: 0 };
    const bi = buildingMap[bk];
    bi.quantity += Number(g.quantity);
    bi.amount += Number(g.amount);
    bi.faCount += g.fa_count;
  });

  const ledgerSummary = Object.values(ledgerMap).map((item) => ({
    ...item,
    quantity: round2(item.quantity),
    amount: round2(item.amount),
    products: Object.values(item.products).map((p) => ({ ...p, quantity: round2(p.quantity), amount: round2(p.amount) })).sort((a, b) => a.product.localeCompare(b.product)),
  })).sort((a, b) => a.costCenter.localeCompare(b.costCenter) || a.ledger.localeCompare(b.ledger) || a.type.localeCompare(b.type));

  const buildingSummary = Object.values(buildingMap).map((item) => ({ ...item, quantity: round2(item.quantity), amount: round2(item.amount) }))
    .sort((a, b) => a.building.localeCompare(b.building) || a.costCenter.localeCompare(b.costCenter) || a.type.localeCompare(b.type));

  return {
    totalFA, pendingFA: totalFA - completedFA, completedFA, totalAmount: round2(Number(t.amount)), plottedAmount: round2(plottedAmount),
    ledgerSummary, buildingSummary,
    costCenters: ccList.rows.map((r) => r.cc), dateRange: { fromDate: formatDate(range.rows[0].from_date), toDate: formatDate(range.rows[0].to_date) },
  };
}

// ------------------------------------------------------------
// LWM - Ledger Wise Matching
// ------------------------------------------------------------

// Uploaded Tally rows -> [{ expenseHead, amount }] (uploadLWMCSV)
function lwmRecordsFromRows(rows) {
  if (!rows || rows.length < 2) throw fail('File does not contain any data rows.');
  const headers = rows[0].map((h) => text(h).toLowerCase());
  const expenseIndex = headers.includes('expanse head') ? headers.indexOf('expanse head') : headers.indexOf('expense head');
  const amountIndex = headers.indexOf('amount');
  if (expenseIndex === -1) throw fail('Missing column: Expanse Head');
  if (amountIndex === -1) throw fail('Missing column: Amount');
  const out = rows.slice(1).filter((r) => r.some((v) => text(v))).map((r) => ({ expenseHead: r[expenseIndex], amount: r[amountIndex] }));
  if (!out.length) throw fail('No valid Tally rows found.');
  return out;
}

// Tally Booking Month of an LWM request ('YYYY-MM'); required for changes
function lwmMonth(value, required = true) {
  const m = parseMonth(value);
  if (!m && required) throw fail('Choose the Tally Booking Month.');
  return m || currentMonth();
}

// saveLWMData: a new Tally upload REPLACES the previous one of that month
async function saveLWMData(user, records, month) {
  const bookMonth = lwmMonth(month);
  if (!Array.isArray(records) || !records.length) throw fail('No LWM data received.');
  const errors = [];
  const rows = [];
  records.forEach((item, index) => {
    const expenseHead = text(item.expenseHead);
    if (!expenseHead) { errors.push(`Row ${index + 2}: Expanse Head is blank.`); return; }
    rows.push([expenseHead, round2(toNumber(item.amount))]);
  });
  if (!rows.length) throw fail('No valid LWM rows found.');
  await withTransaction(async (db) => {
    await assertMonthEditable(db, user, bookMonth, { create: true });
    await db.query('DELETE FROM lwm_tally WHERE book_month = $1', [bookMonth]);
    for (const r of rows) await db.query('INSERT INTO lwm_tally (expense_head, amount, book_month) VALUES ($1, $2, $3)', [...r, bookMonth]);
    await logActivity(user, 'LWM Upload', 'LWM', '', '', '', `${rows.length} Tally row(s) for ${monthLabel(bookMonth)}`, db);
  });
  return {
    success: true, saved: rows.length, errors,
    message: `${rows.length} Tally row(s) uploaded for ${monthLabel(bookMonth)}. The previous upload of that month was replaced.`,
  };
}

async function resetLWMData(user, month) {
  const bookMonth = lwmMonth(month);
  await withTransaction(async (db) => {
    await assertMonthEditable(db, user, bookMonth);
    await db.query('DELETE FROM lwm_tally WHERE book_month = $1', [bookMonth]);
    await logActivity(user, 'LWM Reset', 'LWM', '', '', '', monthLabel(bookMonth), db);
  });
  return { success: true, message: `LWM Tally data of ${monthLabel(bookMonth)} has been reset.` };
}

/**
 * getLWMComparison: FA amount vs Tally amount per expense head for one Tally
 * Booking Month (default: the current month); Difference = FA - Tally;
 * Matched when within 0.01.
 */
async function getLWMComparison(month, db = pool) {
  const bookMonth = lwmMonth(month, false);
  const [fa, lwm] = await runAll(db, [
    () => db.query('SELECT expense_head, amount FROM fa_records WHERE book_month = $1 ORDER BY fa_id', [bookMonth]),
    () => db.query('SELECT expense_head, amount FROM lwm_tally WHERE book_month = $1 ORDER BY lwm_id', [bookMonth]),
  ]);
  const map = {};
  const entry = (head) => {
    const key = normalizeKey(head);
    if (!map[key]) map[key] = { expenseHead: text(head), faAmount: 0, tallyAmount: 0 };
    return map[key];
  };
  fa.rows.forEach((r) => { if (text(r.expense_head)) entry(r.expense_head).faAmount += Number(r.amount); });
  lwm.rows.forEach((r) => { if (text(r.expense_head)) entry(r.expense_head).tallyAmount += Number(r.amount); });

  const rows = Object.values(map).map((item) => {
    const difference = round2(item.faAmount - item.tallyAmount);
    return {
      expenseHead: item.expenseHead,
      faAmount: round2(item.faAmount),
      tallyAmount: round2(item.tallyAmount),
      difference,
      status: Math.abs(difference) <= 0.01 ? 'Matched' : 'Difference',
    };
  }).sort((a, b) => a.expenseHead.localeCompare(b.expenseHead));

  const totalFA = round2(rows.reduce((s, r) => s + r.faAmount, 0));
  const totalTally = round2(rows.reduce((s, r) => s + r.tallyAmount, 0));
  return {
    month: bookMonth, monthLabel: monthLabel(bookMonth),
    rows, totalFA, totalTally, totalDifference: round2(totalFA - totalTally), hasTallyData: lwm.rows.length > 0,
    matched: lwm.rows.length > 0 && rows.every((r) => r.status === 'Matched'),
  };
}

// ------------------------------------------------------------
// FAMS Template
// ------------------------------------------------------------

const FAMS_TEMPLATE_HEADERS = [
  'Acquired Type*', 'Branch*', 'Acquired Sub Type*', 'Asset Description*', 'Is Closing Balance Year Asset', 'Parent Asset Code',
  'Depreciation Calculation For this Asset', 'Shifted From', 'Original Date Put To Use', 'Physical ID', 'Item Code', 'Machine/Tag No',
  'In Store*', 'Quantity*', 'Is Multiple Entries*', 'Group Qty*', 'Physical Verification*', 'Vendor', 'Department', 'Asset Type*', 'Asset User',
  'Cost Center', 'Purchase Order Date', 'Purchase Date*', 'Purchase Order No', 'Date Put To Use', 'Location', 'Latitude', 'Longitude', 'Radius',
  'Physical Location', 'Remarks', 'Vendor Invoice Number', 'Vendor Invoice Date', 'VoucherNo', 'VoucherDate', 'Amount*', 'AdditionalBook1Cost',
  'AdditionalBook2Cost', 'Salvage Amount', 'Salvage Amount Additional Book1', 'Salvage Amount Additional Book2', 'CenVat', 'CenVat Additional Book1',
  'CenVat Additional Book2', 'Accumulated Depreciation', 'Accumulated Depreciation Additional Book1', 'Accumulated Depreciation Additional Book2',
  'Asset Category Level I*', 'Asset Category Level II', 'Asset Category Level III', 'Asset Category Level IV', 'Life', 'Life Additional Book1',
  'Life Additional Book2', 'Life End Date', 'Life End Date Additional Book 1', 'Life End Date Additional Book 2', 'Salvage Note', 'Salvage Note Additional Book1',
  'Salvage Note Additional Book2', 'Life Note', 'Life Note Additional Book1', 'Life Note Additional Book2', 'Override Depreciation Rate',
  'Override Depreciation Rate Additional Book1', 'Override Depreciation Rate Additional Book2', 'Override Depreciation Rate Note',
  'Override Depreciation Rate Note Additional Book1', 'Override Depreciation Rate Note Additional Book2', 'Depreciable Cost As Per IT',
  'Additional Depreciation Rate As Per IT', 'Additional Depreciation Rate As Per IT Note', 'Consider Cost Per Qty for 100% Dep',
  'Consider Cost Per Qty for 100% Dep Additional Book 1', 'Consider Cost Per Qty for 100% Dep Additional Book 2', 'ConsiderforShiftCompanyBook',
  'ConsiderforShiftAddBook1', 'ConsiderforShiftAddBook2', 'Profit Center', 'WBS Element', 'TotalInvoiceAmount', 'Parentcode', 'LedgerasperTally',
  'ClientName', 'GatePass', 'TransactionData', 'AssetDescriptionOne', 'AssetDescriptionTwo', 'GSTPercentage', 'Error Remark',
];

/**
 * generateFAMSTemplate: one row per Qty Plotting line of every live record,
 * filled from the PO, Branch, Category, Description and Client / Cost Center
 * masters. Mapping problems go to the 'Error Remark' column; 'Remarks' holds
 * only the narration. Optional filters (Period Reports): from / to invoice
 * date, costCenter.
 */
async function generateFAMSTemplate(user, filters = {}) {
  const { items, active } = await buildFAMSItems(filters);
  if (!items.length) {
    throw fail(active ? 'No Qty Plotting data in the selected period.' : 'No Qty Plotting data is available for FAMS Template generation.');
  }
  const out = [FAMS_TEMPLATE_HEADERS, ...items.map((i) => i.values)];
  const period = filters.label ? `, Period: ${text(filters.label)}` : '';
  await logActivity(user, 'FAMS Template Generated', 'FAMS Template', '', '', '', `Rows: ${out.length - 1}${period}`);
  return out;
}

/**
 * FAMS rows of the filtered records: [{ lineId, faCode, values }] in FAMS
 * column order (FAMS_TEMPLATE_HEADERS). Used by the FAMS Template and the
 * month snapshots. db: run inside a transaction when given.
 */
async function buildFAMSItems(filters = {}, db = pool) {
  const items = [];
  for await (const item of famsItems(filters, db)) items.push(item);
  return { items, active: recordFilter(filters).active };
}

// Number of FAMS rows (= Qty Plotting lines) of the filtered records
async function famsCount(filters = {}, db = pool) {
  const { where, params } = recordFilter(filters);
  const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM qty_lines q JOIN fa_records f ON f.fa_id = q.fa_id ${where}`, params);
  return rows[0].n;
}

const BATCH = 2000; // records per query, so a year of data never sits in memory at once

/**
 * The FAMS rows of the filtered records, one by one (async generator of
 * { lineId, faCode, values }); records are read BATCH at a time.
 */
async function* famsItems(filters = {}, db = pool) {
  const { where, params } = recordFilter(filters);
  const [branch, cat, desc, po, clientCc] = await runAll(db, [
    () => db.query('SELECT * FROM branch_master ORDER BY id'),
    () => db.query('SELECT * FROM category_master ORDER BY id'),
    () => db.query('SELECT * FROM description_master ORDER BY id'),
    () => db.query('SELECT * FROM po_master ORDER BY id'),
    () => db.query('SELECT * FROM client_cc_master ORDER BY id'),
  ]);

  // later rows overwrite earlier ones in the original lookups (map[k] = ...)
  const lastBy = (rows, keyOf) => {
    const map = {};
    rows.forEach((r) => { const k = normalizeKey(keyOf(r)); if (k) map[k] = r; });
    return map;
  };
  const branchMap = lastBy(branch.rows, (r) => r.cost_center);
  const catMap = lastBy(cat.rows, (r) => r.expense_head);
  const descMap = lastBy(desc.rows, (r) => r.product_description);
  const poMap = lastBy(po.rows, (r) => r.po_no);
  const clientCcSet = new Set();
  clientCc.rows.forEach((r) => {
    if (text(r.client_as_per_pmo) && text(r.cost_center) && !['no', 'inactive'].includes(normalizeKey(r.status))) {
      clientCcSet.add(`${normalizeKey(r.client_as_per_pmo)}||${normalizeKey(r.cost_center)}`);
    }
  });
  const next = params.length + 1;
  const batchSql = `SELECT f.* FROM fa_records f ${where ? `${where} AND` : 'WHERE'} f.fa_id > $${next} ORDER BY f.fa_id LIMIT ${BATCH}`;
  let lastId = 0;
  for (;;) {
    const raw = await db.query(batchSql, [...params, lastId]);
    if (!raw.rows.length) break;
    lastId = raw.rows[raw.rows.length - 1].fa_id;
    const qty = await db.query('SELECT * FROM qty_lines WHERE fa_id = ANY($1) ORDER BY fa_id, line_no, line_id', [raw.rows.map((r) => r.fa_id)]);
    const linesByFa = {};
    qty.rows.forEach((q) => { (linesByFa[q.fa_id] = linesByFa[q.fa_id] || []).push(q); });

  const items = [];
  raw.rows.forEach((r) => {
    const po_ = text(r.po_no);
    const cc = text(r.cost_center);
    const expense = r.expense_head;
    const poInfo = poMap[normalizeKey(po_)];
    const br = branchMap[normalizeKey(cc)];
    const ct = catMap[normalizeKey(expense)];
    const clientFromPoPmo = poInfo ? text(poInfo.client_as_per_pmo) : '';
    const clientCcMatch = clientFromPoPmo ? clientCcSet.has(`${normalizeKey(clientFromPoPmo)}||${normalizeKey(cc)}`) : false;

    (linesByFa[r.fa_id] || []).forEach((q, productIndex) => {
      const product = q.product;
      const qnty = Number(q.quantity);
      const tag = q.taggable;
      const amount = Number(q.product_amount);
      const d = descMap[normalizeKey(product)];
      const negative = amount < 0;
      const errors = [];

      if (!po_) errors.push('PO No is blank');
      else if (!poInfo) errors.push('PO No not found in PO Client Master');
      if (poInfo && ['no', 'inactive'].includes(normalizeKey(poInfo.status))) errors.push('PO is inactive in PO Client Master');

      if (!cc) errors.push('Cost Center is blank');
      else if (!clientFromPoPmo) errors.push('Client As Per PMO not found in PO Client Master');
      else if (!clientCcMatch) errors.push('PO Client Master Client As Per PMO and Client Cost Center Master mismatch');

      if (!br) errors.push('Cost Center not found in Branch Master');
      else {
        if (!text(br.branch_code)) errors.push('Branch Code not defined for Cost Center in Branch Master');
        if (!text(br.location)) errors.push('Location not defined for Cost Center in Branch Master');
      }

      if (!d) errors.push('Asset Description not found in Description Master');
      if (d && !text(d.asset_description_two)) errors.push('AssetDescriptionTwo not defined in Description Master');
      if (d && !text(d.category_level_2)) errors.push('Asset Category Level II not defined for Asset Description in Description Master');
      if (!ct) errors.push('Expense Head not found in Category Master');
      if (ct && !text(ct.category_level_1)) errors.push('Asset Category Level I not defined in Category Master');

      if (!product) errors.push('Asset Description is blank');
      if (qnty <= 0) errors.push('Quantity is invalid');
      if (tag !== 'Taggable' && tag !== 'Non Taggable') errors.push('Taggable / Non Taggable is invalid');

      const row = Object.fromEntries(FAMS_TEMPLATE_HEADERS.map((h) => [h, '']));
      row['Acquired Type*'] = 'Purchase';
      row['Branch*'] = br ? br.branch_code : '';
      row['Acquired Sub Type*'] = negative ? 'Dependent-Child' : 'Independent';
      row['Asset Description*'] = product;
      row['Parent Asset Code'] = negative ? q.against_asset_code : '';
      row['Depreciation Calculation For this Asset'] = negative ? 'Date Put to use of Parent Asset' : '';
      row['In Store*'] = 'No';
      row['Quantity*'] = qnty;
      row['Is Multiple Entries*'] = qnty > 1 ? 'Yes' : 'No';
      row['Group Qty*'] = 1;
      row['Physical Verification*'] = tag === 'Taggable' ? 'Yes' : 'No';
      row.Vendor = r.vendor;
      row['Asset Type*'] = negative ? '' : 'Owned';
      row['Cost Center'] = cc;
      row['Purchase Order Date'] = poInfo ? text(poInfo.po_date) : '';
      row['Purchase Date*'] = formatDate(r.inv_date);
      row['Purchase Order No'] = po_;
      row.Location = br ? br.location : '';
      row['Vendor Invoice Number'] = r.inv_no;
      row['Amount*'] = amount;
      row['Asset Category Level I*'] = ct ? ct.category_level_1 : '';
      row['Asset Category Level II'] = d && text(d.category_level_2) ? d.category_level_2 : (ct ? ct.category_level_2 : '');
      row.ClientName = clientFromPoPmo;
      row.AssetDescriptionOne = expense;
      row.AssetDescriptionTwo = d ? d.asset_description_two : '';
      row.TotalInvoiceAmount = productIndex === 0 ? Number(r.amount) : '';
      row.Parentcode = r.fa_code;
      row.LedgerasperTally = expense;
      row.GSTPercentage = Number(q.gst_pct);
      row['Consider Cost Per Qty for 100% Dep'] = Math.abs(amount) < 5000 ? 'Yes' : 'No';
      row.Remarks = r.narration;
      row['Error Remark'] = errors.join(' | ');
      items.push({ lineId: q.line_id, faCode: r.fa_code, values: FAMS_TEMPLATE_HEADERS.map((h) => row[h]) });
    });
  });
    yield* items;
    if (raw.rows.length < BATCH) break;
  }
}

/**
 * FAMS Template as a stream for a download: { count, rows } where rows yields
 * the header and then each FAMS row. Throws when there is nothing to export.
 */
async function famsTemplateStream(user, filters = {}) {
  const { active } = recordFilter(filters);
  const count = await famsCount(filters);
  if (!count) throw fail(active ? 'No Qty Plotting data in the selected period.' : 'No Qty Plotting data is available for FAMS Template generation.');
  const period = filters.label ? `, Period: ${text(filters.label)}` : '';
  await logActivity(user, 'FAMS Template Generated', 'FAMS Template', '', '', '', `Rows: ${count}${period}`);
  async function* rows() {
    yield FAMS_TEMPLATE_HEADERS;
    for await (const item of famsItems(filters)) yield item.values;
  }
  return { count, rows: rows() };
}

module.exports = {
  getDashboardData, lwmRecordsFromRows, saveLWMData, resetLWMData, getLWMComparison,
  FAMS_TEMPLATE_HEADERS, generateFAMSTemplate, buildFAMSItems, famsItems, famsCount, famsTemplateStream,
};
