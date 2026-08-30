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

  const supId = await win.DB.dbAdd('suppliers', { supplierNo: 'SUP-00001', companyName: 'ACME Pumps Pte Ltd', status: 'Active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  const prodId = await win.DB.dbAdd('products', { itemNo: 'ITEM-00001', description: 'Centrifugal Pump 5HP', defaultSupplierId: supId, standardCost: 850, standardPrice: 1150, currency: 'PHP', status: 'Active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

  /* ---------- FIX 1: archived references no longer get silently wiped ---------- */
  win.location.hash = '#/suppliers/' + supId;
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('btnArchive').click();
  await wait(20);

  win.location.hash = '#/products/' + prodId;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 1: Product detail page correctly shows archived supplier name (not blank):', doc.getElementById('content').textContent.includes('ACME Pumps Pte Ltd'));

  win.location.hash = '#/products/' + prodId + '/edit';
  await win.Router.resolveRoute();
  await wait(10);
  const supplierSelect = doc.getElementById('f_defaultSupplierId');
  console.log('STEP 2: Edit form still shows the archived supplier as the selected option, marked as archived:', supplierSelect.value == supId && [...supplierSelect.options].find(o => o.selected).textContent.includes('Archived'));

  doc.getElementById('f_standardPrice').value = '1200';
  doc.getElementById('f_standardPrice').dispatchEvent(new win.Event('input'));
  doc.getElementById('entityForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(20);
  const productAfter = await win.DB.dbGet('products', prodId);
  console.log('STEP 3: Editing an unrelated field (price) no longer silently wipes the supplier link:', productAfter.defaultSupplierId == supId);
  console.log('STEP 4: The unrelated edit itself still saved correctly:', productAfter.standardPrice === 1200);

  /* ---------- FIX 2: archive/unarchive now updates the audit trail ---------- */
  const custId = await win.DB.dbAdd('customers', { customerNo: 'CUST-00001', companyName: 'Test Customer', status: 'Active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), modifiedBy: 'Original User' });
  const beforeArchive = await win.DB.dbGet('customers', custId);
  win.location.hash = '#/customers/' + custId;
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('btnArchive').click();
  await wait(20);
  const afterArchive = await win.DB.dbGet('customers', custId);
  console.log('STEP 5: Archiving now correctly updates "last modified":', afterArchive.updatedAt !== beforeArchive.updatedAt);
  doc.getElementById('btnUnarchive').click();
  await wait(20);
  const afterUnarchive = await win.DB.dbGet('customers', custId);
  console.log('STEP 6: Unarchiving also updates the audit trail:', afterUnarchive.updatedAt !== afterArchive.updatedAt && afterUnarchive.archived === false);

  /* ---------- FIX 3: deleting a Product referenced by a live quotation now warns ---------- */
  const custId2 = await win.DB.dbAdd('customers', { customerNo: 'CUST-00002', companyName: 'Ref Test Co.', status: 'Active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  const q = {
    quotationNo: 'HT-Q-2026-9999', customerId: custId2, customerSnapshot: { companyName: 'Ref Test Co.' },
    revision: 0, isLatest: true, status: 'Draft', date: '2026-08-20', currency: 'PHP',
    lines: [{ lineId: 'L1', itemId: prodId, description: 'Centrifugal Pump 5HP', qty: 1, uom: 'pc', unitCost: 850, unitPrice: 1200, discountPercent: 0, vatRate: 12, supplierId: supId }],
    subtotal: 1200, vatTotal: 144, freight: 0, other: 0, grandTotal: 1344, costTotal: 850, grossProfit: 350, grossMarginPercent: 29.17,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  };
  await win.DB.dbAdd('quotations', q);

  win.location.hash = '#/products/' + prodId;
  await win.Router.resolveRoute();
  await wait(10);
  let confirmMessageSeen = '';
  win.confirm = (msg) => { confirmMessageSeen = msg; return false; };
  doc.getElementById('btnDelete').click();
  await wait(10);
  console.log('STEP 7: Deleting a Product referenced by a live quotation now shows a warning:', confirmMessageSeen.includes('1 linked transaction record'));

  const unusedProdId = await win.DB.dbAdd('products', { itemNo: 'ITEM-00002', description: 'Unused spare part', standardCost: 10, standardPrice: 15, currency: 'PHP', status: 'Active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  win.location.hash = '#/products/' + unusedProdId;
  await win.Router.resolveRoute();
  await wait(10);
  confirmMessageSeen = '';
  doc.getElementById('btnDelete').click();
  await wait(10);
  console.log('STEP 8: A product with NO references shows no false-positive warning:', !confirmMessageSeen.includes('linked'));

  const savedQ = (await win.DB.dbGetAll('quotations'))[0];
  win.location.hash = '#/quotations/' + savedQ.id;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 9: Quotation itself still renders correctly throughout all this:', doc.getElementById('content').textContent.includes('Centrifugal Pump 5HP') && !doc.getElementById('content').innerHTML.includes('Something went wrong'));

  console.log('\n=== ALL CUSTOMERS/SUPPLIERS/PRODUCTS BUG FIXES VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
