import React, { useEffect, useState } from 'react';

// <Alert alert={{ type: 'success' | 'error' | 'info', message }} /> (showAlert)
export function Alert({ alert }) {
  if (!alert?.message) return null;
  return <div className={`alert alert-${alert.type || 'info'}`} role={alert.type === 'error' ? 'alert' : 'status'}>{alert.message}</div>;
}

export function Modal({ title, progress, onClose, footer, small = false, children }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal${small ? ' small' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <div>
            <h3>{title}</h3>
            {progress && <div className="header-progress">{progress}</div>}
          </div>
          <button type="button" className="close-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

// Page numbers to show: first, last and two either side of the current page,
// with '…' for the gaps, e.g. 1 … 4 5 [6] 7 8 … 20
function pageList(current, pages) {
  const out = [];
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - current) <= 2) out.push(p);
    else if (out[out.length - 1] !== '…') out.push('…');
  }
  return out;
}

/**
 * "Showing 1–10 of 54 records" + Previous / page numbers / Next.
 * With onSize, also a "Rows per page" choice (sizes).
 */
export function Pagination({ page, size, total, onPage, onSize, sizes = [10, 25, 50, 100] }) {
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(page, pages);
  const from = total ? (current - 1) * size + 1 : 0;
  const to = Math.min(current * size, total);
  return (
    <div className="pagination">
      <div className="pagination-info">
        <span className="muted">Showing {from}–{to} of {total} records</span>
        {onSize && (
          <label className="muted pagination-size">
            Rows per page
            <select className="form-control" value={size} onChange={(e) => onSize(Number(e.target.value))}>
              {sizes.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
      </div>
      <div className="pagination-pages">
        <button type="button" className="btn btn-light btn-sm" disabled={current <= 1} onClick={() => onPage(current - 1)}>‹ Previous</button>
        {pageList(current, pages).map((p, i) => (p === '…'
          ? <span key={`gap${i}`} className="pagination-gap">…</span>
          : (
            <button key={p} type="button" className={`btn btn-sm page-btn${p === current ? ' active' : ''}`} aria-current={p === current ? 'page' : undefined} onClick={() => onPage(p)}>
              {p}
            </button>
          )))}
        <button type="button" className="btn btn-light btn-sm" disabled={current >= pages} onClick={() => onPage(current + 1)}>Next ›</button>
      </div>
    </div>
  );
}

// Rows of the current page
export const pageOf = (rows, page, size) => rows.slice((Math.max(page, 1) - 1) * size, Math.max(page, 1) * size);

/**
 * Paging for a list shown in a table (10 rows per page by default).
 * Returns { rows, offset, pager, reset }: the current page's rows, the index
 * of its first row in `list`, the <Pagination> to render under the table,
 * and reset() to go back to page 1 (e.g. when a search changes).
 */
export function usePaged(list, initialSize = 10) {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(initialSize);
  const total = (list || []).length;
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(page, pages);

  // stay on a real page when rows are removed (e.g. after a delete or save)
  useEffect(() => { if (page > pages) setPage(pages); }, [page, pages]);

  return {
    rows: pageOf(list || [], current, size),
    offset: (current - 1) * size,
    reset: () => setPage(1),
    pager: total > 0 ? (
      <Pagination page={current} size={size} total={total} onPage={setPage} onSize={(n) => { setSize(n); setPage(1); }} />
    ) : null,
  };
}

export function EmptyRow({ cols, children }) {
  return <tr><td colSpan={cols} className="empty">{children}</td></tr>;
}
