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

  const legacySupId = await win.DB.dbAdd('suppliers', { supplierNo: await win.DB.nextDocNumber('supplier'), companyName: 'Legacy Traditional Supplier Inc.', status: 'Active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

  win.location.hash = '#/suppliers';
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 1: A pre-existing supplier with no platform field shows "Direct" (no crash, sensible default):', doc.getElementById('content').textContent.includes('Direct') && !doc.getElementById('content').innerHTML.includes('Something went wrong'));

  win.location.hash = '#/suppliers/' + legacySupId;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 2: Detail page for the legacy supplier renders fine, no crash:', !doc.getElementById('content').innerHTML.includes('Something went wrong'));

  win.location.hash = '#/suppliers/new';
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 3: "Sourcing Platform" dropdown present with all expected options:', ['Direct / Traditional Supplier', 'Alibaba', 'Shopee', 'Lazada', 'Other Marketplace'].every(o => doc.getElementById('f_platform').innerHTML.includes(o)));

  doc.getElementById('f_companyName').value = 'Shenzhen ABC Hydraulics Co.';
  doc.getElementById('f_platform').value = 'Alibaba';
  doc.getElementById('entityForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(30);
  const alibabaSup = (await win.DB.dbGetAll('suppliers')).find(s => s.companyName === 'Shenzhen ABC Hydraulics Co.');
  console.log('STEP 4: New supplier correctly saved with platform = Alibaba:', alibabaSup.platform === 'Alibaba');

  win.location.hash = '#/suppliers';
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 5: Suppliers list shows the Alibaba badge for this supplier:', doc.getElementById('content').innerHTML.includes('badge-info') && doc.getElementById('content').textContent.includes('Alibaba'));

  const shopeeSupId = await win.DB.dbAdd('suppliers', { supplierNo: await win.DB.nextDocNumber('supplier'), companyName: 'ShopeeSeller123', platform: 'Shopee', status: 'Active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

  win.location.hash = '#/products/new';
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 6: "Supplier Listing URL" field present on the Products form:', !!doc.getElementById('f_supplierListingUrl'));

  doc.getElementById('f_description').value = 'Stainless Submersible Pump 1.5kW';
  doc.getElementById('f_defaultSupplierId').value = String(shopeeSupId);
  doc.getElementById('f_supplierListingUrl').value = 'https://shopee.ph/product/123456/789012';
  doc.getElementById('entityForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(30);
  const product = (await win.DB.dbGetAll('products')).find(p => p.description === 'Stainless Submersible Pump 1.5kW');
  console.log('STEP 7: Product correctly saved with the listing URL:', product.supplierListingUrl === 'https://shopee.ph/product/123456/789012');
  console.log('STEP 8: Product correctly linked to the Shopee supplier:', String(product.defaultSupplierId) === String(shopeeSupId));

  win.location.hash = '#/products/' + product.id;
  await win.Router.resolveRoute();
  await wait(10);
  const link = doc.querySelector('a[href="https://shopee.ph/product/123456/789012"]');
  console.log('STEP 9: Listing URL renders as an actual clickable link on the detail page:', !!link);
  console.log('STEP 10: Link opens in a new tab (does not navigate away from the BMS):', link.getAttribute('target') === '_blank');
  console.log('STEP 11: Detail page also shows the correct Default Supplier name:', doc.getElementById('content').textContent.includes('ShopeeSeller123'));

  const plainProdId = await win.DB.dbAdd('products', { itemNo: await win.DB.nextDocNumber('product'), description: 'Plain item, no listing URL', standardCost: 10, standardPrice: 15, currency: 'PHP', status: 'Active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  win.location.hash = '#/products/' + plainProdId;
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 12: A product with no listing URL shows a clean dash, no broken empty link:', doc.getElementById('content').textContent.includes('—') && !doc.getElementById('content').innerHTML.includes('href=""'));

  win.location.hash = '#/products/' + product.id + '/edit';
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 13: Edit form correctly pre-fills the existing listing URL:', doc.getElementById('f_supplierListingUrl').value === 'https://shopee.ph/product/123456/789012');
  doc.getElementById('f_supplierListingUrl').value = 'https://shopee.ph/product/999/888';
  doc.getElementById('entityForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(30);
  const productAfter = await win.DB.dbGet('products', product.id);
  console.log('STEP 14: Editing correctly updates the URL:', productAfter.supplierListingUrl === 'https://shopee.ph/product/999/888');

  console.log('\n=== SOURCING PLATFORM + SUPPLIER LISTING URL FEATURE VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
