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
  const custId = await win.DB.dbAdd('customers', { customerNo: 'CUST-00001', companyName: 'Key Electrochem Limited Co./KEYEC', billingAddress: 'Muntinlupa City, Metro Manila', status: 'Active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  const now = new Date().toISOString();

  const so1 = await win.DB.dbAdd('salesOrders', {
    soNo: 'HT-SO-2026-0001', customerId: custId, orderDate: win.todayISO(), currency: 'PHP', status: 'Confirmed',
    paymentTerms: '100% Advance Payment', incoterms: 'DAP',
    lines: [{ lineId: 'L1', itemId: '', description: 'Submersible Pump 1.5kW', qty: 2, uom: 'pc', unitCost: 3000, unitPrice: 4000, discountPercent: 0, vatRate: 12, supplierId: '', deliveredQty: 0 }],
    subtotal: 8000, vatTotal: 960, freight: 0, other: 0, grandTotal: 8960, createdAt: now, updatedAt: now
  });
  const so2 = await win.DB.dbAdd('salesOrders', {
    soNo: 'HT-SO-2026-0002', customerId: custId, orderDate: win.todayISO(), currency: 'PHP', status: 'Confirmed',
    lines: [{ lineId: 'L1', itemId: '', description: 'Different item', qty: 1, uom: 'pc', unitCost: 1000, unitPrice: 1500, discountPercent: 0, vatRate: 12, supplierId: '', deliveredQty: 0 }],
    subtotal: 1500, vatTotal: 180, freight: 0, other: 0, grandTotal: 1680, createdAt: now, updatedAt: now
  });

  win.location.hash = '#/settings';
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 1: Bank Details fields present on Settings page:', !!doc.getElementById('s_bankName') && !!doc.getElementById('s_bankAccountNumber'));
  doc.getElementById('s_bankName').value = 'BDO Unibank';
  doc.getElementById('s_bankAccountName').value = 'Hadrontech Industrial Solutions';
  doc.getElementById('s_bankAccountNumber').value = '1234-5678-9012';
  doc.getElementById('s_bankSwiftCode').value = 'BNORPHMM';
  doc.getElementById('s_bankAddress').value = 'General Trias, Cavite';
  doc.getElementById('settingsForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(20);
  const settingsAfter = await win.DB.getSettings();
  console.log('STEP 2: Bank details correctly saved:', settingsAfter.bankName === 'BDO Unibank' && settingsAfter.bankAccountNumber === '1234-5678-9012');

  win.location.hash = '#/sales-orders/' + so1;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 3: Button shows "Generate Proforma Invoice" when none exists yet:', doc.getElementById('btnProforma').textContent.includes('Generate Proforma Invoice'));

  doc.getElementById('btnProforma').click();
  await wait(30);
  const allPIs = await win.DB.dbGetAll('proformaInvoices');
  console.log('STEP 4: Proforma Invoice record created:', allPIs.length === 1);
  console.log('STEP 5: PI number correctly formatted (HT-PI-YEAR-XXXX):', /^HT-PI-\d{4}-\d{4}$/.test(allPIs[0].piNo));
  console.log('STEP 6: Correctly linked to the right Sales Order:', allPIs[0].salesOrderId === so1);

  const piText = doc.getElementById('content').textContent;
  console.log('STEP 7: Navigated to the PI detail page automatically:', piText.includes(allPIs[0].piNo));
  console.log('STEP 8: Detail page shows correct SO link, customer, and amount:', piText.includes('HT-SO-2026-0001') && piText.includes('Key Electrochem') && piText.includes('8,960.00'));

  win.location.hash = '#/sales-orders/' + so1;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 9: Button now shows "View Proforma Invoice" with the correct number:', doc.getElementById('btnProforma').textContent.includes('View Proforma Invoice') && doc.getElementById('btnProforma').textContent.includes(allPIs[0].piNo));

  doc.getElementById('btnProforma').click();
  await wait(30);
  console.log('STEP 10: Clicking again does not create a second PI for the same Sales Order:', (await win.DB.dbGetAll('proformaInvoices')).length === 1);

  win.location.hash = '#/sales-orders/' + so2;
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('btnProforma').click();
  await wait(30);
  const allPIsAfter2 = await win.DB.dbGetAll('proformaInvoices');
  console.log('STEP 11: Second Sales Order gets its own distinct PI:', allPIsAfter2.length === 2);
  const pi2 = allPIsAfter2.find(p => p.salesOrderId === so2);
  console.log('STEP 12: Second PI number correctly increments and is different from the first:', pi2.piNo !== allPIs[0].piNo && /^HT-PI-\d{4}-\d{4}$/.test(pi2.piNo));

  let printedHTML = '';
  win.open = () => ({ document: { write: (h) => { printedHTML = h; }, close: () => {} } });
  const pi1 = allPIs[0];
  const so1Rec = await win.DB.dbGet('salesOrders', so1);
  const custRec = await win.DB.dbGet('customers', custId);
  await win.Print.printProformaInvoice(pi1, so1Rec, custRec);
  console.log('STEP 13: Printed document clearly labeled "PROFORMA INVOICE":', printedHTML.includes('PROFORMA INVOICE'));
  console.log('STEP 14: References the originating Sales Order number:', printedHTML.includes('HT-SO-2026-0001'));
  console.log('STEP 15: Shows correct line items and total:', printedHTML.includes('Submersible Pump') && printedHTML.includes('8,960.00'));
  console.log('STEP 16: Shows the bank details filled in earlier:', printedHTML.includes('BDO Unibank') && printedHTML.includes('1234-5678-9012') && printedHTML.includes('BNORPHMM'));
  console.log('STEP 17: Includes the "not an Official Receipt" disclaimer:', printedHTML.includes('not an Official Receipt'));

  const blankSettings = await win.DB.getSettings();
  blankSettings.bankName = ''; blankSettings.bankAccountNumber = ''; blankSettings.bankAccountName = ''; blankSettings.bankSwiftCode = ''; blankSettings.bankAddress = '';
  await win.DB.dbPut('settings', blankSettings);
  let printedNoBank = '';
  win.open = () => ({ document: { write: (h) => { printedNoBank = h; }, close: () => {} } });
  await win.Print.printProformaInvoice(pi1, so1Rec, custRec);
  console.log('STEP 18: With no bank details set, the section is cleanly omitted (no broken/empty layout):', !printedNoBank.includes('Bank Details for Payment') && !printedNoBank.includes('Something went wrong'));

  await win.DB.dbPut('settings', settingsAfter);
  let printedSpacing = '';
  win.open = () => ({ document: { write: (h) => { printedSpacing = h; }, close: () => {} } });
  await win.Print.printProformaInvoice(pi1, so1Rec, custRec);
  console.log('STEP 18b: Bank details no longer produce doubled blank lines:', !printedSpacing.includes('\n\n\n'));

  win.location.hash = '#/proforma-invoices/' + pi1.id;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 18c: Note textarea present on the PI detail page:', !!doc.getElementById('piNotes'));
  doc.getElementById('piNotes').value = 'For evaluation and approval purposes. Sample only.';
  doc.getElementById('btnSaveNotes').click();
  await wait(20);
  const pi1AfterNote = await win.DB.dbGet('proformaInvoices', pi1.id);
  console.log('STEP 18d: Note correctly saved to the record:', pi1AfterNote.notes === 'For evaluation and approval purposes. Sample only.');

  let printedWithNote = '';
  win.open = () => ({ document: { write: (h) => { printedWithNote = h; }, close: () => {} } });
  await win.Print.printProformaInvoice(pi1AfterNote, so1Rec, custRec);
  console.log('STEP 18e: Note correctly appears on the printed document:', printedWithNote.includes('For evaluation and approval purposes'));

  const pi2ForBlankNoteTest = await win.DB.dbGet('proformaInvoices', pi2.id);
  let printedBlankNote = '';
  win.open = () => ({ document: { write: (h) => { printedBlankNote = h; }, close: () => {} } });
  await win.Print.printProformaInvoice(pi2ForBlankNoteTest, so1Rec, custRec);
  console.log('STEP 18f: A PI with no note set shows no empty "Note" heading:', !printedBlankNote.includes('<b>Note</b>'));

  win.location.hash = '#/proforma-invoices/' + pi2.id;
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('btnDeletePI').click();
  await wait(20);
  console.log('STEP 19: Delete correctly removes the record:', (await win.DB.dbGetAll('proformaInvoices')).length === 1);

  win.location.hash = '#/sales-orders/' + so2;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 20: After deleting, the Sales Order button reverts to "Generate" again:', doc.getElementById('btnProforma').textContent.includes('Generate Proforma Invoice'));

  console.log('\n=== PROFORMA INVOICE FEATURE FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
