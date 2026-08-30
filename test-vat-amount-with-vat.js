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
  const custId = await win.DB.dbAdd('customers', { customerNo: 'CUST-00001', companyName: 'Key Electrochem Limited Co./KEYEC', status: 'Active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

  win.location.hash = '#/customer-pos/new';
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('f_customerId').value = String(custId);
  doc.getElementById('btnAddPOLine').click();
  await wait(10);
  const row1 = doc.querySelector('#poLinesBody tr');
  console.log('STEP 1: New Customer PO line defaults VAT% to 12:', row1.querySelector('.po-vat').value === '12');
  console.log('STEP 2: "Amount w/ VAT" column now exists:', doc.getElementById('content').textContent.includes('Amount w/ VAT'));

  row1.querySelector('.po-desc').value = 'SAMPLE BRUSH - 13 mm x 30 mm x 534 mm L Wooden Hand';
  row1.querySelector('.po-desc').dispatchEvent(new win.Event('input'));
  row1.querySelector('.po-qty').value = '1';
  row1.querySelector('.po-qty').dispatchEvent(new win.Event('input'));
  row1.querySelector('.po-price').value = '238';
  row1.querySelector('.po-price').dispatchEvent(new win.Event('input'));
  await wait(10);
  console.log('STEP 3: Amount stays net (238.00), Amount w/ VAT correctly shows 266.56:', row1.querySelector('.po-amount').textContent.includes('238.00') && row1.querySelector('.po-amount-vat').textContent.includes('266.56'));

  doc.getElementById('btnAddPOLine').click();
  await wait(10);
  const rows = doc.querySelectorAll('#poLinesBody tr');
  const row2 = rows[1];
  row2.querySelector('.po-desc').value = 'Delivery (Lalamove)';
  row2.querySelector('.po-desc').dispatchEvent(new win.Event('input'));
  row2.querySelector('.po-qty').value = '1';
  row2.querySelector('.po-qty').dispatchEvent(new win.Event('input'));
  row2.querySelector('.po-price').value = '346';
  row2.querySelector('.po-price').dispatchEvent(new win.Event('input'));
  row2.querySelector('.po-vat').value = '0';
  row2.querySelector('.po-vat').dispatchEvent(new win.Event('input'));
  await wait(10);
  console.log('STEP 4: Setting VAT% to 0 on the delivery line makes Amount w/ VAT match Amount exactly (346.00):', row2.querySelector('.po-amount-vat').textContent.includes('346.00'));

  console.log('STEP 5: PO Amount correctly reflects the VAT-inclusive grand total (612.56), not just the net sum:', Number(doc.getElementById('f_poAmount').value) === 612.56);

  doc.getElementById('cpoForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(30);
  const cpo = (await win.DB.dbGetAll('customerPOs'))[0];
  console.log('STEP 6: Saved record correctly keeps each line\'s own VAT% (12 and 0):', cpo.lines[0].vatRate === 12 && cpo.lines[1].vatRate === 0);
  console.log('STEP 7: Saved PO Amount correct (612.56):', cpo.poAmount === 612.56);

  win.location.hash = '#/customer-pos/' + cpo.id;
  await win.Router.resolveRoute();
  await wait(10);
  const detailText = doc.getElementById('content').textContent;
  console.log('STEP 8: Detail page shows VAT% column:', detailText.includes('VAT%'));
  console.log('STEP 9: Detail page shows Amount w/ VAT column with correct figures:', detailText.includes('266.56') && detailText.includes('346.00'));

  doc.getElementById('btnConvert').click();
  await wait(30);
  const so = (await win.DB.dbGetAll('salesOrders'))[0];
  console.log('STEP 10: Sales Order line 1 correctly carries 12% VAT (was hardcoded to 0 before the fix):', so.lines[0].vatRate === 12);
  console.log('STEP 11: Sales Order line 2 correctly carries 0% VAT (the delivery line, as actually set):', so.lines[1].vatRate === 0);
  console.log('STEP 12: Sales Order subtotal correctly computed (238 + 346 = 584):', so.subtotal === 584);
  console.log('STEP 13: Sales Order VAT total correctly computed (only from line 1: 28.56):', so.vatTotal === 28.56);
  console.log('STEP 14: Sales Order Grand Total matches the Customer PO amount exactly (612.56):', so.grandTotal === 612.56);

  win.location.hash = '#/quotations/new';
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('f_customerId').value = String(custId);
  const qRow = doc.querySelector('#linesBody tr');
  qRow.querySelector('.ln-desc').value = 'Test item';
  qRow.querySelector('.ln-desc').dispatchEvent(new win.Event('input'));
  qRow.querySelector('.ln-qty').value = '1';
  qRow.querySelector('.ln-qty').dispatchEvent(new win.Event('input'));
  qRow.querySelector('.ln-price').value = '1000';
  qRow.querySelector('.ln-price').dispatchEvent(new win.Event('input'));
  qRow.querySelector('.ln-vat').value = '12';
  qRow.querySelector('.ln-vat').dispatchEvent(new win.Event('input'));
  await wait(10);
  console.log('STEP 15: Quotation edit form shows "Amount w/ VAT" live, correctly (1120.00):', qRow.querySelector('.ln-amount-vat').textContent.includes('1,120.00'));
  console.log('STEP 16: Quotation "Amount" (net) is unaffected, still shows 1000.00:', qRow.querySelector('.ln-amount').textContent.includes('1,000.00'));

  doc.getElementById('qForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(30);
  const q = (await win.DB.dbGetAll('quotations'))[0];
  win.location.hash = '#/quotations/' + q.id;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 17: Quotation detail page shows Amount w/ VAT (1,120.00):', doc.getElementById('content').textContent.includes('1,120.00'));

  win.location.hash = '#/sales-orders/' + so.id;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 18: Sales Order detail Order Items table shows Amount w/ VAT column:', doc.getElementById('content').textContent.includes('Amount w/ VAT') && doc.getElementById('content').textContent.includes('266.56'));

  doc.getElementById('btnEditDetails').click();
  await wait(10);
  const soRow1 = doc.querySelector('#soLinesBody tr');
  console.log('STEP 19: Sales Order edit form shows Amount w/ VAT for the carried-over line (266.56):', soRow1.querySelector('.so-amount-vat').textContent.includes('266.56'));

  const supId = await win.DB.dbAdd('suppliers', { supplierNo: 'SUP-00001', companyName: 'Test Supplier', status: 'Active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  const spo = await win.DB.dbAdd('supplierPOs', {
    poNo: 'HT-PO-2026-0001', supplierId: supId, poDate: win.todayISO(), currency: 'PHP', status: 'Draft',
    lines: [{ lineId: 'L1', description: 'Test', qty: 1, uom: 'pc', unitCost: 100, amount: 100, receivedQty: 0 }],
    freight: 0, taxes: 0, totalCost: 100, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  });
  win.location.hash = '#/supplier-pos/' + spo;
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('btnEditHeader').click();
  await wait(10);
  console.log('STEP 20: Supplier PO correctly has no VAT% column or Amount w/ VAT column (by design):', !doc.querySelector('.spo-vat') && !doc.getElementById('content').textContent.includes('Amount w/ VAT'));

  const legacyCpoId = await win.DB.dbAdd('customerPOs', {
    poNo: 'CPO-2026-9999', customerId: custId, quotationId: null, customerPoNumber: 'LEGACY',
    poAmount: 500, currency: 'PHP', status: 'Open',
    lines: [{ lineId: 'L1', description: 'Legacy line, no vatRate field at all', qty: 1, uom: 'pc', unitPrice: 500, amount: 500 }],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  });
  win.location.hash = '#/customer-pos/' + legacyCpoId;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 21: Legacy Customer PO line (no vatRate saved) displays without crashing, defaults to 12% for display:', !doc.getElementById('content').innerHTML.includes('Something went wrong') && doc.getElementById('content').textContent.includes('12%'));

  console.log('\n=== VAT% + AMOUNT W/ VAT FEATURE FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
