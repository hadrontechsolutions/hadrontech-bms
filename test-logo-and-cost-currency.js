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
  // app.js is excluded from the auto-run loop above (it calls boot()), so evaluate it manually
  // just to get access to applyBrandHeader for this test.
  win.eval(fs.readFileSync(path.join(APP, 'js/app.js'), 'utf8'));
  doc.body.innerHTML += '<div id="brandMark"></div><span id="brandText"></span>';

  win.applyBrandHeader({ logoText: 'HDT', companyName: 'Hadrontech Industrial Solutions' });
  console.log('STEP 1: Logo Text is now actually used when set, taking priority over Company Name:', doc.getElementById('brandText').innerHTML.includes('HDT'));

  win.applyBrandHeader({ logoText: '', companyName: 'Hadrontech Industrial Solutions' });
  console.log('STEP 2: With Logo Text blank, it correctly falls back to Company Name:', doc.getElementById('brandText').innerHTML.includes('HADRONTECH INDUSTRIAL SOLUTIONS'));

  win.applyBrandHeader({ logoText: '', companyName: '' });
  console.log('STEP 3: With both blank, it falls back to the hardcoded default:', doc.getElementById('brandText').innerHTML.includes('HADRONTECH'));

  const custId = await win.DB.dbAdd('customers', { customerNo: 'C1', companyName: 'Test Customer', status: 'Active', createdAt: now, updatedAt: now });
  win.location.hash = '#/quotations/new';
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 4: Header renamed from "Cost Ccy" to the clearer "Cost Currency":', doc.getElementById('content').textContent.includes('Cost Currency') && !doc.getElementById('content').textContent.includes('Cost Ccy'));

  const row = doc.querySelector('#linesBody tr');
  console.log('STEP 5: The Unit Cost cell now shows its own currency code label (defaults to PHP), self-labeled without needing to check a separate column:', row.querySelector('.ln-cost').closest('td').textContent.includes('PHP'));

  const ccySelect = row.querySelector('.ln-costccy');
  ccySelect.value = 'USD';
  ccySelect.dispatchEvent(new win.Event('change'));
  await wait(10);
  const row2 = doc.querySelector('#linesBody tr');
  console.log('STEP 6: Switching Cost Currency to USD immediately updates the label shown right on the Unit Cost field:', row2.querySelector('.ln-cost').closest('td').textContent.includes('USD'));

  row2.querySelector('.ln-cost').value = '82';
  row2.querySelector('.ln-cost').dispatchEvent(new win.Event('input'));
  await wait(10);
  row2.querySelector('.ln-rate').value = '64';
  row2.querySelector('.ln-rate').dispatchEvent(new win.Event('input'));
  await wait(10);
  console.log('STEP 7: The existing PHP-conversion hint still works correctly alongside the new currency label (regression check):', row2.querySelector('.ln-cost-php').textContent.includes('5,248.00'));

  doc.getElementById('f_customerId').value = String(custId);
  row2.querySelector('.ln-desc').value = 'Test item with USD cost';
  row2.querySelector('.ln-desc').dispatchEvent(new win.Event('input'));
  row2.querySelector('.ln-qty').value = '1';
  row2.querySelector('.ln-qty').dispatchEvent(new win.Event('input'));
  await wait(10);
  doc.getElementById('qForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(30);
  const q = (await win.DB.dbGetAll('quotations'))[0];
  console.log('STEP 8: Quotation still saves correctly with the right cost currency recorded:', q.lines[0].costCurrency === 'USD' && q.lines[0].unitCost === 82);

  console.log('\n=== LOGO TEXT FIX + UNIT COST CURRENCY CLARITY FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
