/* Business Owner Report: figures, comparison with previous period, pipeline, orders, customers, trend, real xlsx, page, merged menu. */
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
  const OR = win.OwnerReport, BP = win.BookkeeperPack;
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
  const today = win.todayISO();
  const quotations = [
    { id: 1, quotationNo: 'Q-1', isLatest: true, customerId: 1, date: '2026-09-02', status: 'Won', currency: 'PHP', grandTotal: 10000, netSubtotal: 10000, grossProfit: 2500, grossMarginPercent: 25 },
    { id: 2, quotationNo: 'Q-2', isLatest: true, customerId: 1, date: '2026-09-05', status: 'Lost', currency: 'PHP', grandTotal: 6000, netSubtotal: 6000, grossProfit: 1000 },
    { id: 3, quotationNo: 'Q-3', isLatest: true, customerId: 2, date: '2026-09-07', status: 'Sent', currency: 'PHP', grandTotal: 4000, netSubtotal: 4000, grossProfit: 800, validUntil: '2020-01-01' },
    { id: 4, quotationNo: 'Q-4', isLatest: true, customerId: 2, date: '2026-08-07', status: 'Won', currency: 'PHP', grandTotal: 99999, netSubtotal: 99999, grossProfit: 9999 }
  ];
  data.quotations = quotations;
  const rep = OR.buildOwnerReport({ from: '2026-09-01', to: '2026-09-30', data });
  ok('1 headline: invoiced 30,000, collected 25,000 (same as the Bookkeeper Pack)', near(rep.kpis[0].value, 30000) && near(rep.kpis[1].value, 25000), JSON.stringify(rep.kpis.slice(0, 2)));
  ok('2 previous period = 2026-08-02..2026-08-31 (same length, directly before)', rep.prevFrom === '2026-08-02' && rep.prevTo === '2026-08-31', rep.prevFrom + ' ' + rep.prevTo);
  ok('3 previous-period invoiced = PI-4 8,000; change +275%', near(rep.kpis[0].prev, 8000) && rep.kpis[0].change === 275, JSON.stringify(rep.kpis[0]));
  ok('4 pipeline: 3 quotes in Sept; won 1 / lost 1 -> win rate 50% by count, 62.5% by value', rep.pipeline.quotedCount === 3 && rep.pipeline.winRateCount === 50 && rep.pipeline.winRateValue === 62.5, JSON.stringify(rep.pipeline.winRateCount + ' ' + rep.pipeline.winRateValue));
  ok('5 open quotations now: Q-3 (expired, needs action)', rep.pipeline.openCount === 1 && rep.pipeline.expiredCount === 1 && rep.pipeline.needsAction.length === 1);
  ok('6 profit on won quotations in the period only: net 10,000, profit 2,500, margin 25%', near(rep.profit.net, 10000) && near(rep.profit.profitTotal, 2500) && rep.profit.margin === 25, JSON.stringify(rep.profit));
  ok('7 active orders: SO-2 (Confirmed) only — Delivered/Cancelled/Draft are not active', rep.orders.activeCount === 1 && rep.orders.rows[0].no === 'SO-2', JSON.stringify(rep.orders.rows.map(r => r.no)));
  ok('8 customers ranked by invoiced: No TIN Corp 20,000 then Key Electrochem 10,000; shares add to 100%', rep.customers[0].name === 'No TIN Corp' && near(rep.customers[0].invoiced, 20000) && near(rep.customers.reduce((s, c) => s + c.share, 0), 1), JSON.stringify(rep.customers));
  ok('9 customer outstanding adds up to receivables at period end (10,000)', near(rep.customers.reduce((s, c) => s + c.outstanding, 0), rep.totals.arClosing));
  ok('10 trend has 12 months ending Sept; Sept invoiced 30,000, Aug 8,000', rep.trend.length === 12 && rep.trend[11].month === '2026-09' && near(rep.trend[11].invoiced, 30000) && near(rep.trend[10].invoiced, 8000), JSON.stringify(rep.trend.slice(9)));
  ok('11 attention list mentions expired quotation and old unpaid invoices', rep.attention.some(a => /expired/.test(a.text)) && rep.attention.some(a => /older than 30 days|supplier PO/.test(a.text)), JSON.stringify(rep.attention));
  const co = BP.company(st); const bytes = BP.xl.workbookBytes(OR.buildSheets(rep, co)); const file = path.join(os.tmpdir(), 'owner-report-test.xlsx'); fs.writeFileSync(file, Buffer.from(bytes));
  const py = require('child_process').spawnSync('python3', ['-c', `
import openpyxl, sys
wb = openpyxl.load_workbook(sys.argv[1])
print('SHEETS|' + '|'.join(wb.sheetnames))
ws = wb['Overview']
print('ROW|' + '|'.join(str(c.value) for c in ws[7]))
print('CUST|' + '|'.join(str(c.value) for c in wb['Customers'][6]))
`, file], { encoding: 'utf8' });
  const pick = (k) => ((py.stdout || '').split('\n').find(l => l.startsWith(k + '|')) || '');
  ok('12 workbook opens with all 10 tabs', pick('SHEETS') === 'SHEETS|Overview|Sales Pipeline|Orders|Customers|Monthly Trend|Profitability|Receivables|Payables|Expenses & Cash|Notes', py.stdout + py.stderr);
  ok('13 Overview comparison table and Customers ranking are present', /Sales invoiced/.test(pick('ROW')) && /No TIN Corp/.test(pick('CUST')), pick('ROW') + pick('CUST'));
  const sum = OR.summaryHTML(rep, co); ok('14 PDF summary has period, comparison and attention, no NaN', /Business Owner Report/.test(sum) && /2026-08-02/.test(sum) && /Needs attention/.test(sum) && !/NaN|undefined/.test(sum));

  // ---- menu + page ----
  await win.DB.openDB(); await win.DB.ensureCounters();
  win.location.hash = '#/reports/ownerReport'; await win.Router.resolveRoute(); await wait(500);
  ok('15 Owner Report opens inside the Reports menu with the same left navigation', !!doc.getElementById('orXlsx') && !!doc.querySelector('.report-nav') && /Business Owner Report/.test(doc.querySelector('.report-link.active').textContent), doc.getElementById('content').textContent.slice(0, 200));
  win.location.hash = '#/reports/bookkeeperPack'; await win.Router.resolveRoute(); await wait(500);
  ok('16 Bookkeeper Pack opens inside the same menu (no banner above the page)', !!doc.getElementById('bpXlsx') && !!doc.querySelector('.report-nav') && !doc.querySelector('.bp-banner'));
  const labels = [...doc.querySelectorAll('.report-link')].map(a => a.textContent.trim());
  ok('17 menu is clean: 11 entries, no Technical Offers Log / Projected Gross Profit / merged duplicates', labels.length === 11 && !labels.some(l => /Technical|Projected|Open Quotation|Won & Lost|Expiring|Expired Quot|Awaiting|by Customer|by Month|Payments Aging/i.test(l)), labels.join(' | '));
  const hrefs = [...doc.querySelectorAll('.report-link')].map(a => a.getAttribute('href').replace('#/reports/', ''));
  let allOk = true; const bad = [];
  for (const h of hrefs) { errors.length = 0; win.location.hash = '#/reports/' + h; await win.Router.resolveRoute(); await wait(300); const tx = doc.getElementById('content').textContent; if (errors.length || /NaN|undefined|\[object/.test(tx) || !doc.querySelector('.report-link.active')) { allOk = false; bad.push(h + ':' + errors[0]); } }
  ok('18 every menu entry opens without errors and is highlighted in the menu', allOk, bad.join(' | '));
  // old links still work and pick the right view
  const legacy = { openQuotations: ['quotationRegister', 'Open'], expiredQuotations: ['quotationRegister', 'Expired'], awaitingDelivery: ['salesOrderRegister', 'Awaiting'], salesByMonth: ['salesSummary', 'month'], supplierPaymentsAging: ['agingReport', 'Payables'], expensesByCategory: ['expenseRegister', 'category'], technicalOffersLog: ['quotationRegister', ''] };
  let legOk = true; const legBad = [];
  for (const [k, [target, view]] of Object.entries(legacy)) { win.location.hash = '#/reports/' + k; await win.Router.resolveRoute(); await wait(300); const act = doc.querySelector('.report-link.active'); const sel = doc.getElementById('rStatusFilter'); if (!act || act.getAttribute('href') !== '#/reports/' + target || (view && !new RegExp(view, 'i').test(sel ? sel.value : ''))) { legOk = false; legBad.push(k + '→' + (act && act.getAttribute('href')) + ' / ' + (sel && sel.value)); } }
  ok('19 old report addresses redirect to the merged report with the right view selected', legOk, legBad.join(' | '));
  ok('20 no JS errors', errors.length === 0, errors.join('|'));
  console.log('XLSX_FILE', file);
})().catch(e => { console.log('TEST FAILED', e); process.exit(1); });
