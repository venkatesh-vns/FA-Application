import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { call, download, errorMessage, uploadFile } from '../services/api';
import { useApp } from '../context/AppContext';
import { Alert, EmptyRow } from '../components/ui';
import { MonthStatus, isLocked } from '../components/MonthSelect';
import { formatMoney } from '../utils/format';

// Index.html LWM - Ledger Wise Matching, per Tally booking month
export default function Lwm() {
  const { withLoading, isAdmin } = useApp();
  const [params, setParams] = useSearchParams();
  const [months, setMonths] = useState([]); // [{ month, label, status }]
  const [month, setMonth] = useState(params.get('month') || '');
  const [data, setData] = useState(null);
  const [alert, setAlert] = useState(null);
  const fileRef = useRef(null);

  // every month with records, plus the months open for booking; default: the booking default
  useEffect(() => {
    Promise.all([call('get', '/months'), call('get', '/months/booking')]).then(([list, booking]) => {
      const all = new Map(list.months.map((m) => [m.month, { month: m.month, label: m.label, status: m.status }]));
      booking.months.forEach((m) => { if (!all.has(m.month)) all.set(m.month, m); });
      setMonths([...all.values()].sort((a, b) => b.month.localeCompare(a.month)));
      setMonth((m) => m || booking.defaultMonth || list.currentMonth);
    }).catch((err) => setAlert({ type: 'error', message: errorMessage(err) }));
  }, []);

  const load = useCallback(() => {
    if (!month) return;
    call('get', `/lwm?month=${month}`).then(setData).catch((err) => setAlert({ type: 'error', message: errorMessage(err) }));
  }, [month]);
  useEffect(() => { load(); }, [load]);
  const chooseMonth = (m) => { setMonth(m); setData(null); setAlert(null); setParams(m ? { month: m } : {}); };
  const current = months.find((m) => m.month === month);
  const locked = isLocked(current?.status || 'Open', isAdmin);

  const upload = () => {
    setAlert(null);
    const file = fileRef.current?.files[0];
    if (!file) { setAlert({ type: 'error', message: 'Please select the Excel file.' }); return; }
    withLoading('Uploading Tally LWM data...', () => uploadFile('/lwm/upload', file, { month }))
      .then((r) => {
        fileRef.current.value = '';
        const skipped = r.errors?.length ? ` Skipped: ${r.errors.join(' | ')}` : '';
        setAlert({ type: skipped ? 'info' : 'success', message: r.message + skipped });
        load();
      })
      .catch((err) => setAlert({ type: 'error', message: errorMessage(err) }));
  };

  const reset = () => {
    if (!window.confirm(`Reset the Tally upload of ${current?.label || month}? This clears that month's Tally data.`)) return;
    withLoading('Resetting LWM data...', () => call('delete', `/lwm?month=${month}`))
      .then((r) => { if (fileRef.current) fileRef.current.value = ''; setAlert({ type: 'success', message: r.message }); load(); })
      .catch((err) => setAlert({ type: 'error', message: errorMessage(err) }));
  };

  let body;
  if (!data) body = <EmptyRow cols={5}>Loading...</EmptyRow>;
  else if (!data.hasTallyData) body = <EmptyRow cols={5}>Upload Tally data to start matching.</EmptyRow>;
  else if (!data.rows.length) body = <EmptyRow cols={5}>No Expense Head data found.</EmptyRow>;
  else {
    body = data.rows.map((r) => (
      <tr key={r.expenseHead} className={r.status === 'Matched' ? 'lwm-match' : 'lwm-difference'}>
        <td>{r.expenseHead}</td><td className="num">{formatMoney(r.faAmount)}</td><td className="num">{formatMoney(r.tallyAmount)}</td>
        <td className="num">{formatMoney(r.difference)}</td><td>{r.status}</td>
      </tr>
    ));
  }

  return (
    <section className="page">
      <div className="card">
        <h3 className="card-title">LWM</h3>
        <p className="muted">Choose the Tally booking month, then upload that month's Tally ledger summary with two columns: <strong>Expanse Head</strong> and <strong>Amount</strong>. An upload replaces the previous upload of the same month only. FA amounts are the records booked in that month.</p>
        <div className="lwm-month">
          <label htmlFor="lwmMonth">Tally Booking Month</label>
          <select id="lwmMonth" className="form-control" value={month} onChange={(e) => chooseMonth(e.target.value)}>
            {months.map((m) => <option key={m.month} value={m.month}>{m.label}{m.status !== 'Open' ? ` (${m.status})` : ''}</option>)}
          </select>
          {current && <MonthStatus status={current.status} />}
          <Link to={`/months?month=${month}`} className="btn btn-light btn-sm">Open in Month-wise Data</Link>
        </div>
        {locked && <div className="alert alert-info">{current.label} is {current.status}. Its Tally figures can be viewed but not changed{current.status === 'Under Review' ? ' (an Admin can still change them)' : ' until an Admin re-opens the month'}.</div>}
        <Alert alert={alert} />
        <div className="button-row" style={{ marginBottom: 18 }}>
          <button type="button" className="btn btn-secondary" onClick={() => download('/lwm/template', 'LWM_Ledger_Wise_Matching_Template.xlsx').catch(() => {})}>Download Template</button>
          <input ref={fileRef} type="file" accept=".xlsx" className="form-control file-input" aria-label="Tally file" disabled={locked} />
          <button type="button" className="btn btn-primary" onClick={upload} disabled={locked}>Upload Excel</button>
          <button type="button" className="btn btn-light" onClick={reset} disabled={locked}>Reset</button>
          <button type="button" className="btn btn-secondary" onClick={load}>Refresh</button>
        </div>
        <div className="grid grid-3" style={{ marginBottom: 20 }}>
          <div className="stat-card"><div className="stat-label">FA Data Total</div><div className="stat-value">{formatMoney(data?.totalFA)}</div></div>
          <div className="stat-card"><div className="stat-label">Tally Total</div><div className="stat-value">{formatMoney(data?.totalTally)}</div></div>
          <div className="stat-card"><div className="stat-label">Difference</div><div className="stat-value">{formatMoney(data?.totalDifference)}</div></div>
        </div>
        <div className="table-wrapper">
          <table>
            <thead><tr><th>Expense Head</th><th className="num">FA Data Amount</th><th className="num">Tally Amount</th><th className="num">Difference</th><th>Status</th></tr></thead>
            <tbody>{body}</tbody>
            <tfoot>
              <tr className="lwm-total">
                <td className="text-right"><strong>Total</strong></td><td className="num">{formatMoney(data?.totalFA)}</td>
                <td className="num">{formatMoney(data?.totalTally)}</td><td className="num">{formatMoney(data?.totalDifference)}</td><td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </section>
  );
}
