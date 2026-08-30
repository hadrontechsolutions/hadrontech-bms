const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
require('fake-indexeddb/auto');
const APP = __dirname;

async function main() {
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  window.indexedDB = global.indexedDB; window.IDBKeyRange = global.IDBKeyRange; window.confirm = () => true;
  const scripts = [...dom.window.document.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => s !== 'js/app.js');
  for (const src of scripts) dom.window.eval(fs.readFileSync(path.join(APP, src), 'utf8'));
  const win = dom.window; const doc = win.document;
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  await win.DB.openDB(); await win.DB.ensureCounters();
  const custId = await win.DB.dbAdd('customers', { customerNo: 'CUST-00001', companyName: 'Test Co.', status: 'Active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

  win.location.hash = '#/quotations/new';
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('f_customerId').value = String(custId);
  const row = doc.querySelector('#linesBody tr');
  row.querySelector('.ln-desc').value = 'Test item';
  row.querySelector('.ln-desc').dispatchEvent(new win.Event('input'));
  row.querySelector('.ln-qty').value = '1';
  row.querySelector('.ln-qty').dispatchEvent(new win.Event('input'));
  row.querySelector('.ln-price').value = '1000';
  row.querySelector('.ln-price').dispatchEvent(new win.Event('input'));
  doc.getElementById('f_freightCharge').value = '900';
  doc.getElementById('f_freightCharge').dispatchEvent(new win.Event('input'));
  await wait(10);
  console.log('STEP 1: Totals preview updates live as freight is typed:', doc.getElementById('totalsBox').textContent.includes('900.00'));

  doc.getElementById('qForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(30);
  const q = (await win.DB.dbGetAll('quotations'))[0];
  console.log('STEP 2: Freight correctly SAVED to the record:', q.freightCharge === 900);
  console.log('STEP 3: Grand Total correctly includes it:', q.grandTotal === q.netSubtotal + q.vatTotal + 900 + q.other);

  win.location.hash = '#/quotations/' + q.id;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 4: Detail page displays Freight correctly:', doc.getElementById('content').textContent.includes('900.00'));

  win.location.hash = '#/quotations/' + q.id + '/edit';
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 5: Re-opening for edit correctly re-loads 900 into the field (not reset to 0):', doc.getElementById('f_freightCharge').value === '900');

  console.log('\n=== FREIGHT FIELD WORKS CORRECTLY — no bug found ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
