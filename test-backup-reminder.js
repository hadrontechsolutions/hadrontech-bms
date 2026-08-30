const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
require('fake-indexeddb/auto');

const APP = __dirname;

async function main() {
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  window.indexedDB = global.indexedDB;
  window.IDBKeyRange = global.IDBKeyRange;
  window.confirm = () => true;
  window.open = () => ({ document: { write: () => {}, close: () => {} } });
  // jsdom doesn't implement real downloads — stub so exportFullBackup doesn't throw
  window.URL.createObjectURL = () => 'blob:stub';

  const scripts = [...dom.window.document.querySelectorAll('script[src]')].map(s => s.getAttribute('src'));
  for (const src of scripts) dom.window.eval(fs.readFileSync(path.join(APP, src), 'utf8'));
  const win = dom.window;
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  await win.DB.openDB();
  await win.DB.ensureCounters();
  await win.seedIfEmpty();

  // 1. Fresh install, never backed up -> banner should show "never backed up"
  await win.BackupReminder.refreshBackupBanner();
  let bannerText = win.document.getElementById('backupBanner').textContent;
  console.log('STEP 1: Never-backed-up banner shown:', bannerText.includes("haven't exported"));

  // 2. Export a backup -> banner should clear and lastBackupExport should be set
  await win.exportFullBackup();
  await wait(10);
  let settings = await win.DB.getSettings();
  console.log('STEP 2: lastBackupExport set after export:', !!settings.lastBackupExport);
  let bannerAfterExport = win.document.getElementById('backupBanner').innerHTML.trim();
  console.log('STEP 3: Banner cleared right after export:', bannerAfterExport === '');

  // 3. Simulate 10 days passing (default reminder = 7 days) -> banner should reappear
  settings.lastBackupExport = new Date(Date.now() - 10 * 86400000).toISOString();
  await win.DB.dbPut('settings', settings);
  await win.BackupReminder.refreshBackupBanner();
  let bannerOverdue = win.document.getElementById('backupBanner').textContent;
  console.log('STEP 4: Overdue banner (10 days, limit 7) shown:', bannerOverdue.includes('10 days since your last backup'));
  console.log('STEP 5: Hard nag NOT yet active at 10 days (needs >=14):', win.__backupOverdueHard === false);

  // 4. Simulate 20 days passing -> hard nag (beforeunload) should activate
  settings.lastBackupExport = new Date(Date.now() - 20 * 86400000).toISOString();
  await win.DB.dbPut('settings', settings);
  await win.BackupReminder.refreshBackupBanner();
  console.log('STEP 6: Hard nag active at 20 days (limit*2=14):', win.__backupOverdueHard === true);

  // 5. Dismiss banner for session -> should hide even though still overdue
  win.document.getElementById('bannerDismiss').click();
  let bannerDismissed = win.document.getElementById('backupBanner').innerHTML.trim();
  console.log('STEP 7: Banner hidden after dismiss:', bannerDismissed === '');

  // 6. Changing the reminder threshold on the Backup page updates behavior
  win.location.hash = '#/settings/backup';
  await win.Router.resolveRoute();
  await wait(10);
  win.document.getElementById('reminderDays').value = '30';
  win.document.getElementById('reminderDays').dispatchEvent(new win.Event('change'));
  await wait(10);
  settings = await win.DB.getSettings();
  console.log('STEP 8: backupReminderDays updated to 30:', settings.backupReminderDays === 30);
  // banner should now be cleared since dismissed-flag persists this session anyway, but overdue check itself:
  console.log('STEP 9: isBackupOverdue at 20 days w/ 30-day limit:', win.BackupReminder.isBackupOverdue(settings) === false);

  console.log('\n=== BACKUP REMINDER TESTS COMPLETED ===');
}

main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
