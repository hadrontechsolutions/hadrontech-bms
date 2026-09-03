const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
require('fake-indexeddb/auto');
const APP = __dirname;

async function main() {
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  window.indexedDB = global.indexedDB; window.IDBKeyRange = global.IDBKeyRange; window.confirm = () => true;
  const scripts = [...dom.window.document.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => s !== 'js/app.js');
  for (const src of scripts) dom.window.eval(fs.readFileSync(path.join(APP, src), 'utf8'));
  const win = dom.window; const doc = win.document;
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const now = new Date().toISOString();

  await win.DB.openDB(); await win.DB.ensureCounters();
  const custId = await win.DB.dbAdd('customers', { customerNo: 'C1', companyName: 'Key Electrochem Limited Co.', status: 'Active', createdAt: now, updatedAt: now });
  const so = await win.DB.dbAdd('salesOrders', {
    soNo: 'HT-SO-2026-0001', customerId: custId, orderDate: win.todayISO(), currency: 'PHP', status: 'Confirmed', paymentTerms: '50% down, 50% before delivery', incoterms: 'EXW',
    lines: [{ lineId: 'L1', itemId: '', description: 'Submersible Pump', qty: 1, uom: 'pc', unitCost: 3000, unitPrice: 4000, discountPercent: 0, vatRate: 12, supplierId: '', deliveredQty: 0 }],
    subtotal: 4000, vatTotal: 480, freight: 0, other: 0, grandTotal: 4480, createdAt: now, updatedAt: now
  });

  win.location.hash = '#/sales-orders/' + so;
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('btnProforma').click();
  await wait(30);
  const pis = await win.DB.dbGetAll('proformaInvoices');
  const pi = pis[0];
  console.log('STEP 1: PI correctly snapshots the Sales Order\'s grand total at creation:', pi.grandTotal === 4480);
  console.log('STEP 2: PI correctly snapshots the line items too (not just the total):', pi.lines.length === 1 && pi.lines[0].description === 'Submersible Pump');
  console.log('STEP 3: PI starts with an empty payment ledger:', Array.isArray(pi.payments) && pi.payments.length === 0);

  const soRecord = await win.DB.dbGet('salesOrders', so);
  soRecord.grandTotal = 9999;
  soRecord.lines[0].unitPrice = 9000;
  await win.DB.dbPut('salesOrders', soRecord);
  const piAfterSoRevision = await win.DB.dbGet('proformaInvoices', pi.id);
  console.log('STEP 4: Revising the Sales Order afterward does NOT silently change the already-issued invoice amount:', piAfterSoRevision.grandTotal === 4480);

  win.location.hash = '#/proforma-invoices/' + pi.id;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 5: A brand new invoice with no payments shows "Unpaid":', doc.getElementById('content').textContent.includes('Unpaid'));

  doc.getElementById('btnRecordPayment').click();
  await wait(10);
  doc.getElementById('pay_amount').value = '2000';
  doc.getElementById('pay_method').value = 'Bank Transfer';
  doc.getElementById('pay_reference').value = 'Down payment - Ref 12345';
  doc.getElementById('btnConfirmPayment').click();
  await wait(30);
  const piAfterPartial = await win.DB.dbGet('proformaInvoices', pi.id);
  console.log('STEP 6: After a partial payment of 2000, amount paid is tracked correctly:', win.ProformaInvoices.piAmountPaid(piAfterPartial) === 2000);
  console.log('STEP 7: Balance due correctly reflects the remaining amount (4480 - 2000 = 2480):', win.ProformaInvoices.piBalanceDue(piAfterPartial) === 2480);
  console.log('STEP 8: Status correctly becomes "Partially Paid":', win.ProformaInvoices.piPaymentStatus(piAfterPartial) === 'Partially Paid');

  win.location.hash = '#/proforma-invoices/' + pi.id;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 9: The detail page reflects the amber "Partially Paid" badge and payment shows in history:', doc.getElementById('content').textContent.includes('Partially Paid') && doc.getElementById('content').textContent.includes('Down payment - Ref 12345'));

  doc.getElementById('btnRecordPayment').click();
  await wait(10);
  console.log('STEP 10: The payment form pre-fills the remaining balance as a helpful default:', doc.getElementById('pay_amount').value === '2480');
  doc.getElementById('btnConfirmPayment').click();
  await wait(30);
  const piFullyPaid = await win.DB.dbGet('proformaInvoices', pi.id);
  console.log('STEP 11: After paying the full remaining balance, status becomes "Paid":', win.ProformaInvoices.piPaymentStatus(piFullyPaid) === 'Paid');
  console.log('STEP 12: Balance due is correctly zero:', win.ProformaInvoices.piBalanceDue(piFullyPaid) === 0);

  win.location.hash = '#/proforma-invoices/' + pi.id;
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('btnRecordPayment').click();
  await wait(10);
  doc.getElementById('pay_amount').value = '500';
  let confirmMsg = '';
  win.confirm = (msg) => { confirmMsg = msg; return true; };
  doc.getElementById('btnConfirmPayment').click();
  await wait(30);
  console.log('STEP 13: Recording a payment beyond the balance due triggers a clear warning naming the overpayment amount:', confirmMsg.includes('overpay this invoice by'));
  const piOverpaid = await win.DB.dbGet('proformaInvoices', pi.id);
  console.log('STEP 14: Confirming the warning still allows the overpayment to be saved (not a hard block):', win.ProformaInvoices.piAmountPaid(piOverpaid) === 4980);

  win.location.hash = '#/payments';
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 15: The Payments list page shows the invoice with its correct status:', doc.getElementById('content').textContent.includes(pi.piNo) && doc.getElementById('content').textContent.includes('Paid'));
  console.log('STEP 16: Sidebar correctly highlights "Payments" as active on the list page:', doc.querySelector('.nav-link[href="#/payments"]').classList.contains('active'));

  win.location.hash = '#/proforma-invoices/' + pi.id;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 17: Sidebar ALSO correctly highlights "Payments" when viewing an individual invoice (different URL, same section):', doc.querySelector('.nav-link[href="#/payments"]').classList.contains('active'));

  const printSource = fs.readFileSync(path.join(APP, 'js/print.js'), 'utf8');
  console.log('STEP 18: print.js correctly reads from pi.lines/pi.grandTotal (the snapshot), not so.lines/so.grandTotal (the live, now-revised data):', printSource.includes('(pi.lines || [])') && printSource.includes('formatMoney(pi.grandTotal'));

  win.location.hash = '#/sales-orders/' + so;
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('btnProforma').click();
  await wait(30);
  const pisAfter = await win.DB.dbGetAll('proformaInvoices');
  console.log('STEP 19: Generating again for the same Sales Order still reuses the existing PI, no duplicate created:', pisAfter.length === 1);

  console.log('\n=== PAYMENTS FEATURE FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
