// Ledger Master (getLedgerMaster, saveLedgerMapping, deleteLedgerMapping) and
// the Masters (getMasterConfig_, getMasterRecords, saveMasterRecord,
// deleteMasterRecord, saveMasterBulk, exportMasterData, updateMasterBulk).
// The Client Master was removed; 'PO Master' is shown as 'PO Client Master'.
// Masters keep the sheets' free-text columns: only the
// first column is required and duplicates are allowed, as before.
const { pool, withTransaction } = require('../config/db');
const { httpError } = require('../utils/httpError');
const { logActivity } = require('../utils/activity');
const { text } = require('../utils/values');

const fail = (message) => httpError(400, message);

// ------------------------------------------------------------
// Ledger Master
// ------------------------------------------------------------

async function getLedgerMaster() {
  const { rows } = await pool.query('SELECT * FROM ledgers ORDER BY ledger_id');
  return rows.map((r) => ({ id: r.ledger_id, expenseHead: r.expense_head, mapping: r.mapping, active: r.active }));
}

/**
 * Adds a mapping, or updates the existing one with the same Expense Head
 * (saveLedgerMapping). With `id` (Edit) that row is updated, so an Expense
 * Head can also be renamed.
 */
async function saveLedgerMapping(user, data) {
  if (!data) throw fail('No Ledger Master data received.');
  const expenseHead = text(data.expenseHead);
  const mapping = text(data.mapping);
  const active = text(data.active) === 'No' ? 'No' : 'Yes';
  if (!expenseHead) throw fail('Expense Head is required.');
  if (mapping !== 'Taggable' && mapping !== 'Non Taggable') throw fail('Mapping must be Taggable or Non Taggable.');

  return withTransaction(async (db) => {
    const id = Number(data.id) || 0;
    const same = (await db.query('SELECT ledger_id FROM ledgers WHERE LOWER(TRIM(expense_head)) = LOWER($1)', [expenseHead])).rows[0];
    let message;
    if (id && (!same || same.ledger_id === id)) {
      const r = await db.query('UPDATE ledgers SET expense_head=$1, mapping=$2, active=$3, updated_at=NOW() WHERE ledger_id=$4', [expenseHead, mapping, active, id]);
      if (!r.rowCount) throw httpError(404, 'Ledger mapping not found.');
      message = 'Ledger mapping updated successfully.';
    } else if (same) {
      await db.query('UPDATE ledgers SET expense_head=$1, mapping=$2, active=$3, updated_at=NOW() WHERE ledger_id=$4', [expenseHead, mapping, active, same.ledger_id]);
      message = 'Ledger mapping updated successfully.';
    } else {
      await db.query('INSERT INTO ledgers (expense_head, mapping, active) VALUES ($1, $2, $3)', [expenseHead, mapping, active]);
      message = 'Ledger mapping added successfully.';
    }
    await logActivity(user, 'Ledger Mapping Saved', 'Ledger Master', '', '', expenseHead, `${mapping}, Active: ${active}`, db);
    return { success: true, message };
  });
}

async function deleteLedgerMapping(user, id) {
  const { rows } = await pool.query('DELETE FROM ledgers WHERE ledger_id = $1 RETURNING *', [Number(id) || 0]);
  if (!rows.length) throw fail('Invalid Ledger Master row.');
  await logActivity(user, 'Ledger Mapping Deleted', 'Ledger Master', '', '', rows[0].expense_head, rows[0].mapping);
  return { success: true, message: 'Ledger mapping deleted successfully.' };
}

// ------------------------------------------------------------
// Masters
// ------------------------------------------------------------

// type -> table, sheet title and [header, column] pairs, in sheet order
const MASTERS = {
  branch: {
    table: 'branch_master', title: 'Branch Master', sheet: 'Branch Master',
    fields: [['Cost Center', 'cost_center'], ['Branch', 'branch'], ['Branch Code', 'branch_code'], ['Location', 'location']],
  },
  category: {
    table: 'category_master', title: 'Category Master', sheet: 'Category Master',
    fields: [['Expense Head', 'expense_head'], ['Asset Category Level I', 'category_level_1'], ['Asset Category Level II', 'category_level_2']],
  },
  description: {
    table: 'description_master', title: 'Description Master', sheet: 'Description Master',
    fields: [['Product / Asset Description', 'product_description'], ['Expense Head', 'expense_head'],
      ['AssetDescriptionOne', 'asset_description_one'], ['AssetDescriptionTwo', 'asset_description_two'], ['Asset Category Level II', 'category_level_2']],
  },
  po: {
    table: 'po_master', title: 'PO Client Master', sheet: 'PO Master',
    fields: [['PO No', 'po_no'], ['PO Date', 'po_date'], ['Client As Per PO', 'client_as_per_po'], ['Client As Per PMO', 'client_as_per_pmo'], ['Status', 'status']],
  },
  clientcc: {
    table: 'client_cc_master', title: 'Client / Cost Center Master', sheet: 'Client Cost Center Master',
    fields: [['Client As Per PMO', 'client_as_per_pmo'], ['Cost Center', 'cost_center'], ['Status', 'status']],
  },
};

function configOf(type) {
  const cfg = MASTERS[String(type || '').toLowerCase()];
  if (!cfg) throw fail('Invalid Master type.');
  return cfg;
}

const headersOf = (cfg) => cfg.fields.map(([h]) => h);

// Values in header order; Description Master: AssetDescriptionOne = Expense Head
function valuesOf(cfg, data) {
  const item = { ...data };
  if (cfg.table === 'description_master') {
    item['Expense Head'] = text(item['Expense Head']);
    item.AssetDescriptionOne = item['Expense Head'];
  }
  return cfg.fields.map(([h]) => text(item[h]));
}

const recordOut = (cfg, r) => ({ row: r.id, ...Object.fromEntries(cfg.fields.map(([h, c]) => [h, r[c] ?? ''])) });

async function getMasterRecords(type) {
  const cfg = configOf(type);
  const { rows } = await pool.query(`SELECT * FROM ${cfg.table} ORDER BY id`);
  return rows.map((r) => recordOut(cfg, r));
}

// Add (no row) or update (row = record id)
async function saveMasterRecord(user, type, data) {
  const cfg = configOf(type);
  if (!data) throw fail('Master data is required.');
  const values = valuesOf(cfg, data);
  const headers = headersOf(cfg);
  if (!values[0]) throw fail(`${headers[0]} is required.`);
  const cols = cfg.fields.map(([, c]) => c);
  const id = Number(data.row) || 0;
  if (id > 0) {
    const r = await pool.query(
      `UPDATE ${cfg.table} SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(', ')}, updated_at = NOW() WHERE id = $${cols.length + 1}`,
      [...values, id]
    );
    if (!r.rowCount) throw fail('Invalid master row.');
  } else {
    await pool.query(`INSERT INTO ${cfg.table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, values);
  }
  await logActivity(user, id > 0 ? 'Master Updated' : 'Master Created', 'Masters', '', '', '', `${cfg.sheet}: ${values[0]}`);
  return { success: true, message: id > 0 ? 'Record updated.' : 'Record created.' };
}

async function deleteMasterRecord(user, type, id) {
  const cfg = configOf(type);
  const { rows } = await pool.query(`DELETE FROM ${cfg.table} WHERE id = $1 RETURNING *`, [Number(id) || 0]);
  if (!rows.length) throw fail('Invalid master row.');
  await logActivity(user, 'Master Deleted', 'Masters', '', '', '', `${cfg.sheet}: ${rows[0][cfg.fields[0][1]]}`);
  return { success: true, message: 'Record deleted.' };
}

const sameHeaders = (row, expected) => {
  const headers = (row || []).map((x) => text(x).replace(/^﻿/, ''));
  return headers.slice(0, expected.length).join('||') === expected.join('||') && !headers.slice(expected.length).some(Boolean);
};

/**
 * Bulk upload (saveMasterBulk): the file must have exactly the template
 * headers; rows are ADDED below the existing records (never replaced);
 * rows with a blank first column are ignored.
 */
async function saveMasterBulk(user, type, rows) {
  const cfg = configOf(type);
  const headers = headersOf(cfg);
  if (!rows || !rows.length) throw fail('Excel file is empty.');
  if (!sameHeaders(rows[0], headers)) throw fail(`Invalid headers. Expected: ${headers.join(', ')}`);
  const data = rows.slice(1).filter((r) => r.some((v) => text(v)));
  if (!data.length) throw fail('No data rows found.');
  const records = data.map((r) => valuesOf(cfg, Object.fromEntries(headers.map((h, i) => [h, r[i]])))).filter((v) => v[0]);
  if (!records.length) throw fail('No valid records found.');

  const cols = cfg.fields.map(([, c]) => c);
  await withTransaction(async (db) => {
    for (const values of records) {
      await db.query(`INSERT INTO ${cfg.table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, values);
    }
    await logActivity(user, 'Master Bulk Upload', 'Masters', '', '', '', `${cfg.sheet}: ${records.length} rows appended`, db);
  });
  return { success: true, message: `${records.length} new master record(s) added. Existing records were retained.` };
}

// exportMasterData: 'Row Number' (record id) + the master's columns
async function exportMasterData(type) {
  const cfg = configOf(type);
  const { rows } = await pool.query(`SELECT * FROM ${cfg.table} ORDER BY id`);
  return {
    title: cfg.title,
    rows: [['Row Number', ...headersOf(cfg)], ...rows.map((r) => [r.id, ...cfg.fields.map(([, c]) => r[c] ?? '')])],
  };
}

// updateMasterBulk: edited export, matched by Row Number
async function updateMasterBulk(user, type, rows) {
  const cfg = configOf(type);
  const expected = ['Row Number', ...headersOf(cfg)];
  if (!rows || !rows.length) throw fail('Excel file is empty.');
  if (!sameHeaders(rows[0], expected)) throw fail('Invalid Master export headers. Please use Export Master and edit that Excel file.');
  const cols = cfg.fields.map(([, c]) => c);
  const errors = [];
  let updated = 0;
  await withTransaction(async (db) => {
    const data = rows.slice(1).filter((r) => r.some((v) => text(v)));
    for (let index = 0; index < data.length; index++) {
      const r = data[index];
      const id = Number(text(r[0])) || 0;
      const values = valuesOf(cfg, Object.fromEntries(expected.slice(1).map((h, i) => [h, r[i + 1]])));
      if (id <= 0) { errors.push(`File row ${index + 2}: invalid Row Number.`); continue; }
      if (!values[0]) { errors.push(`File row ${index + 2}: ${expected[1]} is required.`); continue; }
      const res = await db.query(
        `UPDATE ${cfg.table} SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(', ')}, updated_at = NOW() WHERE id = $${cols.length + 1}`,
        [...values, id]
      );
      if (!res.rowCount) { errors.push(`File row ${index + 2}: invalid Row Number.`); continue; }
      updated += 1;
    }
    await logActivity(user, 'Master Bulk Edit', 'Masters', '', '', '', `${cfg.sheet}: ${updated} rows`, db);
  });
  return { success: true, updated, errors, message: `${updated} master record(s) updated.${errors.length ? ` ${errors.length} row(s) skipped.` : ''}` };
}

const masterDefinitions = () => Object.entries(MASTERS).map(([type, m]) => ({ type, title: m.title, headers: headersOf(m) }));

module.exports = {
  getLedgerMaster, saveLedgerMapping, deleteLedgerMapping,
  MASTERS, configOf, masterDefinitions, getMasterRecords, saveMasterRecord, deleteMasterRecord,
  saveMasterBulk, exportMasterData, updateMasterBulk,
};
