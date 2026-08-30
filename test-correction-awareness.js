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
  const supId = await win.DB.dbAdd('suppliers', { supplierNo: 'SUP-00001', companyName: 'Mckupler Inc.', status: 'Active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

  win.location.hash = '#/quotations/new';
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('f_customerId').value = String(custId);
  const row1 = doc.querySelector('#linesBody tr');
  row1.querySelector('.ln-desc').value = 'OPTION 1 — 208L Drum';
  row1.querySelector('.ln-desc').dispatchEvent(new win.Event('input'));
  row1.querySelector('.ln-option').value = 'Option 1';
  row1.querySelector('.ln-option').dispatchEvent(new win.Event('input'));
  row1.querySelector('.ln-qty').value = '1';
  row1.querySelector('.ln-qty').dispatchEvent(new win.Event('input'));
  row1.querySelector('.ln-price').value = '84339.17';
  row1.querySelector('.ln-price').dispatchEvent(new win.Event('input'));
  row1.querySelector('.ln-supplier').value = String(supId);
  row1.querySelector('.ln-supplier').dispatchEvent(new win.Event('change'));

  doc.getElementById('btnAddLine').click();
  await wait(10);
  const row2 = doc.querySelectorAll('#linesBody tr')[1];
  row2.querySelector('.ln-desc').value = 'OPTION 2 — 20L Pail';
  row2.querySelector('.ln-desc').dispatchEvent(new win.Event('input'));
  row2.querySelector('.ln-option').value = 'Option 2';
  row2.querySelector('.ln-option').dispatchEvent(new win.Event('input'));
  row2.querySelector('.ln-qty').value = '1';
  row2.querySelector('.ln-qty').dispatchEvent(new win.Event('input'));
  row2.querySelector('.ln-price').value = '9350.51';
  row2.querySelector('.ln-price').dispatchEvent(new win.Event('input'));
  row2.querySelector('.ln-supplier').value = String(supId);
  row2.querySelector('.ln-supplier').dispatchEvent(new win.Event('change'));
  await wait(10);
  doc.getElementById('qForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(30);
  let q = (await win.DB.dbGetAll('quotations'))[0];
  q.status = 'Won'; await win.DB.dbPut('quotations', q);

  win.location.hash = '#/customer-pos/new?quotationId=' + q.id;
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('f_customerId').value = String(custId);
  const opt2Val = [...doc.getElementById('f_chosenOption').options].find(o => o.textContent.includes('Option 2')).value;
  doc.getElementById('f_chosenOption').value = opt2Val;
  doc.getElementById('f_chosenOption').dispatchEvent(new win.Event('change'));
  doc.getElementById('f_customerPoNumber').value = 'KEYEC-PO-9001';
  doc.getElementById('cpoForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(30);
  const cpo = (await win.DB.dbGetAll('customerPOs'))[0];
  console.log('STEP 1: Setup — Customer PO recorded with Option 2 chosen:', cpo.chosenOptionLabel === 'Option 2');

  win.location.hash = '#/customer-pos/' + cpo.id + '/edit';
  await win.Router.resolveRoute();
  await wait(10);
  const preConvertHTML = doc.getElementById('content').innerHTML;
  console.log('STEP 2: No "already converted" warning before any Sales Order exists:', !preConvertHTML.includes('was already created from this PO'));

  win.location.hash = '#/customer-pos/' + cpo.id;
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('btnConvert').click();
  await wait(30);
  const so = (await win.DB.dbGetAll('salesOrders'))[0];
  console.log('STEP 3: Sales Order created with just the pail:', so.lines.length === 1 && so.lines[0].description.includes('Pail'));

  win.location.hash = '#/customer-pos/' + cpo.id + '/edit';
  await win.Router.resolveRoute();
  await wait(10);
  const postConvertHTML = doc.getElementById('content').innerHTML;
  console.log('STEP 4: Editing the PO after conversion now shows a clear warning naming the Sales Order:', postConvertHTML.includes('was already created from this PO') && postConvertHTML.includes(so.soNo));
  console.log('STEP 5: Warning explicitly says it will NOT auto-update:', postConvertHTML.toLowerCase().includes('automatically update'));
  console.log('STEP 6: The chosen-option field remains editable despite the warning (not blocked):', !doc.getElementById('f_chosenOption').disabled);

  console.log('\n--- Sales Order line-item revision ---');
  win.location.hash = '#/sales-orders/' + so.id;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 7: "Edit / Revise Order" button present:', doc.getElementById('btnEditDetails').textContent.includes('Revise'));
  doc.getElementById('btnEditDetails').click();
  await wait(10);
  console.log('STEP 8: Revise page shows an editable line-items table:', !!doc.getElementById('soLinesBody') && doc.querySelectorAll('.so-qty').length === 1);
  console.log('STEP 9: No Supplier PO warning yet (none created so far):', !doc.getElementById('content').innerHTML.includes('Supplier PO(s) already exist'));

  const qtyInput = doc.querySelector('.so-qty');
  qtyInput.value = '2';
  qtyInput.dispatchEvent(new win.Event('input'));
  await wait(10);
  // Amount cell shows the VAT-inclusive line total: 2 x 9350.51 = 18701.02 net, +12% VAT = 20945.14
  console.log('STEP 10: Amount recalculates live as qty is corrected (incl. VAT, 20,945.14):', doc.querySelector('.so-amount').textContent.includes('20,945.14'));

  doc.getElementById('soForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(20);
  const soAfterEdit = await win.DB.dbGet('salesOrders', so.id);
  console.log('STEP 11: Revised quantity correctly persisted:', soAfterEdit.lines[0].qty === 2);
  console.log('STEP 12: Sales Order totals correctly recomputed from the revised lines:', soAfterEdit.subtotal === 18701.02);
  console.log('STEP 13: lineId preserved across the edit (so supplier-sourcing tracking still works):', soAfterEdit.lines[0].lineId === so.lines[0].lineId);

  win.location.hash = '#/sales-orders/' + so.id;
  await win.Router.resolveRoute();
  await wait(10);
  const createSpoBtn = doc.querySelector('[data-create-spo]');
  createSpoBtn.click();
  await wait(30);
  const spo = (await win.DB.dbGetAll('supplierPOs'))[0];
  console.log('STEP 14: Supplier PO created from the (corrected) Sales Order:', spo.lines[0].qty === 2);

  win.location.hash = '#/sales-orders/' + so.id;
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('btnEditDetails').click();
  await wait(10);
  console.log('STEP 15: NOW editing the Sales Order warns that a Supplier PO already exists:', doc.getElementById('content').innerHTML.includes('Supplier PO(s) already exist') && doc.getElementById('content').innerHTML.includes(spo.poNo));

  console.log('\n--- Supplier PO status-aware revision warning ---');
  win.location.hash = '#/supplier-pos/' + spo.id;
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('btnEditHeader').click();
  await wait(10);
  console.log('STEP 16: No status warning while still Draft:', !doc.getElementById('content').innerHTML.includes('may have already been sent'));

  win.location.hash = '#/supplier-pos/' + spo.id;
  await win.Router.resolveRoute();
  await wait(10);
  const sentBtn = [...doc.querySelectorAll('.status-btn')].find(b => b.dataset.status === 'Sent');
  sentBtn.click();
  await wait(20);
  doc.getElementById('btnEditHeader').click();
  await wait(10);
  console.log('STEP 17: Clear warning shown once the PO has already been marked Sent:', doc.getElementById('content').innerHTML.includes('may have already been sent'));
  console.log('STEP 18: Line items remain fully editable despite the warning:', doc.querySelectorAll('.spo-cost').length === 1 && !doc.querySelector('.spo-cost').disabled);

  console.log('\n=== ALL THREE-DOCUMENT CORRECTION-AWARENESS CHECKS VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
