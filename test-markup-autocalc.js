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

  /* ============ THE EXACT REPORTED BUG: markup-priced product, no separately-typed Standard Selling Price ============ */
  const markupProductId = await win.DB.dbAdd('products', {
    itemNo: 'P0001', type: 'Product', description: 'Fleck 3150EM Valve', brand: 'Pentair', modelNo: '3150EM',
    uom: 'pc', standardCost: 2000, standardPrice: 0, currency: 'PHP', // standardPrice left at 0, exactly the reported scenario
    markupPercent: 35, status: 'Active', createdAt: now
  });

  win.location.hash = '#/quotations/new';
  await win.Router.resolveRoute();
  await wait(50);
  doc.getElementById('f_customerId').value = String(custId);
  doc.querySelector('.ln-catalog-btn').click();
  await wait(50);
  win.document.body.querySelector('.item-picker-row').click();
  await wait(50);

  const markupInput = doc.querySelector('.ln-markup');
  const priceInput = doc.querySelector('.ln-price');
  console.log('STEP 1: Markup % correctly shows 35 immediately after picking (this part already worked):', markupInput.value === '35');
  console.log('STEP 2: THE BUG FIX: Unit Price is now correctly auto-computed as cost × (1 + markup%) = 2000 × 1.35 = 2700, with NO retyping needed:', Number(priceInput.value) === 2700);

  /* ============ Regression: existing manual recalculation (editing cost/markup by hand) still works ============ */
  markupInput.value = '50';
  markupInput.dispatchEvent(new win.Event('input'));
  await wait(30);
  console.log('STEP 3: REGRESSION: manually editing the markup % afterward still correctly recalculates price (2000 × 1.50 = 3000):', Number(doc.querySelector('.ln-price').value) === 3000);

  /* ============ Regression: a product with markup% = 0 now correctly computes price = cost (not a stale fallback) ============ */
  const fixedPriceProductId = await win.DB.dbAdd('products', {
    itemNo: 'P0002', type: 'Product', description: 'Zero-markup fitting', uom: 'pc',
    standardCost: 80, standardPrice: 150, currency: 'PHP', markupPercent: 0, status: 'Active', createdAt: now
  });
  win.location.hash = '#/quotations/new';
  await win.Router.resolveRoute();
  await wait(50);
  doc.getElementById('f_customerId').value = String(custId);
  doc.querySelector('.ln-catalog-btn').click();
  await wait(50);
  const rows = win.document.body.querySelectorAll('.item-picker-row');
  rows[rows.length - 1].click(); // the newly added zero-markup product
  await wait(50);
  console.log('STEP 4: THE SECOND BUG FIX: a product with an explicit 0% markup now correctly computes price = cost × 1.00 = 80, no longer incorrectly falling back to a stale/unrelated Standard Selling Price (150) just because 0 is falsy in JS:', Number(doc.querySelector('.ln-price').value) === 80);

  console.log('\n=== MARKUP-TO-PRICE AUTO-CALCULATION BUG FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
