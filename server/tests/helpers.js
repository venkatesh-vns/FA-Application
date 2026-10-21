// Test harness. Each test file calls setup() once: it re-creates a throwaway
// database (TEST_DB_NAME, default fa_management_test - never the real one),
// applies the migrations, seeds an Admin and starts the API on a random port.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const TEST_DB = process.env.TEST_DB_NAME || 'fa_management_test';
if (!/_test$/.test(TEST_DB)) {
  throw new Error(`TEST_DB_NAME must end with "_test" (got "${TEST_DB}"); the test database is dropped and re-created.`);
}
Object.assign(process.env, { DB_NAME: TEST_DB, NODE_ENV: 'test', AUTH_RATE_LIMIT: '100000' });

const { Client } = require('pg');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');

async function recreateDatabase() {
  const client = new Client({
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT, 10) || 5432, database: 'postgres',
  });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
    await client.query(`DROP DATABASE IF EXISTS "${TEST_DB}_archive" WITH (FORCE)`); // Year-End Archive copy
    await client.query(`CREATE DATABASE "${TEST_DB}"`);
  } finally {
    await client.end();
  }
}

/**
 * Fresh database + running API:
 *   ctx.api(method, url, body?, token?)  -> { status, body }
 *   ctx.download(url, token?)             -> { status, headers, rows } (rows of the first sheet)
 *   ctx.upload(url, rows, token?)         -> api result (rows = arrays, first = header)
 *   ctx.login(username, password)         -> token
 */
async function setup() {
  await recreateDatabase();
  const { pool } = require('../config/db');
  const { runMigrations } = require('../scripts/migrate');
  await runMigrations(pool, { log: () => {} });
  await pool.query(
    "INSERT INTO users (username, password_hash, name, role) VALUES ('admin', $1, 'Administrator', 'Admin')",
    [await bcrypt.hash('admin123', 4)]
  );

  const app = require('../app');
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const ctx = { pool, base };

  ctx.api = async (method, url, body, token = ctx.adminToken) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(base + url, { method, headers, body: payload });
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
    return { status: res.status, body: json };
  };

  ctx.download = async (url, token = ctx.adminToken) => {
    const res = await fetch(base + url, { headers: { Authorization: `Bearer ${token}` } });
    const buffer = Buffer.from(await res.arrayBuffer());
    let sheets = {};
    if (res.ok) sheets = await readXlsx(buffer);
    return { status: res.status, headers: res.headers, sheets, rows: Object.values(sheets)[0] || [] };
  };

  ctx.upload = async (url, rows, token = ctx.adminToken, fileName = 'upload.xlsx', fields = {}) => {
    const form = new FormData();
    Object.entries(fields).forEach(([k, v]) => form.append(k, v));
    form.append('file', new Blob([await buildXlsx(rows)]), fileName);
    return ctx.api('POST', url, form, token);
  };

  ctx.login = async (username, password) => {
    const res = await ctx.api('POST', '/auth/login', { username, password }, null);
    if (res.status !== 200) throw new Error(`login ${username} failed: ${res.body.message}`);
    return res.body.token;
  };

  ctx.adminToken = await ctx.login('admin', 'admin123');
  ctx.close = async () => {
    await new Promise((resolve) => server.close(resolve));
    await require('../services/archiveService').closeArchive();
    await pool.end();
  };
  return ctx;
}

async function buildXlsx(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// { sheetName: arrays of cell text, header row first }
async function readXlsx(buffer) {
  const { cellText } = require('../utils/excel');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const out = {};
  wb.worksheets.forEach((ws) => {
    out[ws.name] = [];
    ws.eachRow((row) => {
      const cells = [];
      for (let c = 1; c <= ws.columnCount; c++) cells.push(cellText(row.getCell(c).value));
      out[ws.name].push(cells);
    });
  });
  return out;
}

// A valid Raw Data record; override any field
const faBody = (o = {}) => ({
  invNo: 'INV-1', date: '2026-09-15', poNo: 'PO-1', costCenter: 'CC-1', amount: 1000,
  vendor: 'Acme Ltd', expenseHead: 'Computers', narration: 'test', ...o,
});

// One product line
const line = (o = {}) => ({ product: 'Laptop', quantity: 1, taggable: 'Taggable', unitPrice: '', productAmount: 1000, gstPercent: 18, ...o });

// Saves a record and returns its FA Code
async function newFA(ctx, o = {}) {
  const res = await ctx.api('POST', '/fa', faBody(o));
  if (res.status !== 200) throw new Error(res.body.message);
  return res.body.faCode;
}

// Plots a record with the given lines (default: one line for the full amount)
async function plot(ctx, faCode, lines, extra = {}) {
  const rec = (await ctx.api('GET', `/fa/${faCode}`)).body.raw;
  return ctx.api('POST', '/qty', {
    faCode, invNo: rec.invNo, expenseHead: rec.expenseHead, vendor: rec.vendor,
    products: lines || [line({ productAmount: rec.amount })], ...extra,
  });
}

module.exports = { setup, buildXlsx, readXlsx, faBody, line, newFA, plot };
