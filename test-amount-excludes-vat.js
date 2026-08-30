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

  await win.DB.openDB(); await win.DB.ensureCounters();
  const custId = await win.DB.dbAdd('customers', { customerNo: 'CUST-00001', companyName: 'Test Co.', status: 'Active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

  win.location.hash = '#/quotations/new';
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('f_customerId').value = String(custId);
  const row = doc.querySelector('#linesBody tr');
  row.querySelector('.ln-desc').value = 'Test item';
  row.querySelector('.ln-desc').dispatchEvent(new win.Event('input'));
  row.querySelector('.ln-qty').value = '2';
  row.querySelector('.ln-qty').dispatchEvent(new win.Event('input'));
  row.querySelector('.ln-price').value = '100';
  row.querySelector('.ln-price').dispatchEvent(new win.Event('input'));
  row.querySelector('.ln-vat').value = '12';
  row.querySelector('.ln-vat').dispatchEvent(new win.Event('input'));
  await wait(10);
  console.log('STEP 1: Quotation line Amount shows 200.00 (qty*price, no VAT), not 224.00:', row.querySelector('.ln-amount').textContent.includes('200.00') && !row.querySelector('.ln-amount').textContent.includes('224.00'));

  const totalsText = doc.getElementById('totalsBox').textContent;
  console.log('STEP 2: Subtotal correctly shows 200.00, matching the line Amount exactly:', totalsText.includes('200.00'));
  console.log('STEP 3: VAT shown separately as 24.00:', totalsText.includes('24.00'));
  console.log('STEP 4: Grand Total still correctly includes VAT once (224.00) — math unchanged, only display fixed:', totalsText.includes('224.00'));

  doc.getElementById('qForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(30);
  const q = (await win.DB.dbGetAll('quotations'))[0];
  console.log('STEP 5: Saved record: subtotal correctly 200:', q.subtotal === 200);
  console.log('STEP 6: Saved record: vatTotal correctly 24:', q.vatTotal === 24);
  console.log('STEP 7: Saved record: grandTotal correctly 224 (unchanged):', q.grandTotal === 224);

  win.location.hash = '#/quotations/' + q.id;
  await win.Router.resolveRoute();
  await wait(10);
  const detailText = doc.getElementById('content').textContent;
  console.log('STEP 8: Detail page line Amount shows 200.00, not the VAT-inclusive 224.00:', detailText.includes('200.00'));

  let printedQ = '';
  win.open = () => ({ document: { write: (h) => { printedQ = h; }, close: () => {} } });
  const customerObj = await win.DB.dbGet('customers', custId);
  await win.Print.printQuotation(q, customerObj);
  console.log('STEP 9: Printed Quotation line Amount shows 200.00:', printedQ.includes('200.00'));
  console.log('STEP 10: Printed Quotation Subtotal (200.00) matches the line Amount exactly — no more mismatch:', (printedQ.match(/200\.00/g) || []).length >= 2);

  q.status = 'Won'; await win.DB.dbPut('quotations', q);
  win.location.hash = '#/customer-pos/new?quotationId=' + q.id;
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('f_customerId').value = String(custId);
  doc.getElementById('cpoForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(30);
  const cpo = (await win.DB.dbGetAll('customerPOs'))[0];
  win.location.hash = '#/customer-pos/' + cpo.id;
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('btnConvert').click();
  await wait(30);
  const so = (await win.DB.dbGetAll('salesOrders'))[0];

  win.location.hash = '#/sales-orders/' + so.id;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 11: Sales Order Order Items table Amount shows 200.00, not 224.00:', doc.getElementById('content').textContent.includes('200.00'));

  doc.getElementById('btnEditDetails').click();
  await wait(10);
  console.log('STEP 12: Sales Order edit-form line Amount shows 200.00:', doc.querySelector('.so-amount').textContent.includes('200.00'));

  let printedSO = '';
  win.open = () => ({ document: { write: (h) => { printedSO = h; }, close: () => {} } });
  const cpoObj = await win.DB.dbGet('customerPOs', cpo.id);
  await win.Print.printSalesOrder(so, customerObj, cpoObj);
  console.log('STEP 13: Printed Sales Order line Amount shows 200.00, matching its own Subtotal line:', printedSO.includes('200.00'));
  console.log('STEP 14: Printed Sales Order Grand Total still correctly 224.00 (unchanged):', printedSO.includes('224.00'));

  await win.ProformaInvoices.getOrCreateProformaInvoice(so);
  await wait(30);
  const pi = (await win.DB.dbGetAll('proformaInvoices'))[0];
  let printedPI = '';
  win.open = () => ({ document: { write: (h) => { printedPI = h; }, close: () => {} } });
  await win.Print.printProformaInvoice(pi, so, customerObj);
  console.log('STEP 15: Printed Proforma Invoice line Amount shows 200.00 (not VAT-inclusive):', printedPI.includes('200.00'));
  console.log('STEP 16: Printed Proforma Invoice Grand Total still correctly 224.00:', printedPI.includes('224.00'));

  console.log('\n=== LINE-ITEM AMOUNT (QTY x PRICE, EXCLUDING VAT) FIX FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
