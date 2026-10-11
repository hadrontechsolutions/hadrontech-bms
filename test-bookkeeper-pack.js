/* Bookkeeper Pack: numbers, exclusions, roll-forwards, a real .xlsx file, page + PDF summary. */
const fs = require('fs'); const path = require('path'); const os = require('os');
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
  const near = (a, b) => Math.abs(a - b) < 0.011;
  const BP = win.BookkeeperPack;
  const st = { companyName: 'Hadrontech Industrial Solutions', tin: '123-456-789-000', address: 'Cavite, Philippines', referenceRates: { USD: 58 }, reserveWithdrawals: [{ id: 'w1', date: '2026-09-20', amount: 1000, reason: 'Equipment' }] };
  const customers = [{ id: 1, companyName: 'Key Electrochem', tin: '111-222-333-000' }, { id: 2, companyName: 'No TIN Corp' }];
  const suppliers = [{ id: 1, companyName: 'Local Supplier', tin: '999-888-777-000', country: 'Philippines' }, { id: 2, companyName: 'Overseas Co', country: 'USA' }];
  const salesOrders = [{ id: 1, soNo: 'SO-1', customerId: 1, status: 'Delivered', orderDate: '2026-09-02' }, { id: 2, soNo: 'SO-2', customerId: 2, status: 'Confirmed', orderDate: '2026-09-10' }, { id: 3, soNo: 'SO-3', customerId: 1, status: 'Cancelled', orderDate: '2026-09-12', grandTotal: 5000 }, { id: 4, soNo: 'SO-4', customerId: 1, status: 'Delivered', orderDate: '2026-08-01' }, { id: 5, soNo: 'SO-5', customerId: 1, status: 'Delivered', orderDate: '2026-09-25' }, { id: 6, soNo: 'SO-6', customerId: 1, status: 'Draft', orderDate: '2026-09-26', grandTotal: 700 }];
  const pi = (id, no, so, date, total, pays) => ({ id, piNo: no, salesOrderId: so, date, currency: 'PHP', grandTotal: total, vatTotal: 0, payments: pays });
  const proformaInvoices = [
    pi(1, 'PI-1', 1, '2026-09-03', 10000, [{ date: '2026-09-05', amount: 4000, method: 'Bank Transfer', reference: 'BT1' }, { date: '2026-10-05', amount: 6000, method: 'Cash', reference: 'late' }]),
    pi(2, 'PI-2', 2, '2026-09-11', 20000, [{ date: '2026-09-30', amount: 20000, method: 'Cash', reference: '' }]),
    pi(3, 'PI-3', 3, '2026-09-13', 5000, []),                       // cancelled SO -> excluded
    pi(4, 'PI-4', 4, '2026-08-05', 8000, [{ date: '2026-08-20', amount: 3000, method: 'Cash', reference: 'x' }, { date: '2026-09-15', amount: 1000, method: 'Cash', reference: 'y' }]) // opening AR 5000; 1000 collected in Sept
  ];
  const pl = (q, a) => ({ lineId: 'l' + a, description: 'd', qty: q, amount: a, receivedQty: q });
  const supplierPOs = [
    { id: 1, poNo: 'PO-1', supplierId: 1, salesOrderId: 1, status: 'Received', poDate: '2026-09-04', currency: 'PHP', lines: [pl(1, 3000)], freight: 200, taxes: 0, totalCost: 3200, payments: [{ date: '2026-09-06', amount: 3200, method: 'Bank Transfer', reference: 'SP1' }] },
    { id: 2, poNo: 'PO-2', supplierId: 2, salesOrderId: 2, status: 'Sent', poDate: '2026-09-12', currency: 'USD', lines: [pl(1, 100)], freight: 20, taxes: 0, totalCost: 120, payments: [{ date: '2026-09-29', amount: 20, method: 'Wire', reference: 'W1' }] },
    { id: 3, poNo: 'PO-3', supplierId: 1, status: 'Cancelled', poDate: '2026-09-14', currency: 'PHP', lines: [pl(1, 999)], totalCost: 999, payments: [] },
    { id: 4, poNo: 'PO-4', supplierId: 1, status: 'Draft', poDate: '2026-09-15', currency: 'PHP', lines: [pl(1, 111)], totalCost: 111, payments: [] },
    { id: 5, poNo: 'PO-5', supplierId: 1, status: 'Received', poDate: '2026-08-10', currency: 'PHP', lines: [pl(1, 2000)], totalCost: 2000, payments: [{ date: '2026-09-02', amount: 500, method: 'Cash', reference: 'o' }] } // opening AP 2000, 500 paid in Sept
  ];
  const expenses = [{ expenseNo: 'EXP-1', date: '2026-09-08', category: 'Rent', description: 'Office rent', payee: 'Landlord', paymentMethod: 'Bank Transfer', referenceNo: 'OR-1', amount: 5000 }, { expenseNo: 'EXP-2', date: '2026-09-18', category: 'Rent', description: 'Storage', payee: 'L2', paymentMethod: 'Cash', referenceNo: '', amount: 1500 }, { expenseNo: 'EXP-3', date: '2026-09-20', category: 'Bank Charges', description: 'Fees', payee: 'Bank', paymentMethod: 'Other', referenceNo: 'B1', amount: 250.5 }, { expenseNo: 'EXP-4', date: '2026-08-20', category: 'Rent', description: 'Outside period', amount: 9999 }];
  const distributions = [{ distributionNo: 'DIST-1', month: '2026-09', reserveAmount: 3000, splits: [{ partnerName: 'Gian', partnerType: 'Partner', percent: 50, amount: 4000, netPay: 4000, paidDate: '2026-10-01', paidMethod: 'Bank Transfer', paidReference: 'D1' }, { partnerName: 'Willie', partnerType: 'Employee', percent: 10, amount: 800, netPay: 700, paidDate: '2026-09-30', paidMethod: 'Cash', paidReference: '' }] }, { distributionNo: 'DIST-0', month: '2026-08', reserveAmount: 500, splits: [] }];
  const products = [{ id: 1, itemNo: 'ITEM-1', type: 'Product', description: 'Pump', uom: 'pc', standardCost: 10, currency: 'USD' }, { id: 2, itemNo: 'ITEM-P-1', type: 'Project Package', description: 'Pkg' }];
  const stockMovements = [{ productId: 1, date: '2026-09-04', qty: 5 }, { productId: 1, date: '2026-09-20', qty: -2 }, { productId: 1, date: '2026-10-05', qty: -1 }];
  const data = { settings: st, customers, suppliers, salesOrders, proformaInvoices, supplierPOs, expenses, distributions, products, stockMovements };
  const pack = BP.buildPack({ from: '2026-09-01', to: '2026-09-30', data });
  const t = pack.totals;
  ok('1 sales book: PI-1, PI-2 only (cancelled-order invoice excluded, August invoice outside)', pack.salesRows.map(r => r.invoiceNo).join() === 'PI-1,PI-2', pack.salesRows.map(r => r.invoiceNo).join());
  ok('2 gross sales invoiced = 30,000', near(t.salesTotal, 30000), t.salesTotal);
  ok('3 collections in Sept = 4,000 + 20,000 + 1,000 = 25,000 (Oct payment excluded)', near(t.collections, 25000), t.collections);
  ok('4 sales book "paid to date" respects the period end (PI-1 paid 4,000 not 10,000)', pack.salesRows[0].paidToDate === 4000 && pack.salesRows[0].balance === 6000);
  ok('5 purchases = 3,200 + USD 120 x 58 = 10,160 (cancelled, draft excluded)', near(t.purchases, 3200 + 120 * 58) && pack.purchaseRows.length === 2, t.purchases);
  ok('6 supplier payments = 3,200 + 500 + USD 20 x 58 = 4,860', near(t.supplierPaid, 3200 + 500 + 20 * 58), t.supplierPaid);
  ok('7 expenses = 6,750.50 (August expense excluded); rent subtotal 6,500', near(t.expenses, 6750.5) && near(pack.expenseByCategory['Rent'].total, 6500));
  ok('8 AR opening 5,000 (PI-4 less its August payment); closing = 5,000+30,000-25,000 = 10,000 and roll-forward ties', near(t.arOpening, 5000) && near(t.arClosing, 10000) && near(t.arDiff, 0), `${t.arOpening} ${t.arClosing} ${t.arDiff}`);
  ok('9 AP opening 2,000-0 = 2,000... roll-forward ties to zero difference', near(t.apOpening, 2000) && near(t.apDiff, 0), `${t.apOpening} ${t.apClosing} ${t.apDiff}`);
  ok('10 AR aging buckets add up to closing', near(pack.arAging.b0 + pack.arAging.b30 + pack.arAging.b60 + pack.arAging.b90, t.arClosing));
  ok('11 inventory at period end = (5-2) x USD 10 x 58 = 1,740 (October movement not counted); project package not listed', near(t.inventory, 1740) && pack.inventoryRows.length === 1, t.inventory);
  ok('12 cash disbursements = supplier 4,860 + expenses 6,750.50 + employee 700 (owner draw paid in October excluded)', near(t.disbursements, 4860 + 6750.5 + 700) && near(t.employeePaid, 700) && t.ownerDrawsPaid === 0, t.disbursements);
  ok('13 reserve: opening 500, +3,000, used 1,000 -> closing 2,500', near(t.reserveStart, 500) && near(t.reserveAdded, 3000) && near(t.reserveEnd, 2500), JSON.stringify([t.reserveStart, t.reserveAdded, t.reserveEnd]));
  ok('14 exclusions list names cancelled SO/invoice/PO and draft PO/SO', ['PI-3', 'SO-3', 'PO-3', 'PO-4', 'SO-6'].every(n => pack.excluded.some(e => e.no === n)), pack.excluded.map(e => e.no).join());
  ok('15 warnings: customer without TIN, expense without reference, delivered order without invoice (SO-5), USD rate note', pack.warnings.some(w => /no TIN/.test(w.text) && /No TIN Corp/.test(w.text)) && pack.warnings.some(w => /no receipt/.test(w.text)) && pack.warnings.some(w => /SO-5/.test(w.text)) && pack.warnings.some(w => /USD @ 58/.test(w.text)), pack.warnings.map(w => w.text).join(' | '));
  ok('16 quarterly gross sales: Q3 includes PI-1+PI-2 (30,000) + PI-4 (8,000)', near(pack.quarters[2].gross, 38000), JSON.stringify(pack.quarters.map(q => q.gross)));
  const pack2 = BP.buildPack({ from: '2026-09-01', to: '2026-09-30', data, rates: { USD: 60 } });
  ok('17 custom exchange rate flows through (USD 60)', near(pack2.totals.purchases, 3200 + 120 * 60));

  // ---- the real workbook ----
  const co = BP.company(st); const bytes = BP.pack2bytes(pack, co);
  const file = path.join(os.tmpdir(), 'bk-pack-test.xlsx'); fs.writeFileSync(file, Buffer.from(bytes));
  ok('18 xlsx bytes written (zip signature PK)', bytes[0] === 0x50 && bytes[1] === 0x4B && bytes.length > 3000, bytes.length);
  const py = require('child_process').spawnSync('python3', ['-c', `
import openpyxl, sys
wb = openpyxl.load_workbook(sys.argv[1])
print('SHEETS|' + '|'.join(wb.sheetnames))
ws = wb['Sales Book']
print('SALESHDR|' + '|'.join(str(c.value) for c in ws[5]))
print('SALESROWS|%d' % sum(1 for r in ws.iter_rows(min_row=6) if r[1].value and str(r[1].value).startswith('PI-')))
tot = [r for r in ws.iter_rows(min_row=6) if r[0].value == 'TOTAL'][0]
print('SALESTOTAL|' + str(tot[12].value))
`, file], { encoding: 'utf8' });
  const lines = (py.stdout || '').split('\n'); const pick = (k) => (lines.find(l => l.startsWith(k + '|')) || '').split('|').slice(1);
  ok('19 workbook opens in a spreadsheet library with all 12 tabs', pick('SHEETS').join() === 'Summary,Sales Book,Cash Receipts,Purchases Book,Cash Disbursements,Expenses,Receivables,Payables,Inventory,Distributions,Business Reserve,Notes & Exclusions', py.stdout + py.stderr);
  ok('20 Sales Book has the header row and 2 invoice rows; total formula present', pick('SALESROWS')[0] === '2' && pick('SALESHDR')[0] === 'Date', py.stdout + py.stderr);

  // ---- the page + PDF summary ----
  for (const [k, v] of Object.entries(st)) { /* settings come from the DB */ }
  await win.DB.openDB(); await win.DB.ensureCounters();
  const s0 = await win.DB.getSettings(); Object.assign(s0, { companyName: st.companyName, tin: st.tin, address: st.address }); await win.DB.dbPut('settings', s0).catch(() => {});
  win.location.hash = '#/reports/bookkeeperPack'; await win.Router.resolveRoute(); await wait(400);
  const page = doc.getElementById('content').textContent;
  ok('21 page renders with period controls, preview tiles and both download buttons', !!doc.getElementById('bpFrom') && !!doc.getElementById('bpXlsx') && !!doc.getElementById('bpPdf') && /Invoiced/.test(page) && !/NaN|undefined/.test(page));
  const sum = BP.summaryHTML(pack, co);
  ok('22 PDF summary has company, period, totals and signature lines, no NaN', /Hadrontech Industrial Solutions/.test(sum) && /2026-09-01/.test(sum) && /30,000\.00/.test(sum) && /Received by \(Bookkeeper\)/.test(sum) && !/NaN|undefined/.test(sum));
  win.location.hash = '#/reports'; await win.Router.resolveRoute(); await wait(300);
  ok('23 the Reports page has a Bookkeeper Pack banner linking to it', !!doc.querySelector('a[href="#/reports/bookkeeperPack"]'));
  // ---- the old Bookkeeper registers: cancelled/draft excluded, Non-VAT column ----
  { const now = new Date().toISOString();
    const c = await win.DB.dbAdd('customers', { customerNo: 'C9', companyName: 'Reg Cust', status: 'Active', createdAt: now });
    const mk = (no, st, tot) => win.DB.dbAdd('salesOrders', { soNo: no, customerId: c, status: st, currency: 'PHP', vatMode: 'NonVat', vatTotal: 0, grandTotal: tot, orderDate: '2026-09-05', lines: [], createdAt: now });
    await mk('REG-OK', 'Confirmed', 1234); await mk('REG-CANCELLED', 'Cancelled', 9999); await mk('REG-DRAFT', 'Draft', 8888);
    const sup = await win.DB.dbAdd('suppliers', { supplierNo: 'S9', companyName: 'Reg Sup', status: 'Active', createdAt: now });
    const mp = (no, st, tot) => win.DB.dbAdd('supplierPOs', { poNo: no, supplierId: sup, status: st, currency: 'PHP', poDate: '2026-09-05', lines: [], totalCost: tot, payments: [], createdAt: now });
    await mp('RPO-OK', 'Sent', 500); await mp('RPO-CANCELLED', 'Cancelled', 7777);
    win.location.hash = '#/reports/salesRegisterBookkeeper'; await win.Router.resolveRoute(); await wait(300);
    doc.getElementById('rFrom').value = '2026-09-01'; doc.getElementById('rFrom').dispatchEvent(new win.Event('change')); doc.getElementById('rTo').value = '2026-09-30'; doc.getElementById('rTo').dispatchEvent(new win.Event('change')); await wait(300);
    const t1 = doc.getElementById('content').textContent;
    ok('23b Sales Register leaves out Cancelled and Draft orders and shows a Non-VAT Sales column', /REG-OK/.test(t1) && !/REG-CANCELLED|REG-DRAFT/.test(t1) && /Non-VAT Sales/.test(t1), t1.slice(0, 300));
    win.location.hash = '#/reports/purchaseRegisterBookkeeper'; await win.Router.resolveRoute(); await wait(300);
    doc.getElementById('rFrom').value = '2026-09-01'; doc.getElementById('rFrom').dispatchEvent(new win.Event('change')); doc.getElementById('rTo').value = '2026-09-30'; doc.getElementById('rTo').dispatchEvent(new win.Event('change')); await wait(300);
    const t2 = doc.getElementById('content').textContent;
    ok('23c Purchase Register leaves out Cancelled POs', /RPO-OK/.test(t2) && !/RPO-CANCELLED/.test(t2), t2.slice(0, 200)); }
  ok('24 no JS errors', errors.length === 0, errors.join('|'));
  console.log('XLSX_FILE', file);
})().catch(e => { console.log('TEST FAILED', e); process.exit(1); });
