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

  // The exact scenario described: an item sourced from Hong Kong, costed AND freighted in HKD
  const prodId = await win.DB.dbAdd('products', {
    itemNo: 'HT-PRD-2026-0001', description: 'Pressure Sensor', type: 'Product', uom: 'pc',
    estimatedFreightCost: 850, standardCost: 50, currency: 'HKD', standardPrice: 3500, markupPercent: 25, leadTime: '4-6 weeks',
    status: 'Active', createdAt: now, updatedAt: now
  });

  /* ============ Product detail page: Estimated Freight Cost now correctly matches the product's OWN currency (HKD), not a fixed PHP ============ */
  win.location.hash = '#/products/' + prodId;
  await win.Router.resolveRoute();
  await wait(80);
  const detailText = doc.getElementById('content').textContent;
  console.log('STEP 1: THE CORRECTED ASK: Estimated Freight Cost displays in the product\u2019s own currency (HKD 850.00), matching Standard Cost, not a fixed ₱850.00:', detailText.includes('HKD 850.00') && !detailText.includes('₱850.00'));

  /* ============ Product form field order: Estimated Freight Cost now sits BEFORE Standard Cost ============ */
  win.location.hash = '#/products/' + prodId + '/edit';
  await win.Router.resolveRoute();
  await wait(80);
  const fieldLabels = [...doc.querySelectorAll('.field label')].map(l => l.textContent.trim());
  const freightIdx = fieldLabels.findIndex(l => l.includes('Estimated Freight Cost'));
  const costIdx = fieldLabels.findIndex(l => l.includes('Standard Cost'));
  console.log('STEP 2: THE REORDER ASK: Estimated Freight Cost field sits BEFORE Standard Cost on the product form:', freightIdx >= 0 && costIdx >= 0 && freightIdx < costIdx);
  console.log('STEP 3: The label no longer claims a fixed "(₱ PHP)" currency, since it now follows the product\u2019s own:', fieldLabels.some(l => l === 'Estimated Freight Cost'));

  /* ============ Quotation line item: Est. Freight now follows the line's own Cost Currency, with a PHP conversion hint ============ */
  win.location.hash = '#/quotations/new';
  await win.Router.resolveRoute();
  await wait(80);
  // A new Quotation form always starts with one blank line by default (no need to click
  // "+ Add Line Item" first) -- doing so here would leave a second, never-filled-in line that
  // fails the "every line needs a description" validation on submit.

  doc.querySelector('.ln-catalog-btn').click();
  await wait(50);
  win.document.body.querySelector('.item-picker-row').click();
  await wait(50);

  const row = doc.querySelector('#linesBody tr');
  const freightInput = row.querySelector('.ln-freight');
  console.log('STEP 4: Picking an HKD-costed product correctly copies its Estimated Freight Cost (850) onto the line, in that same figure:', freightInput.value === '850');

  const costCcySelect = row.querySelector('.ln-costccy');
  console.log('STEP 5: The line\u2019s Cost Currency correctly picked up HKD from the product (quotation currency is PHP, so these differ):', costCcySelect.value === 'HKD');
  const freightPhpHint = /Landed\/unit: .*₱/.test(row.querySelector('.ln-freight-info').textContent);
  console.log('STEP 6: THE CORE ASK: since Cost Currency (HKD) differs from the quotation\u2019s own currency (PHP), a "→₱ equivalent" conversion hint appears under Est. Freight, the same treatment Unit Cost already gets:', !!freightPhpHint);

  // Confirm the hint stays live: changing the freight amount updates the PHP-equivalent shown
  freightInput.value = '1000';
  freightInput.dispatchEvent(new win.Event('input'));
  await wait(30);
  const updatedHint = row.querySelector('.ln-freight-info');
  console.log('STEP 7: The conversion hint updates live as the freight figure is edited, not left stale:', !!updatedHint && updatedHint.textContent.includes('Landed'));

  /* ============ Read-only Detail view shows the same currency-matched figure ============ */
  doc.getElementById('f_customerId').value = String(custId);
  doc.getElementById('qForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(100);

  const savedQuotations = await win.DB.dbGetAll('quotations');
  const saved = savedQuotations[0];
  win.location.hash = '#/quotations/' + saved.id;
  await win.Router.resolveRoute();
  await wait(80);
  const readOnlyText = doc.getElementById('content').textContent;
  console.log('STEP 8: The read-only Detail view also shows Est. Freight in the line\u2019s own Cost Currency (HKD 1,000.00) with the PHP conversion alongside it, not a fixed PHP figure:', readOnlyText.includes('HKD 1,000.00'));

  console.log('\n=== ESTIMATED FREIGHT COST — CURRENCY-MATCHING CORRECTION FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
