/* Per-document exchange rate on Supplier POs, payment-day rate, supplier invoice no., official (BIR) invoice no. on the Proforma Invoice. */
const fs = require('fs'); const path = require('path');
const { JSDOM } = require('jsdom'); require('fake-indexeddb/auto');
const APP = __dirname;
(async () => {
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const win = dom.window; const doc = win.document;
  win.indexedDB = global.indexedDB; win.IDBKeyRange = global.IDBKeyRange; win.confirm = () => true; win.alert = () => {}; win.prompt = () => 'x';
  const errors = []; win.addEventListener('error', e => errors.push(e.message)); win.console.error = (...a) => errors.push(a.join(' '));
  for (const src of [...doc.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => s !== 'js/app.js')) win.eval(fs.readFileSync(path.join(APP, src), 'utf8'));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const ok = (n, c, x) => console.log(n + ':', !!c, c ? '' : (x === undefined ? '' : x));
  const set = (id, v) => { const e = doc.getElementById(id); e.value = v; e.dispatchEvent(new win.Event('input')); e.dispatchEvent(new win.Event('change')); };
  await win.DB.openDB(); await win.DB.ensureCounters();
  const now = new Date().toISOString();
  const s = await win.DB.getSettings(); s.referenceRates = { USD: 58 }; await win.DB.dbPut('settings', s).catch(() => {});
  const supId = await win.DB.dbAdd('suppliers', { supplierNo: 'S1', companyName: 'US Co', currency: 'USD', status: 'Active', createdAt: now });
  const cId = await win.DB.dbAdd('customers', { customerNo: 'C1', companyName: 'Cust', status: 'Active', createdAt: now });
  const soId = await win.DB.dbAdd('salesOrders', { soNo: 'SO-T', customerId: cId, status: 'Confirmed', currency: 'PHP', lines: [], grandTotal: 1000, orderDate: '2026-09-05', createdAt: now });
  const so = await win.DB.dbGet('salesOrders', soId);
  await win.SupplierPOs.createFromSalesOrder(so, supId, [{ lineId: 'L1', description: 'Pump', qty: 2, uom: 'pc', unitCost: 50, costCurrency: 'USD' }]);
  const id = (await win.DB.dbGetAll('supplierPOs')).find(p => p.supplierId === supId).id;
  let po = await win.DB.dbGet('supplierPOs', id);
  ok('1 new USD PO snapshots the rate (58) and its source', po.exchangeRate === 58 && /Settings/.test(po.exchangeRateSource), JSON.stringify(po));
  const s2 = await win.DB.getSettings(); s2.referenceRates = { USD: 61 }; await win.DB.dbPut('settings', s2);
  po = await win.DB.dbGet('supplierPOs', id);
  ok('2 later Settings change (61) does not touch the PO rate', po.exchangeRate === 58);
  // edit form: invoice no + date + rate
  win.location.hash = '#/supplier-pos/' + id; await win.Router.resolveRoute(); await wait(300);
  ok('3 detail shows exchange rate 58.0000', /58\.0000/.test(doc.getElementById('content').textContent));
  doc.getElementById('btnEditHeader').click(); await wait(300);
  ok('4 edit form has rate + supplier invoice fields prefilled', doc.getElementById('f_exchangeRate').value === '58' && !!doc.getElementById('f_supplierInvoiceNo'));
  set('f_exchangeRate', '0'); doc.getElementById('spoForm').dispatchEvent(new win.Event('submit', { cancelable: true })); await wait(200);
  po = await win.DB.dbGet('supplierPOs', id);
  ok('5 rate of 0 is refused', po.exchangeRate === 58);
  set('f_exchangeRate', '57'); set('f_supplierInvoiceNo', 'INV-77'); set('f_supplierInvoiceDate', '2026-09-08');
  doc.getElementById('spoForm').dispatchEvent(new win.Event('submit', { cancelable: true })); await wait(400);
  po = await win.DB.dbGet('supplierPOs', id);
  ok('6 saved: rate 57, invoice INV-77 / 2026-09-08', po.exchangeRate === 57 && po.supplierInvoiceNo === 'INV-77' && po.supplierInvoiceDate === '2026-09-08', JSON.stringify([po.exchangeRate, po.supplierInvoiceNo]));
  // payment with its own rate
  win.location.hash = '#/supplier-pos/' + id; await win.Router.resolveRoute(); await wait(300);
  doc.getElementById('btnRecordPaymentSPO').click(); await wait(100);
  ok('7 payment form defaults the rate to the PO rate', doc.getElementById('spo_pay_rate').value === '57');
  set('spo_pay_rate', '58.5'); doc.getElementById('btnConfirmPaymentSPO').click(); await wait(400);
  po = await win.DB.dbGet('supplierPOs', id);
  ok('8 payment stores its own rate 58.5', po.payments.length === 1 && po.payments[0].exchangeRate === 58.5, JSON.stringify(po.payments));
  // PHP supplier: no rate field
  const sup2 = await win.DB.dbAdd('suppliers', { supplierNo: 'S2', companyName: 'PH Co', currency: 'PHP', status: 'Active', createdAt: now });
  await win.SupplierPOs.createFromSalesOrder(so, sup2, [{ lineId: 'L1', description: 'x', qty: 1, uom: 'pc', unitCost: 10 }]);
  const po2 = (await win.DB.dbGetAll('supplierPOs')).find(p => p.supplierId === sup2);
  ok('9 PHP PO has rate 1', po2.exchangeRate === 1);
  // PI official invoice
  const piId = await win.DB.dbAdd('proformaInvoices', { piNo: 'PI-T', salesOrderId: soId, date: '2026-09-06', currency: 'PHP', grandTotal: 1000, vatTotal: 0, payments: [], lines: [], createdAt: now });
  win.location.hash = '#/proforma-invoices/' + piId; await win.Router.resolveRoute(); await wait(400);
  set('piOfficialNo', 'SI-000555'); set('piOfficialDate', '2026-09-06'); doc.getElementById('btnSaveOfficial').click(); await wait(300);
  const pi = await win.DB.dbGet('proformaInvoices', piId);
  ok('10 official invoice no./date saved on the PI', pi.officialInvoiceNo === 'SI-000555' && pi.officialInvoiceDate === '2026-09-06');
  win.location.hash = '#/proforma-invoices/' + piId; await win.Router.resolveRoute(); await wait(400);
  ok('11 detail shows the Official Invoice No.', /SI-000555/.test(doc.getElementById('content').textContent));
  ok('12 no JS errors', errors.length === 0, errors.join('|'));
})().catch(e => { console.log('TEST FAILED', e); process.exit(1); });
