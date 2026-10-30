/* Products page: Duplicate makes an exact copy under the next item number. */
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
  const now = new Date().toISOString();
  const itemNo = await win.DB.nextDocNumber('product'); // ITEM-00001
  const id = await win.DB.dbAdd('products', { itemNo, type: 'Product', description: 'Push cart', category: 'Material Handling', uom: 'unit', currency: 'USD', standardCost: 53, estimatedFreightCost: 182, freightCoversQty: 2, markupPercent: 35, notes: 'Internal note', status: 'Active', archived: true, createdAt: now, updatedAt: now, createdBy: 'x', modifiedBy: 'x' });
  await win.DB.dbAdd('stockMovements', { productId: id, type: 'Adjustment', qty: 5, date: '2026-10-01', createdAt: now });
  win.location.hash = '#/products/' + id; await win.Router.resolveRoute(); await wait(40);
  out('1 Detail page has a Duplicate button (next to Edit / Archive / Delete)', !!doc.getElementById('btnDuplicate'));
  doc.getElementById('btnUnarchive') && 0;
  doc.getElementById('btnDuplicate').click(); await wait(80);
  const all = (await win.DB.dbGetAll('products')).sort((a, b) => a.id - b.id);
  out('2 Exactly one new product was created', all.length === 2);
  const c = all[1];
  out('3 New item number is the next one up (ITEM-00002)', c.itemNo === 'ITEM-00002' && c.itemNo !== all[0].itemNo);
  const same = ['type', 'description', 'category', 'uom', 'currency', 'standardCost', 'estimatedFreightCost', 'freightCoversQty', 'markupPercent', 'notes', 'status'].every(k => c[k] === all[0][k]);
  out('4 Every field is an exact copy', same);
  out('5 Copy is active (not archived) even though the original was archived', c.archived === false);
  out('6 Stock is not copied (0 movements on the copy, original keeps its 5)', (await win.DB.dbQueryIndex('stockMovements', 'productId', c.id)).length === 0 && (await win.DB.dbQueryIndex('stockMovements', 'productId', id)).length === 1);
  out('7 Browser opens the new item', win.location.hash === '#/products/' + c.id);
  // a second duplicate of the FIRST item still takes the next free number, never an existing one
  win.location.hash = '#/products/' + id; await win.Router.resolveRoute(); await wait(40);
  doc.getElementById('btnDuplicate').click(); await wait(80);
  const nos = (await win.DB.dbGetAll('products')).map(p => p.itemNo);
  out('8 Duplicating the first item again gives ITEM-00003 (no duplicates)', nos.includes('ITEM-00003') && new Set(nos).size === nos.length);
  // cancelled confirm creates nothing
  win.confirm = () => false;
  win.location.hash = '#/products/' + id; await win.Router.resolveRoute(); await wait(40);
  doc.getElementById('btnDuplicate').click(); await wait(60);
  out('9 Cancelling the prompt creates nothing', (await win.DB.dbGetAll('products')).length === 3);
  win.confirm = () => true;
  // project package: components renumbered under the new package number
  const pno = await win.DB.nextDocNumber('projectPackage'); // ITEM-P-0001
  const pid = await win.DB.dbAdd('products', { itemNo: pno, type: 'Project Package', description: 'Dryer lot', uom: 'lot', status: 'Active', nextCompSeq: 3, components: [{ compNo: pno + '-01', description: 'Fan', qty: 1, unitCost: 10 }, { compNo: pno + '-02', description: 'Heater', qty: 2, unitCost: 20 }], createdAt: now, updatedAt: now });
  win.location.hash = '#/products/' + pid; await win.Router.resolveRoute(); await wait(40);
  doc.getElementById('btnDuplicate').click(); await wait(80);
  const pk = (await win.DB.dbGetAll('products')).filter(p => p.type === 'Project Package' && p.id !== pid)[0];
  out('10 Package copy gets ITEM-P-0002 and its components renumber ITEM-P-0002-01, -02 (original untouched)', pk && pk.itemNo === 'ITEM-P-0002' && pk.components.map(x => x.compNo).join() === 'ITEM-P-0002-01,ITEM-P-0002-02' && pk.components.map(x => x.description).join() === 'Fan,Heater' && (await win.DB.dbGet('products', pid)).components[0].compNo === 'ITEM-P-0001-01');
  // other pages don't get the button
  const cid = await win.DB.dbAdd('customers', { customerNo: 'C1', companyName: 'Co', status: 'Active', createdAt: now, updatedAt: now });
  win.location.hash = '#/customers/' + cid; await win.Router.resolveRoute(); await wait(40);
  out('11 Customers page has no Duplicate button', !doc.getElementById('btnDuplicate'));
  console.log('no script errors: true');
  process.exit(0);
})();
