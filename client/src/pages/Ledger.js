import React, { useCallback, useEffect, useRef, useState } from 'react';
import { call, errorMessage } from '../services/api';
import { useApp } from '../context/AppContext';
import { Alert, EmptyRow, usePaged } from '../components/ui';

const EMPTY = { id: 0, expenseHead: '', mapping: '', active: 'Yes' };

// Index.html Ledger Master: Expense Head -> Taggable / Non Taggable
export default function Ledger() {
  const { withLoading } = useApp();
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [alert, setAlert] = useState(null);
  const headRef = useRef(null);
  const paged = usePaged(rows);

  const load = useCallback(() => {
    call('get', '/ledgers').then(setRows).catch((err) => { setRows([]); setAlert({ type: 'error', message: errorMessage(err) }); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = () => {
    if (!form.expenseHead.trim() || !form.mapping) { setAlert({ type: 'error', message: 'Please enter Expense Head and Mapping.' }); return; }
    withLoading('Saving Ledger Mapping...', () => call('post', '/ledgers', { ...form, expenseHead: form.expenseHead.trim() }))
      .then((r) => { setAlert({ type: 'success', message: r.message }); setForm(EMPTY); load(); })
      .catch((err) => setAlert({ type: 'error', message: errorMessage(err) }));
  };

  const edit = (r) => {
    setForm({ id: r.id, expenseHead: r.expenseHead, mapping: r.mapping, active: r.active || 'Yes' });
    setAlert({ type: 'info', message: 'Edit the values and click Save Mapping.' });
    headRef.current?.focus();
  };

  const remove = (r) => {
    if (!window.confirm('Delete this Ledger Master mapping?')) return;
    withLoading('Deleting Ledger Mapping...', () => call('delete', `/ledgers/${r.id}`))
      .then((res) => { setAlert({ type: 'success', message: res.message }); load(); })
      .catch((err) => setAlert({ type: 'error', message: errorMessage(err) }));
  };

  return (
    <section className="page">
      <div className="card">
        <h3 className="card-title">Ledger Master</h3>
        <Alert alert={alert} />
        <div className="grid grid-3" style={{ marginBottom: 20 }}>
          <div className="field">
            <label htmlFor="ledgerHead">Expense Head *</label>
            <input id="ledgerHead" ref={headRef} className="form-control" placeholder="Enter Expense Head" value={form.expenseHead} onChange={(e) => setForm({ ...form, expenseHead: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="ledgerMapping">Mapping *</label>
            <select id="ledgerMapping" className="form-control" value={form.mapping} onChange={(e) => setForm({ ...form, mapping: e.target.value })}>
              <option value="">Select Mapping</option><option value="Taggable">Taggable</option><option value="Non Taggable">Non Taggable</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="ledgerActive">Active</label>
            <select id="ledgerActive" className="form-control" value={form.active} onChange={(e) => setForm({ ...form, active: e.target.value })}>
              <option value="Yes">Yes</option><option value="No">No</option>
            </select>
          </div>
        </div>
        <div className="button-row" style={{ marginBottom: 20 }}>
          <button type="button" className="btn btn-primary" onClick={save}>Save Mapping</button>
          {form.id > 0 && <button type="button" className="btn btn-light" onClick={() => { setForm(EMPTY); setAlert(null); }}>Cancel Edit</button>}
          <button type="button" className="btn btn-light" onClick={load}>Refresh</button>
        </div>
        <div className="table-wrapper">
          <table>
            <thead><tr><th>#</th><th>Expense Head</th><th>Mapping</th><th>Active</th><th>Action</th></tr></thead>
            <tbody>
              {paged.rows.map((r, i) => (
                <tr key={r.id}>
                  <td>{paged.offset + i + 1}</td><td>{r.expenseHead}</td>
                  <td><span className={`badge ${r.mapping === 'Taggable' ? 'badge-completed' : 'badge-pending'}`}>{r.mapping}</span></td>
                  <td>{r.active}</td>
                  <td><div className="actions">
                    <button type="button" className="btn btn-warning btn-sm" onClick={() => edit(r)}>Edit</button>
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => remove(r)}>Delete</button>
                  </div></td>
                </tr>
              ))}
              {!rows?.length && <EmptyRow cols={5}>{rows ? 'No ledger mappings found.' : 'Loading...'}</EmptyRow>}
            </tbody>
          </table>
        </div>
        {paged.pager}
      </div>
    </section>
  );
}
