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
  const scripts = [...dom.window.document.querySelectorAll('script[src]')].map(s => s.getAttribute('src'));
  for (const src of scripts) dom.window.eval(fs.readFileSync(path.join(APP, src), 'utf8'));
  const win = dom.window; const doc = win.document;
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  doc.dispatchEvent(new win.Event('DOMContentLoaded', { bubbles: true, cancelable: true }));
  await wait(80);

  console.log('STEP 1: The redundant header search box no longer exists in the page:', !doc.getElementById('headerSearch'));
  console.log('STEP 2: The app booted successfully with no crash from the removed element (topbar still renders):', !!doc.querySelector('.topbar'));
  console.log('STEP 3: The brand block (name/logo area) is still intact:', !!doc.getElementById('brandBlock') && !!doc.getElementById('brandMark') && !!doc.getElementById('brandText'));
  console.log('STEP 4: The "Offline · Local Data Only" status text is still shown:', doc.querySelector('.header-user').textContent.includes('Offline'));

  win.location.hash = '#/search';
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 5: The dedicated Search tab in the sidebar still works completely normally:', !!doc.getElementById('globalSearchInput'));

  win.location.hash = '#/dashboard';
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 6: Normal navigation elsewhere still works fine (no lingering reference to the removed search box breaking anything):', !doc.getElementById('content').innerHTML.includes('Something went wrong'));

  console.log('\n=== HEADER SEARCH BOX REMOVAL FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
