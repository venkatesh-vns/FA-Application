import React, { useCallback, useEffect, useState } from 'react';
import { call, errorMessage } from '../services/api';
import { useApp } from '../context/AppContext';
import { Alert, EmptyRow, Modal, usePaged } from '../components/ui';

const NEW = { username: '', password: '', name: '', role: 'User', email: '', department: '' };

// Index.html Users page (Admin): create user, list, edit modal
export default function Users() {
  const { withLoading, user: me } = useApp();
  const [form, setForm] = useState(NEW);
  const [rows, setRows] = useState(null);
  const [alert, setAlert] = useState(null);
  const [edit, setEdit] = useState(null);
  const paged = usePaged(rows);

  const load = useCallback(() => {
    call('get', '/users').then(setRows).catch((err) => { setRows([]); setAlert({ type: 'error', message: errorMessage(err) }); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = () => withLoading('Creating user...', () => call('post', '/users', { ...form, username: form.username.trim() }))
    .then((r) => { setAlert({ type: 'success', message: r.message }); setForm(NEW); load(); })
    .catch((err) => setAlert({ type: 'error', message: errorMessage(err) }));

  const saveEdit = () => withLoading('Updating user...', () => call('put', `/users/${encodeURIComponent(edit.username)}`, edit))
    .then((r) => { setEdit(null); setAlert({ type: 'success', message: r.message }); load(); })
    .catch((err) => setEdit({ ...edit, alert: { type: 'error', message: errorMessage(err) } }));

  // end another user's session (e.g. a PC left signed in elsewhere)
  const signOut = (u) => {
    if (!window.confirm(`Sign out ${u.name || u.username}?\n\nSigned in on ${u.session.device || 'a browser'} since ${u.session.since}. Unsaved work there will be lost.`)) return;
    withLoading('Signing the user out...', () => call('post', `/users/${encodeURIComponent(u.username)}/sign-out`))
      .then((r) => { setAlert({ type: 'success', message: r.message }); load(); })
      .catch((err) => setAlert({ type: 'error', message: errorMessage(err) }));
  };
  const minsAgo = (iso) => {
    const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    return m < 1 ? 'just now' : `${m} min ago`;
  };

  const f = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const ef = (k) => (e) => setEdit({ ...edit, [k]: e.target.value });

  return (
    <section className="page">
      <div className="card">
        <h3 className="card-title">Create User</h3>
        <Alert alert={alert} />
        <div className="grid grid-4">
          <div className="field"><label htmlFor="nu">Username *</label><input id="nu" className="form-control" value={form.username} onChange={f('username')} /></div>
          <div className="field"><label htmlFor="np">Password *</label><input id="np" className="form-control" type="password" autoComplete="new-password" value={form.password} onChange={f('password')} /></div>
          <div className="field"><label htmlFor="nn">Name</label><input id="nn" className="form-control" value={form.name} onChange={f('name')} /></div>
          <div className="field"><label htmlFor="nr">Role</label><select id="nr" className="form-control" value={form.role} onChange={f('role')}><option value="User">User</option><option value="Admin">Admin</option></select></div>
          <div className="field"><label htmlFor="ne">Email ID</label><input id="ne" className="form-control" type="email" value={form.email} onChange={f('email')} /></div>
          <div className="field"><label htmlFor="nd">Department</label><input id="nd" className="form-control" value={form.department} onChange={f('department')} /></div>
        </div>
        <div className="button-row" style={{ marginTop: 18 }}>
          <button type="button" className="btn btn-primary" onClick={create}>Create User</button>
          <button type="button" className="btn btn-light" onClick={() => setForm(NEW)}>Clear</button>
        </div>
      </div>

      <div className="card">
        <div className="card-head" style={{ justifyContent: 'space-between' }}>
          <h3 className="card-title">User Details</h3>
          <button type="button" className="btn btn-light btn-sm" onClick={load}>Refresh</button>
        </div>
        <div className="table-wrapper">
          <table>
            <thead><tr><th>Username</th><th>Name</th><th>Email ID</th><th>Department</th><th>Role</th><th>Active</th><th>Signed in</th><th>Action</th></tr></thead>
            <tbody>
              {paged.rows.map((u) => (
                <tr key={u.username}>
                  <td>{u.username}</td><td>{u.name}</td><td>{u.email}</td><td>{u.department}</td><td>{u.role}</td><td>{u.active}</td>
                  <td>
                    {u.session
                      ? <span className="signed-in"><span className="dot-on" />{u.session.device || 'Browser'}<small>since {u.session.since.slice(11, 16)} · active {minsAgo(u.session.lastActive)}</small></span>
                      : <span className="muted">Not signed in</span>}
                  </td>
                  <td>
                    <div className="actions">
                      <button type="button" className="btn btn-warning btn-sm" onClick={() => setEdit({ ...u, password: '', alert: null })}>Edit</button>
                      {u.session && u.username.toLowerCase() !== String(me?.username || '').toLowerCase() && (
                        <button type="button" className="btn btn-danger btn-sm" onClick={() => signOut(u)}>Sign out</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!rows?.length && <EmptyRow cols={8}>{rows ? 'No users found.' : 'Loading...'}</EmptyRow>}
            </tbody>
          </table>
        </div>
        {paged.pager}
      </div>

      {edit && (
        <Modal title="Edit User" small onClose={() => setEdit(null)}
          footer={<><button type="button" className="btn btn-light" onClick={() => setEdit(null)}>Cancel</button><button type="button" className="btn btn-primary" onClick={saveEdit}>Save Changes</button></>}>
          <Alert alert={edit.alert} />
          <div className="grid grid-2">
            <div className="field"><label>Username</label><input className="form-control" value={edit.username} readOnly /></div>
            <div className="field"><label htmlFor="eun">Name</label><input id="eun" className="form-control" value={edit.name} onChange={ef('name')} /></div>
            <div className="field"><label htmlFor="eue">Email ID</label><input id="eue" className="form-control" type="email" value={edit.email} onChange={ef('email')} /></div>
            <div className="field"><label htmlFor="eud">Department</label><input id="eud" className="form-control" value={edit.department} onChange={ef('department')} /></div>
            <div className="field"><label htmlFor="eur">Role</label><select id="eur" className="form-control" value={edit.role} onChange={ef('role')}><option value="User">User</option><option value="Admin">Admin</option></select></div>
            <div className="field"><label htmlFor="eua">Status</label><select id="eua" className="form-control" value={edit.active === 'No' ? 'No' : 'Yes'} onChange={ef('active')}><option value="Yes">Active</option><option value="No">Inactive</option></select></div>
            <div className="field"><label htmlFor="eup">New Password</label><input id="eup" className="form-control" type="password" autoComplete="new-password" placeholder="Leave blank to keep current password" value={edit.password} onChange={ef('password')} /></div>
          </div>
        </Modal>
      )}
    </section>
  );
}
