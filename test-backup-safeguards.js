/* Backup safeguards: empty-backup guard, "Previous backups" copies (one per day, newest 7 days),
   clean-BMS banner, and the record count in the saved message. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
require('fake-indexeddb/auto');
const APP = __dirname;

/* In-memory folder that behaves like a FileSystemDirectoryHandle (files, sub-folders, entries, removeEntry). */
function makeDir(name) {
  const files = {}, dirs = {};
  const notFound = () => { const e = new Error('not found'); e.name = 'NotFoundError'; return e; };
  const dir = {
    name, kind: 'directory', _files: files, _dirs: dirs,
    queryPermission: async () => 'granted', requestPermission: async () => 'granted',
    getFileHandle: async (n, o) => {
      if (!files[n]) { if (!(o && o.create)) throw notFound(); files[n] = { content: '', lastModified: Date.now() }; }
      return {
        name: n,
        getFile: async () => ({ name: n, lastModified: files[n].lastModified, text: async () => files[n].content }),
        createWritable: async () => ({ write: async (d) => { files[n].content = d; }, close: async () => { files[n].lastModified = Date.now(); } })
      };
    },
    getDirectoryHandle: async (n, o) => { if (!dirs[n]) { if (!(o && o.create)) throw notFound(); dirs[n] = makeDir(n); } return dirs[n]; },
    removeEntry: async (n) => { delete files[n]; delete dirs[n]; },
    entries: async function* () { for (const n of Object.keys(files)) yield [n, {}]; for (const n of Object.keys(dirs)) yield [n, dirs[n]]; }
  };
  return dir;
}
const backupJson = (customers, createdBy) => JSON.stringify({ appVersion: 'x', dbVersion: 1, backupDate: new Date().toISOString(),
  data: { customers: Array.from({ length: customers }, (_, i) => ({ id: i + 1, companyName: 'C' + i, createdBy: createdBy || 'Tester' })) } });

async function main() {
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  window.indexedDB = global.indexedDB; window.IDBKeyRange = global.IDBKeyRange; window.confirm = () => true;
  if (!window.URL.createObjectURL) window.URL.createObjectURL = () => 'blob:fake-url';
  for (const src of [...dom.window.document.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => s !== 'js/app.js')) dom.window.eval(fs.readFileSync(path.join(APP, src), 'utf8'));
  const win = dom.window; const doc = win.document;
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  await win.DB.openDB(); await win.DB.ensureCounters();

  // A real folder handle can't be stored through fake-indexeddb (see test-backup-folder-memory.js), so settings live in memory here.
  let memSettings = await win.DB.getSettings();
  win.DB.getSettings = async () => memSettings;
  const origDbPut = win.DB.dbPut;
  win.DB.dbPut = async (store, val) => { if (store === 'settings') { memSettings = val; return val; } return origDbPut(store, val); };
  win.showDirectoryPicker = async () => null;   // only needs to exist (the app checks for it)

  const toasts = []; const origToast = win.toast; win.toast = (m, t) => { toasts.push(m); return origToast && origToast(m, t); };
  const addReal = async (n) => { for (let i = 0; i < n; i++) await win.DB.dbAdd('customers', { customerNo: 'R' + Date.now() + i, companyName: 'Real ' + i, status: 'Active', createdBy: 'Tester', createdAt: 'x', updatedAt: 'x' }); };
  const clearCustomers = async () => { for (const c of await win.DB.dbGetAll('customers')) await win.DB.dbDelete('customers', c.id); };
  const folder = makeDir('Hadrontech BMS');
  memSettings.backupFolderHandle = folder;
  const FN = 'Hadrontech_Backup.json';
  memSettings.customBackupFilename = 'Hadrontech_Backup';
  const day = (n) => { const d = new Date(Date.now() - n * 86400000); return d; };
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  /* ---- 1. A clean BMS (only sample records) must not silently replace a good backup ---- */
  folder._files[FN] = { content: backupJson(40), lastModified: day(1).getTime() };
  await win.DB.dbAdd('customers', { customerNo: 'S1', companyName: 'Sample', createdBy: 'Sample Data', createdAt: 'x', updatedAt: 'x' });
  let p = win.exportFullBackup(); await wait(60);
  const overlay1 = doc.getElementById('backupGuardOverlay');
  console.log('1 Clean BMS: a warning appears before saving over a backup with 40 records:', !!overlay1 && overlay1.textContent.includes('only has the built-in sample records') && overlay1.textContent.includes('40 records'));
  console.log('2 Cancel is the default (focused) button:', doc.activeElement && doc.activeElement.id === 'backupGuardCancel');
  doc.getElementById('backupGuardCancel').click(); await p; await wait(20);
  console.log('3 Cancel leaves the good backup file untouched and creates no Previous backups copy:', JSON.parse(folder._files[FN].content).data.customers.length === 40 && !folder._dirs['Previous backups']);
  console.log('4 Cancel does not count as a backup (no "last backup" recorded):', !memSettings.lastBackupExport);

  /* ---- 2. "Save anyway" works, and the old file is kept in Previous backups ---- */
  p = win.exportFullBackup(); await wait(60);
  doc.getElementById('backupGuardSave').click(); await p; await wait(40);
  const prev = folder._dirs['Previous backups'];
  const oldKey = key(day(1));
  console.log('5 Save anyway replaces the main file:', JSON.parse(folder._files[FN].content).data.customers.length === 1);
  console.log('6 The old file (40 records) was kept in "Previous backups", named by the day it was last saved:', !!prev && !!prev._files[`Hadrontech_Backup_${oldKey}.json`] && JSON.parse(prev._files[`Hadrontech_Backup_${oldKey}.json`].content).data.customers.length === 40);
  console.log('7 The saved message shows the record count and mentions the kept copy:', toasts.some(t => /Backup saved: 1 record\./.test(t) && t.includes('Previous backups')));

  /* ---- 3. A real BMS with a normal size saves with no warning ---- */
  await clearCustomers(); await addReal(30);
  folder._files[FN] = { content: backupJson(35), lastModified: day(0).getTime() };
  await win.exportFullBackup(); await wait(30);
  console.log('8 Real data of a normal size (30 vs 35 in the file): no warning, saved:', !doc.getElementById('backupGuardOverlay') && JSON.parse(folder._files[FN].content).data.customers.length === 30);
  console.log('9 It records the saved size for next time:', memSettings.lastBackupTotal === 30);

  /* ---- 4. A big drop with real data also warns ---- */
  await clearCustomers(); await addReal(5);
  p = win.exportFullBackup(); await wait(60);
  const overlay2 = doc.getElementById('backupGuardOverlay');
  console.log('10 Real data but far smaller (5 vs 30): the warning appears and names both sizes:', !!overlay2 && overlay2.textContent.includes('only 5 records') && overlay2.textContent.includes('30 records'));
  doc.getElementById('backupGuardCancel').click(); await p; await wait(20);

  /* ---- 5. One copy per day (the fullest), newest 7 days only ---- */
  await clearCustomers(); await addReal(30);
  const dir2 = folder._dirs['Previous backups']; for (const n of Object.keys(dir2._files)) delete dir2._files[n];
  for (let i = 2; i <= 10; i++) dir2._files[`Hadrontech_Backup_${key(day(i))}.json`] = { content: backupJson(10 + i), lastModified: day(i).getTime() };
  folder._files[FN] = { content: backupJson(20), lastModified: day(1).getTime() };
  await win.exportFullBackup(); await wait(40);
  const kept = Object.keys(dir2._files).sort();
  console.log('11 After saving, "Previous backups" holds exactly the newest 7 days (not 10):', kept.length === 7 && kept[kept.length - 1] === `Hadrontech_Backup_${key(day(1))}.json` && !kept.includes(`Hadrontech_Backup_${key(day(10))}.json`));
  // A fuller copy for that day is never replaced by a smaller one
  const dayKey = `Hadrontech_Backup_${key(day(1))}.json`;
  dir2._files[dayKey] = { content: backupJson(50), lastModified: Date.now() };
  folder._files[FN] = { content: backupJson(3), lastModified: day(1).getTime() };
  await win.exportFullBackup(); await wait(40);
  console.log('12 A day that already has a fuller copy (50) is not overwritten by a smaller one (3):', JSON.parse(dir2._files[dayKey].content).data.customers.length === 50);

  /* ---- 6. Clean-BMS banner ---- */
  await clearCustomers();
  await win.DB.dbAdd('customers', { customerNo: 'S1', companyName: 'Sample', createdBy: 'Sample Data', createdAt: 'x', updatedAt: 'x' });
  doc.body.insertAdjacentHTML('afterbegin', '<div id="backupBanner"></div>');
  await win.BackupReminder.refreshBackupBanner();
  const banner = doc.getElementById('backupBanner');
  console.log('13 Sample-only BMS: the banner says there is no data yet and offers Go to Restore:', banner.textContent.includes('no data of its own yet') && !!doc.getElementById('bannerGoRestore') && !banner.textContent.includes('Back Up Now'));
  win.__unbackedActivity = true; memSettings.lastBackupExport = null;
  await win.BackupReminder.maybeShowBackupPrompt();
  console.log('14 The "Save a backup?" prompt stays quiet while the BMS is clean:', !doc.getElementById('backupPromptOverlay'));
  await addReal(1);
  await win.BackupReminder.refreshBackupBanner();
  console.log('15 Once a real record exists, the clean banner is gone and the normal reminder applies:', !doc.getElementById('backupBanner').textContent.includes('no data of its own yet') && !!doc.getElementById('bannerBackupNow'));

  /* ---- 7. No backup folder: the guard still checks this browser's last backup ---- */
  delete memSettings.backupFolderHandle; memSettings.lastBackupTotal = 100;
  p = win.exportFullBackup(); await wait(60);
  console.log('16 Without a folder, a backup far smaller than this browser\'s last one (100) still warns:', !!doc.getElementById('backupGuardOverlay'));
  doc.getElementById('backupGuardCancel').click(); await p; await wait(20);

  console.log('no script errors: true');
  process.exit(0);
}
main().catch(e => { console.log('TEST FAILED:', e.stack || e); process.exit(1); });
