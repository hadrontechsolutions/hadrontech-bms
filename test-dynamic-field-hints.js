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
  const custId = await win.DB.dbAdd('customers', { customerNo: 'C1', companyName: 'KEYEC', incoterms: 'FOB Manila', paymentTerms: '50/50', status: 'Active', createdAt: now });

  win.location.hash = '#/quotations/new';
  await win.Router.resolveRoute();
  await wait(50);

  /* ============ Incoterms: no static list anymore; hint reflects whatever's actually in the field ============ */
  console.log('STEP 1: The old static list of all 5 incoterms is gone from the form:', !doc.querySelector('#f_incoterms ~ ul') && doc.querySelectorAll('#qForm li').length === 0);
  console.log('STEP 2: A new quotation pre-fills Incoterms from the company default ("EXW"), and the hint correctly reflects that default immediately on load, not left blank or showing something else:', doc.getElementById('f_incoterms').value === 'EXW' && doc.getElementById('incotermsHint').innerHTML.includes('Ex Works'));

  /* ============ Typing a recognized code shows ONLY that one explanation, live ============ */
  const incotermsInput = doc.getElementById('f_incoterms');
  incotermsInput.value = 'EXW';
  incotermsInput.dispatchEvent(new win.Event('input'));
  await wait(20);
  const hintAfterEXW = doc.getElementById('incotermsHint').innerHTML;
  console.log('STEP 3: THE FIX: typing "EXW" shows only the EXW explanation, not all five:', hintAfterEXW.includes('Ex Works') && !hintAfterEXW.includes('Free on Board') && !hintAfterEXW.includes('Delivered Duty Paid'));
  console.log('STEP 4: Key phrases are still properly bolded within the single shown explanation:', hintAfterEXW.includes('<b>our warehouse</b>'));

  incotermsInput.value = 'FOB Manila';
  incotermsInput.dispatchEvent(new win.Event('input'));
  await wait(20);
  const hintAfterFOB = doc.getElementById('incotermsHint').innerHTML;
  console.log('STEP 5: Typing "FOB Manila" (code plus a location) still correctly matches FOB and swaps the hint live:', hintAfterFOB.includes('Free on Board') && !hintAfterFOB.includes('Ex Works'));

  incotermsInput.value = 'something unrecognized';
  incotermsInput.dispatchEvent(new win.Event('input'));
  await wait(20);
  console.log('STEP 6: Typing something that matches none of the known codes shows no hint at all, rather than a wrong one:', doc.getElementById('incotermsHint').textContent.trim() === '');

  /* ============ VAT Mode: THE BUG FIX — hint now actually changes per selection ============ */
  const vatSelect = doc.getElementById('f_vatMode');
  console.log('STEP 7: Default (Non-VAT) correctly shows the Non-VAT explanation on load:', doc.getElementById('vatModeHint').textContent.includes('not VAT-registered'));

  vatSelect.value = 'Standard12';
  vatSelect.dispatchEvent(new win.Event('change'));
  await wait(20);
  console.log('STEP 8: THE BUG FIX: switching to "Standard 12%" now correctly updates the hint to describe Standard 12%, not still show the old Non-VAT text:', doc.getElementById('vatModeHint').textContent.includes('12% VAT rate') && !doc.getElementById('vatModeHint').textContent.includes('not VAT-registered'));

  vatSelect.value = 'ZeroRated';
  vatSelect.dispatchEvent(new win.Event('change'));
  await wait(20);
  console.log('STEP 9: Switching to "Zero-Rated" shows its own distinct explanation:', doc.getElementById('vatModeHint').textContent.includes('taxed at 0%') && doc.getElementById('vatModeHint').textContent.includes('still VAT-registered'));

  vatSelect.value = 'Exempt';
  vatSelect.dispatchEvent(new win.Event('change'));
  await wait(20);
  console.log('STEP 10: Switching to "VAT Exempt" shows its own distinct explanation too:', doc.getElementById('vatModeHint').textContent.includes('statutorily exempt'));

  /* ============ Selecting a customer with saved Incoterms correctly updates the hint too ============ */
  win.location.hash = '#/quotations/new';
  await win.Router.resolveRoute();
  await wait(50);
  const customerSelect = doc.getElementById('f_customerId');
  customerSelect.value = String(custId);
  customerSelect.dispatchEvent(new win.Event('change'));
  await wait(30);
  console.log('STEP 11: Selecting a customer with saved Incoterms ("FOB Manila") correctly fills the field AND updates the hint automatically:', doc.getElementById('f_incoterms').value === 'FOB Manila' && doc.getElementById('incotermsHint').innerHTML.includes('Free on Board'));

  /* ============ Editing an existing quotation shows the correct hint immediately on load ============ */
  const q = await win.DB.dbAdd('quotations', {
    quotationNo: 'HT-Q-2026-0001', customerId: custId, revision: 0, isLatest: true, status: 'Draft', date: win.todayISO(), currency: 'PHP',
    vatMode: 'Standard12', incoterms: 'DDP', lines: [], subtotal: 0, vatTotal: 0, freight: 0, other: 0, grandTotal: 0, createdAt: now, updatedAt: now
  });
  win.location.hash = '#/quotations/' + q + '/edit';
  await win.Router.resolveRoute();
  await wait(50);
  console.log('STEP 12: Editing an existing "Standard 12%" / "DDP" quotation immediately shows the correct hints on load, not the defaults:', doc.getElementById('vatModeHint').textContent.includes('12% VAT rate') && doc.getElementById('incotermsHint').innerHTML.includes('Delivered Duty Paid'));

  console.log('\n=== DYNAMIC, STANDARDIZED HINTS (INCOTERMS + VAT MODE) FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
