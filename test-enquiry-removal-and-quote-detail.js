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

  /* ---------- Enquiries: nav removed, but old data safely preserved ---------- */
  // Simulate a pre-existing enquiry record from before the tab was removed (real users may have this)
  await win.DB.dbAdd('enquiries', { enquiryNo: 'HT-ENQ-2026-0001', customerId: 1, subject: 'Legacy enquiry', stage: 'New Enquiry', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

  console.log('STEP 1: "Enquiries" nav link removed from sidebar:', !doc.querySelector('[data-section="/enquiries"]'));
  console.log('STEP 2: enquiries.js no longer loaded as a script:', ![...doc.querySelectorAll('script[src]')].some(s => s.src && s.src.includes('enquiries.js')));

  win.location.hash = '#/dashboard';
  await win.Router.resolveRoute();
  await wait(10);
  const dashText = doc.getElementById('content').textContent;
  console.log('STEP 3: Dashboard has no "Open Enquiries" widget:', !dashText.includes('Open Enquiries'));
  console.log('STEP 4: Dashboard has no "Overdue Payments" widget:', !dashText.includes('Overdue Payments'));
  console.log('STEP 5: Dashboard has no "New Enquiry" quick action:', !dashText.includes('New Enquiry'));
  console.log('STEP 6: Dashboard still renders normally otherwise:', dashText.includes('Active Customers') && dashText.includes('Open Quotations'));

  // Old enquiry route no longer resolves, but importantly does NOT throw a JS error
  win.location.hash = '#/enquiries';
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 7: Visiting the old /enquiries URL fails gracefully (no crash):', !doc.getElementById('content').innerHTML.includes('Something went wrong'));

  // Most importantly: the underlying data was NOT deleted — fully reversible
  const preservedEnquiries = await win.DB.dbGetAll('enquiries');
  console.log('STEP 8: Old enquiry data still intact in the database (reversible removal):', preservedEnquiries.length === 1 && preservedEnquiries[0].enquiryNo === 'HT-ENQ-2026-0001');

  /* ---------- Quotation detail page now shows everything without needing Edit ---------- */
  const custId = await win.DB.dbAdd('customers', { customerNo: 'CUST-00001', companyName: 'Key Electrochem Limited Co./KEYEC', paymentTerms: '100% Advance Payment', incoterms: 'FOB Manila', status: 'Active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  const supId = await win.DB.dbAdd('suppliers', { supplierNo: 'SUP-00001', companyName: 'Logitech Distributor Inc.', status: 'Active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

  win.location.hash = '#/quotations/new';
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('f_customerId').value = String(custId);
  doc.getElementById('f_customerId').dispatchEvent(new win.Event('change'));
  await wait(10);
  doc.getElementById('f_deliveryLeadTime').value = '7 - 10 Days';
  doc.getElementById('f_deliveryLeadTime').dispatchEvent(new win.Event('input'));
  doc.getElementById('f_warranty').value = 'As per manufacturer standard';
  doc.getElementById('f_warranty').dispatchEvent(new win.Event('input'));
  doc.getElementById('f_overallDiscountPercent').value = '5';
  doc.getElementById('f_overallDiscountPercent').dispatchEvent(new win.Event('input'));
  doc.getElementById('f_internalNotes').value = 'Customer usually pays late — confirm PO before booking freight.';
  doc.getElementById('f_internalNotes').dispatchEvent(new win.Event('input'));
  doc.getElementById('f_customerNotes').value = 'Thank you for your inquiry.';
  doc.getElementById('f_customerNotes').dispatchEvent(new win.Event('input'));

  const row = doc.querySelector('#linesBody tr');
  row.querySelector('.ln-desc').value = 'Wireless Presentation Remote';
  row.querySelector('.ln-desc').dispatchEvent(new win.Event('input'));
  row.querySelector('.ln-qty').value = '2';
  row.querySelector('.ln-qty').dispatchEvent(new win.Event('input'));
  row.querySelector('.ln-cost').value = '1965';
  row.querySelector('.ln-cost').dispatchEvent(new win.Event('input'));
  row.querySelector('.ln-markup').value = '80';
  row.querySelector('.ln-markup').dispatchEvent(new win.Event('input'));
  row.querySelector('.ln-supplier').value = String(supId);
  row.querySelector('.ln-supplier').dispatchEvent(new win.Event('change'));
  await wait(10);

  doc.getElementById('qForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(30);
  const q = (await win.DB.dbGetAll('quotations'))[0];

  win.location.hash = '#/quotations/' + q.id;
  await win.Router.resolveRoute();
  await wait(10);
  const detailText = doc.getElementById('content').textContent;

  console.log('STEP 9: Detail page shows Delivery Lead Time (previously missing):', detailText.includes('7 - 10 Days'));
  console.log('STEP 10: Detail page shows Warranty (previously missing):', detailText.includes('As per manufacturer standard'));
  console.log('STEP 11: Detail page shows VAT Mode (previously missing):', detailText.includes('Standard 12%'));
  console.log('STEP 12: Detail page shows Overall Discount % (previously missing):', detailText.includes('5%'));
  console.log('STEP 13: Detail page shows Internal Notes (previously missing):', detailText.includes('confirm PO before booking freight'));
  console.log('STEP 14: Detail page shows Customer Notes (previously missing):', detailText.includes('Thank you for your inquiry'));
  console.log('STEP 15: Line item table shows Unit Cost (previously hidden, required Edit to see):', detailText.includes('1,965.00'));
  console.log('STEP 16: Line item table shows Supplier (previously hidden, required Edit to see):', detailText.includes('Logitech Distributor Inc.'));
  console.log('STEP 17: Line item table shows per-line Margin % (new addition):', doc.getElementById('content').innerHTML.includes('Margin%'));
  console.log('STEP 18: Totals panel shows internal Total Cost (previously missing):', detailText.includes('Total Cost (internal)'));

  console.log('\n=== ENQUIRIES REMOVAL + QUOTATION DETAIL FIXES VERIFIED ===');
}

main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
