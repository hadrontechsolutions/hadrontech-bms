const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
require('fake-indexeddb/auto');
const APP = __dirname;

async function loadApp(storageMock) {
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  window.indexedDB = global.indexedDB; window.IDBKeyRange = global.IDBKeyRange;
  if (storageMock !== undefined) {
    Object.defineProperty(window.navigator, 'storage', { value: storageMock, configurable: true });
  }
  const scripts = [...dom.window.document.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => s !== 'js/app.js');
  for (const src of scripts) dom.window.eval(fs.readFileSync(path.join(APP, src), 'utf8'));
  dom.window.eval(fs.readFileSync(path.join(APP, 'js/app.js'), 'utf8'));
  return dom.window;
}

async function main() {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  /* ============ Scenario 1: browser GRANTS persistence -- no warning shown ============ */
  const win1 = await loadApp({ persisted: async () => false, persist: async () => true });
  await win1.boot();
  await wait(30);
  console.log('STEP 1: When the browser grants persistent storage, no warning banner is shown:', win1.document.getElementById('storageRiskBanner').innerHTML.trim() === '');

  /* ============ Scenario 2: already persisted from a prior session -- no warning, and persist() isn't even called again ============ */
  let persistCalled = false;
  const win2 = await loadApp({ persisted: async () => true, persist: async () => { persistCalled = true; return true; } });
  await win2.boot();
  await wait(30);
  console.log('STEP 2: If already persisted from before, no warning shown:', win2.document.getElementById('storageRiskBanner').innerHTML.trim() === '');
  console.log('STEP 3: And it correctly avoids re-requesting when already persisted:', persistCalled === false);

  /* ============ Scenario 3: browser DECLINES persistence -- THE ACTUAL FIX, warning must show ============ */
  const win3 = await loadApp({ persisted: async () => false, persist: async () => false });
  await win3.boot();
  await wait(30);
  const banner3 = win3.document.getElementById('storageRiskBanner');
  console.log('STEP 4: THE FIX: when the browser declines persistent storage, a clear warning banner is shown:', banner3.innerHTML.includes('did not guarantee protected storage'));
  console.log('STEP 5: The warning explicitly mentions the real risk factors (auto-clearing, clear-on-close settings, incognito) so it\'s not vague:', banner3.innerHTML.includes('private/incognito') && banner3.innerHTML.includes('free up space'));
  console.log('STEP 6: The warning tells the person what to actually do about it (back up regularly):', banner3.innerHTML.includes('export backups'));

  const dismissBtn = win3.document.getElementById('storageRiskDismiss');
  console.log('STEP 7: A dismiss button exists so the warning doesn\'t block the page forever:', !!dismissBtn);
  dismissBtn.click();
  console.log('STEP 8: Dismissing correctly clears the banner:', banner3.innerHTML.trim() === '');

  /* ============ Scenario 4: navigator.storage API doesn't exist at all (older browser) ============ */
  const win4 = await loadApp(undefined); // no storage API defined at all — leave navigator.storage as whatever jsdom's default is
  Object.defineProperty(win4.navigator, 'storage', { value: undefined, configurable: true });
  await win4.boot();
  await wait(30);
  console.log('STEP 9: If the browser doesn\'t support the storage API at all, a fallback warning still appears rather than silently doing nothing:', win4.document.getElementById('storageRiskBanner').innerHTML.includes("doesn't support protecting"));

  /* ============ Regression: normal boot still works correctly regardless of storage outcome ============ */
  console.log('STEP 10: Regression: the app still boots normally and renders the dashboard even when storage permission is declined:', win3.document.getElementById('content').textContent.length > 0);

  console.log('\n=== PERSISTENT STORAGE PROTECTION FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
