import React, { useCallback, useEffect, useState } from 'react';
import { call, errorMessage } from '../services/api';
import { Alert, EmptyRow, Pagination, pageOf } from '../components/ui';

const PAGE_SIZE = 50;
const stamp = (v) => new Date(v).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false });

// Activity Log (Admin) - the 'Activity Log' sheet, newest first
export default function ActivityLog() {
  const [rows, setRows] = useState(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [alert, setAlert] = useState(null);

  const load = useCallback((term) => {
    call('get', `/activity?limit=2000&search=${encodeURIComponent(term || '')}`)
      .then((r) => { setRows(r); setPage(1); })
      .catch((err) => { setRows([]); setAlert({ type: 'error', message: errorMessage(err) }); });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(search), 300);
    return () => clearTimeout(t);
  }, [search, load]);

  return (
    <section className="page">
      <div className="card">
        <div className="card-head">
          <h3 className="card-title">Activity Log</h3>
          <button type="button" className="btn btn-light btn-sm" onClick={() => load(search)}>Refresh</button>
          <input className="form-control global-filter" placeholder="Search user, action, FA Code, invoice, details..." value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search activity" />
        </div>
        <Alert alert={alert} />
        <p className="muted">Latest 2,000 entries.</p>
        <div className="table-wrapper">
          <table className="log-table">
            <thead><tr><th>Timestamp</th><th>Username</th><th>Name</th><th>Action</th><th>Module</th><th>FA Code</th><th>Inv No</th><th>Expense Head</th><th>Details</th></tr></thead>
            <tbody>
              {pageOf(rows || [], page, PAGE_SIZE).map((r) => (
                <tr key={r.log_id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{stamp(r.logged_at)}</td><td>{r.username}</td><td>{r.name}</td><td>{r.action}</td><td>{r.module}</td>
                  <td>{r.fa_code}</td><td>{r.inv_no}</td><td>{r.expense_head}</td><td>{r.details}</td>
                </tr>
              ))}
              {!rows?.length && <EmptyRow cols={9}>{rows ? 'No activity found.' : 'Loading...'}</EmptyRow>}
            </tbody>
          </table>
        </div>
        {rows?.length > 0 && <Pagination page={page} size={PAGE_SIZE} total={rows.length} onPage={setPage} />}
      </div>
    </section>
  );
}
