// FA Code = invoice month + year + 4-digit sequence, e.g. SEP20260025
// (generateFACode_, reserveFACodeNumbersForPeriod_, scanMaxFACodeForPeriod_).
//
// The counter for each month lives in fa_code_counters (Script Properties in
// the original). When a month's counter does not exist yet it starts from the
// highest code of that month in the live AND archived records, so archiving
// never makes a code repeat. The row lock taken by INSERT ... ON CONFLICT
// makes simultaneous saves wait for each other (LockService).

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// 'YYYY-MM-DD' -> 'SEP2026'
function periodOf(isoDate) {
  const [y, m] = String(isoDate).split('-');
  return `${MONTHS[Number(m) - 1]}${y}`;
}

/**
 * Next FA Code for the month of `isoDate`. Call inside the saving transaction
 * (`db`) so a failed save gives its number back.
 */
async function nextFACode(db, isoDate) {
  const period = periodOf(isoDate);
  // the month's counter usually exists: take the next number (row lock)
  const next = await db.query(
    'UPDATE fa_code_counters SET last_number = last_number + 1 WHERE period = $1::varchar RETURNING last_number',
    [period]
  );
  if (next.rows.length) return period + String(next.rows[0].last_number).padStart(4, '0');
  // first code of the month: start after the highest existing code
  const { rows } = await db.query(
    `INSERT INTO fa_code_counters (period, last_number)
     VALUES ($1::varchar, 1 + (
       SELECT COALESCE(MAX(SUBSTRING(code FROM 8)::INTEGER), 0) FROM (
         SELECT fa_code AS code FROM fa_records
         UNION ALL SELECT fa_code FROM fa_records_archive
       ) c WHERE UPPER(code) ~ ('^' || $1::varchar || '[0-9]{4}$')
     ))
     ON CONFLICT (period) DO UPDATE SET last_number = fa_code_counters.last_number + 1
     RETURNING last_number`,
    [period]
  );
  return period + String(rows[0].last_number).padStart(4, '0');
}

module.exports = { periodOf, nextFACode, MONTHS };
