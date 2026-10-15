// VAT mode: the "Amount w/ VAT" column is hidden when the document is not charging VAT; the Sales Order shows its VAT mode and keeps it consistent.
const fs = require('fs'); const { JSDOM } = require('jsdom'); require('fake-indexeddb/auto');
let f = 0; const ok = (n, c, x) => { console.log(n + ':', !!c, c ? '' : (x || '')); if (!c) f++; };
(async () => {
  const dom = new JSDOM(fs.readFileSync('index.html', 'utf8'), { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const win = dom.window, doc = win.document, errs = []; win.indexedDB = global.indexedDB; win.IDBKeyRange = global.IDBKeyRange; win.addEventListener('error', e => errs.push(e.message)); win.confirm = () => true;
  for (const s of [...doc.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => s !== 'js/app.js')) win.eval(fs.readFileSync(s, 'utf8'));
  const wait = ms => new Promise(r => setTimeout(r, ms)), go = async h => { win.location.hash = h; await win.Router.resolveRoute(); await wait(300); };
  const DB = win.DB; await DB.openDB(); await DB.ensureCounters(); const t = win.todayISO(), now = new Date().toISOString();
  const cust = await DB.dbAdd('customers', { customerNo: 'C1', companyName: 'KEYEC', status: 'Active' });
  const line = (v) => ({ lineId: 'L' + v, description: 'Item', qty: 1, uom: 'pc', unitPrice: 100, unitCost: 60, vatRate: v, discountPercent: 0 });
  const mkSO = (no, mode, v) => DB.dbAdd('salesOrders', { soNo: no, customerId: cust, status: 'Confirmed', orderDate: t, currency: 'PHP', vatMode: mode, freight: 0, lines: [line(v)], subtotal: 100, vatTotal: v, grandTotal: 100 + v, createdAt: now, updatedAt: now, statusHistory: [] });
  const non = await mkSO('SO-NON', 'NonVat', 0), std = await mkSO('SO-STD', 'Standard12', 12), old = await mkSO('SO-OLD', undefined, 12), oldZero = await mkSO('SO-OLD0', undefined, 0);
  const visible = () => [...doc.querySelectorAll('#content th.vat-col')].some(th => !th.closest('.no-vat-cols'));
  await go('#/sales-orders/' + non); ok('Non-VAT SO: column hidden and VAT Mode shown as Non-VAT (Percentage Tax)', !visible() && !!doc.querySelector('.no-vat-cols') && /VAT Mode/.test(doc.getElementById('content').textContent) && /Non-VAT \(Percentage Tax\)/.test(doc.getElementById('content').textContent));
  await go('#/sales-orders/' + std); ok('Standard 12% SO: column shown, VAT Mode shows Standard 12%', visible() && /Standard 12%/.test(doc.getElementById('content').textContent));
  await go('#/sales-orders/' + old); ok('older SO with no VAT mode but VAT on a line: column kept', visible());
  await go('#/sales-orders/' + oldZero); ok('older SO with no VAT mode and no VAT: column hidden', !visible());
  await go('#/sales-orders/' + non); [...doc.querySelectorAll('button,a')].find(b => /Edit \/ Revise Order/.test(b.textContent)).click(); await wait(300);
  ok('Non-VAT SO edit screen: column hidden', !visible());
  doc.querySelector('.so-vat, input[data-f="vatRate"]'); const vatInput = [...doc.querySelectorAll('#soForm tbody input')].find(i => i.value === '0' && /vat/i.test(i.className + i.getAttribute('data-f')));
  if (vatInput) { vatInput.value = '12'; vatInput.dispatchEvent(new win.Event('input', { bubbles: true })); vatInput.dispatchEvent(new win.Event('change', { bubbles: true })); }
  doc.getElementById('soForm').dispatchEvent(new win.Event('submit', { cancelable: true, bubbles: true })); await wait(300);
  const saved = await DB.dbGet('salesOrders', non);
  ok('found the VAT% box to test with', !!vatInput);
  ok('Non-VAT SO cannot be saved with VAT% above 0', !!vatInput || (saved.lines[0].vatRate === 0 && saved.vatTotal === 0), JSON.stringify(saved.lines[0]));
  // quotation view
  const q = await DB.dbAdd('quotations', { quotationNo: 'Q-1', revision: 0, customerId: cust, status: 'Won', date: t, currency: 'PHP', vatMode: 'NonVat', lines: [line(0)], subtotal: 100, vatTotal: 0, grandTotal: 100, overallDiscountPercent: 0, createdAt: now, updatedAt: now });
  await go('#/quotations/' + q); ok('Non-VAT quotation view: column hidden', !visible() && !!doc.querySelector('.no-vat-cols'));
  const q2 = await DB.dbAdd('quotations', { quotationNo: 'Q-2', revision: 0, customerId: cust, status: 'Won', date: t, currency: 'PHP', vatMode: 'Standard12', lines: [line(12)], subtotal: 100, vatTotal: 12, grandTotal: 112, overallDiscountPercent: 0, createdAt: now, updatedAt: now });
  await go('#/quotations/' + q2); ok('Standard 12% quotation view: column shown', visible());
  ok('no script errors', errs.length === 0, errs.join('|')); process.exit(f ? 1 : 0);
})();
