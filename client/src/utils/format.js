// formatMoney / formatNumber / convertDisplayDateToInput from Index.html

export function formatMoney(value) {
  return (Number(value) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatNumber(value) {
  return (Number(value) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

// 'DD/MM/YYYY' -> 'YYYY-MM-DD' for <input type="date">
export function displayDateToInput(value) {
  const m = String(value || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : String(value || '');
}

// Today as 'YYYY-MM-DD' in local time
export function todayInput() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const dateRangeText = (r) => `From Date: ${r?.fromDate || '-'}   To Date: ${r?.toDate || '-'}`;
