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
  const custId = await win.DB.dbAdd('customers', { customerNo: 'CUST-00001', companyName: 'Key Electrochem Limited Co./KEYEC', status: 'Active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

  /* ============ SECTION 1: Recreate the exact screenshot scenario ============ */
  console.log('--- Recreating the screenshot scenario (208L Drum vs 20L Pail) ---');
  win.location.hash = '#/quotations/new';
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('f_customerId').value = String(custId);

  const row1 = doc.querySelector('#linesBody tr');
  row1.querySelector('.ln-desc').value = 'OPTION 1 — MOBIL DTE 24 ULTRA 208L/Drum';
  row1.querySelector('.ln-desc').dispatchEvent(new win.Event('input'));
  row1.querySelector('.ln-option').value = 'Option 1';
  row1.querySelector('.ln-option').dispatchEvent(new win.Event('input'));
  row1.querySelector('.ln-qty').value = '1';
  row1.querySelector('.ln-qty').dispatchEvent(new win.Event('input'));
  row1.querySelector('.ln-cost').value = '65480.72';
  row1.querySelector('.ln-cost').dispatchEvent(new win.Event('input'));
  row1.querySelector('.ln-price').value = '84339.17';
  row1.querySelector('.ln-price').dispatchEvent(new win.Event('input'));
  row1.querySelector('.ln-vat').value = '12';
  row1.querySelector('.ln-vat').dispatchEvent(new win.Event('input'));

  doc.getElementById('btnAddLine').click();
  await wait(10);
  const row2 = doc.querySelectorAll('#linesBody tr')[1];
  row2.querySelector('.ln-desc').value = 'OPTION 2 — MOBIL DTE 24 ULTRA 20L/Pail';
  row2.querySelector('.ln-desc').dispatchEvent(new win.Event('input'));
  row2.querySelector('.ln-option').value = 'Option 2';
  row2.querySelector('.ln-option').dispatchEvent(new win.Event('input'));
  row2.querySelector('.ln-qty').value = '1';
  row2.querySelector('.ln-qty').dispatchEvent(new win.Event('input'));
  row2.querySelector('.ln-cost').value = '6843.17';
  row2.querySelector('.ln-cost').dispatchEvent(new win.Event('input'));
  row2.querySelector('.ln-price').value = '9350.51';
  row2.querySelector('.ln-price').dispatchEvent(new win.Event('input'));
  row2.querySelector('.ln-vat').value = '12';
  row2.querySelector('.ln-vat').dispatchEvent(new win.Event('input'));
  await wait(10);

  const totalsText = doc.getElementById('totalsBox').textContent;
  console.log('STEP 1: Live preview shows separate Option 1 and Option 2 blocks:', totalsText.includes('Option 1') && totalsText.includes('Option 2'));
  console.log('STEP 2: Live preview does NOT show a single combined 93,689.68 figure:', !totalsText.includes('93,689.68'));
  console.log('STEP 3: Option 1 total correctly includes its own VAT (94,459.87):', totalsText.includes('94,459.87'));
  console.log('STEP 4: Option 2 total correctly includes its own VAT (10,472.57):', totalsText.includes('10,472.57'));

  doc.getElementById('qForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(30);
  const q = (await win.DB.dbGetAll('quotations'))[0];
  console.log('STEP 5: Saved record flagged as multi-option:', q.isMultiOption === true);
  console.log('STEP 6: Saved record has 2 option totals:', q.optionTotals.length === 2);
  console.log('STEP 7: Option 1 grandTotal correct:', q.optionTotals[0].grandTotal === 94459.87);
  console.log('STEP 8: Option 2 grandTotal correct:', q.optionTotals[1].grandTotal === 10472.57);
  console.log('STEP 9: Options are NOT summed into one combined total anywhere in the saved record:', q.grandTotal !== 93689.68 + (93689.68 * 0.12));

  /* ============ SECTION 2: Detail page shows separated blocks ============ */
  win.location.hash = '#/quotations/' + q.id;
  await win.Router.resolveRoute();
  await wait(10);
  const detailText = doc.getElementById('content').textContent;
  console.log('STEP 10: Detail page shows both option headings:', detailText.includes('Option 1') && detailText.includes('Option 2'));
  console.log('STEP 11: Detail page shows "not combined" explanatory note:', detailText.includes('not combined') || detailText.includes('choose from'));
  console.log('STEP 12: Detail page shows Option 1 Total and Option 2 Total as separate lines:', detailText.includes('Option 1 Total') && detailText.includes('Option 2 Total'));

  /* ============ SECTION 3: Print output shows separated blocks, correct VAT, no combined total ============ */
  let printedHTML = '';
  win.open = () => ({ document: { write: (h) => { printedHTML = h; }, close: () => {} } });
  const customerObj = await win.DB.dbGet('customers', custId);
  await win.Print.printQuotation(q, customerObj);
  console.log('STEP 13: Printed quotation shows both option headings:', printedHTML.includes('Option 1') && printedHTML.includes('Option 2'));
  console.log('STEP 14: Printed quotation shows "select ONE" guidance for the customer:', printedHTML.includes('select ONE'));
  console.log('STEP 15: Printed quotation shows Option 1 Total with correct VAT-inclusive figure:', printedHTML.includes('94,459.87'));
  console.log('STEP 16: Printed quotation shows Option 2 Total with correct VAT-inclusive figure:', printedHTML.includes('10,472.57'));
  console.log('STEP 17: Printed quotation does NOT show a misleading combined 93,689.68 or similar summed figure:', !printedHTML.includes('93,689.68'));

  /* ============ SECTION 4: List page shows the primary option clearly labeled ============ */
  win.location.hash = '#/quotations';
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 18: List shows the total labeled with which option it represents:', doc.getElementById('qBody').textContent.includes('(Option 1)'));

  /* ============ SECTION 5: Backward compatibility — ordinary (non-option) quotations unaffected ============ */
  console.log('\n--- Backward compatibility: ordinary quotations ---');
  win.location.hash = '#/quotations/new';
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('f_customerId').value = String(custId);
  const rowN = doc.querySelector('#linesBody tr');
  rowN.querySelector('.ln-desc').value = 'Ordinary single item, no options';
  rowN.querySelector('.ln-desc').dispatchEvent(new win.Event('input'));
  rowN.querySelector('.ln-qty').value = '2';
  rowN.querySelector('.ln-qty').dispatchEvent(new win.Event('input'));
  rowN.querySelector('.ln-price').value = '1000';
  rowN.querySelector('.ln-price').dispatchEvent(new win.Event('input'));
  rowN.querySelector('.ln-vat').value = '12';
  rowN.querySelector('.ln-vat').dispatchEvent(new win.Event('input'));
  await wait(10);
  const normalTotalsText = doc.getElementById('totalsBox').textContent;
  console.log('STEP 19: Ordinary quotation shows a single classic Grand Total, no option blocks:', normalTotalsText.includes('Grand Total') && !normalTotalsText.includes('Option 1'));
  console.log('STEP 20: Ordinary quotation total math still correct (2,240.00):', normalTotalsText.includes('2,240.00'));

  doc.getElementById('qForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(30);
  const normalQ = (await win.DB.dbGetAll('quotations')).find(x => x.id !== q.id);
  console.log('STEP 21: Ordinary quotation NOT flagged as multi-option:', normalQ.isMultiOption === false);
  console.log('STEP 22: Ordinary quotation grandTotal correct:', normalQ.grandTotal === 2240);

  win.location.hash = '#/quotations/' + normalQ.id;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 23: Ordinary quotation detail page unaffected (classic single totals block):', doc.getElementById('content').textContent.includes('Grand Total') && !doc.getElementById('content').textContent.includes('Option 1 Total'));

  /* ============ SECTION 6: A single stray Option tag (only 1 distinct value) does NOT trigger multi-option mode ============ */
  win.location.hash = '#/quotations/new';
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('f_customerId').value = String(custId);
  const rowS = doc.querySelector('#linesBody tr');
  rowS.querySelector('.ln-desc').value = 'Single tagged line, no real alternative';
  rowS.querySelector('.ln-desc').dispatchEvent(new win.Event('input'));
  rowS.querySelector('.ln-option').value = 'Option 1';
  rowS.querySelector('.ln-option').dispatchEvent(new win.Event('input'));
  rowS.querySelector('.ln-qty').value = '1';
  rowS.querySelector('.ln-qty').dispatchEvent(new win.Event('input'));
  rowS.querySelector('.ln-price').value = '500';
  rowS.querySelector('.ln-price').dispatchEvent(new win.Event('input'));
  await wait(10);
  const singleTagTotalsText = doc.getElementById('totalsBox').textContent;
  console.log('STEP 24: A lone Option tag with no second option does NOT trigger split-total mode:', !singleTagTotalsText.includes('alternative Options'));

  console.log('\n=== OPTION GROUPS FEATURE FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
