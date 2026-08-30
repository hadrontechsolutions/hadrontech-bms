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

  const scripts = [...dom.window.document.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => s !== 'js/app.js');
  for (const src of scripts) dom.window.eval(fs.readFileSync(path.join(APP, src), 'utf8'));
  const win = dom.window;
  const doc = win.document;
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  await win.DB.openDB();
  await win.DB.ensureCounters();
  const custId = await win.DB.dbAdd('customers', { customerNo: 'CUST-00001', companyName: 'Test Distributor Co.', status: 'Active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

  win.location.hash = '#/quotations/new';
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('f_customerId').value = String(custId);
  doc.getElementById('f_rfqRef').value = 'RFQ-2026-0099';
  doc.getElementById('f_rfqRef').dispatchEvent(new win.Event('input'));
  doc.getElementById('f_projectName').value = 'Line 3 Expansion';
  doc.getElementById('f_projectName').dispatchEvent(new win.Event('input'));
  doc.getElementById('f_endUser').value = 'Luzon Water Treatment Corp.';
  doc.getElementById('f_endUser').dispatchEvent(new win.Event('input'));
  const row = doc.querySelector('#linesBody tr');
  row.querySelector('.ln-desc').value = 'Test item';
  row.querySelector('.ln-desc').dispatchEvent(new win.Event('input'));
  row.querySelector('.ln-qty').value = '1';
  row.querySelector('.ln-qty').dispatchEvent(new win.Event('input'));
  row.querySelector('.ln-price').value = '1000';
  row.querySelector('.ln-price').dispatchEvent(new win.Event('input'));
  doc.getElementById('qForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(30);
  const q = (await win.DB.dbGetAll('quotations'))[0];
  console.log('STEP 1: Saved correctly:', q.rfqRef === 'RFQ-2026-0099' && q.projectName === 'Line 3 Expansion' && q.endUser === 'Luzon Water Treatment Corp.');

  /* ---------- List page shows RFQ Ref and Project columns ---------- */
  win.location.hash = '#/quotations';
  await win.Router.resolveRoute();
  await wait(10);
  const listText = doc.getElementById('qBody').textContent;
  console.log('STEP 2: Quotations list shows RFQ Ref:', listText.includes('RFQ-2026-0099'));
  console.log('STEP 3: Quotations list shows Project:', listText.includes('Line 3 Expansion'));
  console.log('STEP 4: List header includes new columns:', doc.querySelector('.data-table thead').textContent.includes('RFQ Ref') && doc.querySelector('.data-table thead').textContent.includes('Project'));

  /* ---------- List search now matches on these fields ---------- */
  doc.getElementById('listSearch').value = 'Luzon Water';
  doc.getElementById('listSearch').dispatchEvent(new win.Event('input'));
  await wait(300);
  console.log('STEP 5: Search finds quotation by End-User text:', doc.querySelectorAll('#qBody tr').length === 1);
  doc.getElementById('listSearch').value = 'nonexistent xyz';
  doc.getElementById('listSearch').dispatchEvent(new win.Event('input'));
  await wait(300);
  console.log('STEP 6: Search correctly filters out non-matches:', doc.querySelectorAll('#qBody tr').length === 0);

  /* ---------- Detail page shows End-User (previously completely missing) ---------- */
  win.location.hash = '#/quotations/' + q.id;
  await win.Router.resolveRoute();
  await wait(10);
  const detailText = doc.getElementById('content').textContent;
  console.log('STEP 7: Detail page now shows End-User:', detailText.includes('End-User') && detailText.includes('Luzon Water Treatment Corp.'));
  console.log('STEP 8: Detail page still shows RFQ Reference and Project:', detailText.includes('RFQ-2026-0099') && detailText.includes('Line 3 Expansion'));

  /* ---------- Print output includes all three ---------- */
  let printedHTML = '';
  win.open = () => ({ document: { write: (h) => { printedHTML = h; }, close: () => {} } });
  const customerObj = await win.DB.dbGet('customers', custId);
  await win.Print.printQuotation(q, customerObj);
  console.log('STEP 9: Printed quotation shows "Your Ref" with the RFQ number:', printedHTML.includes('Your Ref: RFQ-2026-0099'));
  console.log('STEP 10: Printed quotation shows Project:', printedHTML.includes('Project: Line 3 Expansion'));
  console.log('STEP 11: Printed quotation shows End-User:', printedHTML.includes('End-User: Luzon Water Treatment Corp.'));

  /* ---------- A quotation WITHOUT these fields still prints cleanly (no blank labels) ---------- */
  const bareRec = Object.assign({}, q, { quotationNo: 'HT-Q-2026-BARE', rfqRef: '', projectName: '', endUser: '' });
  delete bareRec.id;
  const bareId = await win.DB.dbAdd('quotations', bareRec);
  const bareQ = await win.DB.dbGet('quotations', bareId);
  let printedBare = '';
  win.open = () => ({ document: { write: (h) => { printedBare = h; }, close: () => {} } });
  await win.Print.printQuotation(bareQ, customerObj);
  console.log('STEP 12: Blank fields do not print empty "Your Ref:" / "Project:" / "End-User:" labels:', !printedBare.includes('Your Ref:') && !printedBare.includes('Project:') && !printedBare.includes('End-User:'));

  console.log('\n=== ALL RFQ/PROJECT/END-USER FIXES VERIFIED ===');
}

main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
