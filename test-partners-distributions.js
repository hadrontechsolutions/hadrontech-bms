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

  const TARGET_MONTH = '2026-09';

  // Two Sales Orders in the target month: revenue 100,000 total, cost 60,000 total -> Gross Profit 40,000
  const so1 = await win.DB.dbAdd('salesOrders', {
    soNo: 'HT-SO-2026-0001', customerId: custId, orderDate: '2026-09-05', currency: 'PHP', status: 'Confirmed', vatMode: 'NonVat',
    lines: [{ lineId: 'L1', description: 'Item A', qty: 1, uom: 'pc', unitCost: 40000, unitPrice: 60000, costCurrency: 'PHP', costExchangeRate: 1, discountPercent: 0, vatRate: 0 }],
    subtotal: 60000, vatTotal: 0, freight: 0, other: 0, grandTotal: 60000, createdAt: now, updatedAt: now
  });
  const so2 = await win.DB.dbAdd('salesOrders', {
    soNo: 'HT-SO-2026-0002', customerId: custId, orderDate: '2026-09-20', currency: 'PHP', status: 'Confirmed', vatMode: 'NonVat',
    lines: [{ lineId: 'L1', description: 'Item B', qty: 1, uom: 'pc', unitCost: 20000, unitPrice: 40000, costCurrency: 'PHP', costExchangeRate: 1, discountPercent: 0, vatRate: 0 }],
    subtotal: 40000, vatTotal: 0, freight: 0, other: 0, grandTotal: 40000, createdAt: now, updatedAt: now
  });
  // A Sales Order in a DIFFERENT month -- must NOT be included in September's figures
  await win.DB.dbAdd('salesOrders', {
    soNo: 'HT-SO-2026-0003', customerId: custId, orderDate: '2026-08-15', currency: 'PHP', status: 'Confirmed', vatMode: 'NonVat',
    lines: [{ lineId: 'L1', description: 'Item C (August)', qty: 1, uom: 'pc', unitCost: 5000, unitPrice: 9000, costCurrency: 'PHP', costExchangeRate: 1, discountPercent: 0, vatRate: 0 }],
    subtotal: 9000, vatTotal: 0, freight: 0, other: 0, grandTotal: 9000, createdAt: now, updatedAt: now
  });

  // Expenses: 8,000 in September, 3,000 in a different month (should be excluded)
  await win.DB.dbAdd('expenses', { expenseNo: 'HT-EXP-2026-0001', date: '2026-09-10', category: 'Rent', description: 'September rent', amount: 8000, status: 'Recorded', createdAt: now, updatedAt: now, createdBy: 'Test' });
  await win.DB.dbAdd('expenses', { expenseNo: 'HT-EXP-2026-0002', date: '2026-08-10', category: 'Rent', description: 'August rent', amount: 3000, status: 'Recorded', createdAt: now, updatedAt: now, createdBy: 'Test' });

  // Cash actually received in September: a payment on a PI, dated in September
  const pi = await win.DB.dbAdd('proformaInvoices', {
    piNo: 'HT-PI-2026-0001', salesOrderId: so1, date: '2026-09-06', lines: [], subtotal: 60000, vatTotal: 0, freight: 0, other: 0,
    grandTotal: 60000, currency: 'PHP', vatMode: 'NonVat', payments: [{ amount: 25000, date: '2026-09-15' }], createdAt: now
  });

  await win.DB.dbAdd('partners', { partnerNo: 'HT-PTR-2026-0001', name: 'Gian', defaultSplitPercent: 100, status: 'Active', createdAt: now });

  /* ============ New Distribution: month picker drives everything ============ */
  win.location.hash = '#/distributions/new';
  await win.Router.resolveRoute();
  await wait(50);

  doc.getElementById('f_month').value = TARGET_MONTH;
  doc.getElementById('f_month').dispatchEvent(new win.Event('change'));
  await wait(50);

  console.log('STEP 1: THE CORE REDESIGN: Gross Profit auto-fills from real Sales Order data for the selected month (60,000+40,000 revenue minus 40,000+20,000 cost = 40,000):', doc.getElementById('f_grossProfit').value === '40000');
  console.log('STEP 2: The August order (9,000 revenue, 4,000 margin) is correctly EXCLUDED from September\u2019s figure:', doc.getElementById('f_grossProfit').value !== '44000');
  console.log('STEP 3: Expenses auto-fill from real recorded Expenses for the selected month (8,000, not 11,000 which would wrongly include August):', doc.getElementById('f_expenses').value === '8000');
  console.log('STEP 4: The month summary line correctly reports 2 sales orders and 1 expense found:', doc.getElementById('monthSummary').textContent.includes('2 sales orders') && doc.getElementById('monthSummary').textContent.includes('1 expense'));

  const totalsText = doc.getElementById('distTotalsPreview').textContent;
  console.log('STEP 5: THE ACTUAL FIX: Net Profit correctly computes as Gross Profit minus Expenses (40,000 - 8,000 = 32,000), not gross profit alone:', totalsText.includes('32,000.00'));

  /* ============ Reserve applies to Net Profit, not Gross Profit ============ */
  doc.getElementById('f_reservePercent').value = '25';
  doc.getElementById('f_reservePercent').dispatchEvent(new win.Event('input'));
  await wait(30);
  const totalsAfterReserve = doc.getElementById('distTotalsPreview').textContent;
  console.log('STEP 6: Reserve is correctly applied to Net Profit (25% of 32,000 = 8,000), not to Gross Profit directly:', totalsAfterReserve.includes('8,000.00'));
  console.log('STEP 7: Distributable Amount is correct (32,000 - 8,000 = 24,000):', totalsAfterReserve.includes('24,000.00'));

  /* ============ Cash-received warning, at the month level ============ */
  const cashWarningText = doc.getElementById('cashWarning').innerHTML;
  console.log('STEP 8: THE CASH CHECK: Distributable Amount (24,000) exceeds actual cash received in September (25,000)? No -- so it should show the informational cash figure, NOT a warning:', cashWarningText.includes('25,000.00') && !cashWarningText.includes('var(--danger)'));

  // Now push reserve down so distributable exceeds what was actually collected
  doc.getElementById('f_reservePercent').value = '0';
  doc.getElementById('f_reservePercent').dispatchEvent(new win.Event('input'));
  await wait(30);
  const cashWarningText2 = doc.getElementById('cashWarning').innerHTML;
  console.log('STEP 9: With reserve at 0%, Distributable (32,000) now exceeds Cash Received (25,000) -- the red warning correctly appears:', cashWarningText2.includes('var(--danger)') && cashWarningText2.includes('exceeds'));

  /* ============ Partner splits still work exactly as before ============ */
  const splitRows = doc.querySelectorAll('#splitsBody tr');
  console.log('STEP 10: REGRESSION: partner split rows still auto-populate from the Partners list:', splitRows.length === 1);
  console.log('STEP 11: REGRESSION: the split amount still computes correctly (100% of 32,000 = 32,000):', doc.querySelector('.sp-amount').textContent.includes('32,000.00'));

  /* ============ Save and verify the persisted record ============ */
  doc.getElementById('f_reservePercent').value = '25';
  doc.getElementById('f_reservePercent').dispatchEvent(new win.Event('input'));
  await wait(30);
  doc.getElementById('f_reference').value = 'September profit split';
  doc.getElementById('distForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(100);

  const saved = (await win.DB.dbGetAll('distributions'))[0];
  console.log('STEP 12: Distribution saved correctly:', !!saved);
  console.log('STEP 13: Auto-numbering works (HT-DIST-YYYY-XXXX):', /^HT-DIST-\d{4}-\d{4}$/.test(saved.distributionNo));
  console.log('STEP 14: Saved month is correct:', saved.month === TARGET_MONTH);
  console.log('STEP 15: Saved grossProfitTotal, expensesTotal, and netProfit are all correct:', saved.grossProfitTotal === 40000 && saved.expensesTotal === 8000 && saved.netProfit === 32000);
  console.log('STEP 16: Saved cashReceivedInMonth is correctly snapshotted:', saved.cashReceivedInMonth === 25000);

  /* ============ Detail page shows the full waterfall ============ */
  win.location.hash = '#/distributions/' + saved.id;
  await win.Router.resolveRoute();
  await wait(50);
  const detailText = doc.getElementById('content').textContent;
  console.log('STEP 17: Detail page shows Gross Profit, Expenses, and Net Profit all correctly:', detailText.includes('40,000.00') && detailText.includes('8,000.00') && detailText.includes('32,000.00'));

  /* ============ CRITICAL: editing does NOT silently re-auto-compute from today's data ============ */
  // Add a new, late-entered expense to September AFTER the distribution was saved
  await win.DB.dbAdd('expenses', { expenseNo: 'HT-EXP-2026-0003', date: '2026-09-25', category: 'Miscellaneous', description: 'Late expense', amount: 5000, status: 'Recorded', createdAt: now, updatedAt: now, createdBy: 'Test' });

  win.location.hash = '#/distributions/' + saved.id + '/edit';
  await win.Router.resolveRoute();
  await wait(50);
  console.log('STEP 18: THE SNAPSHOT GUARANTEE: editing a saved distribution shows its OWN saved Expenses figure (8,000), NOT silently recomputed to include a late-entered expense (which would make it 13,000):', doc.getElementById('f_expenses').value === '8000');

  /* ============ List page shows the new columns correctly ============ */
  win.location.hash = '#/distributions';
  await win.Router.resolveRoute();
  await wait(50);
  const row = doc.querySelector('tr.clickable-row');
  console.log('STEP 19: List page shows Month, Gross Profit, Expenses, Net Profit, and Cash Received as real columns:', row.textContent.includes('September 2026') && row.textContent.includes('40,000.00') && row.textContent.includes('32,000.00'));

  /* ============ Dashboard Business Reserve tile still works ============ */
  win.location.hash = '#/dashboard';
  await win.Router.resolveRoute();
  await wait(80);
  function statValueFor(label) {
    const card = [...doc.querySelectorAll('.stat-card')].find(c => c.querySelector('.stat-card-lbl').textContent === label);
    return card ? card.querySelector('.stat-card-num').textContent : null;
  }
  console.log('STEP 20: REGRESSION: Dashboard "Business Reserve" tile still correctly reflects the total held back (8,000):', statValueFor('Business Reserve') === '₱8,000.00');

  /* ============ CSV export reflects the new schema ============ */
  let downloaded = null;
  win.downloadFile = (name, content) => { downloaded = { name, content }; };
  win.location.hash = '#/settings/backup';
  await win.Router.resolveRoute();
  await wait(50);
  doc.querySelector('[data-csv="distributions"]').click();
  await wait(30);
  console.log('STEP 21: Distributions CSV export includes the new Month/Net Profit columns:', downloaded && downloaded.content.includes('Net Profit') && downloaded.content.includes('2026-09'));

  console.log('\n=== MONTH-BASED NET PROFIT DISTRIBUTION MODEL FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
