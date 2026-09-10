/* ============================================================
   backup.js — full JSON backup/restore + per-table CSV export.
   This is the primary safety net for an offline, single-device app.
   ============================================================ */

const BACKUP_STORES = ['customers', 'suppliers', 'products', 'quotations', 'customerPOs', 'salesOrders', 'supplierPOs', 'enquiries', 'stockMovements', 'proformaInvoices', 'technicalOffers', 'expenses', 'counters', 'settings', 'activity'];
const APP_VERSION = '1.0.0';

Router.route('/settings/backup', async () => {
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
  document.getElementById('btnImportJson').onclick = () => document.getElementById('fileRestore').click();
  document.getElementById('fileRestore').addEventListener('change', handleRestoreFile);
  document.getElementById('reminderDays').addEventListener('change', async (e) => {
    settings.backupReminderDays = Number(e.target.value) || 7;
    await DB.dbPut('settings', settings);
    toast('Reminder updated.');
    await BackupReminder.refreshBackupBanner();
  });
  content.querySelectorAll('[data-csv]').forEach(btn => btn.onclick = () => exportTableCSV(btn.dataset.csv));
});

/** Builds the standard filename used everywhere a backup is saved, so every backup this app
    ever produces is easy to recognize and sort by date -- Hadrontech_Backup_2026-09-10.json,
    never a generic "backup(3).json" a person has to guess the origin of later. */
function backupFilename() {
  return `Hadrontech_Backup_${todayISO()}.json`;
}

async function exportFullBackup() {
  const data = {};
  for (const s of BACKUP_STORES) data[s] = await DB.dbGetAll(s);
  const payload = { appVersion: APP_VERSION, dbVersion: 1, backupDate: new Date().toISOString(), data };
  const json = JSON.stringify(payload, null, 2);
  const filename = backupFilename();

  // Chrome/Edge support picking a real save location with a native file dialog, which is what
  // was actually asked for -- the browser remembers the folder used last time, so after the
  // first save it naturally opens right back where you left it. Firefox/Safari don't support
  // this API at all, so they fall back to the normal Downloads-folder behavior everyone already
  // knows, exactly as this app already did before.
  let savedViaPicker = false;
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'Hadrontech Backup', accept: { 'application/json': ['.json'] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(json);
      await writable.close();
      savedViaPicker = true;
    } catch (err) {
      // AbortError just means the person closed the dialog without saving -- not a real error,
      // and definitely not something that should still mark a backup as having happened.
      if (err && err.name === 'AbortError') return;
      // Any other failure (e.g. this specific site/permission combo behaving oddly) falls
      // through to the plain download method below rather than leaving the person with nothing.
    }
  }
  if (!savedViaPicker) downloadFile(filename, json, 'application/json');

  const settings = await DB.getSettings();
  settings.lastBackupExport = new Date().toISOString();
  await DB.dbPut('settings', settings);
  await DB.logActivity('Exported full JSON backup');
  toast('Backup saved.');
  if (window.BackupReminder) await BackupReminder.refreshBackupBanner();
  window.__unbackedActivity = false;
  if (window.BackupReminder && window.BackupReminder.resetBackupPromptThrottle) window.BackupReminder.resetBackupPromptThrottle();
}
window.exportFullBackup = exportFullBackup;

function handleRestoreFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (ev) => {
    let payload;
    try { payload = JSON.parse(ev.target.result); } catch { toast('That file is not valid JSON.', 'err'); return; }
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
  };
  reader.readAsText(file);
  e.target.value = '';
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
