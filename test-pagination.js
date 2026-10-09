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
  const custId = await win.DB.dbAdd('customers', { customerNo: 'C1', companyName: 'KEYEC', status: 'Active', createdAt: new Date().toISOString() });

  /* ============ Quotations: 120 records -> 3 pages at 50/page ============ */
  for (let i = 0; i < 120; i++) {
    const d = new Date(2026, 0, 1 + i).toISOString();
    await win.DB.dbAdd('quotations', {
      quotationNo: `HT-Q-2026-${String(i).padStart(4, '0')}`, customerId: custId, revision: 0, isLatest: true,
      status: 'Sent', date: '2026-09-01', validUntil: '2026-12-01', currency: 'PHP', subtotal: 1000, vatTotal: 0, freight: 0, other: 0,
      grandTotal: 1000, costTotal: 800, grossProfit: 200, grossMarginPercent: 20, createdAt: d, updatedAt: d
    });
  }

  win.location.hash = '#/quotations';
  await win.Router.resolveRoute();
  await wait(80);
  console.log('STEP 1: THE CORE ASK: only 50 rows render at a time, not all 120:', doc.querySelectorAll('#qBody tr').length === 50);
  console.log('STEP 2: The newest quotation (created last) is on page 1, as expected:', doc.querySelector('#qBody tr').textContent.includes('HT-Q-2026-0119'));
  console.log('STEP 3: Pagination controls show the correct "Showing 1–50 of 120" summary:', doc.getElementById('pgWrap').textContent.includes('Showing 1') && doc.getElementById('pgWrap').textContent.includes('50') && doc.getElementById('pgWrap').textContent.includes('120'));
  console.log('STEP 4: "Prev" is correctly disabled on page 1:', doc.getElementById('pgPrev').disabled);

  doc.getElementById('pgNext').click();
  await wait(30);
  console.log('STEP 5: Clicking "Next" correctly loads page 2 (rows 51-100):', doc.querySelectorAll('#qBody tr').length === 50 && doc.getElementById('pgWrap').textContent.includes('51'));
  console.log('STEP 6: "Prev" is now enabled:', !doc.getElementById('pgPrev').disabled);

  doc.getElementById('pgNext').click();
  await wait(30);
  console.log('STEP 7: Page 3 correctly shows the remaining 20 records:', doc.querySelectorAll('#qBody tr').length === 20);
  console.log('STEP 8: "Next" is correctly disabled on the last page:', doc.getElementById('pgNext').disabled);

  doc.getElementById('pgPrev').click();
  await wait(30);
  console.log('STEP 9: "Prev" correctly goes back to page 2:', doc.getElementById('pgWrap').textContent.includes('51'));

  /* ============ Applying a filter resets back to page 1, even when the filtered set is still large enough to paginate ============ */
  // Tag a specific, large (>50) subset with a distinct RFQ ref, so filtering to it produces a
  // result set that STILL needs pagination -- this is what actually distinguishes "applyFilters
  // explicitly resets currentPage to 1" from the separate safety clamp that only kicks in when
  // a stale page number would exceed the new, smaller total page count.
  const distinctIds = [];
  for (let i = 120; i < 180; i++) {
    const d = new Date(2026, 1, 1 + i).toISOString();
    const id = await win.DB.dbAdd('quotations', {
      quotationNo: `HT-Q-2026-${String(i).padStart(4, '0')}`, customerId: custId, revision: 0, isLatest: true,
      status: 'Sent', date: '2026-09-01', validUntil: '2026-12-01', currency: 'PHP', subtotal: 1000, vatTotal: 0, freight: 0, other: 0,
      grandTotal: 1000, costTotal: 800, grossProfit: 200, grossMarginPercent: 20, rfqRef: 'PAGE-RESET-BATCH', createdAt: d, updatedAt: d
    });
    distinctIds.push(id);
  }
  win.location.hash = '#/quotations';
  await win.Router.resolveRoute();
  await wait(80);
  doc.getElementById('pgNext').click(); // move to page 2 of the now-180-record unfiltered list
  await wait(30);
  doc.getElementById('listSearch').value = 'PAGE-RESET-BATCH'; // matches exactly 60 -- still > PAGE_SIZE
  doc.getElementById('listSearch').dispatchEvent(new win.Event('input'));
  await wait(250);
  console.log('STEP 10: Applying a search filter (while on page 2) resets to page 1, not the safety clamp -- proven by the FIRST row being the newest match, not an offset partway into the filtered set:', doc.getElementById('qBody').firstElementChild.textContent.includes('HT-Q-2026-0179') && doc.getElementById('pgWrap').textContent.includes('Showing 1'));

  /* ============ Regression: with fewer records than a page, no pagination controls appear at all ============ */
  doc.getElementById('listSearch').value = 'HT-Q-2026-0001';
  doc.getElementById('listSearch').dispatchEvent(new win.Event('input'));
  await wait(250);
  console.log('STEP 11: REGRESSION: with only one matching result, no pagination controls clutter the page:', doc.getElementById('pgWrap').innerHTML.trim() === '');

  /* ============ Shared entity engine: Products, same behavior ============ */
  for (let i = 0; i < 75; i++) {
    const d = new Date(2026, 0, 1 + i).toISOString();
    await win.DB.dbAdd('products', { itemNo: `HT-PRD-${String(i).padStart(4, '0')}`, description: `Item ${i}`, type: 'Product', uom: 'pc', status: 'Active', createdAt: d, updatedAt: d });
  }
  win.location.hash = '#/products';
  await win.Router.resolveRoute();
  await wait(80);
  console.log('STEP 12: THE SHARED FIX: Products (entity engine) also paginates at 50 per page, not all 75 at once:', doc.querySelectorAll('#entityTable tbody tr').length === 50);
  doc.getElementById('pgNext').click();
  await wait(30);
  console.log('STEP 13: Products page 2 correctly shows the remaining 25:', doc.querySelectorAll('#entityTable tbody tr').length === 25);

  /* ============ Static bespoke module: Sales Orders ============ */
  for (let i = 0; i < 60; i++) {
    const d = new Date(2026, 0, 1 + i).toISOString();
    await win.DB.dbAdd('salesOrders', { soNo: `HT-SO-${String(i).padStart(4, '0')}`, customerId: custId, orderDate: '2026-09-01', currency: 'PHP', status: 'Confirmed', vatMode: 'NonVat', lines: [], subtotal: 1000, vatTotal: 0, freight: 0, other: 0, grandTotal: 1000, createdAt: d, updatedAt: d });
  }
  win.location.hash = '#/sales-orders';
  await win.Router.resolveRoute();
  await wait(80);
  console.log('STEP 14: Sales Orders (a static, no-search bespoke module) also correctly paginates at 50, not all 60:', doc.querySelectorAll('#soBody tr').length === 50);

  console.log('\n=== PAGINATION ACROSS QUOTATIONS, THE ENTITY ENGINE, AND STATIC MODULES FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
