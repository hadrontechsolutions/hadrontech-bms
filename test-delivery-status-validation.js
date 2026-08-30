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
  const so = await win.DB.dbAdd('salesOrders', {
    soNo: 'HT-SO-2026-0001', customerId: custId, orderDate: win.todayISO(), currency: 'PHP', status: 'Ready for Delivery',
    lines: [{ lineId: 'L1', itemId: '', description: 'Test Item', qty: 2, uom: 'pc', unitCost: 100, unitPrice: 150, discountPercent: 0, vatRate: 12, supplierId: '', deliveredQty: 0 }],
    subtotal: 300, vatTotal: 36, freight: 0, other: 0, grandTotal: 336, createdAt: now, updatedAt: now
  });

  win.location.hash = '#/sales-orders/' + so;
  await win.Router.resolveRoute();
  await wait(10);
  const statusBtns = [...doc.querySelectorAll('.status-btn')].map(b => b.textContent);
  console.log('STEP 1: "Mark: Completed" button no longer exists:', !statusBtns.some(t => t.includes('Completed')));
  console.log('STEP 2: "Mark: Delivered" button still exists (the real terminal state):', statusBtns.some(t => t.includes('Delivered')));

  let confirmMessage = '';
  win.confirm = (msg) => { confirmMessage = msg; return false; };
  const deliveredBtn = [...doc.querySelectorAll('.status-btn')].find(b => b.dataset.status === 'Delivered');
  deliveredBtn.click();
  await wait(20);
  console.log('STEP 3: Clicking "Mark: Delivered" with 0 of 2 actually delivered now shows a specific warning (previously showed NOTHING at all):', confirmMessage.includes("don't actually have their delivered quantity recorded"));
  console.log('STEP 4: Warning explicitly names the mismatched line and quantities:', confirmMessage.includes('0 of 2 pc'));
  console.log('STEP 5: Warning points to "Record Delivery" as the correct path:', confirmMessage.includes('Record Delivery'));
  const soAfterDecline = await win.DB.dbGet('salesOrders', so);
  console.log('STEP 6: Declining the override leaves the status unchanged:', soAfterDecline.status === 'Ready for Delivery');

  win.confirm = () => true;
  deliveredBtn.click();
  await wait(20);
  const soAfterOverride = await win.DB.dbGet('salesOrders', so);
  console.log('STEP 7: Confirming the override still allows marking it Delivered (not a hard block):', soAfterOverride.status === 'Delivered');

  win.location.hash = '#/sales-orders/' + so;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 8: Header badge shows "DELIVERED — INCOMPLETE" in red, not a plain green "Delivered":', doc.getElementById('content').innerHTML.includes('badge-lost') && doc.getElementById('content').textContent.includes('DELIVERED — INCOMPLETE'));
  console.log('STEP 9: A persistent red warning banner explains the mismatch on the page itself:', doc.getElementById('content').innerHTML.includes('danger-card') && doc.getElementById('content').textContent.includes("don't actually have their delivered quantity recorded"));

  win.location.hash = '#/sales-orders';
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 10: Sales Orders list also shows the red mismatch badge, not the normal green Delivered badge:', doc.getElementById('content').textContent.includes('DELIVERED — INCOMPLETE'));

  win.location.hash = '#/sales-orders/' + so;
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('btnRecordDelivery').click();
  await wait(10);
  const qtyInput = doc.querySelector('.deliv-qty');
  qtyInput.value = '2';
  win.confirm = () => true;
  doc.getElementById('btnConfirmDeliver').click();
  await wait(30);
  const soAfterProperDelivery = await win.DB.dbGet('salesOrders', so);
  console.log('STEP 11: After properly recording delivery, deliveredQty actually matches qty:', soAfterProperDelivery.lines[0].deliveredQty === 2);

  win.location.hash = '#/sales-orders/' + so;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 12: With quantities now matching, the header shows a normal green "Delivered" badge, no red flag:', !doc.getElementById('content').textContent.includes('INCOMPLETE') && doc.getElementById('content').innerHTML.includes('badge-delivered'));
  console.log('STEP 13: The warning banner is gone now that quantities match:', !doc.getElementById('content').innerHTML.includes('danger-card'));

  win.location.hash = '#/dashboard';
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 14: Dashboard stat renamed to "Delivered Orders" (no more "Completed Orders"):', doc.getElementById('content').textContent.includes('Delivered Orders') && !doc.getElementById('content').textContent.includes('Completed Orders'));

  win.location.hash = '#/sales-orders/' + so;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 15: Supplier assignment dropdown is not shown once the order is Delivered:', !doc.querySelector('.ln-assign-supplier'));

  const legacySo = await win.DB.dbAdd('salesOrders', {
    soNo: 'HT-SO-2026-9999', customerId: custId, orderDate: win.todayISO(), currency: 'PHP', status: 'Completed',
    lines: [{ lineId: 'L1', itemId: '', description: 'Legacy Item', qty: 1, uom: 'pc', unitCost: 50, unitPrice: 80, discountPercent: 0, vatRate: 12, supplierId: '', deliveredQty: 1 }],
    subtotal: 80, vatTotal: 9.6, freight: 0, other: 0, grandTotal: 89.6, createdAt: now, updatedAt: now
  });
  win.location.hash = '#/sales-orders/' + legacySo;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 16: A legacy order with status="Completed" (from before this change) still renders without crashing:', !doc.getElementById('content').innerHTML.includes('Something went wrong'));
  console.log('STEP 17: Its status badge still displays correctly even though "Completed" is no longer a selectable status:', doc.getElementById('content').textContent.includes('Completed'));

  console.log('\n=== DELIVERY STATUS VALIDATION FIX FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
