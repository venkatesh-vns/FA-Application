// Period Reports: view and export the records of any month, quarter,
// financial year (April - March), calendar year or date range.
const { pool } = require('../config/db');
const { logActivity } = require('../utils/activity');
const { normalizeKey, text, round2, formatDate } = require('../utils/values');
const { recordFilter } = require('../utils/recordFilter');
const { reportQuery } = require('../utils/runAll');
const { exportFAStream } = require('./faService');
const { famsTemplateStream } = require('./reportService');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// 'YYYY-MM' (Tally booking month) or 'YYYY-MM-DD' -> month, quarter and financial year
// (Q1 Apr-Jun, Q2 Jul-Sep, Q3 Oct-Dec, Q4 Jan-Mar)
function periodOf(iso) {
  const [y, m] = String(iso).split('-').map(Number);
  const fyStart = m >= 4 ? y : y - 1;
  const fy = `FY ${fyStart}-${String((fyStart + 1) % 100).padStart(2, '0')}`;
  const q = Math.floor(((m + 8) % 12) / 3) + 1;
  return {
    monthKey: `${y}-${String(m).padStart(2, '0')}`,
    month: `${MONTHS[m - 1]} ${y}`,
    quarterKey: `${fyStart}-Q${q}`,
    quarter: `Q${q} ${fy}`,
    fyKey: String(fyStart),
    fy,
  };
}


const blank = (extra) => ({ ...extra, records: 0, amount: 0, plotted: 0, completed: 0, pending: 0, creditNotes: 0, creditAmount: 0 });
const money = (g) => ({ ...g, amount: round2(g.amount), plotted: round2(g.plotted), creditAmount: round2(g.creditAmount) });
// adds one SQL group row (records, amount, completed, credit notes, plotted) to g
function addGroup(g, r) {
  g.records += r.records;
  g.amount += Number(r.amount);
  g.plotted += Number(r.plotted);
  g.completed += r.completed;
  g.pending += r.records - r.completed;
  g.creditNotes += r.credit_notes;
  g.creditAmount += Number(r.credit_amount);
  return g;
}
// Product type of a line for the reports
const typeOf = (taggable) => {
  const t = normalizeKey(taggable);
  if (t === 'taggable') return 'Taggable';
  if (t === 'non taggable' || t === 'nontaggable') return 'Non Taggable';
  return 'Unclassified';
};

// adds a merged group (by normalized key) to map
const into = (map, key, extra) => { if (!map[key]) map[key] = blank(extra); return map[key]; };

/**
 * getPeriodReport: totals of the period and the same records grouped by
 * month, quarter, financial year, expense head, cost center and product.
 * PostgreSQL groups by the stored values (fast hash grouping over a year of
 * data); case / space variants are merged here (normalizeKey). The records
 * themselves are read a page at a time (getPeriodRecords).
 */
async function getPeriodReport(filters = {}) {
  const { where, params } = recordFilter(filters);
  const [grouped, distinct, lineTypes, products, branches, ccList, range] = await Promise.all([
    // records by Tally month x expense head x cost center, with their plotted amount
    reportQuery(`SELECT f.book_month, f.expense_head, f.cost_center, COUNT(*)::int AS records, SUM(f.amount) AS amount,
        COALESCE(SUM(l.plotted), 0) AS plotted, SUM(CASE WHEN f.status = 'Completed' THEN 1 ELSE 0 END)::int AS completed,
        SUM(CASE WHEN f.amount < 0 THEN 1 ELSE 0 END)::int AS credit_notes, SUM(CASE WHEN f.amount < 0 THEN f.amount ELSE 0 END) AS credit_amount
      FROM fa_records f
      LEFT JOIN (SELECT q.fa_id, SUM(q.product_amount) AS plotted FROM qty_lines q JOIN fa_records f ON f.fa_id = q.fa_id ${where} GROUP BY 1) l
        ON l.fa_id = f.fa_id
      ${where} GROUP BY 1, 2, 3`, params),
    pool.query(`SELECT COUNT(DISTINCT LOWER(TRIM(f.inv_no)))::int AS invoices, COUNT(DISTINCT LOWER(TRIM(f.vendor)))::int AS vendors,
        MIN(f.inv_date) AS from_date, MAX(f.inv_date) AS to_date FROM fa_records f ${where}`, params),
    reportQuery(`SELECT f.expense_head, q.taggable, SUM(q.product_amount) AS amount, SUM(q.quantity) AS quantity
      FROM qty_lines q JOIN fa_records f ON f.fa_id = q.fa_id ${where} GROUP BY 1, 2`, params),
    // products with the number of FA records (lines summed per record first)
    reportQuery(`SELECT x.product, x.taggable, SUM(x.quantity) AS quantity, SUM(x.amount) AS amount, COUNT(*)::int AS records
      FROM (SELECT q.fa_id, q.product, q.taggable, SUM(q.quantity) AS quantity, SUM(q.product_amount) AS amount
            FROM qty_lines q JOIN fa_records f ON f.fa_id = q.fa_id ${where} GROUP BY 1, 2, 3) x GROUP BY 1, 2`, params),
    pool.query('SELECT cost_center, branch, location FROM branch_master ORDER BY id'),
    pool.query("SELECT DISTINCT TRIM(cost_center) AS cc FROM fa_records WHERE TRIM(cost_center) <> '' ORDER BY 1"),
    pool.query("SELECT MIN(book_month) || '-01' AS from_date, MAX(book_month) || '-01' AS to_date FROM fa_records"),
  ]);

  const branchOf = {};
  branches.rows.forEach((b) => { if (normalizeKey(b.cost_center)) branchOf[normalizeKey(b.cost_center)] = b; });

  const totals = blank({});
  const months = {}; const quarters = {}; const years = {}; const heads = {}; const centers = {};
  grouped.rows.forEach((r) => {
    const p = periodOf(r.book_month);
    const head = text(r.expense_head) || '(Blank)';
    const cc = text(r.cost_center) || '(Blank)';
    const br = branchOf[normalizeKey(r.cost_center)] || {};
    addGroup(totals, r);
    addGroup(into(months, p.monthKey, { key: p.monthKey, month: p.month, quarter: p.quarter, fy: p.fy }), r);
    addGroup(into(quarters, p.quarterKey, { key: p.quarterKey, quarter: p.quarter, fy: p.fy }), r);
    addGroup(into(years, p.fyKey, { key: p.fyKey, fy: p.fy }), r);
    addGroup(into(heads, normalizeKey(head), { expenseHead: head, taggable: 0, nonTaggable: 0 }), r);
    addGroup(into(centers, normalizeKey(cc), { costCenter: cc, branch: text(br.branch), location: text(br.location) }), r);
  });

  let taggable = 0; let nonTaggable = 0; let quantity = 0;
  lineTypes.rows.forEach((r) => {
    const h = heads[normalizeKey(text(r.expense_head) || '(Blank)')];
    const a = Number(r.amount);
    const type = typeOf(r.taggable);
    quantity += Number(r.quantity);
    if (type === 'Taggable') { taggable += a; if (h) h.taggable += a; }
    if (type === 'Non Taggable') { nonTaggable += a; if (h) h.nonTaggable += a; }
  });

  const prod = {};
  products.rows.forEach((r) => {
    const type = typeOf(r.taggable);
    const name = text(r.product);
    const k = `${normalizeKey(name)}|${type}`;
    if (!prod[k]) prod[k] = { product: name, type, quantity: 0, amount: 0, records: 0 };
    prod[k].quantity += Number(r.quantity);
    prod[k].amount += Number(r.amount);
    prod[k].records += r.records;
  });

  const d = distinct.rows[0];
  const byKey = (a, b) => a.key.localeCompare(b.key);
  const byAmount = (a, b) => Math.abs(b.amount) - Math.abs(a.amount);
  return {
    totals: {
      ...money(totals), taggable: round2(taggable), nonTaggable: round2(nonTaggable), quantity: round2(quantity),
      invoices: d.invoices, vendors: d.vendors,
      fromDate: d.from_date ? formatDate(d.from_date) : '', toDate: d.to_date ? formatDate(d.to_date) : '',
    },
    months: Object.values(months).map(money).sort(byKey),
    quarters: Object.values(quarters).map(money).sort(byKey),
    years: Object.values(years).map(money).sort(byKey),
    expenseHeads: Object.values(heads).map((g) => ({ ...money(g), taggable: round2(g.taggable), nonTaggable: round2(g.nonTaggable) })).sort(byAmount),
    costCenters: Object.values(centers).map(money).sort(byAmount),
    products: Object.values(prod).map((g) => ({ ...g, quantity: round2(g.quantity), amount: round2(g.amount) })).sort(byAmount),
    recordCount: totals.records,
    costCenterOptions: ccList.rows.map((r) => r.cc),
    dataRange: { from: range.rows[0].from_date || '', to: range.rows[0].to_date || '' },
  };
}

/**
 * getPeriodRecords: one page of the period's records (Records tab), by
 * invoice date; filters.search looks in every column (recordFilter). The
 * plotted amount and product count are added for that page only.
 * Returns { rows, total, page, size }.
 */
async function getPeriodRecords(filters = {}) {
  const { where, params } = recordFilter(filters);
  const size = Math.min(Math.max(Number(filters.size) || 10, 1), 500);
  const page = Math.max(Number(filters.page) || 1, 1);
  const [count, recs] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS n FROM fa_records f ${where}`, params),
    pool.query(`SELECT f.* FROM fa_records f ${where} ORDER BY f.inv_date, f.fa_id LIMIT ${size} OFFSET ${(page - 1) * size}`, params),
  ]);
  const ids = recs.rows.map((r) => r.fa_id);
  const lines = ids.length
    ? (await pool.query('SELECT fa_id, SUM(product_amount) AS plotted, COUNT(*)::int AS n FROM qty_lines WHERE fa_id = ANY($1) GROUP BY 1', [ids])).rows
    : [];
  const byId = Object.fromEntries(lines.map((l) => [l.fa_id, l]));
  return {
    total: count.rows[0].n, page, size,
    rows: recs.rows.map((r) => ({
      faCode: r.fa_code, invNo: r.inv_no, date: formatDate(r.inv_date), month: periodOf(r.book_month).month, bookMonth: r.book_month,
      costCenter: r.cost_center, vendor: r.vendor, expenseHead: r.expense_head, amount: Number(r.amount),
      plotted: round2(Number(byId[r.fa_id]?.plotted || 0)), products: byId[r.fa_id]?.n || 0, status: r.status,
    })),
  };
}

// ---------------- Excel ----------------

const PERIOD_COLS = ['Records', 'Amount', 'Qty Plotted Amount', 'Completed', 'Pending', 'Credit Notes', 'Credit Note Amount'];
const periodCells = (g) => [g.records, g.amount, g.plotted, g.completed, g.pending, g.creditNotes, g.creditAmount];

// Summary sheets of a period report
function summarySheets(report, label, costCenters) {
  const t = report.totals;
  const summary = [
    ['Period Report', label],
    ['Cost Center', costCenters.length ? costCenters.join(', ') : 'All cost centers'],
    ['Invoice dates in data', t.records ? `${t.fromDate} to ${t.toDate}` : 'No records'],
    ['Generated', new Date().toLocaleString('en-IN')],
    [],
    ['Measure', 'Value'],
    ['FA Records', t.records], ['Invoices', t.invoices], ['Vendors', t.vendors],
    ['Total Amount', t.amount], ['Qty Plotted Amount', t.plotted],
    ['Taggable Amount', t.taggable], ['Non Taggable Amount', t.nonTaggable],
    ['Completed', t.completed], ['Pending Qty Plotting', t.pending],
    ['Credit Notes / Reversals', t.creditNotes], ['Credit Note Amount', t.creditAmount],
  ];
  return [
    { name: 'Summary', rows: summary },
    { name: 'Month-wise', rows: [['Tally Booking Month', 'Quarter', 'Financial Year', ...PERIOD_COLS], ...report.months.map((g) => [g.month, g.quarter, g.fy, ...periodCells(g)])] },
    { name: 'Quarter-wise', rows: [['Quarter', 'Financial Year', ...PERIOD_COLS], ...report.quarters.map((g) => [g.quarter, g.fy, ...periodCells(g)])] },
    { name: 'Financial Year-wise', rows: [['Financial Year', ...PERIOD_COLS], ...report.years.map((g) => [g.fy, ...periodCells(g)])] },
    { name: 'Expense Head-wise', rows: [['Expense Head', ...PERIOD_COLS, 'Taggable Amount', 'Non Taggable Amount'], ...report.expenseHeads.map((g) => [g.expenseHead, ...periodCells(g), g.taggable, g.nonTaggable])] },
    { name: 'Cost Center-wise', rows: [['Cost Center', 'Branch', 'Location', ...PERIOD_COLS], ...report.costCenters.map((g) => [g.costCenter, g.branch, g.location, ...periodCells(g)])] },
    { name: 'Product-wise', rows: [['Product / Asset Description', 'Taggable / Non Taggable', 'Quantity', 'Amount', 'FA Records'], ...report.products.map((g) => [g.product, g.type, g.quantity, g.amount, g.records])] },
  ];
}

const EXPORTS = {
  summary: { title: 'Period Summary', file: 'Period_Summary' },
  detail: { title: 'FA Data', file: 'FA_Data' },
  fams: { title: 'FAMS Template', file: 'FAMS_Template' },
  complete: { title: 'Complete Workbook', file: 'Period_Report' },
};

/**
 * exportPeriod: the sheets of one export type for the period
 *   summary  - Summary, Month / Quarter / FY / Expense Head / Cost Center / Product-wise
 *   detail   - FA Data (one row per product, as FA Data > Export)
 *   fams     - FAMS Template (as the FAMS Template screen)
 *   complete - all of the above in one workbook
 * Returns { sheets, fileName, rowCount }
 */
async function exportPeriod(user, type, filters = {}) {
  const kind = EXPORTS[type] ? type : 'summary';
  const label = text(filters.label) || 'All data';
  const costCenters = [].concat(filters.costCenter || []).map(text).filter(Boolean);
  const sheets = [];
  let rowCount = 0;

  if (kind === 'summary' || kind === 'complete') {
    const report = await getPeriodReport(filters);
    sheets.push(...summarySheets(report, label, costCenters));
    rowCount = report.totals.records;
  }
  // FA Data and FAMS rows are streamed (read in batches while the file is written)
  if (kind === 'detail' || kind === 'complete') {
    const { count, rows } = await exportFAStream(filters);
    sheets.push({ name: 'FA Data', rows });
    rowCount = count;
  }
  if (kind === 'fams') {
    const { count, rows } = await famsTemplateStream(user, filters);
    sheets.push({ name: 'FAMS Template', rows });
    rowCount = count;
  }
  if (kind === 'complete') {
    try {
      sheets.push({ name: 'FAMS Template', rows: (await famsTemplateStream(user, filters)).rows });
    } catch {
      sheets.push({ name: 'FAMS Template', rows: [['No Qty Plotting data in the selected period.']] });
    }
  }

  if (kind !== 'fams') {
    await logActivity(user, 'Period Report Exported', 'Period Reports', '', '', '',
      `${EXPORTS[kind].title}, Period: ${label}${costCenters.length ? `, Cost Center: ${costCenters.length}` : ''}`);
  }
  const safe = label.replace(/[^A-Za-z0-9-]+/g, '_').replace(/^_|_$/g, '') || 'All';
  return { sheets, fileName: `${EXPORTS[kind].file}_${safe}.xlsx`, rowCount };
}

module.exports = { getPeriodReport, getPeriodRecords, exportPeriod, periodOf };
