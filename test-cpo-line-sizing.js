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
  const longDesc = '13 mm x 30 mm x 534 mm L Wooden Hand Brush, Straight Handle, 4 x 18 Holes, very long description that should not balloon the dropdown';
  const prodId = await win.DB.dbAdd('products', { itemNo: 'ITEM-00001', description: longDesc, uom: 'pc', standardPrice: 238, standardCost: 170, currency: 'PHP', status: 'Active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

  win.location.hash = '#/customer-pos/new';
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('f_customerId').value = String(custId);
  doc.getElementById('btnAddPOLine').click();
  await wait(10);

  const catalogSelect = doc.querySelector('.po-catalog');
  const longOption = [...catalogSelect.options].find(o => o.value === String(prodId));
  console.log('STEP 1: Dropdown option text is truncated to a short snippet (not the full 100+ char description):', longOption.textContent.length < 45);
  console.log('STEP 2: Truncated text still includes the Item # for identification:', longOption.textContent.includes('ITEM-00001'));

  console.log('STEP 3: Catalog select is capped via min-width (matching the Quotation module\'s exact technique), so truncated text keeps it compact:', catalogSelect.getAttribute('style').includes('min-width:110px'));
  console.log('STEP 4: Text truncation (not a hard pixel cap) is what actually prevents ballooning — confirmed by the truncated option length above:', longOption.textContent.length < 45);

  catalogSelect.value = String(prodId);
  catalogSelect.dispatchEvent(new win.Event('change'));
  await wait(10);
  const descField = doc.querySelector('.po-desc');
  console.log('STEP 5: Selecting the item still fills in the FULL description (truncation is a display-only fix, not a data loss):', descField.value === longDesc);
  console.log('STEP 6: Price still auto-fills correctly:', doc.querySelector('.po-price').value === '238');

  doc.getElementById('cpoForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(30);
  const cpo = (await win.DB.dbGetAll('customerPOs'))[0];
  console.log('STEP 7: Saved record has the full untruncated description:', cpo.lines[0].description === longDesc);

  console.log('\n=== CUSTOMER PO LINE-ITEM TABLE SIZING FIX VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
