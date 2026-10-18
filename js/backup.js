/* ============================================================
   backup.js — full JSON backup/restore + per-table CSV export.
   This is the primary safety net for an offline, single-device app.
   ============================================================ */

const BACKUP_STORES = ['customers', 'suppliers', 'products', 'quotations', 'customerPOs', 'salesOrders', 'supplierPOs', 'enquiries', 'stockMovements', 'proformaInvoices', 'technicalOffers', 'expenses', 'notes', 'partners', 'distributions', 'deliveryReceipts', 'counters', 'settings', 'activity'];
const APP_VERSION = '1.0.0';

Router.route('/settings/backup', renderBackupPage);

async function renderBackupPage() {
  Router.setBreadcrumb([{ label: 'Company Settings', hash: '/settings' }, { label: 'Backup & Restore' }]);
  const counts = {};
  for (const s of BACKUP_STORES) counts[s] = (await DB.dbGetAll(s)).length;
  const settings = await DB.getSettings();
  const days = BackupReminder.daysSinceBackup(settings);
  const lastBackupText = days === null ? 'Never backed up yet' : (days === 0 ? 'Today' : `${days} day${days === 1 ? '' : 's'} ago`);

  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="page-head"><h1>Backup &amp; Restore</h1></div>

    <div class="card ${BackupReminder.isBackupOverdue(settings) ? 'warning-card' : 'ok-card'}">
      <div><b>Last backup:</b> ${escapeHtml(lastBackupText)}</div>
      <div style="margin-top:4px;">This application stores all data locally in this browser only — there is no cloud copy.
      Please export a backup regularly and store the file somewhere safe (e.g. Google Drive, a USB drive, or email it to yourself).</div>
      <div class="field" style="margin-top:10px; max-width:220px;"><label>Remind me if no backup in (days)</label>
        <input type="number" min="1" id="reminderDays" value="${settings.backupReminderDays || 7}">
      </div>
    </div>

    <div class="card">
      <h3 class="section-title">Current Data</h3>
      <table class="data-table compact"><tbody>
        ${BACKUP_STORES.filter(s => s !== 'settings' && s !== 'counters').map(s => `<tr><td>${s}</td><td>${counts[s]} record(s)</td></tr>`).join('')}
      </tbody></table>
    </div>

    <div class="card">
      <h3 class="section-title">Backup Folder</h3>
      <p class="muted-text">Choose a folder once, and every future backup saves straight there automatically — no need to browse for it each time, and Restore will look there first too.</p>
      <div id="backupFolderStatus" style="margin:8px 0; font-weight:600;">${await backupFolderStatusHTML()}</div>
      <button class="btn-amber" id="btnChooseFolder">${await hasBackupFolder() ? 'Change Backup Folder...' : 'Choose Backup Folder...'}</button>
      ${await hasBackupFolder() ? `<button class="btn-line" id="btnForgetFolder">Forget This Folder</button>` : ''}
      ${!window.showDirectoryPicker ? `<p class="muted-text" style="margin-top:8px;">Your browser doesn't support choosing a folder directly (this needs Chrome or Edge) — backups will still work using the normal save dialog.</p>` : ''}
      <hr class="divider">
      <div class="field" style="max-width:340px;">
        <label>Custom Backup Filename (optional)</label>
        <input id="f_customBackupFilename" value="${escapeHtml(settings.customBackupFilename || '')}" placeholder="Leave blank to use dated filenames">
      </div>
      <p class="muted-text" style="margin-top:4px;">If set, every backup is saved as exactly this filename, <b>overwriting the previous one each time</b> — no dated files to manage, but also no history to look back on if you ever need an older backup. Leave this blank (the default) to keep a separate dated file every time instead.</p>
      <button class="btn-line btn-sm" id="btnSaveFilename" style="margin-top:6px;">Save</button>
    </div>

    <div class="card">
      <h3 class="section-title">Full JSON Backup</h3>
      <p class="muted-text">Contains every record in every module, plus your settings and document number counters.</p>
      <button class="btn-amber" id="btnExportJson">Export Full Backup (.json)</button>
      <hr class="divider">
      <p class="muted-text">Restoring will <b>replace all current data</b> with the contents of the backup file.</p>
      <input type="file" id="fileRestore" accept=".json" style="display:none;">
      <button class="btn-danger" id="btnImportJson">Restore from Backup...</button>
    </div>

    <div class="card">
      <h3 class="section-title">CSV Export (per table, for Excel)</h3>
      <div class="csv-btns">
        <button class="btn-line btn-sm" data-csv="customers">Customers.csv</button>
        <button class="btn-line btn-sm" data-csv="suppliers">Suppliers.csv</button>
        <button class="btn-line btn-sm" data-csv="products">Products.csv</button>
        <button class="btn-line btn-sm" data-csv="quotations">Quotations.csv</button>
        <button class="btn-line btn-sm" data-csv="customerPOs">CustomerPOs.csv</button>
        <button class="btn-line btn-sm" data-csv="salesOrders">SalesOrders.csv</button>
        <button class="btn-line btn-sm" data-csv="supplierPOs">SupplierPOs.csv</button>
        <button class="btn-line btn-sm" data-csv="stockMovements">StockMovements.csv</button>
        <button class="btn-line btn-sm" data-csv="proformaInvoices">ProformaInvoices.csv</button>
        <button class="btn-line btn-sm" data-csv="technicalOffers">TechnicalOffers.csv</button>
        <button class="btn-line btn-sm" data-csv="expenses">Expenses.csv</button>
        <button class="btn-line btn-sm" data-csv="notes">RFQ Tracker.csv</button>
        <button class="btn-line btn-sm" data-csv="partners">Partners.csv</button>
        <button class="btn-line btn-sm" data-csv="distributions">Distributions.csv</button>
        <button class="btn-line btn-sm" data-csv="deliveryReceipts">Delivery Receipts.csv</button>
      </div>
    </div>
  `;

  document.getElementById('btnExportJson').onclick = exportFullBackup;
  document.getElementById('btnImportJson').onclick = chooseRestoreFile;
  document.getElementById('fileRestore').addEventListener('change', handleRestoreFile);
  document.getElementById('btnChooseFolder').onclick = chooseBackupFolder;
  const forgetBtn = document.getElementById('btnForgetFolder');
  if (forgetBtn) forgetBtn.onclick = forgetBackupFolder;
  document.getElementById('btnSaveFilename').onclick = async () => {
    const value = document.getElementById('f_customBackupFilename').value.trim();
    settings.customBackupFilename = value;
    await DB.dbPut('settings', settings);
    toast(value ? `Backups will now be saved as "${backupFilename(settings)}".` : 'Backups will use dated filenames again.');
  };
  document.getElementById('reminderDays').addEventListener('change', async (e) => {
    settings.backupReminderDays = Number(e.target.value) || 7;
    await DB.dbPut('settings', settings);
    toast('Reminder updated.');
    await BackupReminder.refreshBackupBanner();
  });
  content.querySelectorAll('[data-csv]').forEach(btn => btn.onclick = () => exportTableCSV(btn.dataset.csv));
}

/** Builds the filename used every time a backup is saved. Defaults to a dated name so backups
    never overwrite each other and stay easy to sort -- Hadrontech_Backup_2026-09-10.json. If a
    custom filename has been set in Settings, that's used verbatim instead (with .json appended
    if not already present), meaning every save DOES overwrite the same file on purpose -- that
    tradeoff (only ever having the latest backup, not a history of them) is explained in the
    Settings UI itself, not re-confirmed on every single save, since that would defeat the point
    of choosing this for convenience in the first place. */
function backupFilename(settings) {
  const custom = ((settings && settings.customBackupFilename) || '').trim();
  if (custom) return /\.json$/i.test(custom) ? custom : `${custom}.json`;
  return `Hadrontech_Backup_${todayISO()}.json`;
}

/* ------------------------------------------------------------
   Backup folder memory -- lets a person choose a folder ONCE, and have every future backup
   save straight there, and Restore look there first, without re-browsing every time. Only
   Chrome/Edge support the underlying File System Access API; everything here degrades
   gracefully to the existing save-dialog / plain-file-input behavior everywhere else.
   ------------------------------------------------------------ */

async function hasBackupFolder() {
  const settings = await DB.getSettings();
  return !!settings.backupFolderHandle;
}

async function backupFolderStatusHTML() {
  const settings = await DB.getSettings();
  if (!settings.backupFolderHandle) return `<span class="muted-text" style="font-weight:400;">No folder chosen yet — backups will ask where to save each time.</span>`;
  return `📁 ${escapeHtml(settings.backupFolderHandle.name)}`;
}

/** Returns the remembered folder handle with read/write permission actually confirmed for
    THIS session, or null if there's no folder remembered, the browser can't support it, or
    permission was denied/the folder is no longer accessible (e.g. it was moved or deleted).
    Never throws -- callers should treat null as "fall back to the normal save dialog". */
async function getVerifiedBackupFolderHandle() {
  if (!window.showDirectoryPicker) return null;
  const settings = await DB.getSettings();
  const handle = settings.backupFolderHandle;
  if (!handle) return null;
  try {
    let perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') perm = await handle.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') return null;
    return handle;
  } catch (err) {
    // Handle is stale (folder moved/deleted) or permission API misbehaved -- treat as "no folder".
    return null;
  }
}

async function chooseBackupFolder() {
  if (!window.showDirectoryPicker) { toast('Your browser doesn\u2019t support choosing a folder directly — try Chrome or Edge.', 'err'); return; }
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    const settings = await DB.getSettings();
    settings.backupFolderHandle = handle;
    await DB.dbPut('settings', settings);
    toast(`Backup folder set to "${handle.name}".`);
    renderBackupPage();
  } catch (err) {
    if (err && err.name === 'AbortError') return; // person closed the picker without choosing
    toast('Could not set that folder: ' + err.message, 'err');
  }
}

async function forgetBackupFolder() {
  const settings = await DB.getSettings();
  delete settings.backupFolderHandle;
  await DB.dbPut('settings', settings);
  toast('Backup folder forgotten. Backups will ask where to save each time again.');
  renderBackupPage();
}

/* ------------------------------------------------------------
   Backup safeguards -- so a backup of an EMPTY BMS can never silently replace a backup of real data.
   1. Empty-backup guard: before saving, compare what is about to be saved with the last backup
      (this browser's record of it, and the actual file in the backup folder) and stop to ask when
      it is far smaller or holds only the sample records.
   2. Previous backups: before the main backup file is replaced, the old one is kept in a
      "Previous backups" subfolder -- one copy per day, the fullest one of that day, newest 7 days.
   3. "Clean BMS" banner (backupReminder.js uses isCleanBMS below).
   ------------------------------------------------------------ */
var BACKUP_NON_BUSINESS = ['counters', 'settings', 'activity'];
var PREVIOUS_BACKUPS_FOLDER = 'Previous backups';
var PREVIOUS_BACKUPS_KEEP_DAYS = 7;

/** Counts business records in a backup's data object. `total` = every business record; `real` = those
    that are not the built-in sample records (sample records are created by "Sample Data"). */
function backupCounts(data) {
  let total = 0, real = 0;
  for (const store of BACKUP_STORES) {
    if (BACKUP_NON_BUSINESS.includes(store)) continue;
    const rows = (data && data[store]) || [];
    total += rows.length;
    if (store === 'stockMovements') continue;
    real += rows.filter(r => !(r && r.createdBy === 'Sample Data')).length;
  }
  return { total, real };
}
window.backupCounts = backupCounts;

/** True when this BMS holds nothing but the built-in sample records -- i.e. a clean/new install
    (or a browser that has none of the real data). */
async function isCleanBMS() {
  const data = {};
  for (const store of BACKUP_STORES) { if (!BACKUP_NON_BUSINESS.includes(store)) data[store] = await DB.dbGetAll(store); }
  return backupCounts(data).real === 0;
}
window.isCleanBMS = isCleanBMS;

function localDateKey(ms) {
  const d = new Date(ms);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Asks before saving a backup that looks wrong. Resolves true only if the person chooses "Save anyway".
    Cancel is the default (focused) button. */
function confirmBackupGuard(info) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.id = 'backupGuardOverlay';
    overlay.className = 'confirm-modal-overlay';
    const lines = [];
    if (info.real === 0) lines.push(`This BMS only has the built-in sample records — none of your real data (${info.total} record${info.total === 1 ? '' : 's'} in total).`);
    else lines.push(`This backup would contain only ${info.total} record${info.total === 1 ? '' : 's'}.`);
    if (info.refTotal > 0) lines.push(`${info.refWhere} has ${info.refTotal} records.`);
    overlay.innerHTML = `
      <div class="confirm-modal-box">
        <h3>⚠ Your data may not be loaded</h3>
        <p>${lines.map(escapeHtml).join('<br>')}</p>
        <p>Saving now could replace a good backup with an almost empty one. If you have a backup of your real data, cancel and use <b>Restore</b> on the Backup &amp; Restore page instead.</p>
        <div class="confirm-modal-actions">
          <button class="btn-amber" id="backupGuardCancel">Cancel — don't save</button>
          <button class="btn-line" id="backupGuardSave">Save anyway</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const done = (v) => { overlay.remove(); resolve(v); };
    document.getElementById('backupGuardCancel').onclick = () => done(false);
    document.getElementById('backupGuardSave').onclick = () => done(true);
    document.getElementById('backupGuardCancel').focus();
  });
}

/** Keeps the old backup file before it is replaced: one copy per day (the fullest one), newest 7 days.
    Never throws -- a problem here must never stop the real backup from being saved. Returns true if a
    copy of the old file now exists in the Previous backups folder. */
async function keepPreviousBackup(folder, oldText, oldModifiedMs) {
  try {
    const oldPayload = JSON.parse(oldText);
    const oldTotal = backupCounts(oldPayload.data || {}).total;
    const dir = await folder.getDirectoryHandle(PREVIOUS_BACKUPS_FOLDER, { create: true });
    const name = `Hadrontech_Backup_${localDateKey(oldModifiedMs)}.json`;
    let write = true;
    try {
      const existing = await (await dir.getFileHandle(name)).getFile();
      const existingTotal = backupCounts((JSON.parse(await existing.text()).data) || {}).total;
      if (existingTotal > oldTotal) write = false;   // that day already has a fuller copy -- keep it
    } catch (e) { /* no copy for that day yet */ }
    if (write) {
      const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
      await w.write(oldText); await w.close();
    }
    // Keep only the newest N days
    const names = [];
    for await (const [entryName] of dir.entries()) { if (/^Hadrontech_Backup_\d{4}-\d{2}-\d{2}\.json$/.test(entryName)) names.push(entryName); }
    names.sort().reverse();
    for (const old of names.slice(PREVIOUS_BACKUPS_KEEP_DAYS)) { try { await dir.removeEntry(old); } catch (e) { /* ignore */ } }
    return true;
  } catch (e) {
    return false;
  }
}

async function exportFullBackup() {
  const data = {};
  for (const s of BACKUP_STORES) data[s] = await DB.dbGetAll(s);
  const payload = { appVersion: APP_VERSION, dbVersion: 1, backupDate: new Date().toISOString(), data };
  const json = JSON.stringify(payload, null, 2);
  const settings = await DB.getSettings();
  const filename = backupFilename(settings);
  const counts = backupCounts(data);

  // Safeguard: look at what is already there (the file in the backup folder, and this browser's record of its
  // last backup) and stop to ask if what we are about to save looks far smaller or holds only sample data.
  const rememberedFolder = await getVerifiedBackupFolderHandle();
  let refTotal = Number(settings.lastBackupTotal) || 0;
  let refWhere = 'Your last backup from this browser';
  let existingText = null, existingModified = 0;
  if (rememberedFolder) {
    try {
      const existingFile = await (await rememberedFolder.getFileHandle(filename)).getFile();
      const text = await existingFile.text();
      const existingTotal = backupCounts((JSON.parse(text).data) || {}).total;
      existingText = text; existingModified = existingFile.lastModified || Date.now();
      if (existingTotal > refTotal) { refTotal = existingTotal; refWhere = `The existing backup file "${filename}" in your backup folder`; }
    } catch (e) { /* no existing file, unreadable, or not a backup -- nothing to compare with */ }
  }
  const looksWrong = counts.real === 0 || (refTotal >= 10 && counts.total < refTotal * 0.5);
  if (looksWrong && !(await confirmBackupGuard({ total: counts.total, real: counts.real, refTotal, refWhere }))) {
    toast('Backup not saved.');
    return;
  }

  // If a folder has been explicitly chosen and remembered (Settings > Backup Folder), write
  // straight there with no dialog at all -- the whole point of remembering it. Otherwise fall
  // back to the save-location picker (Chrome/Edge), which at least remembers the last-used
  // folder on its own; and if neither is supported, the plain Downloads-folder behavior.
  let saved = false;
  let keptPrevious = false;
  if (rememberedFolder) {
    try {
      if (existingText) keptPrevious = await keepPreviousBackup(rememberedFolder, existingText, existingModified);
      const fileHandle = await rememberedFolder.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(json);
      await writable.close();
      saved = true;
    } catch (err) {
      // Folder likely moved/deleted/permission revoked since being chosen -- fall through to
      // the picker below rather than silently failing, so the person still gets their backup.
    }
  }
  if (!saved && window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'Hadrontech Backup', accept: { 'application/json': ['.json'] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(json);
      await writable.close();
      saved = true;
    } catch (err) {
      // AbortError just means the person closed the dialog without saving -- not a real error,
      // and definitely not something that should still mark a backup as having happened.
      if (err && err.name === 'AbortError') return;
      // Any other failure (e.g. this specific site/permission combo behaving oddly) falls
      // through to the plain download method below rather than leaving the person with nothing.
    }
  }
  if (!saved) downloadFile(filename, json, 'application/json');

  settings.lastBackupExport = new Date().toISOString();
  settings.lastBackupTotal = counts.total;
  await DB.dbPut('settings', settings);
  await DB.logActivity('Exported full JSON backup');
  const storageBanner = document.getElementById('storageRiskBanner'); // the 'browser may clear data' warning is no longer needed once a backup exists
  if (storageBanner) { storageBanner.innerHTML = ''; storageBanner.className = ''; }
  toast(`Backup saved: ${counts.total} record${counts.total === 1 ? '' : 's'}.` + (keptPrevious ? ` The previous file was kept in "${PREVIOUS_BACKUPS_FOLDER}".` : ''));
  if (window.BackupReminder) await BackupReminder.refreshBackupBanner();
  window.__unbackedActivity = false;
  if (window.BackupReminder && window.BackupReminder.resetBackupPromptThrottle) window.BackupReminder.resetBackupPromptThrottle();
}
window.exportFullBackup = exportFullBackup;

/** Shared restore logic used by both the plain <input type="file"> path and the
    showOpenFilePicker path below, so the validation/confirmation/restore steps only exist once. */
async function processRestoreFile(file) {
  if (!file) return;
  let text;
  try { text = await file.text(); } catch (err) { toast('Could not read that file: ' + err.message, 'err'); return; }
  let payload;
  try { payload = JSON.parse(text); } catch { toast('That file is not valid JSON.', 'err'); return; }
  if (!payload || !payload.data || typeof payload.data !== 'object') { toast('This file does not look like a Hadrontech backup.', 'err'); return; }
  const missing = BACKUP_STORES.filter(s => !(s in payload.data));
  const summary = BACKUP_STORES.map(s => `${s}: ${(payload.data[s] || []).length}`).join(', ');
  if (!confirm(`Restore backup from ${payload.backupDate ? formatDate(payload.backupDate) : 'unknown date'}?\n\nThis will REPLACE all current data with:\n${summary}\n\nThis cannot be undone. Continue?`)) return;
  if (missing.length && !confirm(`Note: this backup is missing tables [${missing.join(', ')}] — those will be left empty. Continue anyway?`)) return;

  try {
    // Single atomic transaction across every store: either the whole restore
    // succeeds, or nothing changes at all — no half-restored state possible.
    await DB.restoreAll(BACKUP_STORES, payload.data);
    // An older backup carries an older set of numbering counters; re-add any counter that did not exist
    // yet when it was made (e.g. the Project Package counter) so new records can still be numbered.
    await DB.ensureCounters();
    await DB.logActivity('Restored data from backup file');
    toast('Backup restored successfully.');
    if (window.BackupReminder) await BackupReminder.refreshBackupBanner();
    Router.navigate('/dashboard');
  } catch (err) {
    toast('Restore failed — no data was changed: ' + err.message, 'err');
  }
}

function handleRestoreFile(e) {
  const file = e.target.files[0];
  processRestoreFile(file);
  e.target.value = '';
}

/** If the browser supports it, opens the native "choose a file" picker starting right in the
    remembered backup folder (if one's been chosen) -- so restoring is "open the folder that's
    already showing, pick the backup you want" instead of browsing from scratch. Falls back to
    the plain <input type="file"> click for unsupported browsers, exactly as before. */
async function chooseRestoreFile() {
  if (!window.showOpenFilePicker) { document.getElementById('fileRestore').click(); return; }
  try {
    const options = { types: [{ description: 'Hadrontech Backup', accept: { 'application/json': ['.json'] } }] };
    const rememberedFolder = await getVerifiedBackupFolderHandle();
    if (rememberedFolder) options.startIn = rememberedFolder;
    const [fileHandle] = await window.showOpenFilePicker(options);
    const file = await fileHandle.getFile();
    await processRestoreFile(file);
  } catch (err) {
    if (err && err.name === 'AbortError') return; // person closed the picker without choosing
    document.getElementById('fileRestore').click(); // unexpected failure — still let them restore
  }
}

const CSV_COLUMNS = {
  customers: [{ label: 'Customer No', value: 'customerNo' }, { label: 'Company', value: 'companyName' }, { label: 'Contact', value: 'contactPerson' }, { label: 'Email', value: 'email' }, { label: 'Phone', value: 'telephone' }, { label: 'Status', value: 'status' }],
  suppliers: [{ label: 'Supplier No', value: 'supplierNo' }, { label: 'Company', value: 'companyName' }, { label: 'Contact', value: 'contactPerson' }, { label: 'Email', value: 'email' }, { label: 'Brands', value: 'brandsSupplied' }, { label: 'Status', value: 'status' }],
  products: [{ label: 'Item No', value: 'itemNo' }, { label: 'Description', value: 'description' }, { label: 'Brand', value: 'brand' }, { label: 'Model', value: 'modelNo' }, { label: 'Cost', value: 'standardCost' }, { label: 'Price', value: 'standardPrice' }, { label: 'Est. Freight Cost', value: 'estimatedFreightCost' }, { label: 'Freight Covers Qty', value: 'freightCoversQty' }],
  quotations: [{ label: 'Quotation No', value: 'quotationNo' }, { label: 'Rev', value: 'revision' }, { label: 'Customer', value: r => r.customerSnapshot?.companyName || '' }, { label: 'Date', value: 'date' }, { label: 'Status', value: 'status' }, { label: 'Total', value: 'grandTotal' }],
  customerPOs: [{ label: 'Record No', value: 'poNo' }, { label: 'Customer PO No', value: 'customerPoNumber' }, { label: 'Date Received', value: 'dateReceived' }, { label: 'Status', value: 'status' }, { label: 'Amount', value: 'poAmount' }],
  salesOrders: [{ label: 'SO No', value: 'soNo' }, { label: 'Order Date', value: 'orderDate' }, { label: 'Status', value: 'status' }, { label: 'Total', value: 'grandTotal' }],
  supplierPOs: [{ label: 'PO No', value: 'poNo' }, { label: 'PO Date', value: 'poDate' }, { label: 'Status', value: 'status' }, { label: 'Total Cost', value: 'totalCost' }, { label: 'Amount Paid', value: r => (typeof SupplierPOs !== 'undefined' ? SupplierPOs.spoAmountPaid(r) : '') }, { label: 'Balance Due', value: r => (typeof SupplierPOs !== 'undefined' ? SupplierPOs.spoBalanceDue(r) : '') }, { label: 'Payment Status', value: r => (typeof SupplierPOs !== 'undefined' ? SupplierPOs.spoPaymentStatus(r) : '') }],
  stockMovements: [{ label: 'Date', value: 'date' }, { label: 'Product ID', value: 'productId' }, { label: 'Type', value: 'type' }, { label: 'Qty', value: 'qty' }, { label: 'Reference', value: 'reference' }, { label: 'Note', value: 'note' }, { label: 'By', value: 'createdBy' }],
  proformaInvoices: [{ label: 'PI No', value: 'piNo' }, { label: 'Sales Order ID', value: 'salesOrderId' }, { label: 'Date', value: 'date' }, { label: 'Invoice Amount', value: r => r.grandTotal ?? '' }, { label: 'Amount Paid', value: r => (typeof piAmountPaid === 'function' ? piAmountPaid(r) : '') }, { label: 'Balance Due', value: r => (typeof piBalanceDue === 'function' ? piBalanceDue(r) : '') }, { label: 'Payment Status', value: r => (typeof piPaymentStatus === 'function' ? piPaymentStatus(r) : '') }, { label: 'Notes', value: 'notes' }, { label: 'Created By', value: 'createdBy' }],
  technicalOffers: [{ label: 'Offer No', value: 'offerNo' }, { label: 'Customer ID', value: 'customerId' }, { label: 'End User', value: 'endUser' }, { label: 'RFQ Reference', value: 'rfqReference' }, { label: 'Date', value: 'date' }, { label: 'Status', value: r => r.status || 'Draft' }, { label: 'Item Count', value: r => (r.items || []).length }, { label: 'Spec Row Count', value: r => (r.specs || []).length }, { label: 'Created By', value: 'createdBy' }],
  expenses: [{ label: 'Expense No', value: 'expenseNo' }, { label: 'Date', value: 'date' }, { label: 'Category', value: 'category' }, { label: 'Description', value: 'description' }, { label: 'Payee', value: 'payee' }, { label: 'Paid to / Bought from', value: 'vendor' }, { label: 'Amount', value: 'amount' }, { label: 'Payment Method', value: 'paymentMethod' }, { label: 'Reference No', value: 'referenceNo' }, { label: 'Created By', value: 'createdBy' }],
  notes: [{ label: 'Ref No', value: 'noteNo' }, { label: 'Type', value: r => r.kind === 'RFQ' ? 'RFQ' : 'General note' }, { label: 'Date', value: 'date' }, { label: 'Customer / For', value: 'title' }, { label: 'RFQ / Inquiry Reference', value: 'referenceEmail' }, { label: 'End-User', value: 'endUser' }, { label: 'Ball With', value: 'ballWith' }, { label: 'Quotation', value: 'quotationNo' }, { label: 'Suppliers Asked', value: r => (r.suppliers || []).map(s => s.name).join('; ') }, { label: 'Remind After (days)', value: 'remindAfterDays' }, { label: 'Status', value: 'status' }, { label: 'Created By', value: 'createdBy' }],
  partners: [{ label: 'Partner No', value: 'partnerNo' }, { label: 'Name', value: 'name' }, { label: 'Role', value: 'role' }, { label: 'Default Split %', value: 'defaultSplitPercent' }, { label: 'Status', value: 'status' }],
  deliveryReceipts: [{ label: 'Receipt No', value: 'drNo' }, { label: 'Delivery Date', value: 'date' }, { label: 'Customer', value: r => (r.customerSnapshot || {}).companyName || '' }, { label: 'Sales Order', value: 'soNo' }, { label: 'Customer PO', value: 'customerPoNo' }, { label: 'Official Invoice No', value: 'invoiceNo' }, { label: 'Delivered By', value: 'deliveredBy' }, { label: 'Vehicle / Courier / Waybill', value: 'vehicle' }, { label: 'Items', value: r => (r.lines || []).map(l => l.qty + ' ' + l.uom + ' ' + l.description).join(' | ') }, { label: 'Status', value: 'status' }, { label: 'Signed By', value: 'receivedBy' }, { label: 'Signed Copy Received', value: 'receivedDate' }, { label: 'Created By', value: 'createdBy' }],
  distributions: [{ label: 'Distribution No', value: 'distributionNo' }, { label: 'Month', value: 'month' }, { label: 'Gross Profit', value: 'grossProfitTotal' }, { label: 'Expenses', value: 'expensesTotal' }, { label: 'Net Profit', value: 'netProfit' }, { label: 'Reserve %', value: 'reservePercent' }, { label: 'Reserve Amount', value: 'reserveAmount' }, { label: 'Distributable Amount', value: 'distributableAmount' }, { label: 'Cash Received in Month', value: 'cashReceivedInMonth' }, { label: 'Reference', value: 'reference' }, { label: 'Created By', value: 'createdBy' }]
};

async function exportTableCSV(storeName) {
  const rows = await DB.dbGetAll(storeName);
  const csv = arrayToCSV(rows, CSV_COLUMNS[storeName]);
  downloadFile(`${storeName}.csv`, csv, 'text/csv');
}
