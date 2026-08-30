/* ============================================================
   db.js — IndexedDB data layer for Hadrontech Business Management System
   All persistent data lives here. Every other module talks to the
   database only through the functions exported on window.DB.
   ============================================================ */

const DB_NAME = 'HadrontechDB';
const DB_VERSION = 4; // v4 adds the 'proformaInvoices' store — existing data is untouched on upgrade.
let _db = null;

/** Opens (and if needed, creates/upgrades) the database. Call once at startup. */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      const mk = (name, opts, indexes) => {
        if (db.objectStoreNames.contains(name)) return;
        const store = db.createObjectStore(name, opts);
        (indexes || []).forEach(([idxName, keyPath, unique]) => {
          store.createIndex(idxName, keyPath, { unique: !!unique });
        });
      };

      mk('customers', { keyPath: 'id', autoIncrement: true }, [
        ['customerNo', 'customerNo', true], ['companyName', 'companyName'], ['status', 'status']
      ]);
      mk('suppliers', { keyPath: 'id', autoIncrement: true }, [
        ['supplierNo', 'supplierNo', true], ['companyName', 'companyName'], ['status', 'status']
      ]);
      mk('products', { keyPath: 'id', autoIncrement: true }, [
        ['itemNo', 'itemNo', true], ['category', 'category'], ['status', 'status']
      ]);
      mk('quotations', { keyPath: 'id', autoIncrement: true }, [
        ['quotationNo', 'quotationNo'], ['familyId', 'familyId'],
        ['customerId', 'customerId'], ['status', 'status'], ['isLatest', 'isLatest']
      ]);
      mk('customerPOs', { keyPath: 'id', autoIncrement: true }, [
        ['poNo', 'poNo', true], ['customerId', 'customerId'], ['quotationId', 'quotationId']
      ]);
      mk('salesOrders', { keyPath: 'id', autoIncrement: true }, [
        ['soNo', 'soNo', true], ['customerId', 'customerId'],
        ['quotationId', 'quotationId'], ['customerPOId', 'customerPOId'], ['status', 'status']
      ]);
      mk('supplierPOs', { keyPath: 'id', autoIncrement: true }, [
        ['poNo', 'poNo', true], ['supplierId', 'supplierId'],
        ['salesOrderId', 'salesOrderId'], ['status', 'status']
      ]);
      mk('enquiries', { keyPath: 'id', autoIncrement: true }, [
        ['enquiryNo', 'enquiryNo', true], ['customerId', 'customerId'], ['stage', 'stage'],
        ['quotationId', 'quotationId'], ['salesOrderId', 'salesOrderId']
      ]);
      // Every physical stock movement (receiving from a supplier, delivering to a customer,
      // or a manual correction) is logged here — this is the single source of truth for
      // inventory, not a bare editable number. A product's On Hand quantity is always derived
      // by summing its movements, so there's always a traceable "why" behind the number.
      mk('stockMovements', { keyPath: 'id', autoIncrement: true }, [
        ['productId', 'productId'], ['date', 'date'], ['type', 'type']
      ]);
      mk('proformaInvoices', { keyPath: 'id', autoIncrement: true }, [
        ['piNo', 'piNo', true], ['salesOrderId', 'salesOrderId']
      ]);
      mk('counters', { keyPath: 'name' });
      mk('settings', { keyPath: 'key' });
      mk('activity', { keyPath: 'id', autoIncrement: true }, [['date', 'date']]);
    };

    req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror = (e) => reject(e.target.error);
  });
}

function tx(storeName, mode) {
  return _db.transaction(storeName, mode).objectStore(storeName);
}

/* ---------- Generic CRUD (used by every module) ---------- */

function dbAdd(storeName, obj) {
  return new Promise((resolve, reject) => {
    const req = tx(storeName, 'readwrite').add(obj);
    req.onsuccess = () => resolve(req.result); // returns new id
    req.onerror = () => reject(req.error);
  });
}

function dbPut(storeName, obj) {
  return new Promise((resolve, reject) => {
    const req = tx(storeName, 'readwrite').put(obj);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbGet(storeName, id) {
  return new Promise((resolve, reject) => {
    const req = tx(storeName, 'readonly').get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

function dbGetAll(storeName) {
  return new Promise((resolve, reject) => {
    const req = tx(storeName, 'readonly').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function dbDelete(storeName, id) {
  return new Promise((resolve, reject) => {
    const req = tx(storeName, 'readwrite').delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

/** Returns all records whose index `idxName` equals `value`. */
function dbQueryIndex(storeName, idxName, value) {
  return new Promise((resolve, reject) => {
    const idx = tx(storeName, 'readonly').index(idxName);
    const req = idx.getAll(value);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

/* ---------- Document numbering ---------- */
// Counters are stored as { name, prefix, next, pattern }.
// pattern 'YEARSEQ' -> PREFIX-YYYY-0001 (used for transaction docs)
// pattern 'SEQ'     -> PREFIX-00001      (used for master records)

async function getCounter(name) {
  return (await dbGet('counters', name)) || null;
}

async function ensureCounters() {
  const defaults = [
    { name: 'customer', prefix: 'CUST', next: 1, pattern: 'SEQ', digits: 5 },
    { name: 'supplier', prefix: 'SUP', next: 1, pattern: 'SEQ', digits: 5 },
    { name: 'product', prefix: 'ITEM', next: 1, pattern: 'SEQ', digits: 5 },
    { name: 'enquiry', prefix: 'HT-ENQ', next: 1, pattern: 'YEARSEQ', digits: 4 },
    { name: 'quotation', prefix: 'HT-Q', next: 1, pattern: 'YEARSEQ', digits: 4 },
    { name: 'customerPO', prefix: 'CPO', next: 1, pattern: 'YEARSEQ', digits: 4 },
    { name: 'salesOrder', prefix: 'HT-SO', next: 1, pattern: 'YEARSEQ', digits: 4 },
    { name: 'supplierPO', prefix: 'HT-PO', next: 1, pattern: 'YEARSEQ', digits: 4 },
    { name: 'proformaInvoice', prefix: 'HT-PI', next: 1, pattern: 'YEARSEQ', digits: 4 },
  ];
  for (const d of defaults) {
    const existing = await getCounter(d.name);
    if (!existing) await dbAdd('counters', d);
  }
}

/** Atomically returns the next formatted document number and advances the counter.
    Uses a single read-modify-write transaction so two rapid calls (e.g. a double-click
    on Save) can never read the same "next" value and produce duplicate numbers. */
function nextDocNumber(counterName) {
  return new Promise((resolve, reject) => {
    const store = tx('counters', 'readwrite');
    const getReq = store.get(counterName);
    getReq.onsuccess = () => {
      const c = getReq.result;
      if (!c) { reject(new Error('Unknown counter: ' + counterName)); return; }
      const seqStr = String(c.next).padStart(c.digits, '0');
      const formatted = c.pattern === 'YEARSEQ'
        ? `${c.prefix}-${new Date().getFullYear()}-${seqStr}`
        : `${c.prefix}-${seqStr}`;
      c.next += 1;
      const putReq = store.put(c);
      putReq.onsuccess = () => resolve(formatted);
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/* ---------- Settings (single 'company' record) ---------- */

const DEFAULT_SETTINGS = {
  key: 'company',
  companyName: 'Hadrontech Industrial Solutions',
  logoText: 'HADRONTECH',
  logoDataUrl: '', // base64 data URL of an uploaded logo image, if any
  signatureDataUrl: '', // base64 data URL of an uploaded signature image (e.g. transparent PNG), if any
  address: 'General Trias, Cavite, Philippines',
  email: '',
  telephone: '',
  website: '',
  tin: '',
  defaultCurrency: 'PHP',
  referenceRates: { USD: 58, EUR: 62 }, // exchange rate TO PHP for each non-PHP currency in use; PHP itself is always 1 and implicit — add/edit currencies (e.g. SGD, HKD, QAR, AED) in Settings
  defaultVatRate: 12,
  defaultPaymentTerms: '50% down payment, 50% before delivery',
  defaultQuotationValidityDays: 30,
  defaultWarranty: 'As per manufacturer warranty',
  defaultIncoterms: 'EXW',
  authorizedSignatory: 'Authorized Signatory',
  bankName: '', bankAccountName: '', bankAccountNumber: '', bankSwiftCode: '', bankAddress: '',
  userName: 'Admin',
  lastBackupExport: null, // ISO date string of the last successful full JSON backup export
  backupReminderDays: 7, // show the "please back up" banner once this many days pass without one
  footerTerms:
`1. Prices are quoted in Philippine Peso (PHP) unless stated otherwise and are subject to change without prior notice.
2. Payment Terms: as stated above.
3. Delivery lead time to be confirmed upon order placement.
4. Prices exclude freight/delivery charges unless otherwise stated.`
};

async function getSettings() {
  const s = await dbGet('settings', 'company');
  if (s) return s;
  await dbPut('settings', DEFAULT_SETTINGS);
  return DEFAULT_SETTINGS;
}

/* ---------- Activity log ---------- */

async function logActivity(text) {
  await dbAdd('activity', { text, date: new Date().toISOString() });
}

async function recentActivity(limit) {
  const all = await dbGetAll('activity');
  return all.sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit || 10);
}

/**
 * Atomically replaces the contents of the given stores with the given data.
 * Runs as ONE IndexedDB transaction spanning all stores: if anything fails partway
 * through, the browser rolls back every change automatically and nothing is left
 * half-restored. This is what Backup & Restore uses instead of restoring store-by-store.
 */
function restoreAll(storeNames, dataByStore) {
  return new Promise((resolve, reject) => {
    const transaction = _db.transaction(storeNames, 'readwrite');
    transaction.onerror = (e) => reject(e.target.error);
    transaction.onabort = (e) => reject(e.target.error || new Error('Restore transaction aborted'));
    transaction.oncomplete = () => resolve(true);

    for (const name of storeNames) {
      const store = transaction.objectStore(name);
      store.clear();
      for (const rec of (dataByStore[name] || [])) {
        store.put(rec);
      }
    }
  });
}

window.DB = {
  openDB, dbAdd, dbPut, dbGet, dbGetAll, dbDelete, dbQueryIndex,
  ensureCounters, nextDocNumber, getSettings, logActivity, recentActivity, restoreAll
};
