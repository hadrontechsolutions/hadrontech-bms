/* Crawls the whole app from every list page, following every internal link, and fails on any link that lands on
   "Page not found", an error page, or a "record not found" -- including after related records are deleted. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
require('fake-indexeddb/auto');
const APP = __dirname;
async function main() {
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const win = dom.window; const doc = win.document;
  win.indexedDB = global.indexedDB; win.IDBKeyRange = global.IDBKeyRange; win.confirm = () => true;
  for (const src of [...doc.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => s !== 'js/app.js')) win.eval(fs.readFileSync(path.join(APP, src), 'utf8'));
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const fire = (el, v, ev = 'input') => { if (v !== undefined) el.value = v; el.dispatchEvent(new win.Event(ev)); };
  const go = async (h, ms = 60) => { win.location.hash = h; await win.Router.resolveRoute(); await wait(ms); };
  await win.DB.openDB(); await win.DB.ensureCounters();
  const now = new Date().toISOString();
  const custId = await win.DB.dbAdd('customers', { customerNo: 'C1', companyName: 'KEYEC', status: 'Active', createdAt: now });
  const supId = await win.DB.dbAdd('suppliers', { supplierNo: 'S1', companyName: 'DataBltiz', currency: 'PHP', status: 'Active', createdAt: now });
  const prodId = await win.DB.dbAdd('products', { itemNo: 'ITEM-00049', type: 'Product', description: 'HDMI cable', status: 'Active', createdAt: now, defaultSupplierId: supId, supplierListingUrl: 'https://shop.example.com/hdmi' });
  await win.DB.dbAdd('enquiries', { enquiryNo: 'HT-ENQ-2026-0001', customerId: custId, subject: 'Legacy', stage: 'New Enquiry', createdAt: now, updatedAt: now });
  await win.DB.dbAdd('technicalOffers', { offerNo: 'HT-TO-2026-0001', customerId: custId, endUser: 'Onsemi', date: win.todayISO(), status: 'Approved', items: [], specs: [], sections: [], createdAt: now });
  await win.DB.dbAdd('expenses', { expenseNo: 'HT-EXP-1', date: '2026-09-01', category: 'Rent', description: 'Rent', amount: 100, status: 'Recorded', createdAt: now, updatedAt: now });
  await win.DB.dbAdd('notes', { title: 'Call', body: 'x', dueDate: win.todayISO(), createdAt: now, updatedAt: now });

  // real chain: quotation -> customer PO -> sales order -> supplier PO -> proforma
  await go('#/quotations/new');
  let row = doc.querySelector('#linesBody tr');
  fire(row.querySelector('.ln-desc'), 'HDMI cable'); fire(row.querySelector('.ln-qty'), '2'); fire(row.querySelector('.ln-cost'), '849'); fire(row.querySelector('.ln-markup'), '35'); fire(row.querySelector('.ln-freight'), '100');
  fire(row.querySelector('.ln-supplier'), String(supId), 'change'); await wait(30);
  fire(doc.getElementById('f_customerId'), String(custId), 'change');
  doc.getElementById('qForm').dispatchEvent(new win.Event('submit', { cancelable: true })); await wait(150);
  const q = (await win.DB.dbGetAll('quotations'))[0];
  q.status = 'Won'; await win.DB.dbPut('quotations', q);
  await go('#/customer-pos/new?quotationId=' + q.id);
  fire(doc.getElementById('f_customerId'), String(custId), 'change');
  doc.getElementById('cpoForm').dispatchEvent(new win.Event('submit', { cancelable: true })); await wait(150);
  const cpo = (await win.DB.dbGetAll('customerPOs'))[0];
  await go('#/customer-pos/' + cpo.id);
  doc.getElementById('btnConvert').click(); await wait(150);
  const so = (await win.DB.dbGetAll('salesOrders'))[0];
  await win.SupplierPOs.createFromSalesOrder(so, supId, so.lines.map(l => Object.assign({}, l, { supplierId: supId }))); await wait(100);
  await win.ProformaInvoices.getOrCreateProformaInvoice(so); await wait(150);

  const BAD = /page not found|something went wrong|record not found|not found/i;
  const isBad = () => { const c = doc.getElementById('content'); return BAD.test(c.querySelector('.empty-state')?.textContent || c.textContent.slice(0, 80)) || /^\s*$/.test(c.textContent); };
  const probe = [];
  for (const h of ['#/quotations/99999', '#/sales-orders/99999', '#/supplier-pos/99999', '#/customers/99999', '#/nope']) { await go(h, 40); probe.push(isBad()); }
  console.log('0 the detector itself flags missing records and unknown pages:', probe.every(Boolean), probe);
  async function crawl(label) {
    const seen = new Set(); const queue = [];
    const nav = [...doc.querySelectorAll('.app-sidebar a[href^="#/"]')].map(a => a.getAttribute('href'));
    nav.forEach(h => queue.push({ h, from: 'sidebar' }));
    const bad = []; let visited = 0; const external = [];
    while (queue.length && visited < 400) {
      const { h, from } = queue.shift();
      if (seen.has(h)) continue; seen.add(h); visited++;
      await go(h, 45);
      if (isBad()) bad.push(`${h}  (linked from ${from})`);
      doc.querySelectorAll('#content a[href], #breadcrumb a[href]').forEach(a => {
        const href = a.getAttribute('href');
        if (/^#\//.test(href)) { if (!seen.has(href)) queue.push({ h: href, from: h }); }
        else if (/^https?:/i.test(href)) { if (a.target !== '_blank' || !/noopener/.test(a.rel || '')) external.push(`${h} -> ${href}`); }
        else if (href && href !== '#' ) bad.push(`${h} has an unusable href "${href}"`);
      });
    }
    console.log(`${label}: crawled ${visited} pages; dead internal links:`, bad.length === 0, bad.slice(0, 12));
    console.log(`${label}: every external link opens in a new tab with noopener:`, external.length === 0, external.slice(0, 5));
    return { bad, visited };
  }
  const first = await crawl('1 full data');
  console.log('2 crawl really covered the chain (>= 25 pages):', first.visited >= 25, first.visited);

  // delete related records, then every remaining page must still have no dead links
  await win.DB.dbDelete('quotations', q.id);
  await win.DB.dbDelete('customerPOs', cpo.id);
  await win.DB.dbDelete('suppliers', supId);
  await win.DB.dbDelete('products', prodId);
  // every path the code can navigate to (buttons, redirects after save, hrefs) must match a real route
  const targets = new Set();
  for (const f of fs.readdirSync(path.join(APP, 'js'))) {
    const code = fs.readFileSync(path.join(APP, 'js', f), 'utf8');
    if (f === 'enquiries.js') continue;   // dormant module, not loaded in index.html (see its header)
    for (const m of code.matchAll(/(?:navigate\(\s*|location\.hash\s*=\s*)(['"`])(#?\/[^'"`]*)\1/g)) targets.add(m[2].replace(/^#/, ''));
    for (const m of code.matchAll(/href="#(\/[^"]*)"/g)) targets.add(m[1]);
  }
  const unmatched = [];
  for (const t of targets) {
    if (t.startsWith('/${cfg.key}')) continue;   // generic entity pages are crawled through their real routes above
    const p2 = t.replace(/\$\{[^}]*\}/g, '1').split('?')[0];
    win.location.hash = '#' + p2; await win.Router.resolveRoute(); await wait(15);
    if (/Page not found/.test(doc.getElementById('content').textContent)) unmatched.push(t);
  }
  console.log('2b every navigate()/href target in the code matches a real page (' + targets.size + ' checked):', unmatched.length === 0, unmatched);
  // opening an edit/detail page for a record that no longer exists must say so plainly, never "Something went wrong"
  const crashes = [];
  for (const base of ['quotations', 'customer-pos', 'sales-orders', 'supplier-pos', 'proforma-invoices', 'technical-offers', 'notes', 'distributions', 'customers', 'suppliers', 'products', 'expenses', 'partners']) {
    for (const suffix of ['', '/edit']) {
      win.location.hash = `#/${base}/99999${suffix}`; await win.Router.resolveRoute(); await wait(25);
      const t = doc.getElementById('content').textContent;
      if (/Something went wrong|TypeError|undefined|null/.test(t)) crashes.push(`/${base}/99999${suffix}`);
    }
  }
  console.log('2c missing-record pages (detail + edit) fail gracefully:', crashes.length === 0, crashes);
  await crawl('3 after deleting quotation, customer PO, supplier and product');
  await win.DB.dbDelete('customers', custId);
  await crawl('4 after also deleting the customer');
}
main().catch(e => { console.log('TEST FAILED', e); process.exit(1); });
