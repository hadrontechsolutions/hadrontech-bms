// Employee # / Partner #, on the form, list, distribution and payslip; loss month reserve; Packaging category
const fs = require('fs'); const path = require('path');
const { JSDOM } = require('jsdom'); require('fake-indexeddb/auto');
let fails = 0, pass = 0; const ok = (n, c, x) => { console.log(n + ':', !!c, c ? '' : (x || '')); c ? pass++ : fails++; };
(async () => {
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'), { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const win = dom.window, doc = win.document; const errs = []; let shells = [];
  win.indexedDB = global.indexedDB; win.IDBKeyRange = global.IDBKeyRange; win.confirm = () => true; win.addEventListener('error', e => errs.push(e.message));
  win.open = () => { const d = { document: { _h: '', open() {}, write(h) { shells.push(h); }, close() {} }, focus() {}, print() {} }; return d; };
  for (const s of [...doc.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => s !== 'js/app.js')) win.eval(fs.readFileSync(path.join(__dirname, s), 'utf8'));
  const wait = ms => new Promise(r => setTimeout(r, ms)); const DB = win.DB; const go = async h => { win.location.hash = h; await win.Router.resolveRoute(); await wait(300); };
  await DB.openDB(); await DB.ensureCounters();
  const create = async (name, type) => { await go('#/partners/new'); doc.getElementById('f_name').value = name; doc.getElementById('f_partnerType').value = type; doc.getElementById('f_defaultSplitPercent').value = '10'; doc.getElementById('entityForm').requestSubmit(); await wait(500); return (await DB.dbGetAll('partners')).find(p => p.name === name); };
  await go('#/partners/new');
  ok('1 new form says the number is assigned automatically', /assigned automatically/.test(doc.getElementById('content').textContent));
  const emp = await create('Willie Sicat', 'Employee'); const par = await create('Gian Sicat', 'Partner'); const emp2 = await create('Second Emp', 'Employee');
  const yr = new Date().getFullYear();
  ok('2 employee gets HT-EMP-<year>-0001', emp.partnerNo === `HT-EMP-${yr}-0001`, emp.partnerNo);
  ok('3 partner gets HT-PTR number; 2nd employee 0002', par.partnerNo.startsWith('HT-PTR-') && emp2.partnerNo === `HT-EMP-${yr}-0002`, par.partnerNo + ' ' + emp2.partnerNo);
  await go('#/partners'); ok('4 list shows the number column and values', /Employee # \/ Partner #/.test(doc.getElementById('content').textContent) && doc.getElementById('content').textContent.includes(emp.partnerNo));
  await go(`#/partners/${emp.id}/edit`); ok('5 edit form shows "Employee # …"', doc.getElementById('content').textContent.includes('Employee # ' + emp.partnerNo));
  await go(`#/partners/${par.id}/edit`); doc.getElementById('f_partnerType').value = 'Employee'; doc.getElementById('entityForm').requestSubmit(); await wait(500);
  const par2 = await DB.dbGet('partners', par.id); ok('6 changing Partner -> Employee re-issues an HT-EMP number', par2.partnerNo.startsWith('HT-EMP-') && par2.partnerNo !== par.partnerNo, par2.partnerNo);
  await go(`#/partners/${par.id}/edit`); doc.getElementById('f_name').value = 'Gian K Sicat'; doc.getElementById('entityForm').requestSubmit(); await wait(500);
  ok('7 a normal edit keeps the number', (await DB.dbGet('partners', par.id)).partnerNo === par2.partnerNo);

  // distribution + payslip
  const today = win.todayISO(), ym = today.slice(0, 7);
  const so = await DB.dbAdd('salesOrders', { soNo: 'SO1', status: 'Confirmed', date: today, currency: 'PHP', lines: [], grandTotal: 0, createdAt: new Date().toISOString() });
  await go('#/distributions/new'); doc.getElementById('f_grossProfit').value = '20000'; doc.getElementById('f_grossProfit').dispatchEvent(new win.Event('input')); doc.getElementById('f_expenses').value = '5000'; doc.getElementById('f_expenses').dispatchEvent(new win.Event('input')); await wait(100);
  doc.getElementById('distForm') ? doc.getElementById('distForm').requestSubmit() : [...doc.querySelectorAll('form')][0].requestSubmit(); await wait(700);
  const d = (await DB.dbGetAll('distributions'))[0];
  ok('8 distribution saved the numbers into each payslip line', d && d.splits.every(s => s.partnerNo), JSON.stringify(d && d.splits.map(s => s.partnerNo)));
  await win.printPayslips(d, 0);
  const slip = shells.join('');
  ok('9 payslip prints the Employee #', slip.includes('Employee #:') && slip.includes(d.splits[0].partnerNo), slip.slice(0, 80));

  // loss month
  const c = win.computeDistribution(7021.15, 10195.15, 10, [{ percent: 15 }]);
  ok('10 loss month: reserve 0, distributable 0, splits 0', c.reserveAmount === 0 && c.distributableAmount === 0 && c.splits[0].amount === 0 && c.netProfit === -3174, JSON.stringify(c));
  const p = win.computeDistribution(10000, 4000, 10, [{ percent: 50 }]);
  ok('11 profit month unchanged (net 6000, reserve 600, distributable 5400, split 2700)', p.reserveAmount === 600 && p.distributableAmount === 5400 && p.splits[0].amount === 2700);
  ok('12 Packaging & Supplies category exists', win.ExpenseCategories.includes('Packaging & Supplies'));
  ok('no script errors', errs.length === 0, errs.join('|'));
  console.log(`${pass} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
})();
