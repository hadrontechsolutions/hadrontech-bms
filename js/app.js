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
  if (!navigator.storage || !navigator.storage.persist) {
    // Older/unsupported browser -- can't even ask. Warn, since this is a real risk factor here.
    host.className = 'backup-banner';
    host.innerHTML = `<span>⚠ Your browser doesn't support protecting this app's local data from being cleared automatically. Please export backups often, and avoid clearing your browser's site data.</span>`;
    return;
  }
  try {
    const alreadyPersisted = await navigator.storage.persisted();
    const granted = alreadyPersisted || await navigator.storage.persist();
    if (!granted) {
      host.className = 'backup-banner';
      host.innerHTML = `
        <span>⚠ Your browser did not guarantee protected storage for this app -- it could clear your data automatically to free up space, or if your browser is set to clear site data when closed, or if used in a private/incognito window. Please export backups regularly.</span>
        <span class="backup-banner-actions"><button id="storageRiskDismiss" class="banner-dismiss" title="Dismiss for this session">✕</button></span>`;
      const dismissBtn = document.getElementById('storageRiskDismiss');
      if (dismissBtn) dismissBtn.onclick = () => { host.innerHTML = ''; host.className = ''; };
    }
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
