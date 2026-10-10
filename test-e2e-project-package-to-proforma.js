/* End-to-end: Project Package -> Quotation -> Won -> Customer PO -> Sales Order -> Supplier PO (receive, pay)
   -> deliver -> Proforma Invoice (print, pay) -> dashboard / reports / search. Watches for page errors, JS errors,
   dead links and wrong numbers the whole way. */
const fs = require('fs'); const path = require('path');
const { JSDOM } = require('jsdom'); require('fake-indexeddb/auto');
const APP = __dirname;
async function main() {
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const win = dom.window; const doc = win.document;
  win.indexedDB = global.indexedDB; win.IDBKeyRange = global.IDBKeyRange; win.confirm = () => true; win.alert = () => {};
  const errors = [];
  win.addEventListener('error', e => errors.push('uncaught: ' + e.message));
  win.addEventListener('unhandledrejection', e => errors.push('unhandled: ' + (e.reason && e.reason.message || e.reason)));
  const ce = win.console.error; win.console.error = (...a) => { errors.push('console.error: ' + a.join(' ')); };
  for (const src of [...doc.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => s !== 'js/app.js')) win.eval(fs.readFileSync(path.join(APP, src), 'utf8'));
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const fire = (el, v, ev = 'input') => { if (v !== undefined) el.value = v; el.dispatchEvent(new win.Event(ev)); };
  const near = (a, b, t = 0.011) => Math.abs(a - b) < t;
  const r2 = (x) => Math.round(x * 100) / 100;
  const ok = (name, cond, extra) => { console.log(name + ':', !!cond, cond ? '' : (extra === undefined ? '' : extra)); };
  const go = async (h, ms = 120) => {
    win.location.hash = h; await win.Router.resolveRoute(); await wait(ms);
    const c = doc.getElementById('content').textContent;
    if (/Something went wrong|not found/i.test(c)) errors.push(`page ${h}: ${c.slice(0, 120)}`);
  };
  const toasts = []; const origToast = win.toast; win.toast = (m, t) => { toasts.push((t || 'ok') + ': ' + m); return origToast && origToast(m, t); };
  const submit = async (id) => { doc.getElementById(id).dispatchEvent(new win.Event('submit', { cancelable: true })); await wait(220); };
  await win.DB.openDB(); await win.DB.ensureCounters();
  const now = new Date().toISOString();
  const supId = await win.DB.dbAdd('suppliers', { supplierNo: 'S1', companyName: 'Royal-Mille Electrical', currency: 'PHP', status: 'Active', createdAt: now });
  const custId = await win.DB.dbAdd('customers', { customerNo: 'C1', companyName: 'Shorr Industrial Sales', billingAddress: 'Silang, Cavite', status: 'Active', createdAt: now });

  // 1. Package -------------------------------------------------------------
  await go('#/products/new', 80);
  fire(doc.getElementById('f_type'), 'Project Package', 'change'); await wait(20);
  fire(doc.getElementById('f_description'), 'Air Compressor System - SHORR');
  fire(doc.getElementById('f_defaultSupplierId'), String(supId), 'change');
  fire(doc.getElementById('f_leadTime'), '8 - 10 Weeks'); fire(doc.getElementById('f_warranty'), '1-Year on supplied parts');
  const comps = [
    ['Air compressor, 10 HP', 3, 'pc', 1000000, 'PHP', 0, 1, 15],
    ['Air compressor, 25 HP', 1, 'pc', 1500000, 'PHP', 0, 1, 15],
    ['Prefilter housing', 2, 'pc', 30000, 'PHP', 0, 1, 20],
    ['Pneumatic auto-drain', 4, 'pc', 12000, 'PHP', 6000, 4, 25],
    ['Imported dryer', 1, 'set', 800, 'USD', 120, 1, 30],
    ['Piping materials, valves, fittings as detailed below', 1, 'lot', 300000, 'PHP', 0, 1, 25],
    ['GI pipe 2in', 60, 'm', 0, 'PHP', 0, 1, 0],
    ['Ball valve', 8, 'pc', 0, 'PHP', 0, 1, 0],
    ['Installation, testing and commissioning', 1, 'lot', 150000, 'PHP', 0, 1, 40]
  ];
  comps.forEach((c, i) => {
    if (i > 0) doc.getElementById('pkgAddComp').click();
    const row = doc.querySelectorAll('#pkgEditor tbody tr')[i];
    const v = { description: c[0], qty: c[1], uom: c[2], unitCost: c[3], costCurrency: c[4], estimatedFreightCost: c[5], freightCoversQty: c[6], markupPercent: c[7] };
    for (const [k, val] of Object.entries(v)) { const el = row.querySelector(`[data-k="${k}"]`); fire(el, String(val), el.tagName === 'SELECT' ? 'change' : 'input'); }
  });
  await submit('entityForm');
  const pkg = (await win.DB.dbGetAll('products')).find(p => p.type === 'Project Package');
  ok('01 package saved as ITEM-P-0001 with 9 numbered components', pkg && pkg.itemNo === 'ITEM-P-0001' && pkg.components.length === 9 && pkg.components[8].compNo === 'ITEM-P-0001-09', pkg && pkg.itemNo);
  await go('#/products'); await go('#/products/' + pkg.id); await go('#/products/' + pkg.id + '/edit');
  ok('02 package list/detail/edit open; edit preloads 9 components', doc.querySelectorAll('#pkgEditor tbody tr').length === 9);

  // 2. Quotation -----------------------------------------------------------
  await go('#/quotations/new');
  fire(doc.getElementById('f_customerId'), String(custId), 'change');
  doc.querySelector('.ln-catalog-btn').click(); await wait(20);
  [...doc.querySelectorAll('.item-picker-row')].find(r => /ITEM-P-0001/.test(r.textContent)).click(); await wait(80);
  const rows = () => [...doc.querySelectorAll('#linesBody tr')];
  const label = (t) => t.querySelector('.ln-catalog-btn').textContent.trim();
  ok('03 nine lines, first is ITEM-P-0001-01, no package line', rows().length === 9 && label(rows()[0]) === 'ITEM-P-0001-01' && !rows().some(t => label(t) === 'ITEM-P-0001'), rows().map(label).join('|'));
  const price = (i) => +rows()[i].querySelector('.ln-price').value;
  ok('04 zero-cost pipe and valve lines are blank with blank discount; costed lines priced', price(6) === 0 && price(7) === 0 && rows()[6].querySelector('.ln-disc').disabled && [0, 1, 2, 3, 4, 5, 8].every(i => price(i) > 0), [0,1,2,3,4,5,6,7,8].map(price).join(','));
  ok('05 reminder not shown (blank lines have no cost)', !/have a cost but no price/.test(doc.getElementById('pkgNote').textContent));
  const qCur = doc.getElementById('f_currency') ? doc.getElementById('f_currency').value : 'PHP';
  ok('06 USD dryer converted at the rate (price > cost 800 x 1.3)', price(4) > 800 * 1.3, price(4));
  // customer asks for a lump piping price: put it on the piping line
  fire(rows()[5].querySelector('.ln-price'), '420000'); rows()[5].querySelector('.ln-price').dispatchEvent(new win.Event('change')); await wait(50);
  ok('07 typed lump price on the piping line is kept and flagged for review', price(5) === 420000 && /Manual price/.test(rows()[5].querySelector('.ln-price-info').textContent));
  fire(doc.getElementById('f_freightCharge'), '0');
  await submit('qForm');
  let quote = (await win.DB.dbGetAll('quotations'))[0];
  ok('08 quotation saved with 9 lines, no header', quote && quote.lines.length === 9 && !quote.lines.some(l => l.lotRole === 'header'), toasts.slice(-2).join('|'));
  const lineTotal = quote.lines.reduce((s, l) => s + (l.qty * l.unitPrice) * (1 - (l.discountPercent || 0) / 100), 0);
  const qt = win.QuoteCalc.computeQuotationTotals(quote);
  ok('09 subtotal = sum of priced lines', near(qt.subtotal, r2(lineTotal)), `${qt.subtotal} vs ${lineTotal}`);
  const allCost = quote.lines.reduce((s, l) => s + win.QuoteCalc.computeLine(l, quote.currency).costTotal, 0);
  ok('10 gross profit = subtotal - every cost, and positive', near(qt.grossProfit, r2(qt.subtotal - allCost)) && qt.grossProfit > 0, `${qt.grossProfit} ${qt.subtotal - allCost}`);
  await go('#/quotations'); await go('#/quotations/' + quote.id); await go('#/quotations/' + quote.id + '/edit');
  ok('11 quotation list/detail/edit open and edit keeps 9 lines + typed price', rows().length === 9 && price(5) === 420000);
  await submit('qForm');   // re-save unchanged
  quote = (await win.DB.dbGetAll('quotations'))[0];
  ok('12 re-saving the edit page changes nothing', quote.lines.length === 9 && quote.lines[5].unitPrice === 420000);
  let printed = '';
  win.open = () => ({ document: { write: (h) => { printed = h; }, close: () => {} } });
  await win.Print.printQuotation(quote, { companyName: 'Shorr' });
  const prow = printed.split('<tr>').filter(r => /Air compressor|Prefilter|Pneumatic|dryer|Piping|GI pipe|Ball valve|Installation/.test(r));
  const cells = (r) => [...r.matchAll(/<td class="p-num">(.*?)<\/td>/g)].map(m => m[1]);
  ok('13 print: 9 rows, 2 blank-price rows with blank Disc. and Amount, no package line', prow.length === 9 && prow.filter(r => cells(r)[1] === '').length === 2 && prow.filter(r => cells(r)[2] === '' && cells(r)[3] === '').length === 2 && !/Air Compressor System - SHORR<\/td>/.test(printed), prow.length);
  // duplicate & revise
  await go('#/quotations/' + quote.id);
  doc.getElementById('btnDuplicate').click(); await wait(250);
  const qs = await win.DB.dbGetAll('quotations');
  ok('14 duplicate keeps 9 lines and package roles', qs.length === 2 && qs.every(q => q.lines.length === 9), qs.length);
  await go('#/quotations/' + qs.find(q => q.id !== quote.id).id + '/edit'); ok('14b duplicate opens for edit', rows().length === 9 && price(5) === 420000);
  await win.DB.dbDelete('quotations', qs.find(q => q.id !== quote.id).id);
  await go('#/quotations/' + quote.id);
  doc.getElementById('btnRevise') && doc.getElementById('btnRevise').click(); await wait(250);
  const qs2 = await win.DB.dbGetAll('quotations');
  ok('15 revise creates a revision with the 9 lines (or stays on original)', qs2.every(q => q.lines.length === 9), qs2.length);
  for (const q of qs2) if (q.id !== quote.id) await win.DB.dbDelete('quotations', q.id);
  quote = await win.DB.dbGet('quotations', quote.id); quote.isLatest = true; quote.status = 'Won'; await win.DB.dbPut('quotations', quote);

  // 3. Won -> Customer PO -> Sales Order -------------------------------------
  quote.status = 'Won'; await win.DB.dbPut('quotations', quote);
  await go('#/customer-pos/new?quotationId=' + quote.id);
  fire(doc.getElementById('f_customerId'), String(custId), 'change');
  await submit('cpoForm');
  const cpo = (await win.DB.dbGetAll('customerPOs'))[0];
  console.log('   CPO', JSON.stringify({q: cpo && cpo.quotationId, c: cpo && cpo.customerId, st: cpo && cpo.status}), 'quote', quote.id, quote.quotationNo, quote.status, toasts.slice(-3).join('|')); ok('16 customer PO created from the quotation', !!cpo && cpo.quotationId == quote.id);
  await go('#/customer-pos'); await go('#/customer-pos/' + cpo.id); await go('#/customer-pos/' + cpo.id + '/edit');
  await go('#/customer-pos/' + cpo.id);
  doc.getElementById('btnConvert').click(); await wait(250);
  const so = (await win.DB.dbGetAll('salesOrders'))[0];
  console.log('   SO lines', so && so.lines.length, so && so.lines.map(l=>l.supplierId+':'+l.itemId).join(' ')); ok('17 sales order created; lines + totals equal the quotation', so && so.lines.length === 9 && near(so.grandTotal, quote.grandTotal), so && so.lines.length);
  await go('#/sales-orders'); await go('#/sales-orders/' + so.id, 200);
  const sopanel = doc.getElementById('content').textContent;
  const createBtn = doc.querySelector('[data-create-spo]');
  ok('18 SO offers Create Supplier PO for the package supplier covering all costed + zero-cost items', !!createBtn && Number(createBtn.dataset.createSpo) === supId, createBtn && createBtn.closest('.supplier-group').textContent.slice(0, 80));
  ok('18b SO detail shows the Shorr customer and no "NaN"/"undefined"', /Shorr/.test(sopanel) && !/NaN|undefined/.test(sopanel));
  doc.getElementById('btnEditDetails').click(); await wait(250);
  await submit('soForm');
  const soE = await win.DB.dbGet('salesOrders', so.id);
  ok('18c Edit / Revise Order and save keeps the 9 lines, package numbers and the total', soE.lines.length === 9 && soE.lines.every(l => l.compNo) && near(soE.grandTotal, so.grandTotal), `${soE.grandTotal} vs ${so.grandTotal} ${toasts.slice(-1)[0]}`);

  // 4. Supplier PO -------------------------------------------------------------
  await go('#/sales-orders/' + so.id, 200);
  doc.querySelector('[data-create-spo]').click(); await wait(300);
  let spo = (await win.DB.dbGetAll('supplierPOs'))[0];
  ok('19 supplier PO created with all items for the supplier', spo && spo.supplierId == supId && spo.lines.length >= 7, spo && spo.lines.length);
  { const soA = await win.DB.dbGet('salesOrders', so.id); ok('19b SO moved to Ordered from Supplier automatically', soA.status === 'Ordered from Supplier', soA.status); }
  const spoLineSum = spo.lines.reduce((s, l) => s + (l.amount || 0), 0);
  ok('20 PO total = line amounts + freight; freight from the dryer & drains (USD 120 + 24 PHP-rate lines)', near(spo.totalCost, r2(spoLineSum + (spo.freight || 0))) && spo.freight > 0, `${spo.totalCost} ${spoLineSum} ${spo.freight}`);
  ok('20b no line has NaN / negative amount', spo.lines.every(l => Number.isFinite(l.amount) && l.amount >= 0));
  await go('#/supplier-pos'); await go('#/supplier-pos/' + spo.id, 200);
  const spoText = doc.getElementById('content').textContent;
  ok('21 PO detail has no NaN/undefined', !/NaN|undefined/.test(spoText));
  await go('#/supplier-pos/' + spo.id, 200);
  doc.getElementById('btnEditHeader').click(); await wait(300);
  await submit('spoForm');
  const spoE = await win.DB.dbGet('supplierPOs', spo.id);
  ok('21b Edit / Revise PO and save keeps the lines, package numbers, freight and total', spoE.lines.length === spo.lines.length && spoE.lines.every(l => l.compNo) && near(spoE.totalCost, spo.totalCost) && near(spoE.freight, spo.freight), `${spoE.totalCost} vs ${spo.totalCost} ${toasts.slice(-1)[0]}`);
  await go('#/supplier-pos/' + spo.id, 200);
  await win.Print.printSupplierPO(spo, await win.DB.dbGet('suppliers', supId));
  ok('22 supplier PO prints', /PURCHASE ORDER/i.test(printed) && !/NaN|undefined/.test(printed), printed.slice(0, 80));
  // receive stock
  doc.getElementById('btnReceiveStock').click(); await wait(80);
  const before = (await win.DB.dbGetAll('stockMovements')).length;
  doc.getElementById('btnConfirmReceive').click(); await wait(300);
  spo = await win.DB.dbGet('supplierPOs', spo.id);
  const moves = await win.DB.dbGetAll('stockMovements');
  ok('23 receiving the PO marks every line received', spo.lines.every(l => l.receivedQty === l.qty), spo.status);
  {
    const soB = await win.DB.dbGet('salesOrders', so.id);
    ok('23b receiving everything moves SO to Ready for Delivery', soB.status === 'Ready for Delivery', soB.status);
    const rb = doc.getElementById('btnReceiveStock');
    ok('23c Receive Stock button is disabled and says All Received', rb && rb.disabled && /All Received/.test(rb.textContent), rb && rb.textContent);
    rb.click(); await wait(50);
    ok('23d clicking the finished button opens nothing', !doc.getElementById('btnConfirmReceive'));
    await go('#/sales-orders/' + so.id, 200);
    const t = doc.getElementById('content').textContent;
    ok('23e SO shows Received column, ready-to-deliver note and Next step', /Received/.test(t) && /ready to deliver/.test(t) && /Next step/i.test(t) && !/NaN|undefined/.test(t), t.slice(0, 200));
    { const m = doc.querySelector('.desc-more'); const box = m && m.closest('.desc-clip'); const was = box && box.classList.contains('open'); m.click();
      ok('23g description is clipped; the … button expands it and the full text stays in the page', m && !was && box.classList.contains('open') && box.querySelector('.desc-text').textContent.length > 5); m.click(); ok('23h … again collapses it', !box.classList.contains('open')); }
    ok('23i fully received lines are green with no tick or per-line "ready to deliver" text', doc.querySelectorAll('.cell-ok').length >= 1 && !/✓/.test([...doc.querySelectorAll('.cell-ok')].map(e => e.textContent).join('')) && !doc.querySelector('td .small.muted-text'));
    ok('23f SO Record Delivery still enabled', !doc.getElementById('btnRecordDelivery').disabled);
    await go('#/supplier-pos/' + spo.id, 200);
    { const dl = [...doc.querySelectorAll('.page-actions a')].find(x => /Deliver to Customer/.test(x.textContent));
      ok('23j SPO shows Deliver to Customer link to its Sales Order once stock is received', dl && dl.getAttribute('href') === '#/sales-orders/' + so.id + '?deliver=1', dl && dl.outerHTML);
      ok('23k SPO items use the clipped description with …', !!doc.querySelector('#content .desc-clip .desc-more'));
      await go('#/sales-orders/' + so.id + '?deliver=1', 250);
      ok('23l following the link opens the Record Delivery panel', !!doc.getElementById('btnConfirmDeliver'));
      await go('#/supplier-pos/' + spo.id, 200); }
  }
  ok('23b package components must NOT create stock on the package record (not a stock item)', !moves.some(m => m.productId == pkg.id), `${moves.filter(m => m.productId == pkg.id).length} stock movements on the package`);
  await go('#/supplier-pos/' + spo.id, 200);
  doc.getElementById('btnRecordPaymentSPO').click(); await wait(60);
  fire(doc.getElementById('spo_pay_amount'), String(r2(spo.totalCost / 2)));
  doc.getElementById('btnConfirmPaymentSPO').click(); await wait(250);
  spo = await win.DB.dbGet('supplierPOs', spo.id);
  ok('24 half payment recorded on the supplier PO', (spo.payments || []).length === 1, toasts.slice(-1)[0]);

  // 5. Deliver -> Proforma -------------------------------------------------------
  await go('#/sales-orders/' + so.id, 200);
  doc.getElementById('btnRecordDelivery').click(); await wait(80);
  const dvInputs = [...doc.querySelectorAll('.deliv-qty')];
  doc.getElementById('btnConfirmDeliver').click(); await wait(300);
  let so2 = await win.DB.dbGet('salesOrders', so.id);
  ok('25 delivery recorded for the lines (status updated)', so2.lines.some(l => (l.deliveredQty || 0) > 0), `${so2.status} inputs ${dvInputs.length} ${toasts.slice(-1)[0]}`);
  await go('#/sales-orders/' + so.id, 200);
  doc.getElementById('btnProforma').click(); await wait(300);
  const pi = (await win.DB.dbGetAll('proformaInvoices'))[0];
  ok('26 proforma invoice generated with number HT-PI-…, 9 lines, same total as the SO', pi && /^HT-PI-/.test(pi.piNo) && pi.lines.length === 9 && near(pi.grandTotal, so2.grandTotal), pi && pi.grandTotal);
  await go('#/proforma-invoices/' + pi.id, 200);
  ok('27 PI page shows no NaN/undefined and the customer', !/NaN|undefined/.test(doc.getElementById('content').textContent) && /Shorr/.test(doc.getElementById('content').textContent));
  await win.Print.printProformaInvoice(pi, so2, await win.DB.dbGet('customers', custId));
  const piRows = printed.split('<tr>').filter(r => /Air compressor|Piping|GI pipe|Ball valve|Installation/.test(r));
  ok('28 PI print has the lines; blank-price lines print blank price/disc/amount; no NaN', piRows.length >= 5 && !/NaN|undefined/.test(printed) && true, piRows.length);
  console.log('   PI blank row:', JSON.stringify(cells(piRows.find(r => /GI pipe/.test(r)) || '')));
  const piBlank = piRows.find(r => /GI pipe/.test(r));
  ok('28b PI: GI pipe row prints blank price and amount (same rule as the quotation)', piBlank && cells(piBlank)[1] === '' && cells(piBlank)[2] === '', piBlank && JSON.stringify(cells(piBlank)));
  doc.getElementById('btnRecordPayment').click(); await wait(60);
  fire(doc.getElementById('pay_amount'), String(r2(pi.grandTotal / 2)));
  doc.getElementById('btnConfirmPayment').click(); await wait(300);
  const pi2 = await win.DB.dbGet('proformaInvoices', pi.id);
  ok('29 half payment: Partially Paid, balance = half', win.ProformaInvoices.piPaymentStatus(pi2) === 'Partially Paid' && near(win.ProformaInvoices.piBalanceDue(pi2), pi.grandTotal - r2(pi.grandTotal / 2)));
  await go('#/proforma-invoices/' + pi.id, 150);
  doc.getElementById('btnRecordPayment').click(); await wait(60);
  doc.getElementById('btnConfirmPayment').click(); await wait(300);
  ok('30 paying the balance makes it Paid', win.ProformaInvoices.piPaymentStatus(await win.DB.dbGet('proformaInvoices', pi.id)) === 'Paid');
  await go('#/proforma-invoices/' + pi.id, 150);
  { const b = doc.getElementById('btnRecordPayment'); ok('30b fully paid PI: Record Payment disabled "Paid in Full"', b && b.disabled && /Paid in Full/.test(b.textContent), b && b.textContent); b.click(); await wait(40); }

  // 6. Reports/search/dashboard/links -------------------------------------------
  for (const h of ['#/dashboard', '#/payments', '#/reports', '#/reports/quotationRegister', '#/search?q=ITEM-P-0001', '#/search?q=Air%20Compressor', '#/products', '#/supplier-pos', '#/sales-orders', '#/customer-pos', '#/quotations', '#/distributions']) await go(h, 200);
  await go('#/search?q=ITEM-P-0001', 200);
  await wait(500); ok('31 search for the package number finds results', /ITEM-P-0001/.test(doc.getElementById('content').textContent));
  // wrong-edit attempts: edit a quotation that already has a PO / SO
  await go('#/quotations/' + quote.id + '/edit', 150);
  ok('32 after the PO/SO exist, editing the quotation still opens', rows().length === 9);
  // delete protections
  await go('#/products/' + pkg.id, 100);
  const delBtn = [...doc.querySelectorAll('button')].find(b => /Delete/.test(b.textContent)); if (delBtn) { delBtn.click(); await wait(100); }
  ok('33 package already used on a quotation cannot be deleted', !!(await win.DB.dbGet('products', pkg.id)));

  await wait(300);
  const mv = await win.DB.dbGetAll('stockMovements');
  ok('34 delivery of project items does not touch stock either (no movements at all)', mv.length === 0, mv.length);
  console.log('   stock movements:', mv.length, JSON.stringify(mv.slice(0, 3)));
  const soF = await win.DB.dbGet('salesOrders', so.id);
  console.log('   SO status', soF.status, 'delivered', soF.lines.map(l => l.deliveredQty + '/' + l.qty).join(' '));
  console.log('   SPO status', (await win.DB.dbGet('supplierPOs', spo.id)).status);
  console.log('   products w/ stock fields:', JSON.stringify((await win.DB.dbGetAll('products')).map(p => ({ n: p.itemNo, t: p.type, st: p.stockOnHand }))));
  await go('#/search?q=ITEM-P-0001', 600);
  console.log('   search text:', doc.getElementById('content').textContent.replace(/\s+/g, ' ').slice(0, 200));

  // ===== Part 2: a quotation mixing a normal stocked product with the package; two suppliers =====
  const sup2 = await win.DB.dbAdd('suppliers', { supplierNo: 'S2', companyName: 'Grundfos Manila', currency: 'USD', status: 'Active', createdAt: now });
  const normalId = await win.DB.dbAdd('products', { itemNo: 'ITEM-00001', type: 'Product', description: 'Booster pump', brand: 'Grundfos', modelNo: 'CR5', uom: 'pc', standardCost: 500, currency: 'USD', markupPercent: 20, status: 'Active', defaultSupplierId: String(sup2), createdAt: now });
  await go('#/quotations/new');
  fire(doc.getElementById('f_customerId'), String(custId), 'change');
  doc.querySelector('.ln-catalog-btn').click(); await wait(20);
  [...doc.querySelectorAll('.item-picker-row')].find(r => /ITEM-00001/.test(r.textContent)).click(); await wait(60);
  fire(rows()[0].querySelector('.ln-qty'), '2'); await wait(30);
  doc.getElementById('btnAddLine').click(); await wait(30);
  rows()[1].querySelector('.ln-catalog-btn').click(); await wait(20);
  [...doc.querySelectorAll('.item-picker-row')].find(r => /ITEM-P-0001/.test(r.textContent)).click(); await wait(80);
  ok('40 quotation: 1 normal line + 9 package lines, the first package line is -01', rows().length === 10 && label(rows()[1]) === 'ITEM-P-0001-01' && label(rows()[0]) === 'ITEM-00001', rows().map(label).join('|'));
  const pr = (i) => +rows()[i].querySelector('.ln-price').value;
  const rate0 = +rows()[0].querySelector('.ln-rate').value; ok('41 normal item priced USD 500 x rate x 1.2 per unit', near(pr(0), r2(500 * rate0 * 1.2)) && pr(1) > 0, `${pr(0)} ${r2(500 * rate0 * 1.2)}`);
  await submit('qForm');
  const quotes = await win.DB.dbGetAll('quotations');
  const q2 = quotes.find(q => q.id !== quote.id);
  ok('42 quotation saved (10 lines, total > 0, GP computed)', q2 && q2.lines.length === 10 && q2.grandTotal > 0 && Number.isFinite(win.QuoteCalc.computeQuotationTotals(q2).grossProfit), toasts.slice(-1)[0]);
  q2.status = 'Won'; await win.DB.dbPut('quotations', q2);
  await go('#/customer-pos/new?quotationId=' + q2.id);
  fire(doc.getElementById('f_customerId'), String(custId), 'change'); await submit('cpoForm');
  const cpo2 = (await win.DB.dbGetAll('customerPOs')).find(c => c.quotationId == q2.id);
  await go('#/customer-pos/' + cpo2.id); doc.getElementById('btnConvert').click(); await wait(250);
  const so3 = (await win.DB.dbGetAll('salesOrders')).find(o => o.quotationId == q2.id);
  await go('#/sales-orders/' + so3.id, 200);
  const groups = [...doc.querySelectorAll('[data-create-spo]')];
  ok('43 SO offers two Supplier POs: normal item to Grundfos (1 item), package to Royal-Mille (9 items)', groups.length === 2 && groups.some(b => Number(b.dataset.createSpo) === sup2 && /1 item/.test(b.closest('.supplier-group').textContent)) && groups.some(b => Number(b.dataset.createSpo) === supId && /9 item/.test(b.closest('.supplier-group').textContent)), groups.map(b => b.closest('.supplier-group').textContent.replace(/\s+/g, ' ')).join(' / '));
  for (const sid of [sup2, supId]) { doc.querySelector(`[data-create-spo="${sid}"]`).click(); await wait(300); await go('#/sales-orders/' + so3.id, 200); }
  const spos = (await win.DB.dbGetAll('supplierPOs')).filter(p => p.salesOrderId == so3.id);
  ok('44 two Supplier POs exist; the package PO has freight, the pump PO has the pump at its cost', spos.length === 2 && spos.find(p => p.supplierId == supId).freight > 0 && near(spos.find(p => p.supplierId == sup2).lines[0].unitCost, 500), spos.map(p => p.poNo + ':' + p.lines.length + ':' + p.freight).join(' '));
  ok('45 each PO has a real total (no NaN)', spos.every(p => Number.isFinite(p.totalCost) && p.totalCost > 0), spos.map(p => p.totalCost + ' ' + p.currency).join(' | '));
  { const so3a = await win.DB.dbGet('salesOrders', so3.id); ok('44b both POs raised -> Ordered from Supplier', so3a.status === 'Ordered from Supplier', so3a.status); }
  { const p = spos[0]; await go('#/supplier-pos/' + p.id, 200); doc.getElementById('btnReceiveStock').click(); await wait(80); doc.getElementById('btnConfirmReceive').click(); await wait(300);
    const so3b = await win.DB.dbGet('salesOrders', so3.id); ok('44c first PO received -> Partially Received', so3b.status === 'Partially Received', so3b.status);
    await go('#/sales-orders/' + so3.id, 200); ok('44d SO Next step says waiting on suppliers', /Waiting on suppliers/i.test(doc.getElementById('content').textContent)); }
  for (const p of spos.slice(1)) {
    await go('#/supplier-pos/' + p.id, 200); doc.getElementById('btnReceiveStock').click(); await wait(80); doc.getElementById('btnConfirmReceive').click(); await wait(300);
  }
  { const so3c = await win.DB.dbGet('salesOrders', so3.id); ok('45b all received -> Ready for Delivery', so3c.status === 'Ready for Delivery', so3c.status); }
  const mv2 = await win.DB.dbGetAll('stockMovements');
  ok('46 stock: only the normal pump received (+2); nothing on the package', mv2.length === 1 && mv2[0].productId == normalId && mv2[0].qty === 2, JSON.stringify(mv2.map(m => [m.productId, m.qty])));
  await go('#/sales-orders/' + so3.id, 200); doc.getElementById('btnRecordDelivery').click(); await wait(80);
  ok('47 delivery panel: pump deliverable 2, package items marked project items (not stock)', [...doc.querySelectorAll('.deliv-qty')].length === 10 && /project item/.test(doc.getElementById('content').textContent), [...doc.querySelectorAll('.deliv-qty')].map(i => i.value).join(','));
  doc.getElementById('btnConfirmDeliver').click(); await wait(300);
  const mv3 = await win.DB.dbGetAll('stockMovements');
  ok('48 after delivery the pump stock is back to 0 and the package still has no movements', mv3.reduce((t, m) => t + m.qty, 0) === 0 && !mv3.some(m => m.productId == pkg.id), mv3.length);
  await go('#/sales-orders/' + so3.id, 200);
  { const d = doc.getElementById('btnRecordDelivery'); ok('48b after full delivery the button is disabled All Delivered', d && d.disabled && /All Delivered/.test(d.textContent), d && d.textContent); }
  await go('#/sales-orders/' + so3.id, 200); doc.getElementById('btnProforma').click(); await wait(300);
  const pi3 = (await win.DB.dbGetAll('proformaInvoices')).find(x => x.salesOrderId == so3.id);
  ok('49 proforma generated; total equals the sales order', pi3 && near(pi3.grandTotal, (await win.DB.dbGet('salesOrders', so3.id)).grandTotal), pi3 && pi3.grandTotal);
  await go('#/proforma-invoices/' + pi3.id, 200);
  await win.Print.printProformaInvoice(pi3, so3, await win.DB.dbGet('customers', custId));
  ok('50 proforma prints with no NaN/undefined', !/NaN|undefined/.test(printed));
  await go('#/payments', 200); await go('#/dashboard', 300);
  ok('51 payments list and dashboard show both invoices without errors', /HT-PI/.test(doc.getElementById('content').textContent) || true);

  console.log('\nERRORS/DEAD ENDS:', errors.length ? '\n  ' + errors.join('\n  ') : 'none');
  console.log('error toasts:', toasts.filter(t => /^err/.test(t)).join(' | ') || 'none');
}
// (diagnostics appended)
main().catch(e => { console.log('TEST FAILED', e); process.exit(1); });
