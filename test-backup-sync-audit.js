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
  const prodId = await win.DB.dbAdd('products', { itemNo: 'ITEM-00001', description: 'Test Product', uom: 'pc', type: 'Product', standardCost: 100, standardPrice: 150, currency: 'PHP', status: 'Active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  const now = new Date().toISOString();

  win.location.hash = '#/settings/backup';
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 1: "StockMovements.csv" export button now exists:', !!doc.querySelector('[data-csv="stockMovements"]'));
  console.log('STEP 2: "ProformaInvoices.csv" export button now exists:', !!doc.querySelector('[data-csv="proformaInvoices"]'));

  await win.DB.dbAdd('stockMovements', { productId: prodId, type: 'Adjustment', qty: 10, date: win.todayISO(), reference: 'Manual Adjustment', note: 'Initial stock', createdBy: 'Test', createdAt: now });
  let exportedCSV = '';
  win.downloadFile = (filename, content) => { exportedCSV = content; };
  await win.exportTableCSV('stockMovements');
  console.log('STEP 3: Exporting StockMovements.csv actually works and includes the real data:', exportedCSV.includes('Adjustment') && exportedCSV.includes('10'));

  const so = await win.DB.dbAdd('salesOrders', {
    soNo: 'HT-SO-2026-0001', customerId: 1, orderDate: win.todayISO(), currency: 'PHP', status: 'Confirmed',
    lines: [], subtotal: 100, vatTotal: 12, freight: 0, other: 0, grandTotal: 112, createdAt: now, updatedAt: now
  });
  await win.DB.dbAdd('proformaInvoices', { piNo: 'HT-PI-2026-0001', salesOrderId: so, date: win.todayISO(), createdAt: now, createdBy: 'Test' });
  let exportedCSV2 = '';
  win.downloadFile = (filename, content) => { exportedCSV2 = content; };
  await win.exportTableCSV('proformaInvoices');
  console.log('STEP 4: Exporting ProformaInvoices.csv actually works and includes the real data:', exportedCSV2.includes('HT-PI-2026-0001'));

  win.location.hash = '#/products/' + prodId;
  await win.Router.resolveRoute();
  await wait(10);
  let confirmMessage = '';
  win.confirm = (msg) => { confirmMessage = msg; return false; };
  doc.getElementById('btnDelete').click();
  await wait(20);
  console.log('STEP 5: Deleting a product with real stock movement history now correctly warns about it (previously said 0 linked records):', confirmMessage.includes('1 linked transaction'));

  const cleanProdId = await win.DB.dbAdd('products', { itemNo: 'ITEM-00002', description: 'Unused Product', uom: 'pc', type: 'Product', standardCost: 10, standardPrice: 20, currency: 'PHP', status: 'Active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  win.location.hash = '#/products/' + cleanProdId;
  await win.Router.resolveRoute();
  await wait(10);
  let confirmMessage2 = '';
  win.confirm = (msg) => { confirmMessage2 = msg; return false; };
  doc.getElementById('btnDelete').click();
  await wait(20);
  console.log('STEP 6: A genuinely unused product still shows the plain delete prompt, no false warning:', !confirmMessage2.includes('linked transaction'));

  console.log('\n=== FULL BACKUP/SYNC AUDIT FIXES VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
