// Excel helpers. The Apps Script screens read uploads with SheetJS in the
// browser and built downloads from CSV text; here the server does both.
const ExcelJS = require('exceljs');
const { httpError } = require('./httpError');

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Builds an .xlsx from sheets [{ name, rows }] where rows[0] is the header
 * row (downloadExcelRows): header bold and frozen, column widths from the
 * first 50 rows (12 to 45 characters). Resolves to a Buffer.
 */
async function buildWorkbook(sheets) {
  const workbook = new ExcelJS.Workbook();
  sheets.forEach(({ name, rows }) => {
    // Excel sheet names cannot contain * ? : \ / [ ] and are at most 31 characters
    const safeName = String(name || 'Sheet1').replace(/[*?:\\/[\]]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Sheet1';
    const sheet = workbook.addWorksheet(safeName, { views: [{ state: 'frozen', ySplit: 1 }] });
    (rows || []).forEach((values, i) => {
      const row = sheet.addRow((values || []).map((v) => (v === null || v === undefined ? '' : v)));
      if (i === 0) row.font = { bold: true };
    });
    const width = (rows || []).reduce((w, r) => Math.max(w, (r || []).length), 0); // no spread: large sheets
    for (let c = 1; c <= width; c++) {
      let max = 12;
      (rows || []).slice(0, 51).forEach((r) => {
        max = Math.max(max, Math.min(45, String(r[c - 1] ?? '').length + 2));
      });
      sheet.getColumn(c).width = max;
    }
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/**
 * Streams an .xlsx to the response row by row, for large downloads. sheets:
 * [{ name, rows }] where rows is an array or an async iterable of row arrays
 * (header first). Header bold and frozen; widths from the first 50 rows.
 * rowCount (if known) is sent as X-Row-Count before the file.
 */
async function streamWorkbook(res, fileName, sheets, { rowCount } = {}) {
  res.setHeader('Content-Type', XLSX_MIME);
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  if (rowCount !== undefined) res.setHeader('X-Row-Count', String(rowCount));
  // cell styles make large files ~5x slower to write: big exports keep the
  // frozen header row and column widths but not the bold header
  const big = sheets.some(({ rows }) => !Array.isArray(rows) || rows.length > 5000);
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: !big, useSharedStrings: false });
  for (const { name, rows } of sheets) {
    const safeName = String(name || 'Sheet1').replace(/[*?:\\/[\]]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Sheet1';
    const sheet = workbook.addWorksheet(safeName, { views: [{ state: 'frozen', ySplit: 1 }] });
    const iterator = (rows && rows[Symbol.asyncIterator]) ? rows[Symbol.asyncIterator]() : (rows || [])[Symbol.iterator]();
    const head = [];
    let step = await iterator.next();
    while (!step.done && head.length < 51) { head.push(step.value); step = await iterator.next(); }
    const width = head.reduce((w, r) => Math.max(w, (r || []).length), 0);
    sheet.columns = Array.from({ length: width }, (_, c) => ({
      width: head.reduce((max, r) => Math.max(max, Math.min(45, String(r[c] ?? '').length + 2)), 12),
    }));
    const add = (values, i) => {
      // blank cells are left out (much faster for wide sheets such as FAMS; reads back the same)
      const row = sheet.addRow((values || []).map((v) => (v === null || v === undefined || v === '' ? null : v)));
      if (i === 0) row.font = { bold: true };
      row.commit();
    };
    head.forEach(add);
    let i = head.length;
    while (!step.done) { add(step.value, i); i += 1; step = await iterator.next(); }
    sheet.commit();
  }
  await workbook.commit();
}

async function sendWorkbook(res, fileName, buffer) {
  const data = await buffer;
  res.setHeader('Content-Type', XLSX_MIME);
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.send(data);
}

const pad = (n) => String(n).padStart(2, '0');

// A cell value as the text the user sees; dates as DD/MM/YYYY
function cellText(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    // exceljs gives date cells as UTC midnight of the calendar date
    return `${pad(value.getUTCDate())}/${pad(value.getUTCMonth() + 1)}/${value.getUTCFullYear()}`;
  }
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((t) => t.text).join('');
    if ('result' in value) return cellText(value.result); // formula: its result
    if ('text' in value) return cellText(value.text); // hyperlink
    if ('error' in value) return '';
    return '';
  }
  return String(value);
}

// All rows of a worksheet as arrays of text (header row first, blank rows kept)
function sheetRows(sheet) {
  const rows = [];
  const width = sheet.actualColumnCount || sheet.columnCount || 0;
  for (let r = 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const cells = [];
    for (let c = 1; c <= Math.max(width, row.cellCount); c++) cells.push(cellText(row.getCell(c).value));
    rows.push(cells);
  }
  return rows;
}

async function loadWorkbook(filePath) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.readFile(filePath);
  } catch (err) {
    throw httpError(400, 'The file could not be read. Please upload the Excel template (.xlsx).');
  }
  return workbook;
}

// First worksheet of an uploaded .xlsx as arrays of text (readTabularFile)
async function readRows(filePath) {
  const workbook = await loadWorkbook(filePath);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw httpError(400, 'Excel file does not contain any worksheet.');
  return sheetRows(sheet);
}

// Every worksheet by name (used by the Google Sheets import)
async function readAllSheets(filePath) {
  const workbook = await loadWorkbook(filePath);
  const out = {};
  workbook.worksheets.forEach((ws) => { out[ws.name] = sheetRows(ws); });
  return out;
}

const isBlankRow = (row) => !(row || []).some((v) => String(v ?? '').trim() !== '');

// yyyyMMdd_HHmmss for file names (timestampForFile)
function fileStamp(d = new Date()) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

module.exports = { buildWorkbook, sendWorkbook, streamWorkbook, readRows, readAllSheets, cellText, isBlankRow, fileStamp };
