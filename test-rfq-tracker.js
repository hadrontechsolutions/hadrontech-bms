const fs = require('fs'); const path = require('path');
const { JSDOM } = require('jsdom'); require('fake-indexeddb/auto');
const APP = __dirname; let fails = 0;
const ok = (n, c) => { console.log(n + ':', !!c); if (!c) fails++; };
async function main() {
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const win = dom.window; const doc = win.document; const errs = [];
  win.indexedDB = global.indexedDB; win.IDBKeyRange = global.IDBKeyRange; win.confirm = () => true;
  win.addEventListener('error', e => errs.push(e.message));
  for (const src of [...doc.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => s !== 'js/app.js')) win.eval(fs.readFileSync(path.join(APP, src), 'utf8'));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const go = async h => { win.location.hash = h; await win.Router.resolveRoute(); await wait(200); };
  await win.DB.openDB(); await win.DB.ensureCounters();
  const today = win.todayISO();
  const cust = await win.DB.dbAdd('customers', { companyName: 'ON Semiconductor Cebu', archived: false });
  const sup1 = await win.DB.dbAdd('suppliers', { companyName: 'Roller Cart Mfg', archived: false });
  const sup2 = await win.DB.dbAdd('suppliers', { companyName: 'Second Supplier', archived: false });
  const REF = 'onsemi Cebu QRF 566-26138 Push cart with no handle #35066';

  ok('1 sidebar says RFQ Tracker', doc.querySelector('.nav-link[href="#/rfq-tracker"]')?.textContent.includes('RFQ Tracker') && !doc.querySelector('.nav-link[href="#/notes"]'));
  await go('#/rfq-tracker');
  ok('2 list opens, sidebar active', doc.querySelector('.nav-link[href="#/rfq-tracker"]').classList.contains('active') && doc.getElementById('content').textContent.includes('No RFQs yet'));
  ok('3 four ball cards Us/Supplier/Customer/End-User', [...doc.querySelectorAll('.ball-card')].map(b => b.dataset.ball).join() === 'Us,Supplier,Customer,End-User');

  doc.getElementById('btnNewRfq').click(); await wait(80);
  doc.getElementById('f_customerId').value = String(cust); doc.getElementById('f_ref').value = REF; doc.getElementById('f_endUser').value = 'Onsemi Cebu Fab 2';
  doc.getElementById('rfqForm').dispatchEvent(new win.Event('submit', { cancelable: true })); await wait(150);
  let notes = await win.DB.dbGetAll('notes'); let n = notes[0];
  ok('4 RFQ saved with kind, number, reference, end-user, status New, ball with Us', notes.length === 1 && n.kind === 'RFQ' && /^HT-RFQ-\d{4}-\d{4}$/.test(n.noteNo) && n.referenceEmail === REF && n.endUser === 'Onsemi Cebu Fab 2' && n.status === 'New' && n.ballWith === 'Us');
  ok('5 detail page shows reference as the heading', doc.querySelector('h1.rfq-ref-title')?.textContent === REF);

  ok('6 the old "Suppliers asked for a price" section is gone (no supplier dropdown, no Add supplier button)', !doc.getElementById('btnAddSupplier') && !doc.getElementById('act_sup') && !/Suppliers asked for a price/.test(doc.getElementById('content').textContent));
  // log an email to a supplier by choosing who has the ball
  doc.getElementById('act_type').value = 'Email sent'; doc.getElementById('act_type').dispatchEvent(new win.Event('change'));
  doc.getElementById('act_ball').value = 'Supplier'; doc.getElementById('act_text').value = 'Asked Roller Cart Mfg for a price - RFQ – Box with Roller Cart';
  doc.getElementById('actForm').dispatchEvent(new win.Event('submit', { cancelable: true })); await wait(150);
  n = (await win.DB.dbGetAll('notes'))[0];
  ok('7 logging an email with the ball on Supplier moves the RFQ to Sourcing and the ball to Supplier', n.status === 'Sourcing' && n.ballWith === 'Supplier' && doc.getElementById('content').textContent.includes('RFQ – Box with Roller Cart'));

  ok('8a no redundant "With (who it involves)" field', !doc.getElementById('act_party') && !doc.getElementById('content').textContent.includes('who it involves'));
  doc.getElementById('act_type').value = 'Email received'; doc.getElementById('act_type').dispatchEvent(new win.Event('change'));
  ok('8 email received defaults ball to Us', doc.getElementById('act_ball').value === 'Us');
  doc.getElementById('act_text').value = 'Supplier asks what wheel size is needed.';
  doc.getElementById('actForm').dispatchEvent(new win.Event('submit', { cancelable: true })); await wait(150);
  n = (await win.DB.dbGetAll('notes'))[0];
  ok('9 activity logged and ball is back with Us', n.activity.length >= 3 && n.activity.at(-1).text.includes('wheel size') && n.ballWith === 'Us');

  // Ball to End-User
  doc.getElementById('act_type').value = 'Email sent'; doc.getElementById('act_type').dispatchEvent(new win.Event('change'));
  doc.getElementById('act_ball').value = 'End-User';
  doc.getElementById('act_text').value = 'Asked end-user for wheel size.';
  doc.getElementById('actForm').dispatchEvent(new win.Event('submit', { cancelable: true })); await wait(150);
  n = (await win.DB.dbGetAll('notes'))[0];
  ok('10 ball with End-User after emailing them', n.ballWith === 'End-User');

  await go('#/rfq-tracker');
  const cards = Object.fromEntries([...doc.querySelectorAll('.ball-card')].map(b => [b.dataset.ball, b.querySelector('.ball-card-num').textContent]));
  ok('11 strip counts: End-User 1, others 0', cards['End-User'] === '1' && cards.Us === '0' && cards.Supplier === '0' && cards.Customer === '0');
  ok('12a list column is "RFQ / Inquiry", not bold, no "..." icon', doc.getElementById('rfqTableWrap').textContent.includes('RFQ / Inquiry') && !doc.getElementById('rfqTableWrap').textContent.includes('RFQ / Inquiry Reference') && !doc.querySelector('#rfqTableWrap td b') && !doc.querySelector('#rfqTableWrap .desc-clip, #rfqTableWrap [title="..."]'));
  ok('12 list shows the full reference prominently', doc.getElementById('rfqTableWrap').textContent.includes(REF));
  doc.querySelector('.ball-card[data-ball="Supplier"]').click(); await wait(30);
  ok('13 filtering by Supplier hides the RFQ', !doc.getElementById('rfqTableWrap').textContent.includes(REF));
  doc.querySelector('.ball-card[data-ball="Supplier"]').click(); await wait(30);

  doc.getElementById('rfqCustView').checked = true; doc.getElementById('rfqCustView').dispatchEvent(new win.Event('change')); await wait(30);
  const t = doc.getElementById('rfqTableWrap').textContent;
  ok('14 customer view shows reference + hides internal text', t.includes(REF) && !t.includes('Roller Cart Mfg') && !t.includes('wheel size') && !t.includes('Supplier'));
  let printed = ''; win.printShell = (title, body) => { printed = title + body; };
  doc.getElementById('btnPrintCust').click(); await wait(100);
  ok('15 customer print has reference, hides supplier', printed.includes(REF) && !printed.includes('Roller Cart Mfg') && !printed.includes('RFQ – Box'));
  doc.getElementById('rfqCustView').checked = false;

  // Reminder
  n = (await win.DB.dbGetAll('notes'))[0];
  const old = win.addDaysISO(today, -9); n.activity.forEach(a => a.date = old); n.date = old; n.ballSince = old; n.remindAfterDays = 3; await win.DB.dbPut('notes', n);
  ok('16 reminder counted from last activity -> overdue', win.getReminderInfo(n).state === 'overdue');
  await go('#/dashboard');
  ok('17 dashboard counts it', [...doc.querySelectorAll('.stat-card')].some(c => c.textContent.includes('RFQs Needing Follow-up') && c.querySelector('.stat-card-num').textContent === '1'));

  // Convert
  await go('#/rfq-tracker/' + n.id);
  doc.getElementById('btnConvert').click(); await wait(250);
  ok('18 convert opens quotation form pre-filled', win.location.hash === '#/quotations/new' && doc.getElementById('f_customerId').value === String(cust) && doc.getElementById('f_rfqRef').value === REF && doc.getElementById('f_endUser').value === 'Onsemi Cebu Fab 2');
  await win.RfqTracker.linkRfqToQuotation(n.id, 99, 'HT-Q-TEST');
  n = await win.DB.dbGet('notes', n.id);
  ok('19 link back stored, ball with Us', n.quotationNo === 'HT-Q-TEST' && n.ballWith === 'Us');

  // Legacy general note
  await win.DB.dbAdd('notes', { noteNo: 'HT-NOTE-2026-0001', title: 'KEYEC', referenceEmail: 'RE: QRF 566-25631', date: old, remindAfterDays: 3, body: 'x', status: 'Open' });
  await go('#/notes'); ok('20 /notes redirects to RFQ Tracker', win.location.hash === '#/rfq-tracker');
  ok('21 old general note still listed', doc.getElementById('rfqTableWrap').textContent.includes('QRF 566-25631'));
  const id2 = (await win.DB.dbGetAll('notes')).find(x => !x.kind).id;
  await go('#/notes/' + id2); ok('22 old /notes/:id link works', win.location.hash === '#/rfq-tracker/' + id2 && doc.getElementById('content').textContent.includes('KEYEC'));
  await go('#/rfq-tracker/new-note'); ok('23 new general note form opens', !!doc.getElementById('noteForm'));

  // Search + CSV
  let dl = null; win.downloadFile = (nm, c) => { dl = { nm, c }; };
  await go('#/settings/backup'); doc.querySelector('[data-csv="notes"]').click(); await wait(40);
  ok('24 CSV has reference, end-user and the Emails Sent column', dl && dl.c.includes(REF) && dl.c.includes('Onsemi Cebu Fab 2') && dl.c.includes('Emails Sent'));
  await go('#/search'); const si = doc.getElementById('globalSearchInput'); si.value = '35066'; si.dispatchEvent(new win.Event('input')); await wait(300);
  ok('25 global search finds RFQ by reference', doc.getElementById('searchResults').textContent.includes('35066'));

  // Close
  await go('#/rfq-tracker/' + n.id); doc.getElementById('btnClose').click(); await wait(120);
  n = await win.DB.dbGet('notes', n.id); ok('26 close sets status Closed', n.status === 'Closed');
  ok('27 no JS errors', errs.length === 0);
  console.log(fails ? `\n${fails} FAILED` : '\n=== RFQ TRACKER VERIFIED ==='); process.exit(fails ? 1 : 0);
}
main().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
