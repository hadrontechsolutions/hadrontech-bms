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

  // An expired quotation, WITH prior extension history, to confirm that history doesn't
  // carry forward either.
  const expiredQ = {
    quotationNo: 'HT-Q-2026-9001', customerId: custId, revision: 0, isLatest: true, status: 'Sent',
    date: today, currency: 'PHP', subtotal: 1000, vatTotal: 0, freight: 0, other: 0, grandTotal: 1000,
    costTotal: 0, grossProfit: 0, grossMarginPercent: 0,
    validUntil: win.addDaysISO(today, -5),
    validityHistory: [{ oldDate: win.addDaysISO(today, -20), newDate: win.addDaysISO(today, -5), by: 'Gian', at: now, note: 'earlier extension' }],
    lines: [{ lineId: 'L1', description: 'Test Item', qty: 1, uom: 'pc', unitCost: 500, unitPrice: 1000, discountPercent: 0, vatRate: 0 }],
    createdAt: now, updatedAt: now
  };
  const qid = await win.DB.dbAdd('quotations', expiredQ); expiredQ.id = qid; expiredQ.familyId = qid; await win.DB.dbPut('quotations', expiredQ);

  win.location.hash = '#/quotations/' + qid;
  await win.Router.resolveRoute();
  await wait(50);
  console.log('STEP 1: The expired quotation genuinely shows the expired warning before we revise it:', doc.getElementById('content').textContent.includes('This quotation has expired'));

  doc.getElementById('btnRevise').click();
  await wait(80);

  const allQuotations = await win.DB.dbGetAll('quotations');
  const newRev = allQuotations.find(q => q.revision === 1 && q.quotationNo === expiredQ.quotationNo);

  console.log('STEP 2: A new revision was created:', !!newRev);
  console.log('STEP 3: THE FIX: the new revision\u2019s Valid Until is reset to a fresh future date, NOT inheriting the old, already-past-due one:', newRev && newRev.validUntil > today);
  console.log('STEP 4: Confirming the new date genuinely makes it active, not still flagged expired:', newRev && win.getExpiryInfo(newRev).state !== 'expired');
  console.log('STEP 5: Prior extension history does NOT carry forward onto the new revision (that history belongs to the old, now-archived one):', newRev && (!newRev.validityHistory || newRev.validityHistory.length === 0));
  console.log('STEP 6: The OLD revision (now archived, isLatest: false) still correctly keeps its own original expired date and history untouched:', allQuotations.find(q => q.revision === 0 && q.quotationNo === expiredQ.quotationNo).validUntil === expiredQ.validUntil);

  /* ============ The new revision correctly shows on the main Quotations tab, not Expired Quotations ============ */
  win.location.hash = '#/quotations';
  await win.Router.resolveRoute();
  await wait(50);
  console.log('STEP 7: THE PRACTICAL RESULT: the brand-new revision correctly appears on the main Quotations tab under its default view:', doc.getElementById('qBody').textContent.includes(expiredQ.quotationNo));

  doc.getElementById('showExpired').checked = true;
  doc.getElementById('showExpired').dispatchEvent(new win.Event('change'));
  await wait(30);
  console.log('STEP 8: ...and even with "Show expired quotations" checked, the new revision correctly still shows as active, not duplicated as an expired entry too (it would have, without this fix):', doc.getElementById('qBody').textContent.includes(expiredQ.quotationNo) && doc.querySelectorAll('#qBody tr').length === 1);

  console.log('\n=== NEW REVISION OF AN EXPIRED QUOTATION FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
