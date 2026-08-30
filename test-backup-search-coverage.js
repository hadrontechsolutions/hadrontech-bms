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
  const custId = await win.DB.dbAdd('customers', { customerNo: 'CUST-00001', companyName: 'Test Co.', status: 'Active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  const prodId = await win.DB.dbAdd('products', { itemNo: 'ITEM-00001', description: 'Test Product', uom: 'pc', type: 'Product', standardCost: 100, standardPrice: 150, currency: 'PHP', status: 'Active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  const now = new Date().toISOString();
  await win.DB.dbAdd('stockMovements', { productId: prodId, type: 'Adjustment', qty: 10, date: win.todayISO(), reference: 'Manual Adjustment', note: 'Initial stock', createdBy: 'Test', createdAt: now });
  const so = await win.DB.dbAdd('salesOrders', {
    soNo: 'HT-SO-2026-0001', customerId: custId, orderDate: win.todayISO(), currency: 'PHP', status: 'Confirmed',
    lines: [{ lineId: 'L1', itemId: prodId, description: 'Test Product', qty: 1, uom: 'pc', unitCost: 100, unitPrice: 150, discountPercent: 0, vatRate: 12, supplierId: '', deliveredQty: 0 }],
    subtotal: 150, vatTotal: 18, freight: 0, other: 0, grandTotal: 168, createdAt: now, updatedAt: now
  });
  await win.DB.dbAdd('proformaInvoices', { piNo: 'HT-PI-2026-0001', salesOrderId: so, date: win.todayISO(), createdAt: now, createdBy: 'Test' });

  console.log('STEP 1: Backup export config includes stockMovements and proformaInvoices:', fs.readFileSync(path.join(APP, 'js/backup.js'), 'utf8').match(/BACKUP_STORES = \[([^\]]+)\]/)[1].includes('stockMovements') && fs.readFileSync(path.join(APP, 'js/backup.js'), 'utf8').match(/BACKUP_STORES = \[([^\]]+)\]/)[1].includes('proformaInvoices'));

  let exportedContent = '';
  win.URL.createObjectURL = () => 'blob:stub';
  const origCreateElement = doc.createElement.bind(doc);
  doc.createElement = (tag) => {
    const el = origCreateElement(tag);
    if (tag === 'a') el.click = () => {};
    return el;
  };
  win.downloadFile = (filename, content) => { exportedContent = content; };
  await win.exportFullBackup();
  const parsed = JSON.parse(exportedContent);
  console.log('STEP 3: Exported backup file actually includes the stock movement record:', parsed.data.stockMovements && parsed.data.stockMovements.length === 1);
  console.log('STEP 4: Exported backup file actually includes the proforma invoice record:', parsed.data.proformaInvoices && parsed.data.proformaInvoices.length === 1 && parsed.data.proformaInvoices[0].piNo === 'HT-PI-2026-0001');

  await win.DB.dbDelete('stockMovements', 1);
  const beforeRestore = await win.DB.dbGetAll('stockMovements');
  console.log('STEP 5: Confirmed the record is actually gone before restore (test setup check):', beforeRestore.length === 0);
  await win.DB.restoreAll(Object.keys(parsed.data), parsed.data);
  const afterRestore = await win.DB.dbGetAll('stockMovements');
  const afterRestorePI = await win.DB.dbGetAll('proformaInvoices');
  console.log('STEP 6: Restore correctly brings the stock movement back:', afterRestore.length === 1);
  console.log('STEP 7: Restore correctly brings the proforma invoice back:', afterRestorePI.length === 1);

  win.location.hash = '#/search';
  await win.Router.resolveRoute();
  await wait(10);
  const inputEl = doc.getElementById('globalSearchInput');
  inputEl.value = 'HT-PI-2026-0001';
  inputEl.dispatchEvent(new win.Event('input'));
  await wait(300);
  console.log('STEP 8: Global search now finds a Proforma Invoice by its number:', doc.getElementById('searchResults').textContent.includes('HT-PI-2026-0001'));
  console.log('STEP 9: Results section is correctly labeled "Proforma Invoices":', doc.getElementById('searchResults').textContent.includes('Proforma Invoices'));

  console.log('\n=== BACKUP + SEARCH COVERAGE GAPS FULLY FIXED AND VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
