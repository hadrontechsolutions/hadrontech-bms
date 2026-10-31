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

window.addEventListener('message', async (e) => {
  const f = document.getElementById('officeFrame');
  if (!f || e.source !== f.contentWindow) return;
  const m = e.data || {};
  try {
    if (m.type === 'office-height') {
      if (m.h > 0) f.style.height = Math.round(m.h) + 'px';
      if (!f.dataset.fitted) { f.dataset.fitted = '1'; setTimeout(officeSendSize, 300); }
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

window.Office = { officeData, officeRecordHash, mount: mountOffice };
