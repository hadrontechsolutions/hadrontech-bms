// Expenses: newest date first, Payee = our business, vendor field, double-entry warning
const fs = require('fs'); const path = require('path');
const { JSDOM } = require('jsdom'); require('fake-indexeddb/auto');
let fails = 0, pass = 0; const ok = (n, c, x) => { console.log(n + ':', !!c, c ? '' : (x || '')); c ? pass++ : fails++; };
(async () => {
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'), { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const win = dom.window, doc = win.document; const errs = []; let confirms = 0, answer = false;
  win.indexedDB = global.indexedDB; win.IDBKeyRange = global.IDBKeyRange; win.confirm = () => { confirms++; return answer; }; win.addEventListener('error', e => errs.push(e.message));
  for (const s of [...doc.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => s !== 'js/app.js')) win.eval(fs.readFileSync(path.join(__dirname, s), 'utf8'));
  const wait = ms => new Promise(r => setTimeout(r, ms)); const DB = win.DB; const go = async h => { win.location.hash = h; await win.Router.resolveRoute(); await wait(300); };
  await DB.openDB(); await DB.ensureCounters(); const co = (await DB.getSettings()).companyName;
  const mk = (no, date, desc, amt, payee, created) => DB.dbAdd('expenses', { expenseNo: no, date, category: 'Rent', description: desc, payee, amount: amt, status: 'Recorded', createdAt: created });
  await mk('E1', '2026-10-12', 'Tape', 152, 'Hadrontech Solutions', '2026-10-12T01:00:00Z');
  await mk('E2', '2026-10-08', 'AI Assistant', 1457.15, 'Hadrontech Industrial Solutions', '2026-10-12T02:00:00Z');
  await mk('E3', '2026-08-24', 'AI Assistant', 1457.15, 'Hadrontech Solutions', '2026-10-12T03:00:00Z');
  await mk('E4', '2026-10-01', 'Rent', 7500, '', '2026-10-12T04:00:00Z');
  await mk('E5', '2026-10-01', 'Landlord', 100, 'Some Store', '2026-10-12T05:00:00Z');
  await go('#/expenses');
  const rows = [...doc.querySelectorAll('#content tbody tr')].map(r => r.textContent.replace(/\s+/g, ' '));
  const order = ['Tape', 'AI Assistant', 'Landlord', 'Rent'].map(k => rows.findIndex(r => r.includes(k)));
  ok('1 list is newest expense date first', order[0] < order[1] && rows[1].includes('Oct 8') && rows[rows.length - 1].includes('Aug 24'), JSON.stringify(rows.map(r => r.slice(0, 30))));
  const all = await DB.dbGetAll('expenses');
  ok('2 all Hadrontech variants and blanks became our exact name', all.filter(x => /^E[1-4]$/.test(x.expenseNo)).every(x => x.payee === co), JSON.stringify(all.map(x => x.payee)));
  ok('3 a real other payee is left alone', all.find(x => x.expenseNo === 'E5').payee === 'Some Store');
  ok('4 list shows the new "Paid to / Bought from" column', /Paid to \/ Bought from/.test(doc.querySelector('#content thead').textContent));

  await go('#/expenses/new'); const f = id => doc.getElementById('f_' + id);
  ok('5 new expense has Payee pre-filled with our name', f('payee').value === co, f('payee').value);
  ok('6 vendor field exists', !!f('vendor'));
  const fill = (d, desc, amt) => { f('date').value = d; f('category').value = 'Rent'; f('description').value = desc; f('amount').value = amt; };
  fill('2026-10-10', 'AI Assistant', '1457.15'); confirms = 0; answer = false; doc.getElementById('entityForm').requestSubmit(); await wait(400);
  ok('7 same description+amount within 7 days (Oct 8 vs Oct 10) asks first; "No" does not save', confirms === 1 && (await DB.dbGetAll('expenses')).length === 5, 'confirms=' + confirms);
  answer = true; doc.getElementById('entityForm').requestSubmit(); await wait(400);
  ok('8 answering Yes saves it', (await DB.dbGetAll('expenses')).length === 6);
  await go('#/expenses/new'); fill('2026-09-20', 'AI Assistant', '1457.15'); confirms = 0; doc.getElementById('entityForm').requestSubmit(); await wait(400);
  ok('10 a month apart is not flagged and saves', confirms === 0 && (await DB.dbGetAll('expenses')).length >= 7, 'confirms=' + confirms);
  ok('no script errors', errs.length === 0, errs.join('|'));
  console.log(`${pass} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
})();
