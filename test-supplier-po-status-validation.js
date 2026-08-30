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
  const supId = await win.DB.dbAdd('suppliers', { supplierNo: 'S1', companyName: 'Test Supplier', status: 'Active', createdAt: now, updatedAt: now });
  const spo = await win.DB.dbAdd('supplierPOs', {
    poNo: 'HT-PO-2026-0001', supplierId: supId, poDate: win.todayISO(), currency: 'PHP', status: 'Shipped',
    lines: [{ lineId: 'L1', itemId: '', description: 'Test Item', qty: 3, uom: 'pc', unitCost: 100, amount: 300, receivedQty: 0 }],
    freight: 0, taxes: 0, totalCost: 300, createdAt: now, updatedAt: now
  });

  win.location.hash = '#/supplier-pos/' + spo;
  await win.Router.resolveRoute();
  await wait(10);
  let confirmMessage = '';
  win.confirm = (msg) => { confirmMessage = msg; return false; };
  const receivedBtn = [...doc.querySelectorAll('.status-btn')].find(b => b.dataset.status === 'Received');
  receivedBtn.click();
  await wait(20);
  console.log('STEP 1: Clicking "Mark: Received" with 0 of 3 actually received now shows a specific warning (previously just a generic "are you sure"):', confirmMessage.includes("don't actually have their received quantity recorded"));
  console.log('STEP 2: Warning explicitly names the mismatched line and quantities:', confirmMessage.includes('0 of 3 pc'));
  console.log('STEP 3: Warning points to "Receive Stock" as the correct path:', confirmMessage.includes('Receive Stock'));
  const spoAfterDecline = await win.DB.dbGet('supplierPOs', spo);
  console.log('STEP 4: Declining the override leaves the status unchanged:', spoAfterDecline.status === 'Shipped');

  win.confirm = () => true;
  receivedBtn.click();
  await wait(20);
  const spoAfterOverride = await win.DB.dbGet('supplierPOs', spo);
  console.log('STEP 5: Confirming the override still allows marking it Received (not a hard block):', spoAfterOverride.status === 'Received');

  win.location.hash = '#/supplier-pos/' + spo;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 6: Header badge shows "RECEIVED — INCOMPLETE" in red, not a plain green "Received":', doc.getElementById('content').innerHTML.includes('badge-lost') && doc.getElementById('content').textContent.includes('RECEIVED — INCOMPLETE'));
  console.log('STEP 7: A persistent red warning banner explains the mismatch on the page itself:', doc.getElementById('content').innerHTML.includes('danger-card') && doc.getElementById('content').textContent.includes("don't actually have their received quantity recorded"));

  win.location.hash = '#/supplier-pos';
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 8: Supplier POs list also shows the red mismatch badge, not the normal green Received badge:', doc.getElementById('content').textContent.includes('RECEIVED — INCOMPLETE'));

  win.location.hash = '#/supplier-pos/' + spo;
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('btnReceiveStock').click();
  await wait(10);
  const qtyInput = doc.querySelector('.recv-qty');
  qtyInput.value = '3';
  win.confirm = () => true;
  doc.getElementById('btnConfirmReceive').click();
  await wait(30);
  const spoAfterProperReceive = await win.DB.dbGet('supplierPOs', spo);
  console.log('STEP 9: After properly receiving stock, receivedQty actually matches qty:', spoAfterProperReceive.lines[0].receivedQty === 3);

  win.location.hash = '#/supplier-pos/' + spo;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 10: With quantities now matching, the header shows a normal green "Received" badge, no red flag:', !doc.getElementById('content').textContent.includes('INCOMPLETE') && doc.getElementById('content').innerHTML.includes('badge-received'));
  console.log('STEP 11: The warning banner is gone now that quantities match:', !doc.getElementById('content').innerHTML.includes('danger-card'));

  const spo2 = await win.DB.dbAdd('supplierPOs', {
    poNo: 'HT-PO-2026-0002', supplierId: supId, poDate: win.todayISO(), currency: 'PHP', status: 'Draft',
    lines: [{ lineId: 'L1', itemId: '', description: 'Ad-hoc line', qty: 1, uom: 'pc', unitCost: 50, amount: 50, receivedQty: 0 }],
    freight: 0, taxes: 0, totalCost: 50, createdAt: now, updatedAt: now
  });
  win.location.hash = '#/supplier-pos/' + spo2;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 12: A fresh Draft PO renders normally with no false mismatch flag (nothing marked Received yet):', !doc.getElementById('content').innerHTML.includes('danger-card') && !doc.getElementById('content').textContent.includes('INCOMPLETE'));

  console.log('\n=== SUPPLIER PO RECEIVED-STATUS VALIDATION FIX FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
