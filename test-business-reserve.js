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
  const stat = (label) => { const c = [...doc.querySelectorAll('.stat-card')].find(x => x.querySelector('.stat-card-lbl').textContent === label); return c ? c.querySelector('.stat-card-num').textContent : null; };
  await win.DB.openDB(); await win.DB.ensureCounters();
  const now = new Date().toISOString();
  await win.DB.dbAdd('partners', { partnerNo: 'P1', name: 'Gian', partnerType: 'Partner', defaultSplitPercent: 100, status: 'Active', createdAt: now });
  // settings default
  await go('#/settings');
  ok('1 Settings has a Default Business Reserve % field starting at 10', doc.getElementById('s_defaultReservePercent') && doc.getElementById('s_defaultReservePercent').value === '10');
  // new distribution starts at the default
  await go('#/distributions/new');
  ok('2 a new Distribution starts with Reserve % = 10', doc.getElementById('f_reservePercent').value === '10');
  fire(doc.getElementById('f_grossProfit'), '100000'); fire(doc.getElementById('f_expenses'), '20000');
  doc.getElementById('distForm').dispatchEvent(new win.Event('submit', { cancelable: true })); await wait(250);
  const d = (await win.DB.dbGetAll('distributions'))[0];
  ok('3 saved with reserve 10% = 8,000 and distributable 72,000', d.reservePercent === 10 && d.reserveAmount === 8000 && d.distributableAmount === 72000);
  // change the default in Settings; old distribution keeps its own %
  await go('#/settings'); fire(doc.getElementById('s_defaultReservePercent'), '15');
  doc.getElementById('settingsForm') ? doc.getElementById('settingsForm').dispatchEvent(new win.Event('submit', { cancelable: true })) : doc.querySelector('form').dispatchEvent(new win.Event('submit', { cancelable: true })); await wait(300);
  ok('4 default saved as 15', (await win.DB.getSettings()).defaultReservePercent === 15);
  await go('#/distributions/new'); ok('5 next new Distribution starts at 15', doc.getElementById('f_reservePercent').value === '15');
  await go('#/distributions/' + d.id + '/edit'); ok('6 an existing Distribution keeps its own 10%', doc.getElementById('f_reservePercent').value === '10');
  // list: balance
  await go('#/distributions', 150);
  ok('7 list shows Balance 8,000, Set Aside 8,000, Used 0', stat('Business Reserve Balance') === '₱8,000.00' && stat('Reserve Set Aside (all time)') === '₱8,000.00' && stat('Reserve Used') === '₱0.00', [stat('Business Reserve Balance'), stat('Reserve Used')].join());
  // use reserve
  doc.getElementById('btnUseReserve').click(); await wait(40);
  fire(doc.getElementById('rv_amount'), '3000');
  doc.getElementById('btnSaveReserveUse').click(); await wait(100);
  ok('8 a reason is required', toasts.slice(-1)[0].startsWith('err') && /reason/i.test(toasts.slice(-1)[0]) && !(await win.DB.getSettings()).reserveWithdrawals.length, toasts.slice(-1)[0]);
  fire(doc.getElementById('rv_reason'), 'Air compressor service'); fire(doc.getElementById('rv_amount'), '9000');
  doc.getElementById('btnSaveReserveUse').click(); await wait(100);
  ok('9 cannot use more than the balance', toasts.slice(-1)[0].startsWith('err') && !(await win.DB.getSettings()).reserveWithdrawals.length, toasts.slice(-1)[0]);
  fire(doc.getElementById('rv_amount'), '3000');
  doc.getElementById('btnSaveReserveUse').click(); await wait(250);
  ok('10 3,000 used: balance 5,000, Used 3,000, history row with the reason', stat('Business Reserve Balance') === '₱5,000.00' && stat('Reserve Used') === '₱3,000.00' && /Air compressor service/.test(doc.getElementById('content').textContent), stat('Business Reserve Balance'));
  await go('#/dashboard', 200); ok('11 dashboard Business Reserve tile shows the balance 5,000', stat('Business Reserve') === '₱5,000.00', stat('Business Reserve'));
  // settings save keeps withdrawals
  await go('#/settings'); (doc.getElementById('settingsForm') || doc.querySelector('form')).dispatchEvent(new win.Event('submit', { cancelable: true })); await wait(300);
  ok('12 saving Settings does not wipe the reserve history', (await win.DB.getSettings()).reserveWithdrawals.length === 1);
  // remove entry
  await go('#/distributions', 150); doc.querySelector('[data-wdel]').click(); await wait(250);
  ok('13 removing the entry returns the money: balance 8,000 again', stat('Business Reserve Balance') === '₱8,000.00');
  // backup/restore carries it
  const s = await win.DB.getSettings(); ok('14 withdrawals live in the settings record (included in backups)', Array.isArray(s.reserveWithdrawals));
}
main().catch(e => { console.log('TEST FAILED', e); process.exit(1); });
