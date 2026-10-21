import React, { useCallback, useEffect, useRef, useState } from 'react';
import api, { call, download, errorMessage, uploadFile } from '../services/api';
import { useApp } from '../context/AppContext';
import { Alert, EmptyRow, Modal, usePaged } from '../components/ui';
import ProductRows, { TotalSummary, blankRow, collectProducts, invalidRowOf, nextTaggable } from '../components/ProductRows';
import { formatMoney, todayInput } from '../utils/format';
import AgainstInvoice from '../components/AgainstInvoice';
import MonthSelect, { useBookingMonths } from '../components/MonthSelect';

const enc = encodeURIComponent;
const REFRESH_MS = 30000;   // Pending list refresh
const KEEP_MS = 60000;      // keeps the open invoice reserved
// invoices this user may open: not reserved by someone else
const isFree = (r) => !r.lockedBy || r.lockedByMe;
const freeOf = (list) => (list || []).filter(isFree);

const emptyRaw = () => ({ invNo: '', date: todayInput(), poNo: '', costCenter: '', amount: '', vendor: '', expenseHead: '', narration: '' });

// Index.html Upload page: Raw Data entry, Bulk Upload, Qty Plotting queue
export default function Upload() {
  const { withLoading, isAdmin } = useApp();
  const [raw, setRaw] = useState(emptyRaw);
  const [showOthers, setShowOthers] = useState(false); // show invoices other users are plotting
  const [rawAlert, setRawAlert] = useState(null);
  const [bulkAlert, setBulkAlert] = useState(null);
  const [pending, setPending] = useState(null);
  const [pendingAlert, setPendingAlert] = useState(null);
  const [products, setProducts] = useState([]);
  const [qty, setQty] = useState(null); // open Qty Plotting modal
  const bulkRef = useRef(null);
  const others = (pending || []).filter((r) => !isFree(r));
  const visible = showOthers ? pending : freeOf(pending);
  const paged = usePaged(visible);
  // Tally Booking Month for Raw Data and for bulk rows without one
  const booking = useBookingMonths();
  const [rawMonth, setRawMonth] = useState('');
  const [bulkMonth, setBulkMonth] = useState('');
  useEffect(() => {
    if (booking.defaultMonth) {
      setRawMonth((m) => m || booking.defaultMonth);
      setBulkMonth((m) => m || booking.defaultMonth);
    }
  }, [booking.defaultMonth]);
  const monthHint = booking.lastClosedLabel ? `Months up to ${booking.lastClosedLabel} are finalized.` : 'The month this invoice is booked in Tally.';

  const loadPending = useCallback(async (quiet = false, background = false) => {
    try {
      const r = await call('get', '/qty/pending', undefined, { background });
      setPending(r.records);
      return r.records;
    } catch (err) {
      if (!quiet) {
        setPending([]);
        setPendingAlert({ type: 'error', message: errorMessage(err) });
      }
      return null;
    }
  }, []);

  // the list follows what other users plot / reserve
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === 'visible') loadPending(true, true); }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [loadPending]);

  useEffect(() => {
    loadPending();
    call('get', '/products').then(setProducts).catch(() => {});
  }, [loadPending]);

  // ---------- Raw Data ----------
  const setField = (k) => (e) => setRaw({ ...raw, [k]: e.target.value });
  const saveRaw = () => {
    setRawAlert(null);
    const d = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]));
    if (!d.invNo || !d.date || !d.poNo || !d.costCenter || !d.amount || !d.vendor || !d.expenseHead || !rawMonth) {
      setRawAlert({ type: 'error', message: 'Please fill all required fields.' });
      return;
    }
    withLoading('Saving Raw Data...', () => call('post', '/fa', { ...d, bookMonth: rawMonth }))
      .then((r) => { setRawAlert({ type: 'success', message: `${r.message} FA Code: ${r.faCode}` }); setRaw(emptyRaw()); loadPending(); })
      .catch((err) => setRawAlert({ type: 'error', message: errorMessage(err) }));
  };

  // ---------- Bulk Upload ----------
  const uploadBulk = () => {
    setBulkAlert(null);
    const file = bulkRef.current?.files[0];
    if (!file) { setBulkAlert({ type: 'error', message: 'Please select the Excel file.' }); return; }
    if (!bulkMonth) { setBulkAlert({ type: 'error', message: 'Choose the Tally Booking Month.' }); return; }
    withLoading('Saving bulk records...', () => uploadFile('/fa/bulk-upload', file, { bookMonth: bulkMonth }))
      .then((r) => {
        const skipped = r.errors?.length ? ` Some rows were skipped: ${r.errors.join(' | ')}` : '';
        setBulkAlert({ type: skipped ? 'info' : 'success', message: r.message + skipped });
        bulkRef.current.value = '';
        loadPending();
      })
      .catch((err) => setBulkAlert({ type: 'error', message: errorMessage(err) }));
  };

  // ---------- Qty Plotting ----------
  // first free invoice after faCode in the order of `order` that is still pending in `fresh`
  const nextFree = (fresh, order, faCode) => {
    const byCode = new Map((fresh || []).map((r) => [r.faCode, r]));
    const start = order.findIndex((r) => r.faCode === faCode);
    for (let i = start + 1; i < order.length; i++) {
      const r = byCode.get(order[i].faCode);
      if (r && isFree(r)) return r;
    }
    return null;
  };

  // Reserves the invoice, then opens it. Reserved by someone else: the next free one.
  const openRecord = async (record, note = '') => {
    try {
      await call('post', `/qty/lock/${enc(record.faCode)}`);
    } catch (err) {
      const message = errorMessage(err);
      const order = pending || [];
      const fresh = (await loadPending(true)) || order;
      if (err.response?.data?.code === 'LOCKED') {
        const next = nextFree(fresh, order.some((r) => r.faCode === record.faCode) ? order : fresh, record.faCode);
        if (next) { openRecord(next, `${message} Moved to the next invoice.`); return; }
      }
      setQty(null);
      setPendingAlert({ type: 'info', message });
      return;
    }
    setQty({ record, rows: record.amount < 0 ? [] : [blankRow()], againstInvoiceNo: '', againstAssetCode: '', alert: note ? { type: 'info', message: note } : null, invalidRow: -1 });
  };

  const hasUnsaved = () => qty && qty.rows.some((r) => r.product.trim() || Number(r.quantity) > 0);

  // Cancel / close: the reservation ends
  const closeQty = () => {
    if (qty) call('delete', `/qty/lock/${enc(qty.record.faCode)}`).catch(() => {});
    setQty(null);
    loadPending(true);
  };

  const nextInvoice = async () => {
    if (hasUnsaved() && !window.confirm('This invoice has unsaved Qty Plotting data. Move to the next invoice without saving?')) return;
    const fresh = (await loadPending(true)) || pending;
    const next = nextFree(fresh, pending || [], qty.record.faCode);
    if (!next) { setQty((q) => q && { ...q, alert: { type: 'info', message: 'There is no next invoice.' } }); return; }
    openRecord(next); // reserving the next one releases this one
  };

  // keep the open invoice reserved; tell the user if it was lost
  const openCode = qty?.record.faCode;
  useEffect(() => {
    if (!openCode) return undefined;
    const keep = () => call('post', `/qty/lock/${enc(openCode)}/keep`, undefined, { background: true }).catch((err) => {
      setQty((q) => q && q.record.faCode === openCode && { ...q, alert: { type: 'error', message: `${errorMessage(err)} Close this window and choose another invoice.` } });
    });
    const timer = setInterval(keep, KEEP_MS);
    // closing the browser / tab frees the invoice at once
    const onLeave = () => {
      const token = sessionStorage.getItem('faSessionToken');
      try {
        fetch(`${api.defaults.baseURL}/qty/lock/${enc(openCode)}`, { method: 'DELETE', keepalive: true, headers: token ? { Authorization: `Bearer ${token}` } : {} });
      } catch { /* the reservation lapses on its own */ }
    };
    window.addEventListener('pagehide', onLeave);
    return () => { clearInterval(timer); window.removeEventListener('pagehide', onLeave); };
  }, [openCode]);

  // leaving the page (another menu) frees the invoice
  const openCodeRef = useRef(null);
  openCodeRef.current = openCode;
  useEffect(() => () => {
    if (openCodeRef.current) call('delete', `/qty/lock/${enc(openCodeRef.current)}`).catch(() => {});
  }, []);

  // Admin: free an invoice another user has reserved
  const releaseOther = (r) => {
    if (!window.confirm(`Release ${r.faCode}? ${r.lockedBy} is plotting it; their unsaved entries will be lost.`)) return;
    call('delete', `/qty/lock/${enc(r.faCode)}?any=1`)
      .then((x) => { setPendingAlert({ type: 'success', message: x.message }); loadPending(); })
      .catch((err) => setPendingAlert({ type: 'error', message: errorMessage(err) }));
  };

  const saveQty = () => {
    const rec = qty.record;
    const negative = rec.amount < 0;
    let list = [];
    if (!negative) {
      try { list = collectProducts(qty.rows); } catch (err) { setQty({ ...qty, alert: { type: 'error', message: err.message }, invalidRow: invalidRowOf(err.message) }); return; }
      const total = list.reduce((s, p) => s + p.productAmount, 0);
      if (Math.abs(total - rec.amount) > 0.01) {
        setQty({ ...qty, alert: { type: 'error', message: `Qty Plotting total (${formatMoney(total)}) must exactly match invoice amount (${formatMoney(rec.amount)}).` } });
        return;
      }
    }
    const order = pending || [];
    withLoading('Saving Qty Plotting...', async () => {
      const r = await call('post', '/qty', {
        faCode: rec.faCode, invNo: rec.invNo, expenseHead: rec.expenseHead, vendor: rec.vendor, products: list,
        againstInvoiceNo: negative ? qty.againstInvoiceNo.trim() : '', againstAssetCode: negative ? qty.againstAssetCode.trim() : '',
      });
      setPendingAlert({ type: 'success', message: r.message });
      call('get', '/products').then(setProducts).catch(() => {});
      const fresh = (await loadPending()) || [];
      const next = nextFree(fresh, order, rec.faCode);
      if (next) await openRecord(next); else setQty(null);
    }).catch((err) => setQty((q) => q && { ...q, alert: { type: 'error', message: errorMessage(err) }, invalidRow: invalidRowOf(errorMessage(err)) }));
  };

  return (
    <section className="page">
      <div className="card">
        <h3 className="card-title">Raw Data</h3>
        <Alert alert={rawAlert} />
        <div className="grid grid-4">
          <div className="field"><label htmlFor="rawInvNo">Inv No *</label><input id="rawInvNo" className="form-control" value={raw.invNo} onChange={setField('invNo')} /></div>
          <div className="field"><label htmlFor="rawDate">Date *</label><input id="rawDate" className="form-control" type="date" value={raw.date} onChange={setField('date')} /></div>
          <div className="field"><label htmlFor="rawPoNo">PO No *</label><input id="rawPoNo" className="form-control" value={raw.poNo} onChange={setField('poNo')} /></div>
          <div className="field"><label htmlFor="rawCc">Cost Center *</label><input id="rawCc" className="form-control" value={raw.costCenter} onChange={setField('costCenter')} /></div>
          <div className="field"><label htmlFor="rawAmount">Amount *</label><input id="rawAmount" className="form-control" type="number" step="0.01" value={raw.amount} onChange={setField('amount')} /></div>
          <div className="field"><label htmlFor="rawVendor">Vendor *</label><input id="rawVendor" className="form-control" value={raw.vendor} onChange={setField('vendor')} /></div>
          <div className="field"><label htmlFor="rawExp">Expense Head *</label><input id="rawExp" className="form-control" value={raw.expenseHead} onChange={setField('expenseHead')} /></div>
          <div className="field field-month">
            <label htmlFor="rawMonth">Tally Booking Month *</label>
            <MonthSelect id="rawMonth" value={rawMonth} onChange={setRawMonth} months={booking.months} />
            <span className="field-hint">{monthHint}</span>
          </div>
        </div>
        <div className="field" style={{ marginTop: 16 }}><label htmlFor="rawNarration">Narration</label><textarea id="rawNarration" className="form-control" value={raw.narration} onChange={setField('narration')} /></div>
        <div className="button-row" style={{ marginTop: 18 }}>
          <button type="button" className="btn btn-primary" onClick={saveRaw}>Save Raw Data</button>
          <button type="button" className="btn btn-light" onClick={() => setRaw(emptyRaw())}>Clear</button>
        </div>
      </div>

      <div className="card">
        <h3 className="card-title">Bulk Upload</h3>
        <p className="muted">Download the Excel template, fill in the rows, and upload the Excel file. Rows with a blank <strong>Tally Booking Month</strong> column (e.g. Oct-2026) are booked in the month chosen here.</p>
        <Alert alert={bulkAlert} />
        <div className="button-row">
          <label className="inline-field" htmlFor="bulkMonth">Tally Booking Month
            <MonthSelect id="bulkMonth" value={bulkMonth} onChange={setBulkMonth} months={booking.months} />
          </label>
          <button type="button" className="btn btn-secondary" onClick={() => download('/fa/template', 'FA_Bulk_Upload_Template.xlsx').catch((err) => setBulkAlert({ type: 'error', message: errorMessage(err) }))}>Download Template</button>
          <input ref={bulkRef} type="file" accept=".xlsx" className="form-control file-input" aria-label="Bulk upload file" />
          <button type="button" className="btn btn-primary" onClick={uploadBulk}>Upload Excel</button>
        </div>
      </div>

      <div className="card">
        <div className="card-head" style={{ justifyContent: 'space-between' }}>
          <h3 className="card-title">Qty Plotting</h3>
          <button type="button" className="btn btn-light btn-sm" onClick={loadPending}>Refresh</button>
        </div>
        <Alert alert={pendingAlert} />
        <p className="muted">Pending records are shown by Invoice No + Expense Head. After Qty Plotting is saved, the record will disappear from this list. Opening Plot Qty reserves the invoice for you, so another user does not plot it at the same time. The list refreshes every 30 seconds.</p>
        {others.length > 0 && (
          <div className="others-note">
            <span><strong>{others.length}</strong> invoice{others.length === 1 ? ' is' : 's are'} being plotted by other users{showOthers ? ' (shown greyed out)' : ' and hidden from your list'}.</span>
            <button type="button" className="btn btn-light btn-sm" onClick={() => setShowOthers(!showOthers)}>{showOthers ? 'Hide them' : 'Show them'}</button>
          </div>
        )}
        <div className="table-wrapper">
          <table className="fa-table">
            <thead><tr><th>FA Code</th><th>Invoice No</th><th>Vendor Name</th><th>Date</th><th>Tally Month</th><th>Expense Head</th><th className="num">Invoice Amount</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>
              {paged.rows.map((r) => (
                <tr key={r.faCode} className={isFree(r) ? (r.lockedByMe ? 'row-mine' : undefined) : 'row-busy'}>
                  <td><strong>{r.faCode}</strong></td><td>{r.invNo}</td><td>{r.vendor}</td><td>{r.date}</td><td>{r.bookMonthLabel}</td><td>{r.expenseHead}</td>
                  <td className="num">{formatMoney(r.amount)}</td>
                  <td>
                    {isFree(r)
                      ? <span className="badge badge-pending">{r.lockedByMe ? 'Open by you' : r.status}</span>
                      : <span className="badge badge-busy" title={`Reserved ${r.lockedAt}`}>In progress – {r.lockedBy}</span>}
                  </td>
                  <td>
                    {isFree(r)
                      ? <button type="button" className="btn btn-primary btn-sm" onClick={() => openRecord(r)}>Plot Qty</button>
                      : (
                        <div className="actions">
                          <button type="button" className="btn btn-light btn-sm" disabled>In progress</button>
                          {isAdmin && <button type="button" className="btn btn-warning btn-sm" onClick={() => releaseOther(r)}>Release</button>}
                        </div>
                      )}
                  </td>
                </tr>
              ))}
              {!visible?.length && <EmptyRow cols={9}>{!pending ? 'Loading...' : others.length ? 'No free pending invoices – the rest are being plotted by other users.' : 'No pending Qty Plotting records.'}</EmptyRow>}
            </tbody>
          </table>
        </div>
        {paged.pager}
      </div>

      {qty && (
        <Modal title="Qty Plotting" progress={`Invoice ${Math.max(1, freeOf(pending).findIndex((r) => r.faCode === qty.record.faCode) + 1)} of ${freeOf(pending).length} · reserved for you`} onClose={closeQty}
          footer={(
            <>
              <button type="button" className="btn btn-light footer-left" onClick={closeQty}>Cancel</button>
              <button type="button" className="btn btn-secondary" onClick={nextInvoice}>Next Invoice</button>
              <button type="button" className="btn btn-success btn-cta" onClick={saveQty}>Save Qty Plotting</button>
            </>
          )}>
          <div className="qty-summary">
            <div className="qty-summary-box"><span>FA Code</span><strong>{qty.record.faCode}</strong></div>
            <div className="qty-summary-box"><span>Invoice No</span><strong>{qty.record.invNo}</strong></div>
            <div className="qty-summary-box"><span>Vendor Name</span><strong>{qty.record.vendor || '-'}</strong></div>
            <div className="qty-summary-box"><span>Expense Head</span><strong>{qty.record.expenseHead}</strong></div>
            <div className="qty-summary-box"><span>Invoice Amount</span><strong>{formatMoney(qty.record.amount)}</strong></div>
            <div className="qty-summary-box"><span>Tally Booking Month</span><strong>{qty.record.bookMonthLabel}</strong></div>
            <div className="qty-summary-box" style={{ gridColumn: '1 / -1' }}><span>Narration</span><strong style={{ whiteSpace: 'normal' }}>{qty.record.narration || '-'}</strong></div>
          </div>
          <Alert alert={qty.alert} />
          {qty.record.amount < 0 ? (
            <AgainstInvoice key={qty.record.faCode} idPrefix="qtyAg" record={qty.record} invoiceNo={qty.againstInvoiceNo} assetCode={qty.againstAssetCode}
              onChange={(v) => setQty((q) => ({ ...q, ...v }))} />
          ) : (
            <>
              <div className="section-heading">Product Details</div>
              <ProductRows rows={qty.rows} onChange={(rows) => setQty({ ...qty, rows, invalidRow: -1 })} invalidRow={qty.invalidRow}
                onError={(m) => setQty({ ...qty, alert: { type: 'error', message: m } })} products={products} />
              <TotalSummary label="Invoice Amount" amount={qty.record.amount} rows={qty.rows} />
              <div style={{ marginTop: 15 }}>
                <button type="button" className="btn btn-light" onClick={() => setQty({ ...qty, rows: [...qty.rows, blankRow(nextTaggable(qty.rows))] })}>+ Add Product</button>
              </div>
            </>
          )}
        </Modal>
      )}
    </section>
  );
}
