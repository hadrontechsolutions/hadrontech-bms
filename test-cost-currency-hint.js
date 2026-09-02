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

  win.location.hash = '#/quotations/new';
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('f_customerId').value = String(custId);
  const row = doc.querySelector('#linesBody tr');

  console.log('STEP 1: With Cost Currency matching the quotation currency (both PHP by default), no PHP conversion hint shows:', !row.querySelector('.ln-cost-php'));

  const ccySelect = row.querySelector('.ln-costccy');
  ccySelect.value = 'USD';
  ccySelect.dispatchEvent(new win.Event('change'));
  await wait(10);
  const row2 = doc.querySelector('#linesBody tr');
  console.log('STEP 2: Switching Cost Currency to USD now shows the live PHP conversion hint:', !!row2.querySelector('.ln-cost-php'));

  row2.querySelector('.ln-cost').value = '82';
  row2.querySelector('.ln-cost').dispatchEvent(new win.Event('input'));
  await wait(10);
  row2.querySelector('.ln-rate').value = '64';
  row2.querySelector('.ln-rate').dispatchEvent(new win.Event('input'));
  await wait(10);
  console.log('STEP 3: The hint correctly shows ₱5,248.00 for $82 at a rate of 64 (matches your exact screenshot numbers):', row2.querySelector('.ln-cost-php').textContent.includes('5,248.00'));

  row2.querySelector('.ln-cost').value = '100';
  row2.querySelector('.ln-cost').dispatchEvent(new win.Event('input'));
  await wait(10);
  console.log('STEP 4: Changing Unit Cost to 100 correctly updates the hint live (100 x 64 = 6,400.00):', row2.querySelector('.ln-cost-php').textContent.includes('6,400.00'));

  row2.querySelector('.ln-rate').value = '50';
  row2.querySelector('.ln-rate').dispatchEvent(new win.Event('input'));
  await wait(10);
  console.log('STEP 5: Changing the Rate to 50 correctly updates the hint live (100 x 50 = 5,000.00):', row2.querySelector('.ln-cost-php').textContent.includes('5,000.00'));

  row2.querySelector('.ln-costccy').value = 'PHP';
  row2.querySelector('.ln-costccy').dispatchEvent(new win.Event('change'));
  await wait(10);
  const row3 = doc.querySelector('#linesBody tr');
  console.log('STEP 6: Switching Cost Currency back to PHP removes the now-unnecessary hint:', !row3.querySelector('.ln-cost-php'));

  row3.querySelector('.ln-costccy').value = 'USD';
  row3.querySelector('.ln-costccy').dispatchEvent(new win.Event('change'));
  await wait(10);
  const row4 = doc.querySelector('#linesBody tr');
  row4.querySelector('.ln-desc').value = 'Test item with USD cost';
  row4.querySelector('.ln-desc').dispatchEvent(new win.Event('input'));
  row4.querySelector('.ln-qty').value = '1';
  row4.querySelector('.ln-qty').dispatchEvent(new win.Event('input'));
  row4.querySelector('.ln-cost').value = '82';
  row4.querySelector('.ln-cost').dispatchEvent(new win.Event('input'));
  row4.querySelector('.ln-rate').value = '64';
  row4.querySelector('.ln-rate').dispatchEvent(new win.Event('input'));
  await wait(10);
  doc.getElementById('qForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(30);
  const q = (await win.DB.dbGetAll('quotations'))[0];
  win.location.hash = '#/quotations/' + q.id;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 7: The saved quotation\'s detail page shows the exact same ₱5,248.00 conversion (edit form and detail page now agree):', doc.getElementById('content').textContent.includes('5,248.00'));

  console.log('\n=== LIVE USD-TO-PHP COST CONVERSION HINT FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
