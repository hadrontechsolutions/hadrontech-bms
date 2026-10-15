// Settings → Business tax registration drives the TIN label, VAT mode name, new-quotation default and Bookkeeper wording.
const fs = require('fs'); const { JSDOM } = require('jsdom'); require('fake-indexeddb/auto');
let f = 0; const ok = (n, c, x) => { console.log(n + ':', !!c, c ? '' : (x || '')); if (!c) f++; };
(async () => {
  const dom = new JSDOM(fs.readFileSync('index.html', 'utf8'), { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const win = dom.window, doc = win.document, errs = []; win.indexedDB = global.indexedDB; win.IDBKeyRange = global.IDBKeyRange; win.addEventListener('error', e => errs.push(e.message));
  for (const s of [...doc.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => s !== 'js/app.js')) win.eval(fs.readFileSync(s, 'utf8'));
  const wait = ms => new Promise(r => setTimeout(r, ms)), go = async h => { win.location.hash = h; await win.Router.resolveRoute(); await wait(300); };
  let printed = ''; win.open = () => ({ document: { open() {}, write: (h) => { printed = h; }, close() {} }, focus() {}, print() {} });
  const DB = win.DB; await DB.openDB(); await DB.ensureCounters();
  let st = await DB.getSettings(); st.tin = '243-528-761-00000'; st.taxType = undefined; await DB.dbPut('settings', st); win.setBusinessTax(st);
  const cu = { companyName: 'KEYEC' }, q = { quotationNo: 'Q-1', revision: 0, date: '2026-10-15', currency: 'PHP', vatMode: 'NonVat', lines: [], subtotal: 0, vatTotal: 0, grandTotal: 0, overallDiscountPercent: 0 };
  ok('1 no choice saved yet = Non-VAT 3% (the business today)', win.businessTaxType(st) === 'NonVat3' && win.vatModeName('NonVat') === 'Non-VAT (3% Percentage Tax)');
  printed = ''; await win.Print.printQuotation(q, cu); ok('2 printed header: NON-VAT Reg. TIN: 243-528-761-00000', printed.includes('NON-VAT Reg. TIN: 243-528-761-00000') && !/>TIN: /.test(printed) && !printed.includes('\nTIN:'));
  await go('#/settings'); const sel = doc.getElementById('s_taxType'); ok('3 Settings has the Business tax registration box with 3 choices, 3% selected', !!sel && sel.options.length === 3 && sel.value === 'NonVat3');
  sel.value = 'NonVat8'; doc.getElementById('settingsForm').dispatchEvent(new win.Event('submit', { cancelable: true, bubbles: true })); await wait(500);
  st = await DB.getSettings(); ok('4 saving stores the choice and updates the wording at once', st.taxType === 'NonVat8' && win.vatModeName('NonVat') === 'Non-VAT (8% Income Tax Option)', st.taxType);
  printed = ''; await win.Print.printQuotation(q, cu); ok('5 8% option: still NON-VAT Reg. TIN and the plain statement', printed.includes('NON-VAT Reg. TIN') && printed.includes('This business is not VAT-registered. Prices quoted are not subject to VAT.'));
  st.taxType = 'Vat12'; await DB.dbPut('settings', st); win.setBusinessTax(st);
  printed = ''; await win.Print.printQuotation(Object.assign({}, q, { vatMode: 'Standard12' }), cu); ok('6 VAT-registered: "VAT Reg. TIN: …", no non-VAT statement', printed.includes('VAT Reg. TIN: 243-528-761-00000') && !printed.includes('NON-VAT Reg.') && !printed.includes('not VAT-registered'));
  await go('#/quotations/new'); ok('7 VAT-registered: a new quotation starts as Standard 12%', doc.getElementById('f_vatMode').value === 'Standard12');
  st.taxType = 'NonVat3'; await DB.dbPut('settings', st); win.setBusinessTax(st);
  await go('#/quotations/new'); ok('8 Non-VAT: a new quotation starts as Non-VAT and the dropdown names the 3% tax', doc.getElementById('f_vatMode').value === 'NonVat' && [...doc.getElementById('f_vatMode').options].some(o => o.value === 'NonVat' && o.textContent === 'Non-VAT (3% Percentage Tax)'));
  const co = win.BookkeeperPack.company(st); ok('9 Bookkeeper Pack company line follows the choice', co.tinText === 'NON-VAT Reg. TIN: 243-528-761-00000' && co.registration === 'Non-VAT registered (3% percentage tax)');
  ok('no script errors', errs.length === 0, errs.join('|')); process.exit(f ? 1 : 0);
})();
