import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { EnvironmentBanner, VersionLink } from './Version';

// Line icons (24px grid, drawn with the current text colour)
const PATHS = {
  dashboard: ['M3 13h8V3H3z', 'M13 21h8V11h-8z', 'M13 3v6h8V3z', 'M3 21h8v-6H3z'],
  branch: ['M3 21h18', 'M5 21V7l7-4 7 4v14', 'M9 21v-6h6v6', 'M9 10h.01', 'M15 10h.01'],
  category: ['M4 4h7v7H4z', 'M13 4h7v7h-7z', 'M4 13h7v7H4z', 'M13 13h7v7h-7z'],
  description: ['M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z', 'M14 3v6h6', 'M8 13h8', 'M8 17h5'],
  po: ['M6 2h9l5 5v15H6z', 'M15 2v5h5', 'M9 12h6', 'M9 16h6', 'M9 8h2'],
  clientcc: ['M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M23 21v-2a4 4 0 0 0-3-3.9', 'M16 3.1a4 4 0 0 1 0 7.8'],
  fa: ['M3 5h18', 'M3 10h18', 'M3 15h18', 'M3 20h12'],
  upload: ['M12 16V4', 'M7 9l5-5 5 5', 'M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3'],
  lwm: ['M12 3v18', 'M5 7h14', 'M5 7l-3 7a4 4 0 0 0 6 0z', 'M19 7l-3 7a4 4 0 0 0 6 0z'],
  ledger: ['M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z', 'M8 9h8', 'M8 13h6'],
  report: ['M4 20V10', 'M10 20V4', 'M16 20v-7', 'M22 20H2'],
  fams: ['M4 4h16v16H4z', 'M4 9h16', 'M9 9v11', 'M13 13h4', 'M13 16h4'],
  users: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M19 8v6', 'M22 11h-6'],
  activity: ['M22 12h-4l-3 9L9 3l-3 9H2'],
  archive: ['M3 4h18v4H3z', 'M5 8v12h14V8', 'M10 12h4'],
  settings: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'],
  release: ['M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z', 'M7 7h.01'],
  logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
  collapse: ['M11 17l-5-5 5-5', 'M18 17l-5-5 5-5'],
  menu: ['M3 6h18', 'M3 12h18', 'M3 18h18'],
  calendar: ['M3 5h18v16H3z', 'M3 10h18', 'M8 3v4', 'M16 3v4'],
  refresh: ['M21 12a9 9 0 1 1-3-6.7L21 8', 'M21 3v5h-5'],
  download: ['M12 4v12', 'M7 11l5 5 5-5', 'M4 20h16'],
  filter: ['M3 4h18l-7 9v6l-4 2v-8z'],
  building: ['M4 21V4a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v17', 'M15 9h4a1 1 0 0 1 1 1v11', 'M3 21h18', 'M8 7h3', 'M8 11h3', 'M8 15h3'],
  status: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M8 12l3 3 5-6'],
  search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M21 21l-4.3-4.3'],
  trash: ['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 14H6L5 6', 'M10 11v6', 'M14 11v6'],
};

export function Icon({ name, size = 18 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {(PATHS[name] || []).map((d) => <path key={d} d={d} />)}
    </svg>
  );
}

// Menu sections (Index.html sidebar, grouped)
const SECTIONS = [
  { title: 'Overview', items: [{ path: '/dashboard', label: 'Dashboard', icon: 'dashboard' }] },
  {
    title: 'Masters',
    items: [
      { path: '/masters/branch', label: 'Branch Master', icon: 'branch' },
      { path: '/masters/category', label: 'Category Master', icon: 'category' },
      { path: '/masters/description', label: 'Description Master', icon: 'description' },
      { path: '/masters/po', label: 'PO Client Master', icon: 'po' },
      { path: '/masters/clientcc', label: 'Client / Cost Center', icon: 'clientcc' },
    ],
  },
  {
    title: 'Transactions',
    items: [
      { path: '/months', label: 'Month-wise Data', icon: 'calendar' },
      { path: '/fa', label: 'FA Data', icon: 'fa' },
      { path: '/upload', label: 'Upload & Qty Plotting', icon: 'upload' },
      { path: '/lwm', label: 'LWM Reconciliation', icon: 'lwm' },
      { path: '/ledger', label: 'Ledger Master', icon: 'ledger' },
    ],
  },
  {
    title: 'Reports',
    items: [
      { path: '/reports', label: 'Period Reports', icon: 'report' },
      { path: '/fams', label: 'FAMS Template', icon: 'fams' },
    ],
  },
  { title: 'Account', items: [{ path: '/settings', label: 'Settings', icon: 'settings' }] },
  {
    title: 'Administration',
    admin: true,
    items: [
      { path: '/users', label: 'Users', icon: 'users' },
      { path: '/activity', label: 'Activity Log', icon: 'activity' },
      { path: '/archive', label: 'Year-End Archive', icon: 'archive' },
      { path: '/releases', label: 'Releases', icon: 'release' },
    ],
  },
];

export const TITLES = {
  '/dashboard': 'Dashboard', '/fa': 'FA Data', '/upload': 'Upload', '/lwm': 'LWM', '/ledger': 'Ledger Master',
  '/masters': 'Masters', '/users': 'Users', '/fams': 'FAMS Template', '/reports': 'Period Reports', '/months': 'Month-wise Data', '/activity': 'Activity Log', '/archive': 'Year-End Archive', '/releases': 'Releases', '/settings': 'Settings',
};

const initials = (name = '') => name.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || 'U';
const isMobile = () => window.innerWidth <= 900;

// Application shell: sidebar menu + top bar
export default function Layout({ children }) {
  const { user, isAdmin, logout, withLoading } = useApp();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [rail, setRail] = useState(() => { try { return localStorage.getItem('faNavRail') === '1'; } catch { return false; } });
  const [drawer, setDrawer] = useState(false);

  useEffect(() => { setDrawer(false); }, [pathname]);
  useEffect(() => { try { localStorage.setItem('faNavRail', rail ? '1' : '0'); } catch { /* ignore */ } }, [rail]);

  const sections = SECTIONS.filter((s) => !s.admin || isAdmin);
  const current = sections.flatMap((s) => s.items.map((i) => ({ ...i, section: s.title }))).find((i) => pathname === i.path || pathname.startsWith(`${i.path}/`));
  const title = current?.label || TITLES[`/${pathname.split('/')[1]}`] || '';
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });

  const signOut = () => withLoading('Signing out...', async () => {
    await logout();
    navigate('/login');
  });

  return (
    <div className={`shell${rail ? ' rail' : ''}${drawer ? ' drawer-open' : ''}`}>
      <div className="shell-overlay" onClick={() => setDrawer(false)} aria-hidden="true" />
      <aside className="sidebar" aria-label="Main menu">
        <div className="sidebar-brand">
          <span className="brand-mark">FA</span>
          <span className="brand-text"><strong>FA Management</strong><small>Fixed Asset Control</small></span>
          <button type="button" className="rail-toggle" onClick={() => (isMobile() ? setDrawer(false) : setRail(!rail))}
            title={rail ? 'Expand menu' : 'Collapse menu'} aria-label={rail ? 'Expand menu' : 'Collapse menu'}>
            <Icon name="collapse" size={16} />
          </button>
        </div>

        <nav className="sidebar-nav">
          {sections.map((s) => (
            <div className="nav-section" key={s.title}>
              <div className="nav-section-title">{s.title}</div>
              {s.items.map((item) => {
                const active = current?.path === item.path;
                return (
                  <button key={item.path} type="button" className={`nav-item${active ? ' active' : ''}`} onClick={() => navigate(item.path)}
                    title={rail ? item.label : undefined} aria-current={active ? 'page' : undefined}>
                    <Icon name={item.icon} />
                    <span className="nav-text">{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <VersionLink className="sidebar-version" />
        <div className="sidebar-user">
          <span className="avatar">{initials(user?.name || user?.username)}</span>
          <span className="sidebar-user-text"><strong>{user?.name}</strong><small>{user?.role}</small></span>
          <button type="button" className="logout-btn" onClick={signOut} title="Sign out" aria-label="Sign out"><Icon name="logout" size={17} /></button>
        </div>
      </aside>

      <main className="main">
          <EnvironmentBanner />
        <header className="topbar">
          <div className="topbar-left">
            <button type="button" className="menu-toggle" onClick={() => (isMobile() ? setDrawer(true) : setRail(!rail))} aria-label="Open / close menu" title="Menu">
              <Icon name="menu" size={20} />
            </button>
            <div>
              <div className="crumbs">{current?.section || 'FA Management'}<span>›</span>{title}</div>
              <h2>{title}</h2>
            </div>
          </div>
          <div className="topbar-right">
            <span className="topbar-date"><Icon name="calendar" size={15} />{today}</span>
            <span className="topbar-user">
              <span className="avatar small">{initials(user?.name || user?.username)}</span>
              <span><strong>{user?.name}</strong><small>{user?.role}</small></span>
            </span>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
