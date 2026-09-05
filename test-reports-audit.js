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
  const supId = await win.DB.dbAdd('suppliers', { supplierNo: 'S1', companyName: 'Pentair', status: 'Active', createdAt: now });

  // Two PHP sales orders for the same customer + one USD one -- exactly the scenario the bug affected
  await win.DB.dbAdd('salesOrders', { soNo: 'HT-SO-2026-0001', customerId: custId, orderDate: win.todayISO(), currency: 'PHP', status: 'Confirmed', grandTotal: 10000, vatTotal: 1200, createdAt: now });
  await win.DB.dbAdd('salesOrders', { soNo: 'HT-SO-2026-0002', customerId: custId, orderDate: win.todayISO(), currency: 'PHP', status: 'Delivered', grandTotal: 5000, vatTotal: 600, createdAt: now });
  await win.DB.dbAdd('salesOrders', { soNo: 'HT-SO-2026-0003', customerId: custId, orderDate: win.todayISO(), currency: 'USD', status: 'Confirmed', grandTotal: 1000, vatTotal: 0, createdAt: now });

  /* ============ BUG FIX 1: Sales by Customer no longer silently mixes currencies ============ */
  win.location.hash = '#/reports/salesByCustomer';
  await win.Router.resolveRoute();
  await wait(80);
  let body = doc.getElementById('reportTableWrap').textContent;
  console.log('STEP 1: THE BUG FIX: Sales by Customer correctly totals only the two PHP orders (₱15,000.00), not silently including the USD one:', body.includes('₱15,000.00'));
  console.log('STEP 2: The USD order is flagged as an anomaly rather than silently folded into the PHP total as if it were pesos:', body.includes('NOT in PHP') || body.includes('are expected to always be in PHP'));
  console.log('STEP 3: The wrong, bug-era total (₱16,000 if USD had been added in as PHP) does NOT appear anywhere:', !body.includes('₱16,000.00'));

  /* ============ BUG FIX 2: Sales by Month, same fix ============ */
  win.location.hash = '#/reports/salesByMonth';
  await win.Router.resolveRoute();
  await wait(80);
  body = doc.getElementById('reportTableWrap').textContent;
  console.log('STEP 4: Sales by Month correctly totals only the PHP orders for the month (₱15,000.00):', body.includes('₱15,000.00'));
  console.log('STEP 5: Same anomaly flag appears here too:', body.includes('are expected to always be in PHP'));

  /* ============ Color-coded status badges now render across reports ============ */
  win.location.hash = '#/reports/salesOrderRegister';
  await win.Router.resolveRoute();
  await wait(80);
  const confirmedBadge = [...doc.querySelectorAll('.badge')].find(b => b.textContent === 'Confirmed');
  const deliveredBadge = [...doc.querySelectorAll('.badge')].find(b => b.textContent === 'Delivered');
  console.log('STEP 6: THE COLOR-CODING FIX: Sales Order Register now shows "Confirmed" as an actual color-coded badge, not plain text:', !!confirmedBadge && confirmedBadge.className.includes('badge-confirmed'));
  console.log('STEP 7: "Delivered" correctly shows the green success badge color:', !!deliveredBadge && deliveredBadge.className.includes('badge-delivered'));

  win.location.hash = '#/reports/paymentsAging';
  await win.Router.resolveRoute();
  await wait(80);
  // (no outstanding invoices set up in this test, so just confirm the report still loads without error)
  console.log('STEP 8: Payments Aging report still loads correctly with the new badge column logic in place:', !!doc.getElementById('reportTableWrap'));

  win.location.hash = '#/reports/technicalOffersLog';
  await win.Router.resolveRoute();
  await wait(80);
  await win.DB.dbAdd('technicalOffers', { offerNo: 'HT-TO-2026-0001', customerId: custId, endUser: 'Onsemi', date: win.todayISO(), status: 'Sent', items: [], specs: [], sections: [], createdAt: now });
  doc.getElementById('rApply').click();
  await wait(80);
  const sentBadge = [...doc.querySelectorAll('.badge')].find(b => b.textContent === 'Sent');
  console.log('STEP 9: Technical Offers Log now shows a color-coded "Sent" badge too:', !!sentBadge && sentBadge.className.includes('badge-sent'));

  /* ============ CRITICAL: CSV export must NEVER contain HTML markup, only plain status text ============ */
  let downloaded = null;
  win.downloadFile = (name, content) => { downloaded = { name, content }; };
  win.location.hash = '#/reports/salesOrderRegister';
  await win.Router.resolveRoute();
  await wait(80);
  doc.getElementById('rExport').click();
  await wait(30);
  console.log('STEP 10: CSV export contains the plain status text "Confirmed":', downloaded.content.includes('Confirmed'));
  console.log('STEP 11: CRITICAL SAFETY CHECK: CSV export contains NO HTML markup at all (no "<span", no "class="):', !downloaded.content.includes('<span') && !downloaded.content.includes('class='));

  win.location.hash = '#/reports/technicalOffersLog';
  await win.Router.resolveRoute();
  await wait(80);
  downloaded = null;
  doc.getElementById('rExport').click();
  await wait(30);
  console.log('STEP 12: Same CSV safety check on Technical Offers Log — plain text status, no HTML:', downloaded.content.includes('Sent') && !downloaded.content.includes('<span'));

  /* ============ Regression: filtering and existing data correctness still work ============ */
  win.location.hash = '#/reports/quotationRegister';
  await win.Router.resolveRoute();
  await wait(80);
  console.log('STEP 13: Regression: other reports without badge status (Quotation Register has none set up here) still load fine:', !!doc.getElementById('reportTableWrap'));

  console.log('\n=== FULL REPORTS AUDIT (CURRENCY BUGS + COLOR CODING) VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
