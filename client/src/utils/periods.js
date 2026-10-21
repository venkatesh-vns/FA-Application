// Periods for Period Reports: months, financial-year quarters (Q1 Apr-Jun ...
// Q4 Jan-Mar), financial years (April - March) and calendar years, newest first.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');
const lastDay = (y, m) => new Date(y, m, 0).getDate(); // m = 1..12
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const fyName = (start) => `FY ${start}-${pad((start + 1) % 100)}`;

export const PERIOD_TYPES = [
  { id: 'month', label: 'Month' },
  { id: 'quarter', label: 'Quarter' },
  { id: 'fy', label: 'Financial Year' },
  { id: 'year', label: 'Calendar Year' },
  { id: 'custom', label: 'Custom Dates' },
  { id: 'all', label: 'All Data' },
];

// 'YYYY-MM-DD' -> [year, month]
const ym = (value) => { const [y, m] = String(value).split('-').map(Number); return [y, m]; };
const fyStartOf = (y, m) => (m >= 4 ? y : y - 1);

/**
 * Options of one period type between two dates (data range), newest first:
 * [{ value, label, from, to }]
 */
export function periodOptions(type, fromIso, toIso) {
  if (!fromIso || !toIso) return [];
  const [fy0, fm0] = ym(fromIso);
  const [ty, tm] = ym(toIso);
  const out = [];
  if (type === 'month') {
    for (let y = ty, m = tm; y > fy0 || (y === fy0 && m >= fm0); m === 1 ? (m = 12, y -= 1) : (m -= 1)) {
      out.push({ value: `${y}-${pad(m)}`, label: `${MONTHS[m - 1]} ${y}`, from: iso(y, m, 1), to: iso(y, m, lastDay(y, m)) });
    }
  } else if (type === 'quarter') {
    const first = fyStartOf(fy0, fm0) * 4 + Math.floor(((fm0 + 8) % 12) / 3);
    const last = fyStartOf(ty, tm) * 4 + Math.floor(((tm + 8) % 12) / 3);
    for (let i = last; i >= first; i -= 1) {
      const start = Math.floor(i / 4);
      const q = (i % 4) + 1;
      const m1 = ((q - 1) * 3 + 3) % 12 + 1; // Q1 -> 4, Q2 -> 7, Q3 -> 10, Q4 -> 1
      const y1 = q === 4 ? start + 1 : start;
      out.push({
        value: `${start}-Q${q}`,
        label: `Q${q} ${fyName(start)} (${MONTHS[m1 - 1]}–${MONTHS[m1 + 1]} ${y1})`,
        short: `Q${q} ${fyName(start)}`,
        from: iso(y1, m1, 1),
        to: iso(y1, m1 + 2, lastDay(y1, m1 + 2)),
      });
    }
  } else if (type === 'fy') {
    for (let s = fyStartOf(ty, tm); s >= fyStartOf(fy0, fm0); s -= 1) {
      out.push({ value: String(s), label: `${fyName(s)} (Apr ${s} – Mar ${s + 1})`, short: fyName(s), from: iso(s, 4, 1), to: iso(s + 1, 3, 31) });
    }
  } else if (type === 'year') {
    for (let y = ty; y >= fy0; y -= 1) out.push({ value: String(y), label: `${y} (Jan – Dec)`, short: String(y), from: iso(y, 1, 1), to: iso(y, 12, 31) });
  }
  return out;
}

export const ddmmyyyy = (value) => (value ? value.split('-').reverse().join('/') : '');
