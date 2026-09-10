/* ============================================================
   backup.js — full JSON backup/restore + per-table CSV export.
   This is the primary safety net for an offline, single-device app.
   ============================================================ */

const BACKUP_STORES = ['customers', 'suppliers', 'products', 'quotations', 'customerPOs', 'salesOrders', 'supplierPOs', 'enquiries', 'stockMovements', 'proformaInvoices', 'technicalOffers', 'expenses', 'counters', 'settings', 'activity'];
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
        <button class="btn-line btn-sm" data-csv="enquiries">Enquiries.csv</button>
        <button class="btn-line btn-sm" data-csv="stockMovements">StockMovements.csv</button>
        <button class="btn-line btn-sm" data-csv="proformaInvoices">ProformaInvoices.csv</button>
        <button class="btn-line btn-sm" data-csv="technicalOffers">TechnicalOffers.csv</button>
        <button class="btn-line btn-sm" data-csv="expenses">Expenses.csv</button>
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

async function exportFullBackup() {
  const data = {};
  for (const s of BACKUP_STORES) data[s] = await DB.dbGetAll(s);
  const payload = { appVersion: APP_VERSION, dbVersion: 1, backupDate: new Date().toISOString(), data };
  const json = JSON.stringify(payload, null, 2);
  const settings = await DB.getSettings();
  const filename = backupFilename(settings);

  // If a folder has been explicitly chosen and remembered (Settings > Backup Folder), write
  // straight there with no dialog at all -- the whole point of remembering it. Otherwise fall
  // back to the save-location picker (Chrome/Edge), which at least remembers the last-used
  // folder on its own; and if neither is supported, the plain Downloads-folder behavior.
  let saved = false;
  const rememberedFolder = await getVerifiedBackupFolderHandle();
  if (rememberedFolder) {
    try {
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
  await DB.dbPut('settings', settings);
  await DB.logActivity('Exported full JSON backup');
  toast('Backup saved.');
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
  products: [{ label: 'Item No', value: 'itemNo' }, { label: 'Description', value: 'description' }, { label: 'Brand', value: 'brand' }, { label: 'Model', value: 'modelNo' }, { label: 'Cost', value: 'standardCost' }, { label: 'Price', value: 'standardPrice' }],
  quotations: [{ label: 'Quotation No', value: 'quotationNo' }, { label: 'Rev', value: 'revision' }, { label: 'Customer', value: r => r.customerSnapshot?.companyName || '' }, { label: 'Date', value: 'date' }, { label: 'Status', value: 'status' }, { label: 'Total', value: 'grandTotal' }],
  customerPOs: [{ label: 'Record No', value: 'poNo' }, { label: 'Customer PO No', value: 'customerPoNumber' }, { label: 'Date Received', value: 'dateReceived' }, { label: 'Status', value: 'status' }, { label: 'Amount', value: 'poAmount' }],
  salesOrders: [{ label: 'SO No', value: 'soNo' }, { label: 'Order Date', value: 'orderDate' }, { label: 'Status', value: 'status' }, { label: 'Total', value: 'grandTotal' }],
  supplierPOs: [{ label: 'PO No', value: 'poNo' }, { label: 'PO Date', value: 'poDate' }, { label: 'Status', value: 'status' }, { label: 'Total Cost', value: 'totalCost' }, { label: 'Amount Paid', value: r => (typeof SupplierPOs !== 'undefined' ? SupplierPOs.spoAmountPaid(r) : '') }, { label: 'Balance Due', value: r => (typeof SupplierPOs !== 'undefined' ? SupplierPOs.spoBalanceDue(r) : '') }, { label: 'Payment Status', value: r => (typeof SupplierPOs !== 'undefined' ? SupplierPOs.spoPaymentStatus(r) : '') }],
  enquiries: [{ label: 'Enquiry No', value: 'enquiryNo' }, { label: 'Customer', value: r => r.customerSnapshot?.companyName || '' }, { label: 'Subject', value: 'subject' }, { label: 'Stage', value: 'stage' }, { label: 'Date Received', value: 'dateReceived' }],
  stockMovements: [{ label: 'Date', value: 'date' }, { label: 'Product ID', value: 'productId' }, { label: 'Type', value: 'type' }, { label: 'Qty', value: 'qty' }, { label: 'Reference', value: 'reference' }, { label: 'Note', value: 'note' }, { label: 'By', value: 'createdBy' }],
  proformaInvoices: [{ label: 'PI No', value: 'piNo' }, { label: 'Sales Order ID', value: 'salesOrderId' }, { label: 'Date', value: 'date' }, { label: 'Invoice Amount', value: r => r.grandTotal ?? '' }, { label: 'Amount Paid', value: r => (typeof piAmountPaid === 'function' ? piAmountPaid(r) : '') }, { label: 'Balance Due', value: r => (typeof piBalanceDue === 'function' ? piBalanceDue(r) : '') }, { label: 'Payment Status', value: r => (typeof piPaymentStatus === 'function' ? piPaymentStatus(r) : '') }, { label: 'Notes', value: 'notes' }, { label: 'Created By', value: 'createdBy' }],
  technicalOffers: [{ label: 'Offer No', value: 'offerNo' }, { label: 'Customer ID', value: 'customerId' }, { label: 'End User', value: 'endUser' }, { label: 'RFQ Reference', value: 'rfqReference' }, { label: 'Date', value: 'date' }, { label: 'Status', value: r => r.status || 'Draft' }, { label: 'Item Count', value: r => (r.items || []).length }, { label: 'Spec Row Count', value: r => (r.specs || []).length }, { label: 'Created By', value: 'createdBy' }],
  expenses: [{ label: 'Expense No', value: 'expenseNo' }, { label: 'Date', value: 'date' }, { label: 'Category', value: 'category' }, { label: 'Description', value: 'description' }, { label: 'Payee', value: 'payee' }, { label: 'Amount', value: 'amount' }, { label: 'Payment Method', value: 'paymentMethod' }, { label: 'Reference No', value: 'referenceNo' }, { label: 'Created By', value: 'createdBy' }]
};

async function exportTableCSV(storeName) {
  const rows = await DB.dbGetAll(storeName);
  const csv = arrayToCSV(rows, CSV_COLUMNS[storeName]);
  downloadFile(`${storeName}.csv`, csv, 'text/csv');
}
