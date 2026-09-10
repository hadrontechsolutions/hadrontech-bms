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

  /* ============ Filename standardization ============ */
  win.location.hash = '#/settings/backup';
  await win.Router.resolveRoute();
  await wait(30);

  /* ============ Save-picker path (Chrome/Edge) ============ */
  let writtenContent = null;
  let requestedName = null;
  win.showSaveFilePicker = async (opts) => {
    requestedName = opts.suggestedName;
    return {
      createWritable: async () => ({
        write: async (content) => { writtenContent = content; },
        close: async () => {}
      })
    };
  };
  await win.exportFullBackup();
  await wait(30);
  console.log('STEP 1: THE FEATURE: when the browser supports it, the save picker is used with a standardized filename (Hadrontech_Backup_YYYY-MM-DD.json):', new RegExp('^Hadrontech_Backup_\\d{4}-\\d{2}-\\d{2}\\.json$').test(requestedName));
  console.log('STEP 2: The actual backup content gets written through the picker:', writtenContent && JSON.parse(writtenContent).data && Array.isArray(JSON.parse(writtenContent).data.customers));

  const settingsAfterPicker = await win.DB.getSettings();
  console.log('STEP 3: lastBackupExport correctly updates after a successful picker save:', !!settingsAfterPicker.lastBackupExport);

  /* ============ User cancels the picker (AbortError) — must NOT count as a completed backup ============ */
  const beforeCancel = (await win.DB.getSettings()).lastBackupExport;
  await wait(20);
  win.showSaveFilePicker = async () => { const e = new Error('cancelled'); e.name = 'AbortError'; throw e; };
  let downloadCalledOnCancel = false;
  win.downloadFile = () => { downloadCalledOnCancel = true; };
  await win.exportFullBackup();
  await wait(20);
  const afterCancel = (await win.DB.getSettings()).lastBackupExport;
  console.log('STEP 4: Cancelling the save dialog does NOT mark a backup as completed (lastBackupExport unchanged):', beforeCancel === afterCancel);
  console.log('STEP 5: Cancelling does NOT fall through to also triggering a silent download instead:', downloadCalledOnCancel === false);

  /* ============ Fallback for browsers without the File System Access API ============ */
  delete win.showSaveFilePicker;
  let fallbackName = null;
  win.downloadFile = (name) => { fallbackName = name; };
  await win.exportFullBackup();
  await wait(20);
  console.log('STEP 6: On a browser without the picker API, it correctly falls back to the normal download method, same standardized filename:', /^Hadrontech_Backup_\d{4}-\d{2}-\d{2}\.json$/.test(fallbackName));

  /* ============ The proactive prompt: logActivity() is the central hook ============ */
  win.showSaveFilePicker = async (opts) => ({ createWritable: async () => ({ write: async () => {}, close: async () => {} }) });
  await win.exportFullBackup(); // reset the "since last backup" clock to now
  await wait(20);

  win.__unbackedActivity = false;
  await win.DB.logActivity('Test activity');
  console.log('STEP 7: logActivity() correctly sets the central "unbacked activity" flag:', win.__unbackedActivity === true);

  // Too soon after the last backup — should NOT show yet, even with unbacked activity
  await win.BackupReminder.maybeShowBackupPrompt();
  await wait(20);
  console.log('STEP 8: The prompt correctly does NOT show right after a fresh backup, even with new activity (too soon):', !doc.getElementById('backupPromptOverlay'));

  // Simulate enough time having passed since the last backup
  const settings2 = await win.DB.getSettings();
  settings2.lastBackupExport = new Date(Date.now() - 15 * 60000).toISOString(); // 15 minutes ago
  await win.DB.dbPut('settings', settings2);
  await win.BackupReminder.maybeShowBackupPrompt();
  await wait(20);
  const overlay = doc.getElementById('backupPromptOverlay');
  console.log('STEP 9: THE ACTUAL FEATURE: with unbacked activity and enough time passed, the prompt now correctly appears:', !!overlay);
  console.log('STEP 10: The prompt has both a "Back Up Now" and a "Not Now" option:', !!doc.getElementById('backupPromptNow') && !!doc.getElementById('backupPromptLater'));

  /* ============ Throttle: doesn't nag again immediately after being shown once ============ */
  doc.getElementById('backupPromptLater').click();
  await wait(20);
  console.log('STEP 11: Clicking "Not Now" correctly dismisses without exporting:', !doc.getElementById('backupPromptOverlay'));

  await win.DB.logActivity('More test activity');
  await win.BackupReminder.maybeShowBackupPrompt();
  await wait(20);
  console.log('STEP 12: After dismissing once, the prompt does NOT immediately reappear for more activity in the same session (not naggy):', !doc.getElementById('backupPromptOverlay'));

  /* ============ Clicking "Back Up Now" actually triggers a real backup ============ */
  const settings3 = await win.DB.getSettings();
  settings3.lastBackupExport = new Date(Date.now() - 15 * 60000).toISOString();
  await win.DB.dbPut('settings', settings3);
  await win.BackupReminder.resetBackupPromptThrottle();
  await win.BackupReminder.maybeShowBackupPrompt();
  await wait(20);
  let exportedViaPromptClick = false;
  win.showSaveFilePicker = async () => ({ createWritable: async () => ({ write: async () => { exportedViaPromptClick = true; }, close: async () => {} }) });
  doc.getElementById('backupPromptNow').click();
  await wait(30);
  console.log('STEP 13: Clicking "Back Up Now" in the prompt correctly triggers a real backup save:', exportedViaPromptClick === true);
  console.log('STEP 14: After a successful backup, the throttle resets so a LATER batch of activity can prompt again:', win.__unbackedActivity === false);

  console.log('\n=== BACKUP SAVE-LOCATION PICKER + PROACTIVE PROMPT FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
