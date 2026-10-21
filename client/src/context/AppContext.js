import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { call } from '../services/api';
import { announce, onMessage, post } from '../services/tabGuard';

const AppContext = createContext(null);
const HEARTBEAT_MS = 60000; // tells the server whether the user is working; notices a sign-in elsewhere
const WARN_MS = 2 * 60000;   // warning shown this long before the idle sign-out
// what counts as the user working in the page
const ACTIVITY_EVENTS = ['keydown', 'mousedown', 'mousemove', 'wheel', 'touchstart', 'pointerdown'];

function storedUser() {
  try {
    return JSON.parse(sessionStorage.getItem('faUser'));
  } catch {
    return null;
  }
}

function saveSession(token, user) {
  sessionStorage.setItem('faSessionToken', token);
  sessionStorage.setItem('faUser', JSON.stringify(user));
}

function clearSession() {
  sessionStorage.removeItem('faSessionToken');
  sessionStorage.removeItem('faUser');
}

const currentSession = () => ({ token: sessionStorage.getItem('faSessionToken'), user: storedUser() });

// Logged-in user, the full-screen loading overlay (showLoading / hideLoading)
// and the one-tab-at-a-time guard
export function AppProvider({ children }) {
  const [user, setUser] = useState(() => (sessionStorage.getItem('faSessionToken') ? storedUser() : null));
  const [ready, setReady] = useState(false);       // tab announced; session handed over if any
  const [inactive, setInactive] = useState(false); // the app is in use in a newer tab
  const [loadingText, setLoadingText] = useState('');
  const depth = useRef(0);
  // idle sign-out: minutes allowed without activity (from the server) and the last activity
  const [idleMinutes, setIdleMinutes] = useState(() => Number(sessionStorage.getItem('faIdleMinutes')) || 30);
  const lastActivity = useRef(Date.now());
  const [idleLeft, setIdleLeft] = useState(null); // seconds before sign-out while the warning shows
  const [attempts, setAttempts] = useState([]); // refused sign-ins with this user ID: [{ device, at }]

  // Announce this tab: the open tabs step aside and hand over their session
  useEffect(() => {
    let alive = true;
    announce().then((handed) => {
      if (!alive) return;
      // not on the sign-in page reached because the session ended
      const ended = window.location.pathname === '/login' && /[?&](replaced|expired)=/.test(window.location.search);
      if (handed && !ended && !sessionStorage.getItem('faSessionToken')) {
        saveSession(handed.token, handed.user);
        setUser(handed.user);
      }
      setReady(true);
    });
    return () => { alive = false; };
  }, []);

  // Messages from the other tabs of this browser
  useEffect(() => onMessage((msg) => {
    if (msg.type === 'hello') {
      // a newer tab opened: give it the session and step aside
      const mine = currentSession();
      post('session', { to: msg.from, ...mine });
      if (mine.token) setInactive(true);
    } else if (msg.type === 'claim') {
      // another tab signed in or took over: keep its session, step aside
      if (msg.token) {
        saveSession(msg.token, msg.user);
        setUser(msg.user);
        setInactive(true);
      }
    } else if (msg.type === 'logout') {
      clearSession();
      setInactive(false);
      setUser(null);
    }
  }), []);

  // Keyboard / mouse use in this (working) tab counts as activity
  useEffect(() => {
    if (!user || inactive) return undefined;
    lastActivity.current = Date.now();
    const mark = () => { lastActivity.current = Date.now(); };
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, mark, { passive: true, capture: true }));
    return () => ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, mark, { capture: true }));
  }, [user, inactive]);

  // Heartbeat: reports whether the user worked in the last minute (the server
  // keeps the session alive only then); also checks on returning to the tab
  useEffect(() => {
    if (!user || inactive) return undefined;
    const ping = () => {
      const active = Date.now() - lastActivity.current < HEARTBEAT_MS + 5000;
      call('post', '/auth/ping', { active }, { background: true })
        .then((r) => {
          if (r.idleMinutes) { setIdleMinutes(r.idleMinutes); sessionStorage.setItem('faIdleMinutes', String(r.idleMinutes)); }
          if (r.blockedAttempts?.length) setAttempts((a) => [...a, ...r.blockedAttempts]);
        })
        .catch(() => {});
    };
    const timer = setInterval(ping, HEARTBEAT_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') ping(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [user, inactive]);

  // refused (409 ALREADY_SIGNED_IN) while this user ID is signed in on another open browser
  const login = async (username, password) => {
    const r = await call('post', '/auth/login', { username, password });
    const u = { username: r.username, name: r.name, role: r.role };
    saveSession(r.token, u);
    if (r.idleMinutes) { setIdleMinutes(r.idleMinutes); sessionStorage.setItem('faIdleMinutes', String(r.idleMinutes)); }
    lastActivity.current = Date.now();
    post('claim', currentSession()); // other open tabs of this browser step aside
    setInactive(false);
    setUser(u);
  };

  const logout = async () => {
    try {
      await call('post', '/auth/logout');
    } catch {
      // session already gone
    }
    clearSession();
    post('logout');
    setIdleLeft(null);
    setUser(null);
  };

  // Idle watch: warning 2 minutes before, then sign-out (frees reserved invoices too)
  useEffect(() => {
    if (!user || inactive) { setIdleLeft(null); return undefined; }
    const limit = idleMinutes * 60000;
    const timer = setInterval(() => {
      const idle = Date.now() - lastActivity.current;
      if (idle >= limit) {
        clearInterval(timer);
        logout().finally(() => { window.location.href = '/login?idle=1'; });
      } else if (idle >= limit - WARN_MS) {
        setIdleLeft(Math.ceil((limit - idle) / 1000));
      } else {
        setIdleLeft((v) => (v === null ? v : null));
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [user, inactive, idleMinutes]); // eslint-disable-line react-hooks/exhaustive-deps

  const staySignedIn = () => {
    lastActivity.current = Date.now();
    setIdleLeft(null);
    call('post', '/auth/ping', { active: true }, { background: true }).catch(() => {});
  };

  // Use the app in this tab again; the other tab steps aside
  const useThisTab = () => {
    post('claim', currentSession());
    setInactive(false);
    call('get', '/auth/me').catch(() => {});
  };

  // Runs fn with the loading overlay showing `message`
  const withLoading = useCallback(async (message, fn) => {
    depth.current += 1;
    setLoadingText(message || 'Please wait...');
    try {
      return await fn();
    } finally {
      depth.current -= 1;
      if (depth.current === 0) setLoadingText('');
    }
  }, []);

  const isAdmin = String(user?.role || '').toLowerCase() === 'admin';

  if (!ready) return null; // a fraction of a second while open tabs answer

  return (
    <AppContext.Provider value={{ user, isAdmin, login, logout, withLoading }}>
      {children}
      {loadingText && (
        <div className="loading-overlay">
          <div className="loading-box"><div className="spinner" /><div>{loadingText}</div></div>
        </div>
      )}
      {attempts.length > 0 && user && !inactive && (
        <div className="attempt-notice" role="alert">
          <div>
            <strong>Someone tried to sign in with your user ID</strong>
            {attempts.slice(-3).map((a, i) => (
              <span key={`${a.at}-${i}`}>{a.device || 'Another browser'} at {new Date(a.at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} – the sign-in was refused.</span>
            ))}
            <span className="muted">If this was not you, ask an Admin to change your password.</span>
          </div>
          <button type="button" className="btn btn-light btn-sm" onClick={() => setAttempts([])}>OK</button>
        </div>
      )}
      {idleLeft !== null && user && !inactive && (
        <div className="tab-lock" role="alertdialog" aria-modal="true" aria-labelledby="idleTitle">
          <div className="tab-lock-box">
            <div className="tab-lock-icon idle" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z" /><path d="M12 6v6l4 2" />
              </svg>
            </div>
            <h3 id="idleTitle">Are you still there?</h3>
            <p>For security you will be signed out after {idleMinutes} minutes without activity.</p>
            <div className="idle-count">{Math.floor(idleLeft / 60)}:{String(idleLeft % 60).padStart(2, '0')}</div>
            <div className="idle-actions">
              <button type="button" className="btn btn-light" onClick={() => logout().finally(() => { window.location.href = '/login'; })}>Sign out now</button>
              <button type="button" className="btn btn-primary" onClick={staySignedIn}>Stay signed in</button>
            </div>
          </div>
        </div>
      )}
      {inactive && user && (
        <div className="tab-lock" role="alertdialog" aria-modal="true" aria-labelledby="tabLockTitle">
          <div className="tab-lock-box">
            <div className="tab-lock-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 5h18v14H3z" /><path d="M3 9h18" /><path d="M7 7h.01" />
              </svg>
            </div>
            <h3 id="tabLockTitle">FA Management is open in another tab</h3>
            <p>The application works in one browser tab at a time, so two copies never save over each other. Continue in the newer tab, or use this one instead.</p>
            <button type="button" className="btn btn-primary" onClick={useThisTab}>Use this tab instead</button>
          </div>
        </div>
      )}
    </AppContext.Provider>
  );
}

export const useApp = () => useContext(AppContext);
