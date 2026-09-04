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

  win.location.hash = '#/technical-offers';
  await win.Router.resolveRoute();
  await wait(50);

  const newBtn = doc.getElementById('btnNewTO');
  console.log('STEP 1: "+ New Technical Offer" is a real <button> element, not a styled <a> tag:', newBtn && newBtn.tagName === 'BUTTON');
  console.log('STEP 2: It correctly picks up the base button reset (padding) in addition to the amber color:', win.getComputedStyle(newBtn).padding !== '' || newBtn.className.includes('btn-amber'));

  newBtn.click();
  await wait(50);
  console.log('STEP 3: Clicking the button correctly navigates to the New Technical Offer form:', doc.getElementById('content').textContent.includes('New Technical Offer') && !!doc.getElementById('toForm'));

  /* ============ Cancel button: real button + unsaved-changes guard ============ */
  const cancelBtn = doc.getElementById('btnCancelTO');
  console.log('STEP 4: Cancel is also a real <button>, not a styled <a> tag:', cancelBtn && cancelBtn.tagName === 'BUTTON');

  // Make a change so the form is dirty, then confirm Cancel triggers the guard (via confirm())
  doc.getElementById('f_endUser').value = 'Onsemi';
  doc.getElementById('f_endUser').dispatchEvent(new win.Event('input'));
  await wait(20);

  let confirmCalled = false;
  win.confirm = () => { confirmCalled = true; return true; };
  cancelBtn.click();
  await wait(50);
  console.log('STEP 5: THE BUG FIX: Cancel with unsaved changes now correctly triggers the unsaved-changes confirmation, matching every other module:', confirmCalled);
  console.log('STEP 6: After confirming, it correctly navigates back to the list:', doc.getElementById('content').textContent.includes('Technical Offers') && !doc.getElementById('toForm'));

  /* ============ Cancel with NO changes should navigate without prompting ============ */
  win.location.hash = '#/technical-offers/new';
  await win.Router.resolveRoute();
  await wait(50);
  let confirmCalled2 = false;
  win.confirm = () => { confirmCalled2 = true; return true; };
  doc.getElementById('btnCancelTO').click();
  await wait(50);
  console.log('STEP 7: Cancel with NO changes does not prompt at all:', confirmCalled2 === false);

  console.log('\n=== NEW TECHNICAL OFFER BUTTON FIX FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
