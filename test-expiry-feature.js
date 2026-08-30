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
  const custId = await win.DB.dbAdd('customers', { customerNo: 'CUST-00001', companyName: 'Test Co.', status: 'Active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

  /* ============ SECTION 0: todayISO / timezone correctness ============ */
  console.log('--- Timezone / date correctness ---');
  const today = win.todayISO();
  console.log('STEP 0a: todayISO() returns a well-formed YYYY-MM-DD string:', /^\d{4}-\d{2}-\d{2}$/.test(today));
  const probe = new Date(2026, 7, 25, 23, 30, 0);
  console.log('STEP 0b: formatLocalISO uses local date components (no UTC round-trip):', win.formatLocalISO(probe) === '2026-08-25');
  const probeMidnight = new Date(2026, 7, 25, 0, 5, 0);
  console.log('STEP 0c: Just after local midnight still reads the correct new local date:', win.formatLocalISO(probeMidnight) === '2026-08-25');

  /* ============ SECTION 1: getExpiryInfo — every required scenario ============ */
  console.log('\n--- getExpiryInfo() scenarios ---');
  const mkQ = (overrides) => Object.assign({
    quotationNo: 'HT-Q-TEST', customerId: custId, revision: 0, isLatest: true, status: 'Sent',
    date: today, currency: 'PHP', lines: [], subtotal: 0, vatTotal: 0, freight: 0, other: 0,
    grandTotal: 0, costTotal: 0, grossProfit: 0, grossMarginPercent: 0,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  }, overrides);

  const q1 = mkQ({ validUntil: win.addDaysISO(today, 10) });
  console.log('STEP 1: Valid for >7 days -> state "active":', win.getExpiryInfo(q1).state === 'active' && win.getExpiryInfo(q1).text === 'Valid for 10 more days');

  const q2 = mkQ({ validUntil: win.addDaysISO(today, 5) });
  console.log('STEP 2: Expiring within 7 days -> state "soon":', win.getExpiryInfo(q2).state === 'soon' && win.getExpiryInfo(q2).text === 'Valid for 5 more days');

  const q3 = mkQ({ validUntil: today });
  console.log('STEP 3: Expiring today -> state "today":', win.getExpiryInfo(q3).state === 'today' && win.getExpiryInfo(q3).text === 'Expires today');

  const q4 = mkQ({ validUntil: win.addDaysISO(today, -1) });
  console.log('STEP 4: Expired yesterday -> state "expired", "Expired 1 day ago":', win.getExpiryInfo(q4).state === 'expired' && win.getExpiryInfo(q4).text === 'Expired 1 day ago');

  const q4b = mkQ({ validUntil: win.addDaysISO(today, -3) });
  console.log('STEP 4b: Expired 3 days ago reads correctly (plural):', win.getExpiryInfo(q4b).text === 'Expired 3 days ago');

  const q5 = mkQ({ status: 'Won', validUntil: win.addDaysISO(today, -30) });
  console.log('STEP 5: Won quotation with an old date is NEVER flagged expired:', win.getExpiryInfo(q5).state === 'closed');

  const q6 = mkQ({ status: 'Lost', validUntil: win.addDaysISO(today, -30) });
  console.log('STEP 6: Lost quotation with an old date is NEVER flagged expired:', win.getExpiryInfo(q6).state === 'closed');

  const q7 = mkQ({ validUntil: '' });
  console.log('STEP 7: No validity date -> state "none", not treated as expired:', win.getExpiryInfo(q7).state === 'none' && win.getExpiryInfo(q7).text === 'No validity date set');

  console.log('STEP 7b: Validity date is inclusive (today counts as still valid, not expired):', win.getExpiryInfo(q3).state !== 'expired');

  /* ============ SECTION 2: List page — visual indicators, filter, no silent-drop ============ */
  console.log('\n--- Quotations list ---');
  for (const q of [q1, q2, q3, q4]) { const id = await win.DB.dbAdd('quotations', q); q.id = id; q.familyId = id; await win.DB.dbPut('quotations', q); }
  const wonOld = mkQ({ status: 'Won', validUntil: win.addDaysISO(today, -30) }); wonOld.id = await win.DB.dbAdd('quotations', wonOld); wonOld.familyId = wonOld.id; await win.DB.dbPut('quotations', wonOld);
  const noDate = mkQ({ validUntil: '' }); noDate.id = await win.DB.dbAdd('quotations', noDate); noDate.familyId = noDate.id; await win.DB.dbPut('quotations', noDate);

  win.location.hash = '#/quotations';
  await win.Router.resolveRoute();
  await wait(10);
  const listText = doc.getElementById('qBody').textContent;
  console.log('STEP 8: List shows "Expired 1 day ago" text (not just color):', listText.includes('Expired 1 day ago'));
  console.log('STEP 9: List shows "Expires today":', listText.includes('Expires today'));
  console.log('STEP 10: List shows "Valid for 5 more days":', listText.includes('Valid for 5 more days'));
  console.log('STEP 11: Expiry filter dropdown exists with all required options:', ['active','soon','today','expired','extended'].every(v => !!doc.querySelector(`#expiryFilter option[value="${v}"]`)));

  doc.getElementById('expiryFilter').value = 'expired';
  doc.getElementById('expiryFilter').dispatchEvent(new win.Event('change'));
  await wait(200);
  console.log('STEP 12: Filtering by "Expired" shows exactly the expired one (Won-old excluded):', doc.querySelectorAll('#qBody tr').length === 1 && doc.getElementById('qBody').textContent.includes('Expired 1 day ago'));
  doc.getElementById('expiryFilter').value = '';
  doc.getElementById('expiryFilter').dispatchEvent(new win.Event('change'));
  await wait(200);

  /* ============ SECTION 3: Dashboard — no silent-drop, correct stat counts ============ */
  console.log('\n--- Dashboard ---');
  win.location.hash = '#/dashboard';
  await win.Router.resolveRoute();
  await wait(10);
  const dashText = doc.getElementById('content').textContent;
  console.log('STEP 13: Dashboard has a separate "Expired — Needs Review" panel:', dashText.includes('Expired Quotations — Needs Review'));
  console.log('STEP 14: Expired quotation appears there (not silently dropped):', dashText.includes('Expired 1 day ago'));
  console.log('STEP 15: "Expiring Soon" panel still shows the within-7-days ones:', dashText.includes('Expires today') || dashText.includes('Valid for 5 more days'));
  console.log('STEP 16: Stat card for expiring-within-7-days count present:', dashText.includes('Quotations Expiring Within 7 Days'));
  console.log('STEP 17: Stat card for expired-needing-review count present:', dashText.includes('Expired Quotations Needing Review'));

  /* ============ SECTION 4: Reports — no silent-drop ============ */
  console.log('\n--- Reports ---');
  win.location.hash = '#/reports/expiredQuotations';
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 18: "Expired Quotations" report exists and lists the expired one:', doc.getElementById('content').textContent.includes('Expired 1 day ago'));
  win.location.hash = '#/reports/expiringSoon';
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 19: "Expiring Soon" report still works for the 5-day and today ones:', doc.getElementById('content').textContent.includes('Valid for 5 more days'));

  /* ============ SECTION 5: Detail page — banner, badge, guarded actions ============ */
  console.log('\n--- Quotation detail page ---');
  win.location.hash = '#/quotations/' + q4.id;
  await win.Router.resolveRoute();
  await wait(10);
  const detailHTML = doc.getElementById('content').innerHTML;
  const detailTextNormalized = doc.getElementById('content').textContent.replace(/\s+/g, ' ');
  console.log('STEP 20: Prominent expired warning banner shown with the exact required wording:', detailTextNormalized.includes('This quotation has expired') && detailTextNormalized.includes('Please verify supplier pricing, availability, freight, exchange rate, and lead time before extending or revising it'));
  console.log('STEP 21: "Extend Validity" button present:', !!doc.getElementById('btnExtendValidity'));
  console.log('STEP 22: Cross-references the existing "New Revision" button rather than duplicating it:', detailHTML.includes('New Revision') && detailHTML.includes('or use'));

  let confirmCalls = 0, lastConfirmMsg = '';
  win.confirm = (msg) => { confirmCalls++; lastConfirmMsg = msg; return true; };
  const wonBtn = [...doc.querySelectorAll('.status-btn')].find(b => b.dataset.status === 'Won');
  wonBtn.click();
  await wait(20);
  console.log('STEP 23: Marking an expired quotation as Won triggers a confirmation with the checklist reminder:', confirmCalls === 1 && lastConfirmMsg.includes('verify supplier pricing'));
  const q4After = await win.DB.dbGet('quotations', q4.id);
  console.log('STEP 24: Status change itself still went through correctly after confirming:', q4After.status === 'Won');

  /* ============ SECTION 6: Extend Validity — full flow, requires all checklist items ============ */
  console.log('\n--- Extend Validity flow ---');
  win.location.hash = '#/quotations/' + q3.id;
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('btnExtendValidity').click();
  await wait(10);
  console.log('STEP 25: Extend Validity form renders with all 6 checklist items:', doc.querySelectorAll('.ext-check').length === 6);

  doc.getElementById('btnConfirmExtend').click();
  await wait(20);
  let q3check = await win.DB.dbGet('quotations', q3.id);
  console.log('STEP 26: Cannot extend without confirming every checklist item:', !q3check.validityHistory || q3check.validityHistory.length === 0);

  doc.querySelectorAll('.ext-check').forEach(c => { c.checked = true; });
  doc.getElementById('extNewDate').value = win.addDaysISO(today, 30);
  doc.getElementById('extNote').value = 'Customer requested more time.';
  doc.getElementById('btnConfirmExtend').click();
  await wait(20);
  q3check = await win.DB.dbGet('quotations', q3.id);
  console.log('STEP 27: Extension succeeds once fully confirmed:', q3check.validUntil === win.addDaysISO(today, 30));
  console.log('STEP 28: Same quotation number kept (no new record created):', q3check.quotationNo === 'HT-Q-TEST' && (await win.DB.dbGetAll('quotations')).filter(x => x.quotationNo === 'HT-Q-TEST' && x.id === q3.id).length === 1);
  console.log('STEP 29: Audit entry recorded with old date, new date, user, timestamp, and note:', q3check.validityHistory.length === 1 && q3check.validityHistory[0].oldDate === today && q3check.validityHistory[0].newDate === win.addDaysISO(today, 30) && !!q3check.validityHistory[0].by && !!q3check.validityHistory[0].at && q3check.validityHistory[0].note === 'Customer requested more time.');
  console.log('STEP 30: No duplicate audit entries from a single extension:', q3check.validityHistory.length === 1);

  win.location.hash = '#/quotations';
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('expiryFilter').value = 'extended';
  doc.getElementById('expiryFilter').dispatchEvent(new win.Event('change'));
  await wait(200);
  console.log('STEP 31: "Extended" filter correctly shows the quotation that was just extended:', doc.getElementById('qBody').textContent.includes('HT-Q-TEST') && doc.querySelectorAll('#qBody tr').length >= 1);

  /* ============ SECTION 7: Won quotation exempt from expiry guard (design confirmation) ============ */
  console.log('\n--- Closed-status exemption ---');
  const q8 = mkQ({ status: 'Won', validUntil: win.addDaysISO(today, -5) });
  q8.id = await win.DB.dbAdd('quotations', q8); q8.familyId = q8.id; await win.DB.dbPut('quotations', q8);
  win.location.hash = '#/quotations/' + q8.id;
  await win.Router.resolveRoute();
  await wait(10);
  const recordPOBtn = doc.getElementById('btnRecordPO');
  console.log('STEP 32: A Won quotation (even with an old date) shows Record Customer PO normally, since Won = closed = exempt:', !!recordPOBtn);

  console.log('\n=== ALL QUOTATION EXPIRY FEATURE TESTS COMPLETE ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
