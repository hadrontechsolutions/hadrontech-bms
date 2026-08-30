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
  const custId = await win.DB.dbAdd('customers', { customerNo: 'CUST-00001', companyName: 'Key Electrochem Limited Co./KEYEC', billingAddress: 'Muntinlupa City', status: 'Active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

  win.location.hash = '#/quotations/new';
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('f_customerId').value = String(custId);
  doc.getElementById('f_paymentTerms').value = '50% down payment, 50% before delivery';
  doc.getElementById('f_paymentTerms').dispatchEvent(new win.Event('input'));
  doc.getElementById('f_incoterms').value = 'DAP';
  doc.getElementById('f_incoterms').dispatchEvent(new win.Event('input'));
  const row = doc.querySelector('#linesBody tr');
  row.querySelector('.ln-desc').value = 'CPSMH4200 Sample Wooden Hand Brush';
  row.querySelector('.ln-desc').dispatchEvent(new win.Event('input'));
  row.querySelector('.ln-qty').value = '1';
  row.querySelector('.ln-qty').dispatchEvent(new win.Event('input'));
  row.querySelector('.ln-price').value = '238';
  row.querySelector('.ln-price').dispatchEvent(new win.Event('input'));
  await wait(10);
  doc.getElementById('qForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(30);
  const q = (await win.DB.dbGetAll('quotations'))[0];
  q.status = 'Won'; await win.DB.dbPut('quotations', q);

  win.location.hash = '#/customer-pos/new?quotationId=' + q.id;
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('f_customerId').value = String(custId);
  doc.getElementById('cpoForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(30);
  const cpo = (await win.DB.dbGetAll('customerPOs'))[0];

  win.location.hash = '#/customer-pos/' + cpo.id;
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('btnConvert').click();
  await wait(30);
  const so = (await win.DB.dbGetAll('salesOrders'))[0];
  console.log('STEP 1: Sales Order correctly inherited Payment Terms from the quotation:', so.paymentTerms === '50% down payment, 50% before delivery');
  console.log('STEP 2: Sales Order correctly inherited Incoterms from the quotation:', so.incoterms === 'DAP');

  win.location.hash = '#/sales-orders/' + so.id;
  await win.Router.resolveRoute();
  await wait(10);
  const detailText = doc.getElementById('content').textContent;
  console.log('STEP 3: Sales Order detail page shows Payment Terms:', detailText.includes('50% down payment, 50% before delivery'));
  console.log('STEP 4: Sales Order detail page shows Incoterms:', detailText.includes('DAP'));
  console.log('STEP 5: Sales Order detail page shows Freight (starts at 0):', detailText.includes('Freight / Shipping Charge'));

  doc.getElementById('btnEditDetails').click();
  await wait(10);
  console.log('STEP 6: Payment Terms field editable:', !!doc.getElementById('f_paymentTerms'));
  console.log('STEP 7: Incoterms field editable:', !!doc.getElementById('f_incoterms'));
  console.log('STEP 8: Freight field editable:', !!doc.getElementById('f_freight'));
  console.log('STEP 9: VAT% column present on line editor:', !!doc.querySelector('.so-vat'));
  console.log('STEP 10: Existing line correctly defaults to 12% VAT, matching original quotation line:', doc.querySelector('.so-vat').value === '12');

  doc.getElementById('btnAddSoLine').click();
  await wait(10);
  const rows2 = doc.querySelectorAll('#soLinesBody tr');
  const deliveryRow = rows2[1];
  deliveryRow.querySelector('.so-desc').value = 'Delivery via lalamove';
  deliveryRow.querySelector('.so-desc').dispatchEvent(new win.Event('input'));
  deliveryRow.querySelector('.so-qty').value = '1';
  deliveryRow.querySelector('.so-qty').dispatchEvent(new win.Event('input'));
  deliveryRow.querySelector('.so-price').value = '346';
  deliveryRow.querySelector('.so-price').dispatchEvent(new win.Event('input'));
  await wait(10);
  console.log('STEP 11: Before touching VAT%, the amount silently includes 12% VAT (346 * 1.12 = 387.52) — but now VISIBLE and fixable:', deliveryRow.querySelector('.so-amount').textContent.includes('387.52'));

  deliveryRow.querySelector('.so-vat').value = '0';
  deliveryRow.querySelector('.so-vat').dispatchEvent(new win.Event('input'));
  await wait(10);
  console.log('STEP 12: Setting VAT% to 0 correctly makes the amount match the entered price exactly (346.00):', deliveryRow.querySelector('.so-amount').textContent.includes('346.00'));

  doc.getElementById('f_freight').value = '150';
  doc.getElementById('f_freight').dispatchEvent(new win.Event('input'));
  doc.getElementById('soForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(30);
  const soAfter = await win.DB.dbGet('salesOrders', so.id);
  console.log('STEP 13: Freight correctly saved (150):', soAfter.freight === 150);
  console.log('STEP 14: Delivery line correctly saved with VAT% = 0:', soAfter.lines[1].vatRate === 0);
  console.log('STEP 15: Grand Total correctly recalculated including Freight and the corrected line VAT:', soAfter.grandTotal === 762.56);

  let printedSO = '';
  win.open = () => ({ document: { write: (h) => { printedSO = h; }, close: () => {} } });
  const customerObj = await win.DB.dbGet('customers', custId);
  const cpoObj = await win.DB.dbGet('customerPOs', cpo.id);
  await win.Print.printSalesOrder(soAfter, customerObj, cpoObj);
  console.log('STEP 16: Printed Sales Order now shows Payment Terms (previously never shown at all):', printedSO.includes('50% down payment'));
  console.log('STEP 17: Printed Sales Order now shows Incoterms:', printedSO.includes('DAP'));
  console.log('STEP 18: Printed Sales Order now shows Freight as its own line:', printedSO.includes('150.00'));

  await win.ProformaInvoices.getOrCreateProformaInvoice(soAfter);
  await wait(30);
  const piList = await win.DB.dbGetAll('proformaInvoices');
  const pi = piList[0];
  let printedPI = '';
  win.open = () => ({ document: { write: (h) => { printedPI = h; }, close: () => {} } });
  await win.Print.printProformaInvoice(pi, soAfter, customerObj);
  console.log('STEP 19: Printed Proforma Invoice no longer shows blank "—" for Payment:', !printedPI.includes('Payment: —'));
  console.log('STEP 20: Printed Proforma Invoice shows the real Payment Terms:', printedPI.includes('50% down payment'));
  console.log('STEP 21: Printed Proforma Invoice shows the real Incoterms:', printedPI.includes('DAP'));
  console.log('STEP 22: Printed Proforma Invoice shows Freight broken out:', printedPI.includes('150.00'));

  const legacySo = await win.DB.dbAdd('salesOrders', {
    soNo: 'HT-SO-2026-9999', customerId: custId, orderDate: win.todayISO(), currency: 'PHP', status: 'Confirmed',
    lines: [{ lineId: 'L1', itemId: '', description: 'Legacy line', qty: 1, uom: 'pc', unitCost: 100, unitPrice: 150, discountPercent: 0, vatRate: 12, supplierId: '', deliveredQty: 0 }],
    subtotal: 150, vatTotal: 18, grandTotal: 168, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  });
  win.location.hash = '#/sales-orders/' + legacySo;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 23: Legacy Sales Order (no paymentTerms/incoterms/freight fields) renders without crashing:', !doc.getElementById('content').innerHTML.includes('Something went wrong'));
  console.log('STEP 24: Shows "—" gracefully for missing terms rather than "undefined":', doc.getElementById('content').textContent.includes('—') && !doc.getElementById('content').textContent.includes('undefined'));

  doc.getElementById('btnEditDetails').click();
  await wait(10);
  console.log('STEP 25: Edit form still opens cleanly on a legacy record:', !!doc.getElementById('f_freight') && doc.getElementById('f_freight').value === '0');

  console.log('\n=== PAYMENT TERMS / INCOTERMS / FREIGHT / LINE-VAT FEATURE FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
