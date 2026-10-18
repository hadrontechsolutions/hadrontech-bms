/* ============================================================
   app.js — application entry point. Loaded last, after every other
   module has registered its routes with Router.route(...).
   ============================================================ */

/** Sets the sidebar-header brand text. The uploaded Company Logo (Settings > Company
    Profile) is deliberately NEVER shown here — by design, it's used exclusively on printed
    Quotations/Sales Orders/Supplier POs, never in the app's own interface, regardless of
    whether one is uploaded. The app header is always text-only. */
function applyBrandHeader(settings) {
  const text = document.getElementById('brandText');
  text.innerHTML = `${escapeHtml((settings.logoText || settings.companyName || 'HADRONTECH').toUpperCase())}<span class="sub">Business Management System</span>`;
}
window.applyBrandHeader = applyBrandHeader;

/** Every business record in this app lives only in this browser's local storage -- there is no
    server copy. Browsers can silently evict that storage under disk pressure unless a site has
    been granted "persistent" storage, which is a real, separate permission from just being able
    to read/write it normally. This asks for that protection once per session and surfaces a
    clear warning if the browser declines, since declining is a genuine risk factor for exactly
    the kind of "everything was gone when I reopened the browser" data loss this exists to guard
    against. It does NOT protect against a person's own browser settings (e.g. "clear site data
    on close") or using a private/incognito window -- those are separate risks, mentioned in the
    warning text itself so the person knows persistence alone isn't a complete guarantee. */
async function requestPersistentStorage() {
  const host = document.getElementById('storageRiskBanner');
  if (!host) return;
  /* The browser's refusal only matters if there is no recent backup to fall back on, so the warning is
     shown only while the last backup is older than the reminder period (Settings > Backup & Restore),
     or none has been saved yet. A BMS holding only sample records is skipped: its own banner already
     says to restore first. */
  const showRisk = async () => {
    const settings = await DB.getSettings();
    if (window.isCleanBMS && await window.isCleanBMS()) return;
    if (window.BackupReminder && !BackupReminder.isBackupOverdue(settings)) return;
    const days = window.BackupReminder ? BackupReminder.daysSinceBackup(settings) : null;
    const since = days === null ? `You haven't saved a backup yet` : `Your last backup was ${days} day${days === 1 ? '' : 's'} ago`;
    host.className = 'backup-banner';
    host.innerHTML = `
      <span>⚠ Your browser may clear this app's data if the computer runs low on disk space. ${since} — please save a backup.</span>
      <span class="backup-banner-actions">
        <button id="storageRiskBackupNow">Back Up Now</button>
        <button id="storageRiskDismiss" class="banner-dismiss" title="Dismiss for this session">✕</button>
      </span>`;
    document.getElementById('storageRiskDismiss').onclick = () => { host.innerHTML = ''; host.className = ''; };
    document.getElementById('storageRiskBackupNow').onclick = async () => {
      if (window.exportFullBackup) await exportFullBackup(); else Router.navigate('/settings/backup');
    };
  };
  if (!navigator.storage || !navigator.storage.persist) { await showRisk(); return; }  // older browser: cannot even ask
  try {
    const alreadyPersisted = await navigator.storage.persisted();
    const granted = alreadyPersisted || await navigator.storage.persist();
    if (!granted) await showRisk();
  } catch (e) {
    // If the permission check itself fails for some reason, fail quietly rather than blocking boot.
  }
}

async function boot() {
  try {
    await DB.openDB();
    await DB.ensureCounters();
    const settings = await DB.getSettings();
    await seedIfEmpty();
    setBusinessTax(await DB.getSettings());
    if (window.SupplierPOs && SupplierPOs.fillMissingRates) await SupplierPOs.fillMissingRates();
    applyBrandHeader(settings);
    if (window.BackupReminder) await BackupReminder.refreshBackupBanner();
    await requestPersistentStorage();
  } catch (err) {
    document.getElementById('content').innerHTML =
      `<div class="empty-state"><h3>Could not open the local database</h3><p>${escapeHtml(err.message)}</p>
       <p class="muted-text">Try using Chrome or Edge, and make sure you are not in a private/incognito window with storage disabled.</p></div>`;
    return;
  }

  // Sidebar collapse/expand toggle — preference persists across sessions (this is a display
  // preference tied to this browser, not business data, so it doesn't need to be part of the
  // portable JSON backup the way company settings do).
  document.getElementById('sidebarToggle').addEventListener('click', () => {
    const collapsed = document.body.classList.toggle('sidebar-collapsed');
    localStorage.setItem('hadrontechSidebarCollapsed', collapsed ? '1' : '0');
  });

  // Sidebar nav clicks (also works via plain <a href="#...">, this just guards unsaved changes)
  document.querySelectorAll('.nav-link').forEach(a => {
    a.addEventListener('click', (e) => {
      if (!guardNavigation()) { e.preventDefault(); return; }
      clearDirty();
    });
  });

  await Router.resolveRoute();
}

document.addEventListener('DOMContentLoaded', boot);
