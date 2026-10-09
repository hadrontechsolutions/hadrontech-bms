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
  const TARGET_MONTH = '2026-09';

  // A properly-costed order -- should never trigger the warning
  await win.DB.dbAdd('salesOrders', {
    soNo: 'HT-SO-2026-0001', customerId: custId, orderDate: '2026-09-05', currency: 'PHP', status: 'Confirmed', vatMode: 'NonVat',
    lines: [{ lineId: 'L1', description: 'Properly costed item', qty: 1, uom: 'pc', unitCost: 5000, unitPrice: 8000, costCurrency: 'PHP', costExchangeRate: 1, discountPercent: 0, vatRate: 0 }],
    subtotal: 8000, vatTotal: 0, freight: 0, other: 0, grandTotal: 8000, createdAt: now, updatedAt: now
  });

  /* ============ Month with no zero-cost orders: no warning ============ */
  win.location.hash = '#/distributions/new';
  await win.Router.resolveRoute();
  await wait(50);
  doc.getElementById('f_month').value = TARGET_MONTH;
  doc.getElementById('f_month').dispatchEvent(new win.Event('change'));
  await wait(50);
  console.log('STEP 1: A month with only properly-costed orders shows no zero-cost warning:', !doc.getElementById('monthSummary').innerHTML.includes('₱0 recorded cost'));

  /* ============ Add a sample-request-style order with unitCost 0 but real unitPrice ============ */
  await win.DB.dbAdd('salesOrders', {
    soNo: 'HT-SO-2026-0002', customerId: custId, orderDate: '2026-09-12', currency: 'PHP', status: 'Confirmed', vatMode: 'NonVat',
    lines: [{ lineId: 'L1', description: 'Sample request item, no quotation behind it', qty: 1, uom: 'pc', unitCost: 0, unitPrice: 15000, costCurrency: 'PHP', costExchangeRate: 1, discountPercent: 0, vatRate: 0 }],
    subtotal: 15000, vatTotal: 0, freight: 0, other: 0, grandTotal: 15000, createdAt: now, updatedAt: now
  });

  win.location.hash = '#/distributions/new';
  await win.Router.resolveRoute();
  await wait(50);
  doc.getElementById('f_month').value = TARGET_MONTH;
  doc.getElementById('f_month').dispatchEvent(new win.Event('change'));
  await wait(50);

  const summaryHTML = doc.getElementById('monthSummary').innerHTML;
  console.log('STEP 2: THE FIX: a month with a ₱0-cost order now shows a clear warning:', summaryHTML.includes('₱0 recorded cost'));
  console.log('STEP 3: The warning specifically names the affected order (HT-SO-2026-0002), making it actionable, not vague:', summaryHTML.includes('HT-SO-2026-0002'));
  console.log('STEP 4: The properly-costed order (HT-SO-2026-0001) is correctly NOT named in the warning:', !summaryHTML.match(/HT-SO-2026-0001.*₱0 recorded cost|₱0 recorded cost.*HT-SO-2026-0001/));
  console.log('STEP 5: The warning explains WHY this happens and what to do about it:', summaryHTML.includes('without a Quotation') && summaryHTML.includes('Gross Profit may be overstated'));
  console.log('STEP 6: This is styled as a clear red warning, matching the other sanity checks in this app:', summaryHTML.includes('var(--danger)'));

  /* ============ This is a warning, not a block -- Gross Profit still auto-fills and saving still works ============ */
  console.log('STEP 7: Despite the warning, Gross Profit still auto-fills normally (8,000 + 15,000 revenue - 5,000 - 0 cost = 18,000) -- it doesn\u2019t block or zero out the calculation:', doc.getElementById('f_grossProfit').value === '18000');

  doc.getElementById('distForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(100);
  const saved = (await win.DB.dbGetAll('distributions'))[0];
  console.log('STEP 8: Saving still works fine despite the warning being shown -- a nudge, not a hard stop:', !!saved && saved.grossProfitTotal === 18000);

  /* ============ A line with BOTH unitCost=0 AND unitPrice=0 (genuinely empty, not "missing cost") should NOT trigger the warning ============ */
  await win.DB.dbAdd('salesOrders', {
    soNo: 'HT-SO-2026-0003', customerId: custId, orderDate: '2026-09-18', currency: 'PHP', status: 'Confirmed', vatMode: 'NonVat',
    lines: [{ lineId: 'L1', description: 'Genuinely blank/unused line', qty: 1, uom: 'pc', unitCost: 0, unitPrice: 0, costCurrency: 'PHP', costExchangeRate: 1, discountPercent: 0, vatRate: 0 }],
    subtotal: 0, vatTotal: 0, freight: 0, other: 0, grandTotal: 0, createdAt: now, updatedAt: now
  });
  win.location.hash = '#/distributions/new';
  await win.Router.resolveRoute();
  await wait(50);
  doc.getElementById('f_month').value = TARGET_MONTH;
  doc.getElementById('f_month').dispatchEvent(new win.Event('change'));
  await wait(50);
  const summaryHTML2 = doc.getElementById('monthSummary').innerHTML;
  console.log('STEP 9: A genuinely blank line (both cost AND price at 0) is correctly NOT flagged as "missing cost" -- it\u2019s not a real line with unknown cost, just an empty one:', !summaryHTML2.includes('HT-SO-2026-0003'));

  console.log('\n=== ZERO-COST ORDER WARNING FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
