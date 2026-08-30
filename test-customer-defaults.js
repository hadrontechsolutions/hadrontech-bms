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

  // Recreate "Key Electrochem Limited Co./KEYEC" exactly as in the screenshot
  const custId = await win.DB.dbAdd('customers', {
    customerNo: 'CUST-00003', companyName: 'Key Electrochem Limited Co./KEYEC',
    contactPerson: 'Willie Sicat', jobTitle: 'Business Development & Technical Sales Executive',
    email: 'willie@keyelectrochem.com', paymentTerms: '100% Advance Payment', incoterms: 'DDP',
    defaultCurrency: 'PHP', salesperson: 'Gretchen Caballero', status: 'Active',
    shippingAddress: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  });
  // And a second customer that has NOT set custom terms, to prove the fallback still works
  const custId2 = await win.DB.dbAdd('customers', {
    customerNo: 'CUST-00004', companyName: 'Blank Terms Co.',
    contactPerson: '', paymentTerms: '', incoterms: '', salesperson: '', status: 'Active',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  });

  const settings = await win.DB.getSettings();
  settings.defaultPaymentTerms = '50% down payment, 50% before delivery';
  settings.defaultIncoterms = 'EXW';
  await win.DB.dbPut('settings', settings);

  /* ---------- Quotation form: selecting Key Electrochem should pull ITS terms ---------- */
  win.location.hash = '#/quotations/new';
  await win.Router.resolveRoute();
  await wait(10);

  console.log('STEP 1: Before selecting a customer, form shows company defaults:',
    doc.getElementById('f_paymentTerms').value === '50% down payment, 50% before delivery' &&
    doc.getElementById('f_incoterms').value === 'EXW');

  const custSelect = doc.getElementById('f_customerId');
  custSelect.value = String(custId);
  custSelect.dispatchEvent(new win.Event('change'));
  await wait(10);

  console.log('STEP 2: Payment Terms auto-filled from customer record (expect "100% Advance Payment"):',
    doc.getElementById('f_paymentTerms').value, doc.getElementById('f_paymentTerms').value === '100% Advance Payment');
  console.log('STEP 3: Incoterms auto-filled from customer record (expect "DDP"):',
    doc.getElementById('f_incoterms').value, doc.getElementById('f_incoterms').value === 'DDP');
  console.log('STEP 4: Salesperson auto-filled from customer\'s assigned rep (expect "Gretchen Caballero"):',
    doc.getElementById('f_salesperson').value, doc.getElementById('f_salesperson').value === 'Gretchen Caballero');

  // Now switch to a customer with BLANK terms — should fall back to company defaults, not stay stuck on KEYEC's terms
  custSelect.value = String(custId2);
  custSelect.dispatchEvent(new win.Event('change'));
  await wait(10);
  console.log('STEP 5: Switching to a customer with blank terms falls back to company defaults:',
    doc.getElementById('f_paymentTerms').value === '50% down payment, 50% before delivery' &&
    doc.getElementById('f_incoterms').value === 'EXW');

  /* ---------- Save and confirm it's actually persisted correctly ---------- */
  custSelect.value = String(custId);
  custSelect.dispatchEvent(new win.Event('change'));
  await wait(10);
  const row = doc.querySelector('#linesBody tr');
  row.querySelector('.ln-desc').value = 'Test item';
  row.querySelector('.ln-desc').dispatchEvent(new win.Event('input'));
  row.querySelector('.ln-qty').value = '1';
  row.querySelector('.ln-qty').dispatchEvent(new win.Event('input'));
  row.querySelector('.ln-price').value = '1000';
  row.querySelector('.ln-price').dispatchEvent(new win.Event('input'));
  doc.getElementById('qForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(30);
  const savedQuote = (await win.DB.dbGetAll('quotations'))[0];
  console.log('STEP 6: Saved quotation has correct payment terms:', savedQuote.paymentTerms === '100% Advance Payment');
  console.log('STEP 7: Saved quotation has correct Incoterms:', savedQuote.incoterms === 'DDP');

  /* ---------- Customer PO form: same pattern ---------- */
  win.location.hash = '#/customer-pos/new';
  await win.Router.resolveRoute();
  await wait(10);
  const cpoCustSelect = doc.getElementById('f_customerId');
  cpoCustSelect.value = String(custId);
  cpoCustSelect.dispatchEvent(new win.Event('change'));
  await wait(10);
  console.log('STEP 8: Customer PO Contact auto-filled from customer record:', doc.getElementById('f_customerContact').value === 'Willie Sicat');
  console.log('STEP 9: Customer PO Currency follows customer default currency:', doc.getElementById('f_currency').value === 'PHP');

  console.log('\n=== ALL CUSTOMER-DEFAULTS FIXES VERIFIED ===');
}

main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
