/* Dashboard v2: attention chips, charts, corrected counts, clickable tiles, Expired deep link. */
const fs = require('fs'); const path = require('path');
const { JSDOM } = require('jsdom'); require('fake-indexeddb/auto');
const APP = __dirname;
(async () => {
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const win = dom.window; const doc = win.document;
  win.indexedDB = global.indexedDB; win.IDBKeyRange = global.IDBKeyRange; win.confirm = () => true; win.alert = () => {};
  const errors = []; win.addEventListener('error', e => errors.push(e.message)); win.console.error = (...a) => errors.push(a.join(' '));
  for (const src of [...doc.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => s !== 'js/app.js')) win.eval(fs.readFileSync(path.join(APP, src), 'utf8'));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const ok = (n, c, x) => console.log(n + ':', !!c, c ? '' : (x === undefined ? '' : x));
  const go = async (h, ms = 250) => { win.location.hash = h; await win.Router.resolveRoute(); await wait(ms); };
  await win.DB.openDB(); await win.DB.ensureCounters();
  const now = new Date().toISOString(); const today = win.todayISO();
  const cust = await win.DB.dbAdd('customers', { customerNo: 'C1', companyName: 'Cust', status: 'Active', createdAt: now });
  const sup = await win.DB.dbAdd('suppliers', { supplierNo: 'S1', companyName: 'Sup', status: 'Active', createdAt: now });
  const mkSO = (no, st, total, date) => win.DB.dbAdd('salesOrders', { soNo: no, customerId: cust, status: st, currency: 'PHP', lines: [], grandTotal: total, orderDate: date, createdAt: now });
  const ym = today.slice(0, 7);
  await mkSO('SO1', 'Ready for Delivery', 1000, ym + '-01');
  await mkSO('SO2', 'Partially Delivered', 2000, ym + '-02');
  await mkSO('SO3', 'Cancelled', 50000, ym + '-03');
  await mkSO('SO4', 'Delivered', 4000, ym + '-04');
  const line = (r) => ({ lineId: 'x', description: 'd', qty: 2, uom: 'pc', unitCost: 10, amount: 20, receivedQty: r });
  const mkSPO = (no, st, lines, total) => win.DB.dbAdd('supplierPOs', { poNo: no, supplierId: sup, status: st, currency: 'PHP', lines, totalCost: total, payments: [], createdAt: now });
  await mkSPO('P1', 'Sent', [line(0)], 500);                 // awaiting receipt + unpaid
  await mkSPO('P2', 'Cancelled', [line(0)], 900);            // must not count anywhere
  await mkSPO('P3', 'Received', [line(2)], 0);               // zero cost, received -> nothing
  await mkSPO('P4', 'Draft', [line(0)], 100);                // draft: not ordered yet, but still a debt? counted as unpaid only
  const mkQ = (no, st, valid) => win.DB.dbAdd('quotations', { quotationNo: no, customerId: cust, revision: 0, isLatest: true, status: st, date: today, currency: 'PHP', lines: [], grandTotal: 100, validUntil: valid, createdAt: now, updatedAt: now });
  await mkQ('Q1', 'Sent', win.addDaysISO(today, -5));
  await mkQ('Q2', 'Draft', win.addDaysISO(today, 3));
  await mkQ('Q3', 'Won', win.addDaysISO(today, 30));
  await go('#/dashboard', 400);
  const txt = doc.getElementById('content').textContent;
  const chip = (t) => [...doc.querySelectorAll('.att-chip')].find(c => c.textContent.includes(t));
  const num = (t) => chip(t) && chip(t).querySelector('.att-num').textContent;
  ok('1 renders with no JS errors and no NaN/undefined', errors.length === 0 && !/NaN|undefined/.test(txt), errors.join('|') + txt.slice(0, 100));
  ok('2 Orders ready to deliver counts Ready for Delivery + Partially Delivered = 2', num('Orders ready to deliver') === '2', num('Orders ready to deliver'));
  ok('3 Supplier POs to receive = 1 (Sent only; Cancelled, Draft and Received excluded)', num('Supplier POs to receive') === '1', num('Supplier POs to receive'));
  ok('4 Supplier POs to pay = 2 (P1, P4); cancelled and zero-cost excluded', num('Supplier POs to pay') === '2', num('Supplier POs to pay'));
  ok('5 Expired quotations = 1 and expiring in 7 days = 1', num('Expired quotations') === '1' && num('Quotations expiring in 7 days') === '1');
  ok('6 chips with zero show a tick and the "off" style', chip('Invoices to collect').classList.contains('off') && /✓/.test(chip('Invoices to collect').textContent));
  const tile = (l) => { const c = [...doc.querySelectorAll('.stat-card')].find(x => x.querySelector('.stat-card-lbl').textContent === l); return c && c.querySelector('.stat-card-num').textContent; };
  ok('7 tiles: Supplier POs Awaiting Receipt 1; Orders Awaiting Delivery 2', tile('Supplier POs Awaiting Receipt') === '1' && tile('Orders Awaiting Delivery') === '2');
  ok('8 owed to suppliers = ₱600.00 (cancelled P2 not counted)', /600\.00/.test(tile('Owed to Suppliers (PHP)') || ''), tile('Owed to Suppliers (PHP)'));
  const bars = doc.querySelectorAll('.viz-bar');
  ok('9 monthly bar chart shows one month and ignores the cancelled ₱50,000 order (7,000 = 1,000+2,000+4,000)', bars.length === 1 && /7,000\.00/.test(doc.querySelector('.viz-hit').getAttribute('data-tip')) && !/50,000/.test(doc.querySelector('.viz-svg').outerHTML), doc.querySelector('.viz-hit') && doc.querySelector('.viz-hit').getAttribute('data-tip'));
  ok('10 quotation donut present with total 3 and legend rows for all five statuses', doc.querySelector('.donut-num').textContent === '3' && doc.querySelectorAll('.donut-legend li').length === 5);
  ok('11 orders-by-progress bars cover 8 stages and Cancelled is not a stage', doc.querySelectorAll('.hbars .hbar-row').length === 8 && !/Cancelled/.test(doc.querySelector('.hbars').textContent));
  ok('12 money block shows To collect / To pay for PHP', /To collect/.test(txt) && /To pay/.test(txt));
  chip('Expired quotations').click(); await wait(400);
  ok('13 Expired chip opens the Quotations list already filtered to Expired (no checkbox needed)', doc.getElementById('statusFilter').value === 'Expired' && doc.getElementById('qBody').textContent.includes('Q1') && !doc.getElementById('qBody').textContent.includes('Q2'), doc.getElementById('statusFilter') && doc.getElementById('statusFilter').value);
  await go('#/dashboard', 300);
  [...doc.querySelectorAll('.stat-card')].find(x => x.querySelector('.stat-card-lbl').textContent === 'Open Sales Orders').click(); await wait(300);
  ok('14 clicking a tile opens its list', /sales-orders/.test(win.location.hash) && /Sales Orders/.test(doc.getElementById('content').textContent));
  ok('15 no JS errors overall', errors.length === 0, errors.join('|'));
})().catch(e => { console.log('TEST FAILED', e); process.exit(1); });
