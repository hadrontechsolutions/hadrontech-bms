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
    { description: 'Design and PME', qty: 1, unitCost: 700, estimatedFreightCost: 0, freightCoversQty: 1, markupPercent: 40 },
    { description: 'Fittings as detailed below', qty: 1, unitCost: 0, estimatedFreightCost: 0, freightCoversQty: 1, markupPercent: 0 }
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

  // ---- quotation: the package is NOT a line; items load priced, zero-cost items stay blank ----
  await go('#/quotations/new');
  doc.querySelector('.ln-catalog-btn').click(); await wait(20);
  [...doc.querySelectorAll('.item-picker-row')].find(r => /ITEM-P-0001/.test(r.textContent)).click(); await wait(60);
  const linesNow = () => [...doc.querySelectorAll('#linesBody tr')];
  let trs = linesNow();
  const label = (t) => t.querySelector('.ln-catalog-btn').textContent.trim();
  const rate = +trs[0].querySelector('.ln-rate').value;
  const price = (i) => +linesNow()[i].querySelector('.ln-price').value;
  const r2 = (x) => Math.round(x * 100) / 100;
  const calc = (cost, markup) => r2(cost * rate * (1 + markup / 100));
  console.log('5 first line is ITEM-P-0001-01 and there is NO ITEM-P-0001 line (6 items only):', trs.length === 6 && label(trs[0]) === 'ITEM-P-0001-01' && !trs.some(t => label(t) === 'ITEM-P-0001'), trs.map(label).join('|'));
  const note = () => doc.getElementById('pkgNote').textContent;
  console.log('5b the package shows only as a reference note above the lines:', /Project:\s*ITEM-P-0001/.test(note()) && /Air compressor project/.test(note()), note());
  console.log('5c costed items load at cost + freight + markup; the zero-cost item is blank:', near(price(1), calc(100, 25)) && near(price(2), calc(10, 30)) && near(price(3), calc(5, 30)) && price(5) === 0 && price(0) > 0);
  console.log('5d no reminder while nothing with a cost is unpriced:', !/have a cost but no price/.test(note()));
  console.log('6 every item line carries the package supplier:', linesNow().every(t => t.querySelector('.ln-supplier').value === String(supId)));
  console.log('7 lead time "3 Weeks" on the lines; warranty "2 Years" and delivery lead time filled on the quotation:', linesNow().every(t => /3 Weeks/.test(t.textContent)) && doc.getElementById('f_warranty').value === '2 Years' && doc.getElementById('f_deliveryLeadTime').value === '3 Weeks');

  // ---- clearing a price makes the item part of the lot (blank) and raises the reminder ----
  const setPrice = async (i, v) => { const el = linesNow()[i].querySelector('.ln-price'); fire(el, String(v)); el.dispatchEvent(new win.Event('change')); await wait(40); };
  await setPrice(2, 0);
  console.log('8 clearing the pipe price keeps it blank (in the lot) and warns that item 03 has a cost but no price:', price(2) === 0 && /Items 03 have a cost but no price/.test(note()), note());
  const pop = linesNow()[2].querySelector('.ln-flag-btn'); pop.click(); await wait(10);
  const ownBtn = doc.querySelector('.ln-info-popup .ln-own-price');
  console.log('9 that item has a "!" popup with "Price it separately":', pop.style.display !== 'none' && !!ownBtn);
  ownBtn.click(); await wait(40);
  console.log('10 "Price it separately" restores the calculated price and clears the reminder:', near(price(2), calc(10, 30)) && !/have a cost but no price/.test(note()));
  await setPrice(0, 5000);
  console.log('11 a typed price is kept:', price(0) === 5000 && price(1) > 0);

  // ---- totals, GP, print, supplier PO ----
  doc.getElementById('f_customerId').value = String(custId); doc.getElementById('f_customerId').dispatchEvent(new win.Event('change'));
  doc.getElementById('qForm').dispatchEvent(new win.Event('submit', { cancelable: true })); await wait(180);
  const q = (await win.DB.dbGetAll('quotations'))[0];
  const qt = win.QuoteCalc.computeQuotationTotals(q);
  const priced = q.lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0);
  console.log('15 quotation total = the priced items; gross profit subtracts every item cost:', q.lines.length === 6 && !q.lines.some(l => l.lotRole === 'header') && near(q.grandTotal, r2(priced)) && near(qt.grossProfit, r2(q.grandTotal - q.lines.reduce((s, l) => s + win.QuoteCalc.computeLine(l, 'PHP').costTotal, 0))), q.grandTotal, qt.grossProfit);
  let printed = '';
  win.open = () => ({ document: { write: (h) => { printed = h; }, close: () => {} } });
  await win.Print.printQuotation(q, { companyName: 'SHORR' });
  const rows = printed.split('<tr>').filter(r => /Compressor 10HP|Prefilter|GI pipe|Ball valve|Design and PME|Fittings as detailed below/.test(r));
  const cells = (r) => [...r.matchAll(/<td class="p-num">(.*?)<\/td>/g)].map(m => m[1]);
  const priceCells = rows.map(r => cells(r)[1]);
  console.log('16 print: no package line; the zero-cost item prints a blank price, the others a price:', rows.length === 6 && !/Air compressor project/.test(rows.join('')) && priceCells.filter(x => x === '').length === 1 && priceCells[5] === '', JSON.stringify(priceCells));
  const forPO = q.lines.filter(l => l.supplierId === supId);
  console.log('17 for the Supplier PO: all 6 items go to the package supplier:', forPO.length === 6);

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
  console.log('17b Sales Order offers "Create Supplier PO" for the package supplier:', !!createBtn && Number(createBtn.dataset.createSpo) === supId);
  createBtn.click(); await wait(200);
  const spo = (await win.DB.dbGetAll('supplierPOs'))[0];
  console.log('17c Supplier PO has the items, freight pre-filled with the compressor freight USD 60, total = items + freight:', !!spo && spo.lines.length >= 5 && near(spo.freight, 60) && near(spo.totalCost, spo.lines.reduce((t, l) => t + l.amount, 0) + 60), spo && spo.freight);

  // ---- saved quotation reopens the same ----
  await go('#/quotations/' + q.id + '/edit', 150);
  trs = linesNow();
  console.log('18 reopened quotation keeps the same lines, prices and order:', trs.map(label).join('|') === 'ITEM-P-0001-01|ITEM-P-0001-02|ITEM-P-0001-03|ITEM-P-0001-04|ITEM-P-0001-05|ITEM-P-0001-06' && price(0) === 5000 && price(5) === 0 && /Project:\s*ITEM-P-0001/.test(note()));

  // ---- a quotation saved by the older version, with a package lot line, still opens and prices ----
  const legacy = JSON.parse(JSON.stringify(q)); delete legacy.id; legacy.quotationNo = 'LEG-1';
  const hdr = { ...q.lines[0], lineId: 'hdr1', lotRole: 'header', compNo: undefined, description: 'Air compressor project', qty: 1, uom: 'lot', unitCost: 0, unitPrice: 777, priceOverridden: true, supplierId: '' };
  legacy.lines = [hdr, ...q.lines.map(l => ({ ...l, lotRole: 'component', unitPrice: 0 }))];
  const legId = await win.DB.dbAdd('quotations', legacy);
  await go('#/quotations/' + legId + '/edit', 150);
  trs = linesNow();
  console.log('19 an older quotation that still has the package lot line opens with it:', trs.length === 7 && label(trs[0]) === 'ITEM-P-0001' && price(0) === 777, trs.map(label).join('|'));

  // ---- a package saved with the retired "own price" setting just loads priced by cost ----
  const pOwn = await win.DB.dbAdd('products', { itemNo: 'ITEM-P-0011', type: 'Project Package', description: 'Old with own', status: 'Active', createdAt: now, defaultSupplierId: supId, nextCompSeq: 3, components: [
    { compNo: 'ITEM-P-0011-01', description: 'a', qty: 1, uom: 'pc', unitCost: 10, costCurrency: 'USD', estimatedFreightCost: 0, freightCoversQty: 1, markupPercent: 10, pricing: 'own' },
    { compNo: 'ITEM-P-0011-02', description: 'b', qty: 1, uom: 'pc', unitCost: 10, costCurrency: 'USD', estimatedFreightCost: 0, freightCoversQty: 1, markupPercent: 0, pricing: 'lot' }] });
  await go('#/quotations/new');
  doc.querySelector('.ln-catalog-btn').click(); await wait(20);
  [...doc.querySelectorAll('.item-picker-row')].find(r => /ITEM-P-0011/.test(r.textContent)).click(); await wait(60);
  trs = linesNow();
  console.log('20 a package with the retired own/lot setting loads 2 priced lines and no package line:', trs.length === 2 && price(0) > 0 && price(1) > 0 && label(trs[0]) === 'ITEM-P-0011-01', trs.map(label).join('|'));

  // ---- package page ----
  await go('#/products/' + pkg.id, 100);
  const txt = doc.getElementById('content').textContent;
  console.log('21 package page: shows supplier, lead time, warranty, components; no Brand/Category/UOM/Price column:', /Allied Contractor/.test(txt) && /3 Weeks/.test(txt) && /2 Years/.test(txt) && /ITEM-P-0001-06/.test(txt) && !/Manufacturer|Category|Unit of Measure|Own price|In lot price/i.test(txt));
}
main().catch(e => { console.log('TEST FAILED', e); process.exit(1); });
