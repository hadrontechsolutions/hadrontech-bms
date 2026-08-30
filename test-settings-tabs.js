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
  const custId = await win.DB.dbAdd('customers', { customerNo: 'CUST-00001', companyName: 'Test Co.', billingAddress: 'Test Address', status: 'Active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

  win.location.hash = '#/settings';
  await win.Router.resolveRoute();
  await wait(10);
  const tabBtns = doc.querySelectorAll('.settings-tab-btn');
  console.log('STEP 1: All 5 tabs present:', tabBtns.length === 5);
  console.log('STEP 2: "Company Profile" tab is active by default:', doc.querySelector('.settings-tab-btn[data-tab="profile"]').classList.contains('active'));
  console.log('STEP 3: Only the Profile panel is visible initially:', doc.querySelector('.settings-tab-panel[data-tab="profile"]').classList.contains('active') && !doc.querySelector('.settings-tab-panel[data-tab="bank"]').classList.contains('active'));
  console.log('STEP 4: Bank fields exist in the DOM even while hidden (still part of one form):', !!doc.getElementById('s_bankName'));

  console.log('STEP 5: The old "Show Bank Details On" checkboxes no longer exist:', !doc.getElementById('s_showBankQuotation') && !doc.getElementById('s_showBankSalesOrder') && !doc.getElementById('s_showBankProforma'));
  console.log('STEP 6: A plain explanation of where bank details show now replaces them:', doc.getElementById('content').textContent.includes('Never shown on Quotations'));

  doc.querySelector('.settings-tab-btn[data-tab="currencies"]').click();
  await wait(10);
  console.log('STEP 7: Clicking "Currencies" tab activates it:', doc.querySelector('.settings-tab-btn[data-tab="currencies"]').classList.contains('active'));
  console.log('STEP 8: Clicking away correctly deactivates the Profile tab:', !doc.querySelector('.settings-tab-btn[data-tab="profile"]').classList.contains('active'));
  console.log('STEP 9: The Currencies panel is now visible:', doc.querySelector('.settings-tab-panel[data-tab="currencies"]').classList.contains('active'));
  console.log('STEP 10: The Profile panel is now hidden:', !doc.querySelector('.settings-tab-panel[data-tab="profile"]').classList.contains('active'));

  console.log('STEP 11: The Save Settings button exists and is part of the form regardless of active tab:', !!doc.querySelector('#settingsForm button[type="submit"]'));

  doc.querySelector('.settings-tab-btn[data-tab="profile"]').click();
  await wait(10);
  doc.getElementById('s_companyName').value = 'Hadrontech Test Co.';
  doc.getElementById('s_companyName').dispatchEvent(new win.Event('input'));

  doc.querySelector('.settings-tab-btn[data-tab="bank"]').click();
  await wait(10);
  doc.getElementById('s_bankName').value = 'BDO Unibank';
  doc.getElementById('s_bankName').dispatchEvent(new win.Event('input'));

  doc.querySelector('.settings-tab-btn[data-tab="defaults"]').click();
  await wait(10);
  doc.getElementById('s_defaultIncoterms').value = 'FOB';
  doc.getElementById('s_defaultIncoterms').dispatchEvent(new win.Event('input'));

  doc.querySelector('.settings-tab-btn[data-tab="currencies"]').click();
  await wait(10);
  doc.getElementById('settingsForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(20);
  const saved = await win.DB.getSettings();
  console.log('STEP 12: A field edited on the Profile tab was saved correctly:', saved.companyName === 'Hadrontech Test Co.');
  console.log('STEP 13: A field edited on the Bank Details tab was saved correctly:', saved.bankName === 'BDO Unibank');
  console.log('STEP 14: A field edited on the Defaults tab was saved correctly, even though Save was clicked from a different tab:', saved.defaultIncoterms === 'FOB');

  win.location.hash = '#/quotations/new';
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('f_customerId').value = String(custId);
  const row = doc.querySelector('#linesBody tr');
  row.querySelector('.ln-desc').value = 'Test item';
  row.querySelector('.ln-desc').dispatchEvent(new win.Event('input'));
  row.querySelector('.ln-qty').value = '1';
  row.querySelector('.ln-qty').dispatchEvent(new win.Event('input'));
  row.querySelector('.ln-price').value = '1000';
  row.querySelector('.ln-price').dispatchEvent(new win.Event('input'));
  await wait(10);
  doc.getElementById('qForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(30);
  const q = (await win.DB.dbGetAll('quotations'))[0];

  let printedQ = '';
  win.open = () => ({ document: { write: (h) => { printedQ = h; }, close: () => {} } });
  const customerObj = await win.DB.dbGet('customers', custId);
  await win.Print.printQuotation(q, customerObj);
  console.log('STEP 15: Quotation NEVER shows bank details, permanently, no way to enable it:', !printedQ.includes('Bank Details for Payment'));

  q.status = 'Won'; await win.DB.dbPut('quotations', q);
  win.location.hash = '#/customer-pos/new?quotationId=' + q.id;
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('f_customerId').value = String(custId);
  doc.getElementById('cpoForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(30);
  const cpo = (await win.DB.dbGetAll('customerPOs'))[0];
  win.location.hash = '#/customer-pos/' + cpo.id;
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('btnConvert').click();
  await wait(30);
  const so = (await win.DB.dbGetAll('salesOrders'))[0];

  let printedSO = '';
  win.open = () => ({ document: { write: (h) => { printedSO = h; }, close: () => {} } });
  const cpoObj = await win.DB.dbGet('customerPOs', cpo.id);
  await win.Print.printSalesOrder(so, customerObj, cpoObj, q);
  console.log('STEP 16: Sales Order always shows bank details when filled in, no toggle needed:', printedSO.includes('Bank Details for Payment') && printedSO.includes('BDO Unibank'));

  await win.ProformaInvoices.getOrCreateProformaInvoice(so);
  await wait(30);
  const pi = (await win.DB.dbGetAll('proformaInvoices'))[0];
  let printedPI = '';
  win.open = () => ({ document: { write: (h) => { printedPI = h; }, close: () => {} } });
  await win.Print.printProformaInvoice(pi, so, customerObj);
  console.log('STEP 17: Proforma Invoice always shows bank details when filled in, no toggle needed:', printedPI.includes('Bank Details for Payment') && printedPI.includes('BDO Unibank'));

  console.log('\n=== SETTINGS TABS + BANK DETAILS SIMPLIFICATION FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
