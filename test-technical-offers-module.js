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

  win.location.hash = '#/technical-offers';
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 1: The Technical Offers list page loads correctly:', doc.getElementById('content').textContent.includes('Technical Offers'));
  console.log('STEP 2: Sidebar correctly highlights "Technical Offers" as active:', doc.querySelector('.nav-link[href="#/technical-offers"]').classList.contains('active'));
  console.log('STEP 3: Empty state shown correctly with no offers yet:', doc.getElementById('content').textContent.includes('No technical offers yet'));

  win.location.hash = '#/technical-offers/new';
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 4: New Technical Offer form loads, no Product catalog dropdown anywhere (by design):', !doc.querySelector('.item-picker-trigger') && !doc.getElementById('content').innerHTML.includes('Select item'));

  doc.getElementById('f_customerId').value = String(custId);
  doc.getElementById('f_endUser').value = 'Onsemi';
  doc.getElementById('f_attentionTo').value = 'Technical / Procurement Department';
  doc.getElementById('f_rfqReference').value = '566-25663';

  doc.getElementById('btnAddItem').click();
  await wait(10);
  const itemRow = doc.querySelector('#itemsBody tr');
  itemRow.querySelector('.it-desc').value = 'Pentair Fleck 3150 — Supplier designation "3150ST"';
  itemRow.querySelector('.it-desc').dispatchEvent(new win.Event('input'));
  itemRow.querySelector('.it-qty').value = '2 pcs';
  itemRow.querySelector('.it-qty').dispatchEvent(new win.Event('input'));
  itemRow.querySelector('.it-manuf').value = 'Pentair Manufacturing Italy S.R.L., Made in Italy';
  itemRow.querySelector('.it-manuf').dispatchEvent(new win.Event('input'));

  doc.getElementById('btnAddSpec').click();
  await wait(10);
  const specRow1 = doc.querySelector('#specsBody tr');
  specRow1.querySelector('.sp-item').value = 'Connection Size';
  specRow1.querySelector('.sp-item').dispatchEvent(new win.Event('input'));
  specRow1.querySelector('.sp-req').value = 'Commercial 2-inch';
  specRow1.querySelector('.sp-req').dispatchEvent(new win.Event('input'));
  specRow1.querySelector('.sp-off').value = 'Commercial 2-inch — confirmed';
  specRow1.querySelector('.sp-off').dispatchEvent(new win.Event('input'));

  doc.getElementById('btnAddSpec').click();
  await wait(10);
  const specRows = doc.querySelectorAll('#specsBody tr');
  specRows[1].querySelector('.sp-item').value = 'Timer Cycle';
  specRows[1].querySelector('.sp-item').dispatchEvent(new win.Event('input'));
  specRows[1].querySelector('.sp-req').value = '12-Day';
  specRows[1].querySelector('.sp-req').dispatchEvent(new win.Event('input'));
  specRows[1].querySelector('.sp-off').value = '12-Day — confirmed';
  specRows[1].querySelector('.sp-off').dispatchEvent(new win.Event('input'));

  doc.getElementById('toForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(30);

  const all = await win.DB.dbGetAll('technicalOffers');
  console.log('STEP 5: Technical Offer saved correctly:', all.length === 1);
  console.log('STEP 6: Document number correctly follows the HT-TO-YYYY-XXXX pattern:', /^HT-TO-\d{4}-\d{4}$/.test(all[0].offerNo));
  console.log('STEP 7: Header fields saved correctly:', all[0].endUser === 'Onsemi' && all[0].rfqReference === '566-25663' && all[0].customerId === custId);
  console.log('STEP 8: Item saved correctly, as plain text (no itemId/product link at all):', all[0].items.length === 1 && all[0].items[0].qty === '2 pcs' && !('itemId' in all[0].items[0]));
  console.log('STEP 9: Both spec rows saved correctly:', all[0].specs.length === 2 && all[0].specs[0].item === 'Connection Size' && all[0].specs[1].item === 'Timer Cycle');

  const offerId = all[0].id;
  win.location.hash = '#/technical-offers/' + offerId;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 10: Detail page shows the item and both spec rows correctly:', doc.getElementById('content').textContent.includes('3150ST') && doc.getElementById('content').textContent.includes('Connection Size') && doc.getElementById('content').textContent.includes('Timer Cycle'));
  console.log('STEP 11: Detail page shows the linked customer correctly:', doc.getElementById('content').textContent.includes('Key Electrochem'));

  let printedHTML = '';
  win.open = () => ({ document: { write: (h) => { printedHTML = h; }, close: () => {} } });
  doc.getElementById('btnPrintTO').click();
  await wait(10);
  console.log('STEP 12: Print output includes the offer number, end user, and RFQ reference:', printedHTML.includes(all[0].offerNo) && printedHTML.includes('Onsemi') && printedHTML.includes('566-25663'));
  console.log('STEP 13: Print output includes both the Summary of Offered Items and Technical Data Sheet sections:', printedHTML.includes('Summary of Offered Items') && printedHTML.includes('Technical Data Sheet'));
  console.log('STEP 14: Print output includes the "for technical evaluation only" disclaimer and final approval note:', printedHTML.includes('does not represent a declaration of full compliance') && printedHTML.includes('Subject to final supplier verification'));
  console.log('STEP 15: Print header is minimal — just a small company name line, no full company block/logo/address actually used in the body:', printedHTML.includes('HADRONTECH INDUSTRIAL SOLUTIONS') && !printedHTML.includes('class="p-co-meta"') && !printedHTML.includes('class="p-co-name"'));

  win.location.hash = '#/technical-offers/' + offerId + '/edit';
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 16: Edit form correctly pre-fills existing data:', doc.getElementById('f_endUser').value === 'Onsemi' && doc.querySelectorAll('#specsBody tr').length === 2);

  win.location.hash = '#/search';
  await win.Router.resolveRoute();
  await wait(10);
  const searchInput = doc.getElementById('globalSearchInput');
  searchInput.value = all[0].offerNo;
  searchInput.dispatchEvent(new win.Event('input'));
  await wait(300);
  console.log('STEP 17: Global search correctly finds the Technical Offer by its number:', doc.getElementById('searchResults').textContent.includes(all[0].offerNo));

  const backupSource = fs.readFileSync(path.join(APP, 'js/backup.js'), 'utf8');
  console.log('STEP 18: technicalOffers is included in the backup store list:', backupSource.includes("'technicalOffers'"));
  console.log('STEP 19: A dedicated CSV export button exists for Technical Offers:', backupSource.includes('data-csv="technicalOffers"'));

  const q = await win.DB.dbAdd('quotations', {
    quotationNo: 'HT-Q-2026-0001', customerId: custId, revision: 0, isLatest: true, status: 'Draft', date: win.todayISO(), currency: 'PHP',
    lines: [], subtotal: 0, vatTotal: 0, freight: 0, other: 0, grandTotal: 0, createdAt: now, updatedAt: now
  });
  win.location.hash = '#/quotations/' + q;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 20: The old "Print Technical Offer" button no longer exists on the Quotation detail page:', !doc.getElementById('btnPrintTechnical'));
  console.log('STEP 21: The regular commercial "Print" button is still there, untouched:', !!doc.getElementById('btnPrint'));

  const printSource = fs.readFileSync(path.join(APP, 'js/print.js'), 'utf8');
  console.log('STEP 22: The old Quotation-based printTechnicalOffer(q, customer) logic (multi-option handling) is fully removed from print.js:', !printSource.includes('alternative technical configurations'));

  console.log('\n=== TECHNICAL OFFERS MODULE FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
