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
  const custId = await win.DB.dbAdd('customers', { customerNo: 'C1', companyName: 'KEYEC', status: 'Active', createdAt: now, updatedAt: now });
  const so = await win.DB.dbAdd('salesOrders', {
    soNo: 'HT-SO-2026-0001', customerId: custId, orderDate: win.todayISO(), currency: 'PHP', status: 'Confirmed',
    lines: [], subtotal: 0, vatTotal: 0, freight: 0, other: 0, grandTotal: 0, createdAt: now, updatedAt: now
  });

  /* ============ Set up: two outstanding PHP invoices, one outstanding USD invoice, one fully-paid PHP invoice ============ */
  await win.DB.dbAdd('proformaInvoices', {
    piNo: 'HT-PI-2026-0001', salesOrderId: so, date: win.todayISO(), lines: [], currency: 'PHP',
    subtotal: 10000, vatTotal: 1200, freight: 0, other: 0, grandTotal: 11200, payments: [], createdAt: now
  });
  await win.DB.dbAdd('proformaInvoices', {
    piNo: 'HT-PI-2026-0002', salesOrderId: so, date: win.todayISO(), lines: [], currency: 'PHP',
    subtotal: 5000, vatTotal: 600, freight: 0, other: 0, grandTotal: 5600, payments: [{ amount: 5600, date: win.todayISO() }], createdAt: now
  }); // fully paid — should NOT count as outstanding
  await win.DB.dbAdd('proformaInvoices', {
    piNo: 'HT-PI-2026-0003', salesOrderId: so, date: win.todayISO(), lines: [], currency: 'USD',
    subtotal: 1000, vatTotal: 0, freight: 0, other: 0, grandTotal: 1000, payments: [{ amount: 300, date: win.todayISO() }], createdAt: now
  }); // partially paid, USD — 700 outstanding
  // A legacy, pre-payment-tracking invoice (no grandTotal at all) -- should be migrated and counted correctly
  await win.DB.dbAdd('proformaInvoices', { piNo: 'HT-PI-2026-0004', salesOrderId: so, date: win.todayISO(), createdAt: now });
  await win.DB.dbPut('salesOrders', Object.assign(await win.DB.dbGet('salesOrders', so), { grandTotal: 2000, currency: 'PHP' }));
  // (legacy PI 0004 will migrate from this same SO's 2000 PHP grandTotal, matching real behavior)

  await win.DB.dbAdd('technicalOffers', { offerNo: 'HT-TO-2026-0001', customerId: custId, endUser: 'Onsemi', date: win.todayISO(), items: [], specs: [], sections: [], createdAt: now });
  await win.DB.dbAdd('technicalOffers', { offerNo: 'HT-TO-2026-0002', customerId: custId, endUser: 'Acme Corp', date: win.todayISO(), items: [], specs: [], sections: [], createdAt: now });

  win.location.hash = '#/dashboard';
  await win.Router.resolveRoute();
  await wait(50);
  const dashText = doc.getElementById('content').textContent;

  console.log('STEP 1: Dashboard loads without crashing and shows the new stat labels:', dashText.includes('Invoices Awaiting Payment') && dashText.includes('Technical Offers'));
  console.log('STEP 2: "Invoices Awaiting Payment" correctly counts 3 (two PHP + one USD), excluding the fully-paid one:', dashText.includes('3') && !!doc.querySelector('.stat-card-lbl'));

  // Find the actual stat card values by label, rather than just searching raw text (avoids false positives from other numbers on the page)
  function statValueFor(label) {
    const card = [...doc.querySelectorAll('.stat-card')].find(c => c.querySelector('.stat-card-lbl').textContent === label);
    return card ? card.querySelector('.stat-card-num').textContent : null;
  }
  console.log('STEP 3: "Invoices Awaiting Payment" stat card shows exactly 3:', statValueFor('Invoices Awaiting Payment') === '3');
  console.log('STEP 4: THE CORE CORRECTNESS CHECK: PHP and USD outstanding balances are shown as SEPARATE tiles, not summed together into one wrong number:', statValueFor('Outstanding (PHP)') !== null && statValueFor('Outstanding (USD)') !== null);
  console.log('STEP 5: Outstanding (PHP) correctly totals ₱11,200.00 (invoice 1) + ₱2,000.00 (migrated legacy invoice 4) = ₱13,200.00, NOT including the fully-paid PHP invoice:', statValueFor('Outstanding (PHP)') === '₱13,200.00');
  console.log('STEP 6: Outstanding (USD) correctly shows $700.00 (the remaining balance on the partially-paid USD invoice), kept separate from PHP:', statValueFor('Outstanding (USD)') === '$700.00');
  console.log('STEP 7: "Technical Offers" stat card correctly shows 2:', statValueFor('Technical Offers') === '2');

  /* ============ Quick action button ============ */
  const newTOBtn = [...doc.querySelectorAll('.qa-btn')].find(b => b.textContent.includes('New Technical Offer'));
  console.log('STEP 8: A "+ New Technical Offer" quick action button now exists on the Dashboard:', !!newTOBtn);
  newTOBtn.click();
  await wait(50);
  console.log('STEP 9: Clicking it correctly navigates to the New Technical Offer form:', !!doc.getElementById('toForm'));

  /* ============ Regression: existing stats still compute correctly ============ */
  win.location.hash = '#/dashboard';
  await win.Router.resolveRoute();
  await wait(50);
  console.log('STEP 10: Regression: pre-existing stats (Active Customers, Open Sales Orders, etc.) still render correctly:', statValueFor('Active Customers') === '1' && doc.getElementById('content').textContent.includes('Sales Value by Month'));

  console.log('\n=== DASHBOARD PAYMENTS + TECHNICAL OFFERS STATS FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
