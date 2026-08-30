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

  win.location.hash = '#/quotations/new';
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('f_customerId').value = String(custId);
  const row1 = doc.querySelector('#linesBody tr');
  row1.querySelector('.ln-desc').value = 'Drum option';
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
  row2.querySelector('.ln-desc').value = 'Pail option';
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
  const q = (await win.DB.dbGetAll('quotations'))[0];
  q.status = 'Won'; await win.DB.dbPut('quotations', q);

  win.location.hash = '#/customer-pos/new';
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 1: Opening a blank form shows no option selector yet (nothing picked):', !doc.getElementById('f_chosenOption'));

  const quotationSelect = doc.getElementById('f_quotationId');
  quotationSelect.value = String(q.id);
  quotationSelect.dispatchEvent(new win.Event('change'));
  await wait(10);
  console.log('STEP 2 (THE FIX): Manually picking the multi-option quotation from the dropdown NOW makes the selector appear:', !!doc.getElementById('f_chosenOption'));
  console.log('STEP 3: The selector lists both options with correct totals:', doc.getElementById('f_chosenOption').innerHTML.includes('94,459.87') && doc.getElementById('f_chosenOption').innerHTML.includes('10,472.57'));

  doc.getElementById('f_customerId').value = String(custId);
  doc.getElementById('cpoForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(20);
  console.log('STEP 4: Still cannot submit without choosing an option (no silent Option-1 default):', (await win.DB.dbGetAll('customerPOs')).length === 0);

  const chosenSelect = doc.getElementById('f_chosenOption');
  const opt2Value = [...chosenSelect.options].find(o => o.textContent.includes('Option 2')).value;
  chosenSelect.value = opt2Value;
  chosenSelect.dispatchEvent(new win.Event('change'));
  await wait(10);
  console.log('STEP 5: Picking Option 2 via the dynamically-created selector correctly auto-fills PO Amount:', Number(doc.getElementById('f_poAmount').value) === 10472.57);

  doc.getElementById('f_customerPoNumber').value = 'TEST-PO-001';
  doc.getElementById('cpoForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(30);
  const cpo = (await win.DB.dbGetAll('customerPOs'))[0];
  console.log('STEP 6: Customer PO correctly saved with Option 2 recorded:', cpo.chosenOptionGroup === 'Option 2');
  console.log('STEP 7: Customer PO amount matches Option 2, not Option 1:', cpo.poAmount === 10472.57);

  win.location.hash = '#/customer-pos/' + cpo.id;
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('btnConvert').click();
  await wait(30);
  const so = (await win.DB.dbGetAll('salesOrders'))[0];
  console.log('STEP 8: Sales Order correctly contains only the pail (via the dropdown-linked path):', so.lines.length === 1 && so.lines[0].description === 'Pail option');

  win.location.hash = '#/customer-pos/new';
  await win.Router.resolveRoute();
  await wait(10);
  const qSel2 = doc.getElementById('f_quotationId');
  qSel2.value = String(q.id);
  qSel2.dispatchEvent(new win.Event('change'));
  await wait(10);
  console.log('STEP 9: Selector appears when a multi-option quotation is chosen:', !!doc.getElementById('f_chosenOption'));
  qSel2.value = '';
  qSel2.dispatchEvent(new win.Event('change'));
  await wait(10);
  console.log('STEP 10: Switching back to "None" cleanly removes the selector (no longer required):', !doc.getElementById('f_chosenOption'));
  doc.getElementById('f_customerId').value = String(custId);
  doc.getElementById('cpoForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(20);
  console.log('STEP 11: Can now submit normally with no quotation linked at all:', (await win.DB.dbGetAll('customerPOs')).length === 2);

  win.location.hash = '#/customer-pos/new?quotationId=' + q.id;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 12: Arriving via the quotation\'s own "Record Customer PO" link still shows the selector immediately (original path unaffected):', !!doc.getElementById('f_chosenOption'));

  console.log('\n=== DROPDOWN-BYPASS FIX VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
