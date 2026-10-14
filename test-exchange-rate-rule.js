// One exchange-rate rule for Supplier POs: PO rate -> Settings rate -> none. Every screen/report agrees; old POs get filled in.
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
  const setRates = async (r) => { const st = await DB.getSettings(); st.referenceRates = r; await DB.dbPut('settings', st); };
  await setRates({ USD: 64, EUR: 73, HKD: 9 });
  ok('1 rule: PO rate wins; else Settings; else none; PHP is 1', (() => { const st = { referenceRates: { HKD: 9 } }; const a = win.poRateInfo({ currency: 'HKD', exchangeRate: 8.5 }, st), b = win.poRateInfo({ currency: 'HKD' }, st), c = win.poRateInfo({ currency: 'SGD' }, st), d = win.poRateInfo({ currency: 'PHP' }, st); return a.rate === 8.5 && a.source === 'po' && b.rate === 9 && b.source === 'settings' && c.rate === 0 && c.source === 'none' && d.rate === 1; })());
  const cust = await DB.dbAdd('customers', { customerNo: 'C1', companyName: 'KEYEC', status: 'Active', archived: false });
  const sup = await DB.dbAdd('suppliers', { supplierNo: 'S1', companyName: 'MyProjectorLamps', status: 'Active', archived: false });
  const so = await DB.dbAdd('salesOrders', { soNo: 'HT-SO-A', customerId: cust, status: 'Delivered', orderDate: today, currency: 'PHP', lines: [{ lineId: 'L1', description: 'Lamp', qty: 1, uom: 'pc', unitPrice: 21335.15, unitCost: 14314, deliveredQty: 1, discountPercent: 0, vatRate: 0 }], subtotal: 21335.15, vatTotal: 0, grandTotal: 21335.15, createdAt: now, updatedAt: now, statusHistory: [] });
  await DB.dbAdd('proformaInvoices', { piNo: 'PI-A', salesOrderId: so, date: today, currency: 'PHP', grandTotal: 21335.15, vatTotal: 0, lines: [], payments: [{ id: 'a', date: today, amount: 21335.15 }] });
  // old PO: HKD, NO rate on the PO, one payment with no rate at all (the PO-0007 situation)
  const old = await DB.dbAdd('supplierPOs', { poNo: 'HT-PO-0007', salesOrderId: so, supplierId: sup, currency: 'HKD', totalCost: 5000, status: 'Sent', poDate: today, lines: [], lineIds: [], payments: [{ id: 'p1', date: today, amount: 1324 }], createdAt: now });
  await go('#/supplier-pos/' + old);
  ok('2 PO page: amber "from Settings — not saved on this PO" with 9.0000 (not the red Not set)', /9\.0000/.test(txt()) && !!doc.querySelector('.rate-from-settings') && !doc.querySelector('.cell-needs-input'), doc.querySelector('.detail-grid').textContent.slice(0, 300));
  ok('3 Payment History values the rate-less payment at 1,324 x 9 = 11,916.00 (estimated), not 0.00', /11,916\.00/.test(txt()) && /estimated rate/.test(txt()) && /from Settings/.test(txt()));
  const data = await win.OrderProfit.loadData(); const r1 = win.OrderProfit.compute(data, {}).rows[0];
  const bp = win.BookkeeperPack.buildPack({ from: '2000-01-01', to: '2100-01-01', data: await win.BookkeeperPack.loadData() }); const disb = (bp.disbursements || []).find(d => /HT-PO-0007/.test(JSON.stringify(d)));
  ok('4 Payment History, Order Profit and Bookkeeper Pack all value it at 11,916.00', win.SupplierPOs.spoPaymentPHP(data.supplierPOs[0], data.supplierPOs[0].payments[0], data.settings).php === 11916 && r1.supplierLines[0].paidPHP === 11916 && r1.supplierLines[0].computedPHP === 45000 && disb && Math.abs(disb.phpAmount - 11916) < 0.01, JSON.stringify([r1.supplierLines[0], disb && disb.phpAmount]));
  ok('5 Order Profit: no "no exchange rate" warning (Settings has HKD)', !r1.warnings.some(w => /exchange rate/.test(w)));
  doc.getElementById('btnRecordPaymentSPO').click(); await wait(100);
  ok('6 Record Payment: estimated-rate box starts at the Settings rate 9', Number(doc.getElementById('spo_pay_rate').value) === 9);
  await go('#/supplier-pos/' + old); doc.getElementById('btnEditHeader').click(); await wait(200);
  ok('7 Edit / Revise PO: rate box is pre-filled with 9 (so it can be saved)', Number(doc.getElementById('f_exchangeRate').value) === 9);
  // migration
  const withRate = await DB.dbAdd('supplierPOs', { poNo: 'HT-PO-0001', supplierId: sup, currency: 'USD', exchangeRate: 58, exchangeRateSource: 'Quotation X', totalCost: 10, status: 'Sent', lines: [], lineIds: [], payments: [], createdAt: now });
  const phpPO = await DB.dbAdd('supplierPOs', { poNo: 'HT-PO-0002', supplierId: sup, currency: 'PHP', exchangeRate: 1, totalCost: 10, status: 'Sent', lines: [], lineIds: [], payments: [], createdAt: now });
  const sgd = await DB.dbAdd('supplierPOs', { poNo: 'HT-PO-0003', supplierId: sup, currency: 'SGD', totalCost: 10, status: 'Sent', lines: [], lineIds: [], payments: [], createdAt: now });
  const bpBefore = win.BookkeeperPack.buildPack({ from: '2000-01-01', to: '2100-01-01', data: await win.BookkeeperPack.loadData() });
  ok('8 before the clean-up the Bookkeeper Pack warns about POs with no saved rate', (bpBefore.warnings || []).some(w => /no exchange rate saved/.test(w.text)));
  const n = await win.SupplierPOs.fillMissingRates();
  const o2 = await DB.dbGet('supplierPOs', old);
  ok('9 clean-up fills only PO-0007 (HKD) with the Settings rate and says so', n === 1 && o2.exchangeRate === 9 && /filled in automatically/.test(o2.exchangeRateSource) && (await DB.dbGet('supplierPOs', withRate)).exchangeRate === 58 && (await DB.dbGet('supplierPOs', sgd)).exchangeRate == null && (await DB.dbGet('supplierPOs', phpPO)).exchangeRate === 1, JSON.stringify([n, o2.exchangeRate, o2.exchangeRateSource]));
  ok('10 clean-up is logged and safe to run again (0 changes)', (await DB.recentActivity(10)).some(a => /HT-PO-0007/.test(JSON.stringify(a)) && /Settings HKD rate/.test(JSON.stringify(a))) && (await win.SupplierPOs.fillMissingRates()) === 0);
  await go('#/supplier-pos/' + old); ok('11 PO page now shows 9.0000 with the "filled in automatically" source, no amber/red', /9\.0000/.test(txt()) && /filled in automatically/.test(txt()) && !doc.querySelector('.rate-from-settings') && !doc.querySelector('.cell-needs-input'));
  const bpAfter = win.BookkeeperPack.buildPack({ from: '2000-01-01', to: '2100-01-01', data: await win.BookkeeperPack.loadData() });
  ok('12 the Bookkeeper warning no longer lists HT-PO-0007', !(bpAfter.warnings || []).some(w => /no exchange rate saved/.test(w.text) && /HT-PO-0007/.test(w.text)));
  // no rate anywhere
  await setRates({ USD: 64 });
  await go('#/supplier-pos/' + sgd); ok('13 no rate on the PO and none in Settings, with money unpaid: RED "Not set — add the currency in Settings or Edit / Revise PO"', !!doc.querySelector('.cell-needs-input') && /Not set — add the currency/.test(txt()));
  const paidNoRate = await DB.dbAdd('supplierPOs', { poNo: 'HT-PO-0004', supplierId: sup, currency: 'SGD', totalCost: 100, status: 'Received', lines: [], lineIds: [], payments: [{ id: 'z', date: today, amount: 100, phpAmount: 4000, exchangeRate: 40 }], createdAt: now });
  await go('#/supplier-pos/' + paidNoRate); ok('14 fully paid with the actual PHP entered and no PO rate: neutral "Not needed", not red', /Not needed — fully paid, actual PHP entered/.test(txt()) && !doc.querySelector('.cell-needs-input'));
  const d2 = await win.OrderProfit.loadData(); const sgdRow = d2.supplierPOs.find(p => p.id === sgd);
  ok('15 a rate-less foreign PO with no Settings rate gives a clear Order Profit warning', (() => { const so2 = { id: 999, soNo: 'X', status: 'Delivered', orderDate: today, currency: 'PHP', lines: [], grandTotal: 1, vatTotal: 0 }; const r = win.OrderProfit.compute({ salesOrders: [so2], supplierPOs: [Object.assign({}, sgdRow, { salesOrderId: 999, payments: [{ id: 'q', amount: 5 }] })], proformaInvoices: [], expenses: [], customers: [], settings: d2.settings }, {}).rows[0]; return r && r.warnings.some(w => /no exchange rate saved and none in Settings/.test(w)); })());
  ok('no script errors', errs.length === 0, errs.join('|'));
  console.log(`${pass} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
})();
