import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppProvider, useApp } from './context/AppContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import FaData from './pages/FaData';
import Upload from './pages/Upload';
import Lwm from './pages/Lwm';
import Ledger from './pages/Ledger';
import Masters from './pages/Masters';
import Users from './pages/Users';
import Fams from './pages/Fams';
import Reports from './pages/Reports';
import Months from './pages/Months';
import Archive from './pages/Archive';
import Releases from './pages/Releases';
import Settings from './pages/Settings';
import ActivityLog from './pages/ActivityLog';

// Logged-in pages inside the sidebar layout; `admin` pages need the Admin role
function Private({ children, admin = false }) {
  const { user, isAdmin } = useApp();
  if (!user) return <Navigate to="/login" replace />;
  if (admin && !isAdmin) return <Navigate to="/dashboard" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/dashboard" element={<Private><Dashboard /></Private>} />
          <Route path="/fa" element={<Private><FaData /></Private>} />
          <Route path="/upload" element={<Private><Upload /></Private>} />
          <Route path="/lwm" element={<Private><Lwm /></Private>} />
          <Route path="/ledger" element={<Private><Ledger /></Private>} />
          <Route path="/masters" element={<Navigate to="/masters/branch" replace />} />
          <Route path="/masters/:type" element={<Private><Masters /></Private>} />
          <Route path="/fams" element={<Private><Fams /></Private>} />
          <Route path="/reports" element={<Private><Reports /></Private>} />
          <Route path="/months" element={<Private><Months /></Private>} />
          <Route path="/users" element={<Private admin><Users /></Private>} />
          <Route path="/activity" element={<Private admin><ActivityLog /></Private>} />
          <Route path="/archive" element={<Private admin><Archive /></Private>} />
          <Route path="/releases" element={<Private admin><Releases /></Private>} />
          <Route path="/settings" element={<Private><Settings /></Private>} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AppProvider>
  );
}
