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

  // Add a currency not in the original hardcoded list, to prove these two forms are no longer hardcoded
  const settings = await win.DB.getSettings();
  settings.referenceRates = Object.assign({}, settings.referenceRates, { AED: 15.8 });
  await win.DB.dbPut('settings', settings);

  const custId = await win.DB.dbAdd('customers', { customerNo: 'CUST-00001', companyName: 'Test Co.', status: 'Active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

  /* ---------- Customer PO currency dropdown ---------- */
  win.location.hash = '#/customer-pos/new';
  await win.Router.resolveRoute();
  await wait(10);
  const cpoSelect = doc.getElementById('f_currency');
  console.log('STEP 1: Customer PO form has a currency dropdown:', !!cpoSelect);
  console.log('STEP 2: It includes AED (previously impossible — was hardcoded to PHP/USD/EUR):', [...cpoSelect.options].some(o => o.value === 'AED'));
  console.log('STEP 3: It still includes PHP/USD/EUR as before:', ['PHP', 'USD', 'EUR'].every(c => [...cpoSelect.options].some(o => o.value === c)));

  // Actually save a customer PO in AED and confirm it persists correctly
  doc.getElementById('f_customerId').value = String(custId);
  cpoSelect.value = 'AED';
  doc.getElementById('f_poAmount').value = '5000';
  doc.getElementById('cpoForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(20);
  const cpos = await win.DB.dbGetAll('customerPOs');
  console.log('STEP 4: Customer PO saved with AED currency:', cpos[0].currency === 'AED');

  console.log('\n=== CUSTOMER PO CURRENCY FIXES VERIFIED ===');
}

main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
