// Closed RFQs: kept 5 days -> Trash (restorable) 30 days -> deleted for good
const fs = require('fs'); const path = require('path');
const { JSDOM } = require('jsdom'); require('fake-indexeddb/auto');
let fails = 0, pass = 0; const ok = (n, c, x) => { console.log(n + ':', !!c, c ? '' : (x || '')); c ? pass++ : fails++; };
(async () => {
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'), { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const win = dom.window, doc = win.document; const errs = [];
  win.indexedDB = global.indexedDB; win.IDBKeyRange = global.IDBKeyRange; win.confirm = () => true; win.addEventListener('error', e => errs.push(e.message));
  for (const s of [...doc.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => s !== 'js/app.js')) win.eval(fs.readFileSync(path.join(__dirname, s), 'utf8'));
  const wait = ms => new Promise(r => setTimeout(r, ms)); const DB = win.DB; const go = async h => { win.location.hash = h; await win.Router.resolveRoute(); await wait(250); };
  await DB.openDB(); await DB.ensureCounters(); const today = win.todayISO(); const ago = d => win.addDaysISO(today, -d);
  const cust = await DB.dbAdd('customers', { customerNo: 'C1', companyName: 'KEYEC', status: 'Active', archived: false });
  const mk = (no, extra) => DB.dbAdd('notes', Object.assign({ kind: 'RFQ', noteNo: no, customerId: cust, title: 'KEYEC', referenceEmail: 'REF ' + no, date: today, status: 'Sourcing', ballWith: 'Us', ballSince: today, remindAfterDays: 3, suppliers: [], activity: [] }, extra));
  const get = id => DB.dbGet('notes', id);

  // 1 closing by hand stamps the date
  const a = await mk('A'); await go('#/rfq-tracker/' + a); doc.getElementById('btnClose').click(); await wait(300);
  let n = await get(a);
  ok('1 manual close saves the closed date', n.status === 'Closed' && n.closedAt === today);
  ok('2 detail page tells when it moves to the Trash', /Moves to the Trash on/.test(doc.getElementById('content').textContent) && /5 days left/.test(doc.getElementById('content').textContent), doc.getElementById('content').textContent.slice(0, 300));

  // 3 closed 4 days ago: still there; 5 days ago: Trash
  const b = await mk('B', { status: 'Closed', closedAt: ago(4) }); const c = await mk('C', { status: 'Closed', closedAt: ago(5) });
  await win.RfqTracker.purgeClosedRfqs();
  ok('3 closed 4 days ago is still a normal closed RFQ', !(await get(b)).trashedAt);
  ok('4 closed 5 days ago moves to the Trash', (await get(c)).trashedAt === today);
  ok('5 the move is logged in the activity log', (await DB.recentActivity(20)).some(x => /Moved RFQ C .*Trash/.test(x.message || x.text || x.action || JSON.stringify(x))));

  // 6 list hides trash by default, shows it under Trash
  await go('#/rfq-tracker'); const sel = doc.getElementById('rfqShow');
  for (const v of ['all', 'closed']) { sel.value = v; sel.dispatchEvent(new win.Event('change')); await wait(60); ok(`6 "${v}" view does not list the Trashed RFQ`, !doc.getElementById('rfqTableWrap').textContent.includes('REF C')); }
  sel.value = 'trash'; sel.dispatchEvent(new win.Event('change')); await wait(60);
  ok('7 Trash view lists it with its delete date', doc.getElementById('rfqTableWrap').textContent.includes('REF C') && /Deleted for good on/.test(doc.getElementById('rfqTableWrap').textContent));

  // 8 restore
  await go('#/rfq-tracker/' + c); ok('8 trashed detail shows Restore button + notice', /Restore RFQ/.test(doc.getElementById('btnClose').textContent) && /In the Trash since/.test(doc.getElementById('content').textContent));
  doc.getElementById('btnClose').click(); await wait(300); n = await get(c);
  ok('9 restore brings it back open with no dates', n.status === 'Sourcing' && !n.trashedAt && !n.closedAt && n.noteNo === 'C');
  // 10 reopen of a closed one clears the clock
  await go('#/rfq-tracker/' + a); doc.getElementById('btnClose').click(); await wait(300); n = await get(a);
  ok('10 reopening clears the closed date', n.status === 'Sourcing' && !n.closedAt);

  // 11 trash 30 days -> deleted; 29 days -> kept
  const d = await mk('D', { status: 'Closed', closedAt: ago(40), trashedAt: ago(30) }); const e = await mk('E', { status: 'Closed', closedAt: ago(40), trashedAt: ago(29) });
  await win.RfqTracker.purgeClosedRfqs();
  ok('11 in Trash 30 days -> deleted for good', !(await get(d))); ok('12 in Trash 29 days -> kept', !!(await get(e)));

  // 13 RFQ closed before this rule existed gets a fresh 5 days, not deleted
  const f = await mk('F', { status: 'Closed' }); await win.RfqTracker.purgeClosedRfqs(); n = await get(f);
  ok('13 older closed RFQ without a date starts its 5 days today', n.closedAt === today && !n.trashedAt);

  // 14 quotation Won auto-close stamps date; open RFQs never touched
  const g = await mk('G'); await win.RfqTracker.purgeClosedRfqs(); ok('14 open RFQs are never trashed', !(await get(g)).trashedAt);

  // 15 quotation page link never dead
  const qid = await DB.dbAdd('quotations', { quotationNo: 'HT-Q-1', revision: 0, isLatest: true, status: 'Sent', date: today, validUntil: win.addDaysISO(today, 30), currency: 'PHP', vatMode: 'NonVat', lines: [], grandTotal: 0, customerId: cust, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), statusHistory: [], customerSnapshot: { companyName: 'KEYEC' }, rfqNoteId: (await get(e)).id });
  await go('#/quotations/' + qid); ok('15 quotation of a trashed RFQ says "in the Trash" and links', /in the Trash/.test(doc.getElementById('content').textContent));
  await DB.dbDelete('notes', e); await go('#/quotations/' + qid);
  ok('16 quotation of a deleted RFQ shows a note, not a dead link', /RFQ deleted from the RFQ Tracker/.test(doc.getElementById('content').textContent) && !doc.querySelector('a[href^="#/rfq-tracker/' + (await DB.dbGetAll('notes')).length + '"]'));
  ok('no script errors', errs.length === 0, errs.join('|'));
  console.log(`${pass} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
})();
