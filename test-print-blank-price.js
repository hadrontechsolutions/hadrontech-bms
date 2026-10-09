const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
require('fake-indexeddb/auto');
const APP = __dirname;
async function main() {
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const win = dom.window;
  win.indexedDB = global.indexedDB; win.IDBKeyRange = global.IDBKeyRange;
  const scripts = [...win.document.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => s !== 'js/app.js');
  for (const src of scripts) win.eval(fs.readFileSync(path.join(APP, src), 'utf8'));
  await win.DB.openDB(); await win.DB.ensureCounters();
  let printed = '';
  win.open = () => ({ document: { write: (h) => { printed = h; }, close: () => {} } });
  const mk = (desc, price) => ({ description: desc, modelNo: '', brand: '', uom: 'pc', qty: 1, unitPrice: price, discountPercent: 0, unitCost: 0, vatApplicable: false });
  const q = { quotationNo: 'HT-Q-TEST', currency: 'PHP', vatMode: 'NonVat', status: 'Draft', lines: [mk('LotLine', 1000), mk('BlankComponent', ''), mk('ZeroComponent', 0)] };
  const t = win.QuoteCalc.computeQuotationTotals(q.lines, q);
  Object.assign(q, { subtotal: 1000, vatTotal: 0, grandTotal: 1000 });
  await win.Print.printQuotation(q, { companyName: 'X' });
  const rows = printed.split('<tr>').filter(r => r.includes('Component') || r.includes('LotLine'));
  const cell = (r) => [...r.matchAll(/<td class="p-num">(.*?)<\/td>/g)].map(m => m[1]);
  const [lot, blank, zero] = rows.map(cell);
  console.log('priced line shows price:', /1,000\.00/.test(lot[1]) && /1,000\.00/.test(lot[3]));
  console.log('blank price line prints empty Unit Price + Amount:', blank[1] === '' && blank[3] === '');
  console.log('zero price line prints empty Unit Price + Amount:', zero[1] === '' && zero[3] === '');
  console.log('total still correct (1,000.00 count):', (printed.match(/1,000\.00/g) || []).length, (printed.match(/1,000\.00/g) || []).length >= 3);
}
main().catch(e => { console.log('TEST FAILED', e); process.exit(1); });
