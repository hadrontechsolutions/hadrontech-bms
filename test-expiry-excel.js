const fs = require('fs'); const path = require('path');
const { JSDOM } = require('jsdom'); require('fake-indexeddb/auto');
let fails = 0; const ok = (n, c) => { console.log(n + ':', !!c); if (!c) fails++; };
(async () => {
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'), { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const win = dom.window, doc = win.document; const errs = [];
  win.indexedDB = global.indexedDB; win.IDBKeyRange = global.IDBKeyRange; win.confirm = () => true; win.addEventListener('error', e => errs.push(e.message));
  for (const s of [...doc.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => s !== 'js/app.js')) win.eval(fs.readFileSync(path.join(__dirname, s), 'utf8'));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  await win.DB.openDB(); await win.DB.ensureCounters(); const today = win.todayISO(), now = new Date().toISOString();
  const c = await win.DB.dbAdd('customers', { companyName: 'KEYEC', status: 'Active', archived: false });
  const mk = (no, st, off, extra) => win.DB.dbAdd('quotations', Object.assign({ quotationNo: no, customerId: c, revision: 0, isLatest: true, status: st, date: win.addDaysISO(today, -40), validUntil: win.addDaysISO(today, off), currency: 'PHP', lines: [], grandTotal: 1000, createdAt: now, updatedAt: now, customerSnapshot: { companyName: 'KEYEC' } }, extra || {}));
  await mk('Q-EXP-OLD', 'Sent', -30, { rfqRef: 'QRF 566-1', endUser: 'Onsemi' });
  await mk('Q-EXP-NEW', 'Draft', -2, { rfqRef: 'QRF 566-2' });
  await mk('Q-SOON-10', 'Sent', 10, { rfqRef: 'QRF 566-3' });
  await mk('Q-TODAY', 'Draft', 0);
  await mk('Q-SOON-11', 'Sent', 11);   // not soon: 11 days left
  await mk('Q-WON', 'Won', -30);       // closed: excluded
  win.location.hash = '#/dashboard'; await win.Router.resolveRoute(); await wait(400);
  ok('1 dashboard says 10 days', doc.getElementById('content').textContent.includes('Quotations Expiring Within 10 Days') && doc.getElementById('content').textContent.includes('(next 10 days)'));
  let sheets = null; win.BookkeeperPack.xl.workbookBytes = (s) => { sheets = s; return new Uint8Array([1]); }; win.URL.createObjectURL = () => 'blob:x';
  doc.getElementById('btnExpiryXlsx').click(); await wait(200);
  ok('2 two tabs: Expired, Expiring Soon', sheets && sheets.map(s => s.name).join() === 'Expired,Expiring Soon');
  const cells = (sh) => sh.rows.slice(sh.freezeRow);
  const hdr = (sh) => sh.rows[sh.freezeRow - 1].map(x => x.v);
  ok('3 headers include RFQ Reference, End-User, Quotation Date, Valid Until, Days expired', ['RFQ Reference', 'End-User', 'Quotation Date', 'Valid Until', 'Days expired'].every(h => hdr(sheets[0]).includes(h)) && hdr(sheets[1]).includes('Days left'));
  const ex = cells(sheets[0]); const so = cells(sheets[1]);
  ok('4 expired lists the 2 expired only, most overdue first, days 30 then 2', ex.length === 2 && ex[0][0].v === 'Q-EXP-OLD' && ex[0][9].v === 30 && ex[1][9].v === 2);
  ok('5 RFQ reference and end-user are in the row', ex[0][4].v === 'QRF 566-1' && ex[0][5].v === 'Onsemi' && ex[0][3].v === 'KEYEC');
  ok('6 expiring: today (0 left) then 10 left; 11-day and Won excluded', so.length === 2 && so[0][0].v === 'Q-TODAY' && so[0][9].v === 0 && so[1][0].v === 'Q-SOON-10' && so[1][9].v === 10);
  ok('7 dates carried (quotation date, valid until)', ex[0][7].d === win.addDaysISO(today, -40) && ex[0][8].d === win.addDaysISO(today, -30));
  ok('8 no JS errors', errs.length === 0);
  console.log(fails ? fails + ' FAILED' : '=== EXPIRY EXCEL VERIFIED ==='); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
