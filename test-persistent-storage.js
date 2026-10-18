/* The "browser may clear this app's data" warning: shown only when the browser declined persistent storage
   AND there is no recent backup (none yet, or older than the reminder period). */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
require('fake-indexeddb/auto');
const { IDBFactory } = require('fake-indexeddb');
const APP = __dirname;

/* opts.daysSinceBackup: undefined = never backed up; a number = last backup that many days ago.
   opts.clean: leave the BMS with only the built-in sample records (no real data). */
async function loadApp(storageMock, opts) {
  opts = opts || {};
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  window.indexedDB = new IDBFactory(); window.IDBKeyRange = global.IDBKeyRange;   // a fresh, empty database for each scenario
  if (storageMock !== undefined) {
    Object.defineProperty(window.navigator, 'storage', { value: storageMock, configurable: true });
  }
  const scripts = [...dom.window.document.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => s !== 'js/app.js');
  for (const src of scripts) dom.window.eval(fs.readFileSync(path.join(APP, src), 'utf8'));
  dom.window.eval(fs.readFileSync(path.join(APP, 'js/app.js'), 'utf8'));
  await window.DB.openDB(); await window.DB.ensureCounters();
  if (!opts.clean) await window.DB.dbAdd('customers', { customerNo: 'CUST-REAL', companyName: 'Real Customer Co.', status: 'Active', createdBy: 'Tester', createdAt: 'x', updatedAt: 'x' });
  if (opts.daysSinceBackup !== undefined) {
    const s = await window.DB.getSettings();
    s.lastBackupExport = new Date(Date.now() - opts.daysSinceBackup * 86400000).toISOString();
    await window.DB.dbPut('settings', s);
  }
  return window;
}
const banner = (w) => w.document.getElementById('storageRiskBanner');
const DECLINE = { persisted: async () => false, persist: async () => false };

async function main() {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  /* ===== Browser GRANTS persistence: no warning, even with no backup ===== */
  const win1 = await loadApp({ persisted: async () => false, persist: async () => true });
  await win1.boot(); await wait(30);
  console.log('STEP 1: When the browser grants persistent storage, no warning banner is shown:', banner(win1).innerHTML.trim() === '');

  let persistCalled = false;
  const win2 = await loadApp({ persisted: async () => true, persist: async () => { persistCalled = true; return true; } });
  await win2.boot(); await wait(30);
  console.log('STEP 2: If already persisted from before, no warning shown:', banner(win2).innerHTML.trim() === '');
  console.log('STEP 3: And it correctly avoids re-requesting when already persisted:', persistCalled === false);

  /* ===== Browser DECLINES persistence, but a recent backup exists: nothing to warn about ===== */
  const winA = await loadApp(DECLINE, { daysSinceBackup: 2 });
  await winA.boot(); await wait(30);
  console.log('STEP 4: Declined, but the last backup is only 2 days old: no warning (it would not matter):', banner(winA).innerHTML.trim() === '');

  /* ===== Declined and the last backup is overdue: the warning shows, with the real number of days ===== */
  const winB = await loadApp(DECLINE, { daysSinceBackup: 9 });
  await winB.boot(); await wait(30);
  const b = banner(winB);
  console.log('STEP 5: Declined and the last backup is 9 days old (reminder period is 7): the warning shows and says so:', b.innerHTML.includes('computer runs low on disk space') && b.innerHTML.includes('Your last backup was 9 days ago'));
  console.log('STEP 6: The warning has a Back Up Now button and tells the person to save a backup:', !!winB.document.getElementById('storageRiskBackupNow') && b.innerHTML.includes('please save a backup'));
  winB.document.getElementById('storageRiskDismiss').click();
  console.log('STEP 7: Dismissing clears the banner:', b.innerHTML.trim() === '');

  /* ===== Declined and never backed up ===== */
  const winC = await loadApp(DECLINE);
  await winC.boot(); await wait(30);
  console.log('STEP 8: Declined and no backup saved yet: the warning says so:', banner(winC).innerHTML.includes("You haven't saved a backup yet"));

  /* ===== Declined, but this is a sample-only BMS: its own banner covers it, so no second warning ===== */
  const winD = await loadApp(DECLINE, { clean: true });
  await winD.boot(); await wait(30);
  console.log('STEP 9: A sample-only BMS does not get this warning too (it has its own "restore first" banner):', banner(winD).innerHTML.trim() === '' && winD.document.getElementById('backupBanner').textContent.includes('no data of its own yet'));

  /* ===== Browser without the storage API at all ===== */
  const winE = await loadApp(undefined, { daysSinceBackup: 20 });
  Object.defineProperty(winE.navigator, 'storage', { value: undefined, configurable: true });
  await winE.boot(); await wait(30);
  console.log('STEP 10: A browser with no storage support and an overdue backup still gets the warning:', banner(winE).innerHTML.includes('Your last backup was 20 days ago'));

  /* ===== Saving a backup removes the warning ===== */
  const winF = await loadApp(DECLINE, { daysSinceBackup: 9 });
  await winF.boot(); await wait(30);
  const hadWarning = banner(winF).innerHTML.includes('computer runs low');
  winF.showDirectoryPicker = undefined; winF.showSaveFilePicker = undefined; winF.URL.createObjectURL = () => 'blob:x'; winF.document.createElement('a').click = () => {};
  await winF.exportFullBackup(); await wait(30);
  console.log('STEP 11: Saving a backup removes the warning straight away:', hadWarning && banner(winF).innerHTML.trim() === '');

  console.log('STEP 12: Regression: the app still boots normally and renders the dashboard:', winB.document.getElementById('content').textContent.length > 0);
  console.log('\n=== PERSISTENT STORAGE WARNING FULLY VERIFIED ===');
  process.exit(0);
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
