// Sales Order "Additional Costs": absorbed costs recorded as linked Expenses, margin estimate, no double counting
const fs = require('fs'); const path = require('path');
const { JSDOM } = require('jsdom'); require('fake-indexeddb/auto');
let fails = 0, pass = 0; const ok = (n, c, x) => { console.log(n + ':', !!c, c ? '' : (x || '')); c ? pass++ : fails++; };
(async () => {
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'), { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const win = dom.window, doc = win.document; const errs = []; let confirms = 0;
  win.indexedDB = global.indexedDB; win.IDBKeyRange = global.IDBKeyRange; win.confirm = () => { confirms++; return true; }; win.alert = () => {}; win.addEventListener('error', e => errs.push(e.message));
  for (const s of [...doc.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => s !== 'js/app.js')) win.eval(fs.readFileSync(path.join(__dirname, s), 'utf8'));
  const r2n = x => Math.round(x * 100) / 100; const wait = ms => new Promise(r => setTimeout(r, ms)); const DB = win.DB; const go = async h => { win.location.hash = h; await win.Router.resolveRoute(); await wait(300); };
  await DB.openDB(); await DB.ensureCounters(); const today = win.todayISO(), now = new Date().toISOString();
  const cust = await DB.dbAdd('customers', { customerNo: 'C1', companyName: 'KEYEC', status: 'Active', archived: false });
  const qid = await DB.dbAdd('quotations', { quotationNo: 'HT-Q-2026-0044', revision: 0, isLatest: true, status: 'Won', customerId: cust, date: today, currency: 'PHP', netSubtotal: 21335.15, grossProfit: 7335.15, grossMarginPercent: 34.38, grandTotal: 21335.15, lines: [], createdAt: now });
  const so = await DB.dbAdd('salesOrders', { soNo: 'HT-SO-2026-0005', customerId: cust, quotationId: qid, status: 'Confirmed', orderDate: today, currency: 'PHP', lines: [{ lineId: 'L1', description: 'Lamp', qty: 1, uom: 'pc', unitPrice: 21335.15, unitCost: 14000, deliveredQty: 0, discountPercent: 0, vatRate: 0 }], subtotal: 21335.15, vatTotal: 0, grandTotal: 21335.15, createdAt: now, updatedAt: now, statusHistory: [] });
  const so2 = await DB.dbAdd('salesOrders', { soNo: 'HT-SO-2026-0006', customerId: cust, status: 'Confirmed', orderDate: today, currency: 'PHP', lines: [], subtotal: 100, vatTotal: 0, grandTotal: 100, createdAt: now, updatedAt: now, statusHistory: [] });
  await DB.dbAdd('supplierPOs', { poNo: 'HT-PO-1', salesOrderId: so, supplierId: 1, currency: 'PHP', exchangeRate: 1, totalCost: 928, status: 'Received', lines: [], lineIds: [], createdAt: now });
  await DB.dbAdd('supplierPOs', { poNo: 'HT-PO-2', salesOrderId: so, supplierId: 1, currency: 'PHP', exchangeRate: 1, totalCost: 1324, status: 'Sent', lines: [], lineIds: [], createdAt: now });
  await DB.dbAdd('supplierPOs', { poNo: 'HT-PO-3', salesOrderId: so, supplierId: 1, currency: 'PHP', exchangeRate: 1, totalCost: 5000, status: 'Cancelled', lines: [], lineIds: [], createdAt: now });
  await go('#/sales-orders/' + so);
  const txt = () => doc.getElementById('content').textContent;
  ok('1 SO page has an Additional Costs card with empty message', /Additional Costs/.test(txt()) && /No additional costs recorded/.test(txt()));
  ok('2 profit before costs: sales 21,335.15, gross profit as ordered 7,335.15 (same basis as reports), no red banner', /7,335\.15/.test(txt()) && /21,335\.15/.test(txt()) && !doc.querySelector('.cost-alert'), txt().match(/Profit on this order[\s\S]{0,400}/)[0]);
  doc.getElementById('btnAddSoCost').click(); ok('3 form opens', doc.getElementById('soCostForm').style.display !== 'none');
  doc.getElementById('btnSaveSoCost').click(); await wait(100); ok('4 empty form is refused', (await DB.dbGetAll('expenses')).length === 0);
  const fill = (d, a, ty) => { doc.getElementById('ac_desc').value = d; doc.getElementById('ac_amount').value = a; doc.getElementById('ac_vendor').value = 'UPS'; doc.getElementById('ac_ref').value = '1ZJ448F40442399742'; if (ty) doc.getElementById('ac_type').value = ty; };
  fill('UPS import charges - brokerage, government charge, VAT on service', '482.95', 'Import Duties & Brokerage');
  doc.getElementById('btnSaveSoCost').click(); await wait(600);
  const ex = await DB.dbGetAll('expenses'); const e = ex[0];
  ok('5 one expense created, linked to the order, PHP 482.95, category Import Duties & Brokerage, payee = our business, numbered', ex.length === 1 && e.salesOrderId === so && e.soNo === 'HT-SO-2026-0005' && e.amount === 482.95 && e.category === 'Import Duties & Brokerage' && /^Hadrontech/.test(e.payee) && e.vendor === 'UPS' && e.referenceNo === '1ZJ448F40442399742' && /^HT-EXP-/.test(e.expenseNo || ''), JSON.stringify(e));
  ok('6 SO page lists it, shows total and profit after = 7,335.15 - 482.95 = 6,852.20', /482\.95/.test(txt()) && /Total additional costs/.test(txt()) && /6,852\.20/.test(txt()) && !!doc.querySelector(`#soCostsCard a[href="#/expenses/${e.id}"]`), txt().match(/Profit on this order[\s\S]{0,400}/)[0]);
  ok('6b no banner at the top; the card shows the same total (482.95) and profit after (6,852.20), amounts red', (() => { const b = doc.querySelector('#soCostsCard'); return !doc.querySelector('.cost-alert') && b && /482\.95/.test(b.textContent) && /6,852\.20/.test(b.textContent) && doc.querySelector('#soCostsCard.cost-card') && doc.querySelectorAll('#soCostsCard .cost-red').length >= 3; })());
  await go('#/sales-orders'); ok('6c Sales Orders list tags the order in red with +482.95, other order has no tag', (() => { const t = [...doc.querySelectorAll('.cost-tag')]; return t.length === 1 && /482\.95/.test(t[0].textContent) && t[0].closest('tr').textContent.includes('HT-SO-2026-0005'); })());
  await go('#/dashboard'); ok('6d Dashboard has no unexpected-cost banner', !doc.querySelector('.cost-alert'));
  const gp = await win.buildReport('grossProfit', '', '', '', '', '', ''); const gr = gp.rows[0];
  ok('6e Gross Profit report: additional costs 482.95 subtracted -> profit after 6,852.20 (same as the order page); totals agree', gp.rows.length === 1 && gr._addCost === 482.95 && gr._gpAfter === 6852.2 && gp.totals[4] === '₱482.95' && gp.totals[5] === '₱6,852.20', JSON.stringify(gp.totals));
  const mf = win.computeMonthlyFigures(today.slice(0, 7), await DB.dbGetAll('salesOrders'), await DB.dbGetAll('expenses'), []);
  ok('6f Distributions: month expenses include the 482.95 once (gross profit 7,335.15 ; expenses 482.95 counted once)', mf.expensesTotal === 482.95 && mf.grossProfitTotal === 7335.15, JSON.stringify(mf));
  await go('#/sales-orders/' + so);
  ok('7 order total unchanged (absorbed, not billed)', (await DB.dbGet('salesOrders', so)).grandTotal === 21335.15 && /21,335\.15/.test(txt()));
  // same cost again -> duplicate warning
  doc.getElementById('btnAddSoCost').click(); fill('UPS import charges - brokerage, government charge, VAT on service', '482.95'); const c0 = confirms;
  doc.getElementById('btnSaveSoCost').click(); await wait(500); ok('8 same description + amount within 7 days asks to confirm', confirms === c0 + 1);
  const ex2 = await DB.dbGetAll('expenses'); const dupId = ex2.find(x => x.id !== e.id); await DB.dbDelete('expenses', dupId.id);
  // other order unaffected
  await go('#/sales-orders/' + so2); ok('9 another order does not show this cost', /No additional costs recorded/.test(txt()) && !/482\.95/.test(txt()));
  // Expenses list shows the link; expense form has the field; editing keeps link
  await go('#/expenses'); ok('10 Expenses list has a Sales Order column with the order link', /Sales Order/.test(txt()) && !!doc.querySelector(`#content a[href="#/sales-orders/${so}"]`));
  await go('#/expenses/' + e.id + '/edit'); const sel = doc.getElementById('f_salesOrderId');
  ok('11 expense form has a Sales Order dropdown preselected on this order', !!sel && sel.value === String(so) && [...sel.options].some(o => o.textContent === 'HT-SO-2026-0006'), sel && sel.value);
  sel.value = String(so2); doc.getElementById('entityForm').dispatchEvent(new win.Event('submit', { cancelable: true, bubbles: true })); await wait(500);
  const e2 = await DB.dbGet('expenses', e.id); ok('12 re-linking from the expense form updates the order number and keeps the number as a real id', e2.salesOrderId === so2 && e2.soNo === 'HT-SO-2026-0006' && typeof e2.salesOrderId === 'number', JSON.stringify(e2));
  await go('#/expenses/' + e.id + '/edit'); doc.getElementById('f_salesOrderId').value = ''; doc.getElementById('entityForm').dispatchEvent(new win.Event('submit', { cancelable: true, bubbles: true })); await wait(500);
  ok('13 clearing the dropdown unlinks it', (await DB.dbGet('expenses', e.id)).salesOrderId === '');
  // bookkeeper + reports
  ok('14 bookkeeper pack maps the new category to an account', /'Import Duties & Brokerage': 'Import Duties and Brokerage Expense'/.test(fs.readFileSync(path.join(__dirname, 'js/bookkeeperPack.js'), 'utf8')));
  // foreign-currency order: no fake margin
  const so3 = await DB.dbAdd('salesOrders', { soNo: 'HT-SO-3', customerId: cust, status: 'Confirmed', orderDate: today, currency: 'USD', lines: [], subtotal: 100, vatTotal: 0, grandTotal: 100, createdAt: now, updatedAt: now, statusHistory: [] });
  await go('#/sales-orders/' + so3); ok('15 USD order shows no profit-after figure and says why', /not worked out here/.test(txt()));
  ok('no script errors', errs.length === 0, errs.join('|'));
  console.log(`${pass} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
})();
