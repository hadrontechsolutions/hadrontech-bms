/* Office (👥 in the menu, right below Dashboard): checks it is wired into the BMS and stays read-only.
   - the menu link sits right below Dashboard and opens #/office
   - the Office page loads office/office.html in a frame
   - every record number the Office can show opens the right BMS page
   - collecting the data for the Office never writes to the BMS database */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
require('fake-indexeddb/auto');
const APP = __dirname;
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; };

async function main() {
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const win = dom.window; const doc = win.document;
  win.indexedDB = global.indexedDB; win.IDBKeyRange = global.IDBKeyRange; win.confirm = () => true; win.alert = () => {};
  for (const src of [...doc.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => s !== 'js/app.js')) win.eval(fs.readFileSync(path.join(APP, src), 'utf8'));
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  await win.DB.openDB(); await win.DB.ensureCounters();

  // menu
  const links = [...doc.querySelectorAll('.app-sidebar .nav-link')];
  ok(links[0].getAttribute('href') === '#/dashboard' && links[1].getAttribute('href') === '#/office', 'Office link is right below Dashboard');
  ok(links[1].textContent.includes('Office'), 'menu label says Office');
  ok(fs.existsSync(path.join(APP, 'office', 'office.html')), 'office/office.html exists');

  // page
  win.location.hash = '#/office'; await win.Router.resolveRoute(); await wait(30);
  const frame = doc.getElementById('officeFrame');
  ok(frame && frame.getAttribute('src') === 'office/office.html', '#/office shows the Office frame');
  ok(doc.querySelector('.nav-link.active') && doc.querySelector('.nav-link.active').getAttribute('href') === '#/office', 'Office is highlighted in the menu');

  // one record of every kind
  const now = new Date().toISOString();
  const cid = await win.DB.dbAdd('customers', { customerNo: 'C1', companyName: 'KEYEC', status: 'Active', createdAt: now });
  const sid = await win.DB.dbAdd('suppliers', { supplierNo: 'SUP-00016', companyName: 'MyProjectorLamps', currency: 'HKD', status: 'Active', createdAt: now });
  const pid = await win.DB.dbAdd('products', { itemNo: 'ITEM-00048', description: 'Projector lamp', defaultSupplierId: sid, status: 'Active', createdAt: now });
  const q0 = await win.DB.dbAdd('quotations', { quotationNo: 'HT-Q-2026-0044', revision: 0, isLatest: false, customerId: cid, lines: [], createdAt: now });
  const q1 = await win.DB.dbAdd('quotations', { quotationNo: 'HT-Q-2026-0044', revision: 1, isLatest: true, customerId: cid, lines: [], createdAt: now });
  const rid = await win.DB.dbAdd('notes', { noteNo: 'HT-RFQ-2026-0014', kind: 'RFQ', title: 'AEROTRAK', customerId: cid, status: 'New', date: '2026-10-27', emailLog: [], createdAt: now, updatedAt: now });
  const cpo = await win.DB.dbAdd('customerPOs', { poNo: 'CPO-2026-0003', customerId: cid, lines: [], createdAt: now });
  const so = await win.DB.dbAdd('salesOrders', { soNo: 'HT-SO-2026-0005', customerId: cid, lines: [], createdAt: now });
  const po = await win.DB.dbAdd('supplierPOs', { poNo: 'HT-PO-2026-0007', supplierId: sid, lines: [], createdAt: now });
  const dr = await win.DB.dbAdd('deliveryReceipts', { drNo: 'HT-DR-2026-0001', salesOrderId: so, customerId: cid, status: 'Issued', lines: [], createdAt: now });
  const pi = await win.DB.dbAdd('proformaInvoices', { piNo: 'HT-PI-2026-0004', salesOrderId: so, createdAt: now });
  const to = await win.DB.dbAdd('technicalOffers', { offerNo: 'HT-TO-2026-0004', customerId: cid, items: [], createdAt: now });
  const expect = {
    'HT-Q-2026-0044': '/quotations/' + q1, 'HT-RFQ-2026-0014': '/rfq-tracker/' + rid, 'CPO-2026-0003': '/customer-pos/' + cpo,
    'HT-SO-2026-0005': '/sales-orders/' + so, 'HT-PO-2026-0007': '/supplier-pos/' + po, 'HT-DR-2026-0001': '/delivery-receipts/' + dr,
    'HT-PI-2026-0004': '/proforma-invoices/' + pi, 'HT-TO-2026-0004': '/technical-offers/' + to, 'ITEM-00048': '/products/' + pid, 'SUP-00016': '/suppliers/' + sid
  };
  for (const [no, hash] of Object.entries(expect)) {
    const got = await win.Office.officeRecordHash(no);
    ok(got === hash, `${no} opens ${hash} (got ${got})`);
    win.location.hash = '#' + got; await win.Router.resolveRoute(); await wait(40);
    const c = doc.getElementById('content').textContent;
    if (/Page not found|Something went wrong|not found/i.test(c)) console.log('   page text:', c.slice(0, 160));
    ok(!/Page not found|Something went wrong|not found/i.test(c), `${got} page loads`);
  }
  ok(await win.Office.officeRecordHash('HT-Q-2026-9999') === null, 'unknown number opens nothing');

  // read-only: no write while collecting the data
  const writes = [];
  for (const f of ['dbAdd', 'dbPut', 'dbDelete']) { const orig = win.DB[f]; win.DB[f] = (...a) => { writes.push(f); return orig(...a); }; }
  const before = JSON.stringify(await Promise.all(['quotations', 'products', 'suppliers', 'salesOrders'].map(s => win.DB.dbGetAll(s))));
  const data = await win.Office.officeData();
  ok(writes.length === 0, 'collecting the Office data writes nothing');
  ok(JSON.stringify(await Promise.all(['quotations', 'products', 'suppliers', 'salesOrders'].map(s => win.DB.dbGetAll(s)))) === before, 'records are unchanged');
  ok(data.quotations.length === 2 && data.products.length === 1 && Array.isArray(data.settings), 'Office gets the live records');
  ok(data.settings.every(s => !('logoDataUrl' in s) && !('backupFolderHandle' in s)), 'logo and backup folder stay in the BMS');

  // the Office page only reads; it has no database code of its own
  const office = fs.readFileSync(path.join(APP, 'office', 'office.html'), 'utf8');
  ok(!/indexedDB|dbPut|dbAdd|dbDelete/.test(office), 'office.html has no database writes');

  console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll Office checks passed');
  process.exit(fails ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
