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

/* ------------------------------------------------------------
   maybeShowBackupPrompt() — the actual feature requested: rather than
   trying to intercept the browser actually closing (which no website
   can reliably do — browsers cut off anything slower than instant
   during that moment, by design), this proactively asks WHILE the
   app is still fully open and responsive, right after meaningful
   work has been saved. That directly covers the real scenario this
   was built for: create/send something important, then step away
   and close the browser without having backed up yet.
   ------------------------------------------------------------ */
let _backupPromptShownThisSession = false;

async function maybeShowBackupPrompt() {
  if (_backupPromptShownThisSession) return; // don't nag repeatedly in one sitting
  if (!window.__unbackedActivity) return;
  if (document.getElementById('backupPromptOverlay')) return; // already showing
  const settings = await DB.getSettings();
  // Give the person a little room to work before interrupting them — not the very first save
  // of the session, but not a full day either, since that was the actual gap that caused the
  // original incident this feature exists to prevent.
  const minutesSinceLastBackup = settings.lastBackupExport
    ? (Date.now() - new Date(settings.lastBackupExport).getTime()) / 60000
    : Infinity;
  if (minutesSinceLastBackup < 10) return;

  _backupPromptShownThisSession = true;
  const overlay = document.createElement('div');
  overlay.id = 'backupPromptOverlay';
  overlay.className = 'confirm-modal-overlay';
  overlay.innerHTML = `
    <div class="confirm-modal-box">
      <h3>Save a backup?</h3>
      <p>You've made changes since your last backup. Since everything in this app lives only in this browser, it's worth saving a copy now — especially before closing your browser.</p>
      <div class="confirm-modal-actions">
        <button class="btn-line" id="backupPromptLater">Not Now</button>
        <button class="btn-amber" id="backupPromptNow">Back Up Now</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  document.getElementById('backupPromptLater').onclick = close;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.getElementById('backupPromptNow').onclick = async () => {
    close();
    if (window.exportFullBackup) await exportFullBackup();
    else Router.navigate('/settings/backup');
  };
}

window.BackupReminder.maybeShowBackupPrompt = maybeShowBackupPrompt;
window.BackupReminder.resetBackupPromptThrottle = () => { _backupPromptShownThisSession = false; };
