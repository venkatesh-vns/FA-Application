import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { call } from '../services/api';
import { Modal } from './ui';

// Version, release date and environment of the running application (cached)
let cached = null;
export function useAppInfo() {
  const [info, setInfo] = useState(cached);
  useEffect(() => {
    if (cached) return;
    call('get', '/app-info').then((i) => { cached = i; setInfo(i); }).catch(() => {});
  }, []);
  return info;
}

// Orange band on every screen of the Staging (SP) environment
export function EnvironmentBanner() {
  const info = useAppInfo();
  if (!info || info.environment === 'production') return null;
  const staging = info.environment === 'staging';
  return (
    <div className={`env-banner${staging ? ' staging' : ''}`} role="status">
      <strong>{staging ? 'STAGING (SP)' : info.environmentLabel.toUpperCase()}</strong>
      <span>{staging ? 'Test environment – data here is a copy and is not used for production work.' : 'Development copy.'}</span>
      <span className="env-version">v{info.version}</span>
    </div>
  );
}

// "v1.2.0 · What's new" link opening the release notes
export function VersionLink({ className = '' }) {
  const info = useAppInfo();
  const [open, setOpen] = useState(false);
  if (!info) return null;
  return (
    <>
      <button type="button" className={`version-link ${className}`} onClick={() => setOpen(true)} title="Release notes">
        Version {info.version}{info.environment !== 'production' ? ` · ${info.environmentLabel}` : ''} · What&apos;s new
      </button>
      {open && createPortal(<ReleaseNotes onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

// Release notes of every version, newest first
export function ReleaseNotes({ onClose }) {
  const [data, setData] = useState(null);
  useEffect(() => { call('get', '/release-notes').then(setData).catch(() => setData({ notes: [] })); }, []);
  return (
    <Modal title="What's new – Release notes" progress={data?.app ? `You are using version ${data.app.version}${data.app.releasedAt ? ` (${data.app.releasedAt})` : ''}` : ''}
      onClose={onClose} footer={<button type="button" className="btn btn-light" onClick={onClose}>Close</button>}>
      {!data && <div className="empty">Loading...</div>}
      {data && !data.notes.length && <div className="empty">No release notes yet.</div>}
      {data?.notes.map((r) => (
        <section key={r.version} className={`release${r.version === data.app.version ? ' current' : ''}`}>
          <h3>Version {r.version}{r.date ? <span className="muted"> · {r.date}</span> : null}{r.version === data.app.version && <span className="release-tag">Current</span>}</h3>
          {r.sections.map((s) => (
            <div key={s.title} className="release-section">
              <h4>{s.title}</h4>
              <ul>{s.items.map((it) => <li key={it}>{it.replace(/`/g, '')}</li>)}</ul>
            </div>
          ))}
        </section>
      ))}
    </Modal>
  );
}
