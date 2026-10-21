// REST API. Each route calls the service function named after the Code.gs
// function it replaces. Every route except login needs a session; Users,
// FA bulk edit and bulk delete are Admin only.
const express = require('express');
const fs = require('fs');
const { authenticate, requireAdmin, ping, IDLE_MINUTES } = require('../middleware/auth');
const { upload } = require('../middleware/upload');
const { httpError } = require('../utils/httpError');
const { pool } = require('../config/db');
const { buildWorkbook, sendWorkbook, streamWorkbook, readRows, fileStamp } = require('../utils/excel');
const { text } = require('../utils/values');
const fa = require('../services/faService');
const masters = require('../services/masterService');
const reports = require('../services/reportService');
const users = require('../services/userService');
const period = require('../services/periodService');
const months = require('../services/monthService');
const qtyLocks = require('../services/qtyLockService');
const archive = require('../services/archiveService');
const releases = require('../services/releaseService');
const { appInfo, releaseNotes } = require('../utils/version');

const router = express.Router();
const go = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).then((out) => { if (out !== undefined) res.json(out); }).catch(next);

// Reads the uploaded Excel file, then deletes it
const withFile = (fn) => go(async (req, res) => {
  if (!req.file) throw httpError(400, 'Please select the Excel file.');
  try {
    return await fn(await readRows(req.file.path), req, res);
  } finally {
    fs.unlink(req.file.path, () => {});
  }
});
const file = upload.single('file');
const adminOnly = requireAdmin;

// ---------------- Login ----------------
// ---------------- Version (no sign-in needed: login screen) ----------------
router.get('/app-info', go(() => appInfo()));
router.get('/release-notes', go(() => ({ app: appInfo(), notes: releaseNotes() })));

router.post('/auth/login', go((req) => users.login(req.body.username, req.body.password, {
  userAgent: req.headers['user-agent'] || '',
  ip: req.ip || '',
})));
router.use(authenticate);
router.post('/auth/logout', go((req) => users.logout(req.tokenHash)));
router.get('/auth/me', go((req) => ({ success: true, idleMinutes: IDLE_MINUTES, user: { username: req.user.username, name: req.user.name, role: req.user.role } })));
router.post('/auth/ping', go((req) => ping(req)));

// ---------------- Raw Data / FA Data ----------------
router.get('/fa', go(() => fa.getFAData()));
router.get('/fa/date-range', go(() => fa.getUploadDateRange()));
router.get('/fa/page', go((req) => fa.getFAPage(req.query)));
router.get('/fa/filter-options', go(() => fa.getFAFilterOptions()));
router.get('/fa/template', go(async (req, res) => {
  const d = new Date();
  const sample = ['INV-001', `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`,
    'PO-001', 'CC-001', '100000', 'ABC Vendor', 'Computer Equipment', 'Example - delete this row',
    `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]}-${d.getFullYear()}`];
  await sendWorkbook(res, 'FA_Bulk_Upload_Template.xlsx', buildWorkbook([{
    name: 'FA Bulk Upload',
    rows: [['Inv No', 'Date', 'PO No', 'Cost Center', 'Amount', 'Vendor', 'Expense Head', 'Narration', 'Tally Booking Month'], sample],
  }]));
}));
router.post('/fa', go((req) => fa.saveFAData(req.user, req.body)));
router.post('/fa/bulk-upload', file, withFile((rows, req) => fa.saveBulkData(req.user, fa.bulkRecordsFromRows(rows), req.body.bookMonth)));
router.get('/fa/original-invoices', go((req) => fa.findOriginalInvoices(req.query)));
router.get('/fa/export', go(async (req, res) => {
  const { count, rows } = await fa.exportFAStream();
  await streamWorkbook(res, `FA_Data_Export_${fileStamp()}.xlsx`, [{ name: 'FA Data Export', rows }], { rowCount: count });
}));
router.post('/fa/bulk-edit', adminOnly('Only Admin can bulk edit FA Data.'), file,
  withFile((rows, req) => fa.updateFABulkEdit(req.user, fa.bulkEditRecordsFromRows(rows))));
router.get('/fa/:faCode', go((req) => fa.getFARecord(req.params.faCode)));
router.put('/fa/:faCode', go((req) => fa.updateFARecord(req.user, { ...req.body, faCode: req.params.faCode })));
router.delete('/fa/:faCode', go((req) => fa.deleteFARecord(req.user, req.params.faCode)));
// Delete the records shown by the FA Data filter (or only their Qty Plotting)
router.post('/fa-bulk-delete', adminOnly('Only Admin can delete FA records in bulk.'), go((req) => fa.bulkDeleteFA(req.user, req.body)));

// ---------------- Qty Plotting ----------------
router.get('/qty/pending', go((req) => fa.getPendingRecords(req.user)));
// Reserve / keep / release an invoice for Qty Plotting (Admin may release anyone's)
router.post('/qty/lock/:faCode', go((req) => qtyLocks.claim(req.user, req.params.faCode)));
router.post('/qty/lock/:faCode/keep', go((req) => qtyLocks.keepAlive(req.user, req.params.faCode)));
router.delete('/qty/lock/:faCode', go((req) => qtyLocks.release(req.user, req.params.faCode, { admin: req.user.isAdmin && req.query.any === '1' })));
router.post('/qty', go((req) => fa.saveQtyPlotting(req.user, req.body)));
router.get('/products', go(() => fa.getProductNames()));

// ---------------- Ledger Master ----------------
router.get('/ledgers', go(() => masters.getLedgerMaster()));
router.post('/ledgers', go((req) => masters.saveLedgerMapping(req.user, req.body)));
router.delete('/ledgers/:id', go((req) => masters.deleteLedgerMapping(req.user, req.params.id)));

// ---------------- Masters ----------------
router.get('/masters', go(() => masters.masterDefinitions()));
router.get('/masters/:type', go((req) => masters.getMasterRecords(req.params.type)));
router.get('/masters/:type/template', go(async (req, res) => {
  const cfg = masters.configOf(req.params.type);
  await sendWorkbook(res, `${req.params.type}_Master_Template.xlsx`, buildWorkbook([{ name: cfg.title, rows: [cfg.fields.map(([h]) => h)] }]));
}));
router.get('/masters/:type/export', go(async (req, res) => {
  const out = await masters.exportMasterData(req.params.type);
  res.setHeader('X-Row-Count', String(out.rows.length - 1));
  await sendWorkbook(res, `${req.params.type}_Master_Export_${fileStamp()}.xlsx`, buildWorkbook([{ name: 'Master Export', rows: out.rows }]));
}));
router.post('/masters/:type', go((req) => masters.saveMasterRecord(req.user, req.params.type, req.body)));
router.delete('/masters/:type/:id', go((req) => masters.deleteMasterRecord(req.user, req.params.type, req.params.id)));
router.post('/masters/:type/bulk-upload', file, withFile((rows, req) => masters.saveMasterBulk(req.user, req.params.type, rows)));
router.post('/masters/:type/bulk-edit', file, withFile((rows, req) => masters.updateMasterBulk(req.user, req.params.type, rows)));

// ---------------- Dashboard ----------------
router.get('/dashboard', go((req) => reports.getDashboardData(req.query)));

// ---------------- LWM ----------------
router.get('/lwm', go((req) => reports.getLWMComparison(req.query.month)));
router.get('/lwm/template', go(async (req, res) => {
  await sendWorkbook(res, 'LWM_Ledger_Wise_Matching_Template.xlsx', buildWorkbook([{
    name: 'LWM Template', rows: [['Expanse Head', 'Amount'], ['Air Conditioners', 100000]],
  }]));
}));
router.post('/lwm/upload', file, withFile((rows, req) => reports.saveLWMData(req.user, reports.lwmRecordsFromRows(rows), req.body.month)));
router.delete('/lwm', go((req) => reports.resetLWMData(req.user, req.query.month)));

// ---------------- FAMS Template ----------------
router.get('/fams/template', go(async (req, res) => {
  const { count, rows } = await reports.famsTemplateStream(req.user);
  await streamWorkbook(res, `FAMS_Template_${fileStamp()}.xlsx`, [{ name: 'FAMS Template', rows }], { rowCount: count });
}));

// ---------------- Period Reports ----------------
// View / export any month, quarter, financial year or date range
// Users see one Tally month at a time; several months (quarter, year, dates, all) are Admin only
const consolidatedAdmin = (req, res, next) => {
  const q = req.query;
  const oneMonth = /^\d{4}-\d{2}$/.test(q.fromMonth || '') && q.fromMonth === q.toMonth && !q.from && !q.to;
  const probe = q.probe === '1'; // data range only (no records)
  if (req.user.isAdmin || oneMonth || probe) return next();
  return res.status(403).json({ success: false, message: 'Only Admin can view consolidated reports for several months.' });
};
router.get('/reports/period', consolidatedAdmin, go((req) => period.getPeriodReport(req.query)));
router.get('/reports/period/records', consolidatedAdmin, go((req) => period.getPeriodRecords(req.query)));
router.get('/reports/period/export', consolidatedAdmin, go(async (req, res) => {
  const out = await period.exportPeriod(req.user, req.query.type, req.query);
  await streamWorkbook(res, out.fileName, out.sheets, { rowCount: out.rowCount });
}));

// ---------------- Month-wise Data ----------------
router.get('/months', go(() => months.listMonths()));
router.get('/months/booking', go((req) => months.bookingMonths(req.user)));
router.get('/months/:month', go((req) => months.getMonth(req.user, req.params.month)));
router.post('/months/:month/submit', go((req) => months.submitMonth(req.user, req.params.month)));
router.post('/months/:month/send-back', adminOnly('Only Admin can send a month back.'), go((req) => months.sendBack(req.user, req.params.month, req.body.reason)));
router.post('/months/:month/finalize', adminOnly('Only Admin can finalize a month.'), go((req) => months.finalizeMonth(req.user, req.params.month, req.body)));
router.post('/months/:month/fams-uploaded', adminOnly('Only Admin can mark a month as uploaded to FAMS.'), go((req) => months.markFamsUploaded(req.user, req.params.month, req.body)));
router.post('/months/:month/reopen', adminOnly('Only Admin can re-open a month.'), go((req) => months.reopenMonth(req.user, req.params.month, req.body.reason)));
router.get('/months/:month/versions/:version/:kind', go(async (req, res) => {
  const out = await months.versionFile(req.params.month, req.params.version, req.params.kind);
  await streamWorkbook(res, out.fileName, out.sheets, { rowCount: out.rowCount });
}));
router.get('/history/:faCode', adminOnly('Only Admin can view the change history.'), go((req) => months.recordHistory(req.params.faCode)));

// ---------------- Year-End Archive (Admin) ----------------
const archiveAdmin = adminOnly('Only Admin can use Year-End Archive.');
router.get('/archive', archiveAdmin, go(() => archive.listArchive()));
router.post('/archive/preview', archiveAdmin, go((req) => archive.previewArchive(req.body)));
router.post('/archive', archiveAdmin, go((req) => archive.archivePeriod(req.user, req.body)));
router.get('/archive/:id/records', archiveAdmin, go((req) => archive.archivedRecords(req.params.id, req.query)));
router.get('/archive/:id/records/:faCode', archiveAdmin, go((req) => archive.archivedRecord(req.params.id, req.params.faCode)));
router.get('/archive/:id/export', archiveAdmin, go(async (req, res) => {
  const out = await archive.archivedExport(req.params.id);
  await streamWorkbook(res, out.fileName, [{ name: 'FA Data (archive)', rows: out.rows }], { rowCount: out.count });
}));
router.post('/archive/:id/restore', archiveAdmin, go((req) => archive.restoreRun(req.user, req.params.id, req.body)));

// ---------------- Releases (Admin) ----------------
router.get('/releases', adminOnly('Only Admin can view releases.'), go(() => releases.listReleases()));
router.post('/releases/:version/approve', adminOnly('Only Admin can approve a release.'), go((req) => releases.approveRelease(req.user, req.params.version, req.body.note)));

// ---------------- Users (Admin) ----------------
router.get('/users', adminOnly('Only Admin can view users.'), go(() => users.getUsers()));
router.post('/users', adminOnly('Only Admin can add users.'), go((req) => users.addUser(req.user, req.body)));
router.post('/users/:username/sign-out', adminOnly('Only Admin can sign users out.'), go((req) => users.signOutUser(req.user, req.params.username)));
router.put('/users/:username', adminOnly('Only Admin can edit users.'), go((req) => users.updateUser(req.user, { ...req.body, username: req.params.username })));

// ---------------- Activity Log (Admin) ----------------
// The Activity Log sheet was only visible inside Google Sheets; this replaces it.
router.get('/activity', adminOnly('Only Admin can view the Activity Log.'), go(async (req) => {
  const params = [];
  const where = [];
  if (text(req.query.search)) {
    params.push(`%${text(req.query.search)}%`);
    where.push(`(username ILIKE $1 OR name ILIKE $1 OR action ILIKE $1 OR module ILIKE $1 OR fa_code ILIKE $1
      OR inv_no ILIKE $1 OR expense_head ILIKE $1 OR details ILIKE $1)`);
  }
  const limit = Math.min(Number(req.query.limit) || 500, 5000);
  const { rows } = await pool.query(
    `SELECT * FROM activity_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY log_id DESC LIMIT ${limit}`, params
  );
  return rows;
}));

module.exports = router;
