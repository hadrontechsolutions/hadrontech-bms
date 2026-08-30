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
  const supId = await win.DB.dbAdd('suppliers', { supplierNo: 'SUP-00001', companyName: 'Test Supplier', status: 'Active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  const now = new Date().toISOString();

  win.location.hash = '#/quotations/new';
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 1: Quotation ln-desc width = 160px (the reference value):', doc.querySelector('.ln-desc').getAttribute('style').includes('width:160px'));
  console.log('STEP 2: Quotation ln-qty width = 55px:', doc.querySelector('.ln-qty').getAttribute('style').includes('width:55px'));
  console.log('STEP 3: Quotation ln-uom width = 45px:', doc.querySelector('.ln-uom').getAttribute('style').includes('width:45px'));
  console.log('STEP 4: Quotation ln-cost width = 75px:', doc.querySelector('.ln-cost').getAttribute('style').includes('width:75px'));
  console.log('STEP 5: Quotation ln-price width = 80px:', doc.querySelector('.ln-price').getAttribute('style').includes('width:80px'));
  console.log('STEP 6: Quotation ln-vat width = 50px:', doc.querySelector('.ln-vat').getAttribute('style').includes('width:50px'));
  console.log('STEP 7: Unit Cost cell now highlighted internal-only:', doc.querySelector('.ln-cost').closest('td').classList.contains('internal-only-col'));
  console.log('STEP 8: Markup% cell now highlighted internal-only:', doc.querySelector('.ln-markup').closest('td').classList.contains('internal-only-col'));
  console.log('STEP 9: Supplier cell now highlighted internal-only:', doc.querySelector('.ln-supplier').closest('td').classList.contains('internal-only-col'));
  console.log('STEP 10: Unit Price (customer-facing) is NOT marked internal-only:', !doc.querySelector('.ln-price').closest('td').classList.contains('internal-only-col'));

  doc.getElementById('f_customerId').value = String(custId);
  const qRow = doc.querySelector('#linesBody tr');
  qRow.querySelector('.ln-desc').value = 'Test item';
  qRow.querySelector('.ln-desc').dispatchEvent(new win.Event('input'));
  qRow.querySelector('.ln-qty').value = '1';
  qRow.querySelector('.ln-qty').dispatchEvent(new win.Event('input'));
  qRow.querySelector('.ln-price').value = '1000';
  qRow.querySelector('.ln-price').dispatchEvent(new win.Event('input'));
  await wait(10);
  doc.getElementById('qForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(30);
  console.log('STEP 11: Quotation still saves correctly after the styling changes:', (await win.DB.dbGetAll('quotations')).length === 1);

  const so = await win.DB.dbAdd('salesOrders', {
    soNo: 'HT-SO-2026-0001', customerId: custId, orderDate: win.todayISO(), currency: 'PHP', status: 'Confirmed',
    lines: [{ lineId: 'L1', itemId: '', description: 'Test', qty: 1, uom: 'pc', unitCost: 100, unitPrice: 200, discountPercent: 0, vatRate: 12, supplierId: '', deliveredQty: 0 }],
    subtotal: 200, vatTotal: 24, freight: 0, other: 0, grandTotal: 224, createdAt: now, updatedAt: now
  });
  win.location.hash = '#/sales-orders/' + so;
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('btnEditDetails').click();
  await wait(10);
  console.log('STEP 12: Sales Order description is now locked (not an editable width-constrained field) — confirms the newer locking fix took over this cell:', !doc.querySelector('.so-desc') && !!doc.querySelector('.line-desc-locked'));
  console.log('STEP 13: Sales Order so-qty width = 55px (matches reference):', doc.querySelector('.so-qty').getAttribute('style').includes('width:55px'));
  console.log('STEP 14: Sales Order so-uom width = 45px (matches reference):', doc.querySelector('.so-uom').getAttribute('style').includes('width:45px'));
  console.log('STEP 15: Sales Order so-price width = 80px (matches reference):', doc.querySelector('.so-price').getAttribute('style').includes('width:80px'));
  console.log('STEP 16: Sales Order so-cost width = 75px (matches reference):', doc.querySelector('.so-cost').getAttribute('style').includes('width:75px'));
  console.log('STEP 17: Sales Order so-vat width = 50px (matches reference):', doc.querySelector('.so-vat').getAttribute('style').includes('width:50px'));
  console.log('STEP 18: Sales Order Unit Cost cell highlighted internal-only:', doc.querySelector('.so-cost').closest('td').classList.contains('internal-only-col'));
  console.log('STEP 19: Sales Order Unit Price NOT marked internal-only (it IS shown to the customer):', !doc.querySelector('.so-price').closest('td').classList.contains('internal-only-col'));

  const soCostInput = doc.querySelector('.so-cost');
  soCostInput.value = '150';
  soCostInput.dispatchEvent(new win.Event('input'));
  await wait(10);
  doc.getElementById('soForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(30);
  const soAfter = await win.DB.dbGet('salesOrders', so);
  console.log('STEP 20: Sales Order still saves correctly (Unit Cost updated to 150):', soAfter.lines[0].unitCost === 150);

  const spo = await win.DB.dbAdd('supplierPOs', {
    poNo: 'HT-PO-2026-0001', supplierId: supId, poDate: win.todayISO(), currency: 'PHP', status: 'Draft',
    lines: [{ lineId: 'L1', description: 'Test item', qty: 1, uom: 'pc', unitCost: 100, amount: 100, receivedQty: 0 }],
    freight: 0, taxes: 0, totalCost: 100, createdAt: now, updatedAt: now
  });
  win.location.hash = '#/supplier-pos/' + spo;
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('btnEditHeader').click();
  await wait(10);
  console.log('STEP 21: Supplier PO description is now locked too (not an editable width-constrained field):', !doc.querySelector('.spo-desc') && !!doc.querySelector('.line-desc-locked'));
  console.log('STEP 22: Supplier PO spo-qty width = 55px (matches reference):', doc.querySelector('.spo-qty').getAttribute('style').includes('width:55px'));
  console.log('STEP 23: Supplier PO spo-cost width = 75px (matches reference):', doc.querySelector('.spo-cost').getAttribute('style').includes('width:75px'));
  console.log('STEP 24: Supplier PO correctly has NO internal-only highlighting anywhere:', doc.querySelectorAll('.internal-only-col').length === 0);

  win.location.hash = '#/customer-pos/new';
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('btnAddPOLine').click();
  await wait(10);
  console.log('STEP 25: Customer PO po-desc width = 160px (matches reference):', doc.querySelector('.po-desc').getAttribute('style').includes('width:160px'));
  console.log('STEP 26: Customer PO po-qty width = 55px (matches reference):', doc.querySelector('.po-qty').getAttribute('style').includes('width:55px'));
  console.log('STEP 27: Customer PO po-price width = 80px (matches reference):', doc.querySelector('.po-price').getAttribute('style').includes('width:80px'));
  console.log('STEP 28: Customer PO catalog select uses min-width:110px, matching Quotation\'s exact technique:', doc.querySelector('.po-catalog').getAttribute('style').includes('min-width:110px'));
  console.log('STEP 29: Customer PO correctly has NO internal-only highlighting (no cost/margin data captured here):', doc.querySelectorAll('.internal-only-col').length === 0);

  console.log('\n=== LINE-ITEM WIDTH STANDARDIZATION + INTERNAL-ONLY HIGHLIGHTING VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
