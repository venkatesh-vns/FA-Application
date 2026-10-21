// Releases screen: deployments of this environment; on staging an Admin
// approves the deployed version for production (the production deployment
// script refuses a version without this approval).
const { pool } = require('../config/db');
const { httpError } = require('../utils/httpError');
const { logActivity } = require('../utils/activity');
const { text, formatDateTime } = require('../utils/values');
const { appInfo } = require('../utils/version');

const out = (r) => ({
  releaseId: r.release_id, version: r.version, environment: r.environment, status: r.status,
  deployedBy: r.deployed_by, deployedAt: formatDateTime(r.deployed_at), backupFile: r.backup_file, migrations: r.migrations, notes: r.notes,
  approvedBy: r.approved_by || '', approvedAt: r.approved_at ? formatDateTime(r.approved_at) : '', approvalNote: r.approval_note,
});

async function listReleases() {
  const { rows } = await pool.query('SELECT * FROM app_releases ORDER BY release_id DESC LIMIT 200');
  return { app: appInfo(), releases: rows.map(out) };
}

async function approveRelease(user, version, note) {
  const info = appInfo();
  if (info.environment !== 'staging') throw httpError(409, 'Versions are approved on the Staging (SP) environment, after testing there.');
  if (text(version) !== info.version) throw httpError(409, `Only the version running here (${info.version}) can be approved.`);
  const { rows } = await pool.query(
    "SELECT release_id, approved_at FROM app_releases WHERE environment = 'staging' AND version = $1 AND status = 'deployed' ORDER BY release_id DESC LIMIT 1",
    [info.version]
  );
  if (!rows[0]) throw httpError(409, `Version ${info.version} has no staging deployment record.`);
  if (rows[0].approved_at) throw httpError(409, `Version ${info.version} is already approved.`);
  if (text(note).length < 3) throw httpError(400, 'Write what was tested (e.g. "Checked Qty Plotting, FA Data export with users").');
  await pool.query('UPDATE app_releases SET approved_by = $2, approved_at = NOW(), approval_note = $3 WHERE release_id = $1',
    [rows[0].release_id, user.name || user.username, text(note)]);
  await logActivity(user, 'Release Approved', 'Releases', '', '', '', `Version ${info.version} approved for production: ${text(note)}`);
  return { success: true, message: `Version ${info.version} is approved for production.` };
}

module.exports = { listReleases, approveRelease };
