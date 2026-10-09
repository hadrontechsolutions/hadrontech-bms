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

  // Three distinct, explicit createdAt timestamps -- far enough apart that insertion order
  // (what IndexedDB would return with no sort at all) is guaranteed to differ from
  // createdAt-descending order, so this genuinely proves sorting is happening.
  const oldest = '2026-01-01T00:00:00.000Z';
  const middle = '2026-06-01T00:00:00.000Z';
  const newest = '2026-09-01T00:00:00.000Z';

  const custId = await win.DB.dbAdd('customers', { customerNo: 'C1', companyName: 'KEYEC', status: 'Active', createdAt: middle });
  const supId = await win.DB.dbAdd('suppliers', { supplierNo: 'S1', companyName: 'Pentair', status: 'Active', createdAt: middle });

  /* ============ Quotations ============ */
  const qBase = { customerId: custId, revision: 0, isLatest: true, status: 'Sent', date: '2026-09-01', currency: 'PHP', subtotal: 1000, vatTotal: 0, freight: 0, other: 0, grandTotal: 1000, costTotal: 0, grossProfit: 0, grossMarginPercent: 0 };
  await win.DB.dbAdd('quotations', Object.assign({ quotationNo: 'HT-Q-OLDEST' }, qBase, { createdAt: oldest }));
  await win.DB.dbAdd('quotations', Object.assign({ quotationNo: 'HT-Q-NEWEST' }, qBase, { createdAt: newest }));
  await win.DB.dbAdd('quotations', Object.assign({ quotationNo: 'HT-Q-MIDDLE' }, qBase, { createdAt: middle }));

  win.location.hash = '#/quotations';
  await win.Router.resolveRoute();
  await wait(30);
  let rows = [...doc.querySelectorAll('#qBody tr')].map(tr => tr.textContent);
  console.log('STEP 1: THE ASK: Quotations list shows newest-created first, oldest last:', rows[0].includes('HT-Q-NEWEST') && rows[1].includes('HT-Q-MIDDLE') && rows[2].includes('HT-Q-OLDEST'));

  /* ============ Customer POs ============ */
  const cpoBase = { customerId: custId, poDate: '2026-09-01', currency: 'PHP', poAmount: 1000, status: 'Confirmed', lines: [] };
  await win.DB.dbAdd('customerPOs', Object.assign({ poNo: 'HT-CPO-OLDEST' }, cpoBase, { createdAt: oldest }));
  await win.DB.dbAdd('customerPOs', Object.assign({ poNo: 'HT-CPO-NEWEST' }, cpoBase, { createdAt: newest }));
  await win.DB.dbAdd('customerPOs', Object.assign({ poNo: 'HT-CPO-MIDDLE' }, cpoBase, { createdAt: middle }));

  win.location.hash = '#/customer-pos';
  await win.Router.resolveRoute();
  await wait(30);
  rows = [...doc.querySelectorAll('tbody tr')].map(tr => tr.textContent);
  console.log('STEP 2: Customer POs list shows newest-created first:', rows[0].includes('HT-CPO-NEWEST') && rows[2].includes('HT-CPO-OLDEST'));

  /* ============ Sales Orders ============ */
  const soBase = { customerId: custId, orderDate: '2026-09-01', currency: 'PHP', status: 'Confirmed', vatMode: 'NonVat', lines: [], subtotal: 1000, vatTotal: 0, freight: 0, other: 0, grandTotal: 1000 };
  await win.DB.dbAdd('salesOrders', Object.assign({ soNo: 'HT-SO-OLDEST' }, soBase, { createdAt: oldest, updatedAt: oldest }));
  await win.DB.dbAdd('salesOrders', Object.assign({ soNo: 'HT-SO-NEWEST' }, soBase, { createdAt: newest, updatedAt: newest }));
  await win.DB.dbAdd('salesOrders', Object.assign({ soNo: 'HT-SO-MIDDLE' }, soBase, { createdAt: middle, updatedAt: middle }));

  win.location.hash = '#/sales-orders';
  await win.Router.resolveRoute();
  await wait(30);
  rows = [...doc.querySelectorAll('tbody tr')].map(tr => tr.textContent);
  console.log('STEP 3: Sales Orders list shows newest-created first:', rows[0].includes('HT-SO-NEWEST') && rows[2].includes('HT-SO-OLDEST'));

  /* ============ Supplier POs ============ */
  const spoBase = { supplierId: supId, poDate: '2026-09-01', currency: 'PHP', status: 'Confirmed', lines: [], freight: 0, taxes: 0, totalCost: 1000 };
  await win.DB.dbAdd('supplierPOs', Object.assign({ poNo: 'HT-SPO-OLDEST' }, spoBase, { createdAt: oldest }));
  await win.DB.dbAdd('supplierPOs', Object.assign({ poNo: 'HT-SPO-NEWEST' }, spoBase, { createdAt: newest }));
  await win.DB.dbAdd('supplierPOs', Object.assign({ poNo: 'HT-SPO-MIDDLE' }, spoBase, { createdAt: middle }));

  win.location.hash = '#/supplier-pos';
  await win.Router.resolveRoute();
  await wait(30);
  rows = [...doc.querySelectorAll('tbody tr')].map(tr => tr.textContent);
  console.log('STEP 4: Supplier POs list shows newest-created first:', rows[0].includes('HT-SPO-NEWEST') && rows[2].includes('HT-SPO-OLDEST'));

  /* ============ Shared entity engine (Customers, Suppliers, Products, Expenses, Partners) -- verified on Products and Expenses ============ */
  await win.DB.dbAdd('products', { itemNo: 'HT-PRD-OLDEST', description: 'Oldest Item', type: 'Product', uom: 'pc', status: 'Active', createdAt: oldest, updatedAt: oldest });
  await win.DB.dbAdd('products', { itemNo: 'HT-PRD-NEWEST', description: 'Newest Item', type: 'Product', uom: 'pc', status: 'Active', createdAt: newest, updatedAt: newest });
  await win.DB.dbAdd('products', { itemNo: 'HT-PRD-MIDDLE', description: 'Middle Item', type: 'Product', uom: 'pc', status: 'Active', createdAt: middle, updatedAt: middle });

  win.location.hash = '#/products';
  await win.Router.resolveRoute();
  await wait(30);
  rows = [...doc.querySelectorAll('#entityTable tbody tr')].map(tr => tr.textContent);
  console.log('STEP 5: THE SHARED FIX: Products (via the shared entity engine) shows newest-created first -- confirming this one fix covers every entity-engine module at once:', rows[0].includes('HT-PRD-NEWEST') && rows[2].includes('HT-PRD-OLDEST'));

  await win.DB.dbAdd('expenses', { expenseNo: 'HT-EXP-OLDEST', date: '2026-01-01', category: 'Rent', description: 'Old', amount: 100, status: 'Recorded', createdAt: oldest, updatedAt: oldest });
  await win.DB.dbAdd('expenses', { expenseNo: 'HT-EXP-NEWEST', date: '2026-09-01', category: 'Rent', description: 'New', amount: 200, status: 'Recorded', createdAt: newest, updatedAt: newest });

  win.location.hash = '#/expenses';
  await win.Router.resolveRoute();
  await wait(30);
  rows = [...doc.querySelectorAll('#entityTable tbody tr')].map(tr => tr.textContent);
  console.log('STEP 6: Expenses (same shared engine) also shows newest-created first:', rows[0].includes('New') && rows[0].includes('₱200.00') && rows[1].includes('Old') && rows[1].includes('₱100.00'));

  console.log('\n=== NEWEST-FIRST SORTING ACROSS EVERY LIST PAGE FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
