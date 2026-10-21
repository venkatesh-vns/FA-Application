import React, { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { errorMessage } from '../services/api';
import { EnvironmentBanner, VersionLink } from '../components/Version';
import './Login.css';

const REMEMBER_KEY = 'faRememberUser';

const Icon = ({ d, size = 18 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d.map((p) => <path key={p} d={p} />)}
  </svg>
);
const ICONS = {
  user: ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
  lock: ['M5 11h14v10H5z', 'M8 11V7a4 4 0 0 1 8 0v4'],
  eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
  eyeOff: ['M3 3l18 18', 'M10.6 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1', 'M6.6 6.6A17.4 17.4 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6', 'M9.9 9.9a3 3 0 0 0 4.2 4.2'],
  arrow: ['M5 12h14', 'M13 6l6 6-6 6'],
  code: ['M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2', 'M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2', 'M8 9v6', 'M12 9v6', 'M16 9v6'],
  layers: ['M12 3l9 5-9 5-9-5 9-5z', 'M3 13l9 5 9-5'],
  scale: ['M12 3v18', 'M5 7h14', 'M5 7l-3 7a4 4 0 0 0 6 0L5 7z', 'M19 7l-3 7a4 4 0 0 0 6 0l-3-7z'],
  shield: ['M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z', 'M9 12l2 2 4-4'],
  devices: ['M3 5h12v9H3z', 'M7 18h4', 'M9 14v4', 'M17 9h4v10h-4z'],
  alert: ['M12 9v4', 'M12 17h.01', 'M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'],
};

// "2 minutes ago" for the already-signed-in dialog
function ago(when) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(when).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 minute ago';
  if (mins < 60) return `${mins} minutes ago`;
  return 'over an hour ago';
}

const START_MESSAGES = {
  expired: 'Your session has expired. Please sign in again.',
  replaced: 'You were signed out because this user signed in on another browser or computer.',
  idle: 'You were signed out after 30 minutes without activity. Please sign in again.',
  ended: 'An Admin signed you out. Please sign in again.',
};

const CAPABILITIES = [
  ['code', 'Automated FA coding', 'Every invoice receives a unique month-wise FA Code the moment it is recorded.'],
  ['layers', 'Asset-level breakdown', 'Invoices are plotted into products, quantities and taggable assets.'],
  ['scale', 'Ledger reconciliation', 'FA records are matched with Tally and exported to FAMS with validations.'],
];

// Sign-in page: brand panel (left) and sign-in form (right)
export default function Login() {
  const { user, login } = useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const remembered = (() => { try { return localStorage.getItem(REMEMBER_KEY) || ''; } catch { return ''; } })();
  const [username, setUsername] = useState(remembered);
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(Boolean(remembered));
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(START_MESSAGES[['replaced', 'idle', 'ended', 'expired'].find((k) => params.get(k))] || '');
  const [conflict, setConflict] = useState(null); // already signed in elsewhere: { device, since, lastActive, openMinutes }

  if (user) return <Navigate to="/dashboard" replace />;

  const signIn = async () => {
    setError('');
    setConflict(null);
    setBusy(true);
    try {
      await login(username.trim(), password);
      try {
        if (remember) localStorage.setItem(REMEMBER_KEY, username.trim());
        else localStorage.removeItem(REMEMBER_KEY);
      } catch { /* storage unavailable */ }
      navigate('/dashboard');
    } catch (err) {
      const body = err.response?.data;
      if (body?.code === 'ALREADY_SIGNED_IN') setConflict({ device: body.device, since: body.since, lastActive: body.lastActive, openMinutes: body.openMinutes || 3 });
      else setError(errorMessage(err));
      setBusy(false);
    }
  };

  const submit = (e) => {
    e.preventDefault();
    setError('');
    if (!username.trim() || !password) { setError('Username and password are required.'); return; }
    signIn();
  };

  const capsCheck = (e) => setCaps(Boolean(e.getModifierState && e.getModifierState('CapsLock')));
  const year = new Date().getFullYear();

  return (
    <div className="auth">
      <aside className="auth-brand" aria-hidden="false">
        <div className="auth-brand-bg" aria-hidden="true" />
        <header className="auth-logo">
          <span className="auth-mark">FA</span>
          <span>
            <strong>FA Management System</strong>
            <small>Fixed Asset Control Platform</small>
          </span>
        </header>

        <div className="auth-brand-main">
          <p className="auth-eyebrow">Enterprise Asset Governance</p>
          <h1>Every fixed asset,<br />accounted for.</h1>
          <p className="auth-lead">
            A single controlled record of capital expenditure — from invoice to tagged asset to reconciled ledger.
          </p>

          <ul className="auth-capabilities">
            {CAPABILITIES.map(([icon, title, text]) => (
              <li key={title}>
                <span className="auth-cap-icon"><Icon d={ICONS[icon]} size={20} /></span>
                <span><strong>{title}</strong><small>{text}</small></span>
              </li>
            ))}
          </ul>

          <div className="auth-preview" aria-hidden="true">
            <div className="auth-preview-head">
              <span>Ledger Wise Matching</span>
              <span className="auth-pill">Matched</span>
            </div>
            {[['FA Data', 92], ['Tally', 92], ['Qty Plotted', 78]].map(([label, w]) => (
              <div className="auth-bar" key={label}>
                <span>{label}</span>
                <i><b style={{ width: `${w}%` }} /></i>
              </div>
            ))}
          </div>
        </div>

        <footer className="auth-brand-foot">
          <span>© {year} IndiQube</span>
          <span>Confidential · Authorised personnel only</span>
        </footer>
      </aside>

      <main className="auth-panel">
        <EnvironmentBanner />
        <form className="auth-form" onSubmit={submit} noValidate>
          <div className="auth-form-logo"><span className="auth-mark">FA</span><strong>FA Management System</strong></div>
          <h2>Sign in</h2>
          <p className="auth-sub">Use your FA Management System credentials to continue.</p>

          {error && (
            <div className="auth-error" role="alert"><Icon d={ICONS.alert} size={16} /><span>{error}</span></div>
          )}

          <label className="auth-label" htmlFor="loginUsername">Username</label>
          <div className="auth-input">
            <Icon d={ICONS.user} />
            <input id="loginUsername" autoComplete="username" placeholder="Enter your username" autoFocus={!remembered}
              value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>

          <label className="auth-label" htmlFor="loginPassword">Password</label>
          <div className="auth-input">
            <Icon d={ICONS.lock} />
            <input id="loginPassword" type={show ? 'text' : 'password'} autoComplete="current-password" placeholder="Enter your password"
              autoFocus={Boolean(remembered)} value={password} onChange={(e) => setPassword(e.target.value)} onKeyUp={capsCheck} onKeyDown={capsCheck} />
            <button type="button" className="auth-eye" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'} title={show ? 'Hide password' : 'Show password'}>
              <Icon d={show ? ICONS.eyeOff : ICONS.eye} />
            </button>
          </div>
          {caps && <p className="auth-caps">Caps Lock is on</p>}

          <label className="auth-check">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            <span>Remember my username on this computer</span>
          </label>

          <button type="submit" className="auth-submit" disabled={busy}>
            {busy ? <><span className="auth-spinner" />Signing in…</> : <>Sign in<Icon d={ICONS.arrow} /></>}
          </button>

          <div className="auth-secure">
            <Icon d={ICONS.shield} size={16} />
            <span>Secure session · signs out after 30 minutes without activity</span>
          </div>
          <p className="auth-help">Need access or a password reset? Contact your system administrator.</p>
          <VersionLink className="auth-version" />
        </form>
      </main>

      {conflict && (
        <div className="auth-dialog-backdrop">
          <div className="auth-dialog" role="alertdialog" aria-modal="true" aria-labelledby="conflictTitle" aria-describedby="conflictText">
            <div className="auth-dialog-icon"><Icon d={ICONS.devices} size={24} /></div>
            <h3 id="conflictTitle">User ID already signed in</h3>
            <p id="conflictText">
              User ID <strong>{username.trim()}</strong> is already signed in on another browser or computer
              {conflict.device ? <> (<strong>{conflict.device}</strong>)</> : null}
              {conflict.since ? <> since {new Date(conflict.since).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</> : null}, last active {ago(conflict.lastActive)}.
            </p>
            <p className="auth-dialog-note">
              Only one sign-in per user ID is allowed. Sign out on that browser first, or ask an Admin to end that session (Users screen).
              If that browser was simply closed, you can sign in again in about {conflict.openMinutes} minutes.
            </p>
            <div className="auth-dialog-actions">
              <button type="button" className="auth-dialog-confirm" autoFocus onClick={() => setConflict(null)}>OK</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
