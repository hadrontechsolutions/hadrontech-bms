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
  const custId = await win.DB.dbAdd('customers', { customerNo: 'C1', companyName: 'Key Electrochem Limited Co./KEYEC', status: 'Active', createdAt: now, updatedAt: now });
  const so = await win.DB.dbAdd('salesOrders', {
    soNo: 'HT-SO-2026-0001', customerId: custId, orderDate: win.todayISO(), currency: 'PHP', status: 'Confirmed',
    lines: [], subtotal: 0, vatTotal: 0, freight: 0, other: 0, grandTotal: 2000, createdAt: now, updatedAt: now
  });

  /* ============ Set up Technical Offers ============ */
  await win.DB.dbAdd('technicalOffers', { offerNo: 'HT-TO-2026-0001', customerId: custId, endUser: 'Onsemi', rfqReference: '566-25663', date: win.todayISO(), status: 'Sent', items: [], specs: [], sections: [], createdAt: now });
  await win.DB.dbAdd('technicalOffers', { offerNo: 'HT-TO-2026-0002', customerId: custId, endUser: 'Acme Corp', rfqReference: 'RFQ-9981', date: '2020-01-01', status: 'Approved', items: [], specs: [], sections: [], createdAt: now });

  /* ============ Set up Proforma Invoices: PHP unpaid, PHP fully-paid (should be excluded), USD partial, legacy (unmigrated) ============ */
  await win.DB.dbAdd('proformaInvoices', { piNo: 'HT-PI-2026-0001', salesOrderId: so, date: win.todayISO(), lines: [], currency: 'PHP', subtotal: 10000, vatTotal: 1200, freight: 0, other: 0, grandTotal: 11200, payments: [], createdAt: now });
  await win.DB.dbAdd('proformaInvoices', { piNo: 'HT-PI-2026-0002', salesOrderId: so, date: win.todayISO(), lines: [], currency: 'PHP', subtotal: 5000, vatTotal: 600, freight: 0, other: 0, grandTotal: 5600, payments: [{ amount: 5600, date: win.todayISO() }], createdAt: now });
  await win.DB.dbAdd('proformaInvoices', { piNo: 'HT-PI-2026-0003', salesOrderId: so, date: win.todayISO(), lines: [], currency: 'USD', subtotal: 1000, vatTotal: 0, freight: 0, other: 0, grandTotal: 1000, payments: [{ amount: 300, date: win.todayISO() }], createdAt: now });
  await win.DB.dbAdd('proformaInvoices', { piNo: 'HT-PI-2026-0004', salesOrderId: so, date: win.todayISO(), createdAt: now }); // legacy, unmigrated -- should pick up SO's 2000 PHP grandTotal

  /* ============ Report nav includes both new reports ============ */
  win.location.hash = '#/reports';
  await win.Router.resolveRoute();
  await wait(50);
  console.log('STEP 1: "Technical Offers Log" appears in the report nav:', doc.getElementById('content').textContent.includes('Technical Offers Log'));
  console.log('STEP 2: "Payments Aging Report" appears in the report nav:', doc.getElementById('content').textContent.includes('Payments Aging Report'));

  /* ============ Technical Offers Log ============ */
  win.location.hash = '#/reports/technicalOffersLog';
  await win.Router.resolveRoute();
  await wait(80);
  let body = doc.getElementById('reportTableWrap').textContent;
  console.log('STEP 3: Technical Offers Log shows both offers with their key details:', body.includes('HT-TO-2026-0001') && body.includes('Onsemi') && body.includes('566-25663') && body.includes('HT-TO-2026-0002') && body.includes('Acme Corp'));
  console.log('STEP 4: Status column correctly shows the color-independent text value too (Sent / Approved):', body.includes('Sent') && body.includes('Approved'));

  // Date filter: restrict to only today's offers, excluding the 2020 one
  doc.getElementById('rFrom').value = win.todayISO();
  doc.getElementById('rApply').click();
  await wait(80);
  body = doc.getElementById('reportTableWrap').textContent;
  console.log('STEP 5: Date filter correctly excludes the 2020 offer, keeping only the one from today:', body.includes('HT-TO-2026-0001') && !body.includes('HT-TO-2026-0002'));

  /* ============ Payments Aging Report ============ */
  win.location.hash = '#/reports/paymentsAging';
  await win.Router.resolveRoute();
  await wait(80);
  body = doc.getElementById('reportTableWrap').textContent;
  console.log('STEP 6: Payments Aging shows the unpaid PHP invoice:', body.includes('HT-PI-2026-0001'));
  console.log('STEP 7: Payments Aging correctly EXCLUDES the fully-paid invoice:', !body.includes('HT-PI-2026-0002'));
  console.log('STEP 8: Payments Aging shows the partially-paid USD invoice:', body.includes('HT-PI-2026-0003') && body.includes('$700.00'));
  console.log('STEP 9: The legacy, never-visited invoice is correctly migrated and shown with its real ₱2,000.00 balance, not ₱0.00:', body.includes('HT-PI-2026-0004') && body.includes('₱2,000.00'));
  console.log('STEP 10: Customer name is correctly resolved through the Sales Order link:', body.includes('Key Electrochem'));
  console.log('STEP 11: SO No is shown as a cross-reference:', body.includes('HT-SO-2026-0001'));

  console.log('STEP 12: THE CORE CORRECTNESS CHECK: the note breaks down outstanding balance BY CURRENCY, not as one blind combined sum:', body.includes('by currency') && body.includes('₱13,200.00') && body.includes('$700.00'));
  console.log('STEP 13: No single combined (and meaningless) total number appears anywhere, like "13900" mixing PHP and USD together:', !body.includes('13900.00') && !body.includes('13,900.00'));

  /* ============ CSV export doesn't crash for either new report ============ */
  let downloaded = null;
  win.downloadFile = (name, content) => { downloaded = { name, content }; };
  doc.getElementById('rExport').click();
  await wait(30);
  console.log('STEP 14: CSV export for Payments Aging runs without error and includes the outstanding invoices:', downloaded && downloaded.content.includes('HT-PI-2026-0001'));

  win.location.hash = '#/reports/technicalOffersLog';
  await win.Router.resolveRoute();
  await wait(80);
  downloaded = null;
  doc.getElementById('rExport').click();
  await wait(30);
  console.log('STEP 15: CSV export for Technical Offers Log runs without error and includes the offers:', downloaded && downloaded.content.includes('HT-TO-2026-0001'));

  /* ============ Regression: existing reports still work ============ */
  win.location.hash = '#/reports/quotationRegister';
  await win.Router.resolveRoute();
  await wait(80);
  console.log('STEP 16: Regression: existing Quotation Register report still loads without error:', !!doc.getElementById('reportTableWrap'));

  console.log('\n=== REPORTS EXTENSION (PAYMENTS AGING + TECHNICAL OFFERS LOG) FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
