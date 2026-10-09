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

  // ---- a normal product first: numbering must be untouched ----
  await go('#/products/new', 80);
  fire(doc.getElementById('f_description'), 'Plain item');
  doc.getElementById('entityForm').dispatchEvent(new win.Event('submit', { cancelable: true })); await wait(120);
  let prods = await win.DB.dbGetAll('products');
  console.log('1 normal product still numbered ITEM-00001:', prods[0].itemNo === 'ITEM-00001', prods[0].itemNo);

  // ---- create a Project Package ----
  const makePkg = async (name, comps) => {
    await go('#/products/new', 80);
    fire(doc.getElementById('f_type'), 'Project Package', 'change'); await wait(20);
    fire(doc.getElementById('f_description'), name);
    for (let i = 0; i < comps.length; i++) {
      if (i > 0) doc.getElementById('pkgAddComp').click();
      const row = doc.querySelectorAll('#pkgEditor tbody tr')[i];
      const c = comps[i];
      for (const [k, v] of Object.entries(c)) { const el = row.querySelector(`[data-k="${k}"]`); fire(el, String(v), el.tagName === 'SELECT' ? 'change' : 'input'); }
    }
    doc.getElementById('entityForm').dispatchEvent(new win.Event('submit', { cancelable: true })); await wait(150);
  };
  await go('#/products/new', 80);
  fire(doc.getElementById('f_type'), 'Project Package', 'change'); await wait(20);
  console.log('2 package form hides single-item cost fields & shows component editor:', doc.getElementById('f_standardCost').closest('.field').style.display === 'none' && doc.getElementById('pkgEditor').style.display !== 'none');

  await makePkg('SHORR Project', [
    { description: 'Pump A', qty: 2, uom: 'pc', unitCost: 100, costCurrency: 'USD', estimatedFreightCost: 20, freightCoversQty: 2, markupPercent: 25 },
    { description: 'Valve B', qty: 4, uom: 'pc', unitCost: 50, costCurrency: 'USD', estimatedFreightCost: 0, freightCoversQty: 1, markupPercent: 25 },
    { description: 'Tools set', qty: 1, uom: 'set', unitCost: 30, costCurrency: 'USD', estimatedFreightCost: 0, freightCoversQty: 1, markupPercent: 25 }
  ]);
  prods = await win.DB.dbGetAll('products');
  const pkg = prods.find(p => p.type === 'Project Package');
  console.log('3 package numbered ITEM-P-0001:', pkg && pkg.itemNo === 'ITEM-P-0001', pkg && pkg.itemNo);
  console.log('4 components numbered ITEM-P-0001-01/-02/-03:', JSON.stringify((pkg.components || []).map(c => c.compNo)) === '["ITEM-P-0001-01","ITEM-P-0001-02","ITEM-P-0001-03"]', JSON.stringify((pkg.components || []).map(c => c.compNo)));

  await makePkg('Second Project', [{ description: 'Only item', qty: 1, uom: 'pc', unitCost: 10, costCurrency: 'PHP' }]);
  const pkg2 = (await win.DB.dbGetAll('products')).find(p => p.itemNo === 'ITEM-P-0002');
  console.log('5 second package ITEM-P-0002, its first component restarts at -01:', !!pkg2 && pkg2.components[0].compNo === 'ITEM-P-0002-01');

  // normal product after packages keeps its own sequence
  await go('#/products/new', 80);
  fire(doc.getElementById('f_description'), 'Another plain');
  doc.getElementById('entityForm').dispatchEvent(new win.Event('submit', { cancelable: true })); await wait(120);
  const plain2 = (await win.DB.dbGetAll('products')).find(p => p.description === 'Another plain');
  console.log('6 next normal product is ITEM-00002 (packages did not consume it):', plain2.itemNo === 'ITEM-00002', plain2.itemNo);

  // Products list: header listed, components not listed as rows
  await go('#/products', 100);
  const listText = doc.getElementById('content').textContent;
  console.log('7 Products list shows ITEM-P-0001 but no component rows:', /ITEM-P-0001/.test(listText) && !/ITEM-P-0001-01/.test(listText) && /3 items/.test(listText));

  // detail page lists components
  await go('#/products/' + pkg.id, 100);
  const dt = doc.getElementById('content').textContent;
  console.log('8 detail page lists all components with numbers:', /ITEM-P-0001-01/.test(dt) && /ITEM-P-0001-03/.test(dt) && /Pump A/.test(dt) && !/Adjust Stock/.test(dt));

  // edit: add component -> -04 ; delete -02 and add -> -05 (never reused); type locked
  await go('#/products/' + pkg.id + '/edit', 100);
  console.log('9 type locked on edit and existing components preloaded:', doc.getElementById('f_type').style.pointerEvents === 'none' && doc.querySelectorAll('#pkgEditor tbody tr').length === 3);
  doc.getElementById('pkgAddComp').click();
  let rws = doc.querySelectorAll('#pkgEditor tbody tr');
  fire(rws[3].querySelector('[data-k="description"]'), 'Extra 1');
  doc.getElementById('entityForm').dispatchEvent(new win.Event('submit', { cancelable: true })); await wait(150);
  let p1 = await win.DB.dbGet('products', pkg.id);
  console.log('10 added component = ITEM-P-0001-04:', p1.components[3].compNo === 'ITEM-P-0001-04');
  await go('#/products/' + pkg.id + '/edit', 100);
  doc.querySelectorAll('#pkgEditor tbody tr')[1].querySelector('[data-del]').click();
  doc.getElementById('pkgAddComp').click();
  rws = doc.querySelectorAll('#pkgEditor tbody tr');
  fire(rws[rws.length - 1].querySelector('[data-k="description"]'), 'Extra 2');
  doc.getElementById('entityForm').dispatchEvent(new win.Event('submit', { cancelable: true })); await wait(150);
  p1 = await win.DB.dbGet('products', pkg.id);
  console.log('11 after deleting -02 and adding one: new number is -05, -02 not reused:', JSON.stringify(p1.components.map(c => c.compNo)) === '["ITEM-P-0001-01","ITEM-P-0001-03","ITEM-P-0001-04","ITEM-P-0001-05"]', JSON.stringify(p1.components.map(c => c.compNo)));

  // empty package rejected
  await go('#/products/new', 80);
  fire(doc.getElementById('f_type'), 'Project Package', 'change'); await wait(20);
  fire(doc.getElementById('f_description'), 'Empty one');
  doc.getElementById('entityForm').dispatchEvent(new win.Event('submit', { cancelable: true })); await wait(120);
  console.log('12 package with no components is refused:', !(await win.DB.dbGetAll('products')).some(p => p.description === 'Empty one'));

  // ---- quotation: pick package ----
  const custId = await win.DB.dbAdd('customers', { customerNo: 'C1', companyName: 'KEYEC', status: 'Active', createdAt: new Date().toISOString() });
  // restore the original 3-component package for a clean numeric check
  p1.components = p1.components.slice(0, 3); p1.components[1] = Object.assign({}, p1.components[1]); await win.DB.dbPut('products', p1);
  const pk = await win.DB.dbGet('products', pkg.id);
  console.log('   (package components now:', pk.components.map(c => c.description).join(', '), ')');
  await go('#/quotations/new');
  let row = doc.querySelector('#linesBody tr');
  row.querySelector('.ln-catalog-btn').click(); await wait(20);
  const rowsInPicker = [...doc.querySelectorAll('.item-picker-row')];
  const target = rowsInPicker.find(r => /ITEM-P-0001/.test(r.textContent));
  console.log('13 picker lists the package with component count:', !!target && /component items/.test(target.textContent));
  target.click(); await wait(60);
  const trs = [...doc.querySelectorAll('#linesBody tr')];
  console.log('14 one click loads package line + 3 component lines:', trs.length === 4, trs.length);
  console.log('15 first column shows ITEM-P-0001 then its component numbers (-01/-03/-04 after the earlier delete):', trs.map(t => t.querySelector('.ln-catalog-btn').textContent.trim()).join('|') === 'ITEM-P-0001|ITEM-P-0001-01|ITEM-P-0001-03|ITEM-P-0001-04', trs.map(t => t.querySelector('.ln-catalog-btn').textContent.trim()).join('|'));
  console.log('16 components have no price; package line is the lot (qty 1, lot):', trs.slice(1).every(t => +t.querySelector('.ln-price').value === 0) && trs[0].querySelector('.ln-uom').value === 'lot');
  const rate = +trs[1].querySelector('.ln-rate').value;
  // suggested lot price: Pump A: landed (100 + 10)*rate*1.25 = x2 ; Valve B 50*rate*1.25 x4 ; Tools 30*rate*1.25 x1
  // components now: Pump A (2 pcs, cost 100 + freight 10/unit), Tools set (1 x 30), Extra 1 (cost 0)
  const expLot = Math.round(((110 * 2) + 30) * rate * 1.25 * 100) / 100;
  console.log('17 package lot price suggested = sum of components at markup:', near(+trs[0].querySelector('.ln-price').value, expLot), +trs[0].querySelector('.ln-price').value, expLot);
  // component qty change keeps price blank and freight follows (catalog rate)
  fire(trs[1].querySelector('.ln-qty'), '4'); await wait(30);
  const t1 = doc.querySelectorAll('#linesBody tr')[1];
  console.log('18 changing component qty keeps its price at 0 and freight rate follows (4 x 10 = 40):', +t1.querySelector('.ln-price').value === 0 && near(+t1.querySelector('.ln-freight').value, 40));
  // lot header: user types a price
  const h = doc.querySelectorAll('#linesBody tr')[0];
  fire(h.querySelector('.ln-price'), '50000'); await wait(20);
  console.log('19 typing own lot price is kept and "Use that" offered:', +doc.querySelectorAll('#linesBody tr')[0].querySelector('.ln-price').value === 50000 && !!doc.querySelectorAll('#linesBody tr')[0].querySelector('.ln-use-lot'));
  // save + totals + GP
  fire(doc.getElementById('f_customerId'), String(custId), 'change');
  doc.getElementById('qForm').dispatchEvent(new win.Event('submit', { cancelable: true })); await wait(180);
  const q = (await win.DB.dbGetAll('quotations'))[0];
  const qt = win.QuoteCalc.computeQuotationTotals(q);
  console.log('20 quotation total = lot price only (components add nothing):', near(q.grandTotal, 50000), q.grandTotal);
  const compCost = q.lines.slice(1).reduce((s, l) => s + win.QuoteCalc.computeLine(l, 'PHP').costTotal, 0);
  console.log('21 gross profit = lot price minus ALL component costs & freight:', near(qt.grossProfit, 50000 - compCost) && compCost > 0, qt.grossProfit, 50000 - compCost);
  console.log('22 saved lines keep their project roles:', q.lines[0].lotRole === 'header' && q.lines.slice(1).every(l => l.lotRole === 'component' && l.compNo));

  // print
  let printed = '';
  win.open = () => ({ document: { write: (h) => { printed = h; }, close: () => {} } });
  await win.Print.printQuotation(q, { companyName: 'KEYEC' });
  const prow = printed.split('<tr>').filter(r => /Pump A|Extra 1|Tools set|SHORR Project/.test(r));
  const cells = (r) => [...r.matchAll(/<td class="p-num">(.*?)<\/td>/g)].map(m => m[1]);
  console.log('23 print: lot line shows 50,000.00; component lines show blank price + amount:', /50,000\.00/.test(cells(prow[0])[1]) && prow.slice(1).every(r => cells(r)[1] === '' && cells(r)[3] === ''), prow.length);

  // reopen quotation for edit: roles persist and header suggestion renders
  await go('#/quotations/' + q.id + '/edit');
  const trs2 = [...doc.querySelectorAll('#linesBody tr')];
  console.log('24 reopened: component rows show "Included in lot price", header shows "Lot margin":', /In lot price/.test(trs2[1].querySelector('.ln-price-flag').innerHTML) && /Lot margin/.test(trs2[0].querySelector('.ln-margin').textContent), trs2[0].querySelector('.ln-margin').textContent);

  // delete protection: package used by a quotation
  await go('#/products/' + pkg.id, 100);
  const delBtn = [...doc.querySelectorAll('button')].find(b => /Delete/.test(b.textContent));
  let alerted = ''; win.alert = (m) => { alerted = m; };
  if (delBtn) { delBtn.click(); await wait(80); }
  console.log('25 deleting a package used on a quotation is blocked:', !!(await win.DB.dbGet('products', pkg.id)));
}
main().catch(e => { console.log('TEST FAILED', e); process.exit(1); });
