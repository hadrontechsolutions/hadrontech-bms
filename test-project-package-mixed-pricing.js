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
  const go = async (h, ms = 100) => { win.location.hash = h; await win.Router.resolveRoute(); await wait(ms); };
  await win.DB.openDB(); await win.DB.ensureCounters();

  // ---- build the package through the real form so the Price-shown-as choice is saved ----
  await go('#/products/new', 80);
  fire(doc.getElementById('f_type'), 'Project Package', 'change'); await wait(20);
  fire(doc.getElementById('f_description'), 'Air compressor project');
  const comps = [
    { description: 'Compressor 10HP', qty: 3, unitCost: 1000, estimatedFreightCost: 60, freightCoversQty: 3, markupPercent: 20, pricing: 'own' },
    { description: 'Prefilter', qty: 2, unitCost: 100, estimatedFreightCost: 0, freightCoversQty: 1, markupPercent: 25, pricing: 'own' },
    { description: 'GI pipe', qty: 60, unitCost: 10, estimatedFreightCost: 0, freightCoversQty: 1, markupPercent: 30, pricing: 'lot' },
    { description: 'Ball valve', qty: 56, unitCost: 5, estimatedFreightCost: 0, freightCoversQty: 1, markupPercent: 30, pricing: 'lot' },
    { description: 'Design and PME', qty: 1, unitCost: 700, estimatedFreightCost: 0, freightCoversQty: 1, markupPercent: 40, pricing: 'own' }
  ];
  comps.forEach((c, i) => {
    if (i > 0) doc.getElementById('pkgAddComp').click();
    const row = doc.querySelectorAll('#pkgEditor tbody tr')[i];
    for (const [k, v] of Object.entries({ ...c, costCurrency: 'USD' })) { const el = row.querySelector(`[data-k="${k}"]`); fire(el, String(v), el.tagName === 'SELECT' ? 'change' : 'input'); }
  });
  console.log('1 component editor has a "Price shown as" choice defaulting to In lot price:', (() => { doc.getElementById('pkgAddComp').click(); const last = [...doc.querySelectorAll('#pkgEditor tbody tr')].pop(); const v = last.querySelector('[data-k="pricing"]').value; last.querySelector('[data-del]').click(); return v === 'lot'; })());
  doc.getElementById('entityForm').dispatchEvent(new win.Event('submit', { cancelable: true })); await wait(150);
  const pkg = (await win.DB.dbGetAll('products')).find(p => p.type === 'Project Package');
  console.log('2 choice saved per component:', JSON.stringify(pkg.components.map(c => c.pricing)) === '["own","own","lot","lot","own"]', JSON.stringify(pkg.components.map(c => c.pricing)));

  // ---- quotation ----
  const custId = await win.DB.dbAdd('customers', { customerNo: 'C1', companyName: 'SHORR', status: 'Active', createdAt: new Date().toISOString() });
  await go('#/quotations/new');
  doc.querySelector('.ln-catalog-btn').click(); await wait(20);
  [...doc.querySelectorAll('.item-picker-row')].find(r => /ITEM-P-0001/.test(r.textContent)).click(); await wait(60);
  let trs = [...doc.querySelectorAll('#linesBody tr')];
  const label = (t) => t.querySelector('.ln-catalog-btn').textContent.trim();
  console.log('3 order: own, own, LOT LINE, lot, lot, own (lot line sits just before its first item):', trs.map(label).join('|') === 'ITEM-P-0001-01|ITEM-P-0001-02|ITEM-P-0001|ITEM-P-0001-03|ITEM-P-0001-04|ITEM-P-0001-05', trs.map(label).join('|'));
  const rate = +trs[0].querySelector('.ln-rate').value;
  const price = (i) => +doc.querySelectorAll('#linesBody tr')[i].querySelector('.ln-price').value;
  const r2 = (x) => Math.round(x * 100) / 100;
  // own lines: (cost + freight/unit) x rate x (1+markup)
  console.log('4 own-priced lines get their own price (compressor (1000+20)*rate*1.20):', near(price(0), r2(1020 * rate * 1.2)) && near(price(1), r2(100 * rate * 1.25)) && near(price(5), r2(700 * rate * 1.4)), price(0), price(1), price(5));
  const lotExp = r2((60 * 10 * rate * 1.3) + (56 * 5 * rate * 1.3));
  console.log('5 lot line = ONLY the In-lot items (pipe + valves) at their markups:', near(price(2), lotExp), price(2), lotExp);
  console.log('6 In-lot items print blank (price 0); own-priced do not:', price(3) === 0 && price(4) === 0 && price(0) > 0);

  // editing an OWN line's markup must not touch the lot line; editing a LOT item must not touch own lines
  const lotBefore = price(2);
  fire(doc.querySelectorAll('#linesBody tr')[1].querySelector('.ln-markup'), '50'); await wait(30);
  console.log('7 changing an own-priced line markup updates only that line (lot line unchanged):', near(price(1), r2(100 * rate * 1.5)) && price(2) === lotBefore);
  const own0 = price(0);
  fire(doc.querySelectorAll('#linesBody tr')[3].querySelector('.ln-markup'), '60'); await wait(30);
  console.log('8 changing an In-lot item markup updates only the lot line:', near(price(2), r2((60 * 10 * rate * 1.6) + (56 * 5 * rate * 1.3))) && price(0) === own0);

  // totals and GP

  fire(doc.getElementById('f_customerId'), String(custId), 'change');
  doc.getElementById('qForm').dispatchEvent(new win.Event('submit', { cancelable: true })); await wait(180);
  const q = (await win.DB.dbGetAll('quotations'))[0];
  const qt = win.QuoteCalc.computeQuotationTotals(q);
  const priced = q.lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0);
  console.log('9 quotation total = own-priced lines + lot line (breakdown lines add nothing):', near(q.grandTotal, r2(priced)), q.grandTotal);
  const allCost = q.lines.reduce((s, l) => s + win.QuoteCalc.computeLine(l, 'PHP').costTotal, 0);
  console.log('10 gross profit = total minus the cost of EVERY line (own, lot header, lot items):', near(qt.grossProfit, r2(q.grandTotal - allCost)) && allCost > 0, qt.grossProfit);

  // print
  let printed = '';
  win.open = () => ({ document: { write: (h) => { printed = h; }, close: () => {} } });
  await win.Print.printQuotation(q, { companyName: 'SHORR' });
  const rows = printed.split('<tr>').filter(r => /Compressor 10HP|Prefilter|Air compressor project|GI pipe|Ball valve|Design and PME/.test(r));
  const cells = (r) => [...r.matchAll(/<td class="p-num">(.*?)<\/td>/g)].map(m => m[1]);
  const priceCells = rows.map(r => cells(r)[1]);
  console.log('11 print: own lines + lot line show a price, the 2 breakdown items are blank:', priceCells.length === 6 && priceCells.filter(x => x === '').length === 2 && /GI pipe|Ball valve/.test(rows[3] + rows[4]) && cells(rows[3])[1] === '' && cells(rows[4])[1] === '', JSON.stringify(priceCells));

  // all-lot package: lot line first (original behaviour); all-own package: no lot line
  const pAll = await win.DB.dbAdd('products', { itemNo: 'ITEM-P-0009', type: 'Project Package', description: 'All own', status: 'Active', createdAt: new Date().toISOString(), nextCompSeq: 2, components: [{ compNo: 'ITEM-P-0009-01', description: 'Solo', qty: 1, uom: 'pc', unitCost: 10, costCurrency: 'USD', estimatedFreightCost: 0, freightCoversQty: 1, markupPercent: 10, pricing: 'own' }] });
  await go('#/quotations/new');
  doc.querySelector('.ln-catalog-btn').click(); await wait(20);
  [...doc.querySelectorAll('.item-picker-row')].find(r => /ITEM-P-0009/.test(r.textContent)).click(); await wait(60);
  trs = [...doc.querySelectorAll('#linesBody tr')];
  console.log('12 package with no In-lot items loads with no lot line (1 line, with its own price):', trs.length === 1 && !doc.querySelector('#linesBody .ln-use-lot') && +trs[0].querySelector('.ln-price').value > 0);

  // old packages saved before this choice existed behave as before (all in lot)
  const pOld = await win.DB.dbAdd('products', { itemNo: 'ITEM-P-0010', type: 'Project Package', description: 'Old style', status: 'Active', createdAt: new Date().toISOString(), nextCompSeq: 3, components: [
    { compNo: 'ITEM-P-0010-01', description: 'a', qty: 1, uom: 'pc', unitCost: 10, costCurrency: 'USD', estimatedFreightCost: 0, freightCoversQty: 1, markupPercent: 0 },
    { compNo: 'ITEM-P-0010-02', description: 'b', qty: 1, uom: 'pc', unitCost: 10, costCurrency: 'USD', estimatedFreightCost: 0, freightCoversQty: 1, markupPercent: 0 }] });
  await go('#/quotations/new');
  doc.querySelector('.ln-catalog-btn').click(); await wait(20);
  [...doc.querySelectorAll('.item-picker-row')].find(r => /ITEM-P-0010/.test(r.textContent)).click(); await wait(60);
  trs = [...doc.querySelectorAll('#linesBody tr')];
  console.log('13 package saved before this feature: lot line first + 2 blank items (unchanged behaviour):', trs.length === 3 && label(trs[0]) === 'ITEM-P-0010' && +trs[1].querySelector('.ln-price').value === 0 && +trs[2].querySelector('.ln-price').value === 0);

  // detail page shows the choice
  await go('#/products/' + pkg.id, 100);
  console.log('14 package page shows each item as Own price / In lot price:', /Own price/.test(doc.getElementById('content').textContent) && /In lot price/.test(doc.getElementById('content').textContent));
}
main().catch(e => { console.log('TEST FAILED', e); process.exit(1); });
