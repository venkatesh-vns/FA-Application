import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { call, download, errorMessage } from '../services/api';
import { useApp } from '../context/AppContext';
import { Icon } from '../components/Layout';
import { MonthStatus } from '../components/MonthSelect';
import { Alert, EmptyRow, Modal, Pagination } from '../components/ui';
import { formatMoney, formatNumber } from '../utils/format';

const fyOf = (month) => {
  const [y, m] = month.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return { start, label: `FY ${start}-${String((start + 1) % 100).padStart(2, '0')}`, from: `${start}-04`, to: `${start + 1}-03` };
};
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const labelOf = (m) => `${MON[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const MOVED = ['FA records', 'Qty Plotting lines', 'Tally (LWM) uploads', 'Month close records and saved FAMS versions', 'Change history of those records'];
const KEPT = ['Branch, Category, Description, PO Client, Client / Cost Center masters', 'Ledger and Product masters', 'Users', 'Activity Log', 'FA Code counters (codes are never reused)'];

/**
 * Year-End Archive (Admin): back up the database, move a closed period's
 * transaction data to the archive database, view / export it there, restore it.
 */
export default function Archive() {
  const { withLoading } = useApp();
  const [data, setData] = useState(null);
  const [alert, setAlert] = useState(null);
  const [pick, setPick] = useState({ fy: '', from: '', to: '' });
  const [preview, setPreview] = useState(null);
  const [confirm, setConfirm] = useState('');
  const [view, setView] = useState(null);       // archived run being viewed
  const [restore, setRestore] = useState(null); // { run, confirm, error }

  const load = useCallback(() => call('get', '/archive').then(setData).catch((err) => setAlert({ type: 'error', message: errorMessage(err) })), []);
  useEffect(() => { load(); }, [load]);

  const months = useMemo(() => (data?.months || []).filter((m) => m.archivable), [data]);
  // a financial year's first / last month may have no data: still offer it in the lists
  const withPick = (list, value) => (value && !list.some((m) => m.month === value) ? [...list, { month: value, label: labelOf(value) }].sort((x, y) => x.month.localeCompare(y.month)) : list);
  const fys = useMemo(() => {
    const map = new Map();
    months.forEach((m) => { const f = fyOf(m.month); map.set(f.label, f); });
    return [...map.values()].sort((a, b) => b.start - a.start);
  }, [months]);

  const choose = (patch) => { setPick((p) => ({ ...p, ...patch })); setPreview(null); setConfirm(''); };
  const chooseFy = (label) => {
    const f = fys.find((x) => x.label === label);
    choose(f ? { fy: label, from: f.from, to: f.to } : { fy: '' });
  };

  const runPreview = () => withLoading('Checking the period...', () => call('post', '/archive/preview', { fromMonth: pick.from, toMonth: pick.to }))
    .then((p) => { setPreview(p); setAlert(null); })
    .catch((err) => setAlert({ type: 'error', message: errorMessage(err) }));

  const runArchive = () => withLoading('Backing up the database, copying to the archive and checking... this can take a few minutes for a full year.',
    () => call('post', '/archive', { fromMonth: preview.fromMonth, toMonth: preview.toMonth, confirm }))
    .then((r) => { setAlert({ type: 'success', message: r.message }); setPreview(null); setConfirm(''); setPick({ fy: '', from: '', to: '' }); load(); })
    .catch((err) => setAlert({ type: 'error', message: errorMessage(err) }));

  const runRestore = () => withLoading('Backing up the database and restoring the period...', () => call('post', `/archive/${restore.run.runId}/restore`, { confirm: restore.confirm }))
    .then((r) => { setRestore(null); setAlert({ type: 'success', message: r.message }); load(); })
    .catch((err) => setRestore((x) => x && { ...x, error: errorMessage(err) }));

  const ready = preview?.ok && confirm.trim().toUpperCase() === preview.confirmText;

  return (
    <section className="page">
      <div className="card">
        <h3 className="card-title"><Icon name="download" size={17} /> Year-End Archive</h3>
        <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>
          Moves the transaction data of a closed period out of the live database, keeping every master record. The app first takes a
          <strong> full database backup</strong>, then copies the period to the archive database <code>{data?.archiveDatabase || '…'}</code>,
          checks the copy and only then deletes it from the live database. Archived periods can be viewed, exported and restored here.
          Only <strong>Finalized / FAMS Uploaded</strong> months before the current financial year ({data?.currentFy || '…'}) can be archived.
        </p>
      </div>
      <Alert alert={alert} />

      <div className="card">
        <h3 className="card-title">1. Choose the period</h3>
        {!months.length && data && <p className="muted">No months before {data.currentFy} are in the live database.</p>}
        {months.length > 0 && (
          <div className="grid grid-4 archive-pick">
            <div className="field">
              <label htmlFor="arFy">Financial year</label>
              <select id="arFy" className="form-control" value={pick.fy} onChange={(e) => chooseFy(e.target.value)}>
                <option value="">Choose months below</option>
                {fys.map((f) => <option key={f.label} value={f.label}>{f.label} (Apr {f.start} – Mar {f.start + 1})</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="arFrom">From month</label>
              <select id="arFrom" className="form-control" value={pick.from} onChange={(e) => choose({ fy: '', from: e.target.value })}>
                <option value="">Choose</option>
                {withPick(months, pick.from).map((m) => <option key={m.month} value={m.month}>{m.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="arTo">To month</label>
              <select id="arTo" className="form-control" value={pick.to} onChange={(e) => choose({ fy: '', to: e.target.value })}>
                <option value="">Choose</option>
                {withPick(months, pick.to).filter((m) => !pick.from || m.month >= pick.from).map((m) => <option key={m.month} value={m.month}>{m.label}</option>)}
              </select>
            </div>
            <div className="field" style={{ alignSelf: 'end' }}>
              <button type="button" className="btn btn-primary" disabled={!pick.from || !pick.to} onClick={runPreview}>Check period</button>
            </div>
          </div>
        )}

        {preview && (
          <div className="archive-preview">
            <h4 className="sub-title">2. Check: {preview.label}</h4>
            <div className="table-wrapper">
              <table>
                <thead><tr><th>Month</th><th>Status</th><th className="num">Records</th><th className="num">Qty lines</th><th className="num">Amount</th></tr></thead>
                <tbody>
                  {preview.months.map((m) => (
                    <tr key={m.month}><td>{m.label}</td><td><MonthStatus status={m.status} /></td><td className="num">{formatNumber(m.records)}</td><td className="num">{formatNumber(m.lines)}</td><td className="num">{formatMoney(m.amount)}</td></tr>
                  ))}
                  {!preview.months.length && <EmptyRow cols={5}>No months with data in this period.</EmptyRow>}
                </tbody>
                <tfoot><tr><td colSpan={2}><strong>Total</strong></td><td className="num">{formatNumber(preview.records)}</td><td className="num">{formatNumber(preview.lines)}</td><td className="num">{formatMoney(preview.amount)}</td></tr></tfoot>
              </table>
            </div>
            {preview.problems.length > 0 ? (
              <div className="alert alert-error" style={{ marginTop: 12 }}>
                <strong>This period cannot be archived:</strong>
                <ul className="archive-problems">{preview.problems.map((p) => <li key={p}>{p}</li>)}</ul>
              </div>
            ) : (
              <>
                <div className="archive-split">
                  <div className="archive-moved"><strong>Moved to the archive database</strong><ul>{MOVED.map((x) => <li key={x}>{x}</li>)}</ul></div>
                  <div className="archive-kept"><strong>Not touched</strong><ul>{KEPT.map((x) => <li key={x}>{x}</li>)}</ul></div>
                </div>
                <h4 className="sub-title">3. Confirm</h4>
                <div className="archive-confirm">
                  <div className="field">
                    <label htmlFor="arConfirm">Type <strong>{preview.confirmText}</strong> to confirm</label>
                    <input id="arConfirm" className="form-control" autoComplete="off" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={preview.confirmText} />
                  </div>
                  <button type="button" className="btn btn-danger-solid btn-cta" disabled={!ready} onClick={runArchive}>
                    <Icon name="trash" size={15} /> Back up, archive &amp; delete from live
                  </button>
                </div>
                <p className="muted">{formatNumber(preview.records)} record(s) and {formatNumber(preview.lines)} line(s) will leave the live database. A backup file is written first; if any step fails nothing is deleted.</p>
              </>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head" style={{ justifyContent: 'space-between' }}>
          <h3 className="card-title">Archived periods</h3>
          <button type="button" className="btn btn-light btn-sm" onClick={load}>Refresh</button>
        </div>
        <div className="table-wrapper">
          <table>
            <thead><tr><th>Period</th><th>Status</th><th className="num">Records</th><th className="num">Lines</th><th className="num">Amount</th><th>Archived</th><th>Backup file</th><th>Action</th></tr></thead>
            <tbody>
              {(data?.runs || []).map((r) => (
                <tr key={r.runId}>
                  <td><strong>{r.label}</strong><div className="muted">{r.fromMonth} to {r.toMonth}</div></td>
                  <td>
                    <span className={`badge ${r.status === 'archived' ? 'badge-completed' : r.status === 'failed' ? 'badge-failed' : 'badge-pending'}`}>{r.status}</span>
                    {r.status === 'failed' && <div className="muted archive-error" title={r.error}>{r.error}</div>}
                    {r.status === 'restored' && <div className="muted">by {r.restoredBy}, {r.restoredAt}</div>}
                  </td>
                  <td className="num">{formatNumber(r.records)}</td><td className="num">{formatNumber(r.lines)}</td><td className="num">{formatMoney(r.amount)}</td>
                  <td>{r.createdBy}<div className="muted">{r.createdAt}</div></td>
                  <td className="archive-file" title={r.backupFile}>{r.backupFile ? r.backupFile.split(/[\\/]/).pop() : '-'}{r.backupBytes > 0 && <div className="muted">{(r.backupBytes / 1048576).toFixed(1)} MB</div>}</td>
                  <td>
                    {r.status === 'archived' && (
                      <div className="actions">
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setView(r)}>View</button>
                        <button type="button" className="btn btn-warning btn-sm" onClick={() => setRestore({ run: r, confirm: '', error: '' })}>Restore</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {!(data?.runs || []).length && <EmptyRow cols={8}>{data ? 'Nothing has been archived yet.' : 'Loading...'}</EmptyRow>}
            </tbody>
          </table>
        </div>
      </div>

      {view && <ArchiveView run={view} onClose={() => setView(null)} />}
      {restore && (
        <Modal small title={`Restore ${restore.run.label}`} onClose={() => setRestore(null)}
          footer={<><button type="button" className="btn btn-light footer-left" onClick={() => setRestore(null)}>Cancel</button>
            <button type="button" className="btn btn-warning" disabled={restore.confirm.trim().toUpperCase() !== restore.run.confirmRestore} onClick={runRestore}>Restore to live</button></>}>
          {restore.error && <Alert alert={{ type: 'error', message: restore.error }} />}
          <p>{formatNumber(restore.run.records)} record(s) and {formatNumber(restore.run.lines)} line(s) go back into the live database exactly as they were archived (same FA Codes, months Finalized). A backup is taken first.</p>
          <div className="field">
            <label htmlFor="rsConfirm">Type <strong>{restore.run.confirmRestore}</strong> to confirm</label>
            <input id="rsConfirm" className="form-control" autoComplete="off" value={restore.confirm} onChange={(e) => setRestore({ ...restore, confirm: e.target.value, error: '' })} />
          </div>
        </Modal>
      )}
    </section>
  );
}

// An archived period: its records (paged, searchable), one record's lines / history, export
function ArchiveView({ run, onClose }) {
  const { withLoading } = useApp();
  const [state, setState] = useState({ page: 1, size: 10, search: '', term: '' });
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { const t = setTimeout(() => setState((s) => ({ ...s, term: s.search.trim(), page: s.search.trim() !== s.term ? 1 : s.page })), 300); return () => clearTimeout(t); }, [state.search]);
  useEffect(() => {
    call('get', `/archive/${run.runId}/records?page=${state.page}&size=${state.size}${state.term ? `&search=${encodeURIComponent(state.term)}` : ''}`)
      .then(setData).catch((err) => setError(errorMessage(err)));
  }, [run.runId, state.page, state.size, state.term]);
  const details = (faCode) => {
    if (open?.raw?.faCode === faCode) { setOpen(null); return; }
    call('get', `/archive/${run.runId}/records/${encodeURIComponent(faCode)}`).then(setOpen).catch((err) => setError(errorMessage(err)));
  };
  const exportFile = () => withLoading('Preparing the archive export...', () => download(`/archive/${run.runId}/export`, 'Archive_FA_Data.xlsx')).catch((err) => setError(errorMessage(err)));
  return (
    <Modal title={`Archive: ${run.label}`} progress={`${formatNumber(run.records)} record(s) · ${formatMoney(run.amount)} · archived ${run.createdAt} by ${run.createdBy} · read-only`} onClose={onClose}
      footer={<><button type="button" className="btn btn-light footer-left" onClick={onClose}>Close</button><button type="button" className="btn btn-primary" onClick={exportFile}><Icon name="download" size={14} /> Export FA Data</button></>}>
      {error && <Alert alert={{ type: 'error', message: error }} />}
      <div className="table-wrapper" style={{ marginBottom: 12 }}>
        <table>
          <thead><tr><th>Month</th><th>Status</th><th className="num">Records</th><th className="num">Lines</th><th className="num">Amount</th></tr></thead>
          <tbody>{(run.months || []).map((m) => <tr key={m.month}><td>{m.label}</td><td><MonthStatus status={m.status} /></td><td className="num">{formatNumber(m.records)}</td><td className="num">{formatNumber(m.lines)}</td><td className="num">{formatMoney(m.amount)}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="search-box" style={{ marginBottom: 10, maxWidth: 380 }}>
        <Icon name="search" size={15} />
        <input className="form-control" placeholder="Search FA Code, invoice, vendor…" value={state.search} onChange={(e) => setState({ ...state, search: e.target.value })} />
      </div>
      <div className="table-wrapper">
        <table>
          <thead><tr><th>FA Code</th><th>Inv No</th><th>Date</th><th>Tally Month</th><th>Cost Center</th><th>Vendor</th><th>Expense Head</th><th className="num">Amount</th><th>Status</th></tr></thead>
          <tbody>
            {(data?.rows || []).map((r) => (
              <React.Fragment key={r.faCode}>
                <tr className="row-link" onClick={() => details(r.faCode)}>
                  <td><strong>{r.faCode}</strong></td><td>{r.invNo}</td><td>{r.date}</td><td>{r.month}</td><td>{r.costCenter}</td><td>{r.vendor}</td><td>{r.expenseHead}</td>
                  <td className="num">{formatMoney(r.amount)}</td><td>{r.status}</td>
                </tr>
                {open?.raw?.faCode === r.faCode && (
                  <tr className="archive-detail"><td colSpan={9}>
                    <strong>Qty Plotting</strong>
                    {!open.products.length ? <div className="muted">No Qty Plotting.</div> : (
                      <ul>{open.products.map((p, i) => <li key={i}>{p.product} · {formatNumber(p.quantity)} × {formatMoney(p.unitPrice)} = <strong>{formatMoney(p.productAmount)}</strong> · {p.taggable}{p.againstInvoiceNo ? ` · against ${p.againstInvoiceNo}` : ''}{p.againstAssetCode ? ` / ${p.againstAssetCode}` : ''}</li>)}</ul>
                    )}
                    {open.history.length > 0 && (<><strong>Change history</strong><ul>{open.history.map((h, i) => <li key={i}>{h.at} · {h.by}: {h.field} {h.oldValue || '-'} → {h.newValue || '-'} ({h.source})</li>)}</ul></>)}
                  </td></tr>
                )}
              </React.Fragment>
            ))}
            {!data?.rows.length && <EmptyRow cols={9}>{data ? 'No records match.' : 'Loading...'}</EmptyRow>}
          </tbody>
        </table>
      </div>
      {data?.total > 0 && <Pagination page={state.page} size={state.size} total={data.total} onPage={(page) => setState({ ...state, page })} onSize={(size) => setState({ ...state, size, page: 1 })} />}
    </Modal>
  );
}
