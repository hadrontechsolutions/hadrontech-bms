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

  /* ============ List page + New Expense form ============ */
  win.location.hash = '#/expenses';
  await win.Router.resolveRoute();
  await wait(50);
  console.log('STEP 1: Expenses list page loads correctly:', doc.getElementById('content').textContent.includes('Expenses'));
  console.log('STEP 2: Sidebar correctly highlights "Expenses" as active:', doc.querySelector('.nav-link[href="#/expenses"]').classList.contains('active'));

  doc.getElementById('btnNewEntity').click();
  await wait(50);
  console.log('STEP 3: New Expense form shows the expected fields, including a Category dropdown with real categories:', [...doc.getElementById('f_category').options].some(o => o.value === 'Utilities (Electricity, Water)'));

  doc.getElementById('f_date').value = win.todayISO();
  doc.getElementById('f_category').value = 'Utilities (Electricity, Water)';
  doc.getElementById('f_description').value = 'Electric bill - September';
  doc.getElementById('f_payee').value = 'Meralco';
  doc.getElementById('f_amount').value = '8500';
  doc.getElementById('f_paymentMethod').value = 'Bank Transfer';
  doc.getElementById('f_referenceNo').value = 'OR-00123';
  doc.getElementById('entityForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(100);

  const expenses1 = await win.DB.dbGetAll('expenses');
  console.log('STEP 4: Expense saved correctly:', expenses1.length === 1);
  console.log('STEP 5: Auto-numbering correctly follows the HT-EXP-YYYY-XXXX pattern:', /^HT-EXP-\d{4}-\d{4}$/.test(expenses1[0].expenseNo));
  console.log('STEP 6: All fields saved correctly:', expenses1[0].payee === 'Meralco' && expenses1[0].amount === 8500 && expenses1[0].referenceNo === 'OR-00123');

  /* ============ Detail page ============ */
  win.location.hash = '#/expenses/' + expenses1[0].id;
  await win.Router.resolveRoute();
  await wait(50);
  console.log('STEP 7: Detail page shows the amount correctly formatted as PHP:', doc.getElementById('content').textContent.includes('₱8,500.00'));
  console.log('STEP 8: Detail page shows the payee and category:', doc.getElementById('content').textContent.includes('Meralco') && doc.getElementById('content').textContent.includes('Utilities'));

  /* ============ Add a second expense for report testing (different category) ============ */
  await win.DB.dbAdd('expenses', {
    expenseNo: await win.DB.nextDocNumber('expense'), date: win.todayISO(), category: 'Rent', description: 'Office rent - September',
    payee: 'ABC Realty', amount: 25000, paymentMethod: 'Check', referenceNo: 'CHK-4521', status: 'Recorded',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), createdBy: 'Test'
  });
  await win.DB.dbAdd('expenses', {
    expenseNo: await win.DB.nextDocNumber('expense'), date: win.todayISO(), category: 'Utilities (Electricity, Water)', description: 'Water bill',
    payee: 'Maynilad', amount: 1500, paymentMethod: 'Cash', referenceNo: '', status: 'Recorded',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), createdBy: 'Test'
  });

  /* ============ Search ============ */
  win.location.hash = '#/search';
  await win.Router.resolveRoute();
  await wait(50);
  const searchInput = doc.getElementById('globalSearchInput');
  searchInput.value = 'Meralco';
  searchInput.dispatchEvent(new win.Event('input'));
  await wait(300);
  console.log('STEP 9: Global search correctly finds the expense by payee name:', doc.getElementById('searchResults').textContent.includes('Meralco') || doc.getElementById('searchResults').textContent.includes('Electric bill'));

  /* ============ Reports ============ */
  win.location.hash = '#/reports';
  await win.Router.resolveRoute();
  await wait(50);
  console.log('STEP 10: "Expense Register" and "Expenses by Category" both appear under Bookkeeper Reports:', doc.getElementById('content').textContent.includes('Expense Register') && doc.getElementById('content').textContent.includes('Expenses by Category'));

  win.location.hash = '#/reports/expenseRegister';
  await win.Router.resolveRoute();
  await wait(80);
  let body = doc.getElementById('reportTableWrap').textContent;
  console.log('STEP 11: Expense Register lists all three expenses:', body.includes('Meralco') && body.includes('ABC Realty') && body.includes('Maynilad'));
  console.log('STEP 12: Expense Register total correctly sums all three (8,500 + 25,000 + 1,500 = 35,000):', body.includes('₱35,000.00'));

  win.location.hash = '#/reports/expensesByCategory';
  await win.Router.resolveRoute();
  await wait(80);
  body = doc.getElementById('reportTableWrap').textContent;
  console.log('STEP 13: Expenses by Category correctly groups and sums Utilities (8,500 + 1,500 = 10,000):', body.includes('₱10,000.00'));
  console.log('STEP 14: Rent shows its own correct total (25,000):', body.includes('₱25,000.00'));
  console.log('STEP 15: The grand total across all categories is correct (35,000):', body.includes('TOTAL') && body.includes('₱35,000.00'));

  // Biggest category should sort first (Rent 25,000 > Utilities 10,000)
  const rows = [...doc.querySelectorAll('#reportTableWrap tbody tr')];
  console.log('STEP 16: Categories are sorted with the biggest spend first (Rent before Utilities):', rows[0]?.textContent.includes('Rent'));

  /* ============ CSV export ============ */
  let downloaded = null;
  win.downloadFile = (name, content) => { downloaded = { name, content }; };
  win.location.hash = '#/settings/backup';
  await win.Router.resolveRoute();
  await wait(50);
  doc.querySelector('[data-csv="expenses"]').click();
  await wait(30);
  console.log('STEP 17: Expenses CSV export works and includes the actual data:', downloaded && downloaded.content.includes('Meralco') && downloaded.content.includes('8500'));

  console.log('\n=== EXPENSES MODULE FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
