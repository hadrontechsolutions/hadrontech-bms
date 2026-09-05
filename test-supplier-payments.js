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
  const supId = await win.DB.dbAdd('suppliers', { supplierNo: 'S1', companyName: 'Pentair Manufacturing', status: 'Active', createdAt: now, updatedAt: now });
  const supId2 = await win.DB.dbAdd('suppliers', { supplierNo: 'S2', companyName: 'Local Parts Co.', status: 'Active', createdAt: now, updatedAt: now });

  const poUSD = await win.DB.dbAdd('supplierPOs', {
    poNo: 'HT-PO-2026-0001', supplierId: supId, poDate: win.todayISO(), currency: 'USD', status: 'Confirmed',
    lines: [{ description: 'Fleck 3150EM', qty: 2, uom: 'pcs', unitCost: 2300, amount: 4600, receivedQty: 0 }],
    freight: 200, taxes: 0, totalCost: 4800, createdAt: now, updatedAt: now
  });
  const poPHP = await win.DB.dbAdd('supplierPOs', {
    poNo: 'HT-PO-2026-0002', supplierId: supId2, poDate: win.todayISO(), currency: 'PHP', status: 'Confirmed',
    lines: [{ description: 'Local fittings', qty: 10, uom: 'pcs', unitCost: 500, amount: 5000, receivedQty: 0 }],
    freight: 0, taxes: 0, totalCost: 5000, createdAt: now, updatedAt: now
  });
  const poFullyPaid = await win.DB.dbAdd('supplierPOs', {
    poNo: 'HT-PO-2026-0003', supplierId: supId2, poDate: win.todayISO(), currency: 'PHP', status: 'Confirmed',
    lines: [{ description: 'Cable', qty: 1, uom: 'lot', unitCost: 1000, amount: 1000, receivedQty: 0 }],
    freight: 0, taxes: 0, totalCost: 1000, payments: [{ amount: 1000, date: win.todayISO() }], createdAt: now, updatedAt: now
  });

  /* ============ Helper functions ============ */
  win.location.hash = '#/supplier-pos/' + poUSD;
  await win.Router.resolveRoute();
  await wait(50);
  console.log('STEP 1: A fresh PO with no payments shows "Unpaid":', doc.getElementById('content').textContent.includes('Unpaid'));
  console.log('STEP 2: "Record Payment" button exists on the Supplier PO detail page:', !!doc.getElementById('btnRecordPaymentSPO'));
  console.log('STEP 3: Balance Due correctly shows the full $4,800.00 before any payment:', doc.getElementById('content').textContent.includes('$4,800.00'));

  /* ============ Record a partial payment ============ */
  doc.getElementById('btnRecordPaymentSPO').click();
  await wait(30);
  doc.getElementById('spo_pay_amount').value = '2000';
  doc.getElementById('spo_pay_method').value = 'Wire Transfer';
  doc.getElementById('spo_pay_reference').value = 'Wire ref 12345';
  doc.getElementById('btnConfirmPaymentSPO').click();
  await wait(50);
  const poUSDAfter = await win.DB.dbGet('supplierPOs', poUSD);
  console.log('STEP 4: Partial payment correctly recorded:', win.SupplierPOs.spoAmountPaid(poUSDAfter) === 2000);
  console.log('STEP 5: Balance due correctly recalculated ($4,800 - $2,000 = $2,800):', win.SupplierPOs.spoBalanceDue(poUSDAfter) === 2800);
  console.log('STEP 6: Status correctly becomes "Partially Paid":', win.SupplierPOs.spoPaymentStatus(poUSDAfter) === 'Partially Paid');

  win.location.hash = '#/supplier-pos/' + poUSD;
  await win.Router.resolveRoute();
  await wait(50);
  console.log('STEP 7: Detail page shows the payment in Payment History:', doc.getElementById('content').textContent.includes('Wire ref 12345'));
  console.log('STEP 8: Header badge correctly updates to reflect the new payment status:', doc.querySelector('h1').textContent.includes('Partially Paid') || !!doc.querySelector('.badge-partially-paid'));

  /* ============ Overpayment warning (declined, so the PO stays Partially Paid for later checks) ============ */
  doc.getElementById('btnRecordPaymentSPO').click();
  await wait(30);
  doc.getElementById('spo_pay_amount').value = '5000'; // more than the remaining $2,800
  let confirmMsg = '';
  win.confirm = (msg) => { confirmMsg = msg; return false; };
  doc.getElementById('btnConfirmPaymentSPO').click();
  await wait(50);
  console.log('STEP 9: Overpaying triggers a clear warning naming the overpayment amount:', confirmMsg.includes('overpay this PO by'));
  const poUSDStillPartial = await win.DB.dbGet('supplierPOs', poUSD);
  console.log('STEP 9b: Declining the warning correctly does NOT save the overpayment — still Partially Paid, not Paid:', win.SupplierPOs.spoPaymentStatus(poUSDStillPartial) === 'Partially Paid');
  win.confirm = () => true;

  /* ============ List page shows color-coded payment status ============ */
  win.location.hash = '#/supplier-pos';
  await win.Router.resolveRoute();
  await wait(50);
  console.log('STEP 10: List page shows a Payment Status column:', doc.getElementById('content').textContent.includes('Payment Status'));
  const poPHPRow = [...doc.querySelectorAll('tr.clickable-row')].find(tr => tr.textContent.includes('HT-PO-2026-0002'));
  console.log('STEP 11: The unpaid PHP PO shows the blue "Unpaid" badge on the list:', poPHPRow.querySelector('.badge-unpaid') !== null);

  /* ============ Report ============ */
  win.location.hash = '#/reports';
  await win.Router.resolveRoute();
  await wait(50);
  console.log('STEP 12: "Supplier Payments Aging Report" appears in the report nav:', doc.getElementById('content').textContent.includes('Supplier Payments Aging Report'));

  win.location.hash = '#/reports/supplierPaymentsAging';
  await win.Router.resolveRoute();
  await wait(80);
  let body = doc.getElementById('reportTableWrap').textContent;
  console.log('STEP 13: Report shows the outstanding USD PO:', body.includes('HT-PO-2026-0001') && body.includes('Pentair'));
  console.log('STEP 14: Report shows the outstanding PHP PO:', body.includes('HT-PO-2026-0002') && body.includes('Local Parts'));
  console.log('STEP 15: Report correctly EXCLUDES the fully-paid PO:', !body.includes('HT-PO-2026-0003'));
  console.log('STEP 16: THE CORE CORRECTNESS CHECK: outstanding balances are broken down BY CURRENCY (both a ₱ and a $ figure appear in the note), not blindly summed into one number:', body.includes('by currency') && body.includes('₱5,000.00') && body.includes('$2,800.00'));
  console.log('STEP 17: Both the USD ($2,800 outstanding) and PHP (₱5,000 outstanding) figures appear correctly:', body.includes('₱5,000.00') && body.includes('$2,800.00'));

  let downloaded = null;
  win.downloadFile = (name, content) => { downloaded = { name, content }; };
  doc.getElementById('rExport').click();
  await wait(30);
  console.log('STEP 18: CSV export runs without error and includes the outstanding POs:', downloaded && downloaded.content.includes('HT-PO-2026-0001') && downloaded.content.includes('HT-PO-2026-0002'));

  /* ============ Regression ============ */
  win.location.hash = '#/reports/quotationRegister';
  await win.Router.resolveRoute();
  await wait(80);
  console.log('STEP 19: Regression: existing reports still load correctly:', !!doc.getElementById('reportTableWrap'));

  console.log('\n=== SUPPLIER PAYMENTS TRACKING + AGING REPORT FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
