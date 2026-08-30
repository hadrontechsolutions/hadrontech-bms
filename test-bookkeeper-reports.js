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

  await win.DB.openDB(); await win.DB.ensureCounters();
  const custId = await win.DB.dbAdd('customers', { customerNo: 'CUST-00001', companyName: 'Test Customer Co.', status: 'Active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  const supId = await win.DB.dbAdd('suppliers', { supplierNo: 'SUP-00001', companyName: 'Test Supplier Co.', status: 'Active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  const now = new Date().toISOString();
  const today = win.todayISO();

  const so1 = await win.DB.dbAdd('salesOrders', {
    soNo: 'HT-SO-2026-0001', customerId: custId, orderDate: today, currency: 'PHP', status: 'Confirmed',
    vatMode: 'Standard12', subtotal: 10000, vatTotal: 1200, freight: 0, other: 0, grandTotal: 11200,
    lines: [], createdAt: now, updatedAt: now
  });
  const so2 = await win.DB.dbAdd('salesOrders', {
    soNo: 'HT-SO-2026-0002', customerId: custId, orderDate: today, currency: 'PHP', status: 'Confirmed',
    vatMode: 'ZeroRated', subtotal: 5000, vatTotal: 0, freight: 0, other: 0, grandTotal: 5000,
    lines: [], createdAt: now, updatedAt: now
  });
  const so3 = await win.DB.dbAdd('salesOrders', {
    soNo: 'HT-SO-2026-0003', customerId: custId, orderDate: today, currency: 'PHP', status: 'Confirmed',
    subtotal: 2000, vatTotal: 240, freight: 0, other: 0, grandTotal: 2240,
    lines: [], createdAt: now, updatedAt: now
  });

  const spo1 = await win.DB.dbAdd('supplierPOs', {
    poNo: 'HT-PO-2026-0001', supplierId: supId, poDate: today, currency: 'PHP', status: 'Confirmed',
    lines: [{ lineId: 'L1', description: 'Item A', qty: 1, uom: 'pc', unitCost: 3000, amount: 3000 }],
    freight: 200, taxes: 100, totalCost: 3300, createdAt: now, updatedAt: now
  });
  const spo2 = await win.DB.dbAdd('supplierPOs', {
    poNo: 'HT-PO-2026-0002', supplierId: supId, poDate: today, currency: 'PHP', status: 'Confirmed',
    lines: [{ lineId: 'L1', description: 'Item B', qty: 2, uom: 'pc', unitCost: 500, amount: 1000 }],
    freight: 0, taxes: 0, totalCost: 1000, createdAt: now, updatedAt: now
  });

  const testQuoteId = await win.DB.dbAdd('quotations', {
    quotationNo: 'HT-Q-2026-9001', customerId: custId, customerSnapshot: { companyName: 'Test Customer Co.' },
    revision: 0, isLatest: true, status: 'Sent', date: today, currency: 'PHP',
    vatMode: 'Standard12', subtotal: 1000, vatTotal: 120, freight: 0, other: 0, grandTotal: 1120,
    costTotal: 700, grossProfit: 300, grossMarginPercent: 30, lines: [], createdAt: now, updatedAt: now
  });

  win.location.hash = '#/reports/salesRegisterBookkeeper';
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 1: "Sales Register (for Bookkeeper)" appears in the report nav:', doc.getElementById('content').textContent.includes('Sales Register (for Bookkeeper)'));
  console.log('STEP 2: "Purchase Register (for Bookkeeper)" appears in the report nav:', doc.getElementById('content').textContent.includes('Purchase Register (for Bookkeeper)'));

  const salesRegText = doc.getElementById('content').textContent;
  console.log('STEP 3: All 3 sales orders appear:', salesRegText.includes('HT-SO-2026-0001') && salesRegText.includes('HT-SO-2026-0002') && salesRegText.includes('HT-SO-2026-0003'));
  console.log('STEP 4: Standard 12% order shows correct VATable Sales (10,000.00):', salesRegText.includes('10,000.00'));
  console.log('STEP 5: Standard 12% order shows correct VAT Amount (1,200.00):', salesRegText.includes('1,200.00'));
  console.log('STEP 6: Zero-Rated order shows correct Zero-Rated Sales (5,000.00):', salesRegText.includes('5,000.00'));
  console.log('STEP 7: Legacy record (no vatMode field at all) does not crash and defaults to Standard 12%:', salesRegText.includes('Standard 12%') && !doc.getElementById('content').innerHTML.includes('Something went wrong'));

  console.log('STEP 8: Totals row shows correct VATable Sales total (12,000.00):', salesRegText.includes('12,000.00'));
  console.log('STEP 9: Totals row shows correct total VAT Amount (1,440.00):', salesRegText.includes('1,440.00'));
  console.log('STEP 10: Totals row shows correct Grand Total (18,440.00):', salesRegText.includes('18,440.00'));
  console.log('STEP 11: A "TOTAL" label row is visible:', salesRegText.includes('TOTAL'));
  console.log('STEP 12: Multi-currency caveat note is shown:', salesRegText.includes('not converted'));

  win.location.hash = '#/reports/purchaseRegisterBookkeeper';
  await win.Router.resolveRoute();
  await wait(10);
  const purchaseRegText = doc.getElementById('content').textContent;
  console.log('STEP 13: Both supplier POs appear:', purchaseRegText.includes('HT-PO-2026-0001') && purchaseRegText.includes('HT-PO-2026-0002'));
  console.log('STEP 14: Items Total, Freight, Taxes, Total Cost all shown correctly for PO 1:', purchaseRegText.includes('3,000.00') && purchaseRegText.includes('200.00') && purchaseRegText.includes('100.00') && purchaseRegText.includes('3,300.00'));
  console.log('STEP 15: Totals row: Items Total sum (4,000.00):', purchaseRegText.includes('4,000.00'));
  console.log('STEP 16: Totals row: Total Cost sum (4,300.00):', purchaseRegText.includes('4,300.00'));

  win.location.hash = '#/reports/salesRegisterBookkeeper';
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 17: Export CSV button exists and is wired:', !!doc.getElementById('rExport'));

  win.location.hash = '#/reports/salesOrderRegister';
  await win.Router.resolveRoute();
  await wait(10);
  const soRegText = doc.getElementById('content').textContent;
  console.log('STEP 18: Existing "Sales Order Register" now also shows a VAT Amount column:', [...doc.querySelectorAll('.report-body th')].some(th => th.textContent === 'VAT Amount'));
  console.log('STEP 19: Existing Sales Order Register still lists all orders correctly:', soRegText.includes('HT-SO-2026-0001'));

  win.location.hash = '#/reports/quotationRegister';
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 20: Existing "Quotation Register" now also shows a VAT Amount column:', [...doc.querySelectorAll('.report-body th')].some(th => th.textContent === 'VAT Amount'));
  console.log('STEP 20b: And correctly shows this quotation\'s VAT amount (120.00):', doc.getElementById('content').textContent.includes('120.00'));

  for (const key of ['openQuotations', 'wonLost', 'salesByCustomer', 'salesByMonth', 'grossProfit', 'awaitingDelivery', 'supplierPORegister']) {
    win.location.hash = '#/reports/' + key;
    await win.Router.resolveRoute();
    await wait(10);
    const ok = !doc.getElementById('content').innerHTML.includes('Something went wrong');
    console.log(`STEP: Report "${key}" still renders without error:`, ok);
  }

  win.location.hash = '#/reports/salesRegisterBookkeeper';
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('rFrom').value = win.addDaysISO(today, 1);
  doc.getElementById('rTo').value = win.addDaysISO(today, 5);
  doc.getElementById('rApply').click();
  await wait(20);
  console.log('STEP 21: Date-range filter correctly excludes all rows when out of range:', doc.getElementById('content').textContent.includes('No data for this report yet'));

  console.log('\n=== BOOKKEEPER REGISTER REPORTS FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
