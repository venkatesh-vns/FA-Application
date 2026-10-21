import React, { useEffect, useState } from 'react';
import { call, errorMessage } from '../services/api';
import { useApp } from '../context/AppContext';
import { Alert } from '../components/ui';
import { ReleaseNotes } from '../components/Version';

const Row = ({ k, v }) => <div className="set-row"><span>{k}</span><strong>{v === '' || v === undefined || v === null ? '-' : v}</strong></div>;

/**
 * Settings (every user): application version and release notes, own account
 * and password, session rules. Admin also sees where the application is
 * connected (database, archive, time zone) - never any password.
 */
export default function Settings() {
  const { withLoading, isAdmin } = useApp();
  const [data, setData] = useState(null);
  const [alert, setAlert] = useState(null);
  const [notes, setNotes] = useState(false);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [pwAlert, setPwAlert] = useState(null);
  useEffect(() => { call('get', '/settings').then(setData).catch((err) => setAlert({ type: 'error', message: errorMessage(err) })); }, []);

  const changePassword = (e) => {
    e.preventDefault();
    if (pw.newPassword !== pw.confirm) { setPwAlert({ type: 'error', message: 'The new password and its confirmation do not match.' }); return; }
    withLoading('Changing your password...', () => call('post', '/auth/change-password', { currentPassword: pw.currentPassword, newPassword: pw.newPassword }))
      .then((r) => { setPwAlert({ type: 'success', message: r.message }); setPw({ currentPassword: '', newPassword: '', confirm: '' }); })
      .catch((err) => setPwAlert({ type: 'error', message: errorMessage(err) }));
  };

  const app = data?.app;
  const sys = data?.system;
  return (
    <section className="page">
      <Alert alert={alert} />
      <div className="settings-grid">
        <div className="card">
          <h3 className="card-title">Application</h3>
          <Row k="Version" v={app && <span className="set-version">{app.version}</span>} />
          <Row k="Released" v={app?.releasedAt} />
          <Row k="Environment" v={app?.environmentLabel} />
          {app?.commit && <Row k="Build" v={<code>{app.commit}</code>} />}
          <button type="button" className="btn btn-light btn-sm" style={{ marginTop: 12 }} onClick={() => setNotes(true)}>What&apos;s new – release notes</button>
        </div>

        <div className="card">
          <h3 className="card-title">My account</h3>
          <Row k="Name" v={data?.me.name} />
          <Row k="Username" v={data?.me.username} />
          <Row k="Role" v={data?.me.role} />
          <Row k="Email" v={data?.me.email} />
          <Row k="Department" v={data?.me.department} />
        </div>

        <div className="card">
          <h3 className="card-title">Change my password</h3>
          <Alert alert={pwAlert} />
          <form onSubmit={changePassword}>
            <div className="field"><label htmlFor="pwCur">Current password</label><input id="pwCur" type="password" className="form-control" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></div>
            <div className="field"><label htmlFor="pwNew">New password <span className="label-hint">(at least 8 characters)</span></label><input id="pwNew" type="password" className="form-control" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /></div>
            <div className="field"><label htmlFor="pwNew2">Confirm new password</label><input id="pwNew2" type="password" className="form-control" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></div>
            <button type="submit" className="btn btn-primary" disabled={!pw.currentPassword || pw.newPassword.length < 8}>Change password</button>
          </form>
        </div>

        <div className="card">
          <h3 className="card-title">Session &amp; security</h3>
          <Row k="Signed out after no activity" v={data && `${data.session.idleMinutes} minutes`} />
          <Row k="Longest session" v={data && `${data.session.maxHours} hours`} />
          <Row k="Sign-ins per user ID" v="One at a time" />
          <Row k="Closed browser frees the ID after" v={data && `about ${data.session.openMinutes} minutes`} />
          <Row k="Passwords" v="Stored encrypted (bcrypt)" />
          <Row k="Sign-in token" v="JWT, checked against the session on every request" />
        </div>

        {isAdmin && sys && (
          <div className="card settings-wide">
            <h3 className="card-title">System (Admin)</h3>
            <p className="muted" style={{ marginTop: -8 }}>Read from the settings file (server <code>.env</code>). Passwords are never shown. To move the database (another server or the cloud) only these settings change.</p>
            <div className="settings-cols">
              <div>
                <Row k="Database server" v={`${sys.database.host}:${sys.database.port}`} />
                <Row k="Database name" v={sys.database.database} />
                <Row k="Database login" v={sys.database.user} />
                <Row k="Encrypted connection (SSL)" v={sys.database.ssl ? 'Yes' : 'No'} />
                <Row k="Archive database" v={sys.archiveDatabase} />
              </div>
              <div>
                <Row k="Business time zone" v={sys.timeZone} />
                <Row k="Behind a reverse proxy" v={sys.behindProxy ? 'Yes' : 'No'} />
                <Row k="HTTPS only" v={sys.httpsOnly ? 'Yes' : 'No'} />
                <Row k="Backup folder" v={sys.backupFolder} />
                <Row k="Node.js / running for" v={`${sys.node} / ${sys.uptimeMinutes} min`} />
              </div>
            </div>
          </div>
        )}
      </div>
      {notes && <ReleaseNotes onClose={() => setNotes(false)} />}
    </section>
  );
}
