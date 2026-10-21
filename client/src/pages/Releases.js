import React, { useCallback, useEffect, useState } from 'react';
import { call, errorMessage } from '../services/api';
import { useApp } from '../context/AppContext';
import { Alert, EmptyRow, Modal } from '../components/ui';
import { ReleaseNotes } from '../components/Version';

/**
 * Releases (Admin): the version running here, its deployments, and on the
 * Staging (SP) environment the approval of the tested version for production.
 */
export default function Releases() {
  const { withLoading } = useApp();
  const [data, setData] = useState(null);
  const [alert, setAlert] = useState(null);
  const [approve, setApprove] = useState(null); // { note, error }
  const [notes, setNotes] = useState(false);
  const load = useCallback(() => call('get', '/releases').then(setData).catch((err) => setAlert({ type: 'error', message: errorMessage(err) })), []);
  useEffect(() => { load(); }, [load]);

  const app = data?.app;
  const staging = app?.environment === 'staging';
  const current = data?.releases.find((r) => r.version === app?.version && r.status === 'deployed');

  const runApprove = () => withLoading('Approving...', () => call('post', `/releases/${app.version}/approve`, { note: approve.note }))
    .then((r) => { setApprove(null); setAlert({ type: 'success', message: r.message }); load(); })
    .catch((err) => setApprove((a) => a && { ...a, error: errorMessage(err) }));

  return (
    <section className="page">
      <div className="card">
        <div className="card-head" style={{ justifyContent: 'space-between' }}>
          <h3 className="card-title">Releases</h3>
          <button type="button" className="btn btn-light btn-sm" onClick={() => setNotes(true)}>Release notes</button>
        </div>
        {app && (
          <div className="release-now">
            <div><span className="muted">Environment</span><strong className={staging ? 'env-staging' : ''}>{app.environmentLabel}</strong></div>
            <div><span className="muted">Version running</span><strong>{app.version}</strong></div>
            <div><span className="muted">Released</span><strong>{app.releasedAt || '-'}</strong></div>
            <div><span className="muted">Deployed</span><strong>{current ? `${current.deployedAt} by ${current.deployedBy}` : 'Not deployed by the release scripts'}</strong></div>
          </div>
        )}
        <Alert alert={alert} />
        {staging && current && (
          current.approvedAt ? (
            <div className="alert alert-success">Version {app.version} was approved for production by {current.approvedBy} on {current.approvedAt}: “{current.approvalNote}”. It can now be deployed to production.</div>
          ) : (
            <div className="approve-box">
              <div>
                <strong>Approve version {app.version} for production</strong>
                <span>After users have tested this version here. The production deployment is refused until this version is approved.</span>
              </div>
              <button type="button" className="btn btn-success" onClick={() => setApprove({ note: '', error: '' })}>Approve for production…</button>
            </div>
          )
        )}
        {!staging && app && <p className="muted">New versions are tested and approved on the Staging (SP) environment first; the production deployment checks that approval.</p>}
      </div>

      <div className="card">
        <h3 className="card-title">Deployments to this environment</h3>
        <div className="table-wrapper">
          <table>
            <thead><tr><th>Version</th><th>Status</th><th>Deployed</th><th>Database changes</th><th>Backup before deployment</th><th>Approval</th></tr></thead>
            <tbody>
              {(data?.releases || []).map((r) => (
                <tr key={r.releaseId}>
                  <td><strong>{r.version}</strong>{r.version === app?.version && r.status === 'deployed' && <span className="release-tag">Running</span>}</td>
                  <td><span className={`badge ${r.status === 'deployed' ? 'badge-completed' : r.status === 'failed' ? 'badge-failed' : 'badge-pending'}`}>{r.status}</span>{r.notes && <div className="muted release-note">{r.notes}</div>}</td>
                  <td>{r.deployedAt}<div className="muted">{r.deployedBy}</div></td>
                  <td className="release-note">{r.migrations || <span className="muted">None</span>}</td>
                  <td className="archive-file" title={r.backupFile}>{r.backupFile ? r.backupFile.split(/[\\/]/).pop() : '-'}</td>
                  <td>{r.approvedAt ? <>{r.approvedBy}<div className="muted">{r.approvedAt}</div></> : <span className="muted">-</span>}</td>
                </tr>
              ))}
              {!(data?.releases || []).length && <EmptyRow cols={6}>{data ? 'No deployments recorded yet.' : 'Loading...'}</EmptyRow>}
            </tbody>
          </table>
        </div>
      </div>

      {approve && (
        <Modal small title={`Approve version ${app.version}`} onClose={() => setApprove(null)}
          footer={<><button type="button" className="btn btn-light footer-left" onClick={() => setApprove(null)}>Cancel</button>
            <button type="button" className="btn btn-success" disabled={approve.note.trim().length < 3} onClick={runApprove}>Approve for production</button></>}>
          {approve.error && <Alert alert={{ type: 'error', message: approve.error }} />}
          <div className="field">
            <label htmlFor="apNote">What was tested, and by whom? *</label>
            <textarea id="apNote" className="form-control" value={approve.note} onChange={(e) => setApprove({ ...approve, note: e.target.value, error: '' })}
              placeholder="e.g. Ravi and Sita tested Qty Plotting, FA Data export and Month-wise Data on 05/11/2026" />
          </div>
        </Modal>
      )}
      {notes && <ReleaseNotes onClose={() => setNotes(false)} />}
    </section>
  );
}
