// Order Profit colours: green when actual profit is above as-ordered, red when below, plain when equal; same on list, detail and Business Performance Report.
const fs = require('fs'); const { JSDOM } = require('jsdom'); require('fake-indexeddb/auto');
let f = 0; const ok = (n, c, x) => { console.log(n + ':', !!c, c ? '' : (x || '')); if (!c) f++; };
(async () => {
  const dom = new JSDOM(fs.readFileSync('index.html', 'utf8'), { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const win = dom.window, doc = win.document, errs = []; win.indexedDB = global.indexedDB; win.IDBKeyRange = global.IDBKeyRange; win.addEventListener('error', e => errs.push(e.message));
  for (const s of [...doc.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => s !== 'js/app.js')) win.eval(fs.readFileSync(s, 'utf8'));
  const wait = ms => new Promise(r => setTimeout(r, ms)), go = async h => { win.location.hash = h; await win.Router.resolveRoute(); await wait(300); };
  const DB = win.DB; await DB.openDB(); await DB.ensureCounters(); const t = win.todayISO(), now = new Date().toISOString();
  const cust = await DB.dbAdd('customers', { customerNo: 'C1', companyName: 'KEYEC', status: 'Active' }), sup = await DB.dbAdd('suppliers', { supplierNo: 'S1', companyName: 'S', status: 'Active' });
  const mk = async (no, poTotal) => {
    const so = await DB.dbAdd('salesOrders', { soNo: no, customerId: cust, status: 'Delivered', orderDate: t, currency: 'PHP', freight: 0, lines: [{ lineId: 'L', description: 'X', qty: 1, uom: 'pc', unitPrice: 1000, unitCost: 600, vatRate: 0, discountPercent: 0 }], subtotal: 1000, vatTotal: 0, grandTotal: 1000, createdAt: now, updatedAt: now, statusHistory: [] });
    await DB.dbAdd('proformaInvoices', { piNo: 'PI-' + no, salesOrderId: so, date: t, currency: 'PHP', grandTotal: 1000, vatTotal: 0, lines: [], payments: [{ id: 'a', date: t, amount: 1000 }] });
    await DB.dbAdd('supplierPOs', { poNo: 'PO-' + no, salesOrderId: so, supplierId: sup, currency: 'PHP', exchangeRate: 1, totalCost: poTotal, status: 'Received', lines: [], lineIds: [], payments: [{ id: 'p', date: t, amount: poTotal }], createdAt: now });
    return so;
  };
  const better = await mk('BETTER', 500), worse = await mk('WORSE', 700), same = await mk('SAME', 600);
  await go('#/order-profit');
  const row = no => [...doc.querySelectorAll('#content tbody tr')].find(r => r.textContent.includes(no));
  ok('list: better order green (actual profit and +difference)', row('BETTER').querySelectorAll('.profit-green').length >= 2 && /\+/.test(row('BETTER').textContent));
  ok('list: worse order red, with the minus sign', row('WORSE').querySelectorAll('.cost-red').length >= 2 && /−/.test(row('WORSE').textContent));
  ok('list: equal order has no colour', row('SAME').querySelectorAll('.profit-green,.cost-red').length === 0);
  ok('list: totals row is plain because +100 and -100 cancel out', doc.querySelectorAll('#content tfoot .profit-green, #content tfoot .cost-red').length === 0);
  await go('#/order-profit/' + better);
  let tx = doc.getElementById('content').textContent;
  ok('detail better: green profit + difference, cost difference −100 in green', doc.querySelectorAll('.profit-green').length >= 4 && /−/.test(tx), doc.querySelectorAll('.profit-green').length);
  await go('#/order-profit/' + worse);
  ok('detail worse: red profit, difference and cost difference, no green', doc.querySelectorAll('td .cost-red, td.cost-red').length >= 3 && doc.querySelectorAll('.profit-green').length === 0);
  await go('#/reports/ownerReport'); await wait(800);
  ok('Business Performance Report page: green and red cells present, same signs', doc.querySelectorAll('.profit-green').length >= 2 && doc.querySelectorAll('.cost-red').length >= 2 && /Profit: gross profit as ordered vs actual/.test(doc.getElementById('content').textContent), doc.getElementById('content').textContent.slice(0,200));
  ok('no script errors', errs.length === 0, errs.join('|')); process.exit(f ? 1 : 0);
})();
