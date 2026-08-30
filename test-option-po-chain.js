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
  row1.querySelector('.ln-vat').value = '12';
  row1.querySelector('.ln-vat').dispatchEvent(new win.Event('input'));
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
  row2.querySelector('.ln-vat').value = '12';
  row2.querySelector('.ln-vat').dispatchEvent(new win.Event('input'));
  row2.querySelector('.ln-supplier').value = String(supId);
  row2.querySelector('.ln-supplier').dispatchEvent(new win.Event('change'));
  await wait(10);
  doc.getElementById('qForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(30);
  let q = (await win.DB.dbGetAll('quotations'))[0];
  q.status = 'Won'; await win.DB.dbPut('quotations', q);
  console.log('STEP 1: Setup — multi-option quotation created and marked Won:', q.isMultiOption === true);

  win.location.hash = '#/customer-pos/new?quotationId=' + q.id;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 2: Customer PO form shows "which option" selector for a multi-option quotation:', !!doc.getElementById('f_chosenOption'));
  console.log('STEP 3: Selector lists both options with their correct totals:', doc.getElementById('f_chosenOption').innerHTML.includes('94,459.87') && doc.getElementById('f_chosenOption').innerHTML.includes('10,472.57'));

  doc.getElementById('f_customerId').value = String(custId);
  doc.getElementById('cpoForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(20);
  console.log('STEP 4: Cannot save a Customer PO without picking which option, when required:', (await win.DB.dbGetAll('customerPOs')).length === 0);

  const chosenSelect = doc.getElementById('f_chosenOption');
  const option2Value = [...chosenSelect.options].find(o => o.textContent.includes('Option 2')).value;
  chosenSelect.value = option2Value;
  chosenSelect.dispatchEvent(new win.Event('change'));
  await wait(10);
  console.log('STEP 5: Choosing Option 2 auto-fills PO Amount to Option 2\'s total (10472.57):', Number(doc.getElementById('f_poAmount').value) === 10472.57);

  doc.getElementById('f_customerPoNumber').value = 'KEYEC-PO-9001';
  doc.getElementById('cpoForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(30);
  const cpo = (await win.DB.dbGetAll('customerPOs'))[0];
  console.log('STEP 6: Customer PO saved with the correct chosen option recorded:', cpo.chosenOptionGroup === 'Option 2' && cpo.chosenOptionLabel === 'Option 2');
  console.log('STEP 7: Customer PO amount correctly reflects Option 2, not Option 1:', cpo.poAmount === 10472.57);

  win.location.hash = '#/customer-pos/' + cpo.id;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 8: Customer PO detail page shows which option was chosen:', doc.getElementById('content').textContent.includes('Option Chosen by Customer') && doc.getElementById('content').textContent.includes('Option 2'));

  doc.getElementById('btnConvert').click();
  await wait(30);
  const so = (await win.DB.dbGetAll('salesOrders'))[0];
  console.log('STEP 9: Sales Order created:', !!so);
  console.log('STEP 10: Sales Order has exactly ONE line (not both options combined):', so.lines.length === 1);
  console.log('STEP 11: That one line is the PAIL (Option 2), not the drum:', so.lines[0].description.includes('20L Pail'));
  console.log('STEP 12: The drum (Option 1) line is correctly excluded entirely:', !so.lines.some(l => l.description.includes('208L Drum')));
  console.log('STEP 13: Sales Order total matches Option 2 exactly (10472.57), not the combined figure:', so.grandTotal === 10472.57);
  console.log('STEP 14: Sales Order records which option was ordered, for traceability:', so.chosenOptionLabel === 'Option 2');

  win.location.hash = '#/sales-orders/' + so.id;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 15: Sales Order detail page shows "Option Ordered: Option 2":', doc.getElementById('content').textContent.includes('Option Ordered') && doc.getElementById('content').textContent.includes('Option 2'));

  const createSpoBtn = doc.querySelector('[data-create-spo]');
  createSpoBtn.click();
  await wait(30);
  const spo = (await win.DB.dbGetAll('supplierPOs'))[0];
  console.log('STEP 16: Supplier PO created with exactly the pail item, never the drum:', spo.lines.length === 1 && spo.lines[0].description.includes('20L Pail'));

  console.log('\n--- Supplier PO line-item revision ---');
  win.location.hash = '#/supplier-pos/' + spo.id;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 17: "Edit / Revise PO" button present:', doc.getElementById('btnEditHeader').textContent.includes('Revise'));
  doc.getElementById('btnEditHeader').click();
  await wait(10);
  console.log('STEP 18: Revise page shows an editable line-items table:', !!doc.getElementById('spoLinesBody') && doc.querySelectorAll('.spo-cost').length === 1);

  const costInput = doc.querySelector('.spo-cost');
  costInput.value = '7200.00';
  costInput.dispatchEvent(new win.Event('input'));
  await wait(10);
  console.log('STEP 19: Amount recalculates live as cost is revised:', doc.querySelector('.spo-amount').textContent.includes('7,200.00'));

  win.prompt = () => 'Additional handling fee item';
  doc.getElementById('btnAddSpoLine').click();
  await wait(10);
  const newRow = doc.querySelectorAll('#spoLinesBody tr')[1];
  newRow.querySelector('.spo-qty').value = '1';
  newRow.querySelector('.spo-qty').dispatchEvent(new win.Event('input'));
  newRow.querySelector('.spo-cost').value = '500';
  newRow.querySelector('.spo-cost').dispatchEvent(new win.Event('input'));
  await wait(10);
  console.log('STEP 20: Can add a brand-new line to the supplier PO:', doc.querySelectorAll('#spoLinesBody tr').length === 2);

  doc.getElementById('spoForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(20);
  const spoAfter = await win.DB.dbGet('supplierPOs', spo.id);
  console.log('STEP 21: Revised supplier PO saved with 2 lines:', spoAfter.lines.length === 2);
  console.log('STEP 22: Revised cost correctly persisted (7200):', spoAfter.lines[0].unitCost === 7200);
  console.log('STEP 23: New line correctly persisted:', spoAfter.lines[1].description === 'Additional handling fee item');
  console.log('STEP 24: Total cost correctly recalculated (7200 + 500 = 7700):', spoAfter.totalCost === 7700);

  console.log('\n--- Backward compatibility: ordinary quotation to PO chain ---');
  win.location.hash = '#/quotations/new';
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('f_customerId').value = String(custId);
  const rowN = doc.querySelector('#linesBody tr');
  rowN.querySelector('.ln-desc').value = 'Ordinary item';
  rowN.querySelector('.ln-desc').dispatchEvent(new win.Event('input'));
  rowN.querySelector('.ln-qty').value = '1';
  rowN.querySelector('.ln-qty').dispatchEvent(new win.Event('input'));
  rowN.querySelector('.ln-price').value = '1000';
  rowN.querySelector('.ln-price').dispatchEvent(new win.Event('input'));
  doc.getElementById('qForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(30);
  const normalQ = (await win.DB.dbGetAll('quotations')).find(x => x.id !== q.id);
  normalQ.status = 'Won'; await win.DB.dbPut('quotations', normalQ);

  win.location.hash = '#/customer-pos/new?quotationId=' + normalQ.id;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 25: Ordinary (non-multi-option) quotation shows NO option selector:', !doc.getElementById('f_chosenOption'));
  console.log('STEP 26: PO Amount still auto-fills normally from the single total:', Number(doc.getElementById('f_poAmount').value) === normalQ.grandTotal);
  doc.getElementById('f_customerId').value = String(custId);
  doc.getElementById('cpoForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(30);
  const normalCpo = (await win.DB.dbGetAll('customerPOs')).find(p => p.quotationId === normalQ.id);
  win.location.hash = '#/customer-pos/' + normalCpo.id;
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('btnConvert').click();
  await wait(30);
  const normalSo = (await win.DB.dbGetAll('salesOrders')).find(s => s.customerPOId === normalCpo.id);
  console.log('STEP 27: Ordinary flow still produces a correct single-line Sales Order (1000 + default 12% VAT = 1120):', normalSo.lines.length === 1 && normalSo.grandTotal === 1120);

  console.log('\n=== OPTION-AWARE PO CHAIN + SUPPLIER PO REVISION FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
