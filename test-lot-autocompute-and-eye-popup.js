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
  await win.DB.dbAdd('products', { itemNo: 'ITEM-P-0001', type: 'Project Package', description: 'Proj', status: 'Active', createdAt: new Date().toISOString(), nextCompSeq: 3,
    components: [
      { compNo: 'ITEM-P-0001-01', description: 'item 1', qty: 11, uom: 'pc', unitCost: 55, costCurrency: 'USD', estimatedFreightCost: 0, freightCoversQty: 1, markupPercent: 0 },
      { compNo: 'ITEM-P-0001-02', description: 'item 2', qty: 20, uom: 'pc', unitCost: 88, costCurrency: 'USD', estimatedFreightCost: 0, freightCoversQty: 1, markupPercent: 0 }] });
  const custId = await win.DB.dbAdd('customers', { customerNo: 'C1', companyName: 'X', status: 'Active', createdAt: new Date().toISOString() });
  await go('#/quotations/new');
  doc.querySelector('.ln-catalog-btn').click(); await wait(20);
  [...doc.querySelectorAll('.item-picker-row')].find(r => /ITEM-P-0001/.test(r.textContent)).click(); await wait(60);
  // New quotations no longer get a package lot line, so this test builds an OLDER quotation (lot line + blank components)
  // and opens it, to prove the legacy lot-line behaviour keeps working.
  fire(doc.getElementById('f_customerId'), String(custId), 'change');
  doc.getElementById('qForm').dispatchEvent(new win.Event('submit', { cancelable: true })); await wait(180);
  const q0 = (await win.DB.dbGetAll('quotations'))[0];
  const hdr = { ...q0.lines[0], lineId: 'legacy-hdr', lotRole: 'header', compNo: undefined, description: 'Proj', qty: 1, uom: 'lot', unitCost: 0, markupPercent: 0, unitPrice: 0, priceOverridden: false, supplierId: '', costCurrency: q0.currency, costExchangeRate: 1 };
  q0.lines = [hdr, ...q0.lines.map(l => ({ ...l, lotRole: 'component', unitPrice: 0, priceOverridden: false }))];
  await win.DB.dbPut('quotations', q0);
  await go('#/quotations/' + q0.id + '/edit', 150);
  const price = (i) => +doc.querySelectorAll('#linesBody tr')[i].querySelector('.ln-price').value;
  const rate = +doc.querySelectorAll('#linesBody tr')[1].querySelector('.ln-rate').value;
  // components: 11 x 55 x rate + 20 x 88 x rate
  console.log('1 lot price starts as sum of components:', near(price(0), Math.round((11 * 55 + 20 * 88) * rate * 100) / 100), price(0));

  // edit a component's unit cost -> lot price updates by itself
  let rows = doc.querySelectorAll('#linesBody tr');
  fire(rows[1].querySelector('.ln-cost'), '60'); await wait(30);
  console.log('2 editing a component cost updates the lot price automatically:', near(price(0), Math.round((11 * 60 + 20 * 88) * rate * 100) / 100), price(0));
  rows = doc.querySelectorAll('#linesBody tr');
  fire(rows[2].querySelector('.ln-markup'), '10'); await wait(30);
  console.log('3 editing a component markup updates it too:', near(price(0), Math.round(((11 * 60) * rate + (20 * 88) * rate * 1.10) * 100) / 100), price(0));
  rows = doc.querySelectorAll('#linesBody tr');
  fire(rows[2].querySelector('.ln-qty'), '10'); await wait(30);
  console.log('4 editing a component qty updates it too:', near(price(0), Math.round(((11 * 60) * rate + (10 * 88) * rate * 1.10) * 100) / 100), price(0));
  const amt = doc.querySelectorAll('#linesBody tr')[0].querySelector('.ln-amount').textContent;
  console.log('5 lot line Amount cell follows the new price:', amt.replace(/[^0-9.]/g, '').replace(/,/g, '') === price(0).toFixed(2).replace(/,/g, ''), amt);

  // the lot line's own cost + markup (like the 55 / 35% typed in the screenshot) count too
  const before = price(0);
  rows = doc.querySelectorAll('#linesBody tr');
  fire(rows[0].querySelector('.ln-cost'), '55'); fire(doc.querySelectorAll('#linesBody tr')[0].querySelector('.ln-markup'), '35'); await wait(30);
  console.log('6 cost 55 + markup 35% typed on the lot line itself adds 74.25:', near(price(0), Math.round((before + 55 * 1.35) * 100) / 100), price(0), before + 74.25);

  // typed lot price is kept; components keep changing underneath; Use that returns to automatic
  fire(doc.querySelectorAll('#linesBody tr')[0].querySelector('.ln-price'), '99999'); await wait(20);
  fire(doc.querySelectorAll('#linesBody tr')[1].querySelector('.ln-cost'), '70'); await wait(30);
  console.log('7 a typed lot price is kept when components change:', price(0) === 99999);
  const useBtn = doc.querySelectorAll('#linesBody tr')[0].querySelector('.ln-use-lot');
  console.log('8 "Use that" offered:', !!useBtn);
  useBtn.click(); await wait(30);
  console.log('9 after "Use that" it follows components again:', near(price(0), Math.round(((11 * 70) * rate + (10 * 88) * rate * 1.10 + 55 * 1.35) * 100) / 100), price(0));
  fire(doc.querySelectorAll('#linesBody tr')[1].querySelector('.ln-cost'), '71'); await wait(30);
  console.log('10 and keeps following afterwards:', price(0) > 0 && near(price(0), Math.round(((11 * 71) * rate + (10 * 88) * rate * 1.10 + 55 * 1.35) * 100) / 100), price(0));

  // totals reflect the lot line
  const totalText = doc.getElementById('totalsBox').textContent.replace(/,/g, '');
  console.log('11 quotation Subtotal matches the lot price:', totalText.includes(price(0).toFixed(2)), totalText.slice(0, 60));

  // ---- eye icon popup ----
  rows = doc.querySelectorAll('#linesBody tr');
  const eye = rows[1].querySelector('.ln-info-btn');
  console.log('12 each line has an eye button and the old text under Total Freight is hidden:', !!eye && rows[1].querySelector('.ln-freight-info').style.display === 'none');
  eye.click(); await wait(20);
  const pop = doc.querySelector('.ln-info-popup');
  console.log('13 clicking the eye opens a popup with Freight/unit + Landed/unit:', !!pop && /Freight\/unit/.test(pop.textContent) && /Landed\/unit/.test(pop.textContent));
  doc.body.click(); await wait(20);
  console.log('14 clicking elsewhere closes it:', !doc.querySelector('.ln-info-popup'));
  fire(doc.querySelectorAll('#linesBody tr')[1].querySelector('.ln-qty'), '12'); await wait(30);
  const eye2 = doc.querySelectorAll('#linesBody tr')[1].querySelector('.ln-info-btn');
  console.log('15 qty change puts an orange attention dot on the eye:', eye2.classList.contains('needs-attention'));
  eye2.click(); await wait(20);
  console.log('16 popup then carries the reconfirm reminder:', /reconfirm supplier pricing and total freight/.test(doc.querySelector('.ln-info-popup').textContent));
  doc.body.click(); await wait(20);
  // legacy line: convert button works from the popup
  const q = { quotationNo: 'HT-Q-OLD', currency: 'PHP', vatMode: 'NonVat', status: 'Draft', isLatest: true, createdAt: new Date().toISOString(), validUntil: '2099-01-01',
    customerId: await win.DB.dbAdd('customers', { customerNo: 'C9', companyName: 'X', status: 'Active', createdAt: new Date().toISOString() }),
    lines: [{ lineId: 'LG', qty: 10, uom: 'pc', unitCost: 100, costCurrency: 'USD', costExchangeRate: 64, estimatedFreightCost: 8, markupPercent: 25, unitPrice: 8512, discountPercent: 0, vatRate: 0, description: 'Old', brand: '', modelNo: '' }] };
  const id = await win.DB.dbAdd('quotations', q);
  await go('#/quotations/' + id + '/edit', 120);
  const lrow = doc.querySelector('#linesBody tr');
  console.log('17 old per-unit line shows the attention dot:', lrow.querySelector('.ln-info-btn').classList.contains('needs-attention'));
  lrow.querySelector('.ln-info-btn').click(); await wait(20);
  const conv = doc.querySelector('.ln-info-popup .ln-convert-freight');
  console.log('18 popup offers "Convert to line total":', !!conv);
  conv.click(); await wait(40);
  const lrow2 = doc.querySelector('#linesBody tr');
  console.log('19 converting from the popup: freight becomes 80, price kept 8512, dot gone:', +lrow2.querySelector('.ln-freight').value === 80 && +lrow2.querySelector('.ln-price').value === 8512 && !lrow2.querySelector('.ln-info-btn').classList.contains('needs-attention'));
}
main().catch(e => { console.log('TEST FAILED', e); process.exit(1); });
