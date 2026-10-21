// WHERE clause for fa_records (alias f) from report filters:
//   from / to    invoice date range (YYYY-MM-DD or DD/MM/YYYY), both inclusive
//   costCenter   one value or several (repeated query parameter), any case
//   bookMonth, fromMonth / toMonth   Tally booking month(s), 'YYYY-MM'
//   months       several Tally months ('YYYY-MM', repeated parameter)
//   status       'Pending' / 'Completed'
//   search       text found in any column of the FA Data list (any case)
// Returns { where: 'WHERE ...' | '', params }
const { text, parseDate } = require('./values');

function recordFilter(filters = {}, params = []) {
  const where = [];
  const ccs = [].concat(filters.costCenter || []).map((c) => text(c).toLowerCase()).filter(Boolean);
  if (ccs.length) { params.push(ccs); where.push(`LOWER(TRIM(f.cost_center)) = ANY($${params.length})`); }
  const from = parseDate(filters.from);
  const to = parseDate(filters.to);
  if (from) { params.push(from); where.push(`f.inv_date >= $${params.length}`); }
  if (to) { params.push(to); where.push(`f.inv_date <= $${params.length}`); }
  // Tally booking month: one (bookMonth) or a range (fromMonth / toMonth), 'YYYY-MM'
  const month = (v) => (/^\d{4}-\d{2}$/.test(text(v)) ? text(v) : null);
  const fromMonth = month(filters.bookMonth) || month(filters.fromMonth);
  const toMonth = month(filters.bookMonth) || month(filters.toMonth);
  if (fromMonth) { params.push(fromMonth); where.push(`f.book_month >= $${params.length}`); }
  if (toMonth) { params.push(toMonth); where.push(`f.book_month <= $${params.length}`); }
  const months = [].concat(filters.months || []).map(month).filter(Boolean);
  if (months.length) { params.push(months); where.push(`f.book_month = ANY($${params.length})`); }
  if (['Pending', 'Completed'].includes(filters.status)) { params.push(filters.status); where.push(`f.status = $${params.length}`); }
  const term = text(filters.search).toLowerCase();
  if (term) {
    params.push(`%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    // search_text: the record's searchable text, kept by a trigger and indexed (009_search_index)
    where.push(`f.search_text LIKE $${params.length}`);
  }
  return { where: where.length ? `WHERE ${where.join(' AND ')}` : '', params, active: where.length > 0 };
}

module.exports = { recordFilter };
