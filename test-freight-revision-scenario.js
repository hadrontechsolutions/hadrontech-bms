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
  const near = (a, b) => Math.abs(a - b) < 0.005;
  await win.DB.openDB(); await win.DB.ensureCounters();
  const custId = await win.DB.dbAdd('customers', { customerNo: 'C1', companyName: 'KEYEC', status: 'Active', createdAt: new Date().toISOString() });
  const go = async (h, ms = 100) => { win.location.hash = h; await win.Router.resolveRoute(); await wait(ms); };

  // ---- 10 pumps ----
  await go('#/quotations/new');
  let row = doc.querySelector('#linesBody tr');
  fire(row.querySelector('.ln-desc'), 'Pump');
  fire(row.querySelector('.ln-qty'), '10');
  fire(row.querySelector('.ln-costccy'), 'USD', 'change'); await wait(30);
  row = doc.querySelector('#linesBody tr');
  fire(row.querySelector('.ln-rate'), '64'); fire(row.querySelector('.ln-cost'), '100');
  fire(row.querySelector('.ln-markup'), '25'); fire(row.querySelector('.ln-freight'), '80'); await wait(30);
  row = doc.querySelector('#linesBody tr');
  console.log('1 margin shown is 20.0% (25% markup):', /Margin 20\.0%/.test(row.querySelector('.ln-margin').textContent), row.querySelector('.ln-margin').textContent);
  fire(doc.getElementById('f_customerId'), String(custId), 'change');
  doc.getElementById('qForm').dispatchEvent(new win.Event('submit', { cancelable: true })); await wait(150);
  let all = await win.DB.dbGetAll('quotations');
  const orig = all[0];
  console.log('2 original saved: grand total 86,400, cost 69,120:', near(orig.grandTotal, 86400) && near(win.QuoteCalc.computeQuotationTotals(orig).costTotal, 69120), orig.grandTotal);
  orig.status = 'Sent'; await win.DB.dbPut('quotations', orig);

  // ---- revise to 4 ----
  await go('#/quotations/' + orig.id);
  doc.getElementById('btnRevise').click(); await wait(200);
  all = await win.DB.dbGetAll('quotations');
  const rev = all.find(q => q.revision === 1);
  console.log('3 revision created, original no longer latest:', !!rev && rev.isLatest && !all.find(q => q.id === orig.id).isLatest);
  await go('#/quotations/' + rev.id + '/edit');
  row = doc.querySelector('#linesBody tr');
  console.log('4 revision opens with 10 pumps / total freight 80 / price 8640:', +row.querySelector('.ln-qty').value === 10 && +row.querySelector('.ln-freight').value === 80 && near(+row.querySelector('.ln-price').value, 8640));
  fire(row.querySelector('.ln-qty'), '4'); await wait(30);
  row = doc.querySelector('#linesBody tr');
  console.log('5 price 9,600, freight still 80:', near(+row.querySelector('.ln-price').value, 9600) && +row.querySelector('.ln-freight').value === 80);
  console.log('6 reminder shown:', /reconfirm supplier pricing and total freight/.test(row.querySelector('.ln-freight-info').innerHTML));
  console.log('7 margin still 20.0%:', /Margin 20\.0%/.test(row.querySelector('.ln-margin').textContent));
  doc.getElementById('qForm').dispatchEvent(new win.Event('submit', { cancelable: true })); await wait(150);
  all = await win.DB.dbGetAll('quotations');
  const rev2 = all.find(q => q.id === rev.id), orig2 = all.find(q => q.id === orig.id);
  const rt = win.QuoteCalc.computeQuotationTotals(rev2);
  console.log('8 revision saved: total 38,400, cost 30,720, GP 7,680:', near(rev2.grandTotal, 38400) && near(rt.costTotal, 30720) && near(rt.grossProfit, 7680), rev2.grandTotal, rt.costTotal, rt.grossProfit);
  console.log('9 original untouched: Sent, 10 pumps, 86,400, freight 80, price 8640:', orig2.status === 'Sent' && orig2.lines[0].qty === 10 && near(orig2.grandTotal, 86400) && orig2.lines[0].estimatedFreightCost === 80 && near(orig2.lines[0].unitPrice, 8640));

  // ---- print both ----
  let printed = '';
  win.open = () => ({ document: { write: (h) => { printed = h; }, close: () => {} } });
  await win.Print.printQuotation(orig2, { companyName: 'KEYEC' });
  const p1 = printed;
  await win.Print.printQuotation(rev2, { companyName: 'KEYEC' });
  console.log('10 prints: original 86,400 / revision 38,400, no internal freight/cost on print:', p1.includes('86,400.00') && printed.includes('38,400.00') && !/Landed|Total Freight|Margin/.test(p1 + printed));

  // ---- manual price survives a revision qty change ----
  await go('#/quotations/' + rev.id);
  const q3 = (await win.DB.dbGet('quotations', rev.id));
  q3.status = 'Sent'; await win.DB.dbPut('quotations', q3);
  await go('#/quotations/' + rev.id);
  doc.getElementById('btnRevise').click(); await wait(200);
  const rev3 = (await win.DB.dbGetAll('quotations')).find(q => q.revision === 2);
  await go('#/quotations/' + rev3.id + '/edit');
  row = doc.querySelector('#linesBody tr');
  fire(row.querySelector('.ln-price'), '9000'); await wait(20);
  fire(doc.querySelector('#linesBody tr .ln-qty'), '5'); await wait(30);
  row = doc.querySelector('#linesBody tr');
  console.log('11 manual price kept in revision after qty change + flagged:', +row.querySelector('.ln-price').value === 9000 && /Manual price/.test(row.querySelector('.ln-price-info').textContent));
  doc.getElementById('qForm').dispatchEvent(new win.Event('submit', { cancelable: true })); await wait(150);
  const saved3 = await win.DB.dbGet('quotations', rev3.id);
  console.log('12 manual price + override flag saved; reopening still flags it:', saved3.lines[0].unitPrice === 9000 && saved3.lines[0].priceOverridden === true);
  await go('#/quotations/' + rev3.id + '/edit');
  row = doc.querySelector('#linesBody tr');
  console.log('13 reopened still shows the review flag:', /Manual price/.test(row.querySelector('.ln-price-info').textContent));
}
main().catch(e => { console.log('TEST FAILED', e); process.exit(1); });
