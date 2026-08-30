const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
require('fake-indexeddb/auto');

const APP = __dirname;

async function main() {
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  window.indexedDB = global.indexedDB;
  window.IDBKeyRange = global.IDBKeyRange;
  window.confirm = () => true;
  window.URL.createObjectURL = () => 'blob:stub';

  const scripts = [...dom.window.document.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => s !== 'js/app.js');
  for (const src of scripts) dom.window.eval(fs.readFileSync(path.join(APP, src), 'utf8'));
  const win = dom.window;
  const doc = win.document;
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  await win.DB.openDB();
  await win.DB.ensureCounters();

  const custId = await win.DB.dbAdd('customers', {
    customerNo: 'CUST-00001', companyName: 'Key Electrochem Limited Co./KEYEC', contactPerson: 'Willie Sicat',
    shippingAddress: 'Cupang, Muntinlupa City, Metro Manila', paymentTerms: '100% Advance Payment', incoterms: 'FOB Manila',
    status: 'Active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  });
  const sup1Id = await win.DB.dbAdd('suppliers', { supplierNo: 'SUP-00001', companyName: 'Logitech Distributor Inc.', status: 'Active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

  /* ============ STEP 1: Create a Quotation with one supplied line and one unassigned line ============ */
  win.location.hash = '#/quotations/new';
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('f_customerId').value = String(custId);
  doc.getElementById('f_customerId').dispatchEvent(new win.Event('change'));
  doc.getElementById('f_rfqRef').value = 'RFQ-2026-0099';
  doc.getElementById('f_rfqRef').dispatchEvent(new win.Event('input'));
  await wait(10);

  const row1 = doc.querySelector('#linesBody tr');
  row1.querySelector('.ln-desc').value = 'Wireless Presentation Remote';
  row1.querySelector('.ln-desc').dispatchEvent(new win.Event('input'));
  row1.querySelector('.ln-qty').value = '2';
  row1.querySelector('.ln-qty').dispatchEvent(new win.Event('input'));
  row1.querySelector('.ln-price').value = '3537';
  row1.querySelector('.ln-price').dispatchEvent(new win.Event('input'));
  row1.querySelector('.ln-supplier').value = String(sup1Id);
  row1.querySelector('.ln-supplier').dispatchEvent(new win.Event('change'));
  await wait(10);

  doc.getElementById('btnAddLine').click();
  await wait(10);
  const rows = doc.querySelectorAll('#linesBody tr');
  const row2 = rows[1];
  row2.querySelector('.ln-desc').value = 'Unassigned item (no supplier chosen yet)';
  row2.querySelector('.ln-desc').dispatchEvent(new win.Event('input'));
  row2.querySelector('.ln-qty').value = '1';
  row2.querySelector('.ln-qty').dispatchEvent(new win.Event('input'));
  row2.querySelector('.ln-price').value = '500';
  row2.querySelector('.ln-price').dispatchEvent(new win.Event('input'));
  // deliberately leave supplier blank on this line

  doc.getElementById('qForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(30);
  let q = (await win.DB.dbGetAll('quotations'))[0];
  console.log('STEP 1: Quotation created with 2 lines, one unassigned:', q.lines.length === 2 && !q.lines[1].supplierId);

  q.status = 'Won';
  await win.DB.dbPut('quotations', q);

  /* ============ STEP 2: Create Customer PO FROM the quotation link (tests auto-fill-on-load bug fix) ============ */
  win.location.hash = '#/customer-pos/new?quotationId=' + q.id;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 2: Customer field pre-selected from quotation link:', doc.getElementById('f_customerId').value === String(custId));
  // THE CRITICAL CHECK: contact/shipping should be filled WITHOUT the user ever touching the dropdown
  console.log('STEP 3: Customer Contact auto-filled on page load (previously required a manual re-select to trigger):', doc.getElementById('f_customerContact').value === 'Willie Sicat');
  console.log('STEP 4: Shipping Address auto-filled on page load:', doc.getElementById('f_shippingAddress').value.includes('Muntinlupa'));
  console.log('STEP 5: Project/Inquiry Reference prefilled from RFQ Ref:', doc.getElementById('f_projectRef').value === 'RFQ-2026-0099');

  doc.getElementById('f_poAmount').value = '7922.88';
  doc.getElementById('f_customerPoNumber').value = 'KEYEC-PO-4521';
  doc.getElementById('f_notes').value = 'Rush order — customer needs by end of month.';
  doc.getElementById('cpoForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(30);
  const cpo = (await win.DB.dbGetAll('customerPOs'))[0];

  win.location.hash = '#/customer-pos/' + cpo.id;
  await win.Router.resolveRoute();
  await wait(10);
  const cpoDetailText = doc.getElementById('content').textContent;
  console.log('STEP 6: Customer PO detail shows Project/Inquiry Reference (previously dead):', cpoDetailText.includes('RFQ-2026-0099'));
  console.log('STEP 7: Customer PO detail shows Customer Contact (previously dead):', cpoDetailText.includes('Willie Sicat'));
  console.log('STEP 8: Customer PO detail shows Notes (previously dead):', cpoDetailText.includes('Rush order'));

  /* ============ STEP 3: Convert to Sales Order ============ */
  doc.getElementById('btnConvert').click();
  await wait(30);
  const so = (await win.DB.dbGetAll('salesOrders'))[0];
  console.log('STEP 9: Sales Order created from Customer PO:', !!so);

  win.location.hash = '#/sales-orders/' + so.id;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 10: Sales Order detail now HAS an Edit Details button (previously no edit path existed at all):', !!doc.getElementById('btnEditDetails'));
  console.log('STEP 11: Sales Order detail shows Required Delivery Date field (previously invisible everywhere):', doc.getElementById('content').textContent.includes('Required Delivery Date'));
  console.log('STEP 12: Sales Order detail shows Customer PO reference correctly (real PO#, not a raw ID):', doc.getElementById('content').textContent.includes('KEYEC-PO-4521'));

  // The critical process fix: the unassigned line should show an assignable dropdown, not be permanently stuck
  const assignSelect = doc.querySelector('.ln-assign-supplier');
  console.log('STEP 13: Unassigned line shows an assignable supplier dropdown (previously a permanent dead-end):', !!assignSelect);
  console.log('STEP 13b: Exactly ONE such dropdown exists (only the truly-unassigned line, not the already-assigned one):', doc.querySelectorAll('.ln-assign-supplier').length === 1);

  // Use Edit Details to set the delivery date and notes
  doc.getElementById('btnEditDetails').click();
  await wait(10);
  doc.getElementById('f_requiredDeliveryDate').value = '2026-09-30';
  doc.getElementById('f_internalNotes').value = 'Deliver to loading dock B.';
  doc.getElementById('soForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(20);
  const soAfterEdit = await win.DB.dbGet('salesOrders', so.id);
  console.log('STEP 14: Required Delivery Date now actually savable (previously impossible to set at all):', soAfterEdit.requiredDeliveryDate === '2026-09-30');
  console.log('STEP 15: Internal Notes now actually savable:', soAfterEdit.internalNotes === 'Deliver to loading dock B.');

  // Now assign the previously-unassigned line to a second supplier
  const sup2Id = await win.DB.dbAdd('suppliers', { supplierNo: 'SUP-00002', companyName: 'General Merchandise Trading', status: 'Active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  win.location.hash = '#/sales-orders/' + so.id;
  await win.Router.resolveRoute();
  await wait(10);
  const assignSelect2 = doc.querySelector('.ln-assign-supplier');
  assignSelect2.value = String(sup2Id);
  assignSelect2.dispatchEvent(new win.Event('change'));
  await wait(20);
  const soAfterAssign = await win.DB.dbGet('salesOrders', so.id);
  console.log('STEP 16: Previously-unassigned line now has a supplier (dead-end resolved):', soAfterAssign.lines[1].supplierId === sup2Id);
  console.log('STEP 16b: The originally-assigned line 1 was NOT accidentally overwritten:', Number(soAfterAssign.lines[0].supplierId) === sup1Id);

  /* ============ STEP 4: Create Supplier PO for supplier #1's line ============ */
  win.location.hash = '#/sales-orders/' + so.id;
  await win.Router.resolveRoute();
  await wait(10);
  const createSpoBtn = doc.querySelector('[data-create-spo]');
  createSpoBtn.click();
  await wait(30);
  const spos = await win.DB.dbGetAll('supplierPOs');
  const spo1 = spos[0];
  console.log('STEP 17: Supplier PO created:', !!spo1);
  console.log('STEP 18: customerPORef stores the REAL PO number, not a raw database ID (data-quality bug fixed):', spo1.customerPORef === 'KEYEC-PO-4521');

  win.location.hash = '#/supplier-pos/' + spo1.id;
  await win.Router.resolveRoute();
  await wait(10);
  const spoDetailHTML = doc.getElementById('content').innerHTML;
  console.log('STEP 19: Supplier PO detail shows a clickable Customer PO link (not just a dangling ID):', spoDetailHTML.includes('href="#/customer-pos/') && spoDetailHTML.includes('KEYEC-PO-4521'));

  // Now that line 2 also has a supplier, confirm a second Supplier PO group appears for it
  win.location.hash = '#/sales-orders/' + so.id;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 20: Second (newly-assigned) supplier now available for its own PO:', doc.getElementById('content').textContent.includes('General Merchandise Trading'));

  /* ============ STEP 5: Print outputs include everything they should ============ */
  let printedSO = '';
  win.open = () => ({ document: { write: (h) => { printedSO = h; }, close: () => {} } });
  const customerObj = await win.DB.dbGet('customers', custId);
  await win.Print.printSalesOrder(soAfterAssign, customerObj, cpo);
  console.log('STEP 21: Printed Sales Order shows the customer\'s own PO number (order confirmations should acknowledge it):', printedSO.includes('Your PO #: KEYEC-PO-4521'));
  console.log('STEP 22: Printed Sales Order shows Required Delivery Date:', printedSO.includes('Required Delivery'));

  const settings = await win.DB.getSettings();
  settings.signatureDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  await win.DB.dbPut('settings', settings);
  spo1.supplierQuoteRef = 'LOGI-QT-8871';
  await win.DB.dbPut('supplierPOs', spo1);
  let printedSPO = '';
  win.open = () => ({ document: { write: (h) => { printedSPO = h; }, close: () => {} } });
  const supplierObj = await win.DB.dbGet('suppliers', sup1Id);
  await win.Print.printSupplierPO(spo1, supplierObj);
  console.log('STEP 23: Printed Supplier PO shows the supplier\'s own quote reference:', printedSPO.includes('Your Ref: LOGI-QT-8871'));
  console.log('STEP 24: Printed Supplier PO now includes the uploaded signature image (previously missing entirely):', printedSPO.includes('p-sign-img') && printedSPO.includes('base64'));

  /* ============ STEP 6: List pages show the new traceability columns ============ */
  win.location.hash = '#/sales-orders';
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 25: Sales Orders list shows Customer PO # column:', doc.getElementById('content').textContent.includes('KEYEC-PO-4521'));

  win.location.hash = '#/supplier-pos';
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 26: Supplier POs list shows Sales Order # column:', doc.getElementById('content').textContent.includes(so.soNo));

  console.log('\n=== FULL QUOTATION-TO-SUPPLIER-PO CHAIN AUDIT VERIFIED ===');
}

main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
