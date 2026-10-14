// Supplier PO payments: type the ACTUAL PHP paid; computed (PO rate) vs actual shown; correction; Order Profit uses it
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
  const cust = await DB.dbAdd('customers', { customerNo: 'C1', companyName: 'KEYEC', status: 'Active', archived: false });
  const sup = await DB.dbAdd('suppliers', { supplierNo: 'S1', companyName: 'MyProjectorLamps', status: 'Active', archived: false });
  const so = await DB.dbAdd('salesOrders', { soNo: 'HT-SO-A', customerId: cust, status: 'Delivered', orderDate: today, currency: 'PHP', lines: [{ lineId: 'L1', description: 'Lamp', qty: 1, uom: 'pc', unitPrice: 21335.15, unitCost: 14314, deliveredQty: 1, discountPercent: 0, vatRate: 0 }], subtotal: 21335.15, vatTotal: 0, grandTotal: 21335.15, createdAt: now, updatedAt: now, statusHistory: [] });
  await DB.dbAdd('proformaInvoices', { piNo: 'PI-A', salesOrderId: so, date: today, currency: 'PHP', grandTotal: 21335.15, vatTotal: 0, lines: [], payments: [{ id: 'a', date: today, amount: 21335.15 }] });
  const poPHP = await DB.dbAdd('supplierPOs', { poNo: 'HT-PO-0006', salesOrderId: so, supplierId: sup, currency: 'PHP', exchangeRate: 1, totalCost: 928, status: 'Received', lines: [], lineIds: [], payments: [{ id: 'q', date: today, amount: 928, exchangeRate: 1 }], createdAt: now });
  const poHKD = await DB.dbAdd('supplierPOs', { poNo: 'HT-PO-0007', salesOrderId: so, supplierId: sup, currency: 'HKD', exchangeRate: 9, totalCost: 1324, status: 'Sent', lines: [], lineIds: [], payments: [], createdAt: now });
  await DB.dbAdd('expenses', { expenseNo: 'HT-EXP-1', date: today, category: 'Import Duties & Brokerage', description: 'UPS', amount: 482.95, salesOrderId: so, soNo: 'HT-SO-A', status: 'Recorded', createdAt: now });
  // 1 PHP PO: no PHP field
  await go('#/supplier-pos/' + poPHP); doc.getElementById('btnRecordPaymentSPO').click(); await wait(100);
  ok('1 a PHP Supplier PO has no extra PHP / rate fields', !doc.getElementById('spo_pay_php') && !doc.getElementById('spo_pay_rate'));
  // 2 HKD PO: PHP field present; type actual
  await go('#/supplier-pos/' + poHKD); doc.getElementById('btnRecordPaymentSPO').click(); await wait(100);
  ok('2 a HKD PO asks for the Actual amount paid in PHP (and an estimate rate that is only a fallback)', !!doc.getElementById('spo_pay_php') && /only used if you leave the PHP amount blank/.test(txt()));
  doc.getElementById('spo_pay_php').value = '10776.92'; doc.getElementById('spo_pay_php').oninput(); ok('3 live hint shows the real rate 8.1397 and the estimate', /8\.1397/.test(doc.getElementById('spo_pay_rate_hint').textContent) && /11,916\.00/.test(doc.getElementById('spo_pay_rate_hint').textContent), doc.getElementById('spo_pay_rate_hint').textContent);
  doc.getElementById('btnConfirmPaymentSPO').click(); await wait(500);
  let po = await DB.dbGet('supplierPOs', poHKD); const p0 = po.payments[0];
  ok('4 payment saved with phpAmount 10,776.92 and derived rate (not the estimate 9)', p0.phpAmount === 10776.92 && Math.abs(p0.exchangeRate - 10776.92 / 1324) < 1e-9 && po.payments.length === 1, JSON.stringify(p0));
  ok('5 history shows actually paid PHP and the rate; no estimated tag; computed vs actual line (11,916.00 vs 10,776.92, diff -1,139.08)', /10,776\.92/.test(txt()) && /8\.1397/.test(txt()) && !/estimated rate\b[^s]/.test(doc.querySelector('#content table').textContent) && /11,916\.00/.test(txt()) && /-1,139\.08|-₱1,139\.08|₱-1,139\.08/.test(txt()), txt().match(/Computed at the PO[\s\S]{0,200}/));
  // 6 estimated payment flagged
  await DB.dbPut('supplierPOs', Object.assign(await DB.dbGet('supplierPOs', poHKD), { payments: [{ id: 'est1', date: today, amount: 1324, exchangeRate: 9, method: 'Bank Transfer', createdBy: 'x' }] }));
  await go('#/supplier-pos/' + poHKD);
  ok('6 a payment with no actual PHP is flagged "estimated rate" and offers "Enter actual PHP"', /estimated rate/.test(txt()) && /11,916\.00/.test(txt()) && !!doc.querySelector('[data-correct-pay="est1"]') && /Enter actual PHP/.test(doc.querySelector('[data-correct-pay="est1"]').textContent) && /still on the estimated rate/.test(txt()));
  // Order Profit before correction
  let res = win.OrderProfit.compute(await win.OrderProfit.loadData(), {}); let r = res.rows[0];
  ok('7 Order Profit before: suppliers computed 12,844.00 and actual 12,844.00 but NOT confirmed; profit 8,008.20', r.suppliersComputed === 12844 && r.suppliersCost === 12844 && !r.costConfirmed && r.actualProfit === 8008.2, JSON.stringify([r.suppliersComputed, r.suppliersCost, r.costConfirmed, r.actualProfit]));
  await go('#/order-profit'); ok('8 list shows computed vs actual cost and the "not confirmed" tag', /Cost at PO rates \(computed\)/.test(txt()) && /not confirmed/.test(txt()) && /13,326\.95/.test(txt()));
  // 9 correct it
  await go('#/supplier-pos/' + poHKD); doc.querySelector('[data-correct-pay="est1"]').click(); await wait(100);
  doc.getElementById('cp_php').value = '10776.92'; doc.getElementById('cp_save').click(); await wait(500);
  po = await DB.dbGet('supplierPOs', poHKD); const pc = po.payments[0];
  ok('9 correction stores the actual PHP, new rate, who/when, and keeps the old estimate in its history', pc.phpAmount === 10776.92 && Math.abs(pc.exchangeRate - 8.13969) < 1e-4 && pc.correctedAt && pc.history.length === 1 && pc.history[0].estimated === true && pc.history[0].phpAmount === 11916, JSON.stringify(pc));
  ok('10 correction is in the activity log', (await DB.recentActivity(10)).some(a => /HT-PO-0007/.test(a.description || a.text || JSON.stringify(a)) && /10,776\.92/.test(JSON.stringify(a))));
  ok('11 history now shows the corrected line with no estimated tag', /Corrected/.test(txt()) && !doc.querySelector('#content .cost-tag'));
  // Order Profit after
  res = win.OrderProfit.compute(await win.OrderProfit.loadData(), {}); r = res.rows[0];
  ok('12 Order Profit after: actual supplier cost 11,704.92, actual cost 12,187.87, profit 9,147.28, confirmed; computed cost still 13,326.95', r.suppliersCost === 11704.92 && r.actualCost === 12187.87 && r.actualProfit === 9147.28 && r.costConfirmed && r.computedCost === 13326.95, JSON.stringify([r.suppliersCost, r.actualCost, r.actualProfit, r.costConfirmed, r.computedCost]));
  await go('#/order-profit/' + so); ok('13 detail page shows computed vs actually paid and "this is the actual cost"', /Computed in PHP/.test(txt()) && /10,776\.92/.test(txt()) && /11,916\.00/.test(txt()) && /this is the actual cost/.test(txt()) && /9,147\.28/.test(txt()));
  await go('#/order-profit'); ok('14 list: no red "not confirmed" tag any more', ![...doc.querySelectorAll('#opWrap .cost-tag')].some(t => /not confirmed/.test(t.textContent)));
  // bookkeeper uses the real PHP
  const bp = win.BookkeeperPack.buildPack({ from: today.slice(0, 7) + '-01', to: today.slice(0, 7) + '-31', data: await win.BookkeeperPack.loadData() });
  const row = (bp.disbursements || []).find(x => /HT-PO-0007/.test(JSON.stringify(x))); ok('15 Bookkeeper Pack records that supplier payment at the actual PHP (10,776.92)', row && Math.abs(row.phpAmount - 10776.92) < 0.01, JSON.stringify(row));
  const rep = win.OwnerReport.buildOwnerReport({ from: today.slice(0, 7) + '-01', to: today.slice(0, 7) + '-31', data: await win.OwnerReport.loadData() }); const sh = win.OwnerReport.buildSheets(rep, win.BookkeeperPack.company(rep.pack ? {} : {})).find(x => x.name === 'Order Profit');
  ok('16 Business Performance Report sheet has the computed-cost column and the same totals', JSON.stringify(sh.rows).includes('Cost at PO rates (computed)') && rep.orderProfit.totals.computedCost === 13326.95 && rep.orderProfit.totals.actualCost === 12187.87);
  ok('no script errors', errs.length === 0, errs.join('|'));
  console.log(`${pass} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
})();
