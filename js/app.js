/* ============================================================
   app.js — application entry point. Loaded last, after every other
   module has registered its routes with Router.route(...).
   ============================================================ */

/** Swaps the sidebar-header brand mark for an uploaded logo image, if one exists. */
function applyBrandHeader(settings) {
  const mark = document.getElementById('brandMark');
  const text = document.getElementById('brandText');
  if (settings.logoDataUrl) {
    mark.innerHTML = `<img src="${settings.logoDataUrl}" alt="Logo" style="width:32px;height:32px;object-fit:contain;">`;
  }
  text.innerHTML = `${escapeHtml((settings.logoText || settings.companyName || 'HADRONTECH').toUpperCase())}<span class="sub">Business Management System</span>`;
}
window.applyBrandHeader = applyBrandHeader;

async function boot() {
  try {
    await DB.openDB();
    await DB.ensureCounters();
    const settings = await DB.getSettings();
    await seedIfEmpty();
    applyBrandHeader(settings);
    if (window.BackupReminder) await BackupReminder.refreshBackupBanner();
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
