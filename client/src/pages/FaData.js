import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { call, download, errorMessage, uploadFile } from '../services/api';
import { useApp } from '../context/AppContext';
import { Icon } from '../components/Layout';
import MultiSelect from '../components/MultiSelect';
import { Alert, EmptyRow, Modal, Pagination } from '../components/ui';
import ProductRows, { TotalSummary, blankRow, collectProducts, invalidRowOf, nextTaggable, rowsFromProducts, rowsTotal } from '../components/ProductRows';
import { displayDateToInput, formatMoney, formatNumber } from '../utils/format';
import AgainstInvoice from '../components/AgainstInvoice';
import MonthSelect, { MonthStatus, isLocked, useBookingMonths } from '../components/MonthSelect';

const NO_FILTER = { search: '', costCenters: [], months: [], from: '', to: '', status: '' };

// Index.html FA Data page: register, global filter, export, Admin bulk edit,
// Edit (FA + Qty Plotting), Details and Delete. Filtering, search and paging
// run on the server, so a year of data (100,000+ records) loads one page at a time.
export default function FaData() {
  const { isAdmin, withLoading } = useApp();
  const [data, setData] = useState(null); // { rows, total, amount, completed } of the current page / filter
  const [range, setRange] = useState(null);
  const [options, setOptions] = useState({ costCenters: [], months: [], total: 0 });
  const [term, setTerm] = useState(''); // search, after a short pause in typing
  const [filters, setFilters] = useState(NO_FILTER);
  const [bulk, setBulk] = useState(null); // Delete Filtered window
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [alert, setAlert] = useState(null);
  const [edit, setEdit] = useState(null);
  const [details, setDetails] = useState(null);
  const [products, setProducts] = useState([]);
  const fileRef = useRef(null);

  useEffect(() => { const timer = setTimeout(() => setTerm(filters.search.trim()), 350); return () => clearTimeout(timer); }, [filters.search]);

  // Tally months: label shown in the filter <-> 'YYYY-MM' sent to the server
  const monthOptions = useMemo(() => options.months.map((m) => m.label), [options]);
  const monthOf = useMemo(() => Object.fromEntries(options.months.map((m) => [m.label, m.month])), [options]);

  // the filters as server parameters (also used by Delete Filtered)
  const serverFilters = useMemo(() => ({
    costCenter: filters.costCenters, months: filters.months.map((l) => monthOf[l]).filter(Boolean),
    from: filters.from, to: filters.to, status: filters.status, search: term,
  }), [filters.costCenters, filters.months, filters.from, filters.to, filters.status, term, monthOf]);
  const query = useMemo(() => {
    const q = new URLSearchParams();
    serverFilters.costCenter.forEach((c) => q.append('costCenter', c));
    serverFilters.months.forEach((m) => q.append('months', m));
    ['from', 'to', 'status', 'search'].forEach((k) => { if (serverFilters[k]) q.append(k, serverFilters[k]); });
    return q.toString();
  }, [serverFilters]);

  const loadPage = useCallback(async () => {
    try {
      const r = await call('get', `/fa/page?${query}${query ? '&' : ''}page=${page}&size=${pageSize}`);
      setData(r);
      if (r.rows.length === 0 && page > 1 && r.total > 0) setPage(Math.ceil(r.total / pageSize));
    } catch (err) {
      setData({ rows: [], total: 0, amount: 0, completed: 0 });
      setAlert({ type: 'error', message: errorMessage(err) });
    }
  }, [query, page, pageSize]);
  useEffect(() => { loadPage(); }, [loadPage]);

  const loadOptions = useCallback(() => {
    call('get', '/fa/filter-options').then((o) => setOptions({ ...o, total: o.months.reduce((n, m) => n + m.records, 0) })).catch(() => {});
    call('get', '/fa/date-range').then(setRange).catch(() => setRange(null));
  }, []);
  // after a save / delete / bulk edit: this page, the filter choices and the data range again
  const load = useCallback(() => { loadPage(); loadOptions(); }, [loadPage, loadOptions]);

  useEffect(() => {
    loadOptions();
    call('get', '/products').then(setProducts).catch(() => {});
  }, [loadOptions]);
  const costCenters = options.costCenters;
  const shown = data?.total ?? 0;

  const filterActive = Boolean(filters.costCenters.length || filters.months.length || filters.from || filters.to || filters.status || filters.search.trim());
  const setFilter = (patch) => { setFilters({ ...filters, ...patch }); setPage(1); };
  const ddmm = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
  const filterText = [
    filters.costCenters.length && `Cost Center: ${filters.costCenters.join(', ')}`,
    filters.months.length && `Tally Month: ${filters.months.join(', ')}`,
    filters.from && `From: ${ddmm(filters.from)}`,
    filters.to && `To: ${ddmm(filters.to)}`,
    filters.status && `Status: ${filters.status}`,
    filters.search.trim() && `Search: "${filters.search.trim()}"`,
  ].filter(Boolean).join(' · ');
  const filteredAmount = data?.amount || 0;

  const openBulkDelete = () => {
    if (!filterActive) { setAlert({ type: 'error', message: 'Choose a filter first (Cost Center, From / To Date, Status or search). Delete Filtered acts only on the records the filter shows.' }); return; }
    if (filters.from && filters.to && filters.from > filters.to) { setAlert({ type: 'error', message: 'From Date is after To Date.' }); return; }
    if (filters.search.trim() !== term) { setAlert({ type: 'info', message: 'Wait a moment for the search to finish, then try again.' }); return; }
    if (!shown) { setAlert({ type: 'info', message: 'No records match the filter.' }); return; }
    setBulk({ mode: 'qty', confirm: '', alert: null });
  };

  // the server deletes what the filter matches, if it is still the count shown here
  const runBulkDelete = () => withLoading(bulk.mode === 'all' ? 'Deleting FA records...' : 'Removing Qty Plotting...', () => call('post', '/fa-bulk-delete', {
    filters: serverFilters, expectedCount: shown, mode: bulk.mode, filter: filterText,
  }))
    .then((r) => { setBulk(null); setAlert({ type: 'success', message: r.message }); load(); })
    .catch((err) => setBulk((b) => b && { ...b, alert: { type: 'error', message: errorMessage(err) } }));

  const exportData = () => withLoading('Preparing FA Excel export...', () => download('/fa/export', 'FA_Data_Export.xlsx'))
    .then((n) => setAlert({ type: 'success', message: `${n} row(s) exported successfully.` }))
    .catch((err) => setAlert({ type: 'error', message: errorMessage(err) }));

  const bulkEdit = () => {
    const file = fileRef.current?.files[0];
    if (!file) { setAlert({ type: 'error', message: 'Please select the exported FA Data Excel file after making your edits.' }); return; }
    withLoading('Updating FA Data...', () => uploadFile('/fa/bulk-edit', file))
      .then((r) => {
        setAlert({ type: r.errors?.length ? 'error' : 'success', message: r.errors?.length ? `${r.message}\n${r.errors.join('\n')}` : r.message });
        fileRef.current.value = '';
        load();
      })
      .catch((err) => setAlert({ type: 'error', message: errorMessage(err) }));
  };

  const openEdit = (faCode) => withLoading('Loading FA and Qty Plotting data...', () => call('get', `/fa/${encodeURIComponent(faCode)}`))
    .then((rec) => {
      const negative = rec.raw.amount < 0;
      setEdit({
        form: { ...rec.raw, date: displayDateToInput(rec.raw.date), amount: String(rec.raw.amount) },
        rows: negative ? [] : (rec.products.length ? rowsFromProducts(rec.products) : [blankRow()]),
        againstInvoiceNo: rec.products[0]?.againstInvoiceNo || '',
        againstAssetCode: rec.products[0]?.againstAssetCode || '',
        alert: null,
        invalidRow: -1,
      });
    })
    .catch((err) => setAlert({ type: 'error', message: errorMessage(err) }));

  const openDetails = (faCode) => {
    setDetails({ loading: true });
    call('get', `/fa/${encodeURIComponent(faCode)}`).then(setDetails).catch((err) => setDetails({ error: errorMessage(err) }));
  };

  const remove = (faCode) => {
    if (!window.confirm(`Are you sure you want to delete FA ${faCode}?\n\nThis will also delete its Qty Plotting data.`)) return;
    withLoading('Deleting FA record...', () => call('delete', `/fa/${encodeURIComponent(faCode)}`))
      .then((r) => { setAlert({ type: 'success', message: r.message }); load(); })
      .catch((err) => setAlert({ type: 'error', message: errorMessage(err) }));
  };

  return (
    <section className="page">
      <div className="card">
        <div className="fa-toolbar">
          <div>
            <h3 className="card-title">FA Data</h3>
            <div className="muted fa-available">
              <Icon name="calendar" size={13} />
              Data available: {range?.fromDate || '-'} – {range?.toDate || '-'}
            </div>
          </div>
          <div className="fa-toolbar-actions">
            <button type="button" className="btn btn-light btn-sm" onClick={load} title="Reload the records"><Icon name="refresh" size={14} />Refresh</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={exportData} title="Download all records with their Qty Plotting"><Icon name="download" size={14} />Export to Excel</button>
            {isAdmin && (
              <div className="tool-box tool-box-amber" title="Change many records at once: Export, edit the Excel, then upload it here">
                <span className="tool-box-label">Admin · Update from Excel</span>
                <div className="button-row">
                  <input ref={fileRef} type="file" accept=".xlsx" className="form-control file-input" aria-label="Bulk edit file" />
                  <button type="button" className="btn btn-warning btn-sm" onClick={bulkEdit}>Bulk Edit</button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="filter-panel-wrap">
          <div className="filter-panel-head">
            <span className="filter-panel-icon"><Icon name="filter" size={16} /></span>
            <div>
              <strong>Filter records</strong>
              <span className="muted">Choose one or more fields to narrow the list. Fields you set turn blue. Delete Filtered acts only on the records shown.</span>
            </div>
          </div>
          <div className="filter-panel">
            <div className={`field${filters.costCenters.length ? ' is-set' : ''}`}>
              <label htmlFor="fltCc"><Icon name="building" size={13} />Cost Center <span className="label-hint">(choose one or more)</span></label>
              <MultiSelect id="fltCc" options={costCenters} value={filters.costCenters} onChange={(v) => setFilter({ costCenters: v })}
                allLabel={`All cost centers (${costCenters.length})`} noun="cost centers" />
            </div>
            <div className={`field${filters.months.length ? ' is-set' : ''}`}>
              <label htmlFor="fltMonth"><Icon name="calendar" size={13} />Tally Booking Month</label>
              <MultiSelect id="fltMonth" options={monthOptions} value={filters.months} onChange={(v) => setFilter({ months: v })}
                allLabel={`All months (${monthOptions.length})`} noun="months" />
            </div>
            <div className={`field${filters.from ? ' is-set' : ''}`}>
              <label htmlFor="fltFrom"><Icon name="calendar" size={13} />Invoice date from</label>
              <input id="fltFrom" type="date" className="form-control" value={filters.from} max={filters.to || undefined} onChange={(e) => setFilter({ from: e.target.value })} />
            </div>
            <div className={`field${filters.to ? ' is-set' : ''}`}>
              <label htmlFor="fltTo"><Icon name="calendar" size={13} />Invoice date to</label>
              <input id="fltTo" type="date" className="form-control" value={filters.to} min={filters.from || undefined} onChange={(e) => setFilter({ to: e.target.value })} />
            </div>
            <div className={`field${filters.status ? ' is-set' : ''}`}>
              <label htmlFor="fltStatus"><Icon name="status" size={13} />Status</label>
              <select id="fltStatus" className="form-control" value={filters.status} onChange={(e) => setFilter({ status: e.target.value })}>
                <option value="">All statuses</option>
                <option value="Pending">Pending (not plotted)</option>
                <option value="Completed">Completed (plotted)</option>
              </select>
            </div>
            <div className={`field filter-search${filters.search.trim() ? ' is-set' : ''}`}>
              <label htmlFor="fltSearch"><Icon name="search" size={13} />Search any column</label>
              <input id="fltSearch" className="form-control" placeholder="e.g. FA Code, Inv No, Vendor, Expense Head" value={filters.search}
                onChange={(e) => setFilter({ search: e.target.value })} />
            </div>
          </div>
          {filterActive && (
            <div className="filter-chips">
              <span className="muted">Active filters:</span>
              {filters.costCenters.length > 4 ? (
                <button type="button" className="chip" title={filters.costCenters.join(', ')} onClick={() => setFilter({ costCenters: [] })}>Cost Center: {filters.costCenters.length} selected<span aria-hidden="true">×</span></button>
              ) : filters.costCenters.map((c) => (
                <button key={c} type="button" className="chip" onClick={() => setFilter({ costCenters: filters.costCenters.filter((x) => x !== c) })}>Cost Center: {c}<span aria-hidden="true">×</span></button>
              ))}
              {filters.months.map((m) => (
                <button key={m} type="button" className="chip" onClick={() => setFilter({ months: filters.months.filter((x) => x !== m) })}>Tally Month: {m}<span aria-hidden="true">×</span></button>
              ))}
              {filters.from && <button type="button" className="chip" onClick={() => setFilter({ from: '' })}>From: {ddmm(filters.from)}<span aria-hidden="true">×</span></button>}
              {filters.to && <button type="button" className="chip" onClick={() => setFilter({ to: '' })}>To: {ddmm(filters.to)}<span aria-hidden="true">×</span></button>}
              {filters.status && <button type="button" className="chip" onClick={() => setFilter({ status: '' })}>Status: {filters.status}<span aria-hidden="true">×</span></button>}
              {filters.search.trim() && <button type="button" className="chip" onClick={() => setFilter({ search: '' })}>Search: “{filters.search.trim()}”<span aria-hidden="true">×</span></button>}
              <button type="button" className="chip chip-clear" onClick={() => { setFilters(NO_FILTER); setPage(1); }}>Clear all</button>
            </div>
          )}
        </div>

        <div className={`filter-result${filterActive ? ' active' : ''}`}>
          <span>
            {filterActive ? 'Showing' : 'All records:'} <strong>{shown.toLocaleString('en-IN')}</strong>
            {filterActive && <> of {options.total.toLocaleString('en-IN')}</>} record(s) · Amount <strong>{formatMoney(filteredAmount)}</strong>
          </span>
          {isAdmin && (
            <span className="filter-delete">
              {!filterActive && <span className="muted">Set a filter to enable</span>}
              <button type="button" className="btn btn-danger btn-sm" disabled={!filterActive || !shown} onClick={openBulkDelete}
                title={filterActive ? 'Delete the records shown by the filter' : 'Choose a filter first'}>
                <Icon name="trash" size={14} />Delete Filtered ({shown.toLocaleString('en-IN')})
              </button>
            </span>
          )}
        </div>
        <Alert alert={alert} />
        <div className="table-wrapper">
          <table className="fa-table">
            <thead>
              <tr>
                <th>FA Code</th><th>Inv No</th><th>Date</th><th>Tally Month</th><th>PO No</th><th>Cost Center</th><th className="num">Amount</th><th>Vendor</th>
                <th>Expense Head</th><th>Status</th><th>Qty Plotting Created Date</th><th>Qty Plotted By</th><th>Action</th>
              </tr>
            </thead>
            <tbody>
              {(data?.rows || []).map((r) => {
                const locked = isLocked(r.monthStatus, isAdmin);
                const why = locked ? `${r.bookMonthLabel} is ${r.monthStatus} - locked` : undefined;
                return (
                <tr key={r.faCode} className={locked ? 'row-locked' : undefined}>
                  <td><strong>{r.faCode}</strong></td><td>{r.invNo}</td><td>{r.date}</td>
                  <td><span className="tally-month">{r.bookMonthLabel}{r.monthStatus !== 'Open' && <MonthStatus status={r.monthStatus} />}</span></td><td>{r.poNo}</td><td>{r.costCenter}</td>
                  <td className="num">{formatMoney(r.amount)}</td><td>{r.vendor}</td><td>{r.expenseHead}</td>
                  <td><span className={`badge ${r.status === 'Completed' ? 'badge-completed' : 'badge-pending'}`}>{r.status}</span></td>
                  <td>{r.qtyCreatedAt}</td><td>{r.qtyPlottedBy}</td>
                  <td>
                    <div className="actions">
                      <button type="button" className="btn btn-warning btn-sm" disabled={locked} title={why} onClick={() => openEdit(r.faCode)}>Edit</button>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => openDetails(r.faCode)}>Details</button>
                      <button type="button" className="btn btn-danger btn-sm" disabled={locked} title={why} onClick={() => remove(r.faCode)}>Delete</button>
                    </div>
                  </td>
                </tr>
                );
              })}
              {!data?.rows.length && <EmptyRow cols={13}>{data ? 'No FA data found.' : 'Loading...'}</EmptyRow>}
            </tbody>
          </table>
        </div>
        {shown > 0 && (
          <Pagination page={page} size={pageSize} total={shown} onPage={setPage} onSize={(n) => { setPageSize(n); setPage(1); }} />
        )}
      </div>

      {edit && <EditModal edit={edit} setEdit={setEdit} products={products} onSaved={(message) => { setEdit(null); setAlert({ type: 'success', message }); load(); }} />}
      {details && <DetailsModal details={details} isAdmin={isAdmin} onClose={() => setDetails(null)} />}
      {bulk && (
        <BulkDeleteModal bulk={bulk} setBulk={setBulk} count={shown} plotted={data?.completed || 0} filterText={filterText} amount={filteredAmount} onConfirm={runBulkDelete} />
      )}
    </section>
  );
}

// "Edit FA Data & Qty Plotting" (populateEditModal / saveEditedFA)
function EditModal({ edit, setEdit, products, onSaved }) {
  const { withLoading } = useApp();
  const booking = useBookingMonths();
  const f = edit.form;
  // the record's own month is always offered
  const monthChoices = booking.months.some((m) => m.month === f.bookMonth)
    ? booking.months : [{ month: f.bookMonth, label: f.bookMonthLabel, status: f.monthStatus }, ...booking.months];
  const amount = Number(f.amount) || 0;
  const negative = amount < 0;
  const setForm = (k) => (e) => setEdit({ ...edit, form: { ...f, [k]: e.target.value } });
  const fail = (message, invalidRow = -1) => setEdit({ ...edit, alert: { type: 'error', message }, invalidRow });

  const save = () => {
    if (!f.faCode || !f.invNo || !f.date || !f.poNo || !f.costCenter || amount === 0 || !f.vendor || !f.expenseHead) {
      fail('Please fill all required FA fields.');
      return;
    }
    let list;
    if (negative) {
      if (!edit.againstInvoiceNo.trim() && !edit.againstAssetCode.trim()) { fail('For negative amount, Against Invoice No or Against Asset Code is required.'); return; }
      list = [{ product: `${f.expenseHead} (Credit Not/Reversal)`, quantity: 1, taggable: 'Non Taggable', unitPrice: Math.abs(amount), productAmount: amount, gstPercent: 0, againstInvoiceNo: edit.againstInvoiceNo.trim(), againstAssetCode: edit.againstAssetCode.trim() }];
    } else {
      try { list = collectProducts(edit.rows); } catch (err) { fail(err.message, invalidRowOf(err.message)); return; }
      const total = list.reduce((s, p) => s + p.productAmount, 0);
      if (Math.abs(total - amount) > 0.01) { fail(`Qty Plotting total (${formatMoney(total)}) must exactly match FA amount (${formatMoney(amount)}).`); return; }
    }
    withLoading('Saving FA and Qty Plotting changes...', () => call('put', `/fa/${encodeURIComponent(f.faCode)}`, {
      invNo: f.invNo.trim(), date: f.date, poNo: f.poNo.trim(), costCenter: f.costCenter.trim(), amount, vendor: f.vendor.trim(),
      expenseHead: f.expenseHead.trim(), narration: (f.narration || '').trim(), bookMonth: f.bookMonth, products: list,
    }))
      .then((r) => onSaved(r.message))
      .catch((err) => fail(errorMessage(err), invalidRowOf(errorMessage(err))));
  };

  const close = () => setEdit(null);
  return (
    <Modal title="Edit FA Data & Qty Plotting" onClose={close}
      footer={<><button type="button" className="btn btn-light footer-left" onClick={close}>Cancel</button><button type="button" className="btn btn-success btn-cta" onClick={save}>Save Changes</button></>}>
      <Alert alert={edit.alert} />
      <div className="grid grid-3">
        <div className="field"><label>FA Code</label><input className="form-control" value={f.faCode} readOnly /></div>
        <div className="field"><label>Inv No *</label><input className="form-control" value={f.invNo} onChange={setForm('invNo')} /></div>
        <div className="field"><label>Date *</label><input className="form-control" type="date" value={f.date} onChange={setForm('date')} /></div>
        <div className="field"><label>PO No *</label><input className="form-control" value={f.poNo} onChange={setForm('poNo')} /></div>
        <div className="field"><label>Cost Center *</label><input className="form-control" value={f.costCenter} onChange={setForm('costCenter')} /></div>
        <div className="field"><label>Amount *</label><input className="form-control" type="number" step="0.01" value={f.amount} onChange={setForm('amount')} /></div>
        <div className="field"><label>Vendor *</label><input className="form-control" value={f.vendor} onChange={setForm('vendor')} /></div>
        <div className="field"><label>Expense Head *</label><input className="form-control" value={f.expenseHead} onChange={setForm('expenseHead')} /></div>
        <div className="field field-month">
          <label htmlFor="editMonth">Tally Booking Month *</label>
          <MonthSelect id="editMonth" value={f.bookMonth} months={monthChoices} onChange={(v) => setEdit({ ...edit, form: { ...f, bookMonth: v } })} />
        </div>
      </div>
      <div className="field" style={{ marginTop: 16 }}><label>Narration</label><textarea className="form-control" value={f.narration || ''} onChange={setForm('narration')} /></div>

      <div style={{ marginTop: 25, paddingTop: 20, borderTop: '1px solid #e5e7eb' }}>
        <div className="card-head" style={{ justifyContent: 'space-between', marginBottom: 15 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Qty Plotting Data</h3>
          {!negative && <button type="button" className="btn btn-light btn-sm" onClick={() => setEdit({ ...edit, rows: [...edit.rows, blankRow(nextTaggable(edit.rows))] })}>+ Add Product</button>}
        </div>
        <p className="muted">You can edit existing Qty Plotting products, change Taggable / Non Taggable, change quantities, prices, or add/remove products.</p>
        {negative ? (
          <AgainstInvoice key={f.faCode} idPrefix="editAg" record={{ faCode: f.faCode, invNo: f.invNo, amount: f.amount, expenseHead: f.expenseHead }}
            invoiceNo={edit.againstInvoiceNo} assetCode={edit.againstAssetCode} onChange={(v) => setEdit((e) => ({ ...e, ...v }))} />
        ) : (
          <>
            <ProductRows rows={edit.rows} onChange={(rows) => setEdit({ ...edit, rows, invalidRow: -1 })} invalidRow={edit.invalidRow}
              onError={(m) => setEdit({ ...edit, alert: { type: 'error', message: m } })} products={products} listId="editProductNames" />
            <TotalSummary label="FA Amount" amount={amount} rows={edit.rows} />
          </>
        )}
      </div>
    </Modal>
  );
}

// "FA Details" (renderDetails)
function DetailsModal({ details, isAdmin, onClose }) {
  const raw = details.raw;
  const products = details.products || [];
  const [history, setHistory] = useState(null);
  useEffect(() => {
    if (isAdmin && raw?.faCode) call('get', `/history/${encodeURIComponent(raw.faCode)}`).then(setHistory).catch(() => setHistory([]));
  }, [isAdmin, raw?.faCode]);
  return (
    <Modal title="FA Details" onClose={onClose} footer={<button type="button" className="btn btn-light" onClick={onClose}>Close</button>}>
      {details.loading && <div className="empty">Loading...</div>}
      {details.error && <Alert alert={{ type: 'error', message: details.error }} />}
      {raw && (
        <>
          <div className="grid grid-4" style={{ marginBottom: 22 }}>
            {[['FA Code', raw.faCode], ['Invoice No', raw.invNo], ['Date', raw.date], ['PO No', raw.poNo], ['Cost Center', raw.costCenter],
              ['Amount', formatMoney(raw.amount)], ['Vendor', raw.vendor], ['Expense Head', raw.expenseHead],
              ['Tally Booking Month', <>{raw.bookMonthLabel} <MonthStatus status={raw.monthStatus} /></>]].map(([k, v]) => (
              <div key={k}><div className="muted">{k}</div><strong>{v}</strong></div>
            ))}
          </div>
          <div style={{ marginBottom: 22, padding: 15, background: '#f8fafc', borderRadius: 8 }}>
            <div className="muted">Narration</div><div style={{ marginTop: 5 }}>{raw.narration || '-'}</div>
          </div>
          <h3 style={{ fontSize: 16, margin: '0 0 12px' }}>Qty Plotting</h3>
          {!products.length ? <div className="empty">No Qty Plotting data found.</div> : (
            <div className="table-wrapper">
              <table>
                <thead><tr><th>#</th><th>Product / Asset Description</th><th className="num">Quantity</th><th>Taggable</th><th className="num">Unit Price</th><th className="num">Product Amount</th><th className="num">GST %</th><th>Against Invoice No</th><th>Against Asset Code</th></tr></thead>
                <tbody>
                  {products.map((p, i) => (
                    <tr key={p.lineId}>
                      <td>{i + 1}</td><td>{p.product}</td><td className="num">{formatNumber(p.quantity)}</td>
                      <td><span className={`badge ${p.taggable === 'Taggable' ? 'badge-completed' : 'badge-pending'}`}>{p.taggable}</span></td>
                      <td className="num">{formatMoney(p.unitPrice)}</td><td className="num">{formatMoney(p.productAmount)}</td><td className="num">{formatNumber(p.gstPercent)}%</td>
                      <td>{p.againstInvoiceNo}</td><td>{p.againstAssetCode}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td colSpan={5} className="text-right"><strong>Total</strong></td><td className="num"><strong>{formatMoney(rowsTotal(products))}</strong></td><td colSpan={3} /></tr></tfoot>
              </table>
            </div>
          )}
          {isAdmin && (
            <>
              <h3 style={{ fontSize: 16, margin: '24px 0 12px' }}>Change History</h3>
              {!history ? <div className="empty">Loading...</div> : !history.length ? <div className="empty">No changes recorded for this record.</div> : (
                <div className="table-wrapper">
                  <table>
                    <thead><tr><th>When</th><th>By</th><th>Field</th><th>Old value</th><th>New value</th><th>Screen</th></tr></thead>
                    <tbody>
                      {history.map((h, i) => (
                        <tr key={`${h.at}-${h.field}-${i}`}>
                          <td>{h.at}</td><td>{h.by}</td><td>{h.field}</td><td className="hist-old">{h.oldValue || '-'}</td><td className="hist-new">{h.newValue || '-'}</td><td>{h.source}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}
    </Modal>
  );
}

// "Delete Filtered": remove Qty Plotting only, or the FA records themselves
function BulkDeleteModal({ bulk, setBulk, count, plotted, filterText, amount, onConfirm }) {
  const records = { length: count };
  const ok = bulk.confirm.trim().toUpperCase() === 'DELETE';
  const set = (patch) => setBulk({ ...bulk, ...patch, alert: null });
  return (
    <Modal small title="Delete Filtered Records" progress={`${records.length} record(s) · ${formatMoney(amount)}`} onClose={() => setBulk(null)}
      footer={(
        <>
          <button type="button" className="btn btn-light footer-left" onClick={() => setBulk(null)}>Cancel</button>
          <button type="button" className="btn btn-danger-solid btn-cta" disabled={!ok} onClick={onConfirm}>
            {bulk.mode === 'all' ? `Delete ${records.length} record(s)` : `Remove Qty Plotting (${plotted})`}
          </button>
        </>
      )}>
      <div className="edit-banner editing">Filter: <strong>{filterText}</strong></div>
      <Alert alert={bulk.alert} />
      <div className="choice-list">
        <label className={`choice${bulk.mode === 'qty' ? ' active' : ''}`}>
          <input type="radio" name="bulkMode" checked={bulk.mode === 'qty'} onChange={() => set({ mode: 'qty' })} />
          <span>
            <strong>Remove Qty Plotting only</strong>
            <small>For a wrong quantity or product breakup. The {plotted} plotted record(s) go back to Pending and appear again in Upload › Qty Plotting. FA records and FA Codes are kept. Records of a Non Taggable ledger are plotted again automatically.</small>
          </span>
        </label>
        <label className={`choice danger${bulk.mode === 'all' ? ' active' : ''}`}>
          <input type="radio" name="bulkMode" checked={bulk.mode === 'all'} onChange={() => set({ mode: 'all' })} />
          <span>
            <strong>Delete FA records completely</strong>
            <small>For a wrong upload. All {records.length} record(s) and their Qty Plotting are deleted and cannot be restored. Their FA Codes are not reused.</small>
          </span>
        </label>
      </div>
      <div className="field" style={{ marginTop: 16 }}>
        <label htmlFor="bulkConfirm">Type <strong>DELETE</strong> to confirm</label>
        <input id="bulkConfirm" className="form-control" autoComplete="off" value={bulk.confirm} onChange={(e) => set({ confirm: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter' && ok) onConfirm(); }} />
      </div>
    </Modal>
  );
}
