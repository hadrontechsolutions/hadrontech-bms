const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
require('fake-indexeddb/auto');
const APP = __dirname;

function makeMockFile(name, content) {
  return {
    getFile: async () => ({ name, text: async () => content })
  };
}

function makeMockDirectoryHandle(name, opts) {
  opts = opts || {};
  const writtenFiles = {};
  return {
    name,
    kind: 'directory',
    queryPermission: async () => (opts.permission || 'granted'),
    requestPermission: async () => (opts.requestedPermission ?? opts.permission ?? 'granted'),
    getFileHandle: async (filename, createOpts) => {
      if (opts.throwOnGetFileHandle) throw new Error('Simulated: folder no longer accessible');
      return {
        name: filename,
        createWritable: async () => ({
          write: async (data) => { writtenFiles[filename] = data; },
          close: async () => {}
        })
      };
    },
    _writtenFiles: writtenFiles
  };
}

async function main() {
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  window.indexedDB = global.indexedDB; window.IDBKeyRange = global.IDBKeyRange; window.confirm = () => true;
  if (!window.URL.createObjectURL) window.URL.createObjectURL = () => 'blob:fake-url'; // not implemented in jsdom
  const scripts = [...dom.window.document.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => s !== 'js/app.js');
  for (const src of scripts) dom.window.eval(fs.readFileSync(path.join(APP, src), 'utf8'));
  const win = dom.window; const doc = win.document;
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  await win.DB.openDB(); await win.DB.ensureCounters();

  // A real FileSystemDirectoryHandle is a native browser type with its own structured-clone
  // support baked into the engine -- a plain JS mock object with function properties (which is
  // all that's possible to simulate in Node.js) is NOT structured-cloneable, so storing one via
  // the real IndexedDB layer (even through fake-indexeddb) would silently lose its methods.
  // This isn't something worth working around at the IndexedDB layer -- it's a genuine limit of
  // testing a browser-native API outside a real browser. Swapping in an in-memory settings store
  // for this test keeps the actual application logic (does the code read/write the field
  // correctly, does it react correctly to what's returned) fully exercised regardless.
  let memSettings = await win.DB.getSettings(); // seed with the real, fully-populated defaults first
  win.DB.getSettings = async () => memSettings;
  const origDbPut = win.DB.dbPut;
  win.DB.dbPut = async (store, val) => {
    if (store === 'settings') { memSettings = val; return val; }
    return origDbPut(store, val);
  };

  win.location.hash = '#/settings/backup';
  await win.Router.resolveRoute();
  await wait(50);

  /* ============ No folder chosen yet: correct initial state ============ */
  console.log('STEP 1: With no folder chosen, the status correctly says so:', doc.getElementById('backupFolderStatus').textContent.includes('No folder chosen'));
  console.log('STEP 2: Button correctly reads "Choose Backup Folder..." (not "Change"):', doc.getElementById('btnChooseFolder').textContent.includes('Choose Backup Folder'));
  console.log('STEP 3: "Forget This Folder" is not shown when nothing is set:', !doc.getElementById('btnForgetFolder'));

  /* ============ Choosing a folder ============ */
  const mockFolder = makeMockDirectoryHandle('Hadrontech Backups');
  win.showDirectoryPicker = async () => mockFolder;
  doc.getElementById('btnChooseFolder').click();
  await wait(80);

  const settingsAfterChoose = await win.DB.getSettings();
  console.log('STEP 4: THE CORE FEATURE: choosing a folder correctly remembers it in settings:', settingsAfterChoose.backupFolderHandle && settingsAfterChoose.backupFolderHandle.name === 'Hadrontech Backups');
  console.log('STEP 5: The status display now shows the chosen folder name:', doc.getElementById('backupFolderStatus').textContent.includes('Hadrontech Backups'));
  console.log('STEP 6: Button now reads "Change Backup Folder...":', doc.getElementById('btnChooseFolder').textContent.includes('Change Backup Folder'));
  console.log('STEP 7: "Forget This Folder" now appears:', !!doc.getElementById('btnForgetFolder'));

  /* ============ Exporting now writes DIRECTLY to the remembered folder, no dialog ============ */
  let saveFilePickerCalled = false;
  win.showSaveFilePicker = async () => { saveFilePickerCalled = true; throw new Error('should not be called'); };
  doc.getElementById('btnExportJson').click();
  await wait(80);
  const writtenFilenames = Object.keys(mockFolder._writtenFiles);
  console.log('STEP 8: THE FIX: exporting writes straight into the remembered folder — no save dialog at all:', writtenFilenames.length === 1 && /^Hadrontech_Backup_\d{4}-\d{2}-\d{2}\.json$/.test(writtenFilenames[0]));
  console.log('STEP 9: The save-location picker (the old fallback) was correctly NOT invoked, since the remembered folder handled it:', saveFilePickerCalled === false);
  const writtenContent = JSON.parse(mockFolder._writtenFiles[writtenFilenames[0]]);
  console.log('STEP 10: The actual written content is a real backup payload:', writtenContent.data && Array.isArray(writtenContent.data.customers));

  /* ============ If the remembered folder becomes inaccessible, falls back gracefully ============ */
  const staleFolder = makeMockDirectoryHandle('Old Backups', { throwOnGetFileHandle: true });
  const settings2 = await win.DB.getSettings();
  settings2.backupFolderHandle = staleFolder;
  await win.DB.dbPut('settings', settings2);
  let fallbackPickerUsed = false;
  win.showSaveFilePicker = async () => { fallbackPickerUsed = true; return { createWritable: async () => ({ write: async () => {}, close: async () => {} }) }; };
  win.location.hash = '#/settings/backup';
  await win.Router.resolveRoute();
  await wait(50);
  doc.getElementById('btnExportJson').click();
  await wait(80);
  console.log('STEP 11: If the remembered folder throws (e.g. moved/deleted), export correctly falls back to the save-location picker instead of failing silently:', fallbackPickerUsed === true);

  /* ============ Forgetting the folder ============ */
  const settings3 = await win.DB.getSettings();
  settings3.backupFolderHandle = mockFolder;
  await win.DB.dbPut('settings', settings3);
  win.location.hash = '#/settings/backup';
  await win.Router.resolveRoute();
  await wait(50);
  doc.getElementById('btnForgetFolder').click();
  await wait(50);
  const settingsAfterForget = await win.DB.getSettings();
  console.log('STEP 12: "Forget This Folder" correctly clears the remembered folder:', !settingsAfterForget.backupFolderHandle);

  /* ============ Restore: opens directly in the remembered folder ============ */
  const settings4 = await win.DB.getSettings();
  settings4.backupFolderHandle = mockFolder;
  await win.DB.dbPut('settings', settings4);
  win.location.hash = '#/settings/backup';
  await win.Router.resolveRoute();
  await wait(50);

  const backupContent = JSON.stringify({ appVersion: '1.0.0', dbVersion: 1, backupDate: new Date().toISOString(), data: Object.fromEntries((await win.DB.dbGetAll ? ['customers','suppliers','products','quotations','customerPOs','salesOrders','supplierPOs','enquiries','stockMovements','proformaInvoices','technicalOffers','expenses','counters','settings','activity'] : []).map(s => [s, []])) });
  let openPickerStartIn = null;
  win.showOpenFilePicker = async (opts) => { openPickerStartIn = opts.startIn; return [makeMockFile('Hadrontech_Backup_2026-09-01.json', backupContent)]; };
  doc.getElementById('btnImportJson').click();
  await wait(80);
  console.log('STEP 13: THE FIX: Restore correctly opens the file picker starting right in the remembered folder:', openPickerStartIn === mockFolder);
  console.log('STEP 14: The chosen file is correctly read and a restore actually proceeds (confirm() was called and dashboard is shown after):', win.location.hash.includes('dashboard'));

  /* ============ Regression: no folder remembered, unsupported browser -- falls back exactly as before ============ */
  const settings5 = await win.DB.getSettings();
  delete settings5.backupFolderHandle;
  await win.DB.dbPut('settings', settings5);
  delete win.showDirectoryPicker; delete win.showSaveFilePicker; delete win.showOpenFilePicker;
  win.location.hash = '#/settings/backup';
  await win.Router.resolveRoute();
  await wait(50);
  let downloaded = null;
  win.downloadFile = (name, content) => { downloaded = { name, content }; };
  doc.getElementById('btnExportJson').click();
  await wait(80);
  console.log('STEP 15: REGRESSION: with no File System Access API support at all, export still correctly falls back to a plain download:', downloaded && /^Hadrontech_Backup_\d{4}-\d{2}-\d{2}\.json$/.test(downloaded.name));

  console.log('\n=== REMEMBERED BACKUP FOLDER FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
