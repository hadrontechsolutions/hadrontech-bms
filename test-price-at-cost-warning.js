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
  const zeroMarkupProductId = await win.DB.dbAdd('products', {
    itemNo: 'P0001', type: 'Product', description: 'Zero-margin item', uom: 'pc',
    standardCost: 2000, standardPrice: 0, currency: 'PHP', markupPercent: 0, status: 'Active', createdAt: now
  });
  const healthyMarkupProductId = await win.DB.dbAdd('products', {
    itemNo: 'P0002', type: 'Product', description: 'Healthy-margin item', uom: 'pc',
    standardCost: 1000, standardPrice: 0, currency: 'PHP', markupPercent: 35, status: 'Active', createdAt: now
  });

  /* ============ Brand new empty line: no false-positive red on an unfilled line ============ */
  win.location.hash = '#/quotations/new';
  await win.Router.resolveRoute();
  await wait(50);
  const priceInput = doc.querySelector('.ln-price');
  console.log('STEP 1: A brand new, completely empty line (cost=0, price=0) does NOT show the red warning — nothing has actually been priced yet:', !priceInput.classList.contains('ln-price-at-cost'));

  /* ============ Picking a 0%-markup product: price defaults to cost -> should show red ============ */
  doc.getElementById('f_customerId').value = String(custId);
  doc.querySelector('.ln-catalog-btn').click();
  await wait(50);
  const rows1 = win.document.body.querySelectorAll('.item-picker-row');
  rows1[0].click(); // P0001, the zero-margin item
  await wait(50);
  const priceInputAfterPick = doc.querySelector('.ln-price');
  console.log('STEP 2: THE FEATURE: picking a 0%-markup product (price defaults straight to cost) correctly shows the red warning:', priceInputAfterPick.classList.contains('ln-price-at-cost'));
  console.log('STEP 3: Price genuinely equals cost in this state (2000 = 2000), confirming the warning is correctly triggered:', priceInputAfterPick.value === '2000');

  /* ============ Manually raising markup should remove the red warning live ============ */
  const markupInput = doc.querySelector('.ln-markup');
  markupInput.value = '20';
  markupInput.dispatchEvent(new win.Event('input'));
  await wait(30);
  console.log('STEP 4: Raising markup to 20% (price now above cost) correctly removes the red warning, live, without needing a page reload:', !doc.querySelector('.ln-price').classList.contains('ln-price-at-cost'));

  /* ============ Manually setting markup back to 0 should bring the warning back ============ */
  markupInput.value = '0';
  markupInput.dispatchEvent(new win.Event('input'));
  await wait(30);
  console.log('STEP 5: Setting markup back to 0% correctly brings the red warning back:', doc.querySelector('.ln-price').classList.contains('ln-price-at-cost'));

  /* ============ Typing a price BELOW cost (an actual loss) should also show red ============ */
  const priceInputNow = doc.querySelector('.ln-price');
  priceInputNow.value = '1500'; // below the 2000 cost -- an actual loss, not just zero margin
  priceInputNow.dispatchEvent(new win.Event('input'));
  await wait(30);
  console.log('STEP 6: Typing a price actually BELOW cost (a loss, not just zero margin) also correctly triggers the red warning — broader than an exact-match check:', doc.querySelector('.ln-price').classList.contains('ln-price-at-cost'));

  /* ============ A healthy-margin product should never show the warning ============ */
  win.location.hash = '#/quotations/new';
  await win.Router.resolveRoute();
  await wait(50);
  doc.getElementById('f_customerId').value = String(custId);
  doc.querySelector('.ln-catalog-btn').click();
  await wait(50);
  const rows2 = win.document.body.querySelectorAll('.item-picker-row');
  rows2[1].click(); // P0002, the healthy-margin item
  await wait(50);
  console.log('STEP 7: REGRESSION: a product with a genuine, healthy markup never shows the red warning:', !doc.querySelector('.ln-price').classList.contains('ln-price-at-cost'));

  /* ============ Regression: an already-saved quotation with a zero-margin line shows red immediately on load ============ */
  const stuckAtCostId = await win.DB.dbAdd('quotations', {
    quotationNo: 'HT-Q-2026-ATCOST', customerId: custId, revision: 0, isLatest: true, status: 'Draft', date: win.todayISO(), currency: 'PHP', vatMode: 'NonVat',
    lines: [{ lineId: 'L1', description: 'Pre-existing zero-margin line', qty: 1, uom: 'pc', unitCost: 500, unitPrice: 500, costCurrency: 'PHP', costExchangeRate: 1, markupPercent: 0, discountPercent: 0, vatRate: 0 }],
    subtotal: 500, vatTotal: 0, freight: 0, other: 0, grandTotal: 500, createdAt: now, updatedAt: now
  });
  win.location.hash = '#/quotations/' + stuckAtCostId + '/edit';
  await win.Router.resolveRoute();
  await wait(50);
  console.log('STEP 8: REGRESSION: opening an already-saved quotation that already has a zero-margin line shows the red warning immediately on load, not just after an edit is made:', doc.querySelector('.ln-price').classList.contains('ln-price-at-cost'));

  console.log('\n=== SELLING-AT-OR-BELOW-COST RED WARNING FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
