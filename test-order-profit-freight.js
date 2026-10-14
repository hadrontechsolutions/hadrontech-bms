// Order Profit: freight billed to the customer is matched by the supplier freight on the "as ordered" side.
const fs = require('fs'), path = require('path'); const { JSDOM } = require('jsdom'); require('fake-indexeddb/auto');
let f = 0; const ok = (n, c, x) => { console.log(n + ':', !!c, c ? '' : (x || '')); if (!c) f++; };
(async () => {
  const dom = new JSDOM(fs.readFileSync('index.html', 'utf8'), { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const win = dom.window, errs = []; win.indexedDB = global.indexedDB; win.IDBKeyRange = global.IDBKeyRange; win.addEventListener('error', e => errs.push(e.message));
  for (const s of [...win.document.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => s !== 'js/app.js')) win.eval(fs.readFileSync(s, 'utf8'));
  const DB = win.DB; await DB.openDB(); await DB.ensureCounters(); const t = win.todayISO(), now = new Date().toISOString();
  const cust = await DB.dbAdd('customers', { customerNo: 'C1', companyName: 'KEYEC', status: 'Active' });
  const sup = await DB.dbAdd('suppliers', { supplierNo: 'S1', companyName: 'IBE', status: 'Active' });
  const mk = async (no, lineExtra, freight, poTotal) => {
    const so = await DB.dbAdd('salesOrders', { soNo: no, customerId: cust, status: 'Delivered', orderDate: t, currency: 'PHP', freight, lines: [Object.assign({ lineId: 'L', description: 'Brush', qty: 1, uom: 'lot', unitPrice: 238, unitCost: 140, vatRate: 12, discountPercent: 0 }, lineExtra)], subtotal: 238, vatTotal: 28.56, grandTotal: 238 + 28.56 + freight, createdAt: now, updatedAt: now, statusHistory: [] });
    await DB.dbAdd('supplierPOs', { poNo: 'PO-' + no, salesOrderId: so, supplierId: sup, currency: 'PHP', exchangeRate: 1, totalCost: poTotal, status: 'Received', lines: [], lineIds: [], payments: [{ id: 'p', date: t, amount: poTotal }], createdAt: now });
    return so;
  };
  await mk('A', {}, 346, 486);                       // no freight on lines: pass-through assumed
  await mk('B', { estimatedFreightCost: 346, freightMode: 'total' }, 346, 486); // line already carries freight
  const rows = win.OrderProfit.compute(await win.OrderProfit.loadData(), {}).rows; const A = rows.find(r => r.soNo === 'A'), B = rows.find(r => r.soNo === 'B');
  ok('A: as-ordered cost = item 140 + freight 346 = 486, profit 98', A.quotedCost === 486 && A.quotedProfit === 98, JSON.stringify([A.quotedCost, A.quotedProfit]));
  ok('A: actual cost 486 so difference 0', A.actualCost === 486 && Math.abs(A.difference || 0) < 0.01, JSON.stringify([A.actualCost, A.difference]));
  ok('B: line freight already in cost, still no double count (cost 486)', B.quotedCost === 486 && B.quotedProfit === 98, JSON.stringify([B.quotedCost, B.quotedProfit]));
  ok('no script errors', errs.length === 0, errs.join('|')); process.exit(f ? 1 : 0);
})();
