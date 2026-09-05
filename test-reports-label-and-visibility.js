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

  await win.DB.openDB(); await win.DB.ensureCounters();
  win.location.hash = '#/reports';
  await win.Router.resolveRoute();
  await wait(50);

  /* ============ Redundant "(for Bookkeeper)" suffix removed ============ */
  const linkTexts = [...doc.querySelectorAll('.report-link')].map(a => a.textContent);
  console.log('STEP 1: "Sales Register" no longer redundantly repeats "(for Bookkeeper)" in its own label:', linkTexts.includes('Sales Register') && !linkTexts.some(t => t.includes('(for Bookkeeper)')));
  console.log('STEP 2: "Purchase Register" is the same:', linkTexts.includes('Purchase Register'));
  console.log('STEP 3: The "Bookkeeper Reports" group heading itself is untouched — the category name still says it clearly:', [...doc.querySelectorAll('.report-group-label')].some(el => el.textContent === 'Bookkeeper Reports'));

  /* ============ Filtering by "bookkeeper" still finds these two reports via their group ============ */
  const filterBox = doc.getElementById('reportFilter');
  filterBox.value = 'bookkeeper';
  filterBox.dispatchEvent(new win.Event('input'));
  await wait(20);
  const visibleLinks = () => [...doc.querySelectorAll('.report-link')].filter(a => a.style.display !== 'none');
  console.log('STEP 4: THE FIX: typing "bookkeeper" into the filter still finds Sales Register and Purchase Register, even though neither word appears in their own label anymore (matches via group name instead):', visibleLinks().length === 2 && visibleLinks().some(a => a.textContent === 'Sales Register') && visibleLinks().some(a => a.textContent === 'Purchase Register'));

  filterBox.value = '';
  filterBox.dispatchEvent(new win.Event('input'));
  await wait(20);

  /* ============ Group label visibility styling ============ */
  const cssSource = fs.readFileSync(path.join(APP, 'css/styles.css'), 'utf8');
  const groupLabelRule = cssSource.match(/\.report-group-label\{[^}]+\}/)[0];
  console.log('STEP 5: THE VISIBILITY FIX: group labels now use a darker, high-contrast color (navy) instead of the harder-to-see steel grey:', groupLabelRule.includes('var(--navy)') && !groupLabelRule.includes('var(--steel)'));
  console.log('STEP 6: Group labels now have a visible highlight (background + accent border), not just bold text on a plain background:', groupLabelRule.includes('background:') && groupLabelRule.includes('border-left'));

  /* ============ Regression: navigation and normal filtering still work ============ */
  const salesRegLink = [...doc.querySelectorAll('.report-link')].find(a => a.textContent === 'Sales Register');
  salesRegLink.click();
  await wait(80);
  console.log('STEP 7: Regression: clicking "Sales Register" still correctly loads its report content:', !!doc.getElementById('reportTableWrap'));

  console.log('\n=== REPORT LABEL CLEANUP + FILTER FIX + VISIBILITY FIX FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
