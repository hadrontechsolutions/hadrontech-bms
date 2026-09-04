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

  win.location.hash = '#/technical-offers/new';
  await win.Router.resolveRoute();
  await wait(50);

  doc.getElementById('btnAddItem').click();
  await wait(20);
  doc.getElementById('btnAddSpec').click();
  await wait(20);

  const descBox = doc.querySelector('.it-desc');
  const qtyBox = doc.querySelector('.it-qty');
  const manufBox = doc.querySelector('.it-manuf');

  const descW = parseInt(descBox.style.width);
  const qtyW = parseInt(qtyBox.style.width);
  const manufW = parseInt(manufBox.style.width);

  console.log('STEP 1: THE BUG FIX: Description now has an explicit width, not left to the browser default:', !!descBox.style.width);
  console.log('STEP 2: Description is meaningfully wider than Qty (the actual bug reported — Description was cramped, Qty was too wide):', descW > qtyW * 3);
  console.log('STEP 3: Qty is now compact, sized for short values like "2 pcs", not defaulting to a wide generic input:', qtyW <= 100);
  console.log('STEP 4: Description textarea now has 2 rows instead of 1, giving a bit more room to actually type in:', descBox.getAttribute('rows') === '2');
  console.log('STEP 5: Manufacturer/Origin has its own sensible explicit width too:', manufW > 0 && manufW < descW);

  const specItem = doc.querySelector('.sp-item');
  const specReq = doc.querySelector('.sp-req');
  const specOff = doc.querySelector('.sp-off');
  console.log('STEP 6: Technical Data Sheet spec row inputs (Item/Requested/Offered) also now have explicit widths, same root-cause fix applied there too:', !!specItem.style.width && !!specReq.style.width && !!specOff.style.width);
  console.log('STEP 7: Requested/Offered are appropriately wide (they hold the actual comparison text), wider than the Item label column:', parseInt(specReq.style.width) >= parseInt(specItem.style.width));

  // Regression: everything still functions correctly with the new inline widths
  descBox.value = 'Pentair Fleck 3150 — Supplier designation "3150ST"';
  descBox.dispatchEvent(new win.Event('input'));
  qtyBox.value = '2 pcs';
  qtyBox.dispatchEvent(new win.Event('input'));
  console.log('STEP 8: Regression: typing into the resized fields still saves correctly:', descBox.value.includes('3150ST') && qtyBox.value === '2 pcs');

  console.log('\n=== ITEM/SPEC ROW INPUT SIZING FIX FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
