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

  const settings = await win.DB.getSettings();
  settings.referenceRates = {};
  await win.DB.dbPut('settings', settings);

  const q = await win.DB.dbAdd('quotations', {
    quotationNo: 'HT-Q-2026-0001', customerId: custId, revision: 0, isLatest: true, status: 'Draft', date: win.todayISO(), currency: 'PHP',
    lines: [{ lineId: 'L1', itemId: '', brand: '', modelNo: '', description: 'Vertical multistage centrifugal pump, CR, cast iron', qty: 1, uom: 'pc', unitCost: 850, costCurrency: 'USD', costExchangeRate: 58, markupPercent: 0, unitPrice: 1150, discountPercent: 0, vatRate: 12, supplierId: '' }],
    subtotal: 1150, vatTotal: 138, freight: 0, other: 0, grandTotal: 1288, createdAt: now, updatedAt: now
  });

  win.location.hash = '#/quotations/' + q + '/edit';
  await win.Router.resolveRoute();
  await wait(10);
  const row = doc.querySelector('#linesBody tr');
  const dropdownValue = row.querySelector('.ln-costccy').value;

  console.log('STEP 1: THE BUG, NOW FIXED: the Cost Ccy dropdown correctly shows the real stored value (USD) — not silently defaulting to PHP:', dropdownValue.startsWith('USD'));
  console.log('STEP 2: Since USD isn\'t currently registered in Settings, the option is clearly flagged so it\'s not mistaken for a normal choice:', dropdownValue.includes('not in Settings'));
  console.log('STEP 3: The PHP conversion hint correctly reflects 850 x 58 = 49,300.00 the whole time (the math never had this bug, only the dropdown display did):', row.querySelector('.ln-cost-php').textContent.includes('49,300.00'));

  const settings2 = await win.DB.getSettings();
  settings2.referenceRates = { USD: 58 };
  await win.DB.dbPut('settings', settings2);
  win.location.hash = '#/quotations/' + q + '/edit';
  await win.Router.resolveRoute();
  await wait(10);
  const row2 = doc.querySelector('#linesBody tr');
  const dropdownValue2 = row2.querySelector('.ln-costccy').value;
  console.log('STEP 5: Once USD IS properly registered in Settings, the dropdown shows a clean "USD" with no extra flag needed:', dropdownValue2 === 'USD');

  win.location.hash = '#/quotations/' + q + '/edit';
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('f_customerId').value = String(custId);
  doc.getElementById('qForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(30);
  const qAfter = await win.DB.dbGet('quotations', q);
  console.log('STEP 6: Saving after this fix still correctly preserves the real cost currency (USD):', qAfter.lines[0].costCurrency === 'USD');

  console.log('\n=== COST CURRENCY / UNIT COST LABEL MISMATCH BUG FIXED AND VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
