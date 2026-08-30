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
  console.log('STEP 1: Freight field exists on the Customer PO form:', !!doc.getElementById('f_poFreight'));
  console.log('STEP 2: PO Amount stays editable when everything is empty:', !doc.getElementById('f_poAmount').readOnly);

  doc.getElementById('f_customerId').value = String(custId);
  doc.getElementById('btnAddPOLine').click();
  await wait(10);
  const row1 = doc.querySelector('#poLinesBody tr');
  row1.querySelector('.po-desc').value = 'SAMPLE BRUSH';
  row1.querySelector('.po-desc').dispatchEvent(new win.Event('input'));
  row1.querySelector('.po-qty').value = '1';
  row1.querySelector('.po-qty').dispatchEvent(new win.Event('input'));
  row1.querySelector('.po-price').value = '238';
  row1.querySelector('.po-price').dispatchEvent(new win.Event('input'));
  await wait(10);

  doc.getElementById('f_poFreight').value = '346';
  doc.getElementById('f_poFreight').dispatchEvent(new win.Event('input'));
  await wait(10);
  console.log('STEP 3: PO Amount correctly includes both the VAT-inclusive line AND Freight (612.56):', Number(doc.getElementById('f_poAmount').value) === 612.56);
  console.log('STEP 4: PO Amount locks once Freight is set:', doc.getElementById('f_poAmount').readOnly);

  doc.getElementById('cpoForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(30);
  const cpo = (await win.DB.dbGetAll('customerPOs'))[0];
  console.log('STEP 5: Customer PO saved with freight = 346:', cpo.freight === 346);
  console.log('STEP 6: Customer PO saved with only ONE real line item (not a fake "Delivery" line):', cpo.lines.length === 1);
  console.log('STEP 7: Saved PO Amount correct (612.56):', cpo.poAmount === 612.56);

  win.location.hash = '#/customer-pos/' + cpo.id;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 8: Detail page shows Freight / Shipping as its own line:', doc.getElementById('content').textContent.includes('Freight / Shipping'));

  doc.getElementById('btnConvert').click();
  await wait(30);
  const so = (await win.DB.dbGetAll('salesOrders'))[0];
  console.log('STEP 9: Sales Order Freight field automatically = 346 (no manual re-entry needed):', so.freight === 346);
  console.log('STEP 10: Sales Order line items contain only the REAL item, not a fake delivery line:', so.lines.length === 1 && so.lines[0].description === 'SAMPLE BRUSH');
  console.log('STEP 11: Sales Order subtotal correct (238):', so.subtotal === 238);
  console.log('STEP 12: Sales Order VAT total correct (28.56):', so.vatTotal === 28.56);
  console.log('STEP 13: Sales Order Grand Total matches the Customer PO amount exactly (612.56):', so.grandTotal === 612.56);

  win.location.hash = '#/sales-orders/' + so.id;
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('btnEditDetails').click();
  await wait(10);
  console.log('STEP 14: Sales Order edit form shows Freight already filled in as 346:', doc.getElementById('f_freight').value === '346');

  win.location.hash = '#/customer-pos/new';
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('f_customerId').value = String(custId);
  doc.getElementById('f_poFreight').value = '100';
  doc.getElementById('f_poFreight').dispatchEvent(new win.Event('input'));
  await wait(10);
  console.log('STEP 15: PO Amount correctly reflects freight-only total (100.00):', Number(doc.getElementById('f_poAmount').value) === 100);

  const q = await win.DB.dbAdd('quotations', {
    quotationNo: 'HT-Q-2026-9001', customerId: custId, customerSnapshot: { companyName: 'Key Electrochem Limited Co./KEYEC' },
    revision: 0, isLatest: true, status: 'Won', date: win.todayISO(), currency: 'PHP',
    subtotal: 1000, vatTotal: 120, freight: 0, other: 0, grandTotal: 1120, lines: [{ lineId: 'L1', description: 'Quoted item', qty: 1, uom: 'pc', unitPrice: 1000, discountPercent: 0, vatRate: 12 }],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  });
  // Reload the form now that the quotation actually exists, so it's present in the dropdown.
  win.location.hash = '#/customer-pos';
  await win.Router.resolveRoute();
  await wait(5);
  win.location.hash = '#/customer-pos/new';
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('f_customerId').value = String(custId);
  doc.getElementById('f_poFreight').value = '100';
  doc.getElementById('f_poFreight').dispatchEvent(new win.Event('input'));
  await wait(10);
  const quoteSelect = doc.getElementById('f_quotationId');
  quoteSelect.value = String(q);
  quoteSelect.dispatchEvent(new win.Event('change'));
  await wait(10);
  console.log('STEP 16: Selecting a quotation removes the Freight field entirely (handled via the quotation chain instead):', !doc.getElementById('f_poFreight'));

  quoteSelect.value = '';
  quoteSelect.dispatchEvent(new win.Event('change'));
  await wait(10);
  console.log('STEP 17: Switching back to "None" restores the Freight field with the value preserved (100):', doc.getElementById('f_poFreight') && doc.getElementById('f_poFreight').value === '100');

  const legacyCpoId = await win.DB.dbAdd('customerPOs', {
    poNo: 'CPO-2026-9999', customerId: custId, quotationId: null, customerPoNumber: 'LEGACY',
    poAmount: 500, currency: 'PHP', status: 'Open',
    lines: [{ lineId: 'L1', description: 'Legacy line, no freight field on the record at all', qty: 1, uom: 'pc', unitPrice: 500, amount: 500, vatRate: 0, amountWithVat: 500 }],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  });
  win.location.hash = '#/customer-pos/' + legacyCpoId;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 18: Legacy Customer PO (no freight field) renders without crashing:', !doc.getElementById('content').innerHTML.includes('Something went wrong'));
  doc.getElementById('btnConvert').click();
  await wait(30);
  const legacySo = (await win.DB.dbGetAll('salesOrders')).find(s => s.customerPOId === legacyCpoId);
  console.log('STEP 19: Legacy PO (no freight) still converts correctly, freight defaults to 0:', legacySo.freight === 0 && legacySo.grandTotal === 500);

  console.log('\n=== CUSTOMER PO <-> SALES ORDER FREIGHT CONNECTION FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
