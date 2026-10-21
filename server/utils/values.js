// Value helpers ported from Code.gs: normalizeKey_, toNumber_, parseDate_,
// formatDate_, formatDateTime_.

// Trim, lower case, non-breaking spaces and repeated spaces collapsed
function normalizeKey(value) {
  return String(value ?? '')
    .replace(/ /g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

const text = (value) => String(value ?? '').trim();

// '1,50,000.00', '₹2,500', '$10' -> number; blank or not a number -> 0 (toNumber_)
function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isNaN(value) ? 0 : value;
  const n = Number(String(value).replace(/,/g, '').replace(/[₹$]/g, '').trim());
  return Number.isNaN(n) ? 0 : n;
}

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function isoDate(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  if (y < 1900 || y > 2200) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * dd/MM/yyyy or dd-MM-yyyy, yyyy-MM-dd, or a Date -> 'YYYY-MM-DD'.
 * Returns null when blank or not a valid date (parseDate_ accepted the same
 * forms; anything else made FA Code generation fail).
 */
function parseDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : isoDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  const t = text(value);
  let m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return isoDate(Number(m[3]), Number(m[2]), Number(m[1]));
  m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
  if (m) return isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}

// 'YYYY-MM-DD' -> 'DD/MM/YYYY' (formatDate_)
function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

// Timestamp -> 'DD/MM/YYYY HH:mm:ss' in the app time zone (formatDateTime_)
const TIME_ZONE = process.env.APP_TIME_ZONE || 'Asia/Kolkata';
function formatDateTime(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}:${parts.second}`;
}

// 'No', 'false', 'inactive' (any case) mean inactive; anything else, including blank, is active
const isInactive = (value) => ['no', 'false', 'inactive'].includes(normalizeKey(value));

module.exports = { normalizeKey, text, toNumber, round2, parseDate, formatDate, formatDateTime, isInactive, TIME_ZONE };
