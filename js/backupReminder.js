/* ============================================================
   backupReminder.js — a visible "please back up" banner that shows
   on every page once too much time has passed since the last export,
   plus a soft nag when closing the tab with a backup very overdue.

   This is deliberately its own tiny module rather than folded into
   backup.js/app.js, so it's easy to find and adjust later.
   ============================================================ */

let _bannerDismissedThisSession = false;
window.__backupOverdueHard = false; // read by the beforeunload guard in utils.js

function daysSinceBackup(settings) {
  if (!settings.lastBackupExport) return null; // never backed up
  return Math.floor((Date.now() - new Date(settings.lastBackupExport).getTime()) / 86400000);
}

function isBackupOverdue(settings) {
  const days = daysSinceBackup(settings);
  const limit = settings.backupReminderDays || 7;
  return days === null || days >= limit;
}

async function refreshBackupBanner() {
  const settings = await DB.getSettings();
  const days = daysSinceBackup(settings);
  const limit = settings.backupReminderDays || 7;
  const overdue = isBackupOverdue(settings);
  window.__backupOverdueHard = days === null ? false : days >= limit * 2; // only nag hard once it's well overdue

  let host = document.getElementById('backupBanner');
  if (!overdue || _bannerDismissedThisSession) {
    if (host) host.innerHTML = '';
    return;
  }
  const message = days === null
    ? `You haven't exported a backup yet. Since all data lives in this browser only, please export one now.`
    : `It's been ${days} day${days === 1 ? '' : 's'} since your last backup. Please export a fresh one.`;

  if (!host) return; // shell not present (shouldn't happen, but don't crash)
  host.className = 'backup-banner';
  host.innerHTML = `
    <span>⚠ ${escapeHtml(message)}</span>
    <span class="backup-banner-actions">
      <button id="bannerBackupNow">Back Up Now</button>
      <button id="bannerDismiss" class="banner-dismiss" title="Dismiss for this session">✕</button>
    </span>
  `;
  document.getElementById('bannerBackupNow').onclick = async () => {
    if (window.exportFullBackup) { await exportFullBackup(); await refreshBackupBanner(); }
    else Router.navigate('/settings/backup');
  };
  document.getElementById('bannerDismiss').onclick = () => { _bannerDismissedThisSession = true; host.innerHTML = ''; host.className = ''; };
}

window.BackupReminder = { daysSinceBackup, isBackupOverdue, refreshBackupBanner };
