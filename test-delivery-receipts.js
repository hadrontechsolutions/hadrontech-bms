// Delivery Receipts: created on every Record Delivery, numbered, printable (no prices), signed copy, void reverses
const fs = require('fs'); const path = require('path');
const { JSDOM } = require('jsdom'); require('fake-indexeddb/auto');
let fails = 0, pass = 0; const ok = (n, c, x) => { console.log(n + ':', !!c, c ? '' : (x || '')); c ? pass++ : fails++; };
(async () => {
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'), { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const win = dom.window, doc = win.document; const errs = []; let printed = '';
  win.indexedDB = global.indexedDB; win.IDBKeyRange = global.IDBKeyRange; win.confirm = () => true; win.alert = () => {}; win.addEventListener('error', e => errs.push(e.message));
  win.open = () => ({ document: { open() {}, write(h) { printed = h; }, close() {} }, focus() {}, print() {} });
  for (const s of [...doc.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => s !== 'js/app.js')) win.eval(fs.readFileSync(path.join(__dirname, s), 'utf8'));
  const wait = ms => new Promise(r => setTimeout(r, ms)); const DB = win.DB; const go = async h => { win.location.hash = h; await win.Router.resolveRoute(); await wait(300); };
  await DB.openDB(); await DB.ensureCounters(); const today = win.todayISO(), now = new Date().toISOString();
  ok('1 sidebar has Delivery Receipts between Supplier POs and Payments', (() => { const t = [...doc.querySelectorAll('.nav-link')].map(a => a.textContent.trim()); const i = t.findIndex(x => /Delivery Receipts/.test(x)); return i > 0 && /Supplier POs/.test(t[i - 1]) && /Payments/.test(t[i + 1]); })());
  const cust = await DB.dbAdd('customers', { customerNo: 'C1', companyName: 'KEYEC', contactPerson: 'Ana', shippingAddress: 'Warehouse 5, Cebu', status: 'Active', archived: false });
  const cpo = await DB.dbAdd('customerPOs', { poNo: 'CPO-1', customerPoNumber: 'KEY-PO-77', customerId: cust, status: 'Open', createdAt: now });
  const prod = await DB.dbAdd('products', { itemNo: 'ITEM-1', name: 'Pump', status: 'Active', archived: false });
  await DB.dbAdd('stockMovements', { productId: prod, type: 'Receipt', qty: 10, date: today, reference: 'seed', createdAt: now });
  const mkLine = (id, d, qty, item) => ({ lineId: id, description: d, qty, uom: 'pc', unitPrice: 500, unitCost: 300, itemId: item || '', brand: 'Acme', modelNo: 'M-' + id, deliveredQty: 0, discountPercent: 0, vatRate: 0 });
  const so = await DB.dbAdd('salesOrders', { soNo: 'HT-SO-1', customerId: cust, customerPOId: cpo, status: 'Confirmed', orderDate: today, currency: 'PHP', shippingAddress: 'Warehouse 5, Cebu', lines: [mkLine('L1', 'Pump', 4, prod), mkLine('L2', 'Hose', 2)], subtotal: 3000, grandTotal: 3000, createdAt: now, updatedAt: now, statusHistory: [] });
  await go('#/sales-orders/' + so);
  ok('2 SO page has a Delivery Receipts card with an empty message', /Delivery Receipts/.test(doc.getElementById('content').textContent) && /No deliveries yet/.test(doc.getElementById('content').textContent));
  doc.getElementById('btnRecordDelivery').click(); await wait(300);
  ok('3 Record Delivery form asks delivery date, delivered by, vehicle, invoice no, remarks', ['dl_date', 'dl_by', 'dl_vehicle', 'dl_inv', 'dl_remarks'].every(i => doc.getElementById(i)));
  doc.getElementById('dl_by').value = 'Juan'; doc.getElementById('dl_vehicle').value = 'LBC 12345'; doc.getElementById('dl_inv').value = 'SI-0099'; doc.getElementById('dl_remarks').value = 'Leave at gate';
  const qs = [...doc.querySelectorAll('.deliv-qty')]; qs[0].value = '3'; qs[1].value = '2';
  doc.getElementById('btnConfirmDeliver').click(); await wait(700);
  const yr = new Date().getFullYear(); const drs = await DB.dbGetAll('deliveryReceipts'); const dr = drs[0];
  ok('4 a numbered receipt HT-DR-<year>-0001 was created', drs.length === 1 && dr.drNo === `HT-DR-${yr}-0001`, JSON.stringify(drs.map(d => d.drNo)));
  ok('5 it snapshots lines, balance, PO number, address, vehicle, invoice no', dr.lines.length === 2 && dr.lines[0].qty === 3 && dr.lines[0].balance === 1 && dr.lines[1].balance === 0 && dr.customerPoNo === 'KEY-PO-77' && dr.shippingAddress === 'Warehouse 5, Cebu' && dr.vehicle === 'LBC 12345' && dr.invoiceNo === 'SI-0099' && dr.deliveredBy === 'Juan', JSON.stringify(dr).slice(0, 300));
  ok('6 after saving it opens the receipt page', /delivery-receipts\/\d+/.test(win.location.hash) && doc.getElementById('content').textContent.includes(dr.drNo));
  const so1 = await DB.dbGet('salesOrders', so); ok('7 SO updated: Partially Delivered, deliveredQty 3 and 2', so1.status === 'Partially Delivered' && so1.lines[0].deliveredQty === 3);
  const mv = (await DB.dbGetAll('stockMovements')).filter(m => m.type === 'Delivery'); ok('8 stock went out and the movement refers to the receipt', mv.length === 1 && mv[0].qty === -3 && mv[0].reference.includes(dr.drNo), JSON.stringify(mv));
  // print
  doc.getElementById('btnPrintDR').click(); await wait(200);
  ok('9 print says Delivery Receipt with number, PO #, invoice #, customer, qty; NO prices', /Delivery Receipt/.test(printed) && printed.includes(dr.drNo) && printed.includes('KEY-PO-77') && printed.includes('SI-0099') && printed.includes('KEYEC') && printed.includes('Warehouse 5') && !/500\.00|₱|Unit Price|Amount/.test(printed.replace(/<style[\s\S]*?<\/style>/, '')), printed.slice(0, 50));
  ok('10 print has the "good order and condition" line and a customer signature box', /good order and condition/.test(printed) && /Received by \(customer\)/.test(printed));
  // signed copy
  doc.getElementById('btnSigned').click(); await wait(50); doc.getElementById('drSaveSigned').click(); await wait(100);
  ok('12 signed copy needs the name', (await DB.dbGet('deliveryReceipts', dr.id)).status === 'Issued');
  doc.getElementById('dr_receivedBy').value = 'Ana Cruz'; doc.getElementById('drSaveSigned').click(); await wait(300);
  ok('13 marking signed copy received sets status + name', (await DB.dbGet('deliveryReceipts', dr.id)).status === 'Signed copy received' && /Ana Cruz/.test(doc.getElementById('content').textContent));
  // SO page lists it
  await go('#/sales-orders/' + so); ok('14 SO page lists the receipt with a link', !!doc.querySelector(`#content a[href="#/delivery-receipts/${dr.id}"]`));
  // second (final) delivery -> second number
  doc.getElementById('btnRecordDelivery').click(); await wait(300); doc.getElementById('btnConfirmDeliver').click(); await wait(700);
  const drs2 = await DB.dbGetAll('deliveryReceipts'); ok('15 the second (partial) delivery gets its own number 0002 and SO is Delivered', drs2.length === 2 && drs2[1].drNo === `HT-DR-${yr}-0002` && (await DB.dbGet('salesOrders', so)).status === 'Delivered', JSON.stringify(drs2.map(d => d.drNo)));
  // list + search
  await go('#/delivery-receipts'); ok('16 list shows both receipts', doc.getElementById('content').textContent.includes(dr.drNo) && doc.getElementById('content').textContent.includes(drs2[1].drNo));
  const sb = doc.getElementById('listSearch'); sb.value = 'SI-0099'; sb.dispatchEvent(new win.Event('input')); await wait(50); ok('17 list search by invoice no finds it', doc.getElementById('drWrap').textContent.includes(dr.drNo) && !doc.getElementById('drWrap').textContent.includes(drs2[1].drNo));
  // SO cannot be deleted
  await go('#/sales-orders/' + so); doc.getElementById('btnDelete').click(); await wait(200); ok('18 a Sales Order with receipts cannot be deleted', !!(await DB.dbGet('salesOrders', so)));
  // void second -> SO back to Partially Delivered and stock returned
  await go('#/delivery-receipts/' + drs2[1].id); doc.getElementById('btnVoidDR').click(); await wait(50); doc.getElementById('drConfirmVoid').click(); await wait(100);
  ok('19 void needs a reason', (await DB.dbGet('deliveryReceipts', drs2[1].id)).status !== 'Voided');
  doc.getElementById('dr_reason').value = 'Entered by mistake'; doc.getElementById('drConfirmVoid').click(); await wait(600);
  const so2 = await DB.dbGet('salesOrders', so);
  ok('20 voiding the 2nd receipt puts its 1 Pump back (Pump 3 of 4, Hose still 2) and SO is Partially Delivered', so2.status === 'Partially Delivered' && so2.lines[0].deliveredQty === 3 && so2.lines[1].deliveredQty === 2, JSON.stringify(so2.lines.map(l => l.deliveredQty)) + so2.status);
  ok('21 receipt shows Voided with reason and no print button', (await DB.dbGet('deliveryReceipts', drs2[1].id)).status === 'Voided' && /Entered by mistake/.test(doc.getElementById('content').textContent) && !doc.getElementById('btnPrintDR'));
  const stock = (await DB.dbGetAll('stockMovements')).reduce((s, m) => s + m.qty, 0); ok('22 stock: 10 received - 3 delivered = 7 on hand after the void', stock === 7, stock);
  // backup / search
  ok('23 backup includes the store and a CSV export exists', fs.readFileSync(path.join(__dirname, 'js/backup.js'), 'utf8').includes("'deliveryReceipts'") && /deliveryReceipts: \[\{ label: 'Receipt No'/.test(fs.readFileSync(path.join(__dirname, 'js/backup.js'), 'utf8')));
  ok('no script errors', errs.length === 0, errs.join('|'));
  console.log(`${pass} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
})();
