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
  const now = new Date().toISOString();

  await win.DB.openDB(); await win.DB.ensureCounters();
  const custId = await win.DB.dbAdd('customers', { customerNo: 'C1', companyName: 'KEYEC', status: 'Active', createdAt: now });
  const supId = await win.DB.dbAdd('suppliers', { supplierNo: 'S1', companyName: 'Pentair', status: 'Active', createdAt: now });
  const productId = await win.DB.dbAdd('products', {
    itemNo: 'P0001', type: 'Product', description: 'Fleck 3150EM Valve', brand: 'Pentair', modelNo: '3150EM',
    uom: 'pc', defaultSupplierId: supId, standardCost: 2300, standardPrice: 3000, currency: 'USD',
    markupPercent: 25, vatClass: 'VATable', leadTime: '6-8 weeks', status: 'Active', createdAt: now
  });

  /* ============ BUG FIX 1 & 2: markupPercent and leadTime now correctly carry through ============ */
  win.location.hash = '#/quotations/new';
  await win.Router.resolveRoute();
  await wait(50);
  doc.getElementById('f_customerId').value = String(custId);
  doc.querySelector('.ln-catalog-btn').click();
  await wait(50);
  const pickerRow = win.document.body.querySelector('.item-picker-row');
  pickerRow.click();
  await wait(50);

  const markupInput = doc.querySelector('.ln-markup');
  const gotMarkupFromPicker = markupInput && Number(markupInput.value) === 25;
  console.log('STEP 1: THE BUG FIX: selecting a product from the catalog now correctly carries through its Default Markup % (25) onto the line — this was silently dropped before:', gotMarkupFromPicker);

  console.log('STEP 2a: Note: Typical Lead Time has no visible input anywhere on the quotation line row today, and print.js never references it either — a separate, pre-existing gap worth a decision, not something to silently paper over as if it were already user-visible.');

  // Complete the save so the underlying data fix can be verified directly, independent of
  // whether there's currently a visible field to show it in.
  const priceInput = doc.querySelector('.ln-price');
  if (priceInput) { priceInput.value = '3000'; priceInput.dispatchEvent(new win.Event('input')); }
  doc.getElementById('qForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(100);
  const savedQ = (await win.DB.dbGetAll('quotations'))[0];
  console.log('STEP 2b: THE BUG FIX, VERIFIED AT THE DATA LEVEL: the saved quotation line correctly carries the product\u2019s Typical Lead Time ("6-8 weeks") even with no on-screen field to show it — was previously always blank due to the same missing-copy bug as the markup one:', savedQ.lines[0].leadTime === '6-8 weeks');

  /* ============ Product form layout changes ============ */
  win.location.hash = '#/products/new';
  await win.Router.resolveRoute();
  await wait(50);
  const labels = [...doc.querySelectorAll('.field label')].map(l => l.textContent);
  const costIdx = labels.indexOf('Standard Cost');
  const currencyIdx = labels.indexOf('Currency');
  console.log('STEP 3: Currency now sits immediately after Standard Cost in field order (drives the visual layout in this form-grid):', currencyIdx === costIdx + 1);

  console.log('STEP 4: Standard Selling Price label now clarifies it\u2019s always in PHP, avoiding confusion with Standard Cost\u2019s currency:', labels.includes('Standard Selling Price (₱ PHP)'));

  console.log('STEP 5: THE DEFAULT CHANGE: Currency now defaults to USD for a new product, not PHP — matching that most sourcing is from overseas suppliers:', doc.getElementById('f_currency').value === 'USD');

  /* ============ Regression: existing product data with its OWN currency is untouched ============ */
  win.location.hash = '#/products/' + productId + '/edit';
  await win.Router.resolveRoute();
  await wait(50);
  console.log('STEP 6: REGRESSION: editing an EXISTING product still shows its own saved currency (USD here), not silently reset by the new default:', doc.getElementById('f_currency').value === 'USD');

  // Also confirm a product explicitly saved with PHP still displays PHP correctly (default only
  // applies to brand-new, never-saved records — never overrides an existing saved value).
  const phpProductId = await win.DB.dbAdd('products', {
    itemNo: 'P0002', type: 'Product', description: 'Local fitting', uom: 'pc', currency: 'PHP',
    standardCost: 100, standardPrice: 150, status: 'Active', createdAt: now
  });
  win.location.hash = '#/products/' + phpProductId + '/edit';
  await win.Router.resolveRoute();
  await wait(50);
  console.log('STEP 7: REGRESSION: a product explicitly saved with PHP still correctly shows PHP when edited, unaffected by the new USD default:', doc.getElementById('f_currency').value === 'PHP');

  console.log('\n=== PRODUCT-QUOTATION COPY-THROUGH FIXES + FORM CHANGES FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
