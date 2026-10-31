/* ============================================================
   office.js — the Office: the AI team (Manager + workers) shown in
   office/office.html, inside this page.

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

/** Space left on screen below the breadcrumb: the Office sizes its scene to fit it, so nothing scrolls. */
function officeAvail() {
  const f = document.getElementById('officeFrame');
  return f ? Math.max(420, window.innerHeight - f.getBoundingClientRect().top - 12) : 0;
}
function officeSendSize() {
  const f = document.getElementById('officeFrame');
  if (f && f.contentWindow) f.contentWindow.postMessage({ type: 'office-size', avail: officeAvail() }, '*');
}

Router.route('/office', async () => {
  Router.setBreadcrumb([{ label: 'Office' }]);
  const content = document.getElementById('content');
  content.innerHTML = `
    <iframe id="officeFrame" src="office/office.html" title="Office — the Manager and his team" scrolling="no"
      style="display:block;width:100%;height:${Math.max(420, window.innerHeight - 140)}px;border:0;background:transparent;overflow:hidden"></iframe>`;
});
window.addEventListener('resize', officeSendSize);
/* a banner appearing or closing above the Office moves it: re-fit the scene */
for (const id of ['backupBanner', 'storageRiskBanner']) {
  const el = document.getElementById(id);
  if (el) new MutationObserver(officeSendSize).observe(el, { childList: true, subtree: true, attributes: true });
}

window.addEventListener('message', async (e) => {
  const f = document.getElementById('officeFrame');
  if (!f || e.source !== f.contentWindow) return;
  const m = e.data || {};
  try {
    if (m.type === 'office-height') {
      if (m.h > 0) f.style.height = Math.round(m.h) + 'px';
      if (!f.dataset.fitted) { f.dataset.fitted = '1'; setTimeout(officeSendSize, 300); }
    } else if (m.type === 'office-ready') {
      officeSendSize();
      f.contentWindow.postMessage({ type: 'office-data', at: new Date().toISOString(), data: await officeData() }, '*');
    } else if (m.type === 'office-open') {
      const hash = await officeRecordHash(m.no);
      if (hash) Router.navigate(hash);
      else alert(`${m.no} is not in the BMS (it may have been deleted).`);
    } else if (m.type === 'office-goto' && officeSafeHash(m.hash)) {
      Router.navigate(m.hash);
    }
  } catch (err) {
    console.error('Office:', err);
  }
});

window.Office = { officeData, officeRecordHash };
