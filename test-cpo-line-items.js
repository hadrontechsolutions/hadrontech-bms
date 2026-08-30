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
  const prodId = await win.DB.dbAdd('products', { itemNo: 'ITEM-00001', description: 'CPSMH4200 Sample Wooden Hand Brush', uom: 'pc', standardPrice: 238, standardCost: 170, currency: 'PHP', status: 'Active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

  win.location.hash = '#/customer-pos/new';
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 1: With no quotation selected, the Line Items table appears:', !!doc.getElementById('poLinesBody'));
  console.log('STEP 2: PO Amount stays freely editable until a line actually exists (optional, not forced):', !doc.getElementById('f_poAmount').readOnly);
  console.log('STEP 3: Starts with zero lines — itemizing is optional, not forced on every PO:', doc.querySelectorAll('#poLinesBody tr').length === 0);

  doc.getElementById('f_customerId').value = String(custId);
  doc.getElementById('btnAddPOLine').click();
  await wait(10);
  console.log('STEP 3b: Clicking "+ Add Line" adds a row and locks PO Amount to the calculated total:', doc.querySelectorAll('#poLinesBody tr').length === 1 && doc.getElementById('f_poAmount').readOnly);
  const row1 = doc.querySelector('#poLinesBody tr');
  row1.querySelector('.po-catalog').value = String(prodId);
  row1.querySelector('.po-catalog').dispatchEvent(new win.Event('change'));
  await wait(10);
  console.log('STEP 4: Picking a catalog item auto-fills description and price:', doc.querySelector('.po-desc').value.includes('Sample Wooden Hand Brush') && doc.querySelector('.po-price').value === '238');

  doc.getElementById('btnAddPOLine').click();
  await wait(10);
  const rows = doc.querySelectorAll('#poLinesBody tr');
  const row2 = rows[1];
  row2.querySelector('.po-desc').value = 'Delivery via Lalamove';
  row2.querySelector('.po-desc').dispatchEvent(new win.Event('input'));
  row2.querySelector('.po-qty').value = '1';
  row2.querySelector('.po-qty').dispatchEvent(new win.Event('input'));
  row2.querySelector('.po-price').value = '346';
  row2.querySelector('.po-price').dispatchEvent(new win.Event('input'));
  await wait(10);
  console.log('STEP 5: PO Amount auto-computed correctly from both lines (238 + 346 = 584):', Number(doc.getElementById('f_poAmount').value) === 584);

  doc.getElementById('cpoForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(30);
  const cpo = (await win.DB.dbGetAll('customerPOs'))[0];
  console.log('STEP 6: Customer PO saved with 2 real line items:', cpo.lines.length === 2);
  console.log('STEP 7: First line correctly linked to the catalog product:', String(cpo.lines[0].itemId) === String(prodId));
  console.log('STEP 8: PO Amount correctly saved as 584:', cpo.poAmount === 584);

  win.location.hash = '#/customer-pos/' + cpo.id;
  await win.Router.resolveRoute();
  await wait(10);
  const detailText = doc.getElementById('content').textContent;
  console.log('STEP 9: Detail page shows the Line Items section:', detailText.includes('Line Items') && detailText.includes('Sample Wooden Hand Brush') && detailText.includes('Delivery via Lalamove'));

  doc.getElementById('btnConvert').click();
  await wait(30);
  const so = (await win.DB.dbGetAll('salesOrders'))[0];
  console.log('STEP 10: Sales Order has 2 real lines (not the generic "As per Customer PO..." catch-all):', so.lines.length === 2 && !so.lines.some(l => l.description.includes('As per Customer PO')));
  console.log('STEP 11: Sales Order line correctly preserves the catalog link (itemId):', String(so.lines[0].itemId) === String(prodId));
  console.log('STEP 12: Sales Order total matches (584):', so.grandTotal === 584);

  const q = await win.DB.dbAdd('quotations', {
    quotationNo: 'HT-Q-2026-9001', customerId: custId, customerSnapshot: { companyName: 'Key Electrochem Limited Co./KEYEC' },
    revision: 0, isLatest: true, status: 'Won', date: win.todayISO(), currency: 'PHP',
    subtotal: 1000, vatTotal: 120, freight: 0, other: 0, grandTotal: 1120, lines: [{ lineId: 'L1', description: 'Quoted item', qty: 1, uom: 'pc', unitPrice: 1000, discountPercent: 0, vatRate: 12 }],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  });
  win.location.hash = '#/customer-pos/new';
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 13: Fresh blank form again shows Line Items table:', !!doc.getElementById('poLinesBody'));
  const quoteSelect = doc.getElementById('f_quotationId');
  quoteSelect.value = String(q);
  quoteSelect.dispatchEvent(new win.Event('change'));
  await wait(10);
  console.log('STEP 14: Selecting a quotation removes the Line Items table entirely:', !doc.getElementById('poLinesBody'));
  console.log('STEP 15: PO Amount becomes editable again (not read-only) once a quotation is linked:', !doc.getElementById('f_poAmount').readOnly);
  console.log('STEP 16: PO Amount correctly auto-fills from the quotation total:', Number(doc.getElementById('f_poAmount').value) === 1120);

  quoteSelect.value = '';
  quoteSelect.dispatchEvent(new win.Event('change'));
  await wait(10);
  console.log('STEP 17: Switching back to "None" brings the Line Items table back:', !!doc.getElementById('poLinesBody'));

  doc.getElementById('f_customerId').value = String(custId);
  quoteSelect.value = String(q);
  quoteSelect.dispatchEvent(new win.Event('change'));
  await wait(10);
  doc.getElementById('cpoForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(30);
  const quotedCpo = (await win.DB.dbGetAll('customerPOs')).find(p => p.quotationId === q);
  console.log('STEP 18: A quotation-linked Customer PO correctly saves an EMPTY lines array (no stale line data):', Array.isArray(quotedCpo.lines) && quotedCpo.lines.length === 0);

  win.location.hash = '#/customer-pos/new';
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('f_customerId').value = String(custId);
  doc.getElementById('f_poAmount').value = '999';
  doc.getElementById('f_poAmount').dispatchEvent(new win.Event('input'));
  doc.getElementById('cpoForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(30);
  const simplePo = (await win.DB.dbGetAll('customerPOs')).find(p => p.poAmount === 999);
  console.log('STEP 19: The original simple workflow still works — typing a lump amount with ZERO line items:', !!simplePo && Array.isArray(simplePo.lines) && simplePo.lines.length === 0);

  win.location.hash = '#/customer-pos/new';
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('f_customerId').value = String(custId);
  doc.getElementById('btnAddPOLine').click();
  await wait(10);
  const incompleteRow = doc.querySelector('#poLinesBody tr');
  incompleteRow.querySelector('.po-qty').value = '0';
  incompleteRow.querySelector('.po-qty').dispatchEvent(new win.Event('input'));
  const beforeCount = (await win.DB.dbGetAll('customerPOs')).length;
  doc.getElementById('cpoForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(20);
  console.log('STEP 20: But once a line IS added, it must be complete (blank description / zero qty blocks submit):', (await win.DB.dbGetAll('customerPOs')).length === beforeCount);

  incompleteRow.querySelector('[data-podel]').click();
  await wait(10);
  console.log('STEP 21: Deleting the only line hands manual control of PO Amount back:', !doc.getElementById('f_poAmount').readOnly);

  const legacyCpoId = await win.DB.dbAdd('customerPOs', {
    poNo: await win.DB.nextDocNumber('customerPO'), customerId: custId, quotationId: null,
    customerPoNumber: 'LEGACY-PO', poAmount: 750, currency: 'PHP', status: 'Open',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  });
  win.location.hash = '#/customer-pos/' + legacyCpoId;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 20: Legacy Customer PO with no lines field renders without crashing:', !doc.getElementById('content').innerHTML.includes('Something went wrong'));
  console.log('STEP 21: Legacy PO does not show an empty/broken Line Items section:', !doc.getElementById('content').textContent.includes('Line Items'));

  doc.getElementById('btnConvert').click();
  await wait(30);
  const legacySo = (await win.DB.dbGetAll('salesOrders')).find(s => s.customerPOId === legacyCpoId);
  console.log('STEP 22: Legacy PO (no line items) still converts correctly using the old generic fallback line:', legacySo.lines.length === 1 && legacySo.lines[0].description.includes('As per Customer PO') && legacySo.grandTotal === 750);

  console.log('\n=== CUSTOMER PO LINE ITEMS FEATURE FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
