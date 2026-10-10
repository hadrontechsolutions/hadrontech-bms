const fs = require('fs'); const path = require('path');
const { JSDOM } = require('jsdom'); require('fake-indexeddb/auto');
const APP = __dirname;
async function main() {
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const win = dom.window; const doc = win.document;
  win.indexedDB = global.indexedDB; win.IDBKeyRange = global.IDBKeyRange; win.confirm = () => true;
  for (const src of [...doc.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => s !== 'js/app.js')) win.eval(fs.readFileSync(path.join(APP, src), 'utf8'));
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const fire = (el, v, ev = 'input') => { if (v !== undefined) el.value = v; el.dispatchEvent(new win.Event(ev)); };
  const go = async (h, ms = 120) => { win.location.hash = h; await win.Router.resolveRoute(); await wait(ms); };
  const ok = (n, c, e) => console.log(n + ':', !!c, c ? '' : (e === undefined ? '' : e));
  const toasts = []; const ot = win.toast; win.toast = (m, t) => { toasts.push((t || 'ok') + ': ' + m); return ot && ot(m, t); };
  await win.DB.openDB(); await win.DB.ensureCounters();
  const now = new Date().toISOString();
  for (const [n, r, pct] of [['Gian', 'Owner', 40], ['Wife', 'Operations', 30], ['Father', 'Adviser', 30]]) await win.DB.dbAdd('partners', { partnerNo: 'P-' + n, name: n, role: r, defaultSplitPercent: pct, status: 'Active', createdAt: now });
  await go('#/distributions/new');
  fire(doc.getElementById('f_grossProfit'), '100000'); fire(doc.getElementById('f_expenses'), '20000'); fire(doc.getElementById('f_reservePercent'), '10');
  doc.getElementById('distForm').dispatchEvent(new win.Event('submit', { cancelable: true })); await wait(250);
  let dist = (await win.DB.dbGetAll('distributions'))[0];
  ok('1 distribution saved: distributable 72,000 and shares 28,800 / 21,600 / 21,600', dist && dist.distributableAmount === 72000 && dist.splits.map(s => s.amount).join() === '28800,21600,21600', dist && JSON.stringify(dist.splits.map(s => s.amount)));
  ok('2 each split keeps the partner role and a stable payslip sequence 1-3', dist.splits.map(s => s.partnerRole).join() === 'Owner,Operations,Adviser' && dist.splits.map(s => s.slipSeq).join() === '1,2,3');
  await go('#/distributions/' + dist.id, 150);
  const body = doc.getElementById('content').textContent;
  ok('3 detail page shows Print All Payslips, three Print Payslip buttons and Unpaid status', !!doc.getElementById('btnPrintAllSlips') && doc.querySelectorAll('[data-slip-print]').length === 3 && (body.match(/Unpaid/g) || []).length === 3);
  // payslip details for partner 2
  doc.querySelectorAll('[data-slip-edit]')[1].click(); await wait(60);
  doc.getElementById('btnAddAdj').click(); await wait(30);
  let tr = doc.querySelector('tr[data-ai="0"]'); fire(tr.querySelector('.adj-label'), 'Cash advance, Sept 12'); fire(tr.querySelector('.adj-amount'), '5000');
  doc.getElementById('btnAddAdj').click(); await wait(30);
  tr = doc.querySelector('tr[data-ai="1"]'); fire(tr.querySelector('.adj-label'), 'Bonus'); fire(tr.querySelector('.adj-kind'), 'add', 'change'); fire(tr.querySelector('.adj-amount'), '1000');
  ok('4 live Net Pay = 21,600 − 5,000 + 1,000 = 17,600', /17,600\.00/.test(doc.getElementById('slipNet').textContent), doc.getElementById('slipNet').textContent);
  fire(doc.getElementById('slip_paidDate'), '2026-10-10'); fire(doc.getElementById('slip_method'), 'Bank Transfer', 'change'); fire(doc.getElementById('slip_ref'), 'BDO-123');
  doc.getElementById('btnSaveSlip').click(); await wait(250);
  dist = await win.DB.dbGet('distributions', dist.id);
  ok('5 saved: adjustments, net pay 17,600, paid date, method and reference', dist.splits[1].netPay === 17600 && dist.splits[1].adjustments.length === 2 && dist.splits[1].paidDate === '2026-10-10' && dist.splits[1].paidMethod === 'Bank Transfer' && dist.splits[1].paidReference === 'BDO-123', JSON.stringify(dist.splits[1]));
  ok('6 detail shows Paid for partner 2 and Unpaid for the others; Net Pay column updated', /Paid/.test(doc.getElementById('content').textContent) && (doc.getElementById('content').textContent.match(/Unpaid/g) || []).length === 2 && /17,600\.00/.test(doc.getElementById('content').textContent));
  // negative net rejected
  doc.querySelectorAll('[data-slip-edit]')[2].click(); await wait(60);
  doc.getElementById('btnAddAdj').click(); await wait(30);
  tr = doc.querySelector('tr[data-ai="0"]'); fire(tr.querySelector('.adj-label'), 'Too big'); fire(tr.querySelector('.adj-amount'), '30000');
  doc.getElementById('btnSaveSlip').click(); await wait(150);
  ok('7 deductions bigger than the share are refused', toasts.slice(-1)[0].startsWith('err') && (await win.DB.dbGet('distributions', dist.id)).splits[2].adjustments.length === 0, toasts.slice(-1)[0]);
  // printing
  let printed = ''; win.open = () => ({ document: { write: (h) => { printed = h; }, close: () => {} } });
  doc.querySelectorAll('[data-slip-print]')[1].click(); await wait(200);
  ok('8 payslip for partner 2: number, period, name/role, business totals, deduction, bonus, Net Pay', new RegExp(dist.distributionNo + '-02').test(printed) && /Payslip/i.test(printed) && /Wife/.test(printed) && /Operations/.test(printed) && /Cash advance, Sept 12/.test(printed) && /Bonus/.test(printed) && /₱17,600\.00/.test(printed) && /₱72,000\.00/.test(printed) && /Paid on/.test(printed) && /BDO-123/.test(printed), printed.slice(0, 60));
  ok('9 it shows ONLY her own amount: no other partner names or shares (28,800 / Gian / Father)', !/Gian|Father|28,800/.test(printed.replace(/Hadrontech[^<]*/g, '')), (printed.match(/Gian|Father|28,800/g) || []).join());
  ok('9b unpaid wording and signature lines present', /Received by/.test(printed) && !/NaN|undefined/.test(printed));
  doc.getElementById('btnPrintAllSlips').click(); await wait(200); if (process.env.DUMP) fs.writeFileSync(process.env.DUMP, printed);
  ok('10 Print All gives three payslips, one page each', (printed.match(/class="p-doc-title">Payslip/g) || []).length === 3 && (printed.match(/page-break-after:always/g) || []).length === 2 && /Not yet paid/.test(printed), (printed.match(/class="p-doc-title">Payslip/g) || []).length);
  // edit the distribution: payslip data survives; removing a row keeps the others' numbers
  await go('#/distributions/' + dist.id + '/edit', 150);
  doc.querySelectorAll('[data-del]')[0].click(); await wait(30);
  doc.getElementById('distForm').dispatchEvent(new win.Event('submit', { cancelable: true })); await wait(250);
  dist = await win.DB.dbGet('distributions', dist.id);
  ok('11 after editing and removing partner 1: payslip data kept and numbers stay -02 / -03', dist.splits.length === 2 && dist.splits[0].slipSeq === 2 && dist.splits[0].netPay !== undefined && dist.splits[0].adjustments.length === 2 && dist.splits[0].paidDate === '2026-10-10' && dist.splits[1].slipSeq === 3, JSON.stringify(dist.splits.map(s => [s.partnerName, s.slipSeq, s.paidDate])));
  await go('#/distributions/' + dist.id, 150); doc.querySelectorAll('[data-slip-print]')[0].click(); await wait(200);
  ok('12 printing from the edited distribution still uses payslip number -02', new RegExp(dist.distributionNo + '-02').test(printed));
  // old distribution (saved before payslips existed) still prints
  const oldId = await win.DB.dbAdd('distributions', { distributionNo: 'HT-DIST-OLD', month: '2026-08', grossProfitTotal: 1000, expensesTotal: 0, netProfit: 1000, reservePercent: 0, reserveAmount: 0, distributableAmount: 1000, cashReceivedInMonth: 1000, splits: [{ partnerId: null, partnerName: 'Old Partner', percent: 100, amount: 1000 }], createdAt: now, updatedAt: now });
  await go('#/distributions/' + oldId, 150);
  ok('13 an older distribution shows Unpaid and net pay = share', /Unpaid/.test(doc.getElementById('content').textContent));
  doc.querySelector('[data-slip-print]').click(); await wait(200);
  ok('14 older distribution prints a payslip numbered -01 with net pay ₱1,000.00', /HT-DIST-OLD-01/.test(printed) && /₱1,000\.00/.test(printed) && !/NaN|undefined/.test(printed));
  await go('#/distributions', 150); ok('15 list still opens', /Distributions/.test(doc.getElementById('content').textContent));
}
main().catch(e => { console.log('TEST FAILED', e); process.exit(1); });
