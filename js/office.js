/* ============================================================
   office.js — the Office: the AI team (Manager + workers) shown in
   office/office.html, on the Dashboard (between the quick actions and
   "Needs your attention").

   READ-ONLY by design. This file only READS the BMS records
   (DB.dbGetAll) and hands a copy to the Office page. Nothing in the
   Office can add, change or delete a BMS record. The Office keeps its
   own notes (win chances, rulebook changes) in its own browser
   storage, separate from the BMS database.

   Connections:
   - office-ready  (Office → BMS): send the live records
   - office-open   (Office → BMS): open a record by its number, e.g. HT-Q-2026-0044
   - office-goto   (Office → BMS): open a BMS page, e.g. /products/new
   - office-fill   (Office → BMS): open New/Edit Product or Supplier with the fields filled in (not saved)
   ============================================================ */

const OFFICE_STORES = ['customers', 'suppliers', 'products', 'quotations', 'customerPOs', 'salesOrders', 'supplierPOs',
  'proformaInvoices', 'deliveryReceipts', 'technicalOffers', 'expenses', 'notes', 'settings'];

/** A copy of the live records for the Office. Settings are trimmed to what the Office uses
    (the logo, signature and backup-folder handle stay in the BMS). */
async function officeData() {
  const data = {};
  for (const s of OFFICE_STORES) data[s] = await DB.dbGetAll(s);
  data.settings = data.settings.map(st => ({
    key: st.key, defaultPaymentTerms: st.defaultPaymentTerms, defaultQuotationValidityDays: st.defaultQuotationValidityDays,
    lastBackupExport: st.lastBackupExport
  }));
  return JSON.parse(JSON.stringify(data));
}

/** Which BMS page shows a record number. Quotations open their latest revision. */
const OFFICE_RECORD_PAGES = [
  { re: /^HT-Q-\d{4}-\d{4}$/, store: 'quotations', field: 'quotationNo', page: '/quotations/' },
  { re: /^HT-RFQ-\d{4}-\d{4}$/, store: 'notes', field: 'noteNo', page: '/rfq-tracker/' },
  { re: /^HT-SO-\d{4}-\d{4}$/, store: 'salesOrders', field: 'soNo', page: '/sales-orders/' },
  { re: /^HT-PO-\d{4}-\d{4}$/, store: 'supplierPOs', field: 'poNo', page: '/supplier-pos/' },
  { re: /^HT-DR-\d{4}-\d{4}$/, store: 'deliveryReceipts', field: 'drNo', page: '/delivery-receipts/' },
  { re: /^HT-PI-\d{4}-\d{4}$/, store: 'proformaInvoices', field: 'piNo', page: '/proforma-invoices/' },
  { re: /^HT-TO-\d{4}-\d{4}$/, store: 'technicalOffers', field: 'offerNo', page: '/technical-offers/' },
  { re: /^CPO-\d{4}-\d{4}$/, store: 'customerPOs', field: 'poNo', page: '/customer-pos/' },
  { re: /^ITEM-\d+$/, store: 'products', field: 'itemNo', page: '/products/' },
  { re: /^SUP-\d+$/, store: 'suppliers', field: 'supplierNo', page: '/suppliers/' }
];
async function officeRecordHash(no) {
  const n = String(no || '').trim().toUpperCase();
  const t = OFFICE_RECORD_PAGES.find(x => x.re.test(n));
  if (!t) return null;
  const hits = (await DB.dbGetAll(t.store)).filter(r => String(r[t.field] || '').toUpperCase() === n);
  if (!hits.length) return null;
  const rec = hits.find(r => r.isLatest !== false) || hits[hits.length - 1];
  return t.page + rec.id;
}
/** Only BMS pages may be opened from the Office (a hash path like /products/new). */
const officeSafeHash = (h) => typeof h === 'string' && /^\/[a-z0-9\-\/]*$/i.test(h) && h.length < 80;

/** Screen height the Office may use: it sizes its scene so the whole office fits on screen. */
function officeAvail() {
  // the whole scene fits on screen once you scroll to it
  return Math.max(420, window.innerHeight - 110);
}
function officeSendSize() {
  const f = document.getElementById('officeFrame');
  if (f && f.contentWindow) f.contentWindow.postMessage({ type: 'office-size', avail: officeAvail() }, '*');
}

/** Shows the Office on the Dashboard, between the quick actions and "Needs your attention". */
function mountOffice(slot) {
  if (!slot) return;
  slot.innerHTML = `
    <div class="card office-card" style="padding:12px 12px 4px">
      <iframe id="officeFrame" src="office/office.html" title="Office — the Manager and his team" scrolling="no"
        style="display:block;width:100%;height:${Math.max(420, window.innerHeight - 120)}px;border:0;background:transparent;overflow:hidden"></iframe>
    </div>`;
}
/* old links to #/office go to the Dashboard, where the Office now lives */
Router.route('/office', () => Router.navigate('/dashboard'));
window.addEventListener('resize', officeSendSize);


/* ---------- Office → BMS form: open New Product / New Supplier (or Edit) already filled in ----------
   Fills the fields of the normal BMS form by their names. Nothing is saved: the person checks the
   form and presses Save, which runs every normal BMS check (currency, duplicates, required fields). */
let officePendingFill = null;
const officeNorm = (v) => String(v == null ? '' : v).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
function officeSetField(form, name, value) {
  const el = form.querySelector(`[name="${name}"]`);
  if (!el) return { ok: false };
  const before = el.type === 'checkbox' ? el.checked : el.value;
  if (el.tagName === 'SELECT') {
    const want = officeNorm(value);
    const opts = [...el.options];
    const opt = opts.find(o => officeNorm(o.value) === want || officeNorm(o.textContent) === want)
      || (want.length > 3 && opts.find(o => officeNorm(o.textContent).startsWith(want) || (officeNorm(o.textContent).length > 3 && want.startsWith(officeNorm(o.textContent)))));
    if (!opt) return { ok: false };
    el.value = opt.value;
  } else if (el.type === 'checkbox') {
    el.checked = /^(yes|true|y|1|authori[sz]ed)/i.test(String(value).trim());
  } else {
    el.value = String(value);
  }
  const after = el.type === 'checkbox' ? el.checked : el.value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  const changed = String(before) !== String(after);
  if (changed) { el.style.outline = '2px solid #e8a33d'; el.style.outlineOffset = '1px'; el.title = 'Filled in by the Office'; }
  return { ok: true, changed };
}
function officeFillForm(form, m) {
  const v = Object.assign({}, m.values);
  if (v.supplier !== undefined) { v.defaultSupplierId = v.supplier; delete v.supplier; }   // product: supplier name → Default Supplier list
  const first = ['type', 'defaultSupplierId'], last = ['currency'];
  const keys = Object.keys(v).sort((a, b) => (first.includes(b) - first.includes(a)) || (last.includes(a) - last.includes(b)));
  let changed = 0; const missed = [];
  for (const k of keys) {
    const r = officeSetField(form, k, v[k]);
    if (!r.ok) missed.push(`${k.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()).replace(/ (.)/g, (x, c) => ' ' + c.toLowerCase())}: ${v[k]}`); else if (r.changed) changed++;
  }
  const what = m.entity === 'products' ? 'product' : 'supplier';
  const note = document.createElement('div');
  note.className = 'office-fill-note';
  note.style.cssText = 'grid-column:1/-1;margin:0 0 14px;padding:10px 14px;border-radius:8px;background:#fff6e5;border:1px solid #f0c27a;color:#6b4300;font-size:13px;line-height:1.5';
  note.innerHTML =
    `<b>Filled in by the Office</b> from the table you gave the Manager — ${changed} field${changed === 1 ? '' : 's'} ${m.id ? 'changed (highlighted)' : 'filled (highlighted)'}. ` +
    `<b>Nothing is saved yet:</b> check the fields, then press Save.` +
    (m.dupOf ? `<div style="margin-top:6px;color:#9b1c2e"><b>⚠ Possible duplicate of ${escapeHtml(m.dupOf)}.</b> You chose to create a new ${what}; make sure it really is different before saving.</div>` : '') +
    (missed.length ? `<div style="margin-top:6px">Not filled — this form has no field or matching choice for: ${escapeHtml(missed.join(' · '))}. Put them in Notes if you want to keep them.</div>` : '') +
    (m.productWaiting ? `<div style="margin-top:6px">After saving this supplier, go back to the Dashboard and give the Manager the product table again.</div>` : '');
  form.insertBefore(note, form.firstChild);
  window.scrollTo({ top: 0 });
}
async function officeWaitAndFill(m) {
  const want = m.id ? `#/${m.entity}/${m.id}/edit` : `#/${m.entity}/new`;
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 80));
    if (officePendingFill !== m || location.hash !== want) return;
    const form = document.getElementById('entityForm');
    if (form && form.querySelector('[name]')) { officePendingFill = null; officeFillForm(form, m); return; }
  }
}

window.addEventListener('message', async (e) => {
  const f = document.getElementById('officeFrame');
  if (!f || e.source !== f.contentWindow) return;
  const m = e.data || {};
  try {
    if (m.type === 'office-height') {
      if (m.h > 0) f.style.height = Math.round(m.h) + 'px';
      if (!f.dataset.fitted) { f.dataset.fitted = '1'; setTimeout(officeSendSize, 300); }
    } else if (m.type === 'office-fill' && ['products', 'suppliers'].includes(m.entity) && m.values && typeof m.values === 'object') {
      const id = m.id != null && /^\d+$/.test(String(m.id)) ? Number(m.id) : null;
      officePendingFill = Object.assign({}, m, { id });
      Router.navigate(id ? `/${m.entity}/${id}/edit` : `/${m.entity}/new`);
      officeWaitAndFill(officePendingFill);
    } else if (m.type === 'office-focus') {
      // a pop-up opened in the Office: bring the whole Office on screen (just below the top bar)
      const r = f.getBoundingClientRect(), bar = (document.querySelector('.topbar') || { offsetHeight: 56 }).offsetHeight;
      if (r.top < bar || r.bottom > window.innerHeight) window.scrollTo({ top: window.scrollY + r.top - bar - 8, behavior: 'smooth' });
    } else if (m.type === 'office-ready') {
      officeSendSize();
      f.contentWindow.postMessage({ type: 'office-data', at: new Date().toISOString(), data: await officeData() }, '*');
    } else if (m.type === 'office-open') {
      const hash = await officeRecordHash(m.no);
      if (hash) Router.navigate(hash);
      else f.contentWindow.postMessage({ type: 'office-notfound', no: m.no }, '*');   // the Office says so itself, no browser pop-up
    } else if (m.type === 'office-goto' && officeSafeHash(m.hash)) {
      Router.navigate(m.hash);
    }
  } catch (err) {
    console.error('Office:', err);
  }
});

window.Office = { officeData, officeRecordHash, mount: mountOffice, fillForm: officeFillForm };
