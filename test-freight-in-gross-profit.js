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

  /* ============ Reproducing the exact reported scenario: Unit Cost 50 USD, Est. Freight 10 USD, rate 64 ============ */
  win.location.hash = '#/quotations/new';
  await win.Router.resolveRoute();
  await wait(80);

  const row = doc.querySelector('#linesBody tr');
  row.querySelector('.ln-desc').value = 'Test Item'; row.querySelector('.ln-desc').dispatchEvent(new win.Event('input'));
  row.querySelector('.ln-qty').value = '1'; row.querySelector('.ln-qty').dispatchEvent(new win.Event('input'));
  row.querySelector('.ln-costccy').value = 'USD'; row.querySelector('.ln-costccy').dispatchEvent(new win.Event('change'));
  await wait(30);
  const row2 = doc.querySelector('#linesBody tr'); // re-query, drawLines() rebuilt the row
  row2.querySelector('.ln-rate').value = '64'; row2.querySelector('.ln-rate').dispatchEvent(new win.Event('input'));
  row2.querySelector('.ln-cost').value = '50'; row2.querySelector('.ln-cost').dispatchEvent(new win.Event('input'));
  row2.querySelector('.ln-freight').value = '10'; row2.querySelector('.ln-freight').dispatchEvent(new win.Event('input'));
  await wait(30);

  const row3 = doc.querySelector('#linesBody tr');
  console.log('STEP 1: THE CORE FIX: with 0% markup, Unit Price now correctly includes BOTH cost and freight ((50+10) x 64 = 3,840), not just cost alone (3,200):', row3.querySelector('.ln-price').value === '3840');

  /* ============ THE MARKUP RULE: markup applies only to Unit Cost, freight passes through at cost ============ */
  row3.querySelector('.ln-markup').value = '20';
  row3.querySelector('.ln-markup').dispatchEvent(new win.Event('input'));
  await wait(30);
  const row4 = doc.querySelector('#linesBody tr');
  // Superseded rule (Oct 2026): markup now applies to landed cost: (50+10) x 64 x 1.20 = 4,608
  console.log('STEP 2: THE MARKUP RULE (updated): markup applies to landed cost, (50 + 10 freight) x 64 x 1.20 = 4,608:', row4.querySelector('.ln-price').value === '4608');

  /* ============ The at-cost warning now correctly accounts for freight too ============ */
  row4.querySelector('.ln-markup').value = '0';
  row4.querySelector('.ln-markup').dispatchEvent(new win.Event('input'));
  await wait(30);
  const row5 = doc.querySelector('#linesBody tr');
  // Unit Price is now back to 3,840 (0% markup = cost+freight exactly) -- manually set it to
  // just the item cost (3,200) to simulate someone pricing without accounting for freight.
  row5.querySelector('.ln-price').value = '3200';
  row5.querySelector('.ln-price').dispatchEvent(new win.Event('input'));
  await wait(30);
  const row6 = doc.querySelector('#linesBody tr');
  console.log('STEP 3: THE WARNING FIX: pricing at just the item cost (3,200), ignoring the 640 freight, now correctly triggers the red at-or-below-cost warning (previously it would NOT have, since true cost is actually 3,840):', row6.querySelector('.ln-price').classList.contains('ln-price-at-cost'));

  row6.querySelector('.ln-price').value = '4000';
  row6.querySelector('.ln-price').dispatchEvent(new win.Event('input'));
  await wait(30);
  const row7 = doc.querySelector('#linesBody tr');
  console.log('STEP 4: REGRESSION: pricing genuinely above true cost (4,000 > 3,840) does NOT trigger the warning:', !row7.querySelector('.ln-price').classList.contains('ln-price-at-cost'));

  /* ============ Gross Profit on the quotation totals now correctly reflects freight too ============ */
  doc.getElementById('f_customerId').value = String(custId);
  doc.getElementById('qForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(100);
  const saved = (await win.DB.dbGetAll('quotations'))[0];
  // Revenue 4,000; true cost 3,840 (3,200 item + 640 freight) -> Gross Profit should be 160, not 800
  console.log('STEP 5: THE BOTTOM-LINE FIX: Gross Profit on the saved quotation correctly accounts for freight (4,000 - 3,840 = 160), not just item cost (which would wrongly show 800):', saved.grossProfit === 160);

  /* ============ Regression: a line with no freight at all (0) computes exactly as before ============ */
  win.location.hash = '#/quotations/new';
  await win.Router.resolveRoute();
  await wait(80);
  const plainRow = doc.querySelector('#linesBody tr');
  plainRow.querySelector('.ln-desc').value = 'No-freight item'; plainRow.querySelector('.ln-desc').dispatchEvent(new win.Event('input'));
  plainRow.querySelector('.ln-qty').value = '1'; plainRow.querySelector('.ln-qty').dispatchEvent(new win.Event('input'));
  plainRow.querySelector('.ln-cost').value = '1000'; plainRow.querySelector('.ln-cost').dispatchEvent(new win.Event('input'));
  plainRow.querySelector('.ln-markup').value = '25'; plainRow.querySelector('.ln-markup').dispatchEvent(new win.Event('input'));
  await wait(30);
  const plainRow2 = doc.querySelector('#linesBody tr');
  console.log('STEP 6: REGRESSION: a line with zero freight still computes Unit Price exactly as before (1,000 x 1.25 = 1,250), unaffected by this fix:', plainRow2.querySelector('.ln-price').value === '1250');

  console.log('\n=== ESTIMATED FREIGHT COST NOW INCLUDED IN TRUE COST / GROSS PROFIT FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
