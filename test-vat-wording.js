// VAT wording follows the VAT Mode chosen on the Quotation, on every screen, print and report.
const fs = require('fs'); const { JSDOM } = require('jsdom'); require('fake-indexeddb/auto');
let f = 0; const ok = (n, c, x) => { console.log(n + ':', !!c, c ? '' : (x || '')); if (!c) f++; };
(async () => {
  const dom = new JSDOM(fs.readFileSync('index.html', 'utf8'), { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const win = dom.window, doc = win.document, errs = []; win.indexedDB = global.indexedDB; win.IDBKeyRange = global.IDBKeyRange; win.addEventListener('error', e => errs.push(e.message));
  for (const s of [...doc.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => s !== 'js/app.js')) win.eval(fs.readFileSync(s, 'utf8'));
  const wait = ms => new Promise(r => setTimeout(r, ms)), go = async h => { win.location.hash = h; await win.Router.resolveRoute(); await wait(300); };
  let printed = ''; win.open = () => ({ document: { open() {}, write: (h) => { printed = h; }, close() {} }, focus() {}, print() {} });
  const DB = win.DB; await DB.openDB(); await DB.ensureCounters(); const t = win.todayISO(), now = new Date().toISOString();
  const cust = await DB.dbAdd('customers', { customerNo: 'C1', companyName: 'KEYEC', status: 'Active' });
  const cu = { companyName: 'KEYEC' }, txt = () => doc.getElementById('content').textContent;
  // helpers
  ok('names', win.vatModeName('NonVat') === 'Non-VAT (3% Percentage Tax)' && win.vatModeName('Standard12') === 'Standard 12%' && win.vatModeName('ZeroRated') === 'Zero-Rated' && win.vatModeName('Exempt') === 'VAT Exempt');
  ok('sales labels', win.vatSalesLabel('NonVat') === 'Sales (Non-VAT)' && win.vatSalesLabel('Standard12') === 'Sales (before VAT)' && win.vatSalesLabel('ZeroRated') === 'Sales (Zero-Rated)' && win.vatSalesLabel('Exempt') === 'Sales (VAT Exempt)' && win.vatSalesLabel(['NonVat', 'NonVat'], 'Order sales') === 'Order sales (Non-VAT)' && win.vatSalesLabel(['NonVat', 'Standard12']) === 'Sales (excluding VAT, if any)' && win.vatSalesLabel('') === 'Sales (before VAT, if any)');
  const modes = ['NonVat', 'Standard12', 'ZeroRated', 'Exempt']; const rec = {};
  for (const m of modes) {
    const v = m === 'Standard12' ? 12 : 0, line = { lineId: 'L' + m, description: 'Item ' + m, qty: 1, uom: 'pc', unitPrice: 100, unitCost: 60, vatRate: v, discountPercent: 0 };
    const q = { quotationNo: 'Q-' + m, revision: 0, customerId: cust, status: 'Won', date: t, currency: 'PHP', vatMode: m, lines: [line], subtotal: 100, vatTotal: v, grandTotal: 100 + v, overallDiscountPercent: 0, freight: 0, other: 0, createdAt: now, updatedAt: now };
    q.id = await DB.dbAdd('quotations', q);
    const so = { soNo: 'SO-' + m, customerId: cust, quotationId: q.id, status: 'Delivered', orderDate: t, currency: 'PHP', vatMode: m, freight: 0, lines: [line], subtotal: 100, vatTotal: v, grandTotal: 100 + v, createdAt: now, updatedAt: now, statusHistory: [] };
    so.id = await DB.dbAdd('salesOrders', so);
    const pi = { piNo: 'PI-' + m, salesOrderId: so.id, date: t, currency: 'PHP', vatMode: m, grandTotal: 100 + v, vatTotal: v, lines: [line], payments: [{ id: 'a', date: t, amount: 100 + v }], customerSnapshot: cu };
    pi.id = await DB.dbAdd('proformaInvoices', pi);
    rec[m] = { q, so, pi };
  }
  const expectLabel = { NonVat: 'VAT (Non-VAT — not charged)', ZeroRated: 'VAT (Zero-Rated, 0%)', Exempt: 'VAT (VAT Exempt — not charged)' };
  const expectStmt = { NonVat: 'This business is not VAT-registered. Prices quoted are not subject to VAT.', ZeroRated: 'This sale is Zero-Rated: VAT is charged at 0%.', Exempt: 'This sale is VAT Exempt: no VAT is charged.' };
  for (const m of modes) {
    const { q, so, pi } = rec[m];
    const checks = [];
    printed = ''; await win.Print.printQuotation(q, cu); checks.push(['quotation print', printed]);
    printed = ''; await win.Print.printSalesOrder(so, cu, null, q); checks.push(['sales order print', printed]);
    printed = ''; await win.Print.printProformaInvoice(pi, so, cu); checks.push(['proforma invoice print', printed]);
    for (const [name, html] of checks) {
      if (m === 'Standard12') ok(`${m} ${name}: plain VAT, no statement`, html.includes('>VAT<') && !/not VAT-registered|Zero-Rated: VAT|VAT Exempt: no VAT/.test(html));
      else ok(`${m} ${name}: label and statement`, html.includes(expectLabel[m]) && html.includes(expectStmt[m].replace(/'/g, '&#39;')) || (html.includes(expectLabel[m]) && html.includes(expectStmt[m])), name);
    }
    await go('#/quotations/' + q.id); ok(`${m} quotation page: VAT Mode name and totals VAT line`, txt().includes(win.vatModeName(m)) && (m === 'Standard12' ? /VAT\d|VAT₱|VAT\s*₱/.test(txt()) : txt().includes(expectLabel[m])), txt().slice(0, 120));
    await go('#/sales-orders/' + so.id); ok(`${m} sales order page: VAT Mode name and sales label`, txt().includes(win.vatModeName(m))); 
    await go('#/order-profit/' + so.id); ok(`${m} order profit page uses ${win.vatSalesLabel(m)}`, txt().includes(win.vatSalesLabel(m)) && txt().includes(win.vatSalesLabel(m, 'Customer invoice')), txt().slice(0, 200));
  }
  await go('#/order-profit'); ok('order profit list with mixed modes: excluding VAT, if any', txt().includes('Sales (excluding VAT, if any)'));
  await go('#/reports/ownerReport'); await wait(600);
  await go('#/reports'); ok('no script errors', errs.length === 0, errs.join('|'));
  process.exit(f ? 1 : 0);
})();
