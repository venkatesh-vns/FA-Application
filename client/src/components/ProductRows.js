import React, { useEffect, useRef, useState } from 'react';
import { formatMoney } from '../utils/format';

// Product rows of the Qty Plotting and Edit FA modals (buildProductRowHtml,
// calculateFromQtyOrPrice, calculateFromProductAmount, refreshProductTotals,
// removeProductRow, collectProducts). Rows hold the typed strings.
//
// Keyboard: Tab moves to the next column (the Remove button is skipped);
// Enter moves to the same column of the next row, adding a row at the end.
// Arrow keys move between fields: Up / Down to the same column of the row
// above / below; Left / Right to the previous / next field once the cursor is
// at the start / end of the text (from the last column to the next row).
// In Product, Up / Down keep choosing suggestions while a partly typed name
// is shown. Number fields are text boxes so the arrows do not change values.
//
// The rows scroll inside their own area (header and Total stay in view). A
// newly added row is scrolled to, highlighted for a moment and focused.

const LAST_COL = 5;
// numbers only: digits and one decimal point
const numeric = (v) => {
  const clean = String(v).replace(/[^0-9.]/g, '');
  const i = clean.indexOf('.');
  return i < 0 ? clean : clean.slice(0, i + 1) + clean.slice(i + 1).replace(/\./g, '');
};

// A new row starts as Taggable, or as the row above it (pass its value)
export const blankRow = (taggable = 'Taggable') => ({ product: '', quantity: '', taggable, unitPrice: '', productAmount: '', gstPercent: '' });

// Taggable value for the next added row: the same as the last row
export const nextTaggable = (rows) => rows[rows.length - 1]?.taggable || 'Taggable';

// Saved products -> editable rows
export const rowsFromProducts = (products) => (products || []).map((p) => ({
  product: p.product || '',
  quantity: p.quantity ?? '',
  taggable: p.taggable || 'Taggable', // the list has no blank choice any more
  unitPrice: p.unitPrice ?? '',
  productAmount: p.productAmount ?? '',
  gstPercent: p.gstPercent ?? '',
}));

export const rowsTotal = (rows) => rows.reduce((s, r) => s + (Number(r.productAmount) || 0), 0);

/**
 * collectProducts: checks every row and returns the products to save.
 * Throws an Error whose message names the row ("... in row 2.").
 */
export function collectProducts(rows) {
  if (!rows.length) throw new Error('At least one product is required.');
  return rows.map((r, i) => {
    const n = i + 1;
    const product = String(r.product || '').trim();
    const quantity = Number(r.quantity) || 0;
    const unitPrice = Number(r.unitPrice) || 0;
    const productAmount = Number(r.productAmount) || 0;
    const gstRaw = String(r.gstPercent ?? '').trim();
    const gstPercent = gstRaw === '' ? 0 : Number(gstRaw);
    if (!product) throw new Error(`Product / Asset Description is required in row ${n}.`);
    if (quantity <= 0) throw new Error(`Quantity must be greater than zero in row ${n}.`);
    if (r.taggable !== 'Taggable' && r.taggable !== 'Non Taggable') throw new Error(`Please select Taggable or Non Taggable in row ${n}.`);
    if (productAmount < 0) throw new Error(`Product Amount cannot be negative in row ${n}.`);
    if (Number.isNaN(gstPercent) || gstPercent < 0 || gstPercent > 100) throw new Error(`GST % must be between 0 and 100 in row ${n}.`);
    return { product, quantity, taggable: r.taggable, unitPrice: quantity > 0 ? productAmount / quantity : unitPrice, productAmount, gstPercent };
  });
}

// Row number named in a validation message (highlightInvalidRow)
export const invalidRowOf = (message) => {
  const m = /row (\d+)/i.exec(message || '');
  return m ? Number(m[1]) - 1 : -1;
};

export default function ProductRows({ rows, onChange, invalidRow = -1, onError, products = [], listId = 'productNameList' }) {
  const set = (i, patch) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const qtyOrPrice = (i, field, value) => {
    const next = { ...rows[i], [field]: value };
    // Recalculate only when both are entered, so typing a quantity first
    // does not put 0.00 in front of the amount the user types next
    if (String(next.quantity).trim() !== '' && String(next.unitPrice).trim() !== '') {
      next.productAmount = ((Number(next.quantity) || 0) * (Number(next.unitPrice) || 0)).toFixed(2);
    }
    set(i, next);
  };

  const amount = (i, value) => {
    const qty = Number(rows[i].quantity) || 0;
    const a = Number(value) || 0;
    set(i, { productAmount: value, unitPrice: qty > 0 ? (a / qty).toFixed(2) : '' });
  };

  // Enter: same column, next row (a new row is added after the last one)
  const tableRef = useRef(null);
  const pendingFocus = useRef(null);
  const focusCell = (row, col) => {
    const el = tableRef.current?.querySelector(`[data-cell="${row}-${col}"]`);
    if (el) {
      el.focus({ preventScroll: true });
      el.closest('tr')?.scrollIntoView({ block: 'nearest' });
      if (el.select && el.tagName === 'INPUT') el.select();
    }
    return Boolean(el);
  };
  // a row was added (Enter or + Add Product): show it, mark it, focus it
  const scrollRef = useRef(null);
  const prevCount = useRef(rows.length);
  const [fresh, setFresh] = useState(-1);
  useEffect(() => {
    const added = rows.length > prevCount.current;
    prevCount.current = rows.length;
    if (!added) return undefined;
    const target = pendingFocus.current || { row: rows.length - 1, col: 0 };
    pendingFocus.current = null;
    const tr = scrollRef.current?.querySelector(`tr[data-row="${target.row}"]`);
    if (tr) tr.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    focusCell(target.row, target.col);
    setFresh(target.row);
    const timer = setTimeout(() => setFresh(-1), 1600);
    return () => clearTimeout(timer);
  }, [rows.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // Up / Down in Product: move rows unless suggestions for a partly typed name are in use
  const productNames = new Set(products.map((p) => String(p).toLowerCase()));
  const productChoosing = (el) => el.value.trim() !== '' && !productNames.has(el.value.trim().toLowerCase());

  const onKeyDown = (e) => {
    const cell = e.target.getAttribute && e.target.getAttribute('data-cell');
    if (!cell) return;
    const [row, col] = cell.split('-').map(Number);

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (row + 1 < rows.length) { focusCell(row + 1, col); return; }
      pendingFocus.current = { row: row + 1, col };
      onChange([...rows, blankRow(rows[row].taggable || 'Taggable')]);
      return;
    }

    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const el = e.target;
    const isText = el.tagName === 'INPUT';
    let target = null;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (col === 0 && productChoosing(el)) return;
      const r = row + (e.key === 'ArrowDown' ? 1 : -1);
      if (r >= 0 && r < rows.length) target = [r, col];
    } else {
      // Left / Right: only from the edge of the text (or a whole selection)
      if (isText) {
        const start = el.selectionStart ?? 0;
        const end = el.selectionEnd ?? 0;
        const all = start === 0 && end === el.value.length;
        if (!all && e.key === 'ArrowLeft' && (start !== 0 || end !== 0)) return;
        if (!all && e.key === 'ArrowRight' && (start !== el.value.length || end !== el.value.length)) return;
      }
      if (e.key === 'ArrowRight') target = col < LAST_COL ? [row, col + 1] : row + 1 < rows.length ? [row + 1, 0] : null;
      else target = col > 0 ? [row, col - 1] : row > 0 ? [row - 1, LAST_COL] : null;
    }
    // the Taggable list keeps its own arrow handling out of the way
    if (target || el.tagName === 'SELECT') e.preventDefault();
    if (target) focusCell(target[0], target[1]);
  };

  const remove = (i) => {
    if (rows.length <= 1) { onError?.('At least one product row is required.'); return; }
    onChange(rows.filter((_, j) => j !== i));
  };

  return (
    <div className="product-rows" ref={tableRef} onKeyDown={onKeyDown}>
      <datalist id={listId}>{products.map((p) => <option key={p} value={p} />)}</datalist>
      <div className="product-rows-bar">
        <span><strong>{rows.length}</strong> product row{rows.length === 1 ? '' : 's'}</span>
        {rows.length > 5 && <span className="muted">Scroll inside the table to see every row</span>}
      </div>
      <div className="table-wrapper product-scroll" ref={scrollRef}>
      <table className="product-table">
        <thead>
          <tr><th>#</th><th>Product / Asset Description</th><th>Quantity</th><th>Taggable</th><th>Unit Price</th><th>Product Amount</th><th>GST %</th><th>Action</th></tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} data-row={i} className={[i === invalidRow ? 'row-invalid' : '', i === fresh ? 'row-new' : ''].join(' ').trim() || undefined}>
              <td>{i + 1}</td>
              <td><input className="form-control product-desc" data-cell={`${i}-0`} list={listId} placeholder="Type or select Product / Asset Description" value={r.product} onChange={(e) => set(i, { product: e.target.value })} aria-label={`Product row ${i + 1}`} /></td>
              <td><input className="form-control num-input" data-cell={`${i}-1`} inputMode="decimal" autoComplete="off" value={r.quantity} onChange={(e) => qtyOrPrice(i, 'quantity', numeric(e.target.value))} aria-label={`Quantity row ${i + 1}`} /></td>
              <td>
                <select className="form-control" data-cell={`${i}-2`} value={r.taggable} onChange={(e) => set(i, { taggable: e.target.value })} aria-label={`Taggable row ${i + 1}`}>
                  <option value="Taggable">Taggable</option><option value="Non Taggable">Non Taggable</option>
                </select>
              </td>
              <td><input className="form-control num-input" data-cell={`${i}-3`} inputMode="decimal" autoComplete="off" value={r.unitPrice} onChange={(e) => qtyOrPrice(i, 'unitPrice', numeric(e.target.value))} aria-label={`Unit Price row ${i + 1}`} /></td>
              <td><input className="form-control num-input" data-cell={`${i}-4`} inputMode="decimal" autoComplete="off" value={r.productAmount} onChange={(e) => amount(i, numeric(e.target.value))} aria-label={`Product Amount row ${i + 1}`} /></td>
              <td><input className="form-control num-input" data-cell={`${i}-5`} inputMode="decimal" autoComplete="off" placeholder="0" value={r.gstPercent} onChange={(e) => set(i, { gstPercent: numeric(e.target.value) })} aria-label={`GST row ${i + 1}`} /></td>
              <td><button type="button" className="btn btn-danger btn-sm" tabIndex={-1} onClick={() => remove(i)}>Remove</button></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td colSpan={5} className="text-right"><strong>Total</strong></td><td><strong>{formatMoney(rowsTotal(rows))}</strong></td><td colSpan={2} /></tr>
        </tfoot>
      </table>
      </div>
      <div className="key-hint">
        <kbd>↑</kbd><kbd>↓</kbd> row above / below · <kbd>←</kbd><kbd>→</kbd> previous / next field · <kbd>Tab</kbd> next field · <kbd>Enter</kbd> next row (adds one at the end) · Taggable: type <kbd>T</kbd> or <kbd>N</kbd>
      </div>
    </div>
  );
}

// Invoice amount / plotted amount / difference boxes (green when matched)
export function TotalSummary({ label, amount, rows }) {
  const total = rowsTotal(rows);
  const diff = (Number(amount) || 0) - total;
  const ok = Math.abs(diff) <= 0.01;
  return (
    <div className="qty-total-summary">
      <div className="qty-summary-box"><span>{label}</span><strong>{formatMoney(amount)}</strong></div>
      <div className="qty-summary-box"><span>Plotted Product Amount</span><strong>{formatMoney(total)}</strong></div>
      <div className={`qty-summary-box ${ok ? 'diff-ok' : 'diff-bad'}`}><span>Difference</span><strong>{formatMoney(diff)}</strong></div>
    </div>
  );
}
