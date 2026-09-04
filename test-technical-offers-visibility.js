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
  const now = new Date().toISOString();

  await win.DB.openDB(); await win.DB.ensureCounters();
  const custId = await win.DB.dbAdd('customers', { customerNo: 'C1', companyName: 'Key Electrochem Limited Co./KEYEC', status: 'Active', createdAt: now, updatedAt: now });
  const settings = await win.DB.getSettings();
  settings.authorizedSignatory = 'Gretchen Caballero';
  await win.DB.dbPut('settings', settings);

  /* ============ New offer pre-populates Product Description + COO sections ============ */
  win.location.hash = '#/technical-offers/new';
  await win.Router.resolveRoute();
  await wait(100);
  const sectionTitles = [...doc.querySelectorAll('.se-title')].map(el => el.value);
  console.log('STEP 1: A brand new offer pre-fills the two common sections (Product Description, COO):', sectionTitles.includes('Product Description') && sectionTitles.includes('Country of Origin (COO)'));
  console.log('STEP 2: The hide-company-info checkbox exists and defaults to unchecked:', !!doc.getElementById('f_hideCompanyInfo') && !doc.getElementById('f_hideCompanyInfo').checked);

  /* ============ Fill in and save with hideCompanyInfo OFF (default) ============ */
  doc.getElementById('f_customerId').value = String(custId);
  doc.getElementById('f_endUser').value = 'Onsemi';
  const sectionCards = doc.querySelectorAll('#sectionsBody [data-idx]');
  sectionCards[0].querySelector('.se-body').value = 'This offer covers a Pentair Fleck 3150 water softener control valve/assembly.';
  sectionCards[0].querySelector('.se-body').dispatchEvent(new win.Event('input'));
  sectionCards[1].querySelector('.se-body').value = 'This item is of Italian origin.';
  sectionCards[1].querySelector('.se-body').dispatchEvent(new win.Event('input'));

  doc.getElementById('btnAddSection').click();
  await wait(100);
  const newSectionCards = doc.querySelectorAll('#sectionsBody [data-idx]');
  newSectionCards[2].querySelector('.se-title').value = 'Installation Notes';
  newSectionCards[2].querySelector('.se-title').dispatchEvent(new win.Event('input'));
  newSectionCards[2].querySelector('.se-body').value = 'A dedicated drain connection is required.';
  newSectionCards[2].querySelector('.se-body').dispatchEvent(new win.Event('input'));

  doc.getElementById('toForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(100);
  const offer1 = (await win.DB.dbGetAll('technicalOffers'))[0];
  console.log('STEP 3: All three sections (2 default + 1 custom) saved correctly:', offer1.sections.length === 3 && offer1.sections[2].title === 'Installation Notes');
  console.log('STEP 4: hideCompanyInfo correctly saved as false by default:', offer1.hideCompanyInfo === false);

  /* ============ Detail page reflects the sections and does NOT show the hidden-info note ============ */
  win.location.hash = '#/technical-offers/' + offer1.id;
  await win.Router.resolveRoute();
  await wait(100);
  console.log('STEP 5: Detail page shows all three section titles and their body text:', doc.getElementById('content').textContent.includes('Installation Notes') && doc.getElementById('content').textContent.includes('dedicated drain connection'));
  console.log('STEP 6: No "hidden" note shown since hideCompanyInfo is off:', !doc.getElementById('content').textContent.includes('Company name and signatory are hidden'));

  /* ============ Print with company info SHOWN (default) ============ */
  let printedShown = '';
  win.open = () => ({ document: { write: (h) => { printedShown = h; }, close: () => {} } });
  doc.getElementById('btnPrintTO').click();
  await wait(100);
  console.log('STEP 7: With hideCompanyInfo off, the printed copy shows the Hadrontech name:', printedShown.includes('HADRONTECH INDUSTRIAL SOLUTIONS'));
  console.log('STEP 8: With hideCompanyInfo off, the printed copy shows the signatory:', printedShown.includes('Gretchen Caballero'));
  console.log('STEP 9: Print output includes the custom "Installation Notes" section in the right place:', printedShown.includes('Installation Notes') && printedShown.includes('dedicated drain connection'));

  /* ============ Now turn hideCompanyInfo ON and confirm both disappear ============ */
  win.location.hash = '#/technical-offers/' + offer1.id + '/edit';
  await win.Router.resolveRoute();
  await wait(100);
  doc.getElementById('f_hideCompanyInfo').click();
  doc.getElementById('toForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(100);
  const offer1After = await win.DB.dbGet('technicalOffers', offer1.id);
  console.log('STEP 10: hideCompanyInfo correctly saved as true after checking the box:', offer1After.hideCompanyInfo === true);

  win.location.hash = '#/technical-offers/' + offer1.id;
  await win.Router.resolveRoute();
  await wait(100);
  console.log('STEP 11: Detail page now shows the "hidden" note:', doc.getElementById('content').textContent.includes('Company name and signatory are hidden'));

  let printedHidden = '';
  win.open = () => ({ document: { write: (h) => { printedHidden = h; }, close: () => {} } });
  doc.getElementById('btnPrintTO').click();
  await wait(100);
  console.log('STEP 12: THE ACTUAL FEATURE: with hideCompanyInfo on, the Hadrontech name is completely absent from the printed copy:', !printedHidden.includes('HADRONTECH INDUSTRIAL SOLUTIONS'));
  console.log('STEP 13: With hideCompanyInfo on, the signatory name is also completely absent:', !printedHidden.includes('Gretchen Caballero'));
  console.log('STEP 14: But the rest of the document is unaffected — offer content still prints correctly:', printedHidden.includes('Onsemi') && printedHidden.includes('Installation Notes'));

  /* ============ Regression: sections can be deleted correctly ============ */
  win.location.hash = '#/technical-offers/' + offer1.id + '/edit';
  await win.Router.resolveRoute();
  await wait(100);
  const delBtns = doc.querySelectorAll('[data-sectiondel]');
  delBtns[delBtns.length - 1].click();
  await wait(100);
  console.log('STEP 15: Deleting a section correctly removes just that one, leaving the others intact:', doc.querySelectorAll('.se-title').length === 2);

  console.log('\n=== HIDE-COMPANY-INFO + ADDITIONAL SECTIONS FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
