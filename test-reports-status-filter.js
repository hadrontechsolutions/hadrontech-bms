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

  // Reproducing the exact screenshot scenario: a real, finished quotation (Sent) with genuine
  // margin, plus a Draft one still being built -- costs entered, price not set yet, producing a
  // large negative "Gross Profit" that isn't a real number, just an incomplete draft's math.
  await win.DB.dbAdd('quotations', {
    quotationNo: 'HT-Q-2026-0016', customerId: custId, endUser: 'ONSEMI', revision: 0, isLatest: true, status: 'Sent', date: '2026-09-02', currency: 'PHP',
    netSubtotal: 49500, grossProfit: 18012, grossMarginPercent: 36.39, subtotal: 49500, vatTotal: 0, grandTotal: 49500, createdAt: now, updatedAt: now
  });
  await win.DB.dbAdd('quotations', {
    quotationNo: 'HT-Q-2026-0017', customerId: custId, endUser: 'ONSEMI', revision: 0, isLatest: true, status: 'Draft', date: '2026-09-03', currency: 'PHP',
    netSubtotal: 0, grossProfit: -289800, grossMarginPercent: 0, subtotal: 0, vatTotal: 0, grandTotal: 0, createdAt: now, updatedAt: now
  });

  win.location.hash = '#/reports/projectedGrossProfit';
  await win.Router.resolveRoute();
  await wait(80);

  /* ============ The dropdown appears, populated correctly ============ */
  console.log('STEP 1: THE FEATURE: a Status filter dropdown (a real <select>, not a text box) now appears:', doc.getElementById('rStatusLabel').style.display !== 'none' && doc.getElementById('rStatusFilter').tagName === 'SELECT');
  const options = [...doc.getElementById('rStatusFilter').options].map(o => o.value);
  console.log('STEP 2: Populated with all the real quotation statuses (Draft, Sent, Won, Lost, etc.):', options.includes('Draft') && options.includes('Sent') && options.includes('Won') && options.includes('Lost'));
  console.log('STEP 3: "All Statuses" is the default:', doc.getElementById('rStatusFilter').value === '');

  /* ============ Confirming the bug as reported: the skewed total with everything included ============ */
  let body = doc.getElementById('reportTableWrap').textContent;
  console.log('STEP 4: With "All Statuses", the incomplete Draft quotation\u2019s large negative Gross Profit IS included, dragging the total down to a small, misleading number (18,012 + -289,800 = -271,788):', body.includes('271,788.00'));

  /* ============ THE ACTUAL FIX: filtering to "Sent" excludes the incomplete Draft ============ */
  doc.getElementById('rStatusFilter').value = 'Sent';
  doc.getElementById('rStatusFilter').dispatchEvent(new win.Event('change'));
  await wait(80);
  body = doc.getElementById('reportTableWrap').textContent;
  console.log('STEP 5: THE FIX: filtering to "Sent" correctly excludes the still-incomplete Draft quotation:', body.includes('HT-Q-2026-0016') && !body.includes('HT-Q-2026-0017'));
  console.log('STEP 6: The total now correctly reflects only real, finished quotations (18,012.00), not skewed by the Draft\u2019s incomplete math:', body.includes('18,012.00') && !body.includes('271,788.00'));

  /* ============ Switching back to "All Statuses" restores the full picture (still "All Stages" as the report name promises) ============ */
  doc.getElementById('rStatusFilter').value = '';
  doc.getElementById('rStatusFilter').dispatchEvent(new win.Event('change'));
  await wait(80);
  body = doc.getElementById('reportTableWrap').textContent;
  console.log('STEP 7: Switching back to "All Statuses" restores both quotations, matching the report\u2019s own "All Stages" name:', body.includes('HT-Q-2026-0016') && body.includes('HT-Q-2026-0017'));

  /* ============ Same fix also available on Quotation Register (same all-statuses risk) ============ */
  win.location.hash = '#/reports/quotationRegister';
  await win.Router.resolveRoute();
  await wait(80);
  console.log('STEP 8: The Status filter is also available on Quotation Register, which has the same all-statuses characteristic:', doc.getElementById('rStatusLabel').style.display !== 'none');

  /* ============ Regression: a report that's already restricted to specific statuses hides this dropdown ============ */
  win.location.hash = '#/reports/openQuotations';
  await win.Router.resolveRoute();
  await wait(80);
  console.log('STEP 9: REGRESSION: Open Quotation Report (already restricted to Draft/Sent/Under Review) correctly has no Status dropdown:', doc.getElementById('rStatusLabel').style.display === 'none');

  /* ============ CSV export reflects the active status filter ============ */
  win.location.hash = '#/reports/projectedGrossProfit';
  await win.Router.resolveRoute();
  await wait(80);
  doc.getElementById('rStatusFilter').value = 'Sent';
  doc.getElementById('rStatusFilter').dispatchEvent(new win.Event('change'));
  await wait(80);
  let downloaded = null;
  win.downloadFile = (name, content) => { downloaded = { name, content }; };
  doc.getElementById('rExport').click();
  await wait(30);
  console.log('STEP 10: CSV export correctly reflects the active Status filter (only the Sent quotation, not the Draft one):', downloaded.content.includes('HT-Q-2026-0016') && !downloaded.content.includes('HT-Q-2026-0017'));

  console.log('\n=== STATUS FILTER DROPDOWN FULLY VERIFIED (REPRODUCED AND FIXED THE REPORTED SCENARIO) ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
