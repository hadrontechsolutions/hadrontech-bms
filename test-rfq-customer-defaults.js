// Converting an RFQ to a quotation must carry the customer's own saved terms (not just company defaults)
const fs = require('fs'); const path = require('path');
const { JSDOM } = require('jsdom'); require('fake-indexeddb/auto');
let fails = 0, pass = 0; const ok = (n, c, x) => { console.log(n + ':', !!c, c ? '' : (x || '')); c ? pass++ : fails++; };
(async () => {
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'), { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const win = dom.window, doc = win.document;
  win.indexedDB = global.indexedDB; win.IDBKeyRange = global.IDBKeyRange; win.confirm = () => true;
  for (const s of [...doc.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => s !== 'js/app.js')) win.eval(fs.readFileSync(path.join(__dirname, s), 'utf8'));
  const wait = ms => new Promise(r => setTimeout(r, ms)); const DB = win.DB;
  const go = async h => { win.location.hash = h; await win.Router.resolveRoute(); await wait(300); };
  await DB.openDB(); await DB.ensureCounters(); const today = win.todayISO();
  const c1 = await DB.dbAdd('customers', { customerNo: 'C1', companyName: 'KEYEC', status: 'Active', archived: false, paymentTerms: '50% DP, 50% on delivery', incoterms: 'DAP Cebu', salesperson: 'Maria' });
  const c2 = await DB.dbAdd('customers', { customerNo: 'C2', companyName: 'PLAIN', status: 'Active', archived: false });
  const mk = (cid, no) => DB.dbAdd('notes', { kind: 'RFQ', noteNo: no, customerId: cid, title: 'x', referenceEmail: 'R' + no, date: today, status: 'Sourcing', ballWith: 'Us', ballSince: today, remindAfterDays: 3, suppliers: [], activity: [] });
  const convert = async (id) => { await go('#/rfq-tracker/' + id); doc.getElementById('btnConvert').click(); await wait(500); };
  const r1 = await mk(c1, 'RFQ-1'); await convert(r1);
  const v = id => doc.getElementById(id).value;
  ok('1 customer saved payment terms applied', v('f_paymentTerms') === '50% DP, 50% on delivery', v('f_paymentTerms'));
  ok('2 customer incoterms applied', v('f_incoterms') === 'DAP Cebu', v('f_incoterms'));
  ok('3 customer salesperson applied', v('f_salesperson') === 'Maria', v('f_salesperson'));
  ok('4 customer still selected', Number(v('f_customerId')) === c1);
  const s = await DB.getSettings();
  const r2 = await mk(c2, 'RFQ-2'); await convert(r2);
  ok('5 customer without saved terms falls back to Settings defaults', v('f_paymentTerms') === (s.defaultPaymentTerms || '') && v('f_incoterms') === (s.defaultIncoterms || ''), v('f_paymentTerms'));
  console.log(`${pass} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
})();
