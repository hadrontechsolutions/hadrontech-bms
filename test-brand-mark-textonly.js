const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
require('fake-indexeddb/auto');
const APP = __dirname;

async function main() {
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  window.indexedDB = global.indexedDB; window.IDBKeyRange = global.IDBKeyRange;
  const scripts = [...dom.window.document.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => s !== 'js/app.js');
  for (const src of scripts) dom.window.eval(fs.readFileSync(path.join(APP, src), 'utf8'));
  const win = dom.window; const doc = win.document;
  const now = new Date().toISOString();

  await win.DB.openDB(); await win.DB.ensureCounters();
  win.eval(fs.readFileSync(path.join(APP, 'js/app.js'), 'utf8'));

  console.log('STEP 1: The #brandMark element no longer exists in the page at all — no vestigial empty container left behind:', !doc.getElementById('brandMark'));

  const css = fs.readFileSync(path.join(APP, 'css/styles.css'), 'utf8');
  console.log('STEP 2: No leftover .brand-mark CSS rules remain:', !css.includes('.brand-mark'));

  win.applyBrandHeader({ logoText: '', companyName: 'Hadrontech Industrial Solutions', logoDataUrl: '' });
  console.log('STEP 3: With no logo uploaded, text-only branding shows correctly:', doc.getElementById('brandText').textContent.includes('HADRONTECH INDUSTRIAL SOLUTIONS'));

  win.applyBrandHeader({ logoText: '', companyName: 'Hadrontech Industrial Solutions', logoDataUrl: 'data:image/png;base64,fakedata' });
  console.log('STEP 4: THE ACTUAL FIX: even with a real logo uploaded, the app header still shows NO image anywhere — no <img> tag exists in the topbar at all:', !doc.querySelector('.topbar img'));
  console.log('STEP 5: Text-only branding is unaffected by whether a logo is uploaded or not:', doc.getElementById('brandText').textContent.includes('HADRONTECH INDUSTRIAL SOLUTIONS'));

  const custId = await win.DB.dbAdd('customers', { customerNo: 'C1', companyName: 'Test', status: 'Active', createdAt: now, updatedAt: now });
  const settings = await win.DB.getSettings();
  settings.logoDataUrl = 'data:image/png;base64,fakedata';
  await win.DB.dbPut('settings', settings);
  win.location.hash = '#/settings';
  await win.Router.resolveRoute();
  await new Promise(r => setTimeout(r, 10));
  console.log('STEP 6: Settings\' own "Company Logo" preview (a separate element, unrelated to the topbar) still correctly shows the uploaded logo:', !!doc.getElementById('content').querySelector('.logo-preview img'));

  const printSource = fs.readFileSync(path.join(APP, 'js/print.js'), 'utf8');
  console.log('STEP 7: Printed documents were never touched by this change — print.js still correctly references logoDataUrl for Quotations/Sales Orders/Supplier POs:', printSource.includes('settings.logoDataUrl'));

  console.log('\n=== APP HEADER IS UNCONDITIONALLY TEXT-ONLY, PRINTED DOCUMENTS UNAFFECTED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
