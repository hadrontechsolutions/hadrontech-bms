// Printed quotation shows "Validity Period: N Days" under Valid Until
const fs = require('fs'); const path = require('path');
const { JSDOM } = require('jsdom'); require('fake-indexeddb/auto');
let fails = 0, pass = 0; const ok = (n, c, x) => { console.log(n + ':', !!c, c ? '' : (x || '')); c ? pass++ : fails++; };
(async () => {
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'), { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const win = dom.window, doc = win.document; let printed = '';
  win.indexedDB = global.indexedDB; win.IDBKeyRange = global.IDBKeyRange;
  win.open = () => ({ document: { open() {}, write(h) { printed = h; }, close() {} }, focus() {}, print() {} });
  for (const s of [...doc.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => s !== 'js/app.js')) win.eval(fs.readFileSync(path.join(__dirname, s), 'utf8'));
  await win.DB.openDB(); await win.DB.ensureCounters();
  const mk = (date, validUntil) => ({ quotationNo: 'HT-Q-1', revision: 0, date, validUntil, currency: 'PHP', vatMode: 'NonVat', status: 'Draft', lines: [], customerSnapshot: { companyName: 'KEYEC' } });
  const run = async (q) => { printed = ''; await win.Print.printQuotation(q, null); return printed.replace(/<style[\s\S]*?<\/style>/, ''); };
  let h = await run(mk('2026-10-01', '2026-10-16'));
  ok('1 15 days shows "Validity Period: 15 Days"', /Validity Period: <b>15 Days<\/b>/.test(h), h.match(/Valid Until[^<]*<br>[^<]*/));
  ok('2 it sits directly below Valid Until', /Valid Until: [^<]*<br>Validity Period/.test(h));
  h = await run(mk('2026-10-01', '2026-10-02')); ok('3 one day reads "1 Day"', /<b>1 Day<\/b>/.test(h));
  h = await run(mk('2026-10-01', '2026-10-31')); ok('4 30 days', /<b>30 Days<\/b>/.test(h));
  h = await run(mk('2026-12-20', '2027-01-19')); ok('5 counts across a year end (30 Days)', /<b>30 Days<\/b>/.test(h));
  h = await run(mk('2026-10-01', '2026-10-01')); ok('6 same date reads "Same day only"', /Same day only/.test(h));
  h = await run(mk('2026-10-10', '2026-10-01')); ok('7 Valid Until before the date: line is left out (no negative days)', !/Validity Period/.test(h));
  h = await run(mk('2026-10-01', '')); ok('8 no Valid Until: line left out', !/Validity Period/.test(h));
  h = await run(mk('2026-10-01T08:30:00.000Z', '2026-10-16')); ok('9 a date with a time part still counts 15 Days', /<b>15 Days<\/b>/.test(h));
  console.log(`${pass} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
})();
