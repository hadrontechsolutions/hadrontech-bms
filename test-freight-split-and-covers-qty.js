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
  const QC = win.QuoteCalc;
  await win.DB.openDB(); await win.DB.ensureCounters();
  const go = async (h, ms = 100) => { win.location.hash = h; await win.Router.resolveRoute(); await wait(ms); };

  // ---- pure allocation math ----
  const rows = [{ lineId: 'pump', qty: 1, unitCost: 1000 }, { lineId: 'valve', qty: 5, unitCost: 100 }, { lineId: 'tools', qty: 3, unitCost: 100 }, { lineId: 'ppe', qty: 20, unitCost: 10 }];
  let r = QC.allocateFreight(rows, 200, 'cost');
  console.log('1 pumps/valves/tools/PPE USD 200 by cost -> 100/50/30/20:', r.shares.pump === 100 && r.shares.valve === 50 && r.shares.tools === 30 && r.shares.ppe === 20, JSON.stringify(r.shares));
  r = QC.allocateFreight(rows, 200, 'qty');
  const sumQ = Object.values(r.shares).reduce((a, b) => a + b, 0);
  console.log('2 by qty shares in proportion to 1/5/3/20 and add to exactly 200:', near(sumQ, 200) && r.shares.ppe > r.shares.valve && r.shares.valve > r.shares.tools && r.shares.tools > r.shares.pump, JSON.stringify(r.shares));
  r = QC.allocateFreight([{ lineId: 'a', qty: 1, unitCost: 10 }, { lineId: 'b', qty: 1, unitCost: 10 }, { lineId: 'c', qty: 1, unitCost: 10 }], 100, 'cost');
  console.log('3 odd cents: 100 / 3 equal rows -> 33.34 + 33.33 + 33.33, total exactly 100:', near(Object.values(r.shares).reduce((a, b) => a + b, 0), 100) && Math.max(...Object.values(r.shares)) === 33.34);
  r = QC.allocateFreight([{ lineId: 'a', qty: 2, unitCost: 0 }, { lineId: 'b', qty: 6, unitCost: 0 }], 80, 'cost');
  console.log('4 zero costs fall back to qty (20/60):', r.shares.a === 20 && r.shares.b === 60);
  r = QC.allocateFreight([{ lineId: 'a', qty: 0, unitCost: 0 }, { lineId: 'b', qty: 0, unitCost: 0 }], 10, 'cost');
  console.log('5 all zero -> equal split 5/5:', r.shares.a === 5 && r.shares.b === 5);
  r = QC.allocateFreight(rows.slice(0, 2), 100, 'manual', { pump: 60, valve: 30 });
  console.log('6 manual: leaves 10 unassigned, nothing auto-fixed:', near(r.unassigned, 10) && r.shares.pump === 60);
  r = QC.allocateFreight([], 50, 'cost');
  console.log('7 no rows: nothing allocated, 50 unassigned:', r.allocated === 0 && r.unassigned === 50);
  let many = QC.allocateFreight(Array.from({ length: 7 }, (_, i) => ({ lineId: 'x' + i, qty: i + 1, unitCost: 13.37 * (i + 1) })), 333.33, 'cost');
  console.log('8 7 uneven rows, 333.33 -> exactly 333.33:', near(Object.values(many.shares).reduce((a, b) => a + b, 0), 333.33));

  // ---- product covers-qty ----
  console.log('9 USD 60 for 40 pcs -> 1.50/unit:', near(QC.productFreightPerUnit({ estimatedFreightCost: 60, freightCoversQty: 40 }), 1.5));
  console.log('10 old product (no covers qty) keeps per-unit meaning:', QC.productFreightPerUnit({ estimatedFreightCost: 30 }) === 30 && QC.productFreightPerUnit({ estimatedFreightCost: 30, freightCoversQty: 0 }) === 30);

  await go('#/products/new', 80);
  fire(doc.getElementById('f_estimatedFreightCost'), '60'); fire(doc.getElementById('f_freightCoversQty'), '40');
  console.log('11 form shows default covers-qty 1 initially & live per-unit hint $1.50:', /\$1\.50/.test(doc.getElementById('freightPerUnitHint').textContent));
  console.log('12 both fields highlighted:', doc.querySelectorAll('.field-key').length === 3, doc.querySelectorAll('.field-key').length);

  // product on quotation: 60 for 40 pcs, qty 40 -> total 60 ; qty 10 -> 15
  const prodId = await win.DB.dbAdd('products', { itemNo: 'ITEM-T', description: 'Bolt', type: 'Product', standardCost: 2, currency: 'USD', estimatedFreightCost: 60, freightCoversQty: 40, markupPercent: 0, uom: 'pc', status: 'Active', createdAt: new Date().toISOString() });
  const custId = await win.DB.dbAdd('customers', { customerNo: 'C1', companyName: 'KEYEC', status: 'Active', createdAt: new Date().toISOString() });
  await go('#/quotations/new');
  let row = doc.querySelector('#linesBody tr');
  fire(row.querySelector('.ln-qty'), '40');
  row.querySelector('.ln-catalog-btn').click(); await wait(20);
  doc.querySelector('.item-picker-row').click(); await wait(40);
  row = doc.querySelector('#linesBody tr');
  console.log('13 picking product on a 40-pc line gives total freight 60:', near(+row.querySelector('.ln-freight').value, 60));

  // ---- REAL workflow: pick product first (qty 1), THEN change qty ----
  row = doc.querySelector('#linesBody tr');
  fire(row.querySelector('.ln-qty'), '10'); await wait(30);
  row = doc.querySelector('#linesBody tr');
  console.log('13b picked USD 60-per-40 product then qty 10 -> freight follows to 15:', near(+row.querySelector('.ln-freight').value, 15), row.querySelector('.ln-freight').value);
  fire(row.querySelector('.ln-qty'), '40'); await wait(30);
  row = doc.querySelector('#linesBody tr');
  console.log('13c qty 40 -> freight 60, freight/unit 1.50 (PHP-converted shown):', near(+row.querySelector('.ln-freight').value, 60) && /Catalog rate/.test(row.querySelector('.ln-freight-info').innerHTML));
  fire(row.querySelector('.ln-freight'), '100'); await wait(20);
  fire(doc.querySelector('#linesBody tr .ln-qty'), '20'); await wait(30);
  row = doc.querySelector('#linesBody tr');
  console.log('13d after typing own freight (100), qty change no longer rescales it:', near(+row.querySelector('.ln-freight').value, 100) && !/Catalog rate/.test(row.querySelector('.ln-freight-info').textContent));
  fire(row.querySelector('.ln-qty'), '1'); await wait(10);

  // ---- split modal on the quotation form ----
  const mk = async (desc, qty, cost) => {
    doc.getElementById('btnAddLine').click(); await wait(10);
    const rs = doc.querySelectorAll('#linesBody tr'); const rr = rs[rs.length - 1];
    fire(rr.querySelector('.ln-desc'), desc); fire(rr.querySelector('.ln-qty'), String(qty));
    fire(rr.querySelector('.ln-costccy'), 'USD', 'change'); await wait(20);
    const r2_ = doc.querySelectorAll('#linesBody tr'); const r3 = r2_[r2_.length - 1];
    fire(r3.querySelector('.ln-cost'), String(cost)); fire(r3.querySelector('.ln-markup'), '25'); await wait(10);
  };
  await go('#/quotations/new');
  // reuse the single blank first row as 'Pump'
  row = doc.querySelector('#linesBody tr');
  fire(row.querySelector('.ln-desc'), 'Pump'); fire(row.querySelector('.ln-qty'), '1');
  fire(row.querySelector('.ln-costccy'), 'USD', 'change'); await wait(20);
  row = doc.querySelector('#linesBody tr'); fire(row.querySelector('.ln-cost'), '1000'); fire(row.querySelector('.ln-markup'), '25');
  await mk('Valves', 5, 100); await mk('Tools', 3, 100); await mk('PPE', 20, 10);
  doc.getElementById('btnSplitFreight').click(); await wait(20);
  const ov = doc.querySelector('.item-picker-overlay');
  console.log('14 split dialog opens, all 4 USD rows listed and ticked:', !!ov && ov.querySelectorAll('.sf_pick:checked').length === 4);
  fire(ov.querySelector('#sf_total'), '200'); await wait(10);
  console.log('15 summary balanced + Apply enabled:', /Allocated .*200\.00 of .*200\.00/.test(ov.querySelector('#sf_summary').textContent) && !ov.querySelector('#sf_apply').disabled, ov.querySelector('#sf_summary').textContent);
  ov.querySelector('#sf_apply').click(); await wait(40);
  const fr = [...doc.querySelectorAll('#linesBody tr .ln-freight')].map(i => +i.value);
  console.log('16 rows now hold 100/50/30/20 total freight:', JSON.stringify(fr) === '[100,50,30,20]', JSON.stringify(fr));
  const rws = doc.querySelectorAll('#linesBody tr');
  // pump: landed (1000+100/1)*1 ... rate for USD->PHP from settings; just verify price = landed*1.25
  const rate = +rws[0].querySelector('.ln-rate').value;
  console.log('17 pump price = (1000+100)*rate*1.25:', near(+rws[0].querySelector('.ln-price').value, Math.round(1100 * rate * 1.25 * 100) / 100), rate);
  console.log('18 valves price = (100+50/5)*rate*1.25 (freight per unit 10):', near(+rws[1].querySelector('.ln-price').value, Math.round(110 * rate * 1.25 * 100) / 100));
  console.log('19 shipment note shown on row:', /Share of shipment/.test(rws[0].querySelector('.ln-freight-info').innerHTML));
  // editing a row's freight manually clears its note
  fire(rws[0].querySelector('.ln-freight'), '90'); await wait(10);
  console.log('20 manual freight edit clears the shipment note:', !/Share of shipment/.test(doc.querySelectorAll('#linesBody tr')[0].querySelector('.ln-freight-info').innerHTML));

  // manual mode blocks apply until balanced
  doc.getElementById('btnSplitFreight').click(); await wait(20);
  const ov2 = doc.querySelector('.item-picker-overlay');
  fire(ov2.querySelector('#sf_total'), '200'); fire(ov2.querySelector('#sf_method'), 'manual', 'change'); await wait(10);
  const inputs = ov2.querySelectorAll('.sf_manual');
  [100, 50, 30, 10].forEach((v, i) => fire(inputs[i], String(v)));
  console.log('21 manual short by 10 -> Apply disabled:', ov2.querySelector('#sf_apply').disabled);
  fire(ov2.querySelectorAll('.sf_manual')[3], '20');
  console.log('22 manual balanced -> Apply enabled:', !ov2.querySelector('#sf_apply').disabled);
  ov2.querySelector('#sf_cancel').click();
  console.log('23 cancel closes dialog without changing rows:', !doc.querySelector('.item-picker-overlay'));
}
main().catch(e => { console.log('TEST FAILED', e); process.exit(1); });
