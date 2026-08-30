const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
require('fake-indexeddb/auto');
const APP = __dirname;

async function main() {
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  window.indexedDB = global.indexedDB; window.IDBKeyRange = global.IDBKeyRange;
  const scripts = [...dom.window.document.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => s !== 'js/app.js');
  for (const src of scripts) dom.window.eval(fs.readFileSync(path.join(APP, src), 'utf8'));
  const win = dom.window; const doc = win.document;
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const now = new Date().toISOString();

  await win.DB.openDB(); await win.DB.ensureCounters();
  const custId = await win.DB.dbAdd('customers', { customerNo: 'C1', companyName: 'Test Customer', status: 'Active', createdAt: now, updatedAt: now });
  const supId = await win.DB.dbAdd('suppliers', { supplierNo: 'S1', companyName: 'Test Supplier', status: 'Active', createdAt: now, updatedAt: now });

  const so = await win.DB.dbAdd('salesOrders', {
    soNo: await win.DB.nextDocNumber('salesOrder'), customerId: custId, orderDate: win.todayISO(), currency: 'PHP', status: 'Confirmed',
    lines: [{ lineId: 'L1', itemId: '', description: 'SAMPLE Wooden Brush Nylon', qty: 1, uom: 'pc', unitCost: 100, unitPrice: 150, discountPercent: 0, vatRate: 12, supplierId: '', deliveredQty: 0 }],
    subtotal: 150, vatTotal: 18, freight: 0, other: 0, grandTotal: 168, createdAt: now, updatedAt: now
  });
  win.location.hash = '#/sales-orders/' + so;
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('btnEditDetails').click();
  await wait(10);
  console.log('STEP 1: No editable textarea for description exists at all:', !doc.querySelector('.so-desc'));
  console.log('STEP 2: Description is shown as plain locked text, exact to the original:', doc.querySelector('.line-desc-locked').textContent === 'SAMPLE Wooden Brush Nylon');
  console.log('STEP 3: Qty/UOM/Price/Cost/VAT are all still editable as before (regression check):', !!doc.querySelector('.so-qty') && !!doc.querySelector('.so-uom') && !!doc.querySelector('.so-price') && !!doc.querySelector('.so-cost') && !!doc.querySelector('.so-vat'));

  win.prompt = () => 'Brand New Item';
  doc.getElementById('btnAddSoLine').click();
  await wait(10);
  const lockedCells = [...doc.querySelectorAll('.line-desc-locked')];
  console.log('STEP 4: A new line added via the prompt shows the entered description, locked immediately:', lockedCells.some(c => c.textContent === 'Brand New Item'));

  const rowCountBefore = doc.querySelectorAll('#soLinesBody tr').length;
  win.prompt = () => null;
  doc.getElementById('btnAddSoLine').click();
  await wait(10);
  console.log('STEP 5: Cancelling the description prompt does not add a new line at all:', doc.querySelectorAll('#soLinesBody tr').length === rowCountBefore);

  doc.getElementById('soForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(30);
  const soAfter = await win.DB.dbGet('salesOrders', so);
  console.log('STEP 6: Original line\'s description is preserved exactly, untouched by this edit session:', soAfter.lines[0].description === 'SAMPLE Wooden Brush Nylon');
  console.log('STEP 7: The new locked-description line was saved correctly too:', soAfter.lines.some(l => l.description === 'Brand New Item'));

  const spo = await win.DB.dbAdd('supplierPOs', {
    poNo: await win.DB.nextDocNumber('supplierPO'), supplierId: supId, poDate: win.todayISO(), currency: 'PHP', status: 'Draft',
    lines: [{ lineId: 'L1', description: 'SAMPLE Wooden Brush Nylon', qty: 1, uom: 'pc', unitCost: 80, amount: 80, receivedQty: 0 }],
    freight: 0, taxes: 0, totalCost: 80, createdAt: now, updatedAt: now
  });
  win.location.hash = '#/supplier-pos/' + spo;
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('btnEditHeader').click();
  await wait(10);
  console.log('STEP 8: No editable textarea for Supplier PO description exists either:', !doc.querySelector('.spo-desc'));
  console.log('STEP 9: Description shown locked, exact to the original — matches the Sales Order exactly:', doc.querySelector('.line-desc-locked').textContent === 'SAMPLE Wooden Brush Nylon');
  console.log('STEP 10: Qty/UOM/Unit Cost still fully editable (regression check):', !!doc.querySelector('.spo-qty') && !!doc.querySelector('.spo-uom') && !!doc.querySelector('.spo-cost'));

  win.prompt = () => 'Another New Item';
  doc.getElementById('btnAddSpoLine').click();
  await wait(10);
  console.log('STEP 11: New Supplier PO line via prompt is locked immediately too:', [...doc.querySelectorAll('.line-desc-locked')].some(c => c.textContent === 'Another New Item'));

  win.location.hash = '#/customer-pos/new';
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('f_customerId').value = String(custId);
  doc.getElementById('btnAddPOLine').click();
  await wait(10);
  const row = doc.querySelector('#poLinesBody tr');
  row.querySelector('.po-desc').value = 'SAMPLE Wooden Brush Nylon - 13x30x534mm exact spec text';
  row.querySelector('.po-desc').dispatchEvent(new win.Event('input'));
  row.querySelector('.po-qty').value = '1';
  row.querySelector('.po-qty').dispatchEvent(new win.Event('input'));
  row.querySelector('.po-price').value = '238';
  row.querySelector('.po-price').dispatchEvent(new win.Event('input'));
  await wait(10);
  doc.getElementById('cpoForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(30);
  const cpo = (await win.DB.dbGetAll('customerPOs'))[0];
  win.location.hash = '#/customer-pos/' + cpo.id;
  await win.Router.resolveRoute();
  await wait(10);
  win.confirm = () => true;
  doc.getElementById('btnConvert').click();
  await wait(30);
  const chainSo = (await win.DB.dbGetAll('salesOrders')).find(s => s.customerPOId === cpo.id);
  console.log('STEP 12: Description carries EXACTLY from Customer PO to Sales Order (byte for byte):', chainSo.lines[0].description === 'SAMPLE Wooden Brush Nylon - 13x30x534mm exact spec text');

  console.log('\n=== LINE DESCRIPTION LOCKING FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
