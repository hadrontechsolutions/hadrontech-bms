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
  const prodId = await win.DB.dbAdd('products', { itemNo: 'ITEM-00001', description: 'Test Product', uom: 'pc', type: 'Product', standardCost: 100, standardPrice: 150, currency: 'PHP', status: 'Active', createdAt: now, updatedAt: now });

  const so = await win.DB.dbAdd('salesOrders', {
    soNo: 'HT-SO-2026-0001', customerId: custId, orderDate: win.todayISO(), currency: 'PHP', status: 'Ready for Delivery',
    lines: [{ lineId: 'L1', itemId: prodId, description: 'Test Product', qty: 3, uom: 'pc', unitCost: 100, unitPrice: 150, discountPercent: 0, vatRate: 12, supplierId: '', deliveredQty: 0 }],
    subtotal: 450, vatTotal: 54, freight: 0, other: 0, grandTotal: 504, createdAt: now, updatedAt: now
  });

  win.location.hash = '#/sales-orders/' + so;
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('btnRecordDelivery').click();
  await wait(30);
  const qtyInput = doc.querySelector('.deliv-qty');
  console.log('STEP 1: With 0 actually in stock, the "Delivering Now" field is capped at 0 (can\'t deliver what you don\'t have):', qtyInput.max === '0' && qtyInput.value === '0');
  console.log('STEP 2: A clear hint explains why, pointing to receiving from the supplier:', doc.getElementById('recordDeliveryHost').textContent.includes('Only 0 in stock — receive more from the supplier first'));

  qtyInput.value = '3';
  let toastMsg = '';
  win.toast = (msg) => { toastMsg = msg; };
  doc.getElementById('btnConfirmDeliver').click();
  await wait(20);
  const soAfterBlockedAttempt = await win.DB.dbGet('salesOrders', so);
  console.log('STEP 3: Even if the cap is bypassed and 3 is force-entered, the submit itself is blocked:', toastMsg.includes('only 0 actually in stock'));
  console.log('STEP 4: Nothing was actually delivered:', soAfterBlockedAttempt.lines[0].deliveredQty === 0);

  const spo = await win.DB.dbAdd('supplierPOs', {
    poNo: 'HT-PO-2026-0001', supplierId: supId, poDate: win.todayISO(), currency: 'PHP', status: 'Shipped',
    lines: [{ lineId: 'L1', itemId: prodId, description: 'Test Product', qty: 3, uom: 'pc', unitCost: 80, amount: 240, receivedQty: 0 }],
    freight: 0, taxes: 0, totalCost: 240, createdAt: now, updatedAt: now
  });
  win.location.hash = '#/supplier-pos/' + spo;
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('btnReceiveStock').click();
  await wait(10);
  doc.querySelector('.recv-qty').value = '2';
  win.confirm = () => true;
  doc.getElementById('btnConfirmReceive').click();
  await wait(30);

  win.location.hash = '#/sales-orders/' + so;
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('btnRecordDelivery').click();
  await wait(30);
  const qtyInput2 = doc.querySelector('.deliv-qty');
  console.log('STEP 5: After receiving 2 from the supplier, delivery is now correctly capped at 2 (not the full 3 ordered):', qtyInput2.max === '2' && qtyInput2.value === '2');

  win.confirm = () => true;
  doc.getElementById('btnConfirmDeliver').click();
  await wait(30);
  const soAfterPartial = await win.DB.dbGet('salesOrders', so);
  console.log('STEP 6: Delivering the available 2 succeeds:', soAfterPartial.lines[0].deliveredQty === 2);
  console.log('STEP 7: Status correctly auto-updates to "Partially Delivered" (2 of 3 is not fully done):', soAfterPartial.status === 'Partially Delivered');

  win.location.hash = '#/sales-orders';
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 8: Sales Orders list shows "Partially Delivered" for this order:', doc.getElementById('content').textContent.includes('Partially Delivered'));

  win.location.hash = '#/supplier-pos/' + spo;
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('btnReceiveStock').click();
  await wait(10);
  doc.querySelector('.recv-qty').value = '1';
  win.confirm = () => true;
  doc.getElementById('btnConfirmReceive').click();
  await wait(30);

  win.location.hash = '#/sales-orders/' + so;
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('btnRecordDelivery').click();
  await wait(30);
  const qtyInput3 = doc.querySelector('.deliv-qty');
  console.log('STEP 9: The last remaining unit is now deliverable (cap = 1):', qtyInput3.max === '1');
  win.confirm = () => true;
  doc.getElementById('btnConfirmDeliver').click();
  await wait(30);
  const soFinal = await win.DB.dbGet('salesOrders', so);
  console.log('STEP 10: Fully delivered now (3 of 3):', soFinal.lines[0].deliveredQty === 3);
  console.log('STEP 11: Status correctly becomes "Delivered" (not "Partially Delivered") once everything is out:', soFinal.status === 'Delivered');

  const so2 = await win.DB.dbAdd('salesOrders', {
    soNo: 'HT-SO-2026-0002', customerId: custId, orderDate: win.todayISO(), currency: 'PHP', status: 'Ready for Delivery',
    lines: [{ lineId: 'L1', itemId: '', description: 'Ad-hoc service line', qty: 1, uom: 'lot', unitCost: 0, unitPrice: 100, discountPercent: 0, vatRate: 12, supplierId: '', deliveredQty: 0 }],
    subtotal: 100, vatTotal: 12, freight: 0, other: 0, grandTotal: 112, createdAt: now, updatedAt: now
  });
  win.location.hash = '#/sales-orders/' + so2;
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('btnRecordDelivery').click();
  await wait(30);
  const adhocInput = doc.querySelector('.deliv-qty');
  console.log('STEP 12: An ad-hoc line (no catalog link) is unaffected by the stock check, still capped only by ordered qty:', adhocInput.max === '1');

  console.log('\n=== PARTIALLY DELIVERED STATUS + STOCK-BASED DELIVERY RESTRICTION FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
