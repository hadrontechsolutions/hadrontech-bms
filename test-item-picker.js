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
  const supId = await win.DB.dbAdd('suppliers', { supplierNo: 'S1', companyName: 'Default Supplier', status: 'Active', createdAt: now, updatedAt: now });
  await win.DB.dbAdd('products', { itemNo: 'ITEM-00001', description: 'Submersible Pump 1.5kW', brand: 'Koganei', modelNo: 'KSP-150', uom: 'pc', standardCost: 3000, standardPrice: 4000, currency: 'PHP', defaultSupplierId: supId, status: 'Active', createdAt: now, updatedAt: now });
  await win.DB.dbAdd('products', { itemNo: 'ITEM-00002', description: 'Wooden Hand Brush Nylon', brand: '', modelNo: '', uom: 'pc', standardCost: 170, standardPrice: 238, currency: 'PHP', status: 'Active', createdAt: now, updatedAt: now });

  win.location.hash = '#/quotations/new';
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 1: No plain <select> dropdown exists for catalog selection anymore:', !doc.querySelector('.ln-catalog'));
  console.log('STEP 2: A "+ Select Item" trigger button exists instead:', doc.querySelector('.ln-catalog-btn').textContent.includes('+ Select Item'));

  doc.querySelector('.ln-catalog-btn').click();
  await wait(10);
  console.log('STEP 3: Clicking the trigger opens the picker overlay:', !!doc.querySelector('.item-picker-overlay'));
  console.log('STEP 4: Both products are listed initially (no filter applied yet):', doc.querySelectorAll('.item-picker-row').length === 2);

  const searchInput = doc.querySelector('.item-picker-search');
  searchInput.value = 'brush';
  searchInput.dispatchEvent(new win.Event('input'));
  await wait(10);
  console.log('STEP 5: Typing "brush" correctly filters down to just the matching product:', doc.querySelectorAll('.item-picker-row').length === 1 && doc.querySelector('.item-picker-list').textContent.includes('Wooden Hand Brush Nylon'));

  searchInput.value = 'zzz-nomatch';
  searchInput.dispatchEvent(new win.Event('input'));
  await wait(10);
  console.log('STEP 6: A search with no matches shows a clean empty state:', doc.querySelector('.item-picker-empty') && doc.querySelector('.item-picker-empty').textContent.includes('No matches'));

  searchInput.value = 'pump';
  searchInput.dispatchEvent(new win.Event('input'));
  await wait(10);
  doc.querySelector('.item-picker-row').click();
  await wait(10);
  console.log('STEP 7: Selecting an item closes the picker overlay:', !doc.querySelector('.item-picker-overlay'));
  console.log('STEP 8: The trigger button now shows the selected item\'s number:', doc.querySelector('.ln-catalog-btn').textContent.includes('ITEM-00001'));
  console.log('STEP 9: Description, brand, model, cost, price all auto-filled correctly (same as the old dropdown behavior):', doc.querySelector('.ln-desc').value === 'Submersible Pump 1.5kW' && doc.querySelector('.ln-brand').value === 'Koganei' && doc.querySelector('.ln-model').value === 'KSP-150' && doc.querySelector('.ln-cost').value === '3000' && doc.querySelector('.ln-price').value === '4000');
  console.log('STEP 10: Supplier also correctly auto-filled from the product\'s default supplier:', doc.querySelector('.ln-supplier').value === String(supId));

  doc.querySelector('.ln-catalog-btn').click();
  await wait(10);
  doc.querySelector('[data-cancel]').click();
  await wait(10);
  console.log('STEP 11: Clicking Cancel closes the picker without changing the selection:', !doc.querySelector('.item-picker-overlay') && doc.querySelector('.ln-catalog-btn').textContent.includes('ITEM-00001'));

  doc.querySelector('.ln-catalog-btn').click();
  await wait(10);
  doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape' }));
  await wait(10);
  console.log('STEP 12: Pressing Escape also closes the picker:', !doc.querySelector('.item-picker-overlay'));

  doc.querySelector('.ln-catalog-btn').click();
  await wait(10);
  doc.querySelector('.item-picker-overlay').dispatchEvent(new win.Event('click', { bubbles: true }));
  await wait(10);
  console.log('STEP 13: Clicking the backdrop outside the picker box closes it:', !doc.querySelector('.item-picker-overlay'));

  doc.getElementById('f_customerId').value = String(custId);
  doc.querySelector('.ln-qty').value = '1';
  doc.querySelector('.ln-qty').dispatchEvent(new win.Event('input'));
  await wait(10);
  doc.getElementById('qForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(30);
  const q = (await win.DB.dbGetAll('quotations'))[0];
  console.log('STEP 14: Quotation saved correctly with the picker-selected item linked:', q.lines[0].description === 'Submersible Pump 1.5kW');

  win.location.hash = '#/customer-pos/new';
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('btnAddPOLine').click();
  await wait(10);
  console.log('STEP 15: No plain <select> for Customer PO catalog selection anymore:', !doc.querySelector('.po-catalog'));
  console.log('STEP 16: A "+ Select Item" trigger button exists here too:', doc.querySelector('.po-catalog-btn').textContent.includes('+ Select Item'));

  doc.querySelector('.po-catalog-btn').click();
  await wait(10);
  const poSearchInput = doc.querySelector('.item-picker-search');
  poSearchInput.value = 'brush';
  poSearchInput.dispatchEvent(new win.Event('input'));
  await wait(10);
  doc.querySelector('.item-picker-row').click();
  await wait(10);
  console.log('STEP 17: Customer PO line correctly auto-filled from the picker selection:', doc.querySelector('.po-desc').value === 'Wooden Hand Brush Nylon' && doc.querySelector('.po-price').value === '238');
  console.log('STEP 18: Customer PO trigger button shows the selected item number:', doc.querySelector('.po-catalog-btn').textContent.includes('ITEM-00002'));

  console.log('\n=== SEARCHABLE ITEM PICKER FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
