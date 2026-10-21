import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { call, download, errorMessage } from '../services/api';
import { useApp } from '../context/AppContext';
import { Icon } from '../components/Layout';
import MultiSelect from '../components/MultiSelect';
import { Alert, EmptyRow, Pagination, usePaged } from '../components/ui';
import { formatMoney, formatNumber, todayInput } from '../utils/format';
import { PERIOD_TYPES, ddmmyyyy, periodOptions } from '../utils/periods';

const EXPORTS = [
  { type: 'summary', title: 'Summary Report', text: 'Totals with Month, Quarter, Financial Year, Expense Head, Cost Center and Product-wise sheets', icon: 'dashboard' },
  { type: 'detail', title: 'FA Data (detailed)', text: 'Every record of the period, one row per product — same columns as FA Data › Export', icon: 'fa' },
  { type: 'fams', title: 'FAMS Template', text: 'FAMS upload file for the period, with Error Remark checks', icon: 'fams' },
  { type: 'complete', title: 'Complete Workbook', text: 'All of the above in one Excel file', icon: 'download' },
];

const VIEWS = [
  { id: 'months', label: 'Month-wise' },
  { id: 'quarters', label: 'Quarter-wise' },
  { id: 'years', label: 'Financial Year-wise' },
  { id: 'expenseHeads', label: 'Expense Head' },
  { id: 'costCenters', label: 'Cost Center' },
  { id: 'products', label: 'Products' },
  { id: 'records', label: 'Records' },
];

// Columns shared by the period / expense head / cost center tables
const NUM_HEAD = (
  <>
    <th className="num">Records</th><th className="num">Amount</th><th className="num">Qty Plotted</th>
    <th className="num">Completed</th><th className="num">Pending</th><th className="num">Credit Notes</th>
  </>
);
const numCells = (g) => (
  <>
    <td className="num">{formatNumber(g.records)}</td><td className="num">{formatMoney(g.amount)}</td><td className="num">{formatMoney(g.plotted)}</td>
    <td className="num">{formatNumber(g.completed)}</td>
    <td className="num">{g.pending ? <span className="badge badge-pending">{formatNumber(g.pending)}</span> : 0}</td>
    <td className="num">{g.creditNotes ? `${g.creditNotes} · ${formatMoney(g.creditAmount)}` : '-'}</td>
  </>
);

/**
 * Period Reports: choose a month, quarter, financial year, calendar year or
 * dates (and cost centers), view the data grouped several ways, and export it.
 */
export default function Reports() {
  const { withLoading, isAdmin } = useApp();
  // Users see one Tally month at a time; quarters, years, dates and all data are Admin only
  const types = isAdmin ? PERIOD_TYPES : PERIOD_TYPES.filter((p) => p.id === 'month');
  const [range, setRange] = useState(null);       // { from, to } of all data, YYYY-MM-DD
  const [type, setType] = useState(isAdmin ? 'fy' : 'month');
  const [value, setValue] = useState('');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [costCenters, setCostCenters] = useState([]);
  const [report, setReport] = useState(null);
  const [view, setView] = useState('months');
  const [search, setSearch] = useState('');
  const [alert, setAlert] = useState(null);
  const [loading, setLoading] = useState(false);

  // data range for the period lists (up to today, so the current month is offered)
  useEffect(() => {
    call('get', '/reports/period?probe=1&from=2999-01-01').then((r) => {
      const today = todayInput();
      const to = r.dataRange.to && r.dataRange.to > today ? r.dataRange.to : today;
      setRange({ from: r.dataRange.from || today, to });
    }).catch((err) => setAlert({ type: 'error', message: errorMessage(err) }));
  }, []);

  const options = useMemo(() => (range ? periodOptions(type, range.from, range.to) : []), [type, range]);

  // newest period of the type by default
  useEffect(() => {
    if (options.length && !options.some((o) => o.value === value)) setValue(options[0].value);
  }, [options, value]);

  const chosen = options.find((o) => o.value === value);
  const period = (() => {
    if (type === 'all') return { from: '', to: '', label: 'All data' };
    if (type === 'custom') {
      if (!custom.from && !custom.to) return null;
      return { from: custom.from, to: custom.to, label: `${custom.from ? ddmmyyyy(custom.from) : 'Start'} to ${custom.to ? ddmmyyyy(custom.to) : 'Today'}` };
    }
    return chosen ? { from: chosen.from, to: chosen.to, label: chosen.short || chosen.label } : null;
  })();

  const query = useMemo(() => {
    if (!period) return null;
    const q = new URLSearchParams();
    // Month / Quarter / Year: by Tally booking month; Custom Dates: by invoice date
    const key = type === 'custom' ? ['from', 'to'] : ['fromMonth', 'toMonth'];
    const cut = (v) => (type === 'custom' ? v : v.slice(0, 7));
    if (period.from) q.append(key[0], cut(period.from));
    if (period.to) q.append(key[1], cut(period.to));
    costCenters.forEach((c) => q.append('costCenter', c));
    return q.toString();
  }, [type, period?.from, period?.to, costCenters]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    if (query === null) return;
    setLoading(true);
    try {
      setReport(await call('get', `/reports/period?${query}`));
      setAlert(null);
    } catch (err) {
      setAlert({ type: 'error', message: errorMessage(err) });
    } finally {
      setLoading(false);
    }
  }, [query]);
  useEffect(() => { load(); }, [load]);

  const exportFile = (kind) => withLoading(`Preparing ${kind.title}...`, async () => {
    try {
      const label = `${period.label}${costCenters.length ? ` ${costCenters.length === 1 ? costCenters[0] : `${costCenters.length} cost centers`}` : ''}`;
      const n = await download(`/reports/period/export?type=${kind.type}&${query}&label=${encodeURIComponent(label)}`, `${kind.type}.xlsx`);
      setAlert({ type: 'success', message: `${kind.title} for ${period.label} downloaded (${formatNumber(n)} rows).` });
    } catch (err) {
      setAlert({ type: 'error', message: errorMessage(err) });
    }
  });

  // click a month / quarter / year row to open that period
  const openPeriod = (t, v) => { if (!isAdmin && t !== 'month') return; setType(t); setValue(v); setView(t === 'month' ? 'expenseHeads' : 'months'); };

  // Records tab: one page at a time from the server (a year is 100,000+ records)
  const [rec, setRec] = useState({ rows: [], total: 0, loading: false });
  const [recPage, setRecPage] = useState({ page: 1, size: 10 });
  const [term, setTerm] = useState('');
  useEffect(() => { const timer = setTimeout(() => setTerm(search.trim()), 300); return () => clearTimeout(timer); }, [search]);
  useEffect(() => { setRecPage((p) => ({ ...p, page: 1 })); }, [query, term]);
  useEffect(() => {
    if (view !== 'records' || query === null) return undefined;
    let alive = true;
    setRec((r) => ({ ...r, loading: true }));
    const q = `${query}&page=${recPage.page}&size=${recPage.size}${term ? `&search=${encodeURIComponent(term)}` : ''}`;
    call('get', `/reports/period/records?${q}`)
      .then((r) => { if (alive) setRec({ rows: r.rows, total: r.total, loading: false }); })
      .catch((err) => { if (alive) { setRec((r) => ({ ...r, loading: false })); setAlert({ type: 'error', message: errorMessage(err) }); } });
    return () => { alive = false; };
  }, [view, query, term, recPage]);

  const listFor = { months: report?.months, quarters: report?.quarters, years: report?.years, expenseHeads: report?.expenseHeads, costCenters: report?.costCenters, products: report?.products };
  const counts = { ...Object.fromEntries(Object.entries(listFor).map(([k, v]) => [k, (v || []).length])), records: report?.recordCount || 0 };
  const paged = usePaged(listFor[view] || []);
  const { reset } = paged;
  useEffect(() => { reset(); }, [view, report]); // eslint-disable-line react-hooks/exhaustive-deps

  const t = report?.totals;
  const periodText = period ? `${period.label}${period.from || period.to ? ` · ${period.from ? ddmmyyyy(period.from) : 'start'} – ${period.to ? ddmmyyyy(period.to) : 'today'}` : ''}` : 'Choose dates';

  return (
    <section className="page">
      <div className="filter-panel-wrap">
        <div className="filter-panel-head">
          <span className="filter-panel-icon"><Icon name="calendar" size={16} /></span>
          <div>
            <strong>Choose a period</strong>
            <span className="muted">Records are taken by their <strong>Tally booking month</strong> (Custom Dates: by invoice date). Financial year runs April – March (Q1 Apr–Jun, Q2 Jul–Sep, Q3 Oct–Dec, Q4 Jan–Mar).{!isAdmin && ' Consolidated reports for several months are available to Admin.'}</span>
          </div>
        </div>
        <div className="period-types" role="tablist" aria-label="Period type">
          {types.map((p) => (
            <button key={p.id} type="button" role="tab" aria-selected={type === p.id} className={`period-type${type === p.id ? ' active' : ''}`} onClick={() => setType(p.id)}>{p.label}</button>
          ))}
        </div>
        <div className="filter-panel period-fields">
          {type === 'custom' ? (
            <>
              <div className={`field${custom.from ? ' is-set' : ''}`}>
                <label htmlFor="prFrom"><Icon name="calendar" size={13} />Invoice date from</label>
                <input id="prFrom" type="date" className="form-control" value={custom.from} max={custom.to || undefined} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
              </div>
              <div className={`field${custom.to ? ' is-set' : ''}`}>
                <label htmlFor="prTo"><Icon name="calendar" size={13} />Invoice date to</label>
                <input id="prTo" type="date" className="form-control" value={custom.to} min={custom.from || undefined} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
              </div>
            </>
          ) : type !== 'all' && (
            <div className="field is-set">
              <label htmlFor="prValue"><Icon name="calendar" size={13} />{PERIOD_TYPES.find((p) => p.id === type).label}</label>
              <select id="prValue" className="form-control" value={value} onChange={(e) => setValue(e.target.value)}>
                {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          )}
          <div className={`field${costCenters.length ? ' is-set' : ''}`}>
            <label htmlFor="prCc"><Icon name="building" size={13} />Cost Center <span className="label-hint">(choose one or more)</span></label>
            <MultiSelect id="prCc" options={report?.costCenterOptions || []} value={costCenters} onChange={setCostCenters}
              allLabel={`All cost centers (${(report?.costCenterOptions || []).length})`} noun="cost centers" />
          </div>
        </div>
      </div>

      <div className="filter-result active">
        <span>Period: <strong>{periodText}</strong>{costCenters.length ? <> · <strong>{costCenters.length === 1 ? costCenters[0] : `${costCenters.length} cost centers`}</strong></> : null}</span>
        <span className="muted">{loading ? 'Loading…' : t?.records ? `Invoice dates in data: ${t.fromDate} – ${t.toDate}` : 'No records in this period'}</span>
      </div>

      <Alert alert={alert} onClose={() => setAlert(null)} />

      <div className="grid grid-4">
        <div className="stat-card"><div className="stat-label">FA Records</div><div className="stat-value">{formatNumber(t?.records)}</div><div className="stat-sub">{formatNumber(t?.invoices)} invoices · {formatNumber(t?.vendors)} vendors</div></div>
        <div className="stat-card"><div className="stat-label">Pending Qty Plotting</div><div className="stat-value">{formatNumber(t?.pending)}</div><div className="stat-sub">{formatNumber(t?.completed)} completed</div></div>
        <div className="stat-card"><div className="stat-label">Total Amount</div><div className="stat-value">{formatMoney(t?.amount)}</div><div className="stat-sub">Plotted {formatMoney(t?.plotted)}</div></div>
        <div className="stat-card"><div className="stat-label">Credit Notes / Reversals</div><div className="stat-value">{formatNumber(t?.creditNotes)}</div><div className="stat-sub">{formatMoney(t?.creditAmount)}</div></div>
      </div>
      <div className="period-split">
        <span>Taggable <strong>{formatMoney(t?.taggable)}</strong></span>
        <span>Non Taggable <strong>{formatMoney(t?.nonTaggable)}</strong></span>
        <span>Total quantity <strong>{formatNumber(t?.quantity)}</strong></span>
      </div>

      <div className="card">
        <h3 className="card-title"><Icon name="download" size={17} /> Export {period ? period.label : ''}</h3>
        <div className="export-grid">
          {EXPORTS.map((x) => (
            <button key={x.type} type="button" className={`export-card${x.type === 'complete' ? ' primary' : ''}`} disabled={!period || !t?.records} onClick={() => exportFile(x)}>
              <span className="export-icon"><Icon name={x.icon} size={18} /></span>
              <span className="export-text"><strong>{x.title}</strong><span>{x.text}</span></span>
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="view-tabs" role="tablist" aria-label="View">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" role="tab" aria-selected={view === v.id} className={`view-tab${view === v.id ? ' active' : ''}`} onClick={() => setView(v.id)}>
              {v.label}<span className="view-count">{formatNumber(counts[v.id])}</span>
            </button>
          ))}
        </div>
        {['months', 'quarters', 'years'].includes(view) && <p className="muted" style={{ margin: '0 0 12px' }}>Click a row to open that period.</p>}
        {view === 'records' && (
          <div className="search-box" style={{ marginBottom: 12, maxWidth: 380 }}>
            <Icon name="search" size={15} />
            <input className="form-control" placeholder="Search FA Code, invoice, vendor, expense head…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        )}
        <div className="table-wrapper">
          <table>
            {view === 'months' && (
              <>
                <thead><tr><th>Month</th><th>Quarter</th><th>Financial Year</th>{NUM_HEAD}</tr></thead>
                <tbody>
                  {paged.rows.map((g) => <tr key={g.key} className="row-link" onClick={() => openPeriod('month', g.key)}><td><strong>{g.month}</strong></td><td>{g.quarter}</td><td>{g.fy}</td>{numCells(g)}</tr>)}
                  {!paged.rows.length && <EmptyRow cols={9}>No records in this period.</EmptyRow>}
                </tbody>
              </>
            )}
            {view === 'quarters' && (
              <>
                <thead><tr><th>Quarter</th><th>Financial Year</th>{NUM_HEAD}</tr></thead>
                <tbody>
                  {paged.rows.map((g) => <tr key={g.key} className="row-link" onClick={() => openPeriod('quarter', g.key)}><td><strong>{g.quarter}</strong></td><td>{g.fy}</td>{numCells(g)}</tr>)}
                  {!paged.rows.length && <EmptyRow cols={8}>No records in this period.</EmptyRow>}
                </tbody>
              </>
            )}
            {view === 'years' && (
              <>
                <thead><tr><th>Financial Year</th>{NUM_HEAD}</tr></thead>
                <tbody>
                  {paged.rows.map((g) => <tr key={g.key} className="row-link" onClick={() => openPeriod('fy', g.key)}><td><strong>{g.fy}</strong></td>{numCells(g)}</tr>)}
                  {!paged.rows.length && <EmptyRow cols={7}>No records in this period.</EmptyRow>}
                </tbody>
              </>
            )}
            {view === 'expenseHeads' && (
              <>
                <thead><tr><th>Expense Head</th>{NUM_HEAD}<th className="num">Taggable</th><th className="num">Non Taggable</th></tr></thead>
                <tbody>
                  {paged.rows.map((g) => <tr key={g.expenseHead}><td>{g.expenseHead}</td>{numCells(g)}<td className="num">{formatMoney(g.taggable)}</td><td className="num">{formatMoney(g.nonTaggable)}</td></tr>)}
                  {!paged.rows.length && <EmptyRow cols={9}>No records in this period.</EmptyRow>}
                </tbody>
              </>
            )}
            {view === 'costCenters' && (
              <>
                <thead><tr><th>Cost Center</th><th>Branch</th><th>Location</th>{NUM_HEAD}</tr></thead>
                <tbody>
                  {paged.rows.map((g) => <tr key={g.costCenter}><td>{g.costCenter}</td><td>{g.branch || <span className="muted">Not in Branch Master</span>}</td><td>{g.location}</td>{numCells(g)}</tr>)}
                  {!paged.rows.length && <EmptyRow cols={9}>No records in this period.</EmptyRow>}
                </tbody>
              </>
            )}
            {view === 'products' && (
              <>
                <thead><tr><th>Product / Asset Description</th><th>Taggable / Non Taggable</th><th className="num">Quantity</th><th className="num">Amount</th><th className="num">FA Records</th></tr></thead>
                <tbody>
                  {paged.rows.map((g) => <tr key={`${g.product}|${g.type}`}><td>{g.product}</td><td>{g.type}</td><td className="num">{formatNumber(g.quantity)}</td><td className="num">{formatMoney(g.amount)}</td><td className="num">{formatNumber(g.records)}</td></tr>)}
                  {!paged.rows.length && <EmptyRow cols={5}>No Qty Plotting in this period.</EmptyRow>}
                </tbody>
              </>
            )}
            {view === 'records' && (
              <>
                <thead><tr><th>FA Code</th><th>Inv No</th><th>Date</th><th>Cost Center</th><th>Vendor</th><th>Expense Head</th><th className="num">Amount</th><th className="num">Plotted</th><th>Status</th></tr></thead>
                <tbody>
                  {rec.rows.map((r) => (
                    <tr key={r.faCode}>
                      <td><strong>{r.faCode}</strong></td><td>{r.invNo}</td><td>{r.date}</td><td>{r.costCenter}</td><td>{r.vendor}</td><td>{r.expenseHead}</td>
                      <td className={`num${r.amount < 0 ? ' neg' : ''}`}>{formatMoney(r.amount)}</td><td className="num">{formatMoney(r.plotted)}</td>
                      <td><span className={`badge ${r.status === 'Completed' ? 'badge-completed' : 'badge-pending'}`}>{r.status}</span></td>
                    </tr>
                  ))}
                  {!rec.rows.length && <EmptyRow cols={9}>{rec.loading ? 'Loading...' : term ? 'No records match the search.' : 'No records in this period.'}</EmptyRow>}
                </tbody>
              </>
            )}
          </table>
        </div>
        {view === 'records'
          ? rec.total > 0 && <Pagination page={recPage.page} size={recPage.size} total={rec.total} onPage={(page) => setRecPage((p) => ({ ...p, page }))} onSize={(size) => setRecPage({ page: 1, size })} />
          : paged.pager}
      </div>
    </section>
  );
}
