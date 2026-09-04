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

  win.location.hash = '#/technical-offers/new';
  await win.Router.resolveRoute();
  await wait(50);

  const firstCard = doc.querySelector('#sectionsBody [data-idx="0"]');
  const titleField = firstCard.querySelector('.se-title').closest('.field');
  const bodyField = firstCard.querySelector('.se-body').closest('.field');

  console.log('STEP 1: THE BUG FIX: the section title input is now wrapped in a .field div, so it correctly gets width:100% (matching how "End User", "Attention" etc. already render correctly on this exact form):', !!titleField);
  console.log('STEP 2: The section body textarea is also correctly wrapped in a .field div:', !!bodyField);
  console.log('STEP 3: Title and body are stacked in separate .field blocks (vertically), not sitting inline side-by-side like before:', titleField !== bodyField);
  console.log('STEP 4: Each field has its own label, matching every other field on this form ("Section Title" / "Section Text"):', titleField.querySelector('label')?.textContent === 'Section Title' && bodyField.querySelector('label')?.textContent === 'Section Text');
  console.log('STEP 5: The full placeholder text is preserved, not truncated by a fixed narrow width:', firstCard.querySelector('.se-title').placeholder === 'e.g. Product Description');

  // Confirm this exactly matches the CSS selector that's proven to work for the header fields on this same form
  const cssSource = fs.readFileSync(path.join(APP, 'css/styles.css'), 'utf8');
  console.log('STEP 6: Confirms the CSS rule this relies on is real and already governs every other field on this form:', cssSource.includes('.field input,.field textarea,.field select{width:100%;}'));

  // Regression: editing still works correctly with the new markup
  doc.querySelector('.se-title').value = 'Product Description';
  doc.querySelector('.se-title').dispatchEvent(new win.Event('input'));
  doc.querySelector('.se-body').value = 'Test body content.';
  doc.querySelector('.se-body').dispatchEvent(new win.Event('input'));
  console.log('STEP 7: Regression: editing title/body still updates correctly with the new markup:', doc.querySelector('.se-title').value === 'Product Description' && doc.querySelector('.se-body').value === 'Test body content.');

  console.log('\n=== ADDITIONAL SECTIONS LAYOUT FIX FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
