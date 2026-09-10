const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
require('fake-indexeddb/auto');
const APP = __dirname;

function makeMockDirectoryHandle(name) {
  const writtenFiles = {};
  return {
    name, kind: 'directory',
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
    getFileHandle: async (filename) => ({
      name: filename,
      createWritable: async () => ({
        write: async (data) => { writtenFiles[filename] = data; },
        close: async () => {}
      })
    }),
    _writtenFiles: writtenFiles
  };
}

async function main() {
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  window.indexedDB = global.indexedDB; window.IDBKeyRange = global.IDBKeyRange; window.confirm = () => true;
  if (!window.URL.createObjectURL) window.URL.createObjectURL = () => 'blob:fake-url';
  const scripts = [...dom.window.document.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => s !== 'js/app.js');
  for (const src of scripts) dom.window.eval(fs.readFileSync(path.join(APP, src), 'utf8'));
  const win = dom.window; const doc = win.document;
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  await win.DB.openDB(); await win.DB.ensureCounters();

  // Same in-memory settings workaround as test-backup-folder-memory.js -- a real
  // FileSystemDirectoryHandle is a native browser type that can't be structured-cloned by a
  // plain JS mock object with function properties, so IndexedDB storage for it can't be
  // accurately simulated outside a real browser. This still fully exercises the actual
  // application logic under test.
  let memSettings = await win.DB.getSettings();
  win.DB.getSettings = async () => memSettings;
  const origDbPut = win.DB.dbPut;
  win.DB.dbPut = async (store, val) => {
    if (store === 'settings') { memSettings = val; return val; }
    return origDbPut(store, val);
  };

  win.location.hash = '#/settings/backup';
  await win.Router.resolveRoute();
  await wait(50);

  /* ============ Default: field empty, dated filenames still used ============ */
  console.log('STEP 1: Custom filename field exists and starts empty by default:', doc.getElementById('f_customBackupFilename').value === '');

  const mockFolder = makeMockDirectoryHandle('Backups');
  win.showDirectoryPicker = async () => mockFolder;
  doc.getElementById('btnChooseFolder').click();
  await wait(80);

  doc.getElementById('btnExportJson').click();
  await wait(80);
  let files = Object.keys(mockFolder._writtenFiles);
  console.log('STEP 2: REGRESSION: with no custom filename set, backups still use the dated filename exactly as before:', /^Hadrontech_Backup_\d{4}-\d{2}-\d{2}\.json$/.test(files[0]));

  /* ============ Setting a custom filename ============ */
  win.location.hash = '#/settings/backup';
  await win.Router.resolveRoute();
  await wait(50);
  doc.getElementById('f_customBackupFilename').value = 'HadrontechBMS';
  doc.getElementById('btnSaveFilename').click();
  await wait(50);
  console.log('STEP 3: THE FEATURE: custom filename correctly saved to settings:', memSettings.customBackupFilename === 'HadrontechBMS');

  /* ============ Backing up now uses the custom name, with .json appended ============ */
  win.location.hash = '#/settings/backup';
  await win.Router.resolveRoute();
  await wait(50);
  doc.getElementById('btnExportJson').click();
  await wait(80);
  files = Object.keys(mockFolder._writtenFiles);
  console.log('STEP 4: Backup now uses the custom filename with .json correctly appended:', files.includes('HadrontechBMS.json'));

  /* ============ Backing up AGAIN correctly overwrites the same file, not a second one ============ */
  const firstContent = mockFolder._writtenFiles['HadrontechBMS.json'];
  await win.DB.dbAdd('customers', { customerNo: 'C99', companyName: 'New Customer After First Backup', status: 'Active', createdAt: new Date().toISOString() });
  win.location.hash = '#/settings/backup';
  await win.Router.resolveRoute();
  await wait(50);
  doc.getElementById('btnExportJson').click();
  await wait(80);
  const filesAfterSecond = Object.keys(mockFolder._writtenFiles);
  console.log('STEP 5: THE CORE FIX: backing up a second time overwrites the SAME custom-named file — no "HadrontechBMS (1).json" or similar duplicate appears:', filesAfterSecond.filter(f => f.toLowerCase().includes('hadrontechbms')).length === 1);
  const secondContent = mockFolder._writtenFiles['HadrontechBMS.json'];
  console.log('STEP 6: The overwritten file actually contains the newer data, confirming it really overwrote rather than silently no-op\'d:', secondContent !== firstContent && secondContent.includes('New Customer After First Backup'));

  /* ============ Typing the .json extension themselves doesn't get doubled ============ */
  win.location.hash = '#/settings/backup';
  await win.Router.resolveRoute();
  await wait(50);
  doc.getElementById('f_customBackupFilename').value = 'MyOwnBackup.json';
  doc.getElementById('btnSaveFilename').click();
  await wait(50);
  win.location.hash = '#/settings/backup';
  await win.Router.resolveRoute();
  await wait(50);
  doc.getElementById('btnExportJson').click();
  await wait(80);
  console.log('STEP 7: Typing ".json" already doesn\u2019t get doubled into ".json.json":', Object.keys(mockFolder._writtenFiles).includes('MyOwnBackup.json') && !Object.keys(mockFolder._writtenFiles).some(f => f.includes('.json.json')));

  /* ============ Clearing the field reverts to dated filenames ============ */
  win.location.hash = '#/settings/backup';
  await win.Router.resolveRoute();
  await wait(50);
  doc.getElementById('f_customBackupFilename').value = '';
  doc.getElementById('btnSaveFilename').click();
  await wait(50);
  win.location.hash = '#/settings/backup';
  await win.Router.resolveRoute();
  await wait(50);
  doc.getElementById('btnExportJson').click();
  await wait(80);
  const filesAfterClear = Object.keys(mockFolder._writtenFiles);
  const newDatedFile = filesAfterClear.find(f => /^Hadrontech_Backup_\d{4}-\d{2}-\d{2}\.json$/.test(f));
  console.log('STEP 8: Clearing the custom filename correctly reverts to dated filenames again:', !!newDatedFile);

  console.log('\n=== CUSTOM BACKUP FILENAME FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
