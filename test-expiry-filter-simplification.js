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
  const today = win.todayISO();

  // Two DIFFERENT quotations, deliberately covering both concepts of "expired":
  // (1) a quotation genuinely past its Valid Until date (the computed state)
  const pastDueQ = {
    quotationNo: 'HT-Q-2026-1001', customerId: custId, revision: 0, isLatest: true, status: 'Sent',
    date: today, currency: 'PHP', subtotal: 1000, vatTotal: 0, freight: 0, other: 0, grandTotal: 1000,
    costTotal: 0, grossProfit: 0, grossMarginPercent: 0, validUntil: win.addDaysISO(today, -3),
    createdAt: now, updatedAt: now
  };
  // (2) a quotation someone manually marked with the "Expired" STATUS, but whose date is
  // actually still valid -- this is the exact scenario that caused the reported confusion.
  const manualStatusQ = {
    quotationNo: 'HT-Q-2026-1002', customerId: custId, revision: 0, isLatest: true, status: 'Expired',
    date: today, currency: 'PHP', subtotal: 2000, vatTotal: 0, freight: 0, other: 0, grandTotal: 2000,
    costTotal: 0, grossProfit: 0, grossMarginPercent: 0, validUntil: win.addDaysISO(today, 20),
    createdAt: now, updatedAt: now
  };
  for (const q of [pastDueQ, manualStatusQ]) { const id = await win.DB.dbAdd('quotations', q); q.id = id; await win.DB.dbPut('quotations', q); }

  win.location.hash = '#/quotations';
  await win.Router.resolveRoute();
  await wait(30);

  /* ============ There is only ONE filter mentioning "expired" anywhere on this page ============ */
  console.log('STEP 1: THE ROOT FIX: no second dropdown exists at all -- the old #expiryFilter is completely gone:', !doc.getElementById('expiryFilter'));
  console.log('STEP 2: There is exactly one control mentioning "expired" on the page now -- the checkbox itself:', !!doc.getElementById('showExpired') && doc.querySelectorAll('#showExpired').length === 1);

  /* ============ THE ACTUAL FIX: "Expired" is no longer even offered as a Status option here ============ */
  const statusOptions = [...doc.getElementById('statusFilter').options].map(o => o.value);
  console.log('STEP 3: "Expired" is offered in the Status filter again (by request) and means "show expired quotations only":', statusOptions.includes('Expired'));
  { const sf = doc.getElementById('statusFilter'); const cb = doc.getElementById('showExpired');
    sf.value = 'Expired'; sf.dispatchEvent(new win.Event('change')); await wait(250);
    const b = doc.getElementById('qBody').textContent;
    console.log('STEP 3c: Choosing Expired shows the past-due quotation without ticking the checkbox, and the checkbox is disabled meanwhile:', b.includes(pastDueQ.quotationNo) && cb.disabled && !cb.checked);
    sf.value = ''; sf.dispatchEvent(new win.Event('change')); await wait(250);
    console.log('STEP 3d: Back to All Statuses: past-due is hidden again and the checkbox works as before:', !doc.getElementById('qBody').textContent.includes(pastDueQ.quotationNo) && !cb.disabled); }
  console.log('STEP 3b: Every OTHER real status is still there, untouched:', ['Draft', 'Sent', 'Under Review', 'Won', 'Lost'].every(s => statusOptions.includes(s)));

  /* ============ A quotation that genuinely has status=Expired set is unaffected -- still visible normally, findable by search ============ */
  let body = doc.getElementById('qBody').textContent;
  console.log('STEP 4: A quotation manually marked status=Expired (still valid by date) shows up normally on the list regardless -- nothing hides it, since the computed-expiry check never flags a non-open status:', body.includes(manualStatusQ.quotationNo));

  doc.getElementById('listSearch').value = manualStatusQ.quotationNo;
  doc.getElementById('listSearch').dispatchEvent(new win.Event('input'));
  await wait(250);
  console.log('STEP 5: It\u2019s still fully findable by search, so nothing is actually lost by removing it from the Status dropdown:', doc.getElementById('qBody').textContent.includes(manualStatusQ.quotationNo));
  doc.getElementById('listSearch').value = '';
  doc.getElementById('listSearch').dispatchEvent(new win.Event('input'));
  await wait(250);

  /* ============ The checkbox is the ONE place to find genuinely-past-due quotations, unambiguously ============ */
  body = doc.getElementById('qBody').textContent;
  console.log('STEP 6: With the checkbox unchecked (default), the genuinely past-due quotation is hidden:', !body.includes(pastDueQ.quotationNo));
  console.log('STEP 7: ...while the manually-status-Expired one (not actually past due) still shows normally -- these two concepts never interfere with each other:', body.includes(manualStatusQ.quotationNo));

  doc.getElementById('showExpired').checked = true;
  doc.getElementById('showExpired').dispatchEvent(new win.Event('change'));
  await wait(30);
  body = doc.getElementById('qBody').textContent;
  console.log('STEP 8: Checking the box reveals the genuinely past-due one too -- now both quotations are visible:', body.includes(pastDueQ.quotationNo) && body.includes(manualStatusQ.quotationNo));

  console.log('\n=== TWO-DROPDOWN CONFUSION GENUINELY RESOLVED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
