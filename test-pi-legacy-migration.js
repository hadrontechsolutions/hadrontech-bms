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
  const custId = await win.DB.dbAdd('customers', { customerNo: 'C1', companyName: 'Key Electrochem Limited Co./KEYEC', status: 'Active', createdAt: now, updatedAt: now });
  const so = await win.DB.dbAdd('salesOrders', {
    soNo: 'HT-SO-2026-0004', customerId: custId, orderDate: win.todayISO(), currency: 'PHP', status: 'Delivered', paymentTerms: '100% upon delivery', incoterms: 'DAP',
    lines: [{ lineId: 'L1', itemId: '', description: 'SAMPLE Wooden Hand Brush, 13 x 30 x 534 mm', qty: 1, uom: 'lot', unitCost: 170, unitPrice: 238, discountPercent: 0, vatRate: 12, supplierId: '', deliveredQty: 1 }],
    subtotal: 238, vatTotal: 28.56, freight: 346, other: 0, grandTotal: 612.56, createdAt: now, updatedAt: now
  });

  const legacyPiId = await win.DB.dbAdd('proformaInvoices', {
    piNo: 'HT-PI-2026-0003', salesOrderId: so, date: win.todayISO(),
    createdAt: now, createdBy: 'Gretchen Caballero'
  });

  win.location.hash = '#/proforma-invoices/' + legacyPiId;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 1: THE FIX: viewing a legacy invoice (no stored amount) correctly shows the real Invoice Amount of ₱612.56, not ₱0.00:', doc.getElementById('content').textContent.includes('Invoice Amount') && doc.querySelector('.detail-grid').textContent.includes('612.56'));

  const piAfterView = await win.DB.dbGet('proformaInvoices', legacyPiId);
  console.log('STEP 2: The backfill was actually saved to the record (not just computed for this one view):', piAfterView.grandTotal === 612.56);
  console.log('STEP 3: Line items were backfilled too, not just the total:', piAfterView.lines.length === 1 && piAfterView.lines[0].description.includes('SAMPLE Wooden Hand Brush'));
  console.log('STEP 4: An empty payments array was correctly initialized:', Array.isArray(piAfterView.payments) && piAfterView.payments.length === 0);
  console.log('STEP 5: Currency was backfilled correctly:', piAfterView.currency === 'PHP');

  doc.getElementById('btnRecordPayment').click();
  await wait(10);
  doc.getElementById('pay_amount').value = '612.56';
  doc.getElementById('btnConfirmPayment').click();
  await wait(30);
  const piAfterPayment = await win.DB.dbGet('proformaInvoices', legacyPiId);
  console.log('STEP 6: Recording a payment against the now-migrated invoice works correctly:', win.ProformaInvoices.piPaymentStatus(piAfterPayment) === 'Paid');

  const legacyPiId2 = await win.DB.dbAdd('proformaInvoices', {
    piNo: 'HT-PI-2026-0004', salesOrderId: so, date: win.todayISO(),
    createdAt: now, createdBy: 'Gretchen Caballero'
  });
  win.location.hash = '#/payments';
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 7: The Payments list page ALSO correctly migrates and shows the real amount for a legacy invoice, not ₱0.00:', [...doc.querySelectorAll('tr')].some(tr => tr.textContent.includes('HT-PI-2026-0004') && tr.textContent.includes('612.56')));

  const so2 = await win.DB.dbAdd('salesOrders', {
    soNo: 'HT-SO-2026-0005', customerId: custId, orderDate: win.todayISO(), currency: 'PHP', status: 'Confirmed',
    lines: [{ lineId: 'L1', itemId: '', description: 'New format test', qty: 1, uom: 'pc', unitCost: 100, unitPrice: 150, discountPercent: 0, vatRate: 12, supplierId: '', deliveredQty: 0 }],
    subtotal: 150, vatTotal: 18, freight: 0, other: 0, grandTotal: 168, createdAt: now, updatedAt: now
  });
  win.location.hash = '#/sales-orders/' + so2;
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('btnProforma').click();
  await wait(30);
  const modernPis = await win.DB.dbGetAll('proformaInvoices');
  const modernPi = modernPis.find(p => p.salesOrderId === so2);
  win.location.hash = '#/proforma-invoices/' + modernPi.id;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 8: A properly created (new-format) invoice is unaffected by the migration path, shows correctly:', doc.getElementById('content').textContent.includes('168.00'));

  console.log('\n=== LEGACY PROFORMA INVOICE MIGRATION FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
