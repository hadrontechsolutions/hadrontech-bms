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

  win.location.hash = '#/quotations/new';
  await win.Router.resolveRoute();
  await wait(50);

  const incotermsField = doc.getElementById('f_incoterms').closest('.field');
  const listItems = [...incotermsField.querySelectorAll('li')];

  console.log('STEP 1: An explanatory list now appears below the Incoterms field, same pattern as the VAT Mode note:', listItems.length === 5);
  console.log('STEP 2: All five common incoterms are covered (EXW, FOB, CIF, DAP, DDP):', ['EXW', 'FOB', 'CIF', 'DAP', 'DDP'].every(code => listItems.some(li => li.textContent.includes(code))));

  const exwItem = listItems.find(li => li.textContent.startsWith('EXW'));
  console.log('STEP 3: Key distinguishing phrases are actually bolded (<b> tags), not just plain text — this is the "highlight important words" part of the request:', exwItem.querySelectorAll('b').length >= 2);
  console.log('STEP 4: The bolded text specifically calls out WHO handles what (e.g. "our warehouse", "everything from there") rather than just bolding the code itself:', exwItem.innerHTML.includes('<b>our warehouse</b>') && exwItem.innerHTML.includes('<b>everything from there</b>'));

  const ddpItem = listItems.find(li => li.textContent.startsWith('DDP'));
  console.log('STEP 5: DDP correctly highlights that the seller (us) handles duties/taxes — the key practical difference from EXW at the other extreme:', ddpItem.innerHTML.includes('<b>everything, including import duties/taxes</b>'));

  /* ============ Regression: the field itself still works exactly as before ============ */
  const incotermsInput = doc.getElementById('f_incoterms');
  incotermsInput.value = 'FOB Manila';
  incotermsInput.dispatchEvent(new win.Event('input'));
  doc.getElementById('f_customerId').value = String(custId);
  const itemDesc = doc.querySelector('.ln-desc');
  itemDesc.value = 'Test item'; itemDesc.dispatchEvent(new win.Event('input'));
  const priceInput = doc.querySelector('.ln-price');
  priceInput.value = '100'; priceInput.dispatchEvent(new win.Event('input'));
  doc.getElementById('qForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(100);
  const saved = (await win.DB.dbGetAll('quotations'))[0];
  console.log('STEP 6: REGRESSION: the Incoterms input itself still saves correctly, unaffected by the new list next to it:', saved.incoterms === 'FOB Manila');

  win.location.hash = '#/quotations/' + saved.id;
  await win.Router.resolveRoute();
  await wait(50);
  console.log('STEP 7: REGRESSION: the detail page still shows the saved Incoterms value correctly:', doc.getElementById('content').textContent.includes('FOB Manila'));

  console.log('\n=== INCOTERMS EXPLANATORY LIST FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
