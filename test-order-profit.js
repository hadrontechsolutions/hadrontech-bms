// Order Profit: gross profit as ordered vs ACTUAL profit per Sales Order; linked into the Business Performance Report
const fs = require('fs'); const path = require('path');
const { JSDOM } = require('jsdom'); require('fake-indexeddb/auto');
let fails = 0, pass = 0; const ok = (n, c, x) => { console.log(n + ':', !!c, c ? '' : (x || '')); c ? pass++ : fails++; };
(async () => {
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'), { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const win = dom.window, doc = win.document; const errs = [];
  win.indexedDB = global.indexedDB; win.IDBKeyRange = global.IDBKeyRange; win.confirm = () => true; win.alert = () => {}; win.addEventListener('error', e => errs.push(e.message));
  for (const s of [...doc.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => s !== 'js/app.js')) win.eval(fs.readFileSync(path.join(__dirname, s), 'utf8'));
  const wait = ms => new Promise(r => setTimeout(r, ms)); const DB = win.DB; const go = async h => { win.location.hash = h; await win.Router.resolveRoute(); await wait(300); };
  await DB.openDB(); await DB.ensureCounters(); const today = win.todayISO(), now = new Date().toISOString(); const txt = () => doc.getElementById('content').textContent;
  ok('1 sidebar has Order Profit before Reports', (() => { const t = [...doc.querySelectorAll('.nav-link')].map(a => a.textContent.trim()); const i = t.findIndex(x => /Order Profit/.test(x)); return i > 0 && /Reports/.test(t[i + 1]); })());
  const cust = await DB.dbAdd('customers', { customerNo: 'C1', companyName: 'KEYEC', status: 'Active', archived: false });
  const sup = await DB.dbAdd('suppliers', { supplierNo: 'S1', companyName: 'DataBitz', status: 'Active', archived: false });
  const mkSO = async (no, status, price, cost) => DB.dbAdd('salesOrders', { soNo: no, customerId: cust, status, orderDate: today, currency: 'PHP', lines: [{ lineId: 'L1', description: 'Item', qty: 1, uom: 'pc', unitPrice: price, unitCost: cost, deliveredQty: 0, discountPercent: 0, vatRate: 0 }], subtotal: price, vatTotal: 0, grandTotal: price, createdAt: now, updatedAt: now, statusHistory: [] });
  const mkPI = (so, total, paid) => DB.dbAdd('proformaInvoices', { piNo: 'PI-' + so, salesOrderId: so, date: today, currency: 'PHP', grandTotal: total, vatTotal: 0, lines: [], payments: paid ? [{ id: 'p1', date: today, amount: paid }] : [] });
  const mkPO = (so, no, cur, total, rate, pays) => DB.dbAdd('supplierPOs', { poNo: no, salesOrderId: so, supplierId: sup, currency: cur, exchangeRate: rate, totalCost: total, status: 'Sent', lines: [], lineIds: [], payments: pays || [], createdAt: now });
  // The user's order: priced 21,335.15, quoted cost 14,314.00 -> gross 7,021.15; real supplier cost 11,704.92 + UPS 482.95 = 12,187.87
  const A = await mkSO('HT-SO-A', 'Delivered', 21335.15, 14314); await mkPI(A, 21335.15, 21335.15);
  await mkPO(A, 'PO-A1', 'PHP', 8904.92, 1, [{ id: 'x', date: today, amount: 8904.92, exchangeRate: 1 }]);
  await mkPO(A, 'PO-A2', 'USD', 50, 55, [{ id: 'y', date: today, amount: 50, exchangeRate: 56 }]); // paid at 56 -> 2,800
  await DB.dbAdd('expenses', { expenseNo: 'HT-EXP-1', date: today, category: 'Import Duties & Brokerage', description: 'UPS import charges', amount: 482.95, salesOrderId: A, soNo: 'HT-SO-A', status: 'Recorded', createdAt: now });
  // B: delivered but customer has only paid half -> listed, not counted
  const B = await mkSO('HT-SO-B', 'Delivered', 1000, 600); await mkPI(B, 1000, 500); await mkPO(B, 'PO-B1', 'PHP', 600, 1, [{ id: 'z', date: today, amount: 600, exchangeRate: 1 }]);
  // C: paid in full, supplier PO USD 100 only 40 paid -> 40*56 + 60*55 = 5,540; priced 10,000, quoted cost 8,000; actual profit worse than quoted
  const C = await mkSO('HT-SO-C', 'Delivered', 10000, 8000); await mkPI(C, 10000, 10000); await mkPO(C, 'PO-C1', 'USD', 100, 55, [{ id: 'c', date: today, amount: 40, exchangeRate: 56 }]);
  await DB.dbAdd('expenses', { expenseNo: 'HT-EXP-2', date: today, category: 'Freight & Delivery', description: 'Courier', amount: 5000, salesOrderId: C, soNo: 'HT-SO-C', status: 'Recorded', createdAt: now });
  // D cancelled, E confirmed with nothing paid -> not listed
  await mkSO('HT-SO-D', 'Cancelled', 500, 100); const E = await mkSO('HT-SO-E', 'Confirmed', 500, 100); await mkPI(E, 500, 0);
  const data = await win.OrderProfit.loadData(); const res = win.OrderProfit.compute(data, {}); const row = n => res.rows.find(r => r.soNo === n);
  ok('2 only delivered/paid, non-cancelled orders are listed (A, B, C)', res.rows.map(r => r.soNo).sort().join() === 'HT-SO-A,HT-SO-B,HT-SO-C', res.rows.map(r => r.soNo));
  const a = row('HT-SO-A');
  ok('3 order A quoted: cost 14,314.00, gross profit 7,021.15 (32.91%)', a.quotedCost === 14314 && a.quotedProfit === 7021.15 && a.quotedPct === 32.91, JSON.stringify([a.quotedCost, a.quotedProfit, a.quotedPct]));
  ok('4 order A actual: suppliers 11,704.92 (USD paid at 56) + UPS 482.95 = 12,187.87', a.suppliersCost === 11704.92 && a.additional === 482.95 && a.actualCost === 12187.87, JSON.stringify([a.suppliersCost, a.additional, a.actualCost]));
  ok('5 order A actual profit 9,147.28 (42.87%), difference +2,126.13', a.actualProfit === 9147.28 && a.diffPct === 42.87 && a.difference === 2126.13, JSON.stringify([a.actualProfit, a.diffPct, a.difference]));
  const b = row('HT-SO-B'); ok('6 order B (half paid): "Not fully paid yet", no actual profit, balance 500', b.actualProfit == null && !b.paidInFull && b.balance === 500 && b.payState === 'Not fully paid yet' && !b.counted);
  const c = row('HT-SO-C'); ok('7 order C: unpaid part of USD PO at PO rate (40x56 + 60x55 = 5,540) + courier 5,000 = 10,540; actual profit -540; difference -2,540', c.suppliersCost === 5540 && c.actualCost === 10540 && c.actualProfit === -540 && c.difference === -2540, JSON.stringify([c.suppliersCost, c.actualCost, c.actualProfit, c.difference]));
  const t = res.totals; ok('8 totals count only A and C: ordered 9,021.15, actual 8,607.28, difference -413.87', t.counted === 2 && t.notCounted === 1 && t.quotedProfit === 9021.15 && t.actualProfit === 8607.28 && t.difference === -413.87 && t.actualCost === 22727.87, JSON.stringify(t));
  const date = win.OrderProfit.compute(data, { from: '2000-01-01', to: '2000-12-31' }); ok('9 order-date filter works', date.rows.length === 0);
  // list page
  await go('#/order-profit'); ok('10 page lists A, B, C with totals row and explanation', ['HT-SO-A', 'HT-SO-B', 'HT-SO-C'].every(n => txt().includes(n)) && /TOTAL — 2 fully paid orders/.test(txt()) && /9,147\.28/.test(txt()) && /Not fully paid yet/.test(txt()));
  ok('11 negative difference is red; A is not', (() => { const rows = [...doc.querySelectorAll('#opWrap tbody tr')]; const rc = rows.find(r => r.textContent.includes('HT-SO-C')), ra = rows.find(r => r.textContent.includes('HT-SO-A')); return rc.querySelector('.cost-red') && !ra.querySelector('.cost-red'); })());
  ok('12 order with additional costs carries a red marker', [...doc.querySelectorAll('#opWrap tbody tr')].find(r => r.textContent.includes('HT-SO-A')).querySelector('.cost-tag'));
  const s = doc.getElementById('opSearch'); s.value = 'HT-SO-B'; s.oninput(); ok('13 search narrows the list', doc.querySelectorAll('#opWrap tbody tr').length === 1);
  // detail
  await go('#/order-profit/' + A);
  ok('14 detail shows quoted vs actual and the breakdown (PO-A1, PO-A2, UPS 482.95, total 12,187.87, profit 9,147.28)', ['PO-A1', 'PO-A2', 'HT-EXP-1', '482.95', '12,187.87', '9,147.28', '7,021.15', '2,126.13'].every(x => txt().includes(x)), txt().slice(0, 400));
  ok('15 detail shows the unexpected cost in red in the tables, with no banner box', !doc.querySelector('.cost-alert') && doc.querySelectorAll('td.cost-red').length >= 2);
  doc.getElementById('opNote').value = 'Supplier gave a better price'; doc.getElementById('opSaveNote').click(); await wait(200);
  ok('16 review note is saved on the order and changes no figure', (await DB.dbGet('salesOrders', A)).profitNote === 'Supplier gave a better price' && win.OrderProfit.compute(await win.OrderProfit.loadData(), {}).rows.find(r => r.soNo === 'HT-SO-A').actualProfit === 9147.28);
  doc.getElementById('opAddCost').click(); await wait(500);
  ok('17 "+ Add Additional Cost" opens the Sales Order with the cost form already open', /sales-orders\/\d+/.test(win.location.hash) && doc.getElementById('soCostForm').style.display !== 'none');
  await go('#/order-profit/' + (await DB.dbAdd('salesOrders', { soNo: 'HT-SO-F', customerId: cust, status: 'Confirmed', orderDate: today, currency: 'PHP', lines: [], grandTotal: 1, createdAt: now, updatedAt: now, statusHistory: [] })));
  ok('18 an order not on the list shows a friendly message, not an error', /not on the Order Profit list yet/.test(txt()));
  // Business Performance Report
  const od = await win.OwnerReport.loadData(); const rep = win.OwnerReport.buildOwnerReport({ from: today.slice(0, 7) + '-01', to: today.slice(0, 7) + '-31', data: od });
  ok('19 Business Performance Report carries the same order-profit figures', rep.orderProfit.totals.actualProfit === 8607.28 && rep.orderProfit.rows.length === 3, JSON.stringify(rep.orderProfit.totals));
  const sheets = win.OwnerReport.buildSheets(rep, win.BookkeeperPack.company(od.settings)); const sh = sheets.find(x => x.name === 'Order Profit');
  ok('20 workbook has an "Order Profit" tab with the orders and totals', !!sh && JSON.stringify(sh.rows).includes('HT-SO-A') && JSON.stringify(sh.rows).includes('TOTAL'));
  ok('21 PDF summary includes the as-ordered vs actual block', /Gross profit as ordered/.test(win.OwnerReport.summaryHTML(rep, win.BookkeeperPack.company(od.settings))) && /9,147\.28|8,607\.28/.test(win.OwnerReport.summaryHTML(rep, win.BookkeeperPack.company(od.settings))));
  const host = doc.createElement('div'); doc.body.appendChild(host); await win.OwnerReport.render(host); await wait(300);
  ok('22 on-screen report shows the section with a link to Order Profit', /gross profit as ordered vs actual profit/i.test(host.textContent) && !!host.querySelector('a[href="#/order-profit"]') && /8,607\.28/.test(host.textContent));
  ok('no script errors', errs.length === 0, errs.join('|'));
  console.log(`${pass} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
})();
