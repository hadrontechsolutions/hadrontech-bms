/* ============================================================
   utils.js — shared helpers used across all modules
   ============================================================ */

/** Round to 2 decimal places safely (mitigates float drift for money math). */
function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

/** The full list of currencies in use — PHP is always first/implicit at rate 1,
    plus whatever currencies have been added in Settings → Currencies & Exchange Rates.
    This is the single source of truth used by Products, Customers, Suppliers, and
    Quotation line items, so adding a currency once in Settings makes it available everywhere. */
function currencyList(settings) {
  const extra = Object.keys((settings && settings.referenceRates) || {});
  return ['PHP', ...extra];
}

function formatMoney(n, currency) {
  const cur = currency || 'PHP';
  const symbol = cur === 'PHP' ? '₱' : (cur === 'USD' ? '$' : (cur === 'EUR' ? '€' : cur + ' '));
  return symbol + r2(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Formats a Date object as YYYY-MM-DD using its LOCAL date components — never round-trips
    through UTC (unlike toISOString), which is what caused todayISO()/addDaysISO() to be
    capable of returning "yesterday" during the early hours of each local day in any
    timezone ahead of UTC (e.g. the Philippines, UTC+8). This matters most for anything
    that compares dates for validity/expiry, where being off by a day is a real problem. */
function formatLocalISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayISO() { return formatLocalISO(new Date()); }

function addDaysISO(baseISO, days) {
  const d = baseISO ? new Date(baseISO + 'T00:00:00') : new Date();
  d.setDate(d.getDate() + Number(days || 0));
  return formatLocalISO(d);
}

/** Whole-day difference (b - a), both as YYYY-MM-DD, parsed as local dates so it can never
    be thrown off by timezone/DST — used for quotation validity/expiry calculations. */
function daysBetweenISO(a, b) {
  const da = new Date(a + 'T00:00:00');
  const db = new Date(b + 'T00:00:00');
  return Math.round((db - da) / 86400000);
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/* ---------- Toast notifications ---------- */
function toast(msg, type) {
  let host = document.getElementById('toastHost');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toastHost';
    host.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px;';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = 'toast toast-' + (type || 'ok');
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => { el.classList.add('toast-out'); setTimeout(() => el.remove(), 250); }, 2600);
}

/* ---------- Dirty-form guard ---------- */
// Any form calls markDirty() on input; navigation checks isDirty() and confirms.
let _dirty = false;
function markDirty() { _dirty = true; }
function clearDirty() { _dirty = false; }
function isDirty() { return _dirty; }
function guardNavigation() {
  if (_dirty) return confirm('You have unsaved changes. Leave this page without saving?');
  return true;
}
window.addEventListener('beforeunload', (e) => {
  // Native browsers no longer allow a custom message here — they show their own generic
  // "leave site?" text — but the prompt itself is still a useful last-chance nag.
  if (_dirty || window.__backupOverdueHard) { e.preventDefault(); e.returnValue = ''; }
});

/* ---------- Small DOM helpers ---------- */
function el(tag, attrs, children) {
  const node = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([k, v]) => {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  });
  (children || []).forEach(c => node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
  return node;
}

function statusBadge(status) {
  const cls = 'badge badge-' + String(status || '').toLowerCase().replace(/\s+/g, '-');
  return `<span class="${cls}">${escapeHtml(status || '—')}</span>`;
}

/** A searchable, scrollable item picker — used anywhere a person needs to choose from a
    catalog that could grow large, instead of a plain <select> that gets unwieldy once there
    are many items. items: array of records. options.getLabel/getSubLabel/getSearchText are
    functions given a record; onSelect(record) fires once, after which the picker closes itself. */
function openItemPicker(items, options, onSelect) {
  const overlay = document.createElement('div');
  overlay.className = 'item-picker-overlay';
  overlay.innerHTML = `
    <div class="item-picker-box">
      <div class="item-picker-header">
        <h3>${escapeHtml(options.title || 'Select Item')}</h3>
        <input type="text" class="item-picker-search" placeholder="Type to search...">
      </div>
      <div class="item-picker-list"></div>
      <div class="item-picker-footer"><button type="button" class="btn-line btn-sm" data-cancel>Cancel</button></div>
    </div>`;
  document.body.appendChild(overlay);
  const searchInput = overlay.querySelector('.item-picker-search');
  const listEl = overlay.querySelector('.item-picker-list');
  const close = () => { if (overlay.parentNode) document.body.removeChild(overlay); };

  function renderList(filter) {
    const f = (filter || '').trim().toLowerCase();
    const filtered = !f ? items : items.filter(it => (options.getSearchText ? options.getSearchText(it) : String(it.description || '')).toLowerCase().includes(f));
    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="item-picker-empty">No matches found.</div>`;
      return;
    }
    listEl.innerHTML = filtered.map((it, i) => `
      <div class="item-picker-row" data-idx="${i}">
        <div class="ipr-title">${escapeHtml(options.getLabel ? options.getLabel(it) : String(it.description || ''))}</div>
        ${options.getSubLabel ? `<div class="ipr-sub">${escapeHtml(options.getSubLabel(it))}</div>` : ''}
      </div>`).join('');
    listEl.querySelectorAll('.item-picker-row').forEach(row => {
      row.addEventListener('click', () => { const item = filtered[Number(row.dataset.idx)]; close(); onSelect(item); });
    });
  }
  renderList('');
  searchInput.addEventListener('input', () => renderList(searchInput.value));
  overlay.querySelector('[data-cancel]').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', function escHandler(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); } });
  setTimeout(() => searchInput.focus(), 0);
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms || 250); };
}

function csvEscape(v) {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime || 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function arrayToCSV(rows, columns) {
  const header = columns.map(c => csvEscape(c.label)).join(',');
  const lines = rows.map(row => columns.map(c => csvEscape(typeof c.value === 'function' ? c.value(row) : row[c.value])).join(','));
  return [header, ...lines].join('\r\n');
}

window.Util = {
  r2, formatMoney, formatDate, todayISO, addDaysISO, formatLocalISO, daysBetweenISO, escapeHtml, toast,
  markDirty, clearDirty, isDirty, guardNavigation, el, statusBadge, debounce,
  csvEscape, downloadFile, arrayToCSV, currencyList, openItemPicker
};
