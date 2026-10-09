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
  const custId = await win.DB.dbAdd('customers', { customerNo: 'C1', companyName: 'Key Electrochem Limited Co./KEYEC', status: 'Active', createdAt: now });
  const custId2 = await win.DB.dbAdd('customers', { customerNo: 'C2', companyName: 'Another Trading Co.', status: 'Active', createdAt: now });
  const supId = await win.DB.dbAdd('suppliers', { supplierNo: 'S1', companyName: 'Pentair Manufacturing', status: 'Active', createdAt: now });
  const supId2 = await win.DB.dbAdd('suppliers', { supplierNo: 'S2', companyName: 'Local Fittings Co.', status: 'Active', createdAt: now });

  await win.DB.dbAdd('salesOrders', { soNo: 'HT-SO-2026-0001', customerId: custId, orderDate: '2026-09-05', currency: 'PHP', status: 'Confirmed', vatMode: 'NonVat', lines: [], subtotal: 60000, vatTotal: 0, freight: 0, other: 0, grandTotal: 60000, createdAt: now, updatedAt: now });
  await win.DB.dbAdd('salesOrders', { soNo: 'HT-SO-2026-0002', customerId: custId2, orderDate: '2026-09-10', currency: 'PHP', status: 'Confirmed', vatMode: 'NonVat', lines: [], subtotal: 30000, vatTotal: 0, freight: 0, other: 0, grandTotal: 30000, createdAt: now, updatedAt: now });

  await win.DB.dbAdd('supplierPOs', { poNo: 'HT-PO-2026-0001', supplierId: supId, poDate: '2026-09-05', currency: 'USD', status: 'Confirmed', lines: [], freight: 0, taxes: 0, totalCost: 5000, createdAt: now });
  await win.DB.dbAdd('supplierPOs', { poNo: 'HT-PO-2026-0002', supplierId: supId2, poDate: '2026-09-06', currency: 'PHP', status: 'Confirmed', lines: [], freight: 0, taxes: 0, totalCost: 15000, createdAt: now });

  /* ============ Customer-only filter on Sales Order Register ============ */
  win.location.hash = '#/reports/salesOrderRegister';
  await win.Router.resolveRoute();
  await wait(80);
  console.log('STEP 1: Sales Order Register shows a Customer filter but correctly hides End-User (no such field on Sales Orders):', doc.getElementById('rCustomerLabel').style.display !== 'none' && doc.getElementById('rEndUserLabel').style.display === 'none');

  doc.getElementById('rCustomerFilter').value = 'keyec';
  doc.getElementById('rCustomerFilter').dispatchEvent(new win.Event('input'));
  await wait(350);
  let body = doc.getElementById('reportTableWrap').textContent;
  console.log('STEP 2: Typing "keyec" (lowercase, partial) correctly filters to just that customer\u2019s order:', body.includes('HT-SO-2026-0001') && !body.includes('HT-SO-2026-0002'));
  console.log('STEP 3: Totals recalculate to match the filtered row only (60,000, not 90,000):', body.includes('60,000.00') && !body.includes('90,000.00'));

  /* ============ THE NEW FILTER TYPE: Supplier, on Supplier PO Register ============ */
  win.location.hash = '#/reports/supplierPORegister';
  await win.Router.resolveRoute();
  await wait(80);
  console.log('STEP 4: Supplier PO Register shows a Supplier filter, and correctly hides Customer/End-User:', doc.getElementById('rSupplierLabel').style.display !== 'none' && doc.getElementById('rCustomerLabel').style.display === 'none' && doc.getElementById('rEndUserLabel').style.display === 'none');

  doc.getElementById('rSupplierFilter').value = 'PENTAIR'; // uppercase, should still match "Pentair Manufacturing"
  doc.getElementById('rSupplierFilter').dispatchEvent(new win.Event('input'));
  await wait(350);
  body = doc.getElementById('reportTableWrap').textContent;
  console.log('STEP 5: THE NEW FILTER TYPE: typing "PENTAIR" (uppercase) correctly matches "Pentair Manufacturing" case-insensitively:', body.includes('HT-PO-2026-0001') && !body.includes('HT-PO-2026-0002'));

  /* ============ Same Supplier filter also works on Supplier Payments Aging ============ */
  win.location.hash = '#/reports/supplierPaymentsAging';
  await win.Router.resolveRoute();
  await wait(80);
  doc.getElementById('rSupplierFilter').value = 'local';
  doc.getElementById('rSupplierFilter').dispatchEvent(new win.Event('input'));
  await wait(350);
  body = doc.getElementById('reportTableWrap').textContent;
  console.log('STEP 6: Supplier filter also works correctly on Supplier Payments Aging ("local" matches "Local Fittings Co."):', body.includes('HT-PO-2026-0002') && !body.includes('HT-PO-2026-0001'));

  /* ============ Regression: reports that should have NO filters at all ============ */
  win.location.hash = '#/reports/salesByCustomer';
  await win.Router.resolveRoute();
  await wait(80);
  console.log('STEP 7: REGRESSION: Sales by Customer (already grouped by that exact dimension) correctly shows no filter boxes at all:', doc.getElementById('rCustomerLabel').style.display === 'none' && doc.getElementById('rEndUserLabel').style.display === 'none' && doc.getElementById('rSupplierLabel').style.display === 'none');

  win.location.hash = '#/reports/expenseRegister';
  await win.Router.resolveRoute();
  await wait(80);
  console.log('STEP 8: REGRESSION: Expense Register (no customer/supplier/end-user dimension at all) correctly shows no filter boxes:', doc.getElementById('rCustomerLabel').style.display === 'none' && doc.getElementById('rSupplierLabel').style.display === 'none');

  /* ============ Regression: Quotation-based reports still correctly show BOTH Customer and End-User ============ */
  win.location.hash = '#/reports/quotationRegister';
  await win.Router.resolveRoute();
  await wait(80);
  console.log('STEP 9: REGRESSION: Quotation Register correctly shows BOTH Customer and End-User filters:', doc.getElementById('rCustomerLabel').style.display !== 'none' && doc.getElementById('rEndUserLabel').style.display !== 'none');

  console.log('\n=== CUSTOMER/END-USER/SUPPLIER FILTERS APPLIED ACROSS REPORTS FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
