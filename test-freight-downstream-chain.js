const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
require('fake-indexeddb/auto');
const APP = __dirname;
async function main() {
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const win = dom.window; const doc = win.document;
  win.indexedDB = global.indexedDB; win.IDBKeyRange = global.IDBKeyRange; win.confirm = () => true;
  for (const src of [...doc.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => s !== 'js/app.js')) win.eval(fs.readFileSync(path.join(APP, src), 'utf8'));
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const fire = (el, v, ev = 'input') => { if (v !== undefined) el.value = v; el.dispatchEvent(new win.Event(ev)); };
  const near = (a, b) => Math.abs(a - b) < 0.005;
  const go = async (h, ms = 100) => { win.location.hash = h; await win.Router.resolveRoute(); await wait(ms); };
  await win.DB.openDB(); await win.DB.ensureCounters();
  const custId = await win.DB.dbAdd('customers', { customerNo: 'C1', companyName: 'KEYEC', status: 'Active', createdAt: new Date().toISOString() });
  const supId = await win.DB.dbAdd('suppliers', { supplierNo: 'S1', companyName: 'HK Supplier', status: 'Active', createdAt: new Date().toISOString() });

  // Quotation: 10 pumps, USD 100, total freight USD 80, rate 64, markup 25%  (=> 86,400)
  await go('#/quotations/new');
  let row = doc.querySelector('#linesBody tr');
  fire(row.querySelector('.ln-desc'), 'Pump'); fire(row.querySelector('.ln-qty'), '10');
  fire(row.querySelector('.ln-costccy'), 'USD', 'change'); await wait(30);
  row = doc.querySelector('#linesBody tr');
  fire(row.querySelector('.ln-rate'), '64'); fire(row.querySelector('.ln-cost'), '100'); fire(row.querySelector('.ln-markup'), '25'); fire(row.querySelector('.ln-freight'), '80');
  fire(row.querySelector('.ln-supplier'), String(supId), 'change'); await wait(30);
  fire(doc.getElementById('f_customerId'), String(custId), 'change');
  doc.getElementById('qForm').dispatchEvent(new win.Event('submit', { cancelable: true })); await wait(150);
  const q = (await win.DB.dbGetAll('quotations'))[0];
  const qt = win.QuoteCalc.computeQuotationTotals(q);
  console.log('1 Quotation: total 86,400, cost 69,120, GP 17,280:', near(q.grandTotal, 86400) && near(qt.costTotal, 69120) && near(qt.grossProfit, 17280));
  q.status = 'Won'; await win.DB.dbPut('quotations', q);

  // Customer PO from quotation
  await go('#/customer-pos/new?quotationId=' + q.id);
  fire(doc.getElementById('f_customerId'), String(custId), 'change');
  doc.getElementById('cpoForm').dispatchEvent(new win.Event('submit', { cancelable: true })); await wait(150);
  const cpo = (await win.DB.dbGetAll('customerPOs'))[0];
  console.log('2 Customer PO amount = 86,400:', !!cpo && near(cpo.poAmount, 86400), cpo && cpo.poAmount);

  // Sales Order
  await go('#/customer-pos/' + cpo.id);
  doc.getElementById('btnConvert').click(); await wait(150);
  const so = (await win.DB.dbGetAll('salesOrders'))[0];
  console.log('3 Sales Order exists, total 86,400:', !!so && near(so.grandTotal, 86400), so && so.grandTotal);
  const l0 = so.lines[0];
  console.log('4 SO line carries freight model intact (total mode, 80, qty 10):', l0.freightMode === 'total' && l0.estimatedFreightCost === 80 && l0.qty === 10);
  const sc = win.QuoteCalc.computeLine(l0, so.currency);
  console.log('5 SO line revenue 86,400 and cost 69,120 (GP 17,280, same as quotation):', near(sc.net, 86400) && near(sc.costTotal, 69120));
  console.log('6 Distributions GP for this SO = 17,280:', typeof win.soGrossProfit === 'function' ? near(win.soGrossProfit(so), 17280) : 'n/a (not global)');

  // SO detail page + edit page render without errors / NaN
  await go('#/sales-orders/' + so.id);
  console.log('7 SO detail renders, no NaN/undefined:', !/NaN|undefined/.test(doc.getElementById('content').textContent));
  await go('#/sales-orders/' + so.id + '/edit');
  console.log('8 SO edit renders, no NaN/undefined:', !/NaN|undefined/.test(doc.getElementById('content').textContent));

  // Supplier PO from SO: supplier is paid the item cost (qty x unit cost), freight is not part of the PO
  await win.SupplierPOs.createFromSalesOrder(so, supId, so.lines.map(l => Object.assign({}, l, { supplierId: supId })));
  await wait(100);
  const spo = (await win.DB.dbGetAll('supplierPOs'))[0];
  console.log('9 Supplier PO total = USD 1,000 (10 x 100), unchanged by freight model:', !!spo && near(spo.totalCost, 1000), spo && spo.totalCost);
  spo.payments = [{ amount: 400, date: new Date().toISOString() }]; await win.DB.dbPut('supplierPOs', spo);
  console.log('10 Supplier PO payment math: paid 400, balance 600:', near(win.SupplierPOs.spoAmountPaid(spo), 400) && near(win.SupplierPOs.spoBalanceDue(spo), 600));
  await go('#/supplier-pos/' + spo.id);
  console.log('11 Supplier PO detail renders, no NaN/undefined:', !/NaN|undefined/.test(doc.getElementById('content').textContent));
  await go('#/customer-pos/' + cpo.id);
  console.log('12 Customer PO detail renders, no NaN/undefined:', !/NaN|undefined/.test(doc.getElementById('content').textContent));
}
main().catch(e => { console.log('TEST FAILED', e); process.exit(1); });
