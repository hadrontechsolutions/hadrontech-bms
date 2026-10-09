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

  const now = new Date().toISOString();
  const supId = await win.DB.dbAdd('suppliers', { supplierNo: 'S1', companyName: 'Allied Contractor', currency: 'USD', status: 'Active', createdAt: now });
  const custId = await win.DB.dbAdd('customers', { customerNo: 'C1', companyName: 'SHORR', status: 'Active', createdAt: now });

  // ---- the package form ----
  await go('#/products/new', 80);
  fire(doc.getElementById('f_type'), 'Project Package', 'change'); await wait(20);
  const shown = (n) => doc.getElementById('f_' + n).closest('.field').style.display !== 'none';
  console.log('1 package form hides Category, Manufacturer, Brand, Model, UOM; shows Supplier, Lead Time, Warranty:', ['category', 'manufacturer', 'brand', 'modelNo', 'uom'].every(n => !shown(n)) && ['defaultSupplierId', 'leadTime', 'warranty', 'description'].every(shown));
  console.log('2 no "Price shown as" choice in the component editor:', !doc.querySelector('#pkgEditor [data-k="pricing"]') && !/Price shown as/i.test(doc.getElementById('pkgEditor').textContent));
  fire(doc.getElementById('f_description'), 'Air compressor project');
  fire(doc.getElementById('f_leadTime'), '3 Weeks'); fire(doc.getElementById('f_warranty'), '2 Years');
  const comps = [
    { description: 'Compressor 10HP', qty: 3, unitCost: 1000, estimatedFreightCost: 60, freightCoversQty: 3, markupPercent: 20 },
    { description: 'Prefilter', qty: 2, unitCost: 100, estimatedFreightCost: 0, freightCoversQty: 1, markupPercent: 25 },
    { description: 'GI pipe', qty: 60, unitCost: 10, estimatedFreightCost: 0, freightCoversQty: 1, markupPercent: 30 },
    { description: 'Ball valve', qty: 56, unitCost: 5, estimatedFreightCost: 0, freightCoversQty: 1, markupPercent: 30 },
    { description: 'Design and PME', qty: 1, unitCost: 700, estimatedFreightCost: 0, freightCoversQty: 1, markupPercent: 40 }
  ];
  comps.forEach((c, i) => {
    if (i > 0) doc.getElementById('pkgAddComp').click();
    const row = doc.querySelectorAll('#pkgEditor tbody tr')[i];
    for (const [k, v] of Object.entries({ ...c, costCurrency: 'USD' })) { const el = row.querySelector(`[data-k="${k}"]`); fire(el, String(v), el.tagName === 'SELECT' ? 'change' : 'input'); }
  });
  doc.getElementById('entityForm').dispatchEvent(new win.Event('submit', { cancelable: true })); await wait(150);
  console.log('3 a package without a supplier is refused:', (await win.DB.dbGetAll('products')).filter(p => p.type === 'Project Package').length === 0);
  fire(doc.getElementById('f_defaultSupplierId'), String(supId), 'change');
  doc.getElementById('entityForm').dispatchEvent(new win.Event('submit', { cancelable: true })); await wait(150);
  const pkg = (await win.DB.dbGetAll('products')).find(p => p.type === 'Project Package');
  console.log('4 saved package: supplier kept, UOM "lot", brand/model/category empty:', JSON.stringify(pkg && { s: pkg.defaultSupplierId, u: pkg.uom, b: pkg.brand, m: pkg.modelNo, c: pkg.category, mf: pkg.manufacturer }), !!pkg && Number(pkg.defaultSupplierId) === supId && pkg.uom === 'lot' && !pkg.brand && !pkg.modelNo && !pkg.category && !pkg.manufacturer);

  // ---- quotation: everything starts in the lot ----
  await go('#/quotations/new');
  doc.querySelector('.ln-catalog-btn').click(); await wait(20);
  [...doc.querySelectorAll('.item-picker-row')].find(r => /ITEM-P-0001/.test(r.textContent)).click(); await wait(60);
  let trs = [...doc.querySelectorAll('#linesBody tr')];
  const label = (t) => t.querySelector('.ln-catalog-btn').textContent.trim();
  const rate = +trs[1].querySelector('.ln-rate').value;   // (the lot line itself has rate 1)
  const price = (i) => +doc.querySelectorAll('#linesBody tr')[i].querySelector('.ln-price').value;
  const r2 = (x) => Math.round(x * 100) / 100;
  console.log('5 loads lot line + 5 items, all in the lot (blank price), lot price = their sum:', trs.length === 6 && label(trs[0]) === 'ITEM-P-0001' && [1, 2, 3, 4, 5].every(i => price(i) === 0) && price(0) > 0, trs.map(label).join('|'));
  const all = [...win.__lines || []];
  const linesNow = () => [...doc.querySelectorAll('#linesBody tr')];
  console.log('6 every item line carries the package supplier; the lot line has none:', linesNow().slice(1).every(t => t.querySelector('.ln-supplier').value === String(supId)) && linesNow()[0].querySelector('.ln-supplier').value === '');
  console.log('7 lead time "3 Weeks" on the lines; warranty "2 Years" and delivery lead time filled on the quotation:', linesNow().every(t => /3 Weeks/.test(t.textContent)) && doc.getElementById('f_warranty').value === '2 Years' && doc.getElementById('f_deliveryLeadTime').value === '3 Weeks');

  // ---- typing a price takes an item out of the lot ----
  const setPrice = async (i, v) => { const el = doc.querySelectorAll('#linesBody tr')[i].querySelector('.ln-price'); fire(el, String(v)); el.dispatchEvent(new win.Event('change')); await wait(40); };
  const lotAll = r2(1020 * rate * 1.2 * 3 * 0 + 0);
  const lotBefore = price(0);
  const sumAt = (rows) => rows.reduce((s, [cost, markup, qty]) => s + cost * rate * (1 + markup / 100) * qty, 0);
  console.log('8 lot price at the start = all five items at their markups:', near(price(0), r2(sumAt([[1020, 20, 3], [100, 25, 2], [10, 30, 60], [5, 30, 56], [700, 40, 1]]))), price(0));
  await setPrice(1, 5000); await setPrice(2, 800); await setPrice(5, 9000);
  trs = linesNow();
  console.log('9 after pricing items 1, 2 and 5: order is own, own, LOT LINE, lot, lot, own:', trs.map(label).join('|') === 'ITEM-P-0001-01|ITEM-P-0001-02|ITEM-P-0001|ITEM-P-0001-03|ITEM-P-0001-04|ITEM-P-0001-05', trs.map(label).join('|'));
  const lotExp = r2(sumAt([[10, 30, 60], [5, 30, 56]]));
  console.log('10 lot line now = ONLY pipe + valves (the two items still without a price):', near(price(2), lotExp), price(2), lotExp);
  console.log('11 typed prices kept; in-lot items still print blank:', price(0) === 5000 && price(1) === 800 && price(5) === 9000 && price(3) === 0 && price(4) === 0);
  const pop = linesNow()[3].querySelector('.ln-flag-btn'); pop.click(); await wait(10);
  const ownBtn = doc.querySelector('.ln-info-popup .ln-own-price');
  console.log('12 an in-lot item has a "!" popup with "Price it separately":', pop.style.display !== 'none' && !!ownBtn && !pop.classList.contains('needs-attention'));
  ownBtn.click(); await wait(40);
  trs = linesNow();
  const pipeExp = r2(10 * rate * 1.3);
  console.log('13 "Price it separately" gives the pipe its calculated price and leaves the lot:', near(price(2), pipeExp) && near(price(3), r2(sumAt([[5, 30, 56]]))) && trs.map(label).join('|') === 'ITEM-P-0001-01|ITEM-P-0001-02|ITEM-P-0001-03|ITEM-P-0001|ITEM-P-0001-04|ITEM-P-0001-05', trs.map(label).join('|'));
  await setPrice(2, 0);
  trs = linesNow();
  console.log('14 clearing a price puts the item back in the lot (lot line moves above it):', trs.map(label).join('|') === 'ITEM-P-0001-01|ITEM-P-0001-02|ITEM-P-0001|ITEM-P-0001-03|ITEM-P-0001-04|ITEM-P-0001-05' && price(3) === 0);

  // ---- totals, GP, print, supplier PO grouping ----
  doc.getElementById('f_customerId').value = String(custId); doc.getElementById('f_customerId').dispatchEvent(new win.Event('change'));
  doc.getElementById('qForm').dispatchEvent(new win.Event('submit', { cancelable: true })); await wait(180);
  const q = (await win.DB.dbGetAll('quotations'))[0];
  const qt = win.QuoteCalc.computeQuotationTotals(q);
  const priced = q.lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0);
  console.log('15 quotation total = priced items + lot line; gross profit subtracts every item cost:', near(q.grandTotal, r2(priced)) && near(qt.grossProfit, r2(q.grandTotal - q.lines.reduce((s, l) => s + win.QuoteCalc.computeLine(l, 'PHP').costTotal, 0))), q.grandTotal, qt.grossProfit);
  let printed = '';
  win.open = () => ({ document: { write: (h) => { printed = h; }, close: () => {} } });
  await win.Print.printQuotation(q, { companyName: 'SHORR' });
  const rows = printed.split('<tr>').filter(r => /Compressor 10HP|Prefilter|Air compressor project|GI pipe|Ball valve|Design and PME/.test(r));
  const cells = (r) => [...r.matchAll(/<td class="p-num">(.*?)<\/td>/g)].map(m => m[1]);
  const priceCells = rows.map(r => cells(r)[1]);
  console.log('16 print: priced items + lot line show a price; the two in-lot items are blank:', priceCells.length === 6 && priceCells.filter(x => x === '').length === 2 && priceCells[3] === '' && priceCells[4] === '', JSON.stringify(priceCells));
  const forPO = q.lines.filter(l => l.supplierId === supId);
  console.log('17 for the Supplier PO: all 5 items go to the package supplier; the lot line is not included:', forPO.length === 5 && !forPO.some(l => l.lotRole === 'header'));

  // ---- the whole chain: Won -> Customer PO -> Sales Order -> Supplier PO for the package supplier ----
  q.status = 'Won'; await win.DB.dbPut('quotations', q);
  await go('#/customer-pos/new?quotationId=' + q.id);
  fire(doc.getElementById('f_customerId'), String(custId), 'change');
  doc.getElementById('cpoForm').dispatchEvent(new win.Event('submit', { cancelable: true })); await wait(150);
  const cpo = (await win.DB.dbGetAll('customerPOs'))[0];
  await go('#/customer-pos/' + cpo.id);
  doc.getElementById('btnConvert').click(); await wait(150);
  const so = (await win.DB.dbGetAll('salesOrders'))[0];
  await go('#/sales-orders/' + so.id, 150);
  const createBtn = doc.querySelector('[data-create-spo]');
  console.log('17b Sales Order offers "Create Supplier PO" for the package supplier (one group, 5 items):', !!createBtn && Number(createBtn.dataset.createSpo) === supId && /5 item/.test(createBtn.closest('.supplier-group').textContent));
  createBtn.click(); await wait(200);
  const spo = (await win.DB.dbGetAll('supplierPOs'))[0];
  console.log('17c Supplier PO has the 5 items (no lot line), freight pre-filled with the compressor freight USD 60, total = items + freight:', !!spo && spo.lines.length === 5 && !spo.lines.some(l => /^Air compressor project$/.test(l.description)) && near(spo.freight, 60) && near(spo.totalCost, spo.lines.reduce((t, l) => t + l.amount, 0) + 60), spo && spo.freight);

  // ---- saved quotation reopens the same ----
  await go('#/quotations/' + q.id + '/edit', 150);
  trs = linesNow();
  console.log('18 reopened quotation keeps the same lines, prices and order:', trs.map(label).join('|') === 'ITEM-P-0001-01|ITEM-P-0001-02|ITEM-P-0001|ITEM-P-0001-03|ITEM-P-0001-04|ITEM-P-0001-05' && price(0) === 5000 && price(3) === 0);

  // ---- pricing every item removes the lot line; legacy packages ----
  await go('#/quotations/new');
  doc.querySelector('.ln-catalog-btn').click(); await wait(20);
  [...doc.querySelectorAll('.item-picker-row')].find(r => /ITEM-P-0001/.test(r.textContent)).click(); await wait(60);
  for (let i = 1; i <= 5; i++) await setPrice(i, 1000 * i);
  console.log('19 once every item has its own price the lot line goes away:', linesNow().length === 5 && !linesNow().some(t => label(t) === 'ITEM-P-0001'));
  const pOwn = await win.DB.dbAdd('products', { itemNo: 'ITEM-P-0011', type: 'Project Package', description: 'Old with own', status: 'Active', createdAt: now, defaultSupplierId: supId, nextCompSeq: 3, components: [
    { compNo: 'ITEM-P-0011-01', description: 'a', qty: 1, uom: 'pc', unitCost: 10, costCurrency: 'USD', estimatedFreightCost: 0, freightCoversQty: 1, markupPercent: 10, pricing: 'own' },
    { compNo: 'ITEM-P-0011-02', description: 'b', qty: 1, uom: 'pc', unitCost: 10, costCurrency: 'USD', estimatedFreightCost: 0, freightCoversQty: 1, markupPercent: 0 }] });
  await go('#/quotations/new');
  doc.querySelector('.ln-catalog-btn').click(); await wait(20);
  [...doc.querySelectorAll('.item-picker-row')].find(r => /ITEM-P-0011/.test(r.textContent)).click(); await wait(60);
  trs = linesNow();
  console.log('20 a package saved with the old own-price setting still loads that item priced (lot line before the other):', trs.length === 3 && price(0) > 0 && label(trs[1]) === 'ITEM-P-0011' && price(2) === 0, trs.map(label).join('|'));

  // ---- package page ----
  await go('#/products/' + pkg.id, 100);
  const txt = doc.getElementById('content').textContent;
  console.log('21 package page: shows supplier, lead time, warranty, components; no Brand/Category/UOM/Price column:', /Allied Contractor/.test(txt) && /3 Weeks/.test(txt) && /2 Years/.test(txt) && /ITEM-P-0001-05/.test(txt) && !/Manufacturer|Category|Unit of Measure|Own price|In lot price/i.test(txt));
}
main().catch(e => { console.log('TEST FAILED', e); process.exit(1); });
