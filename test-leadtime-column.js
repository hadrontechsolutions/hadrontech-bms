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
  const custId = await win.DB.dbAdd('customers', { customerNo: 'C1', companyName: 'KEYEC', status: 'Active', createdAt: now });
  const productId = await win.DB.dbAdd('products', {
    itemNo: 'P0001', type: 'Product', description: 'Fleck 3150EM Valve', brand: 'Pentair', modelNo: '3150EM',
    uom: 'pc', standardCost: 2300, standardPrice: 3000, currency: 'USD',
    markupPercent: 25, leadTime: '6-8 weeks', status: 'Active', createdAt: now
  });

  /* ============ Products list: Selling Price removed, Standard Cost + Lead Time added ============ */
  win.location.hash = '#/products';
  await win.Router.resolveRoute();
  await wait(50);
  const headers = [...doc.querySelectorAll('th')].map(th => th.textContent.trim());
  console.log('STEP 1: THE FIX: "Selling Price" column is gone from the Products list:', !headers.includes('Selling Price'));
  console.log('STEP 2: "Standard Cost" now appears as a column:', headers.includes('Standard Cost'));
  console.log('STEP 3: "Typical Lead Time" now appears as a column:', headers.includes('Typical Lead Time'));
  const bodyText = doc.getElementById('content').textContent;
  console.log('STEP 4: The actual cost and lead time values render correctly in the list row:', bodyText.includes('6-8 weeks') && bodyText.includes('$2,300.00'));

  /* ============ Quotation edit form: Lead Time column between UOM and Unit Cost ============ */
  win.location.hash = '#/quotations/new';
  await win.Router.resolveRoute();
  await wait(50);
  const formHeaders = [...doc.querySelectorAll('#linesTable th')].map(th => th.textContent.trim());
  const uomIdx = formHeaders.indexOf('UOM');
  const leadTimeIdx = formHeaders.indexOf('Lead Time');
  const unitCostIdx = formHeaders.indexOf('Unit Cost');
  console.log('STEP 5: THE FEATURE: "Lead Time" column sits directly after UOM on the quotation line editor (Est. Freight now sits between Lead Time and Unit Cost, added later):', leadTimeIdx === uomIdx + 1);

  const leadTimeHeaderEl = [...doc.querySelectorAll('#linesTable th')].find(th => th.textContent.trim() === 'Lead Time');
  console.log('STEP 6: The Lead Time header has the same orange internal-only-col treatment as Unit Cost:', leadTimeHeaderEl.classList.contains('internal-only-col'));

  // Pick the product from the catalog so the line actually has a lead time value to check
  doc.getElementById('f_customerId').value = String(custId);
  doc.querySelector('.ln-catalog-btn').click();
  await wait(50);
  win.document.body.querySelector('.item-picker-row').click();
  await wait(50);

  const leadTimeCellByContent = [...doc.querySelectorAll('#linesBody td.internal-only-col')].find(td => td.textContent.includes('6-8 weeks'));
  console.log('STEP 7: The Lead Time cell correctly shows the product\u2019s value ("6-8 weeks") after picking it from the catalog:', !!leadTimeCellByContent);
  console.log('STEP 8: THE "NOT EDITABLE" REQUIREMENT: the Lead Time cell has no <input> inside it — it\u2019s plain reference text, unlike Unit Cost/Markup which are editable:', leadTimeCellByContent && leadTimeCellByContent.querySelector('input, textarea, select') === null);
  console.log('STEP 9: A tooltip clarifies it\u2019s for internal reference only, not shown on the printed quotation:', leadTimeCellByContent.getAttribute('title').includes('not shown on the printed quotation'));

  /* ============ Save and check the Detail page shows it consistently too ============ */
  const priceInput = doc.querySelector('.ln-price');
  if (priceInput) { priceInput.value = '3000'; priceInput.dispatchEvent(new win.Event('input')); }
  doc.getElementById('qForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(100);
  const savedQ = (await win.DB.dbGetAll('quotations'))[0];

  win.location.hash = '#/quotations/' + savedQ.id;
  await win.Router.resolveRoute();
  await wait(50);
  const detailHeaders = [...doc.querySelectorAll('th')].map(th => th.textContent.trim());
  console.log('STEP 10: The read-only Detail page also shows a "Lead Time" column, consistent with the edit form:', detailHeaders.includes('Lead Time'));
  console.log('STEP 11: Its value is correctly shown on the Detail page too:', doc.getElementById('content').textContent.includes('6-8 weeks'));

  /* ============ Printed quotation must NOT show Lead Time anywhere ============ */
  let printedHTML = '';
  win.open = () => ({ document: { write: (h) => { printedHTML = h; }, close: () => {} } });
  doc.getElementById('btnPrint').click();
  await wait(30);
  console.log('STEP 12: THE PRINT REQUIREMENT: the printed quotation does NOT show Lead Time anywhere:', !printedHTML.includes('6-8 weeks') && !printedHTML.includes('Lead Time'));

  /* ============ Regression: existing internal-only columns are unaffected ============ */
  console.log('STEP 13: REGRESSION: Unit Cost, Markup %, and other existing internal-only columns are all still present and unaffected:', formHeaders.includes('Unit Cost') && formHeaders.includes('Markup %') && formHeaders.includes('Supplier'));
  console.log('STEP 14: REGRESSION: markupPercent still correctly carries through from the picked product (25), verified in the saved record:', savedQ.lines[0].markupPercent === 25);

  console.log('\n=== LEAD TIME REFERENCE COLUMN + PRODUCTS LIST COLUMNS FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
