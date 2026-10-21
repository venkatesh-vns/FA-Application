import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { call, download, errorMessage, uploadFile } from '../services/api';
import { useApp } from '../context/AppContext';
import { Alert, EmptyRow, Modal, usePaged } from '../components/ui';

const DEFS = {
  branch: { title: 'Branch Master', headers: ['Cost Center', 'Branch', 'Branch Code', 'Location'] },
  category: { title: 'Category Master', headers: ['Expense Head', 'Asset Category Level I', 'Asset Category Level II'] },
  description: { title: 'Description Master', headers: ['Product / Asset Description', 'Expense Head', 'AssetDescriptionOne', 'AssetDescriptionTwo', 'Asset Category Level II'] },
  po: { title: 'PO Client Master', headers: ['PO No', 'PO Date', 'Client As Per PO', 'Client As Per PMO', 'Status'] },
  clientcc: { title: 'Client / Cost Center Master', headers: ['Client As Per PMO', 'Cost Center', 'Status'] },
};

const norm = (v) => String(v ?? '').replace(/ /g, ' ').trim().toLowerCase().replace(/\s+/g, ' ');
const blank = (def) => Object.fromEntries(def.headers.map((h) => [h, '']));

// Index.html Masters page (openMasterTab, saveMasterForm, filterMasterRecords,
// downloadMasterTemplate, exportMasterData, uploadMasterCSV, bulkEditMasterCSV)
export default function Masters() {
  const { type = 'branch' } = useParams();
  const { withLoading } = useApp();
  const def = DEFS[type] || DEFS.branch;
  const [records, setRecords] = useState(null);
  // Add / Edit pop-up: { row (0 = new record), values, alert } or null
  const [editor, setEditor] = useState(null);
  const [search, setSearch] = useState('');
  const [alert, setAlert] = useState(null);
  const uploadRef = useRef(null);
  const editRef = useRef(null);

  const load = useCallback(() => {
    setRecords(null);
    call('get', `/masters/${type}`).then(setRecords).catch((err) => { setRecords([]); setAlert({ type: 'error', message: errorMessage(err) }); });
  }, [type]);

  useEffect(() => {
    setEditor(null);
    setSearch('');
    setAlert(null);
    if (uploadRef.current) uploadRef.current.value = '';
    if (editRef.current) editRef.current.value = '';
    load();
  }, [type, load]);

  const filtered = useMemo(() => {
    const term = norm(search);
    if (!term) return records || [];
    return (records || []).filter((r) => def.headers.some((h) => norm(r[h]).includes(term)));
  }, [records, search, def]);

  const paged = usePaged(filtered);
  const { reset } = paged;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reset(); }, [type, search]);

  const setField = (h, value) => {
    const values = { ...editor.values, [h]: value };
    if (type === 'description' && h === 'Expense Head') values.AssetDescriptionOne = value; // DescriptionOne = Expense Head
    setEditor({ ...editor, values, alert: null });
  };

  const openAdd = () => setEditor({ row: 0, values: blank(def), alert: null });

  const openEdit = (r) => {
    const values = Object.fromEntries(def.headers.map((h) => [h, r[h] || '']));
    if (type === 'description') values.AssetDescriptionOne = values['Expense Head'];
    setEditor({ row: r.row, values, original: r[def.headers[0]], alert: null });
  };

  const save = () => {
    if (!String(editor.values[def.headers[0]] || '').trim()) {
      setEditor({ ...editor, alert: { type: 'error', message: `${def.headers[0]} is required.` } });
      return;
    }
    withLoading('Saving...', () => call('post', `/masters/${type}`, { ...editor.values, row: editor.row }))
      .then((r) => { setAlert({ type: 'success', message: r.message }); setEditor(null); load(); })
      .catch((err) => setEditor((e) => e && { ...e, alert: { type: 'error', message: errorMessage(err) } }));
  };

  const remove = (r) => {
    if (!window.confirm('Delete this Master record?')) return;
    withLoading('Deleting...', () => call('delete', `/masters/${type}/${r.row}`))
      .then((res) => { setAlert({ type: 'success', message: res.message }); load(); })
      .catch((err) => setAlert({ type: 'error', message: errorMessage(err) }));
  };

  const sendFile = (ref, url, missing, label) => {
    const file = ref.current?.files[0];
    if (!file) { setAlert({ type: 'error', message: missing }); return; }
    withLoading(label, () => uploadFile(url, file))
      .then((r) => {
        ref.current.value = '';
        setAlert(r.errors?.length ? { type: 'error', message: `${r.message}\n${r.errors.join('\n')}` } : { type: 'success', message: r.message });
        load();
      })
      .catch((err) => setAlert({ type: 'error', message: errorMessage(err) }));
  };

  const exportData = () => withLoading('Preparing Master Excel...', () => download(`/masters/${type}/export`, `${type}_Master_Export.xlsx`))
    .then((n) => setAlert({ type: 'success', message: `${n} row(s) exported successfully.` }))
    .catch((err) => setAlert({ type: 'error', message: errorMessage(err) }));

  return (
    <section className="page">
      <div className="card">
        <Alert alert={alert} />
        <div className="card-head" style={{ justifyContent: 'space-between' }}>
          <div>
            <h3 className="card-title">{def.title}</h3>
            <div className="muted" style={{ marginTop: 4 }}>{records ? `${records.length} record(s)` : 'Loading...'}</div>
          </div>
          <div className="button-row">
            <input className="form-control master-search" placeholder="Search in all columns..." value={search}
              onChange={(e) => setSearch(e.target.value)} aria-label="Search master" />
            <button type="button" className="btn btn-primary" onClick={openAdd}>+ Add Record</button>
          </div>
        </div>

        <div className="master-tools">
          <div className="master-tool">
            <span className="master-tool-label">Template &amp; export</span>
            <div className="button-row">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => download(`/masters/${type}/template`, `${type}_Master_Template.xlsx`).catch((err) => setAlert({ type: 'error', message: errorMessage(err) }))}>Download Template</button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={exportData}>Export Master</button>
              <button type="button" className="btn btn-light btn-sm" onClick={load}>Refresh</button>
            </div>
          </div>
          <div className="master-tool">
            <span className="master-tool-label">Add records from Excel</span>
            <div className="button-row">
              <input ref={uploadRef} type="file" accept=".xlsx" className="form-control file-input" aria-label="Master upload file" />
              <button type="button" className="btn btn-primary btn-sm" onClick={() => sendFile(uploadRef, `/masters/${type}/bulk-upload`, 'Please select the Excel template.', 'Uploading Master data...')}>Upload Excel</button>
            </div>
          </div>
          <div className="master-tool">
            <span className="master-tool-label">Update records from an exported Excel</span>
            <div className="button-row">
              <input ref={editRef} type="file" accept=".xlsx" className="form-control file-input" aria-label="Master bulk edit file" />
              <button type="button" className="btn btn-warning btn-sm" onClick={() => sendFile(editRef, `/masters/${type}/bulk-edit`, 'Please select the exported Master Excel file after making your edits.', 'Updating Master data...')}>Bulk Edit Excel</button>
            </div>
          </div>
        </div>

        <div className="table-wrapper" style={{ marginTop: 18 }}>
          <table>
            <thead><tr>{def.headers.map((h) => <th key={h}>{h}</th>)}<th>Action</th></tr></thead>
            <tbody>
              {paged.rows.map((r) => (
                <tr key={r.row} className={editor?.row === r.row ? 'row-editing' : undefined}>
                  {def.headers.map((h) => <td key={h}>{r[h]}</td>)}
                  <td><div className="actions">
                    <button type="button" className="btn btn-warning btn-sm" onClick={() => openEdit(r)}>Edit</button>
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => remove(r)}>Delete</button>
                  </div></td>
                </tr>
              ))}
              {!filtered.length && <EmptyRow cols={def.headers.length + 1}>{records ? 'No records found.' : 'Loading...'}</EmptyRow>}
            </tbody>
          </table>
        </div>
        {paged.pager}
      </div>

      {editor && (
        <Modal small onClose={() => setEditor(null)}
          title={editor.row ? `Edit ${def.title}` : `Add ${def.title}`}
          progress={editor.row ? `Editing: ${editor.original}` : 'New record'}
          footer={(
            <>
              <button type="button" className="btn btn-light footer-left" onClick={() => setEditor(null)}>Cancel</button>
              <button type="button" className="btn btn-primary btn-cta" onClick={save}>{editor.row ? 'Update Record' : 'Save Record'}</button>
            </>
          )}>
          <div className={`edit-banner${editor.row ? ' editing' : ''}`}>
            {editor.row
              ? <>You are changing one record of the <strong>{def.title}</strong>. Only the fields below are saved.</>
              : <>Fill in the fields to add a record to the <strong>{def.title}</strong>.</>}
          </div>
          <Alert alert={editor.alert} />
          <div className="grid grid-2">
            {def.headers.map((h, i) => {
              const locked = type === 'description' && h === 'AssetDescriptionOne';
              return (
                <div className="field" key={h}>
                  <label htmlFor={`m-${h}`}>{h}{i === 0 && <span className="req"> *</span>}{locked && <span className="muted"> (same as Expense Head)</span>}</label>
                  <input id={`m-${h}`} className="form-control" value={editor.values[h] || ''} readOnly={locked} autoFocus={i === 0}
                    onChange={(e) => setField(h, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save(); }} />
                </div>
              );
            })}
          </div>
        </Modal>
      )}
    </section>
  );
}
