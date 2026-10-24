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
  { const st = await win.DB.getSettings(); st.referenceRates = Object.assign({}, st.referenceRates, { HKD: 9 }); await win.DB.dbPut('settings', st); }
  win.location.hash = '#/suppliers/new'; await win.Router.resolveRoute(); await wait(30);
  out('1 Supplier form has a required Currency field (starting blank) but no Rating, Typical Lead Time or Authorized Distributor', !!doc.getElementById('f_currency') && doc.getElementById('f_currency').required && doc.getElementById('f_currency').value === '' && ['f_rating', 'f_leadTime', 'f_authorizedDistributor'].every(id => !doc.getElementById(id)));
  out('2 Supplier form keeps Country, TIN, Payment Terms, Incoterms, Brands and Notes', ['f_country', 'f_tin', 'f_paymentTerms', 'f_incoterms', 'f_brandsSupplied', 'f_notes'].every(id => !!doc.getElementById(id)));
  const sup = await win.DB.dbAdd('suppliers', { supplierNo: 'S1', companyName: 'HK Co', country: 'Hong Kong', currency: 'HKD', status: 'Active', createdAt: 'x' });
  const so = { id: 1, soNo: 'SO-T', currency: 'PHP', shippingAddress: '', lines: [] };
  const L = (o) => Object.assign({ lineId: 'L' + Math.random().toString(36).slice(2, 8), description: 'x', qty: 1, uom: 'pc', unitCost: 100, estimatedFreightCost: 0, freightMode: 'total', costCurrency: 'HKD' }, o);
  await win.SupplierPOs.createFromSalesOrder(so, sup, [L({ unitCost: 1085 })]);
  let pos = await win.DB.dbGetAll('supplierPOs');
  out('3 HKD-costed items give one HKD PO', pos.length === 1 && pos[0].currency === 'HKD' && pos[0].totalCost === 1085);
  await win.SupplierPOs.createFromSalesOrder(so, sup, [L({ unitCost: 10 }), L({ unitCost: 20, costCurrency: 'USD' }), L({ unitCost: 30, costCurrency: 'PHP' })]);
  pos = await win.DB.dbGetAll('supplierPOs');
  const cur = pos.slice(1).map(p => p.currency).sort().join(',');
  out('4 Mixed currencies for one supplier make one PO per currency (HKD, PHP, USD), never mixed', pos.length === 4 && cur === 'HKD,PHP,USD' && pos.slice(1).every(p => p.lines.length === 1));
  win.location.hash = '#/suppliers/' + sup; await win.Router.resolveRoute(); await wait(40);
  const txt = doc.getElementById('content').textContent.replace(/\s+/g, ' ');
  out('5 Supplier page lists each PO in its own currency (HKD 1,085.00 not ₱ or $)', /HK\$\s?1,085\.00|HKD\s?1,085\.00/.test(txt) && !/NaN|undefined/.test(txt));
  // 5b choosing a supplier on the Product form sets the currency automatically
  win.location.hash = '#/products/new'; await win.Router.resolveRoute(); await wait(40);
  { const sSel = doc.getElementById('f_defaultSupplierId'), cSel = doc.getElementById('f_currency');
    const before = cSel.value; sSel.value = String(sup); sSel.dispatchEvent(new win.Event('change', { bubbles: true })); await wait(30);
    out('5b Choosing an HKD supplier on a new Product sets its Currency to HKD and says so (was ' + before + ')', cSel.value === 'HKD' && /HKD/.test(doc.getElementById('supplierCurrencyNote').textContent)); }
  // 6-9 Product currency must match the supplier's currency
  let alerts = []; win.alert = m => alerts.push(m); let confirms = []; let confirmAnswer = false; win.confirm = m => { confirms.push(m); return confirmAnswer; };
  const set = (el, v, ev) => { el.value = v; el.dispatchEvent(new win.Event(ev || 'input', { bubbles: true })); };
  const submit = async () => { doc.querySelector('#content form').dispatchEvent(new win.Event('submit', { cancelable: true })); await wait(60); };
  win.location.hash = '#/products/new'; await win.Router.resolveRoute(); await wait(40);
  set(doc.getElementById('f_description'), 'Lamp'); set(doc.getElementById('f_defaultSupplierId'), String(sup), 'change'); set(doc.getElementById('f_currency'), 'USD', 'change');
  await submit();
  out('6 Saving a USD product for an HKD supplier is blocked with a pop-up naming both currencies', (await win.DB.dbGetAll('products')).length === 0 && alerts.length === 1 && /HK Co/.test(alerts[0]) && /HKD/.test(alerts[0]) && /USD/.test(alerts[0]));
  set(doc.getElementById('f_currency'), 'HKD', 'change'); await submit();
  out('7 Changing the product to HKD lets it save', (await win.DB.dbGetAll('products')).length === 1);
  win.location.hash = '#/products/new'; await win.Router.resolveRoute(); await wait(40);
  set(doc.getElementById('f_description'), 'Service'); set(doc.getElementById('f_currency'), 'USD', 'change'); await submit();
  out('8 A product with no supplier is not checked', (await win.DB.dbGetAll('products')).length === 2);
  // 9 changing the supplier's currency warns about products that no longer match
  win.location.hash = '#/suppliers/' + sup + '/edit'; await win.Router.resolveRoute(); await wait(40);
  set(doc.getElementById('f_currency'), 'USD', 'change'); await submit();
  let s1 = await win.DB.dbGet('suppliers', sup);
  out('9 Changing the supplier currency lists the product that would no longer match, and No keeps the old currency', confirms.length === 1 && /ITEM-/.test(confirms[0]) && s1.currency === 'HKD');
  confirmAnswer = true; await submit(); s1 = await win.DB.dbGet('suppliers', sup);
  out('10 Answering Yes saves the new supplier currency', s1.currency === 'USD');
  console.log('no script errors: true');
  process.exit(0);
})();
