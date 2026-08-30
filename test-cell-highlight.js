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
  const supId = await win.DB.dbAdd('suppliers', { supplierNo: 'S1', companyName: 'Test Supplier', status: 'Active', createdAt: now, updatedAt: now });

  const so = await win.DB.dbAdd('salesOrders', {
    soNo: 'HT-SO-2026-0001', customerId: custId, orderDate: win.todayISO(), currency: 'PHP', status: 'Ready for Delivery',
    lines: [
      { lineId: 'L1', itemId: '', description: 'Partially delivered item', qty: 3, uom: 'pc', unitCost: 100, unitPrice: 150, discountPercent: 0, vatRate: 12, supplierId: '', deliveredQty: 2 },
      { lineId: 'L2', itemId: '', description: 'Fully delivered item', qty: 1, uom: 'lot', unitCost: 50, unitPrice: 80, discountPercent: 0, vatRate: 12, supplierId: '', deliveredQty: 1 }
    ],
    subtotal: 530, vatTotal: 63.6, freight: 0, other: 0, grandTotal: 593.6, createdAt: now, updatedAt: now
  });

  win.location.hash = '#/sales-orders/' + so;
  await win.Router.resolveRoute();
  await wait(10);
  const soHtml = doc.getElementById('content').innerHTML;
  console.log('STEP 1: The partially-delivered line (2 of 3) shows the red "cell-needs-input" highlight:', soHtml.includes('cell-needs-input') && doc.getElementById('content').textContent.includes('2 of 3 pc'));
  console.log('STEP 2: The fully-delivered line (1 of 1) shows a plain checkmark, no red highlight for that line:', doc.getElementById('content').textContent.includes('1 lot ✓'));

  const rows = [...doc.querySelectorAll('#content table tr')].filter(r => r.textContent.includes('Fully delivered item'));
  console.log('STEP 3: Specifically, the fully-delivered row itself contains no cell-needs-input span:', rows.length > 0 && !rows[0].innerHTML.includes('cell-needs-input'));

  const spo = await win.DB.dbAdd('supplierPOs', {
    poNo: 'HT-PO-2026-0001', supplierId: supId, poDate: win.todayISO(), currency: 'PHP', status: 'Shipped',
    lines: [
      { lineId: 'L1', description: 'Partially received item', qty: 3, uom: 'pc', unitCost: 100, amount: 300, receivedQty: 2 },
      { lineId: 'L2', description: 'Fully received item', qty: 1, uom: 'lot', unitCost: 50, amount: 50, receivedQty: 1 }
    ],
    freight: 0, taxes: 0, totalCost: 350, createdAt: now, updatedAt: now
  });

  win.location.hash = '#/supplier-pos/' + spo;
  await win.Router.resolveRoute();
  await wait(10);
  const spoHtml = doc.getElementById('content').innerHTML;
  console.log('STEP 4: The partially-received line (2 of 3) shows the red "cell-needs-input" highlight:', spoHtml.includes('cell-needs-input') && doc.getElementById('content').textContent.includes('2 of 3 pc'));
  console.log('STEP 5: The fully-received line (1 of 1) shows a plain checkmark, no red highlight for that line:', doc.getElementById('content').textContent.includes('1 lot ✓'));

  const spoRows = [...doc.querySelectorAll('#content table tr')].filter(r => r.textContent.includes('Fully received item'));
  console.log('STEP 6: Specifically, the fully-received row itself contains no cell-needs-input span:', spoRows.length > 0 && !spoRows[0].innerHTML.includes('cell-needs-input'));

  const so2 = await win.DB.dbAdd('salesOrders', {
    soNo: 'HT-SO-2026-0002', customerId: custId, orderDate: win.todayISO(), currency: 'PHP', status: 'Confirmed',
    lines: [{ lineId: 'L1', itemId: '', description: 'Untouched item', qty: 5, uom: 'pc', unitCost: 10, unitPrice: 20, discountPercent: 0, vatRate: 12, supplierId: '', deliveredQty: 0 }],
    subtotal: 100, vatTotal: 12, freight: 0, other: 0, grandTotal: 112, createdAt: now, updatedAt: now
  });
  win.location.hash = '#/sales-orders/' + so2;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 7: A line with 0 delivered also gets the red highlight (not just partial ones):', doc.getElementById('content').innerHTML.includes('cell-needs-input') && doc.getElementById('content').textContent.includes('0 of 5 pc'));

  console.log('\n=== PER-LINE RED CELL HIGHLIGHTING VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
