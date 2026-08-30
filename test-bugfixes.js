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
  window.open = () => ({ document: { write: () => {}, close: () => {} } });
  window.URL.createObjectURL = () => 'blob:stub';

  const scripts = [...dom.window.document.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => s !== 'js/app.js');
  for (const src of scripts) dom.window.eval(fs.readFileSync(path.join(APP, src), 'utf8'));
  const win = dom.window;
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  await win.DB.openDB();
  await win.DB.ensureCounters();
  const customers = [];
  const custId = await win.DB.dbAdd('customers', { customerNo: 'CUST-00001', companyName: 'Test Customer Co.', status: 'Active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  console.log('STEP 1: Setup OK, test customer id:', custId);

  /* ---------- FIX 1: New quotation starts at Rev 00 ---------- */
  win.location.hash = '#/quotations/new';
  await win.Router.resolveRoute();
  await wait(10);
  win.document.getElementById('f_customerId').value = String(custId);
  const row = win.document.querySelector('#linesBody tr');
  row.querySelector('.ln-desc').value = 'Test item';
  row.querySelector('.ln-desc').dispatchEvent(new win.Event('input'));
  row.querySelector('.ln-qty').value = '1';
  row.querySelector('.ln-qty').dispatchEvent(new win.Event('input'));
  row.querySelector('.ln-price').value = '1000';
  row.querySelector('.ln-price').dispatchEvent(new win.Event('input'));
  win.document.getElementById('qForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(30);
  const allQuotes1 = await win.DB.dbGetAll('quotations');
  const q1 = allQuotes1[0];
  console.log('STEP 2: New quotation revision is 0 (expect true):', q1.revision === 0);
  console.log('STEP 3: Only ONE quotation record created from one submit (expect true):', allQuotes1.length === 1);
  console.log('STEP 3b: The record has both id and matching familyId set (expect true):', q1.id === q1.familyId);

  // Check display shows "Rev 00"
  win.location.hash = '#/quotations/' + q1.id;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 4: Detail page displays "Rev 00" (expect true):', win.document.getElementById('content').textContent.includes('Rev 00'));

  /* ---------- FIX 2: Rapid double-submit does not create duplicate quotation numbers ---------- */
  win.location.hash = '#/quotations/new';
  await win.Router.resolveRoute();
  await wait(10);
  win.document.getElementById('f_customerId').value = String(custId);
  const row2 = win.document.querySelector('#linesBody tr');
  row2.querySelector('.ln-desc').value = 'Race condition test item';
  row2.querySelector('.ln-desc').dispatchEvent(new win.Event('input'));
  row2.querySelector('.ln-qty').value = '1';
  row2.querySelector('.ln-qty').dispatchEvent(new win.Event('input'));
  row2.querySelector('.ln-price').value = '500';
  row2.querySelector('.ln-price').dispatchEvent(new win.Event('input'));

  // Fire the submit event TWICE in immediate succession, simulating a rapid double-click
  const form = win.document.getElementById('qForm');
  form.dispatchEvent(new win.Event('submit', { cancelable: true }));
  form.dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(50);

  const allQuotes2 = await win.DB.dbGetAll('quotations');
  const newOnes = allQuotes2.filter(q => q.internalNotes !== undefined && q.id !== q1.id); // all quotations besides the first
  const quotationNumbers = allQuotes2.map(q => q.quotationNo);
  const uniqueNumbers = new Set(quotationNumbers);
  console.log('STEP 5: No two quotations share the same quotation number (expect true):', uniqueNumbers.size === quotationNumbers.length);
  console.log('STEP 6: Exactly one additional quotation was created by the double-submit (expect true, got ' + (allQuotes2.length - 1) + '):', allQuotes2.length - 1 === 1);

  /* ---------- Duplicate button should also not create an extra orphaned record ---------- */
  win.location.hash = '#/quotations/' + q1.id;
  await win.Router.resolveRoute();
  await wait(10);
  const beforeDup = (await win.DB.dbGetAll('quotations')).length;
  win.document.getElementById('btnDuplicate').click();
  await wait(30);
  const afterDup = await win.DB.dbGetAll('quotations');
  console.log('STEP 6b: Duplicate button creates exactly ONE new record (expect true, got +' + (afterDup.length - beforeDup) + '):', afterDup.length - beforeDup === 1);
  const dupRecord = afterDup.reduce((a,b) => a.id > b.id ? a : b);
  console.log('STEP 6c: Duplicated record has id === familyId (expect true):', dupRecord.id === dupRecord.familyId);
  console.log('STEP 6d: Duplicated record starts at Rev 00 (expect true):', dupRecord.revision === 0);

  /* ---------- FIX 3: Signature upload persists and appears in print ---------- */
  win.location.hash = '#/settings';
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 7: Signature upload UI present on Settings page:', !!win.document.getElementById('signaturePreview') && !!win.document.getElementById('btnChooseSignature'));

  // Simulate having a signature already stored (bypassing actual file picker, which jsdom can't drive)
  const settings = await win.DB.getSettings();
  settings.signatureDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  settings.authorizedSignatory = 'Juan Dela Cruz';
  await win.DB.dbPut('settings', settings);

  win.location.hash = '#/settings';
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 8: Signature preview shows the uploaded image:', win.document.getElementById('signaturePreview').innerHTML.includes('<img'));
  console.log('STEP 9: Remove button visible when a signature exists:', win.document.getElementById('btnRemoveSignature').style.display !== 'none');

  // Print should include the signature image
  let printedHTML = '';
  win.open = () => ({ document: { write: (h) => { printedHTML = h; }, close: () => {} } });
  win.location.hash = '#/quotations/' + q1.id;
  await win.Router.resolveRoute();
  await wait(10);
  const customerObj = await win.DB.dbGet('customers', custId);
  await win.Print.printQuotation(q1, customerObj);
  await wait(10);
  console.log('STEP 10: Printed quotation includes the signature image:', printedHTML.includes('p-sign-img') && printedHTML.includes('base64'));
  console.log('STEP 11: Printed quotation shows the authorized signatory name:', printedHTML.includes('Juan Dela Cruz'));

  console.log('\n=== ALL BUG-FIX CHECKS COMPLETE ===');
}

main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
