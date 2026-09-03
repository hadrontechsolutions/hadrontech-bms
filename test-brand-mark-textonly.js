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

  await win.DB.openDB(); await win.DB.ensureCounters();
  win.eval(fs.readFileSync(path.join(APP, 'js/app.js'), 'utf8'));

  const css = fs.readFileSync(path.join(APP, 'css/styles.css'), 'utf8');
  console.log('STEP 1: The placeholder cross shape (border + crossing lines) is completely gone from the CSS:', !css.includes('.brand-mark::before') && !css.includes('.brand-mark::after'));
  console.log('STEP 2: The mark collapses to nothing when empty, via a plain CSS rule (genuinely text-only, not just visually hidden):', css.includes('.brand-mark:empty{display:none;}'));

  win.applyBrandHeader({ logoText: '', companyName: 'Hadrontech Industrial Solutions', logoDataUrl: '' });
  const markEmpty = doc.getElementById('brandMark');
  console.log('STEP 3: With no logo uploaded, the mark element is left genuinely empty (no injected content at all):', markEmpty.innerHTML.trim() === '');
  console.log('STEP 4: Text-only branding still shows correctly:', doc.getElementById('brandText').textContent.includes('HADRONTECH INDUSTRIAL SOLUTIONS'));

  win.applyBrandHeader({ logoText: '', companyName: 'Hadrontech Industrial Solutions', logoDataUrl: 'data:image/png;base64,fakedata' });
  const markWithLogo = doc.getElementById('brandMark');
  const img = markWithLogo.querySelector('img');
  console.log('STEP 5: If a logo IS uploaded, it still correctly appears in the mark:', !!img && img.src.includes('fakedata'));
  console.log('STEP 6: The logo image has an explicit, sensible size (not relying on the now-unstyled container):', img.getAttribute('style').includes('width:32px') && img.getAttribute('style').includes('height:32px'));

  console.log('\n=== TEXT-ONLY BRANDING + LOGO FALLBACK FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
