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
  await win.DB.dbAdd('partners', { partnerNo: 'P1', name: 'Gian', partnerType: 'Partner', defaultSplitPercent: 60, status: 'Active', createdAt: now });
  // no separate Reserve % any more: the reserve is whatever the shares leave over
  await go('#/settings');
  ok('1 Settings no longer has a Default Business Reserve % field', !doc.getElementById('s_defaultReservePercent'));
  await go('#/distributions/new');
  ok('2 the Distribution form has no Reserve % box', !doc.getElementById('f_reservePercent'));
  fire(doc.getElementById('f_grossProfit'), '100000'); fire(doc.getElementById('f_expenses'), '20000');
  ok('2b form shows the retained reserve live (40% = 32,000) ', /Kept in the Business Reserve \(40% of Net Profit\)/.test(doc.getElementById('distTotalsPreview').textContent) && /32,000\.00/.test(doc.getElementById('distTotalsPreview').textContent));
  doc.getElementById('distForm').dispatchEvent(new win.Event('submit', { cancelable: true })); await wait(250);
  const d = (await win.DB.dbGetAll('distributions'))[0];
  ok('3 net 80,000, share 60%: paid out 48,000, reserve 40% = 32,000', d.netProfit === 80000 && d.reservePercent === 40 && d.reserveAmount === 32000 && d.distributableAmount === 48000 && d.splits[0].amount === 48000 && d.splitBasis === 'net');
  // more than 100% is refused
  await go('#/distributions/' + d.id + '/edit'); fire(doc.querySelector('.sp-percent'), '120');
  ok('4 shares over 100% show a red warning', /more than 100%/.test(doc.getElementById('splitTotalWarning').textContent));
  doc.getElementById('distForm').dispatchEvent(new win.Event('submit', { cancelable: true })); await wait(200);
  ok('5 and cannot be saved', (await win.DB.dbGet('distributions', d.id)).splits[0].percent === 60 && /cannot be more than 100%/.test(toasts.slice(-1)[0]), toasts.slice(-1)[0]);
  // list: balance
  await go('#/distributions', 150);
  ok('7 list shows Balance 32,000, Set Aside 32,000, Used 0', stat('Business Reserve Balance') === '₱32,000.00' && stat('Reserve Set Aside (all time)') === '₱32,000.00' && stat('Reserve Used') === '₱0.00', [stat('Business Reserve Balance'), stat('Reserve Used')].join());
  // use reserve
  doc.getElementById('btnUseReserve').click(); await wait(40);
  fire(doc.getElementById('rv_amount'), '3000');
  doc.getElementById('btnSaveReserveUse').click(); await wait(100);
  ok('8 a reason is required', toasts.slice(-1)[0].startsWith('err') && /reason/i.test(toasts.slice(-1)[0]) && !(await win.DB.getSettings()).reserveWithdrawals.length, toasts.slice(-1)[0]);
  fire(doc.getElementById('rv_reason'), 'Air compressor service'); fire(doc.getElementById('rv_amount'), '40000');
  doc.getElementById('btnSaveReserveUse').click(); await wait(100);
  ok('9 cannot use more than the balance', toasts.slice(-1)[0].startsWith('err') && !(await win.DB.getSettings()).reserveWithdrawals.length, toasts.slice(-1)[0]);
  fire(doc.getElementById('rv_amount'), '3000');
  doc.getElementById('btnSaveReserveUse').click(); await wait(250);
  ok('10 3,000 used: balance 29,000, Used 3,000, history row with the reason', stat('Business Reserve Balance') === '₱29,000.00' && stat('Reserve Used') === '₱3,000.00' && /Air compressor service/.test(doc.getElementById('content').textContent), stat('Business Reserve Balance'));
  await go('#/dashboard', 200); ok('11 dashboard Business Reserve tile shows the balance 29,000', stat('Business Reserve') === '₱29,000.00', stat('Business Reserve'));
  // settings save keeps withdrawals
  await go('#/settings'); (doc.getElementById('settingsForm') || doc.querySelector('form')).dispatchEvent(new win.Event('submit', { cancelable: true })); await wait(300);
  ok('12 saving Settings does not wipe the reserve history', (await win.DB.getSettings()).reserveWithdrawals.length === 1);
  // remove entry
  await go('#/distributions', 150); doc.querySelector('[data-wdel]').click(); await wait(250);
  ok('13 removing the entry returns the money: balance 32,000 again', stat('Business Reserve Balance') === '₱32,000.00');
  // backup/restore carries it
  const s = await win.DB.getSettings(); ok('14 withdrawals live in the settings record (included in backups)', Array.isArray(s.reserveWithdrawals));
}
main().catch(e => { console.log('TEST FAILED', e); process.exit(1); });
