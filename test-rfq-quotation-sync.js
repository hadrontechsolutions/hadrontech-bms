const fs = require('fs'); const path = require('path');
const { JSDOM } = require('jsdom'); require('fake-indexeddb/auto');
let fails = 0; const ok = (n, c, x) => { console.log(n + ':', !!c, c ? '' : (x || '')); if (!c) fails++; };
(async () => {
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'), { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const win = dom.window, doc = win.document; const errs = [];
  win.indexedDB = global.indexedDB; win.IDBKeyRange = global.IDBKeyRange; win.confirm = () => true; win.addEventListener('error', e => errs.push(e.message));
  for (const s of [...doc.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => s !== 'js/app.js')) win.eval(fs.readFileSync(path.join(__dirname, s), 'utf8'));
  const wait = ms => new Promise(r => setTimeout(r, ms)); const DB = win.DB; const go = async h => { win.location.hash = h; await win.Router.resolveRoute(); await wait(300); };
  await DB.openDB(); await DB.ensureCounters(); const today = win.todayISO(), now = new Date().toISOString();
  const cust = await DB.dbAdd('customers', { customerNo: 'C1', companyName: 'KEYEC', status: 'Active', archived: false });
  const line = { lineId: 'L1', description: 'Pump', qty: 2, uom: 'pc', unitCost: 100, costCurrency: 'PHP', costExchangeRate: 1, unitPrice: 200, discountPercent: 0, vatRate: 0, freightMode: 'total' };
  const mkQ = async (no, st) => { const q = { quotationNo: no, customerId: cust, revision: 0, isLatest: true, status: st, date: today, validUntil: win.addDaysISO(today, 30), currency: 'PHP', vatMode: 'NonVat', lines: [line], grandTotal: 400, createdAt: now, updatedAt: now, statusHistory: [], customerSnapshot: { companyName: 'KEYEC' } }; const id = await DB.dbAdd('quotations', q); q.id = id; q.familyId = id; await DB.dbPut('quotations', q); return id; };
  const mkR = (no, extra) => DB.dbAdd('notes', Object.assign({ kind: 'RFQ', noteNo: no, customerId: cust, title: 'KEYEC', referenceEmail: 'REF ' + no, date: today, status: 'Sourcing', ballWith: 'Us', ballSince: today, remindAfterDays: 3, suppliers: [], activity: [] }, extra));
  const rfqOf = (id) => DB.dbGet('notes', id);

  // A: full chain through the real UI buttons
  const qA = await mkQ('HT-Q-A', 'Draft'); const rA = await mkR('HT-RFQ-A', { quotationId: qA, quotationNo: 'HT-Q-A' }); await win.RfqTracker.linkRfqToQuotation(rA, qA, 'HT-Q-A');
  await go('#/quotations/' + qA); doc.querySelector('.status-btn[data-status="Sent"]').click(); await wait(400);
  let n = await rfqOf(rA);
  ok('1 quotation marked Sent -> ball moves to Customer, with an automatic log entry', n.ballWith === 'Customer' && n.activity.some(a => /was sent to the customer/.test(a.text) && a.by === 'Automatic'), JSON.stringify(n.ballWith));
  await go('#/quotations/' + qA); doc.getElementById('btnRevise').click(); await wait(500);
  const all1 = await DB.dbGetAll('quotations'); const rev1 = all1.find(x => x.familyId === qA && x.isLatest);
  n = await rfqOf(rA);
  ok('2 revising the quotation -> RFQ now follows Rev 1 (newest), ball back with us', rev1.revision === 1 && n.quotationId === rev1.id && n.ballWith === 'Us' && n.activity.some(a => /Rev 1 is being prepared/.test(a.text)), JSON.stringify({ q: n.quotationId, rev1: rev1.id, b: n.ballWith }));
  await go('#/rfq-tracker/' + rA); const link = doc.querySelector('.page-actions a[href^="#/quotations/"]');
  ok('3 RFQ page links to the newest revision, not the old one', link && link.getAttribute('href') === '#/quotations/' + rev1.id && /Draft|Preparing/i.test(doc.getElementById('content').textContent), link && link.getAttribute('href'));
  await go('#/quotations/' + rev1.id); doc.querySelector('.status-btn[data-status="Sent"]').click(); await wait(400); n = await rfqOf(rA);
  ok('4 Rev 1 Sent -> ball with Customer again', n.ballWith === 'Customer');
  await go('#/quotations/' + rev1.id); doc.querySelector('.status-btn[data-status="Won"]').click(); await wait(400); n = await rfqOf(rA);
  ok('5 Rev 1 Won -> RFQ Closed (reason Won), reminder stops, ball cleared', n.status === 'Closed' && n.closedReason === 'Won' && win.getReminderInfo(n).state === 'done', JSON.stringify({ s: n.status, r: win.getReminderInfo(n).state }));
  await go('#/rfq-tracker'); doc.getElementById('rfqShow').value = 'closed'; doc.getElementById('rfqShow').dispatchEvent(new win.Event('change')); await wait(60);
  ok('6 Closed RFQ is listed under Closed and not in the waiting counts', doc.getElementById('rfqTableWrap').textContent.includes('HT-RFQ-A') && [...doc.querySelectorAll('.ball-card-num')].every(x => x.textContent === '0'));
  ok('7 customer wording for a won RFQ', win.RfqTracker.customerStatusText(n, rev1) === 'Closed — order placed');

  // B: Lost closes; Expired returns ball to us and stays open
  const qB = await mkQ('HT-Q-B', 'Sent'); const rB = await mkR('HT-RFQ-B', { quotationId: qB, quotationNo: 'HT-Q-B', ballWith: 'Customer' });
  const q1 = await DB.dbGet('quotations', qB); q1.status = 'Lost'; await DB.dbPut('quotations', q1); await win.RfqTracker.reconcileRfqs(); n = await rfqOf(rB);
  ok('8 quotation Lost -> RFQ Closed (Lost)', n.status === 'Closed' && n.closedReason === 'Lost');
  const qC = await mkQ('HT-Q-C', 'Expired'); const rC = await mkR('HT-RFQ-C', { quotationId: qC, quotationNo: 'HT-Q-C', ballWith: 'Customer' }); await win.RfqTracker.reconcileRfqs(); n = await rfqOf(rC);
  ok('9 quotation Expired -> RFQ stays open, ball back with us', n.status !== 'Closed' && n.ballWith === 'Us');

  // C: legacy RFQ linked before this fix to a quotation already Won (never synced) is repaired on the next visit
  const qD = await mkQ('HT-Q-D', 'Won'); const rD = await mkR('HT-RFQ-D', { quotationId: qD, quotationNo: 'HT-Q-D' });
  await go('#/dashboard'); n = await rfqOf(rD);
  ok('10 dashboard load repairs an old RFQ whose quotation is already Won', n.status === 'Closed');
  // idempotent
  const before = JSON.stringify(await DB.dbGetAll('notes')); await win.RfqTracker.reconcileRfqs(); ok('11 reconcile is idempotent (second run changes nothing)', before === JSON.stringify(await DB.dbGetAll('notes')));
  // user reopens a won-closed RFQ: it stays open (not re-closed automatically)
  await go('#/rfq-tracker/' + rD); doc.getElementById('btnClose').click(); await wait(300); await go('#/rfq-tracker/' + rD); n = await rfqOf(rD);
  ok('12 manually reopened RFQ is not auto-closed again', n.status !== 'Closed', n.status);

  // D: deleting the newest revision -> RFQ follows the surviving older revision
  const qE = await mkQ('HT-Q-E', 'Sent'); const rE = await mkR('HT-RFQ-E', { quotationId: qE, quotationNo: 'HT-Q-E' }); await win.RfqTracker.linkRfqToQuotation(rE, qE, 'HT-Q-E');
  await go('#/quotations/' + qE); doc.getElementById('btnRevise').click(); await wait(500);
  const revE = (await DB.dbGetAll('quotations')).find(x => x.familyId === qE && x.isLatest);
  await go('#/quotations/' + revE.id); doc.getElementById('btnDelete').click(); await wait(500); n = await rfqOf(rE);
  ok('13 deleting the newest revision -> RFQ points at the surviving revision', n.quotationId === qE && !!win.RfqTracker.quoteForRfq(n, await DB.dbGetAll('quotations')), JSON.stringify(n.quotationId));
  // deleting every revision: RFQ opens normally and can be converted again
  await go('#/quotations/' + qE); doc.getElementById('btnDelete').click(); await wait(500); await go('#/rfq-tracker/' + rE);
  ok('14 quotation fully deleted -> RFQ page works and offers Convert again', !!doc.getElementById('btnConvert') && !/Something went wrong/.test(doc.getElementById('content').textContent));

  // E: duplicate quotation does not inherit the RFQ link
  const qF = await mkQ('HT-Q-F', 'Sent'); const f = await DB.dbGet('quotations', qF); f.rfqNoteId = rA; await DB.dbPut('quotations', f);
  await go('#/quotations/' + qF); doc.getElementById('btnDuplicate') && doc.getElementById('btnDuplicate').click(); await wait(500);
  const nBefore = (await DB.dbGetAll('quotations')).length; await go('#/quotations/' + qF); doc.getElementById('btnDuplicate').click(); await wait(500);
  const allQ = await DB.dbGetAll('quotations'); const dupRec = allQ.find(x => x.quotationNo !== 'HT-Q-F' && x.lines && x.id > Math.max(...allQ.filter(y => y.quotationNo === 'HT-Q-F').map(y => y.id)));
  ok('15 duplicating a quotation creates a new one without the RFQ link', allQ.length === nBefore + 1 && dupRec && dupRec.rfqNoteId === undefined, JSON.stringify(dupRec && dupRec.rfqNoteId));

  // F: wording
  const OR = win.OwnerReport; ok('16 Business Performance Report no longer says 7 days', !fs.readFileSync(path.join(__dirname, 'js/ownerReport.js'), 'utf8').includes('expiring within 7 days'));
  ok('17 no JS errors', errs.length === 0, errs.join('|'));
  console.log(fails ? fails + ' FAILED' : '=== RFQ ↔ QUOTATION SYNC VERIFIED ==='); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
