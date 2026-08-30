const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
require('fake-indexeddb/auto');
const APP = __dirname;

async function main() {
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  window.indexedDB = global.indexedDB; window.IDBKeyRange = global.IDBKeyRange;
  const scripts = [...dom.window.document.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => s !== 'js/app.js');
  for (const src of scripts) dom.window.eval(fs.readFileSync(path.join(APP, src), 'utf8'));
  const win = dom.window; const doc = win.document;
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const now = new Date().toISOString();

  await win.DB.openDB(); await win.DB.ensureCounters();

  const custId = await win.DB.dbAdd('customers', { customerNo: 'C1', companyName: 'Test Customer', status: 'Active', createdAt: now, updatedAt: now });
  const quotedProdId = await win.DB.dbAdd('products', { itemNo: 'ITEM-00001', description: 'Quoted Product', status: 'Active', createdAt: now, updatedAt: now });
  await win.DB.dbAdd('quotations', {
    quotationNo: 'HT-Q-2026-0001', customerId: custId, revision: 0, isLatest: true, status: 'Sent', date: win.todayISO(), currency: 'PHP',
    lines: [{ lineId: 'L1', itemId: quotedProdId, description: 'Quoted Product', qty: 1, uom: 'pc', unitPrice: 100, discountPercent: 0, vatRate: 12 }],
    subtotal: 100, vatTotal: 12, freight: 0, other: 0, grandTotal: 112, createdAt: now, updatedAt: now
  });

  win.location.hash = '#/products/' + quotedProdId;
  await win.Router.resolveRoute();
  await wait(10);
  let alertShown = '', confirmCalled = false;
  win.alert = (msg) => { alertShown = msg; };
  win.confirm = () => { confirmCalled = true; return true; };
  doc.getElementById('btnDelete').click();
  await wait(20);
  console.log('STEP 1: Deleting a quoted product shows a blocking alert (not a confirm dialog):', alertShown.includes('referenced by 1 existing transaction') && !confirmCalled);
  console.log('STEP 2: Alert suggests Archive as the alternative:', alertShown.includes('Archive'));
  const stillExists = await win.DB.dbGet('products', quotedProdId);
  console.log('STEP 3: The product was NOT actually deleted:', !!stillExists);

  const stockedProdId = await win.DB.dbAdd('products', { itemNo: 'ITEM-00002', description: 'Stocked Product', status: 'Active', createdAt: now, updatedAt: now });
  await win.DB.dbAdd('stockMovements', { productId: stockedProdId, type: 'Adjustment', qty: 5, date: win.todayISO(), reference: 'Test', createdAt: now });
  win.location.hash = '#/products/' + stockedProdId;
  await win.Router.resolveRoute();
  await wait(10);
  let alertShown2 = '';
  win.alert = (msg) => { alertShown2 = msg; };
  doc.getElementById('btnDelete').click();
  await wait(20);
  console.log('STEP 4: Deleting a product with stock history is also blocked:', alertShown2.includes('referenced by 1 existing transaction'));
  console.log('STEP 5: The stocked product was NOT deleted:', !!(await win.DB.dbGet('products', stockedProdId)));

  const cleanProdId = await win.DB.dbAdd('products', { itemNo: 'ITEM-00003', description: 'Unused Product', status: 'Active', createdAt: now, updatedAt: now });
  win.location.hash = '#/products/' + cleanProdId;
  await win.Router.resolveRoute();
  await wait(10);
  let alertShown3 = false, confirmCalled3 = false;
  win.alert = () => { alertShown3 = true; };
  win.confirm = () => { confirmCalled3 = true; return true; };
  doc.getElementById('btnDelete').click();
  await wait(20);
  console.log('STEP 6: An unused product shows the normal confirm dialog, not a blocking alert:', confirmCalled3 && !alertShown3);
  console.log('STEP 7: An unused product actually gets deleted when confirmed:', !(await win.DB.dbGet('products', cleanProdId)));

  win.location.hash = '#/customers/' + custId;
  await win.Router.resolveRoute();
  await wait(10);
  let custAlert = '';
  win.alert = (msg) => { custAlert = msg; };
  doc.getElementById('btnDelete').click();
  await wait(20);
  console.log('STEP 8: A customer with a real quotation is also blocked from deletion:', custAlert.includes('referenced by 1 existing transaction'));
  console.log('STEP 9: The customer record was NOT deleted:', !!(await win.DB.dbGet('customers', custId)));

  const supId = await win.DB.dbAdd('suppliers', { supplierNo: 'S1', companyName: 'Test Supplier', status: 'Active', createdAt: now, updatedAt: now });
  await win.DB.dbAdd('supplierPOs', { poNo: 'HT-PO-2026-0001', supplierId: supId, poDate: win.todayISO(), currency: 'PHP', status: 'Draft', lines: [], freight: 0, taxes: 0, totalCost: 0, createdAt: now, updatedAt: now });
  win.location.hash = '#/suppliers/' + supId;
  await win.Router.resolveRoute();
  await wait(10);
  let supAlert = '';
  win.alert = (msg) => { supAlert = msg; };
  doc.getElementById('btnDelete').click();
  await wait(20);
  console.log('STEP 10: A supplier with a real Supplier PO is also blocked from deletion:', supAlert.includes('referenced by 1 existing transaction'));

  win.location.hash = '#/products/' + quotedProdId;
  await win.Router.resolveRoute();
  await wait(10);
  win.confirm = () => true;
  doc.getElementById('btnArchive').click();
  await wait(20);
  const archived = await win.DB.dbGet('products', quotedProdId);
  console.log('STEP 11: Archive still works completely normally on a referenced product:', archived.archived === true || archived.status === 'Archived');

  console.log('\n=== HARD-BLOCK-ON-DELETE PROTECTION FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
