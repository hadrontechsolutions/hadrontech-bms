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

function officeFitFrame() {
  const f = document.getElementById('officeFrame');
  if (!f) return;
  const top = f.getBoundingClientRect().top;
  f.style.height = Math.max(480, window.innerHeight - top - 12) + 'px';
}

Router.route('/office', async () => {
  Router.setBreadcrumb([{ label: 'Office' }]);
  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="office-wrap">
      <iframe id="officeFrame" src="office/office.html" title="Office — the Manager and his team"
        style="display:block;width:100%;height:640px;border:1px solid #d9dee5;border-radius:10px;background:#fbf6ec"></iframe>
    </div>`;
  officeFitFrame();
});
window.addEventListener('resize', officeFitFrame);

window.addEventListener('message', async (e) => {
  const f = document.getElementById('officeFrame');
  if (!f || e.source !== f.contentWindow) return;
  const m = e.data || {};
  try {
    if (m.type === 'office-ready') {
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
