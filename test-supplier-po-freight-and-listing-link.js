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
  const near = (a, b) => Math.abs(a - b) < 0.005;
  const go = async (h, ms = 120) => { win.location.hash = h; await win.Router.resolveRoute(); await wait(ms); };
  await win.DB.openDB(); await win.DB.ensureCounters();
  const now = new Date().toISOString();
  const supPhp = await win.DB.dbAdd('suppliers', { supplierNo: 'S1', companyName: 'DataBltiz', currency: 'PHP', status: 'Active', createdAt: now });
  const supUsd = await win.DB.dbAdd('suppliers', { supplierNo: 'S2', companyName: 'Overseas', currency: 'USD', status: 'Active', createdAt: now });
  const pHdmi = await win.DB.dbAdd('products', { itemNo: 'ITEM-00049', type: 'Product', description: 'HDMI cable', status: 'Active', createdAt: now, supplierListingUrl: 'https://shop.example.com/hdmi' });
  const pBad = await win.DB.dbAdd('products', { itemNo: 'ITEM-00050', type: 'Product', description: 'Bad link', status: 'Active', createdAt: now, supplierListingUrl: 'javascript:alert(1)' });
  const pNone = await win.DB.dbAdd('products', { itemNo: 'ITEM-00051', type: 'Product', description: 'No link', status: 'Active', createdAt: now });
  const so = { soNo: 'HT-SO-T1', currency: 'PHP', shippingAddress: '', lines: [] };
  const L = (o) => Object.assign({ lineId: 'L' + Math.random().toString(36).slice(2, 8), description: 'x', qty: 1, uom: 'pc', unitCost: 100, estimatedFreightCost: 0, freightMode: 'total', costCurrency: 'PHP' }, o);
  const mk = async (supId, lines) => { await win.SupplierPOs.createFromSalesOrder(so, supId, lines); const all = await win.DB.dbGetAll('supplierPOs'); return all[all.length - 1]; };

  // 1 total-mode freight: 2 lines, 100 + 50 = 150 on PHP supplier
  let po = await mk(supPhp, [L({ itemId: pHdmi, description: 'HDMI', qty: 2, unitCost: 849, estimatedFreightCost: 100 }), L({ description: 'B', estimatedFreightCost: 50 })]);
  console.log('1 PO freight pre-filled = total freight of the lines (150) and included in total:', near(po.freight, 150) && near(po.totalCost, 849 * 2 + 100 + 150), po.freight, po.totalCost);
  // 2 old per-unit freight line: 10/unit x qty 3 = 30
  po = await mk(supPhp, [L({ qty: 3, estimatedFreightCost: 10, freightMode: undefined })]);
  console.log('2 old per-unit freight line counts qty x per-unit (30):', near(po.freight, 30));
  // 3 other-currency line not guessed
  po = await mk(supPhp, [L({ estimatedFreightCost: 5, costCurrency: 'USD' }), L({ estimatedFreightCost: 20 })]);
  console.log('3 USD-cost freight on a PHP supplier is not converted (only 20 added) and is reported:', near(po.freight, 20) && po.freightSkippedLines === 1);
  // 4 no freight -> 0, same as before
  po = await mk(supPhp, [L({})]);
  console.log('4 lines without freight give freight 0:', po.freight === 0 && near(po.totalCost, 100));

  // 5 detail page link + hint after hand-editing freight to the real 79
  po = await mk(supPhp, [L({ itemId: pHdmi, description: 'HDMI', unitCost: 849, estimatedFreightCost: 100 }), L({ itemId: pBad, description: 'BadLinkItem' }), L({ itemId: pNone, description: 'NoLinkItem' })]);
  await go('#/supplier-pos/' + po.id);
  let links = [...doc.querySelectorAll('#content a.spo-listing-link')];
  console.log('5 detail: one "Open listing" link, opens in new tab safely, only for the https item:', links.length === 1 && links[0].getAttribute('href') === 'https://shop.example.com/hdmi' && links[0].target === '_blank' && /noopener/.test(links[0].rel));
  const rowTxt = (t) => [...doc.querySelectorAll('#content tbody tr')].find(r => r.textContent.includes(t));
  console.log('6 javascript: URL and missing URL show no link:', !rowTxt('BadLinkItem').querySelector('a') && !rowTxt('NoLinkItem').querySelector('a'));
  console.log('7 detail shows Freight 100 and no hint when it matches the estimate:', /₱100\.00/.test(doc.querySelector('.totals').textContent) && !/Quotation estimate/.test(doc.querySelector('.totals').textContent));
  doc.getElementById('btnEditHeader').click(); await wait(80);
  const editLinks = [...doc.querySelectorAll('#content a.spo-listing-link')];
  console.log('8 edit page also shows the listing link:', editLinks.length === 1);
  const fr = doc.getElementById('f_freight'); fr.value = '79'; fr.dispatchEvent(new win.Event('input'));
  doc.getElementById('spoForm').dispatchEvent(new win.Event('submit', { cancelable: true })); await wait(150);
  const saved = await win.DB.dbGet('supplierPOs', po.id);
  console.log('9 hand-edited freight 79 is kept and total recalculated (849+100+100+79=1128):', near(saved.freight, 79) && near(saved.totalCost, 1128), saved.freight, saved.totalCost);
  await go('#/supplier-pos/' + po.id);
  console.log('10 detail now shows "Quotation estimate: ₱100.00" next to the real ₱79:', /Quotation estimate: ₱100\.00/.test(doc.querySelector('.totals').textContent) && /₱79\.00/.test(doc.querySelector('.totals').textContent));
  const edit2 = await win.DB.dbGet('supplierPOs', po.id);
  console.log('11 payment/balance still computed from the new total:', near(win.SupplierPOs.spoBalanceDue(edit2), edit2.totalCost));
}
main().catch(e => { console.log('TEST FAILED', e); process.exit(1); });
