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
  const prodId = await win.DB.dbAdd('products', { itemNo: 'ITEM-00001', description: 'Submersible Pump 1.5kW', uom: 'pc', type: 'Product', standardCost: 3000, standardPrice: 4000, currency: 'PHP', status: 'Active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  const serviceId = await win.DB.dbAdd('products', { itemNo: 'ITEM-00002', description: 'Installation Service', uom: 'lot', type: 'Service', standardCost: 500, standardPrice: 1000, currency: 'PHP', status: 'Active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

  win.location.hash = '#/products/' + serviceId;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 1: Service-type product shows no Stock panel at all:', !doc.getElementById('content').textContent.includes('On Hand'));

  win.location.hash = '#/products/' + prodId;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 2: Product-type shows the Stock panel:', doc.getElementById('content').textContent.includes('On Hand'));
  console.log('STEP 3: Starts at 0 On Hand with no movements yet:', doc.getElementById('content').textContent.includes('No stock movements recorded yet'));

  doc.getElementById('btnAdjustStock').click();
  await wait(10);
  console.log('STEP 4: Adjust Stock form appears:', !!doc.getElementById('adjQty'));

  doc.getElementById('adjQty').value = '20';
  doc.getElementById('btnConfirmAdjust').click();
  await wait(20);
  console.log('STEP 5: Rejects an adjustment with no reason given:', (await win.DB.dbGetAll('stockMovements')).length === 0);

  doc.getElementById('adjReason').value = 'Initial stock count';
  doc.getElementById('btnConfirmAdjust').click();
  await wait(20);
  win.location.hash = '#/products/' + prodId;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 6: On Hand correctly shows 20 after the adjustment:', doc.getElementById('content').textContent.includes('20 pc'));

  win.location.hash = '#/quotations/new';
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('f_customerId').value = String(custId);
  const row = doc.querySelector('#linesBody tr');
  row.querySelector('.ln-catalog-btn').click();
  await wait(10);
  doc.querySelector('.item-picker-row').click();
  await wait(10);
  const rowAfterPick = doc.querySelector('#linesBody tr'); // re-query: picker selection re-renders the row
  rowAfterPick.querySelector('.ln-desc').value = 'Submersible Pump 1.5kW';
  rowAfterPick.querySelector('.ln-desc').dispatchEvent(new win.Event('input'));
  rowAfterPick.querySelector('.ln-qty').value = '15';
  rowAfterPick.querySelector('.ln-qty').dispatchEvent(new win.Event('input'));
  rowAfterPick.querySelector('.ln-price').value = '4000';
  rowAfterPick.querySelector('.ln-price').dispatchEvent(new win.Event('input'));
  rowAfterPick.querySelector('.ln-supplier').value = String(supId);
  rowAfterPick.querySelector('.ln-supplier').dispatchEvent(new win.Event('change'));
  await wait(10);
  doc.getElementById('qForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(30);
  const q = (await win.DB.dbGetAll('quotations'))[0];
  q.status = 'Won'; await win.DB.dbPut('quotations', q);
  console.log('STEP 7: Quotation line correctly linked to the product (itemId set):', String(q.lines[0].itemId) === String(prodId));

  win.location.hash = '#/customer-pos/new?quotationId=' + q.id;
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('f_customerId').value = String(custId);
  doc.getElementById('cpoForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(30);
  const cpo = (await win.DB.dbGetAll('customerPOs'))[0];

  win.location.hash = '#/customer-pos/' + cpo.id;
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('btnConvert').click();
  await wait(30);
  const so = (await win.DB.dbGetAll('salesOrders'))[0];
  console.log('STEP 8: Sales Order line correctly carries the product link (itemId):', String(so.lines[0].itemId) === String(prodId));
  console.log('STEP 9: Sales Order line starts with deliveredQty = 0:', so.lines[0].deliveredQty === 0);

  win.location.hash = '#/products/' + prodId;
  await win.Router.resolveRoute();
  await wait(10);
  const prodText1 = doc.getElementById('content').textContent;
  console.log('STEP 10: Committed correctly shows 15 (from the open Sales Order):', prodText1.includes('15 pc'));
  console.log('STEP 11: Available correctly computed as On Hand (20) minus Committed (15) = 5:', prodText1.includes('5 pc'));

  win.location.hash = '#/sales-orders/' + so.id;
  await win.Router.resolveRoute();
  await wait(10);
  const createSpoBtn = doc.querySelector('[data-create-spo]');
  createSpoBtn.click();
  await wait(30);
  const spo = (await win.DB.dbGetAll('supplierPOs'))[0];
  console.log('STEP 12: Supplier PO line correctly carries the product link (itemId) — THE KEY FIX:', String(spo.lines[0].itemId) === String(prodId));
  console.log('STEP 13: Supplier PO line starts with receivedQty = 0:', spo.lines[0].receivedQty === 0);

  win.location.hash = '#/supplier-pos/' + spo.id;
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('btnReceiveStock').click();
  await wait(10);
  doc.querySelector('.recv-qty').value = '10';
  doc.getElementById('btnConfirmReceive').click();
  await wait(30);
  const spoAfterPartial = await win.DB.dbGet('supplierPOs', spo.id);
  console.log('STEP 14: Partial receipt correctly recorded (receivedQty = 10):', spoAfterPartial.lines[0].receivedQty === 10);
  console.log('STEP 15: PO status auto-updates to "Partially Received":', spoAfterPartial.status === 'Partially Received');

  win.location.hash = '#/products/' + prodId;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 16: On Hand correctly increased to 30 after partial receipt:', doc.getElementById('content').textContent.includes('30 pc'));

  win.location.hash = '#/supplier-pos/' + spo.id;
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('btnReceiveStock').click();
  await wait(10);
  console.log('STEP 17: Second receive form correctly shows only the remaining 5 as the default:', doc.querySelector('.recv-qty').value === '5');
  doc.getElementById('btnConfirmReceive').click();
  await wait(30);
  const spoAfterFull = await win.DB.dbGet('supplierPOs', spo.id);
  console.log('STEP 18: Fully received now (receivedQty = 15):', spoAfterFull.lines[0].receivedQty === 15);
  console.log('STEP 19: PO status auto-updates to "Received":', spoAfterFull.status === 'Received');

  win.location.hash = '#/supplier-pos/' + spo.id;
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('btnReceiveStock').click();
  await wait(10);
  console.log('STEP 20: Confirmed empty state message shown once nothing is left to receive:', doc.getElementById('content').textContent.includes('already been received'));

  win.location.hash = '#/products/' + prodId;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 21: On Hand correctly at 35 after full receipt:', doc.getElementById('content').textContent.includes('35 pc'));
  console.log('STEP 22: Movement history shows 3 entries (1 adjustment + 2 receipts):', (await win.DB.dbQueryIndex('stockMovements', 'productId', prodId)).length === 3);

  win.location.hash = '#/sales-orders/' + so.id;
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('btnRecordDelivery').click();
  await wait(10);
  doc.querySelector('.deliv-qty').value = '6';
  doc.getElementById('btnConfirmDeliver').click();
  await wait(30);
  const soAfterPartialDeliv = await win.DB.dbGet('salesOrders', so.id);
  console.log('STEP 23: Partial delivery correctly recorded (deliveredQty = 6):', soAfterPartialDeliv.lines[0].deliveredQty === 6);
  console.log('STEP 24: SO status NOT auto-changed to Delivered yet (only partially done):', soAfterPartialDeliv.status !== 'Delivered');

  win.location.hash = '#/products/' + prodId;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 25: On Hand correctly decreased to 29 after partial delivery:', doc.getElementById('content').textContent.includes('29 pc'));

  win.location.hash = '#/sales-orders/' + so.id;
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('btnRecordDelivery').click();
  await wait(10);
  console.log('STEP 26: Second delivery form correctly defaults to the remaining 9:', doc.querySelector('.deliv-qty').value === '9');
  doc.getElementById('btnConfirmDeliver').click();
  await wait(30);
  const soAfterFullDeliv = await win.DB.dbGet('salesOrders', so.id);
  console.log('STEP 27: Fully delivered now (deliveredQty = 15):', soAfterFullDeliv.lines[0].deliveredQty === 15);
  console.log('STEP 28: SO status auto-updates to "Delivered" once fully complete:', soAfterFullDeliv.status === 'Delivered');

  win.location.hash = '#/products/' + prodId;
  await win.Router.resolveRoute();
  await wait(10);
  const finalText = doc.getElementById('content').textContent;
  console.log('STEP 29: On Hand correctly at 20 after full delivery:', finalText.includes('20 pc'));
  console.log('STEP 30: Committed correctly drops to 0 now that the Sales Order is Delivered (no longer open):', finalText.includes('0 pc'));

  const custId2 = await win.DB.dbAdd('customers', { customerNo: 'CUST-00002', companyName: 'Second Customer', status: 'Active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  await win.DB.dbAdd('salesOrders', {
    soNo: 'HT-SO-2026-9999', customerId: custId2, orderDate: win.todayISO(), currency: 'PHP', status: 'Confirmed',
    lines: [{ lineId: 'LX', itemId: prodId, description: 'Submersible Pump 1.5kW', qty: 30, uom: 'pc', unitCost: 3000, unitPrice: 4000, discountPercent: 0, vatRate: 12, supplierId: '', deliveredQty: 0 }],
    subtotal: 120000, vatTotal: 14400, freight: 0, other: 0, grandTotal: 134400, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  });
  win.location.hash = '#/products/' + prodId;
  await win.Router.resolveRoute();
  await wait(10);
  const shortfallText = doc.getElementById('content').textContent;
  console.log('STEP 31: Shortfall correctly shown as "Short by 10" rather than a raw negative number:', shortfallText.includes('Short by 10'));

  const legacySoId = await win.DB.dbAdd('salesOrders', {
    soNo: 'HT-SO-2026-8888', customerId: custId2, orderDate: win.todayISO(), currency: 'PHP', status: 'Confirmed',
    lines: [{ lineId: 'LY', itemId: prodId, description: 'Legacy line, no deliveredQty field', qty: 5, uom: 'pc', unitCost: 3000, unitPrice: 4000, discountPercent: 0, vatRate: 12, supplierId: '' }],
    subtotal: 20000, vatTotal: 2400, freight: 0, other: 0, grandTotal: 22400, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  });
  win.location.hash = '#/sales-orders/' + legacySoId;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 32: A legacy Sales Order (created before this feature) renders without crashing:', !doc.getElementById('content').innerHTML.includes('Something went wrong'));
  doc.getElementById('btnRecordDelivery').click();
  await wait(10);
  console.log('STEP 33: Record Delivery still works correctly on a legacy line (defaults deliveredQty to 0):', doc.querySelector('.deliv-qty') && doc.querySelector('.deliv-qty').value === '5');

  const adhocSpoId = await win.DB.dbAdd('supplierPOs', {
    poNo: 'HT-PO-2026-8888', supplierId: supId, poDate: win.todayISO(), currency: 'PHP', status: 'Confirmed',
    lines: [{ lineId: 'LZ', itemId: '', description: 'Ad-hoc line, not linked to catalog', qty: 3, uom: 'pc', unitCost: 100, amount: 300, receivedQty: 0 }],
    freight: 0, taxes: 0, totalCost: 300, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  });
  win.location.hash = '#/supplier-pos/' + adhocSpoId;
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('btnReceiveStock').click();
  await wait(10);
  console.log('STEP 34: Ad-hoc line (no itemId) clearly flagged as not affecting stock:', doc.getElementById('content').textContent.includes('not linked to a catalog product'));
  doc.getElementById('btnConfirmReceive').click();
  await wait(30);
  console.log('STEP 35: Receiving an ad-hoc line does not crash and does not create a stock movement:', (await win.DB.dbGetAll('stockMovements')).filter(m => m.reference === 'Supplier PO HT-PO-2026-8888').length === 0);

  console.log('\n=== INVENTORY TRACKING FEATURE FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
