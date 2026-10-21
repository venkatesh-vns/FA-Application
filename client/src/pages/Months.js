import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { call, download, errorMessage } from '../services/api';
import { useApp } from '../context/AppContext';
import { Icon } from '../components/Layout';
import { MonthStatus } from '../components/MonthSelect';
import { Alert, EmptyRow, Modal, usePaged } from '../components/ui';
import { formatMoney, formatNumber, todayInput } from '../utils/format';

const STAGES = ['Open', 'Under Review', 'Finalized', 'FAMS Uploaded'];
const FIX_LINKS = {
  pending: { to: '/upload', text: 'Go to Qty Plotting' },
  tally: { to: (m) => `/lwm?month=${m}`, text: 'Go to LWM Reconciliation' },
  fams: { to: '/masters/branch', text: 'Fix masters' },
  credit: { to: '/fa', text: 'Go to FA Data' },
};

/**
 * Month-wise Data: every Tally booking month with its stage, the checks for
 * finalizing, the actions (submit, send back, finalize, FAMS uploaded,
 * re-open), saved versions with their FAMS / changes-only files, the month's
 * history and (Admin) field-level change history.
 */
export default function Months() {
  const { isAdmin, withLoading } = useApp();
  const [params, setParams] = useSearchParams();
  const [list, setList] = useState(null);
  const [month, setMonth] = useState(params.get('month') || '');
  const [detail, setDetail] = useState(null);
  const [alert, setAlert] = useState(null);
  const [dialog, setDialog] = useState(null); // { kind, ... }

  const loadList = useCallback(() => call('get', '/months').then((r) => {
    setList(r.months);
    setMonth((m) => m || (r.months.find((x) => x.status === 'Open') || r.months[0] || {}).month || '');
  }).catch((err) => setAlert({ type: 'error', message: errorMessage(err) })), []);
  const loadDetail = useCallback(() => {
    if (!month) return Promise.resolve();
    return call('get', `/months/${month}`).then(setDetail).catch((err) => setAlert({ type: 'error', message: errorMessage(err) }));
  }, [month]);
  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { setDetail(null); loadDetail(); }, [loadDetail]);

  const choose = (m) => { setMonth(m); setAlert(null); setParams({ month: m }); };
  const refresh = () => Promise.all([loadList(), loadDetail()]);

  // runs a month action, then shows its message and reloads
  const act = (label, path, body) => withLoading(label, () => call('post', `/months/${month}/${path}`, body))
    .then((r) => { setDialog(null); setAlert({ type: 'success', message: r.message }); return refresh(); })
    .catch((err) => {
      const message = errorMessage(err);
      if (dialog) setDialog((d) => d && { ...d, error: message }); else setAlert({ type: 'error', message });
    });

  const getFile = (version, kind) => withLoading('Preparing file...', () => download(`/months/${month}/versions/${version}/${kind}`, `${kind}.xlsx`))
    .then((n) => setAlert({ type: 'success', message: `File downloaded (${formatNumber(n)} row(s)).` }))
    .catch((err) => setAlert({ type: 'error', message: errorMessage(err) }));

  const d = detail;
  const tally = d?.checks.find((c) => c.id === 'tally');
  const blocking = d ? d.checks.filter((c) => !c.ok && !c.overridable) : [];
  const stage = d ? STAGES.indexOf(d.status) : -1;
  const latest = d?.versions.find((v) => v.kind === 'finalized');

  return (
    <section className="page">
      <div className="card month-intro">
        <h3 className="card-title"><Icon name="calendar" size={17} /> Month-wise Data</h3>
        <p className="muted">
          Records belong to the month they are booked in Tally. Work a month in <strong>Upload &amp; Qty Plotting</strong> and <strong>LWM Reconciliation</strong>,
          then <strong>Submit for review</strong>. An Admin finalizes it once every check is green: the month is then locked and its FAMS file is kept.
          Corrections after that need an Admin to <strong>re-open</strong> the month with a reason; finalizing again gives a <strong>changes-only FAMS file</strong>.
        </p>
      </div>
      <Alert alert={alert} />

      <div className="month-grid">
        {!list && <div className="empty">Loading...</div>}
        {list && !list.length && <div className="empty">No months yet. Months appear when records are saved.</div>}
        {(list || []).map((m) => (
          <button key={m.month} type="button" className={`month-card${m.month === month ? ' active' : ''}`} onClick={() => choose(m.month)}>
            <span className="month-card-head"><strong>{m.label}</strong><MonthStatus status={m.status} /></span>
            <span className="month-card-figs">
              <span><b>{formatNumber(m.records)}</b> records</span>
              <span><b>{formatMoney(m.amount)}</b></span>
            </span>
            <span className="month-card-foot">
              {m.pending ? <span className="warn">{m.pending} pending Qty</span> : <span className="ok">All plotted</span>}
              {m.version > 0 && <span className="muted">v{m.version}</span>}
            </span>
          </button>
        ))}
      </div>

      {month && (
        <div className="card month-detail">
          {!d ? <div className="empty">Loading...</div> : (
            <>
              <div className="month-head">
                <div>
                  <h3>{d.label} <MonthStatus status={d.status} />{d.version > 0 && <span className="month-version">Version {d.version}</span>}</h3>
                  <div className="month-meta">
                    <span>{formatNumber(d.records)} records · {formatMoney(d.amount)} · {d.pending} pending · {d.creditNotes} credit note(s)</span>
                    {d.submittedBy && <span>Submitted by {d.submittedBy}, {d.submittedAt}</span>}
                    {d.finalizedBy && d.status !== 'Open' && <span>Finalized by {d.finalizedBy}, {d.finalizedAt}</span>}
                    {d.famsReference && <span>FAMS upload {d.famsReference} on {d.famsUploadedOn} by {d.famsUploadedBy}</span>}
                    {d.reopenedBy && <span>Last re-opened by {d.reopenedBy}, {d.reopenedAt}: “{d.reopenReason}”</span>}
                    {d.lwmRemark && d.status !== 'Open' && <span>Tally note: {d.lwmRemark}</span>}
                  </div>
                </div>
                <button type="button" className="btn btn-light btn-sm" onClick={refresh}><Icon name="refresh" size={14} /> Refresh</button>
              </div>

              <ol className="stepper">
                {STAGES.map((s, i) => (
                  <li key={s} className={i < stage ? 'done' : i === stage ? 'current' : ''}><span className="dot">{i < stage ? '✓' : i + 1}</span>{s}</li>
                ))}
              </ol>

              <div className="month-cols">
                <div>
                  <h4 className="sub-title">Checks for finalizing</h4>
                  <ul className="checklist">
                    {d.checks.map((c) => {
                      const fix = FIX_LINKS[c.id];
                      return (
                        <li key={c.id} className={c.ok ? 'ok' : c.overridable ? 'warn' : 'bad'}>
                          <span className="check-icon" aria-hidden="true">{c.ok ? '✓' : c.overridable ? '!' : '✕'}</span>
                          <div>
                            <strong>{c.label}</strong>
                            <span>{c.detail}</span>
                            {!c.ok && fix && d.status === 'Open' && <Link to={typeof fix.to === 'function' ? fix.to(d.month) : fix.to}>{fix.text} ›</Link>}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  {d.lwm.rows.length > 0 && (
                    <details className="month-more">
                      <summary>Tally differences ({d.lwm.rows.length})</summary>
                      <table>
                        <thead><tr><th>Expense Head</th><th className="num">FA</th><th className="num">Tally</th><th className="num">Difference</th></tr></thead>
                        <tbody>{d.lwm.rows.map((r) => <tr key={r.expenseHead}><td>{r.expenseHead}</td><td className="num">{formatMoney(r.faAmount)}</td><td className="num">{formatMoney(r.tallyAmount)}</td><td className="num">{formatMoney(r.difference)}</td></tr>)}</tbody>
                      </table>
                    </details>
                  )}
                  {d.famsErrors.length > 0 && (
                    <details className="month-more">
                      <summary>FAMS Error Remarks ({d.famsErrors.length}{d.famsErrors.length === 50 ? '+' : ''})</summary>
                      <table>
                        <thead><tr><th>FA Code</th><th>Error Remark</th></tr></thead>
                        <tbody>{d.famsErrors.map((e, i) => <tr key={`${e.faCode}-${i}`}><td>{e.faCode}</td><td>{e.error}</td></tr>)}</tbody>
                      </table>
                    </details>
                  )}
                </div>

                <div>
                  <h4 className="sub-title">Actions</h4>
                  <div className="month-actions">
                    {d.status === 'Open' && (
                      <ActionRow title="Submit for review" text="Locks the month for users; an Admin then finalizes it or sends it back."
                        disabled={blocking.length > 0} why={blocking.length ? 'Fix the red checks first.' : ''}>
                        <button type="button" className="btn btn-primary" disabled={blocking.length > 0} onClick={() => act('Submitting month...', 'submit')}>Submit for review</button>
                      </ActionRow>
                    )}
                    {isAdmin && ['Open', 'Under Review'].includes(d.status) && (
                      <ActionRow title="Finalize month" text="Locks the month for everyone and keeps its FAMS file as a new version."
                        disabled={blocking.length > 0} why={blocking.length ? 'Fix the red checks first.' : ''}>
                        <button type="button" className="btn btn-success" disabled={blocking.length > 0} onClick={() => setDialog({ kind: 'finalize', remark: '', needRemark: !tally.ok })}>Finalize…</button>
                      </ActionRow>
                    )}
                    {isAdmin && d.status === 'Under Review' && (
                      <ActionRow title="Send back" text="Returns the month to Open so users can correct it.">
                        <button type="button" className="btn btn-light" onClick={() => setDialog({ kind: 'sendBack', reason: '' })}>Send back…</button>
                      </ActionRow>
                    )}
                    {isAdmin && d.status === 'Finalized' && (
                      <ActionRow title="Mark uploaded to FAMS" text="After loading this version's file into FAMS, record the FAMS reference.">
                        <button type="button" className="btn btn-primary" onClick={() => setDialog({ kind: 'fams', reference: '', uploadedOn: todayInput() })}>Mark uploaded…</button>
                      </ActionRow>
                    )}
                    {isAdmin && ['Finalized', 'FAMS Uploaded'].includes(d.status) && (
                      <ActionRow title="Re-open month" text="Unlocks the month for corrections. A reason is required and recorded.">
                        <button type="button" className="btn btn-warning" onClick={() => setDialog({ kind: 'reopen', reason: '' })}>Re-open…</button>
                      </ActionRow>
                    )}
                    {!isAdmin && d.status !== 'Open' && (
                      <p className="muted">{d.label} is {d.status}. {d.status === 'Under Review' ? 'An Admin will finalize it or send it back.' : 'Changes need an Admin to re-open the month.'}</p>
                    )}
                    {latest && (
                      <ActionRow title={`Files of version ${latest.version}`} text={latest.version > 1 ? 'Load the changes-only file into FAMS; the full file is for reference.' : 'Load this file into FAMS.'}>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => getFile(latest.version, 'fams')}><Icon name="download" size={14} /> FAMS file</button>
                        {latest.version > 1 && <button type="button" className="btn btn-primary btn-sm" onClick={() => getFile(latest.version, 'changes')}><Icon name="download" size={14} /> Changes only ({latest.changes})</button>}
                      </ActionRow>
                    )}
                    <div className="month-links">
                      <Link to={`/lwm?month=${d.month}`}>LWM Reconciliation for {d.label} ›</Link>
                      <Link to="/upload">Upload &amp; Qty Plotting ›</Link>
                    </div>
                  </div>
                </div>
              </div>

              <h4 className="sub-title">Versions</h4>
              <div className="table-wrapper">
                <table>
                  <thead><tr><th>Version</th><th>Saved</th><th>By</th><th className="num">Records</th><th className="num">FAMS rows</th><th className="num">Amount</th><th className="num">Changes</th><th>Fingerprint</th><th>Files</th></tr></thead>
                  <tbody>
                    {d.versions.map((v) => (
                      <tr key={v.version}>
                        <td><strong>v{v.version}</strong>{v.kind === 'baseline' && <span className="muted"> (copy at re-open)</span>}</td>
                        <td>{v.at}</td><td>{v.by}</td><td className="num">{formatNumber(v.records)}</td><td className="num">{formatNumber(v.lines)}</td>
                        <td className="num">{formatMoney(v.amount)}</td><td className="num">{v.version > 1 && v.kind === 'finalized' ? v.changes : '-'}</td>
                        <td><code title={v.fingerprint}>{v.fingerprint.slice(0, 12)}…</code></td>
                        <td>
                          <div className="actions">
                            <button type="button" className="btn btn-light btn-sm" onClick={() => getFile(v.version, 'fams')}>FAMS</button>
                            {v.version > 1 && v.kind === 'finalized' && <button type="button" className="btn btn-light btn-sm" onClick={() => getFile(v.version, 'changes')}>Changes</button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!d.versions.length && <EmptyRow cols={9}>{d.version ? 'Finalized before versions were kept. A copy is taken if the month is re-opened.' : 'Not finalized yet.'}</EmptyRow>}
                  </tbody>
                </table>
              </div>

              <h4 className="sub-title">Month history</h4>
              {!d.events.length ? <p className="muted">No status changes yet.</p> : (
                <ul className="timeline">
                  {d.events.map((e, i) => (
                    <li key={`${e.at}-${i}`}>
                      <span className="tl-dot" />
                      <div><strong>{e.action}</strong> <span className="muted">{e.from} → {e.to} · {e.by} · {e.at}</span>{e.details && <div className="tl-details">{e.details}</div>}</div>
                    </li>
                  ))}
                </ul>
              )}

              {isAdmin && <ChangeHistory rows={d.changeHistory} />}
            </>
          )}
        </div>
      )}

      {dialog && (
        <ActionDialog dialog={dialog} setDialog={setDialog} label={d?.label}
          onFinalize={() => act('Finalizing month...', 'finalize', { lwmRemark: dialog.remark })}
          onSendBack={() => act('Sending back...', 'send-back', { reason: dialog.reason })}
          onFams={() => act('Saving...', 'fams-uploaded', { reference: dialog.reference, uploadedOn: dialog.uploadedOn })}
          onReopen={() => act('Re-opening month...', 'reopen', { reason: dialog.reason })} />
      )}
    </section>
  );
}

function ActionRow({ title, text, children, disabled, why }) {
  return (
    <div className={`action-row${disabled ? ' disabled' : ''}`}>
      <div><strong>{title}</strong><span>{why || text}</span></div>
      <div className="action-buttons">{children}</div>
    </div>
  );
}

// Finalize / send back / FAMS uploaded / re-open windows
function ActionDialog({ dialog, setDialog, label, onFinalize, onSendBack, onFams, onReopen }) {
  const set = (patch) => setDialog({ ...dialog, ...patch, error: '' });
  const close = () => setDialog(null);
  const cfg = {
    finalize: {
      title: `Finalize ${label}`, ok: 'Finalize', run: onFinalize, okClass: 'btn-success',
      ready: !dialog.needRemark || (dialog.remark || '').trim().length >= 3,
      body: (
        <>
          <p>The month will be <strong>locked for everyone</strong> and its FAMS file kept as a new version. Corrections afterwards need a re-open.</p>
          {dialog.needRemark && (
            <div className="field">
              <label htmlFor="dlgRemark">Tally (LWM) does not match – remark accepting the difference *</label>
              <textarea id="dlgRemark" className="form-control" value={dialog.remark} onChange={(e) => set({ remark: e.target.value })} placeholder="e.g. Difference is a Tally entry booked next month; approved by Finance" />
            </div>
          )}
        </>
      ),
    },
    sendBack: {
      title: `Send ${label} back`, ok: 'Send back', run: onSendBack, okClass: 'btn-warning', ready: (dialog.reason || '').trim().length >= 3,
      body: (
        <div className="field">
          <label htmlFor="dlgReason">What needs correcting? *</label>
          <textarea id="dlgReason" className="form-control" value={dialog.reason} onChange={(e) => set({ reason: e.target.value })} />
        </div>
      ),
    },
    fams: {
      title: `${label} uploaded to FAMS`, ok: 'Save', run: onFams, okClass: 'btn-primary', ready: (dialog.reference || '').trim().length > 0,
      body: (
        <div className="grid grid-2">
          <div className="field"><label htmlFor="dlgRef">FAMS reference (batch / ticket no) *</label><input id="dlgRef" className="form-control" value={dialog.reference} onChange={(e) => set({ reference: e.target.value })} /></div>
          <div className="field"><label htmlFor="dlgOn">Uploaded on</label><input id="dlgOn" type="date" className="form-control" value={dialog.uploadedOn} onChange={(e) => set({ uploadedOn: e.target.value })} /></div>
        </div>
      ),
    },
    reopen: {
      title: `Re-open ${label}`, ok: 'Re-open month', run: onReopen, okClass: 'btn-warning', ready: (dialog.reason || '').trim().length >= 5,
      body: (
        <>
          <p>The month becomes <strong>Open</strong> again so its records can be corrected. Finalize it again afterwards: the app then gives a <strong>changes-only FAMS file</strong> for the corrections.</p>
          <div className="field">
            <label htmlFor="dlgReopen">Reason for re-opening * <span className="label-hint">(recorded in the month history)</span></label>
            <textarea id="dlgReopen" className="form-control" value={dialog.reason} onChange={(e) => set({ reason: e.target.value })} placeholder="e.g. Wrong quantity on invoice INV-123, approved by Finance Controller" />
          </div>
        </>
      ),
    },
  }[dialog.kind];
  return (
    <Modal title={cfg.title} small onClose={close}
      footer={<><button type="button" className="btn btn-light footer-left" onClick={close}>Cancel</button><button type="button" className={`btn ${cfg.okClass}`} disabled={!cfg.ready} onClick={cfg.run}>{cfg.ok}</button></>}>
      {dialog.error && <Alert alert={{ type: 'error', message: dialog.error }} />}
      {cfg.body}
    </Modal>
  );
}

function ChangeHistory({ rows }) {
  const [search, setSearch] = useState('');
  const s = search.trim().toLowerCase();
  const list = s ? rows.filter((r) => [r.faCode, r.field, r.oldValue, r.newValue, r.by, r.source].join(' ').toLowerCase().includes(s)) : rows;
  const paged = usePaged(list);
  return (
    <>
      <h4 className="sub-title">Change history <span className="muted">(Admin · last 500 changes in this month)</span></h4>
      {!rows.length ? <p className="muted">No field changes recorded for this month.</p> : (
        <>
          <div className="search-box" style={{ marginBottom: 10, maxWidth: 360 }}>
            <Icon name="search" size={15} />
            <input className="form-control" placeholder="Search FA Code, field, value, user…" value={search} onChange={(e) => { setSearch(e.target.value); paged.reset(); }} />
          </div>
          <div className="table-wrapper">
            <table>
              <thead><tr><th>When</th><th>By</th><th>FA Code</th><th>Field</th><th>Old value</th><th>New value</th><th>Screen</th></tr></thead>
              <tbody>
                {paged.rows.map((h, i) => (
                  <tr key={`${h.at}-${h.faCode}-${h.field}-${i}`}>
                    <td>{h.at}</td><td>{h.by}</td><td><strong>{h.faCode}</strong></td><td>{h.field}</td>
                    <td className="hist-old">{h.oldValue || '-'}</td><td className="hist-new">{h.newValue || '-'}</td><td>{h.source}</td>
                  </tr>
                ))}
                {!paged.rows.length && <EmptyRow cols={7}>No matching changes.</EmptyRow>}
              </tbody>
            </table>
          </div>
          {paged.pager}
        </>
      )}
    </>
  );
}
