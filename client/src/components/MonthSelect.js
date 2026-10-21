import React, { useCallback, useEffect, useState } from 'react';
import { call } from '../services/api';

// Months the signed-in user may book into (Open; Under Review for Admin),
// the default month and the newest finalized month
export function useBookingMonths() {
  const [data, setData] = useState({ months: [], defaultMonth: '', lastClosedLabel: '' });
  const reload = useCallback(() => call('get', '/months/booking').then(setData).catch(() => {}), []);
  useEffect(() => { reload(); }, [reload]);
  return { ...data, reload };
}

// <select> of Tally booking months
export default function MonthSelect({ id, value, onChange, months, allowBlank = false, blankLabel = 'Choose month' }) {
  return (
    <select id={id} className="form-control" value={value || ''} onChange={(e) => onChange(e.target.value)}>
      {(allowBlank || !value) && <option value="">{blankLabel}</option>}
      {months.map((m) => (
        <option key={m.month} value={m.month}>{m.label}{m.status !== 'Open' ? ` (${m.status})` : ''}</option>
      ))}
    </select>
  );
}

// 'Open' / 'Under Review' / 'Finalized' / 'FAMS Uploaded' badge
export function MonthStatus({ status }) {
  const cls = { Open: 'ms-open', 'Under Review': 'ms-review', Finalized: 'ms-final', 'FAMS Uploaded': 'ms-fams' }[status] || 'ms-open';
  return <span className={`month-status ${cls}`}>{status !== 'Open' && <LockIcon />}{status}</span>;
}

export function LockIcon({ size = 11 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 11h14v10H5z" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

export const isLocked = (status, isAdmin) => status === 'Finalized' || status === 'FAMS Uploaded' || (status === 'Under Review' && !isAdmin);
