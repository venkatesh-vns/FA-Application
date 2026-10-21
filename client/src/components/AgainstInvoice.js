import React, { useEffect, useRef, useState } from 'react';
import { call, errorMessage } from '../services/api';
import { formatMoney } from '../utils/format';

// "Nov/Inv/40(Reversal)" -> "Nov/Inv/40": a likely original invoice number
export function originalInvoiceGuess(invNo) {
  return String(invNo || '')
    .replace(/[\s\-_/]*\(?\s*(credit\s*note|reversal|reversed|rev|cn)\s*\)?\s*$/i, '')
    .trim();
}

const productSummary = (products) => {
  if (!products.length) return 'Qty Plotting pending';
  const names = products.slice(0, 3).map((p) => `${p.product}${p.quantity !== 1 ? ` × ${p.quantity}` : ''}`);
  return names.join(' · ') + (products.length > 3 ? ` · +${products.length - 3} more` : '');
};

/**
 * Against Invoice No / Against Asset Code of a credit note or reversal.
 * Typing the invoice number lists the matching original invoices of any month
 * (FA Code, date, vendor, expense head, amount, products, already reversed);
 * the ones whose amount equals this credit note come first. Selecting one
 * fills both fields: Against Asset Code is the original record's FA Code.
 * Both fields can still be typed by hand.
 */
export default function AgainstInvoice({ record, invoiceNo, assetCode, onChange, idPrefix = 'ag' }) {
  const guess = originalInvoiceGuess(record.invNo);
  const [query, setQuery] = useState(invoiceNo || guess);
  const [result, setResult] = useState({ records: [], more: false });
  const [state, setState] = useState('idle'); // idle | loading | done | error
  const [error, setError] = useState('');
  const [open, setOpen] = useState(!assetCode);
  const seq = useRef(0);
  const credit = Math.abs(Number(record.amount) || 0);

  // search as the user types (short pause first)
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResult({ records: [], more: false }); setState('idle'); return undefined; }
    const mine = ++seq.current;
    setState('loading');
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q, amount: String(record.amount), exclude: record.faCode, expenseHead: record.expenseHead || '' });
        const r = await call('get', `/fa/original-invoices?${params}`);
        if (mine === seq.current) { setResult(r); setState('done'); }
      } catch (err) {
        if (mine === seq.current) { setError(errorMessage(err)); setState('error'); }
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, record.amount, record.faCode, record.expenseHead]);

  const selected = result.records.find((r) => r.faCode === assetCode);

  const typeInvoice = (value) => {
    setQuery(value);
    setOpen(true);
    onChange({ againstInvoiceNo: value, againstAssetCode: selected ? '' : assetCode });
  };

  const pick = (r) => {
    onChange({ againstInvoiceNo: r.invNo, againstAssetCode: r.faCode });
    setQuery(r.invNo);
    setOpen(false);
  };

  const showList = open && query.trim().length >= 2;

  return (
    <div className="against">
      <div className="grid grid-2">
        <div className="field">
          <label htmlFor={`${idPrefix}Inv`}>Against Invoice No</label>
          <input id={`${idPrefix}Inv`} className="form-control" placeholder="Type the original invoice number" autoComplete="off"
            value={invoiceNo} onChange={(e) => typeInvoice(e.target.value)} onFocus={() => setOpen(true)} />
        </div>
        <div className="field">
          <label htmlFor={`${idPrefix}Asset`}>Against Asset Code <span className="against-hint">(FA Code of the original invoice)</span></label>
          <input id={`${idPrefix}Asset`} className="form-control" placeholder="Select an invoice below, or type" autoComplete="off"
            value={assetCode} onChange={(e) => onChange({ againstInvoiceNo: invoiceNo, againstAssetCode: e.target.value })} />
        </div>
      </div>

      {!invoiceNo && guess && guess !== query && (
        <button type="button" className="against-guess" onClick={() => typeInvoice(guess)}>Search original invoice <strong>{guess}</strong></button>
      )}

      {selected && !open && (
        <div className="against-selected">
          <div>
            <span className="against-tag ok">Selected</span>
            <strong>{selected.faCode}</strong> · {selected.invNo} · {selected.date} · {selected.vendor} · {selected.expenseHead} · <strong>{formatMoney(selected.amount)}</strong>
          </div>
          <button type="button" className="btn btn-light btn-sm" onClick={() => setOpen(true)}>Change</button>
        </div>
      )}

      {showList && (
        <div className="against-panel">
          <div className="against-panel-head">
            <span>
              {state === 'loading' && 'Searching invoices…'}
              {state === 'error' && error}
              {state === 'done' && (result.records.length
                ? <>Original invoices matching <strong>“{query.trim()}”</strong> — all months{result.more ? ' (first 20; type more to narrow)' : ''}. Select the one being reversed.</>
                : <>No invoice found matching <strong>“{query.trim()}”</strong>. Check the number, or type the Against Asset Code by hand.</>)}
            </span>
            {selected && <button type="button" className="btn btn-light btn-sm" onClick={() => setOpen(false)}>Hide</button>}
          </div>
          {result.records.length > 0 && (
            <ul className="against-list">
              {result.records.map((r) => {
                const over = credit > r.balance + 0.01;
                const isSel = r.faCode === assetCode;
                const best = r.amountMatches && r.sameHead;
                return (
                  <li key={r.faCode} className={`against-item${r.amountMatches ? ' match' : ''}${best ? ' best' : ''}${isSel ? ' selected' : ''}`}>
                    <div className="against-main">
                      <div className="against-line1">
                        <strong className="against-code">{r.faCode}</strong>
                        <span>{r.invNo}</span>
                        <span className="muted">{r.date}</span>
                        {r.amountMatches && <span className="against-tag ok">Amount matches</span>}
                        {r.sameHead && <span className="against-tag ok">Same expense head</span>}
                        {r.status === 'Pending' && <span className="against-tag">Qty pending</span>}
                      </div>
                      <div className="against-line2">{r.vendor} · {r.expenseHead} · {r.costCenter}</div>
                      <div className="against-line3">{productSummary(r.products)}</div>
                    </div>
                    <div className="against-amounts">
                      <strong>{formatMoney(r.amount)}</strong>
                      {r.reversed > 0 && <span className="muted">Reversed {formatMoney(r.reversed)} · Balance {formatMoney(r.balance)}</span>}
                      {over && <span className="against-warn">More than the remaining amount</span>}
                    </div>
                    <button type="button" className={`btn btn-sm ${isSel ? 'btn-success' : 'btn-primary'}`} onClick={() => pick(r)}>{isSel ? 'Selected' : 'Select'}</button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
