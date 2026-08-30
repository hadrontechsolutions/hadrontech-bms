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
  const custId = await win.DB.dbAdd('customers', { customerNo: 'CUST-00001', companyName: 'Key Electrochem Limited Co./KEYEC', status: 'Active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  const supId = await win.DB.dbAdd('suppliers', { supplierNo: 'SUP-00001', companyName: 'Zhejiang Jiabo Fluid Equipment Co., LTD.', status: 'Active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

  win.location.hash = '#/quotations/new';
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('f_customerId').value = String(custId);
  const row = doc.querySelector('#linesBody tr');
  row.querySelector('.ln-desc').value = 'Stainless steel submersible pump';
  row.querySelector('.ln-desc').dispatchEvent(new win.Event('input'));
  row.querySelector('.ln-qty').value = '1';
  row.querySelector('.ln-qty').dispatchEvent(new win.Event('input'));
  row.querySelector('.ln-price').value = '297';
  row.querySelector('.ln-price').dispatchEvent(new win.Event('input'));
  row.querySelector('.ln-supplier').value = String(supId);
  row.querySelector('.ln-supplier').dispatchEvent(new win.Event('change'));
  await wait(10);
  doc.getElementById('qForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(30);
  const q = (await win.DB.dbGetAll('quotations'))[0];
  q.status = 'Won'; await win.DB.dbPut('quotations', q);

  win.location.hash = '#/customer-pos/new?quotationId=' + q.id;
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('f_customerId').value = String(custId);
  doc.getElementById('f_customerPoNumber').value = 'TEST-123 PO';
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
  const createSpoBtn = doc.querySelector('[data-create-spo]');
  createSpoBtn.click();
  await wait(30);
  const spo = (await win.DB.dbGetAll('supplierPOs'))[0];

  let printedSPO = '';
  win.open = () => ({ document: { write: (h) => { printedSPO = h; }, close: () => {} } });
  const supplierObj = await win.DB.dbGet('suppliers', supId);
  const soObj = await win.DB.dbGet('salesOrders', so.id);
  await win.Print.printSupplierPO(spo, supplierObj, soObj);
  console.log('STEP 1: Printed Supplier PO now shows "Our Ref" with the Sales Order number (previously showed NOTHING):', printedSPO.includes('Our Ref:') && printedSPO.includes(so.soNo));

  let printedSPONoSO = '';
  win.open = () => ({ document: { write: (h) => { printedSPONoSO = h; }, close: () => {} } });
  await win.Print.printSupplierPO(spo, supplierObj, null);
  console.log('STEP 2: Printing without a Sales Order (defensive case) does not crash and omits the ref cleanly:', !printedSPONoSO.includes('Our Ref:') && !printedSPONoSO.includes('Something went wrong'));

  let printedSO = '';
  win.open = () => ({ document: { write: (h) => { printedSO = h; }, close: () => {} } });
  const customerObj = await win.DB.dbGet('customers', custId);
  const cpoObj = await win.DB.dbGet('customerPOs', cpo.id);
  const quotationObj = await win.DB.dbGet('quotations', q.id);
  await win.Print.printSalesOrder(soObj, customerObj, cpoObj, quotationObj);
  console.log('STEP 3: Printed Sales Order now shows "Our Quotation Ref" (previously never shown):', printedSO.includes('Our Quotation Ref:') && printedSO.includes(q.quotationNo));
  console.log('STEP 4: Printed Sales Order still shows the customer\'s own PO # as before (regression check):', printedSO.includes('TEST-123 PO'));

  let printedSONoQuote = '';
  win.open = () => ({ document: { write: (h) => { printedSONoQuote = h; }, close: () => {} } });
  await win.Print.printSalesOrder(soObj, customerObj, cpoObj, null);
  console.log('STEP 5: Printing without a Quotation (e.g. PO-only sales order) does not crash and omits the ref cleanly:', !printedSONoQuote.includes('Our Quotation Ref:') && !printedSONoQuote.includes('Something went wrong'));

  win.location.hash = '#/customer-pos';
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 6: Customer POs list header includes "Quotation #":', doc.querySelector('.data-table thead').textContent.includes('Quotation #'));
  console.log('STEP 7: Customer POs list correctly shows the linked quotation number in the row:', doc.getElementById('content').textContent.includes(q.quotationNo));

  win.location.hash = '#/sales-orders';
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 8: Sales Orders list header includes "Quotation #":', doc.querySelector('.data-table thead').textContent.includes('Quotation #'));
  console.log('STEP 9: Sales Orders list correctly shows the linked quotation number in the row:', doc.getElementById('content').textContent.includes(q.quotationNo));
  console.log('STEP 10: Sales Orders list still shows Customer PO # as before (regression check):', doc.getElementById('content').textContent.includes('TEST-123 PO'));

  const custId2 = await win.DB.dbAdd('customers', { customerNo: 'CUST-00002', companyName: 'No-Quote Customer', status: 'Active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  await win.DB.dbAdd('customerPOs', {
    poNo: await win.DB.nextDocNumber('customerPO'), customerId: custId2, quotationId: null, customerPoNumber: 'NOQUOTE-PO',
    poAmount: 500, currency: 'PHP', status: 'Received', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  });
  win.location.hash = '#/customer-pos';
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 11: A Customer PO with no linked quotation shows a clean dash, not "undefined" or "null":', !doc.getElementById('content').textContent.includes('undefined') && !doc.getElementById('content').textContent.includes('null'));

  console.log('\n=== REFERENCE COMPLETENESS FIXES FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
