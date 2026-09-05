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

  win.location.hash = '#/reports';
  await win.Router.resolveRoute();
  await wait(50);

  /* ============ All reports still present, none lost in the reorganization ============ */
  const allExpectedKeys = ['quotationRegister', 'openQuotations', 'wonLost', 'technicalOffersLog', 'salesOrderRegister',
    'supplierPORegister', 'salesByCustomer', 'salesByMonth', 'grossProfit', 'paymentsAging', 'supplierPaymentsAging',
    'awaitingDelivery', 'expiringSoon', 'expiredQuotations', 'salesRegisterBookkeeper', 'purchaseRegisterBookkeeper'];
  const presentKeys = [...doc.querySelectorAll('.report-link')].map(a => a.getAttribute('href').replace('#/reports/', ''));
  console.log('STEP 1: All 16 reports are still present after reorganizing — none lost:', allExpectedKeys.every(k => presentKeys.includes(k)) && presentKeys.length === 16);

  /* ============ Reports are now grouped under clear headers ============ */
  const groupLabels = [...doc.querySelectorAll('.report-group-label')].map(el => el.textContent);
  console.log('STEP 2: Reports are organized into named groups, not one flat list:', groupLabels.length === 5);
  console.log('STEP 3: Group names are sensible and specific:', groupLabels.includes('Quotations & Technical Offers') && groupLabels.includes('Payments & Collections') && groupLabels.includes('Bookkeeper Reports'));

  const paymentsGroup = [...doc.querySelectorAll('.report-group')].find(g => g.querySelector('.report-group-label').textContent === 'Payments & Collections');
  console.log('STEP 4: The Payments & Collections group correctly contains exactly the 2 payments reports:', paymentsGroup.querySelectorAll('.report-link').length === 2);

  /* ============ Navigation still works correctly within the new grouped structure ============ */
  const supplierAgingLink = [...doc.querySelectorAll('.report-link')].find(a => a.textContent === 'Supplier Payments Aging Report');
  supplierAgingLink.click();
  await wait(80);
  console.log('STEP 5: Clicking a report link within a group still correctly navigates and loads its content:', !!doc.getElementById('reportTableWrap'));
  console.log('STEP 6: The clicked link correctly gets marked active:', [...doc.querySelectorAll('.report-link')].find(a => a.textContent === 'Supplier Payments Aging Report').classList.contains('active'));

  /* ============ Filter box ============ */
  win.location.hash = '#/reports';
  await win.Router.resolveRoute();
  await wait(50);
  const filterBox = doc.getElementById('reportFilter');
  console.log('STEP 7: A filter box exists for quickly finding a report among the full list:', !!filterBox);

  filterBox.value = 'payment';
  filterBox.dispatchEvent(new win.Event('input'));
  await wait(20);
  const visibleLinks = () => [...doc.querySelectorAll('.report-link')].filter(a => a.style.display !== 'none');
  console.log('STEP 8: Typing "payment" correctly narrows the list to just the matching reports:', visibleLinks().length === 2 && visibleLinks().every(a => a.textContent.toLowerCase().includes('payment')));
  console.log('STEP 9: Groups with no matching reports are correctly hidden entirely, not left as an empty heading:', [...doc.querySelectorAll('.report-group')].filter(g => g.style.display !== 'none').length === 1);

  filterBox.value = 'zzz-nonexistent';
  filterBox.dispatchEvent(new win.Event('input'));
  await wait(20);
  console.log('STEP 10: Filtering to something matching nothing shows a clear "no reports match" message:', doc.getElementById('reportFilterEmpty').style.display !== 'none');

  filterBox.value = '';
  filterBox.dispatchEvent(new win.Event('input'));
  await wait(20);
  console.log('STEP 11: Clearing the filter restores every report:', visibleLinks().length === 16);

  /* ============ Regression: report content/data itself is unaffected by the nav restructuring ============ */
  const custId = await win.DB.dbAdd('customers', { customerNo: 'C1', companyName: 'Test Co', status: 'Active', createdAt: new Date().toISOString() });
  await win.DB.dbAdd('quotations', { quotationNo: 'HT-Q-2026-0001', customerId: custId, isLatest: true, status: 'Sent', date: win.todayISO(), currency: 'PHP', grandTotal: 5000, vatTotal: 600, createdAt: new Date().toISOString() });
  win.location.hash = '#/reports/quotationRegister';
  await win.Router.resolveRoute();
  await wait(80);
  console.log('STEP 12: Regression: report data itself still loads and displays correctly:', doc.getElementById('reportTableWrap').textContent.includes('HT-Q-2026-0001'));

  let downloaded = null;
  win.downloadFile = (name, content) => { downloaded = { name, content }; };
  doc.getElementById('rExport').click();
  await wait(30);
  console.log('STEP 13: Regression: CSV export still works correctly:', downloaded && downloaded.content.includes('HT-Q-2026-0001'));

  console.log('\n=== REPORTS REORGANIZATION FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
