import React, { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Drop-down with tick boxes. `value` is an array of the chosen options;
 * an empty array means "all". Includes a search box (for long lists),
 * Select all / Clear, and closes on Escape or a click outside.
 *   options   string[]
 *   allLabel  text shown when nothing is chosen, e.g. "All cost centers"
 *   noun      plural used in the summary, e.g. "cost centers"
 */
export default function MultiSelect({ id, options = [], value = [], onChange, allLabel = 'All', noun = 'selected', labelOf = (o) => o }) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const root = useRef(null);
  const search = useRef(null);
  const chosen = useMemo(() => new Set(value), [value]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (root.current && !root.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    setTimeout(() => search.current?.focus(), 0);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  const shown = useMemo(() => {
    const t = term.trim().toLowerCase();
    return t ? options.filter((o) => labelOf(o).toLowerCase().includes(t)) : options;
  }, [options, term, labelOf]);

  const toggle = (o) => onChange(chosen.has(o) ? value.filter((v) => v !== o) : [...value, o]);
  const summary = !value.length ? allLabel
    : value.length === 1 ? labelOf(value[0])
      : `${value.length} ${noun} selected`;

  return (
    <div className={`multi-select${open ? ' open' : ''}`} ref={root}>
      <button id={id} type="button" className="form-control multi-select-toggle" aria-haspopup="listbox" aria-expanded={open}
        onClick={() => setOpen(!open)} title={value.map(labelOf).join(', ') || allLabel}>
        <span className="multi-select-summary">{summary}</span>
        {value.length > 1 && <span className="multi-select-count">{value.length}</span>}
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="multi-select-panel" role="listbox" aria-multiselectable="true">
          {options.length > 7 && (
            <input ref={search} className="form-control multi-select-search" placeholder="Type to search..." value={term} onChange={(e) => setTerm(e.target.value)} />
          )}
          <div className="multi-select-actions">
            <button type="button" onClick={() => onChange([...new Set([...value, ...shown])])}>Select {term ? 'shown' : 'all'}</button>
            <button type="button" onClick={() => onChange(term ? value.filter((v) => !shown.includes(v)) : [])}>Clear</button>
          </div>
          <div className="multi-select-list">
            {shown.map((o) => (
              <label key={o} className={chosen.has(o) ? 'checked' : undefined}>
                <input type="checkbox" checked={chosen.has(o)} onChange={() => toggle(o)} />
                <span>{labelOf(o)}</span>
              </label>
            ))}
            {!shown.length && <div className="multi-select-empty">No match</div>}
          </div>
        </div>
      )}
    </div>
  );
}
