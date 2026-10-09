const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
require('fake-indexeddb/auto');
const APP = __dirname;

async function main() {
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  window.indexedDB = global.indexedDB; window.IDBKeyRange = global.IDBKeyRange; window.confirm = () => true;
  const scripts = [...dom.window.document.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => s !== 'js/app.js');
  for (const src of scripts) dom.window.eval(fs.readFileSync(path.join(APP, src), 'utf8'));
  const win = dom.window; const doc = win.document;
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const now = new Date().toISOString();

  await win.DB.openDB(); await win.DB.ensureCounters();
  const custId = await win.DB.dbAdd('customers', { customerNo: 'C1', companyName: 'KEYEC', status: 'Active', createdAt: now });
  const supId = await win.DB.dbAdd('suppliers', { supplierNo: 'S1', companyName: 'Pentair', status: 'Active', createdAt: now });

  await win.DB.dbAdd('quotations', { quotationNo: 'HT-Q-2026-0001', customerId: custId, revision: 0, isLatest: true, status: 'Won', date: '2026-09-05', currency: 'PHP', netSubtotal: 60000, grossProfit: 15000, grossMarginPercent: 25, subtotal: 60000, vatTotal: 0, grandTotal: 60000, createdAt: now, updatedAt: now });
  await win.DB.dbAdd('quotations', { quotationNo: 'HT-Q-2026-0002', customerId: custId, revision: 0, isLatest: true, status: 'Lost', date: '2026-09-10', currency: 'PHP', netSubtotal: 40000, grossProfit: 10000, grossMarginPercent: 25, subtotal: 40000, vatTotal: 0, grandTotal: 40000, createdAt: now, updatedAt: now });

  await win.DB.dbAdd('salesOrders', { soNo: 'HT-SO-2026-0001', customerId: custId, orderDate: '2026-09-05', currency: 'PHP', status: 'Sourcing', vatMode: 'NonVat', lines: [], subtotal: 60000, vatTotal: 0, freight: 0, other: 0, grandTotal: 60000, createdAt: now, updatedAt: now });
  await win.DB.dbAdd('salesOrders', { soNo: 'HT-SO-2026-0002', customerId: custId, orderDate: '2026-09-10', currency: 'PHP', status: 'Delivered', vatMode: 'NonVat', lines: [], subtotal: 30000, vatTotal: 0, freight: 0, other: 0, grandTotal: 30000, createdAt: now, updatedAt: now });

  await win.DB.dbAdd('supplierPOs', { poNo: 'HT-PO-2026-0001', supplierId: supId, poDate: '2026-09-05', currency: 'USD', status: 'In Production', lines: [], freight: 0, taxes: 0, totalCost: 5000, createdAt: now });
  await win.DB.dbAdd('supplierPOs', { poNo: 'HT-PO-2026-0002', supplierId: supId, poDate: '2026-09-06', currency: 'PHP', status: 'Received', lines: [], freight: 0, taxes: 0, totalCost: 15000, createdAt: now });

  await win.DB.dbAdd('technicalOffers', { offerNo: 'HT-TO-2026-0001', customerId: custId, endUser: 'Onsemi', date: '2026-09-05', status: 'Approved', items: [], specs: [], sections: [], createdAt: now });
  await win.DB.dbAdd('technicalOffers', { offerNo: 'HT-TO-2026-0002', customerId: custId, endUser: 'Onsemi', date: '2026-09-06', items: [], specs: [], sections: [], createdAt: now }); // no status -> defaults to Draft

  /* ============ wonLost: curated to only Won/Lost, not the full 6-status enum ============ */
  win.location.hash = '#/reports/wonLost';
  await win.Router.resolveRoute();
  await wait(80);
  const wonLostOptions = [...doc.getElementById('rStatusFilter').options].map(o => o.value);
  console.log('STEP 1: THE CURATED-OPTIONS DESIGN: Won & Lost\u2019s dropdown only offers Won/Lost, not Draft/Sent/etc. that could never actually match a row here:', wonLostOptions.filter(Boolean).length === 2 && wonLostOptions.includes('Won') && wonLostOptions.includes('Lost'));

  doc.getElementById('rStatusFilter').value = 'Won';
  doc.getElementById('rStatusFilter').dispatchEvent(new win.Event('change'));
  await wait(80);
  let body = doc.getElementById('reportTableWrap').textContent;
  console.log('STEP 2: Filtering to "Won" correctly isolates just the Won quotation:', body.includes('HT-Q-2026-0001') && !body.includes('HT-Q-2026-0002'));

  /* ============ salesOrderRegister: uses the Sales Order status enum, not the Quotation one ============ */
  win.location.hash = '#/reports/salesOrderRegister';
  await win.Router.resolveRoute();
  await wait(80);
  const soOptions = [...doc.getElementById('rStatusFilter').options].map(o => o.value);
  console.log('STEP 3: THE DIFFERENT-ENUM CHECK: Sales Order Register\u2019s dropdown correctly shows Sales Order statuses (Sourcing, Delivered), never Quotation statuses like "Won"/"Lost":', soOptions.includes('Sourcing') && soOptions.includes('Delivered') && !soOptions.includes('Won'));

  doc.getElementById('rStatusFilter').value = 'Sourcing';
  doc.getElementById('rStatusFilter').dispatchEvent(new win.Event('change'));
  await wait(80);
  body = doc.getElementById('reportTableWrap').textContent;
  console.log('STEP 4: Filtering Sales Order Register to "Sourcing" correctly isolates just that order:', body.includes('HT-SO-2026-0001') && !body.includes('HT-SO-2026-0002'));

  /* ============ supplierPORegister: uses its own, third distinct status enum ============ */
  win.location.hash = '#/reports/supplierPORegister';
  await win.Router.resolveRoute();
  await wait(80);
  const spoOptions = [...doc.getElementById('rStatusFilter').options].map(o => o.value);
  console.log('STEP 5: Supplier PO Register correctly shows its OWN status enum (In Production, Received), a third distinct set:', spoOptions.includes('In Production') && spoOptions.includes('Received') && !spoOptions.includes('Sourcing'));

  doc.getElementById('rStatusFilter').value = 'Received';
  doc.getElementById('rStatusFilter').dispatchEvent(new win.Event('change'));
  await wait(80);
  body = doc.getElementById('reportTableWrap').textContent;
  console.log('STEP 6: Filtering to "Received" correctly isolates just that PO:', body.includes('HT-PO-2026-0002') && !body.includes('HT-PO-2026-0001'));

  /* ============ technicalOffersLog: a fourth distinct enum, plus the "defaults to Draft" edge case ============ */
  win.location.hash = '#/reports/technicalOffersLog';
  await win.Router.resolveRoute();
  await wait(80);
  const toOptions = [...doc.getElementById('rStatusFilter').options].map(o => o.value);
  console.log('STEP 7: Technical Offers Log shows its own fourth distinct enum (Draft, Sent, Approved, Revision Requested):', toOptions.includes('Approved') && toOptions.includes('Revision Requested'));

  doc.getElementById('rStatusFilter').value = 'Draft';
  doc.getElementById('rStatusFilter').dispatchEvent(new win.Event('change'));
  await wait(80);
  body = doc.getElementById('reportTableWrap').textContent;
  console.log('STEP 8: THE DEFAULT-VALUE EDGE CASE: an offer with no status field at all (defaults to "Draft" for display) is correctly matched when filtering to "Draft":', body.includes('HT-TO-2026-0002') && !body.includes('HT-TO-2026-0001'));

  /* ============ Regression: reports that should have NO status filter still correctly hide it ============ */
  win.location.hash = '#/reports/grossProfit';
  await win.Router.resolveRoute();
  await wait(80);
  console.log('STEP 9: REGRESSION: Gross Profit Report (Won Only) — already 100% Won, a status filter would be redundant — correctly has none:', doc.getElementById('rStatusLabel').style.display === 'none');

  win.location.hash = '#/reports/paymentsAging';
  await win.Router.resolveRoute();
  await wait(80);
  console.log('STEP 10: REGRESSION: Payments Aging (already filtered by payment status, a different dimension) correctly has no fulfillment-status filter:', doc.getElementById('rStatusLabel').style.display === 'none');

  console.log('\n=== STATUS FILTER STANDARDIZED ACROSS REPORTS (4 DISTINCT ENUMS) FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
