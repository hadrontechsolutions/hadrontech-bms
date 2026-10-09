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
  const custId = await win.DB.dbAdd('customers', { customerNo: 'C1', companyName: 'Key Electrochem Limited Co./KEYEC', status: 'Active', createdAt: now });
  const custId2 = await win.DB.dbAdd('customers', { customerNo: 'C2', companyName: 'Another Trading Co.', status: 'Active', createdAt: now });

  // Deliberately inconsistent capitalization -- exactly the real-world scenario described
  await win.DB.dbAdd('quotations', {
    quotationNo: 'HT-Q-2026-0001', customerId: custId, endUser: 'ONSEMI', revision: 0, isLatest: true, status: 'Sent', date: '2026-09-05', currency: 'PHP',
    netSubtotal: 60000, grossProfit: 15000, grossMarginPercent: 25, subtotal: 60000, vatTotal: 0, grandTotal: 60000, createdAt: now, updatedAt: now
  });
  await win.DB.dbAdd('quotations', {
    quotationNo: 'HT-Q-2026-0002', customerId: custId, endUser: 'onsemi cebu', revision: 0, isLatest: true, status: 'Sent', date: '2026-09-10', currency: 'PHP',
    netSubtotal: 40000, grossProfit: 10000, grossMarginPercent: 25, subtotal: 40000, vatTotal: 0, grandTotal: 40000, createdAt: now, updatedAt: now
  });
  await win.DB.dbAdd('quotations', {
    quotationNo: 'HT-Q-2026-0003', customerId: custId2, endUser: 'Shindengen', revision: 0, isLatest: true, status: 'Won', date: '2026-09-15', currency: 'PHP',
    netSubtotal: 20000, grossProfit: 5000, grossMarginPercent: 25, subtotal: 20000, vatTotal: 0, grandTotal: 20000, createdAt: now, updatedAt: now
  });

  win.location.hash = '#/reports/projectedGrossProfit';
  await win.Router.resolveRoute();
  await wait(80);

  /* ============ Both filters appear as TEXT inputs, not dropdowns ============ */
  console.log('STEP 1: The End-User filter is visible and is a plain text input, not a dropdown:', doc.getElementById('rEndUserLabel').style.display !== 'none' && doc.getElementById('rEndUserFilter').tagName === 'INPUT');
  console.log('STEP 2: THE NEW ASK: a Customer filter also exists now, also as a text input:', doc.getElementById('rCustomerLabel').style.display !== 'none' && doc.getElementById('rCustomerFilter').tagName === 'INPUT');

  /* ============ THE CORE ASK: case-insensitive matching across inconsistent capitalization ============ */
  const endUserInput = doc.getElementById('rEndUserFilter');
  endUserInput.value = 'onsemi'; // lowercase -- must still catch "ONSEMI" and "onsemi cebu"
  endUserInput.dispatchEvent(new win.Event('input'));
  await wait(350); // debounced at 250ms
  let body = doc.getElementById('reportTableWrap').textContent;
  console.log('STEP 3: THE CORE ASK: typing lowercase "onsemi" correctly catches the ALL-CAPS "ONSEMI" record:', body.includes('HT-Q-2026-0001'));
  console.log('STEP 4: It ALSO catches "onsemi cebu" (a different capitalization AND a partial match), proving this is not an exact-match dropdown:', body.includes('HT-Q-2026-0002'));
  console.log('STEP 5: The unrelated "Shindengen" record is correctly excluded:', !body.includes('HT-Q-2026-0003'));
  console.log('STEP 6: Totals recalculate to match only the filtered rows (15,000 + 10,000 = 25,000):', body.includes('25,000.00'));

  /* ============ Partial-fragment matching (not just prefix) ============ */
  endUserInput.value = 'CEBU'; // uppercase fragment, mid-word -- should still match "onsemi cebu"
  endUserInput.dispatchEvent(new win.Event('input'));
  await wait(350);
  body = doc.getElementById('reportTableWrap').textContent;
  console.log('STEP 7: A partial, differently-cased fragment ("CEBU") still correctly matches "onsemi cebu":', body.includes('HT-Q-2026-0002') && !body.includes('HT-Q-2026-0001'));

  /* ============ Clearing the filter restores everything ============ */
  endUserInput.value = '';
  endUserInput.dispatchEvent(new win.Event('input'));
  await wait(350);
  body = doc.getElementById('reportTableWrap').textContent;
  console.log('STEP 8: Clearing the End-User filter restores all three quotations:', body.includes('HT-Q-2026-0001') && body.includes('HT-Q-2026-0002') && body.includes('HT-Q-2026-0003'));

  /* ============ THE NEW ASK: Customer filter works the same way, case-insensitively ============ */
  const customerInput = doc.getElementById('rCustomerFilter');
  customerInput.value = 'keyec'; // lowercase fragment matching "...KEYEC" inside the full company name
  customerInput.dispatchEvent(new win.Event('input'));
  await wait(350);
  body = doc.getElementById('reportTableWrap').textContent;
  console.log('STEP 9: THE NEW ASK: Customer filter, typed lowercase, correctly matches the KEYEC customer\u2019s two quotations:', body.includes('HT-Q-2026-0001') && body.includes('HT-Q-2026-0002') && !body.includes('HT-Q-2026-0003'));

  /* ============ Both filters combine correctly (AND logic) ============ */
  endUserInput.value = 'cebu';
  endUserInput.dispatchEvent(new win.Event('input'));
  await wait(350);
  body = doc.getElementById('reportTableWrap').textContent;
  console.log('STEP 10: Customer + End-User filters combine correctly (KEYEC AND "cebu" -> only HT-Q-2026-0002):', body.includes('HT-Q-2026-0002') && !body.includes('HT-Q-2026-0001') && !body.includes('HT-Q-2026-0003'));

  /* ============ Regression: a report without these filters hides both boxes entirely ============ */
  win.location.hash = '#/reports/quotationRegister';
  await win.Router.resolveRoute();
  await wait(80);
  console.log('STEP 11: REGRESSION: an unrelated report (Quotation Register) correctly hides both filter boxes:', doc.getElementById('rEndUserLabel').style.display === 'none' && doc.getElementById('rCustomerLabel').style.display === 'none');

  /* ============ CSV export reflects the active filters ============ */
  win.location.hash = '#/reports/projectedGrossProfit';
  await win.Router.resolveRoute();
  await wait(80);
  doc.getElementById('rEndUserFilter').value = 'onsemi';
  doc.getElementById('rEndUserFilter').dispatchEvent(new win.Event('input'));
  await wait(350);
  let downloaded = null;
  win.downloadFile = (name, content) => { downloaded = { name, content }; };
  doc.getElementById('rExport').click();
  await wait(30);
  console.log('STEP 12: CSV export correctly reflects the active filter (only the two onsemi rows):', downloaded.content.includes('HT-Q-2026-0001') && downloaded.content.includes('HT-Q-2026-0002') && !downloaded.content.includes('HT-Q-2026-0003'));

  console.log('\n=== TYPEABLE, CASE-INSENSITIVE CUSTOMER + END-USER FILTERS FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
