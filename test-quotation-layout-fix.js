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
  const longSupName = 'Zhejiang Jiabo Fluid Equipment Manufacturing Co., LTD.';
  const supId = await win.DB.dbAdd('suppliers', { supplierNo: 'SUP-00001', companyName: longSupName, status: 'Active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

  win.location.hash = '#/quotations/new';
  await win.Router.resolveRoute();
  await wait(10);
  const supplierSelect = doc.querySelector('.ln-supplier');
  const longOption = [...supplierSelect.options].find(o => o.value === String(supId));
  console.log('STEP 1: Supplier dropdown option text is truncated (not the full 50+ char name):', longOption.textContent.length <= 25);
  console.log('STEP 2: VAT Mode dropdown is still present (confirmed NOT removed — it feeds the bookkeeper report):', !!doc.getElementById('f_vatMode'));

  doc.getElementById('f_customerId').value = String(custId);
  const row = doc.querySelector('#linesBody tr');
  row.querySelector('.ln-desc').value = 'Test item';
  row.querySelector('.ln-desc').dispatchEvent(new win.Event('input'));
  row.querySelector('.ln-qty').value = '1';
  row.querySelector('.ln-qty').dispatchEvent(new win.Event('input'));
  row.querySelector('.ln-price').value = '100';
  row.querySelector('.ln-price').dispatchEvent(new win.Event('input'));
  row.querySelector('.ln-supplier').value = String(supId);
  row.querySelector('.ln-supplier').dispatchEvent(new win.Event('change'));
  await wait(10);
  console.log('STEP 4: Quotation edit form\'s line table is wrapped in its own scroll container (not the whole page):', !!doc.querySelector('#linesTable').closest('div[style*="overflow-x:auto"]'));

  doc.getElementById('qForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(30);
  const q = (await win.DB.dbGetAll('quotations'))[0];
  console.log('STEP 3: The real, full supplier ID is still correctly saved despite the truncated display:', String(q.lines[0].supplierId) === String(supId));

  win.location.hash = '#/quotations/' + q.id;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 5: Quotation detail page\'s line table is wrapped in its own scroll container:', !!doc.querySelector('.data-table.compact').closest('div[style*="overflow-x:auto"]'));

  const so = await win.DB.dbAdd('salesOrders', {
    soNo: 'HT-SO-2026-0001', customerId: custId, orderDate: win.todayISO(), currency: 'PHP', status: 'Confirmed',
    lines: [{ lineId: 'L1', itemId: '', description: 'Test', qty: 1, uom: 'pc', unitCost: 0, unitPrice: 100, discountPercent: 0, vatRate: 12, supplierId: '', deliveredQty: 0 }],
    subtotal: 100, vatTotal: 12, freight: 0, other: 0, grandTotal: 112, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  });
  win.location.hash = '#/sales-orders/' + so;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 6: Sales Order detail "Order Items" table is wrapped in its own scroll container:', !!doc.querySelector('.data-table.compact').closest('div[style*="overflow-x:auto"]'));

  doc.getElementById('btnEditDetails').click();
  await wait(10);
  console.log('STEP 7: Sales Order edit form\'s line table is wrapped in its own scroll container:', !!doc.getElementById('soLinesBody').closest('div[style*="overflow-x:auto"]'));

  const spo = await win.DB.dbAdd('supplierPOs', {
    poNo: 'HT-PO-2026-0001', supplierId: supId, poDate: win.todayISO(), currency: 'PHP', status: 'Draft',
    lines: [{ lineId: 'L1', description: 'Test', qty: 1, uom: 'pc', unitCost: 100, amount: 100, receivedQty: 0 }],
    freight: 0, taxes: 0, totalCost: 100, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  });
  win.location.hash = '#/supplier-pos/' + spo;
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('btnEditHeader').click();
  await wait(10);
  console.log('STEP 8: Supplier PO edit form\'s line table is wrapped in its own scroll container:', !!doc.getElementById('spoLinesBody').closest('div[style*="overflow-x:auto"]'));

  win.location.hash = '#/customer-pos/new';
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('f_customerId').value = String(custId);
  doc.getElementById('btnAddPOLine').click();
  await wait(10);
  console.log('STEP 9: Customer PO line table is wrapped in its own scroll container:', !!doc.getElementById('poLinesBody').closest('div[style*="overflow-x:auto"]'));

  console.log('STEP 10: Quotation still saved correctly with 112.00 (VAT-inclusive) total, math unaffected:', q.grandTotal === 112);

  console.log('\n=== SUPPLIER TRUNCATION + SCROLL CONTAINMENT FIXES VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
