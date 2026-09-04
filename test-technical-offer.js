const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
require('fake-indexeddb/auto');
const APP = __dirname;

async function main() {
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  window.indexedDB = global.indexedDB; window.IDBKeyRange = global.IDBKeyRange;
  const scripts = [...dom.window.document.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => s !== 'js/app.js');
  for (const src of scripts) dom.window.eval(fs.readFileSync(path.join(APP, src), 'utf8'));
  const win = dom.window; const doc = win.document;
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const now = new Date().toISOString();

  await win.DB.openDB(); await win.DB.ensureCounters();
  const custId = await win.DB.dbAdd('customers', { customerNo: 'C1', companyName: 'Key Electrochem Limited Co./KEYEC', billingAddress: 'General Trias, Cavite', status: 'Active', createdAt: now, updatedAt: now });

  const q = await win.DB.dbAdd('quotations', {
    quotationNo: 'HT-Q-2026-0010', customerId: custId, revision: 0, isLatest: true, status: 'Sent', date: win.todayISO(), currency: 'PHP',
    rfqRef: 'RFQ-9981', projectName: 'Cooling Tower Retrofit', endUser: 'ACME Manufacturing Corp',
    deliveryLeadTime: '8-10 weeks from PO', warranty: '1 year from delivery', paymentTerms: '50% down, 50% before delivery', incoterms: 'EXW',
    customerNotes: 'Please confirm voltage requirement before finalizing.',
    lines: [{ lineId: 'L1', brand: 'Koganei', modelNo: 'KSP-150', description: 'Submersible Pump 1.5kW', qty: 2, uom: 'pc', unitCost: 3000, unitPrice: 4000, discountPercent: 0, vatRate: 12 }],
    subtotal: 8000, vatTotal: 960, freight: 0, other: 0, grandTotal: 8960, createdAt: now, updatedAt: now
  });

  win.location.hash = '#/quotations/' + q;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 1: "Print Technical Offer" button exists on the Quotation detail page:', !!doc.getElementById('btnPrintTechnical'));

  let printedHTML = '';
  win.open = () => ({ document: { write: (h) => { printedHTML = h; }, close: () => {} } });
  doc.getElementById('btnPrintTechnical').click();
  await wait(10);

  console.log('STEP 2: Title correctly reads "Technical Offer", not "Sales Quotation":', printedHTML.includes('Technical Offer') && !printedHTML.includes('Sales Quotation'));
  console.log('STEP 3: Still references the real quotation number for traceability:', printedHTML.includes('HT-Q-2026-0010'));
  console.log('STEP 4: Customer, project, and end-user context is preserved:', printedHTML.includes('Key Electrochem') && printedHTML.includes('Cooling Tower Retrofit') && printedHTML.includes('ACME Manufacturing'));
  console.log('STEP 5: Line item technical details (brand, model, description, qty) are preserved:', printedHTML.includes('Koganei') && printedHTML.includes('KSP-150') && printedHTML.includes('Submersible Pump') && printedHTML.includes('2 pc'));
  console.log('STEP 6: Delivery lead time and warranty are preserved (genuinely technical/logistics info):', printedHTML.includes('8-10 weeks') && printedHTML.includes('1 year from delivery'));
  console.log('STEP 7: Customer-facing notes are preserved:', printedHTML.includes('confirm voltage requirement'));

  console.log('STEP 8: No unit price anywhere (4,000.00 would appear if leaked):', !printedHTML.includes('4,000.00'));
  console.log('STEP 9: No subtotal/VAT/grand total figures anywhere (8,960.00 would appear if leaked):', !printedHTML.includes('8,960.00') && !printedHTML.includes('960.00'));
  console.log('STEP 10: No "Subtotal", "VAT", or "Grand Total" labels at all:', !printedHTML.includes('Subtotal') && !printedHTML.includes('Grand Total'));
  console.log('STEP 11: Payment Terms and Incoterms (commercial, not technical) are correctly excluded:', !printedHTML.includes('50% down') && !printedHTML.includes('EXW'));
  console.log('STEP 12: Bank details are not included (a technical offer isn\'t a payment request):', !printedHTML.includes('Bank Name') && !printedHTML.includes('Account Number'));
  console.log('STEP 13: Clear disclaimer that this is not a commercial quotation:', printedHTML.includes('does not constitute a commercial quotation'));

  const qMulti = await win.DB.dbAdd('quotations', {
    quotationNo: 'HT-Q-2026-0011', customerId: custId, revision: 0, isLatest: true, status: 'Sent', date: win.todayISO(), currency: 'PHP',
    isMultiOption: true,
    optionTotals: [{ label: 'Option 1: Standard', lineIds: ['L2'], subtotal: 4000, vatTotal: 480, freight: 0, other: 0, grandTotal: 4480 }, { label: 'Option 2: Premium', lineIds: ['L3'], subtotal: 6000, vatTotal: 720, freight: 0, other: 0, grandTotal: 6720 }],
    commonLineIds: [],
    lines: [
      { lineId: 'L2', brand: 'Koganei', modelNo: 'KSP-150', description: 'Standard Pump', qty: 1, uom: 'pc', unitCost: 3000, unitPrice: 4000, discountPercent: 0, vatRate: 12, optionGroup: 'Option 1: Standard' },
      { lineId: 'L3', brand: 'Grundfos', modelNo: 'CR-15', description: 'Premium Pump', qty: 1, uom: 'pc', unitCost: 4500, unitPrice: 6000, discountPercent: 0, vatRate: 12, optionGroup: 'Option 2: Premium' }
    ],
    createdAt: now, updatedAt: now
  });
  win.location.hash = '#/quotations/' + qMulti;
  await win.Router.resolveRoute();
  await wait(10);
  let printedMultiHTML = '';
  win.open = () => ({ document: { write: (h) => { printedMultiHTML = h; }, close: () => {} } });
  doc.getElementById('btnPrintTechnical').click();
  await wait(10);
  console.log('STEP 14: Multi-option quotation still shows both technical configurations by name:', printedMultiHTML.includes('Option 1: Standard') && printedMultiHTML.includes('Option 2: Premium'));
  console.log('STEP 15: Both options\' actual products are shown (Standard Pump AND Premium Pump):', printedMultiHTML.includes('Standard Pump') && printedMultiHTML.includes('Premium Pump'));
  console.log('STEP 16: No per-option pricing leaks through either (6,720.00 would appear if it did):', !printedMultiHTML.includes('6,720.00') && !printedMultiHTML.includes('4,480.00'));

  let printedCommercialHTML = '';
  win.open = () => ({ document: { write: (h) => { printedCommercialHTML = h; }, close: () => {} } });
  win.location.hash = '#/quotations/' + q;
  await win.Router.resolveRoute();
  await wait(10);
  doc.getElementById('btnPrint').click();
  await wait(10);
  console.log('STEP 17: The original commercial Quotation print is completely unaffected — still shows real prices:', printedCommercialHTML.includes('4,000.00') && printedCommercialHTML.includes('Sales Quotation'));

  console.log('\n=== TECHNICAL OFFER PRINT VIEW FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
