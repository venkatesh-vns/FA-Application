import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { call } from '../services/api';
import { Icon } from '../components/Layout';
import MultiSelect from '../components/MultiSelect';
import { Alert, EmptyRow, Pagination, pageOf } from '../components/ui';
import { dateRangeText, formatMoney, formatNumber } from '../utils/format';

const NO_FILTER = { costCenters: [], from: '', to: '' };
const ddmm = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

const TYPES = ['Taggable', 'Non-Taggable', 'Unclassified'];

// Index.html Dashboard: totals, building-wise and ledger-wise summaries,
// product breakdown of the selected ledger
export default function Dashboard() {
  const [data, setData] = useState(null);
  const [filters, setFilters] = useState(NO_FILTER);
  const [refreshed, setRefreshed] = useState('');
  const [error, setError] = useState('');
  const [types, setTypes] = useState([]); // Asset Types; empty = all
  const [size, setSize] = useState(10);
  const [pages, setPages] = useState({ building: 1, ledger: 1, products: 1 });
  const [selected, setSelected] = useState(null);

  // Totals and summaries for the chosen Cost Center / invoice date range
  const query = (() => {
    const q = new URLSearchParams();
    filters.costCenters.forEach((c) => q.append('costCenter', c)); // repeated: names may contain commas
    if (filters.from) q.append('from', filters.from);
    if (filters.to) q.append('to', filters.to);
    return q.toString();
  })();
  const load = useCallback(async () => {
    try {
      const d = await call('get', `/dashboard${query ? `?${query}` : ''}`);
      setData(d);
      setRefreshed(new Date().toLocaleString());
      setSelected(null);
      setPages({ building: 1, ledger: 1, products: 1 });
      setError('');
    } catch (err) {
      setError('Unable to load dashboard data. Please refresh.');
    }
  }, [query]);

  useEffect(() => { load(); }, [load]);

  const buildings = useMemo(() => (data?.buildingSummary || []).filter((b) => !types.length || types.includes(b.type)), [data, types]);
  const ledgers = useMemo(() => (data?.ledgerSummary || []).filter((l) => !types.length || types.includes(l.type)), [data, types]);
  const filterActive = Boolean(filters.costCenters.length || filters.from || filters.to || types.length);
  const setFilter = (patch) => setFilters({ ...filters, ...patch });
  const clearAll = () => { setFilters(NO_FILTER); setTypes([]); };
  const listText = (list, noun) => (list.length <= 3 ? list.join(', ') : `${list.length} ${noun}`);
  const showing = [
    filters.costCenters.length ? `Cost Center: ${listText(filters.costCenters, 'cost centers')}` : 'All cost centers',
    filters.from || filters.to ? `invoice date ${filters.from ? ddmm(filters.from) : 'start'} to ${filters.to ? ddmm(filters.to) : 'today'}` : 'all dates',
    types.length ? `${types.join(' + ')} assets` : null,
  ].filter(Boolean).join(' · ');
  const products = selected?.products || [];
  const setPage = (which) => (p) => setPages({ ...pages, [which]: p });

  return (
    <section className="page">
      {error && <Alert alert={{ type: 'error', message: error }} />}

      <div className="filter-panel-wrap dash-filter">
        <div className="filter-panel-head">
          <span className="filter-panel-icon"><Icon name="filter" size={16} /></span>
          <div>
            <strong>Filter dashboard</strong>
            <span className="muted">All cards and tables below show only the records that match. Fields you set turn blue.</span>
          </div>
        </div>
        <div className="filter-panel dash-filter-fields">
          <div className={`field${filters.costCenters.length ? ' is-set' : ''}`}>
            <label htmlFor="dfCc"><Icon name="building" size={13} />Cost Center <span className="label-hint">(choose one or more)</span></label>
            <MultiSelect id="dfCc" options={data?.costCenters || []} value={filters.costCenters} onChange={(v) => setFilter({ costCenters: v })}
              allLabel={`All cost centers (${(data?.costCenters || []).length})`} noun="cost centers" />
          </div>
          <div className={`field${filters.from ? ' is-set' : ''}`}>
            <label htmlFor="dfFrom"><Icon name="calendar" size={13} />Invoice date from</label>
            <input id="dfFrom" type="date" className="form-control" value={filters.from} max={filters.to || undefined} onChange={(e) => setFilter({ from: e.target.value })} />
          </div>
          <div className={`field${filters.to ? ' is-set' : ''}`}>
            <label htmlFor="dfTo"><Icon name="calendar" size={13} />Invoice date to</label>
            <input id="dfTo" type="date" className="form-control" value={filters.to} min={filters.from || undefined} onChange={(e) => setFilter({ to: e.target.value })} />
          </div>
          <div className={`field${types.length ? ' is-set' : ''}`}>
            <label htmlFor="dashTypeFilter"><Icon name="status" size={13} />Asset Type <span className="label-hint">(choose one or more)</span></label>
            <MultiSelect id="dashTypeFilter" options={TYPES} value={types} noun="types" allLabel="All asset types"
              onChange={(v) => { setTypes(v); setPages({ building: 1, ledger: 1, products: 1 }); }} />
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
            {filters.from && <button type="button" className="chip" onClick={() => setFilter({ from: '' })}>From: {ddmm(filters.from)}<span aria-hidden="true">×</span></button>}
            {filters.to && <button type="button" className="chip" onClick={() => setFilter({ to: '' })}>To: {ddmm(filters.to)}<span aria-hidden="true">×</span></button>}
            {types.map((t) => (
              <button key={t} type="button" className="chip" onClick={() => setTypes(types.filter((x) => x !== t))}>Asset Type: {t}<span aria-hidden="true">×</span></button>
            ))}
            <button type="button" className="chip chip-clear" onClick={clearAll}>Clear all</button>
          </div>
        )}
      </div>

      <div className={`filter-result${filterActive ? ' active' : ''}`}>
        <span>Showing: <strong>{showing}</strong></span>
        <span className="muted">Invoice dates in view: {data?.dateRange?.fromDate ? `${data.dateRange.fromDate} – ${data.dateRange.toDate}` : 'none'}</span>
      </div>

      <div className="grid grid-4">
        <div className="stat-card"><div className="stat-label">Total FA</div><div className="stat-value">{data?.totalFA ?? 0}</div></div>
        <div className="stat-card"><div className="stat-label">Pending</div><div className="stat-value">{data?.pendingFA ?? 0}</div></div>
        <div className="stat-card"><div className="stat-label">Completed</div><div className="stat-value">{data?.completedFA ?? 0}</div></div>
        <div className="stat-card"><div className="stat-label">Total Amount</div><div className="stat-value">{formatMoney(data?.totalAmount)}</div></div>
      </div>

      <div className="card" style={{ marginTop: 22 }}>
        <h3 className="card-title">Qty Plotting Summary</h3>
        <div className="grid grid-2">
          <div>
            <div className="muted">Total Product Amount Plotted</div>
            <div style={{ fontSize: 26, fontWeight: 'bold', marginTop: 7 }}>{formatMoney(data?.plottedAmount)}</div>
          </div>
          <div>
            <div className="muted">Last Refresh</div>
            <div style={{ fontSize: 15, fontWeight: 'bold', marginTop: 7 }}>{refreshed || '-'}</div>
            <div className="muted" style={{ marginTop: 8 }}>{dateRangeText(data?.dateRange)}</div>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 className="card-title">Building-wise Asset Summary</h3>
        <p className="muted" style={{ marginTop: -8, marginBottom: 14 }}>Current active Qty Plotting records only. Building is mapped from Branch Master using Cost Center.</p>
        <div className="table-wrapper">
          <table>
            <thead><tr><th>Building / Branch</th><th>Cost Center</th><th>Asset Type</th><th className="num">Quantity</th><th className="num">Ledger Amount</th><th className="num">FA Records</th></tr></thead>
            <tbody>
              {pageOf(buildings, pages.building, size).map((b) => (
                <tr key={`${b.building}|${b.costCenter}|${b.type}`}>
                  <td>{b.building}</td><td>{b.costCenter}</td><td>{b.type}</td>
                  <td className="num">{formatNumber(b.quantity)}</td><td className="num">{formatMoney(b.amount)}</td><td className="num">{formatNumber(b.faCount)}</td>
                </tr>
              ))}
              {!buildings.length && <EmptyRow cols={6}>{data ? 'No active building-wise records found.' : 'Loading...'}</EmptyRow>}
            </tbody>
          </table>
        </div>
        <Pagination page={pages.building} size={size} total={buildings.length} onPage={setPage('building')} />
      </div>

      <div className="card">
        <h3 className="card-title">Ledger-wise Amount Summary</h3>
        <p className="muted" style={{ marginTop: -8, marginBottom: 14 }}>Select a ledger row to see its product-wise quantity and amount breakdown.</p>
        <div className="button-row" style={{ alignItems: 'end', marginBottom: 14 }}>
          <div className="field" style={{ minWidth: 180 }}>
            <label htmlFor="dashPageSize">Rows per page</label>
            <select id="dashPageSize" className="form-control" value={size} onChange={(e) => { setSize(Number(e.target.value)); setPages({ building: 1, ledger: 1, products: 1 }); }}>
              {[10, 25, 50, 100, 200, 500].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>
        <div className="table-wrapper">
          <table>
            <thead><tr><th>Cost Center</th><th>Ledger / Expense Head</th><th>Asset Type</th><th className="num">Quantity</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {pageOf(ledgers, pages.ledger, size).map((l) => (
                <tr key={`${l.costCenter}|${l.type}|${l.ledger}`} className={`clickable-row${selected === l ? ' selected' : ''}`} onClick={() => { setSelected(l); setPages({ ...pages, products: 1 }); }}>
                  <td>{l.costCenter}</td><td>{l.ledger}</td><td>{l.type}</td><td className="num">{formatNumber(l.quantity)}</td><td className="num">{formatMoney(l.amount)}</td>
                </tr>
              ))}
              {!ledgers.length && <EmptyRow cols={5}>{data ? 'No active ledger records found.' : 'Loading...'}</EmptyRow>}
            </tbody>
          </table>
        </div>
        <Pagination page={pages.ledger} size={size} total={ledgers.length} onPage={setPage('ledger')} />

        <h4 style={{ marginTop: 20 }}>
          {selected ? `Product-wise Breakdown — ${selected.costCenter} — ${selected.ledger} (${selected.type})` : 'Product-wise Breakdown'}
        </h4>
        <div className="table-wrapper">
          <table>
            <thead><tr><th>Product</th><th className="num">Quantity</th><th className="num">Product Amount</th></tr></thead>
            <tbody>
              {pageOf(products, pages.products, size).map((p) => (
                <tr key={p.product}><td>{p.product}</td><td className="num">{formatNumber(p.quantity)}</td><td className="num">{formatMoney(p.amount)}</td></tr>
              ))}
              {!products.length && <EmptyRow cols={3}>Click a ledger to view its products.</EmptyRow>}
            </tbody>
          </table>
        </div>
        <Pagination page={pages.products} size={size} total={products.length} onPage={setPage('products')} />
      </div>

    </section>
  );
}
