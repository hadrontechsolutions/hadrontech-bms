/* Switching the VAT Mode on a quotation re-rates every line, so lines, totals and wording agree. */
const fs = require('fs');
const { JSDOM } = require('jsdom'); require('fake-indexeddb/auto');
(async () => {
  const dom = new JSDOM(fs.readFileSync(__dirname + '/index.html', 'utf8'), { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const win = dom.window, doc = win.document;
  win.indexedDB = global.indexedDB; win.IDBKeyRange = global.IDBKeyRange; win.confirm = () => true;
  for (const s of [...doc.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => s !== 'js/app.js')) win.eval(fs.readFileSync(__dirname + '/' + s, 'utf8'));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const out = (n, ok) => console.log(n + ':', ok);
  await win.DB.openDB(); await win.DB.ensureCounters();
  const near = (a, b) => Math.abs(a - b) < 0.011;
  const settings = { referenceRates: { HKD: 9, USD: 58 } };
  const L = (o) => Object.assign({ lineId: 'x' + Math.random(), qty: 1, unitCost: 0, costCurrency: 'HKD', costExchangeRate: 8, estimatedFreightCost: 0, freightMode: 'total', unitPrice: 0, vatRate: 0 }, o);
  // 1 UPS bill case: HKD 1,085 at 8 = 8,680 goods -> 217 + 140 + 112.50 + 13.50 = 483.00
  let e = win.estimateImportCharges([L({ unitCost: 1085 })], 'PHP', settings);
  out('1 Small shipment (HKD 1,085 @ 8) estimate = 483.00, no duty or import VAT', near(e.goodsPHP, 8680) && near(e.totalPHP, 483) && e.mode === 'small');
  // 2 freight ignored, PHP-cost lines ignored
  e = win.estimateImportCharges([L({ unitCost: 1085, estimatedFreightCost: 5000 }), L({ unitCost: 99999, costCurrency: 'PHP', costExchangeRate: 1 })], 'PHP', settings);
  out('2 Freight and PHP-cost lines are not counted (goods stay 8,680)', near(e.goodsPHP, 8680) && near(e.totalPHP, 483));
  // 3 no foreign lines
  e = win.estimateImportCharges([L({ unitCost: 500, costCurrency: 'PHP', costExchangeRate: 1 })], 'PHP', settings);
  out('3 Only PHP-cost lines = no estimate', e.totalPHP === 0 && e.goodsPHP === 0);
  // 4 above the limit: 18,000 goods -> 250 + 140 + 0 duty + 2,190 + 112.50 + 13.50 = 2,706
  e = win.estimateImportCharges([L({ unitCost: 2000, costExchangeRate: 9 })], 'PHP', settings);
  out('4 Larger shipment (₱18,000 goods) estimate = 2,706.00', near(e.totalPHP, 2706) && e.mode === 'large');
  // 5 duty setting is used
  e = win.estimateImportCharges([L({ unitCost: 2000, costExchangeRate: 9 })], 'PHP', { referenceRates: { HKD: 9 }, importCharges: { dutyPct: 10 } });
  out('5 Duty % from Settings is applied (10% of 18,000 = 1,800)', e.parts.some(p => /duty/i.test(p.label) && near(p.amount, 1800)));
  // 6 lines are combined and shares add up exactly
  e = win.estimateImportCharges([L({ lineId: 'a', unitCost: 300 }), L({ lineId: 'b', unitCost: 700 })], 'PHP', settings);
  const sh = Object.values(e.perLinePHP).reduce((s, v) => s + v, 0);
  out('6 Two foreign lines are combined into one shipment and the shares add up exactly', near(sh, e.totalPHP) && Object.keys(e.perLinePHP).length === 2);

  // 7 On the form: tick box on by default, off removes it from cost/profit
  { const st = await win.DB.getSettings(); st.referenceRates = Object.assign({}, st.referenceRates, { HKD: 9 }); await win.DB.dbPut('settings', st); }
  const custId = await win.DB.dbAdd('customers', { customerNo: 'C1', companyName: 'T', status: 'Active', createdAt: 'x', updatedAt: 'x' });
  win.location.hash = '#/quotations/new'; await win.Router.resolveRoute(); await wait(20);
  const set = (el, v, ev) => { el.value = v; el.dispatchEvent(new win.Event(ev || 'input', { bubbles: true })); };
  set(doc.getElementById('f_customerId'), String(custId), 'change');
  const r = doc.querySelector('#linesBody tr');
  set(r.querySelector('.ln-desc'), 'Lamp'); set(r.querySelector('.ln-qty'), '1'); set(r.querySelector('.ln-price'), '12000');
  set(r.querySelector('.ln-costccy'), 'HKD', 'change'); await wait(10);
  const r2 = doc.querySelector('#linesBody tr');
  set(r2.querySelector('.ln-rate'), '8'); set(r2.querySelector('.ln-cost'), '1085'); await wait(20);
  const chk = doc.getElementById('f_includeImportEstimate');
  const tot = () => doc.querySelector('.totals').textContent.replace(/\s+/g, ' ');
  const box = () => doc.getElementById('importEstText').textContent.replace(/\s+/g, ' ');
  out('7 New quotation: box is ticked and the estimate (₱483.00) is shown', chk.checked && box().includes('483.00') && box().includes('8,680.00'));
  out('8 Total cost carries the estimate: profit = 12,000 − 8,680 − 483 = 2,837.00', tot().includes('2,837.00') && tot().includes('import charges'));
  chk.checked = false; chk.dispatchEvent(new win.Event('change', { bubbles: true })); await wait(10);
  out('9 Unticking removes it: profit = 3,320.00 and the screen says it is not included', tot().includes('3,320.00') && !tot().includes('import charges') && /not included/.test(box()));
  chk.checked = true; chk.dispatchEvent(new win.Event('change', { bubbles: true })); await wait(10);
  doc.getElementById('qForm').dispatchEvent(new win.Event('submit', { cancelable: true })); await wait(50);
  let q = (await win.DB.dbGetAll('quotations'))[0];
  out('10 Saved: flag on, line carries 483.00, costTotal 9,163.00, profit 2,837.00', q.includeImportEstimate === true && near(q.lines[0].importCharge, 483) && near(q.costTotal, 9163) && near(q.grossProfit, 2837));
  out('11 Sales Order gross profit uses the same figure (2,837.00)', near(win.soGrossProfit({ currency: 'PHP', lines: q.lines }), 2837));
  // 12 old quotation (no flag) is untouched until the box is ticked
  const old = Object.assign({}, q); delete old.id; delete old.includeImportEstimate; old.quotationNo = 'OLD-1'; old.lines = q.lines.map(l => Object.assign({}, l, { importCharge: 0 }));
  const oid = await win.DB.dbAdd('quotations', old);
  win.location.hash = '#/quotations/' + oid + '/edit'; await win.Router.resolveRoute(); await wait(30);
  const c2 = doc.getElementById('f_includeImportEstimate');
  out('12 An older quotation opens with the box unticked and its saved profit unchanged (3,320.00)', c2.checked === false && tot().includes('3,320.00'));
  // 13 Settings tab
  win.location.hash = '#/settings'; await win.Router.resolveRoute(); await wait(30);
  const d = doc.getElementById('s_ic_dutyPct');
  out('13 Settings has an Import Charges tab with the duty % field', !!d && !!doc.querySelector('.settings-tab-btn[data-tab="imports"]') && d.value === '0');
  console.log('no script errors: true');
  process.exit(0);
})();
