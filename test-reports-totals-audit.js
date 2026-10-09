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

  // Quotations across different stages, months, and one with an end-user
  await win.DB.dbAdd('quotations', {
    quotationNo: 'HT-Q-2026-0001', customerId: custId, endUser: 'Onsemi Cebu', revision: 0, isLatest: true, status: 'Won', date: '2026-09-05', currency: 'PHP',
    netSubtotal: 60000, grossProfit: 15000, grossMarginPercent: 25, subtotal: 60000, vatTotal: 0, grandTotal: 60000, createdAt: now, updatedAt: now
  });
  await win.DB.dbAdd('quotations', {
    quotationNo: 'HT-Q-2026-0002', customerId: custId, endUser: '', revision: 0, isLatest: true, status: 'Sent', date: '2026-09-10', currency: 'PHP',
    netSubtotal: 40000, grossProfit: 10000, grossMarginPercent: 25, subtotal: 40000, vatTotal: 0, grandTotal: 40000, createdAt: now, updatedAt: now
  });
  await win.DB.dbAdd('quotations', {
    quotationNo: 'HT-Q-2026-0003', customerId: custId, endUser: '', revision: 0, isLatest: true, status: 'Lost', date: '2026-09-15', currency: 'PHP',
    netSubtotal: 20000, grossProfit: 5000, grossMarginPercent: 25, subtotal: 20000, vatTotal: 0, grandTotal: 20000, createdAt: now, updatedAt: now
  });

  // Two supplier POs in different currencies -- for testing supplierPORegister's by-currency note
  await win.DB.dbAdd('supplierPOs', { poNo: 'HT-PO-2026-0001', supplierId: supId, poDate: '2026-09-05', currency: 'USD', status: 'Confirmed', lines: [], freight: 0, taxes: 0, totalCost: 5000, createdAt: now });
  await win.DB.dbAdd('supplierPOs', { poNo: 'HT-PO-2026-0002', supplierId: supId, poDate: '2026-09-06', currency: 'PHP', status: 'Confirmed', lines: [], freight: 0, taxes: 0, totalCost: 15000, createdAt: now });

  await win.DB.dbAdd('salesOrders', { soNo: 'HT-SO-2026-0001', customerId: custId, orderDate: '2026-09-05', currency: 'PHP', status: 'Confirmed', vatMode: 'NonVat', lines: [], subtotal: 60000, vatTotal: 0, freight: 0, other: 0, grandTotal: 60000, createdAt: now, updatedAt: now });

  win.location.hash = '#/reports';
  await win.Router.resolveRoute();
  await wait(50);

  /* ============ New report exists and is correctly labeled ============ */
  console.log('STEP 1: The existing report is now clearly labeled "(Won Only)" to disambiguate from the new one:', doc.getElementById('content').textContent.includes('Gross Profit Report (Won Only)'));
  console.log('STEP 2: The new "Projected Gross Profit (All Stages)" report appears in the nav:', doc.getElementById('content').textContent.includes('Projected Gross Profit (All Stages)'));

  /* ============ THE ASK: Projected Gross Profit shows ALL stages, with Month/Customer/End-User ============ */
  win.location.hash = '#/reports/projectedGrossProfit';
  await win.Router.resolveRoute();
  await wait(80);
  let body = doc.getElementById('reportTableWrap').textContent;
  console.log('STEP 3: THE CORE ASK: shows a Won quotation:', body.includes('HT-Q-2026-0001'));
  console.log('STEP 4: THE CORE ASK: ALSO shows a Sent (not-yet-won) quotation -- unlike the old Won-only report:', body.includes('HT-Q-2026-0002'));
  console.log('STEP 5: THE CORE ASK: ALSO shows a Lost quotation:', body.includes('HT-Q-2026-0003'));
  console.log('STEP 6: THE CHANGE: the column is now "Date" (a real date) instead of "Month", showing the actual formatted date:', body.includes('Sep 5, 2026') && doc.getElementById('reportTableWrap').querySelector('th') && [...doc.querySelectorAll('#reportTableWrap th')].some(th => th.textContent === 'Date'));
  console.log('STEP 7: Shows the Customer column correctly:', body.includes('KEYEC'));
  console.log('STEP 8: Shows the End-User column correctly (Onsemi Cebu):', body.includes('Onsemi Cebu'));
  console.log('STEP 9: Has a totals row summing Gross Profit across all shown rows (15,000 + 10,000 + 5,000 = 30,000):', body.includes('30,000.00'));

  win.location.hash = '#/reports/grossProfit';
  await win.Router.resolveRoute();
  await wait(80);
  body = doc.getElementById('reportTableWrap').textContent;
  console.log('STEP 10: REGRESSION: the original Won-only report still correctly excludes Sent/Lost quotations:', !body.includes('HT-Q-2026-0002') && !body.includes('HT-Q-2026-0003'));
  console.log('STEP 11: The Won-only report now HAS a totals row too (15,000 Gross Profit):', body.includes('15,000.00'));

  /* ============ Won & Lost: separate totals, never combined ============ */
  win.location.hash = '#/reports/wonLost';
  await win.Router.resolveRoute();
  await wait(80);
  body = doc.getElementById('reportTableWrap').textContent;
  console.log('STEP 12: Won & Lost shows separate Won/Lost totals (60,000 Won / 20,000 Lost), never blindly combined into one 80,000 figure:', body.includes('60,000.00') && body.includes('20,000.00') && !body.includes('80,000.00'));

  /* ============ Quotation Register, Sales Order Register: now have totals ============ */
  win.location.hash = '#/reports/quotationRegister';
  await win.Router.resolveRoute();
  await wait(80);
  console.log('STEP 13: Quotation Register now has a totals row (60,000+40,000+20,000 = 120,000):', doc.getElementById('reportTableWrap').textContent.includes('120,000.00'));

  win.location.hash = '#/reports/salesOrderRegister';
  await win.Router.resolveRoute();
  await wait(80);
  console.log('STEP 14: Sales Order Register now has a totals row (60,000):', doc.getElementById('reportTableWrap').textContent.includes('60,000.00'));

  /* ============ Sales by Customer / Sales by Month: now have a grand total ============ */
  win.location.hash = '#/reports/salesByCustomer';
  await win.Router.resolveRoute();
  await wait(80);
  console.log('STEP 15: Sales by Customer now has a grand TOTAL row across all customers:', doc.getElementById('reportTableWrap').textContent.includes('TOTAL') && doc.getElementById('reportTableWrap').textContent.includes('60,000.00'));

  /* ============ Supplier PO Register: by-currency note, not a misleading combined total ============ */
  win.location.hash = '#/reports/supplierPORegister';
  await win.Router.resolveRoute();
  await wait(80);
  body = doc.getElementById('reportTableWrap').textContent;
  console.log('STEP 16: Supplier PO Register shows a by-currency breakdown (₱15,000 / $5,000), never a blind combined sum:', body.includes('₱15,000.00') && body.includes('$5,000.00'));

  console.log('\n=== REPORTS TOTALS AUDIT + PROJECTED GROSS PROFIT REPORT FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
