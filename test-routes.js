const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
require('fake-indexeddb/auto');

const APP = __dirname;

async function main() {
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  window.indexedDB = global.indexedDB;
  window.IDBKeyRange = global.IDBKeyRange;
  window.confirm = () => true;
  window.open = () => ({ document: { write: () => {}, close: () => {} } });

  const scripts = [...dom.window.document.querySelectorAll('script[src]')].map(s => s.getAttribute('src'));
  for (const src of scripts) dom.window.eval(fs.readFileSync(path.join(APP, src), 'utf8'));
  const win = dom.window;
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  await win.DB.openDB();
  await win.DB.ensureCounters();
  await win.seedIfEmpty();

  const routes = ['/dashboard','/customers','/suppliers','/products',
    '/quotations','/customer-pos','/sales-orders','/supplier-pos','/reports','/search','/settings','/settings/backup'];
  let allOk = true;
  for (const r of routes) {
    try {
      win.location.hash = '#' + r;
      await win.Router.resolveRoute();
      await wait(5);
      const errored = win.document.getElementById('content').innerHTML.includes('Something went wrong');
      console.log((errored ? 'ERROR ' : 'OK    ') + r);
      if (errored) allOk = false;
    } catch (e) {
      console.log('THREW ' + r + ' -> ' + e.message);
      allOk = false;
    }
  }
  console.log(allOk ? '\nALL ROUTES OK' : '\nSOME ROUTES FAILED');
}
main().catch(e => { console.error(e); process.exit(1); });
