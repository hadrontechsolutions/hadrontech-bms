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

  win.location.hash = '#/quotations/new';
  await win.Router.resolveRoute(); await wait(100);
  let row = doc.querySelector('#linesBody tr');
  fire(row.querySelector('.ln-desc'), 'Pump');
  fire(row.querySelector('.ln-qty'), '10');
  fire(row.querySelector('.ln-costccy'), 'USD', 'change'); await wait(30);
  row = doc.querySelector('#linesBody tr');
  fire(row.querySelector('.ln-rate'), '64');
  fire(row.querySelector('.ln-cost'), '100');
  fire(row.querySelector('.ln-markup'), '25');
  fire(row.querySelector('.ln-freight'), '80'); await wait(30);
  row = doc.querySelector('#linesBody tr');

  console.log('1 header renamed:', doc.querySelector('#linesBody').closest('table').textContent.includes('Total Freight for This Line'));
  console.log('2 qty10 price 8640:', near(+row.querySelector('.ln-price').value, 8640));
  const info = row.querySelector('.ln-freight-info').textContent;
  console.log('3 shows freight/unit and landed in PHP (8 USD x 64 = 512; 6,912):', /Freight\/unit: ₱512\.00/.test(info) && /Landed\/unit: ₱6,912\.00/.test(info) && !/\$/.test(info), info);

  fire(row.querySelector('.ln-qty'), '4'); await wait(30);
  row = doc.querySelector('#linesBody tr');
  console.log('4 qty4 price 9600:', near(+row.querySelector('.ln-price').value, 9600));
  console.log('5 total freight unchanged 80:', +row.querySelector('.ln-freight').value === 80);
  const info4 = row.querySelector('.ln-freight-info').innerHTML;
  console.log('6 qty4 freight/unit PHP 1,280 (20 USD x 64) & landed 7,680:', /₱1,280\.00/.test(info4) && /7,680\.00/.test(info4));
  console.log('7 reminder shown after qty change:', /reconfirm supplier pricing and total freight/.test(info4));

  // cost total: (100*4+80)*64 = 30,720
  const t = win.QuoteCalc.computeLine({ qty: 4, unitCost: 100, estimatedFreightCost: 80, freightMode: 'total', costCurrency: 'USD', costExchangeRate: 64, unitPrice: 9600 }, 'PHP');
  console.log('8 line cost total 30,720:', near(t.costTotal, 30720));
  const t10 = win.QuoteCalc.computeLine({ qty: 10, unitCost: 100, estimatedFreightCost: 80, freightMode: 'total', costCurrency: 'USD', costExchangeRate: 64, unitPrice: 8640 }, 'PHP');
  console.log('9 qty10 total cost 69,120 (allocated freight USD 80 both ways):', near(t10.costTotal, 69120));

  // manual override preserved + flagged
  fire(row.querySelector('.ln-price'), '9000'); await wait(20);
  fire(doc.querySelector('#linesBody tr .ln-qty'), '5'); await wait(30);
  row = doc.querySelector('#linesBody tr');
  console.log('10 manual price preserved on qty change:', +row.querySelector('.ln-price').value === 9000);
  console.log('11 flagged for review w/ calculated shown:', /Manual price/.test(row.querySelector('.ln-price-info').textContent) && /Calculated/.test(row.querySelector('.ln-price-info').textContent));
  { const fb = row.querySelector('.ln-flag-btn'); fb.click(); await wait(10);
    const pop = doc.querySelector('.ln-info-popup');
    console.log('11b "!" button shown; its popup holds the text and the Use calculated button; row has no long text:', fb.style.display !== 'none' && !!pop && /Manual price/.test(pop.textContent) && !!pop.querySelector('.ln-use-calc') && row.querySelector('.ln-price-flag').textContent.trim() === '');
    pop.querySelector('.ln-use-calc').click(); await wait(30); }
  row = doc.querySelector('#linesBody tr');
  // qty5: freight/unit 16, landed (116)*64=7424, *1.25=9280
  console.log('12 Use calculated -> 9280:', near(+row.querySelector('.ln-price').value, 9280));

  // div by zero
  fire(row.querySelector('.ln-qty'), '0'); await wait(30);
  row = doc.querySelector('#linesBody tr');
  console.log('13 qty 0 no NaN/Infinity:', !/NaN|Infinity/.test(doc.getElementById('content').textContent) && isFinite(+row.querySelector('.ln-price').value));

  // header freight double-charge warning
  fire(row.querySelector('.ln-qty'), '5'); await wait(20);
  fire(doc.getElementById('f_freightCharge'), '500'); await wait(20);
  console.log('14 no note under the Freight / Shipping Charge box:', doc.getElementById('freightInfo').textContent.trim() === '');

  // legacy line: preserved, flagged, explicit conversion
  const legacy = { lineId: 'LG', qty: 10, uom: 'pc', unitCost: 100, costCurrency: 'USD', costExchangeRate: 64, estimatedFreightCost: 8, markupPercent: 25, unitPrice: 8512, discountPercent: 0, vatRate: 0, description: 'Old', brand: '', modelNo: '' };
  const lc = win.QuoteCalc.computeLine(legacy, 'PHP');
  console.log('15 legacy line cost unchanged (10*(6400+512)=69,120):', near(lc.costTotal, 69120));
  const q = { quotationNo: 'HT-Q-OLD', customerId: custId, currency: 'PHP', vatMode: 'NonVat', status: 'Draft', isLatest: true, lines: [legacy], createdAt: new Date().toISOString(), validUntil: '2099-01-01' };
  const id = await win.DB.dbAdd('quotations', q);
  win.location.hash = '#/quotations/' + id + '/edit';
  await win.Router.resolveRoute(); await wait(100);
  row = doc.querySelector('#linesBody tr');
  console.log('16 legacy flagged for review, not reinterpreted:', /review/i.test(row.querySelector('.ln-freight-info').textContent) && +row.querySelector('.ln-freight').value === 8 && +row.querySelector('.ln-price').value === 8512);
  row.querySelector('.ln-convert-freight').click(); await wait(30);
  row = doc.querySelector('#linesBody tr');
  console.log('17 convert -> total 80, price kept 8512, cost same:', +row.querySelector('.ln-freight').value === 80 && +row.querySelector('.ln-price').value === 8512 && near(win.QuoteCalc.computeLine(Object.assign({}, legacy, { estimatedFreightCost: 80, freightMode: 'total' }), 'PHP').costTotal, 69120));
  win.location.hash = '#/products/new'; await win.Router.resolveRoute(); await wait(60);
  const keyLabels = [...doc.querySelectorAll('.field-key label')].map(l => l.textContent.trim());
  console.log('18 Products form highlights Est. Freight, Freight Covers Qty + Standard Cost only:', keyLabels.length === 3 && keyLabels.some(l => /Estimated Freight Cost/.test(l)) && keyLabels.some(l => /Freight Covers Qty/.test(l)) && keyLabels.some(l => /Standard Cost/.test(l)), keyLabels);
}
main().catch(e => { console.log('TEST FAILED', e); process.exit(1); });
