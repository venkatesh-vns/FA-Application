// Runs async jobs ([() => promise, ...]) and returns their results in order:
// in parallel on the pool, one after another inside a transaction (a single
// client cannot run two queries at once).
const { pool, withTransaction } = require('../config/db');

async function runAll(db, jobs) {
  if (db === pool) return Promise.all(jobs.map((job) => job()));
  const out = [];
  for (const job of jobs) out.push(await job());
  return out;
}

// Large GROUP BY report queries (a year is 300,000+ lines): more sort / hash
// memory and a hash aggregate instead of sorting, for this query only.
const REPORT_WORK_MEM = process.env.REPORT_WORK_MEM || '32MB';
function reportQuery(sql, params = []) {
  return withTransaction(async (db) => {
    await db.query(`SET LOCAL work_mem = '${REPORT_WORK_MEM.replace(/[^0-9A-Za-z]/g, '')}'`);
    await db.query('SET LOCAL enable_sort = off');
    return db.query(sql, params);
  });
}

module.exports = { runAll, reportQuery };
