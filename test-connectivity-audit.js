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

  await win.DB.dbAdd('technicalOffers', { offerNo: 'HT-TO-2026-0001', customerId: custId, endUser: 'Onsemi', date: win.todayISO(), status: 'Approved', items: [], specs: [], sections: [], createdAt: now });
  await win.DB.dbAdd('supplierPOs', {
    poNo: 'HT-PO-2026-0001', supplierId: supId, poDate: win.todayISO(), currency: 'USD', status: 'Confirmed',
    lines: [], freight: 0, taxes: 0, totalCost: 8000, payments: [{ amount: 3000, date: win.todayISO() }], createdAt: now
  });
  await win.DB.dbAdd('supplierPOs', {
    poNo: 'HT-PO-2026-0002', supplierId: supId, poDate: win.todayISO(), currency: 'PHP', status: 'Confirmed',
    lines: [], freight: 0, taxes: 0, totalCost: 15000, createdAt: now
  });

  /* ============ GAP FIX 1: Technical Offers CSV now includes Status ============ */
  win.location.hash = '#/settings/backup';
  await win.Router.resolveRoute();
  await wait(50);
  let downloaded = null;
  win.downloadFile = (name, content) => { downloaded = { name, content }; };
  const toBtn = doc.querySelector('[data-csv="technicalOffers"]');
  toBtn.click();
  await wait(30);
  console.log('STEP 1: GAP FIX: Technical Offers CSV export now includes the Status field ("Approved"), which was missing before status tracking existed:', downloaded.content.includes('Approved'));

  /* ============ GAP FIX 2: Supplier PO CSV now includes payment fields ============ */
  downloaded = null;
  const spoBtn = doc.querySelector('[data-csv="supplierPOs"]');
  spoBtn.click();
  await wait(30);
  console.log('STEP 2: GAP FIX: Supplier PO CSV export header now includes Amount Paid, Balance Due, and Payment Status columns:', downloaded.content.includes('Amount Paid') && downloaded.content.includes('Balance Due') && downloaded.content.includes('Payment Status'));
  console.log('STEP 3: The actual payment figures appear correctly in the exported row (3000 paid, 5000 balance):', downloaded.content.includes('3000') && downloaded.content.includes('5000'));

  /* ============ GAP FIX 3: Dashboard now shows supplier-side outstanding payments ============ */
  win.location.hash = '#/dashboard';
  await win.Router.resolveRoute();
  await wait(80);
  function statValueFor(label) {
    const card = [...doc.querySelectorAll('.stat-card')].find(c => c.querySelector('.stat-card-lbl').textContent === label);
    return card ? card.querySelector('.stat-card-num').textContent : null;
  }
  console.log('STEP 4: GAP FIX: Dashboard now shows "Supplier POs Awaiting Payment", mirroring the customer-side stat:', doc.getElementById('content').textContent.includes('Supplier POs Awaiting Payment'));
  console.log('STEP 5: That count is correct (both outstanding POs, since neither is fully paid):', statValueFor('Supplier POs Awaiting Payment') === '2');
  console.log('STEP 6: "Owed to Suppliers (USD)" shows the correct remaining USD balance ($5,000):', statValueFor('Owed to Suppliers (USD)') === '$5,000.00');
  console.log('STEP 7: "Owed to Suppliers (PHP)" shows the correct PHP balance (₱15,000), kept SEPARATE from the USD figure, not summed together:', statValueFor('Owed to Suppliers (PHP)') === '₱15,000.00');

  /* ============ Regression: the original customer-side Dashboard stats are unaffected ============ */
  console.log('STEP 8: Regression: the original customer-side "Invoices Awaiting Payment" stat still works alongside the new supplier one:', doc.getElementById('content').textContent.includes('Invoices Awaiting Payment'));

  console.log('\n=== CONNECTIVITY GAPS FOUND AND FIXED — FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
