const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
require('fake-indexeddb/auto');

const APP = __dirname;

async function main() {
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  window.indexedDB = global.indexedDB;
  window.IDBKeyRange = global.IDBKeyRange;
  window.confirm = () => true;

  const scripts = [...dom.window.document.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => s !== 'js/app.js');
  for (const src of scripts) dom.window.eval(fs.readFileSync(path.join(APP, src), 'utf8'));
  const win = dom.window;
  const doc = win.document;
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  await win.DB.openDB();
  await win.DB.ensureCounters();

  console.log('STEP 1: Default reference rates on a fresh install:', JSON.stringify((await win.DB.getSettings()).referenceRates));

  /* ---------- Add SGD, HKD, QAR, AED via Settings ---------- */
  win.location.hash = '#/settings';
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 2: Currency table renders with PHP + defaults (USD, EUR):', doc.getElementById('currencyTable').textContent.includes('PHP') && doc.getElementById('currencyTable').textContent.includes('USD') && doc.getElementById('currencyTable').textContent.includes('EUR'));

  const newCurrencies = [['SGD', '43.5'], ['HKD', '7.45'], ['QAR', '15.9'], ['AED', '15.8']];
  for (const [code, rate] of newCurrencies) {
    doc.getElementById('newCcyCode').value = code;
    doc.getElementById('newCcyRate').value = rate;
    doc.getElementById('btnAddCurrency').click();
    await wait(5);
  }
  console.log('STEP 3: All 4 new currency rows added to the table:', newCurrencies.every(([c]) => doc.getElementById('currencyTable').textContent.includes(c)));
  console.log('STEP 4: Default Currency dropdown includes the new currencies live:', newCurrencies.every(([c]) => [...doc.getElementById('s_defaultCurrency').options].some(o => o.value === c)));

  // Try adding a duplicate -> should be rejected
  doc.getElementById('newCcyCode').value = 'SGD';
  doc.getElementById('newCcyRate').value = '99';
  doc.getElementById('btnAddCurrency').click();
  await wait(5);
  const sgdCount = [...doc.querySelectorAll('.ccy-code')].filter(i => i.value === 'SGD').length;
  console.log('STEP 5: Duplicate currency code rejected (expect exactly 1 SGD row):', sgdCount === 1);

  doc.getElementById('settingsForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(20);
  const savedSettings = await win.DB.getSettings();
  console.log('STEP 6: Settings saved with all 6 currencies (USD, EUR + 4 new):', Object.keys(savedSettings.referenceRates).length === 6, JSON.stringify(savedSettings.referenceRates));
  console.log('STEP 7: QAR rate saved correctly:', savedSettings.referenceRates.QAR === 15.9);

  /* ---------- Currency now available on Products ---------- */
  win.location.hash = '#/products/new';
  await win.Router.resolveRoute();
  await wait(10);
  const productCcySelect = doc.getElementById('f_currency');
  console.log('STEP 8: Product currency dropdown includes AED:', [...productCcySelect.options].some(o => o.value === 'AED'));

  /* ---------- Currency now available on Suppliers ---------- */
  win.location.hash = '#/suppliers/new';
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 9: Supplier currency dropdown includes HKD:', [...doc.getElementById('f_currency').options].some(o => o.value === 'HKD'));

  /* ---------- Currency now available on Quotation line items ---------- */
  const custId = await win.DB.dbAdd('customers', { customerNo: 'CUST-00001', companyName: 'Test Co.', status: 'Active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  win.location.hash = '#/quotations/new';
  await win.Router.resolveRoute();
  await wait(10);
  const lineCcySelect = doc.querySelector('.ln-costccy');
  console.log('STEP 10: Quotation line Cost Currency dropdown includes QAR:', [...lineCcySelect.options].some(o => o.value === 'QAR'));

  // Use QAR on a line and confirm conversion math works with the new rate
  doc.getElementById('f_customerId').value = String(custId);
  const row = doc.querySelector('#linesBody tr');
  row.querySelector('.ln-desc').value = 'Item from Qatar supplier';
  row.querySelector('.ln-desc').dispatchEvent(new win.Event('input'));
  row.querySelector('.ln-qty').value = '1';
  row.querySelector('.ln-qty').dispatchEvent(new win.Event('input'));
  row.querySelector('.ln-cost').value = '1000'; // QAR 1000
  row.querySelector('.ln-cost').dispatchEvent(new win.Event('input'));
  row.querySelector('.ln-costccy').value = 'QAR';
  row.querySelector('.ln-costccy').dispatchEvent(new win.Event('change'));
  await wait(10);
  const row2 = doc.querySelector('#linesBody tr');
  console.log('STEP 11: Selecting QAR auto-fills the rate from Settings (expect 15.9):', row2.querySelector('.ln-rate').value === '15.9');
  row2.querySelector('.ln-markup').value = '20';
  row2.querySelector('.ln-markup').dispatchEvent(new win.Event('input'));
  await wait(10);
  const row3 = doc.querySelector('#linesBody tr');
  // Expected: QAR 1000 * 15.9 = PHP 15,900. +20% markup = PHP 19,080
  console.log('STEP 12: Markup correctly calculated on QAR->PHP converted cost (expect 19080):', row3.querySelector('.ln-price').value, Number(row3.querySelector('.ln-price').value) === 19080);

  console.log('\n=== ALL MULTI-CURRENCY CHECKS COMPLETE ===');
}

main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
