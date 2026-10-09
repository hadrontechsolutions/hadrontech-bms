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
  await win.DB.openDB(); await win.DB.ensureCounters();
  // Build a backup that predates Project Packages: counters without 'projectPackage'
  const counters = (await win.DB.dbGetAll('counters')).filter(c => c.name !== 'projectPackage');
  const data = {}; for (const s of win.BACKUP_STORES || []) data[s] = [];
  data.counters = counters;
  const payload = JSON.stringify({ backupDate: new Date().toISOString(), data });
  await win.processRestoreFile({ text: async () => payload });
  await wait(100);
  const has = await win.DB.dbGet('counters', 'projectPackage');
  console.log('1 restoring an old backup still leaves a Project Package counter:', !!has && has.next === 1);
  win.location.hash = '#/products/new'; await win.Router.resolveRoute(); await wait(80);
  const t = doc.getElementById('f_type'); t.value = 'Project Package'; t.dispatchEvent(new win.Event('change'));
  doc.getElementById('f_description').value = 'After restore';
  doc.querySelector('#pkgEditor [data-k="description"]').value = 'Part'; doc.querySelector('#pkgEditor [data-k="description"]').dispatchEvent(new win.Event('input'));
  doc.getElementById('entityForm').dispatchEvent(new win.Event('submit', { cancelable: true })); await wait(150);
  const pk = (await win.DB.dbGetAll('products'))[0];
  console.log('2 package can be created after the restore (ITEM-P-0001 / -01):', !!pk && pk.itemNo === 'ITEM-P-0001' && pk.components[0].compNo === 'ITEM-P-0001-01', pk && pk.itemNo);
}
main().catch(e => { console.log('TEST FAILED', e); process.exit(1); });
