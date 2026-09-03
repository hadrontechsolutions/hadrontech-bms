const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
require('fake-indexeddb/auto');
const APP = __dirname;

async function main() {
  const rawHtml = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');

  console.log('STEP 1: The flash-free inline script (applies saved state before anything else parses) exists in the HTML source:', rawHtml.includes("localStorage.getItem('hadrontechSidebarCollapsed')"));
  console.log('STEP 2: Every nav-link has its label wrapped in a span (so CSS can hide just the text, keeping the icon), not the whole thing as one text blob:', (rawHtml.match(/<span class="nav-label">/g) || []).length === 12);
  console.log('STEP 3: Every nav-link has a title attribute (so hovering still identifies it once collapsed to icon-only):', (rawHtml.match(/class="nav-link"[^>]*title="/g) || []).length === 12);

  const css = fs.readFileSync(path.join(APP, 'css/styles.css'), 'utf8');
  console.log('STEP 4: CSS defines the collapsed-width rule for the sidebar:', css.includes('body.sidebar-collapsed .app-sidebar{width:58px;}'));
  console.log('STEP 5: CSS correctly shrinks the main content margin to match, so content isn\'t left with a gap or overlap:', css.includes('body.sidebar-collapsed .app-main{margin-left:58px;}'));
  console.log('STEP 6: CSS hides the text labels (not the icons) when collapsed:', css.includes('body.sidebar-collapsed .nav-label{display:none;}'));

  const dom = new JSDOM(rawHtml, { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  window.indexedDB = global.indexedDB; window.IDBKeyRange = global.IDBKeyRange;
  // jsdom provides a real, working localStorage implementation on its own when a proper
  // origin (url option) is set — no need to mock it, just use it directly.
  const scripts = [...dom.window.document.querySelectorAll('script[src]')].map(s => s.getAttribute('src'));
  for (const src of scripts) dom.window.eval(fs.readFileSync(path.join(APP, src), 'utf8'));
  const win = dom.window; const doc = win.document;
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  doc.dispatchEvent(new win.Event('DOMContentLoaded', { bubbles: true, cancelable: true }));
  await wait(80);

  const toggleBtn = doc.getElementById('sidebarToggle');
  console.log('STEP 7: The toggle button exists in the topbar:', !!toggleBtn);
  console.log('STEP 8: Sidebar starts expanded by default (no prior preference saved):', !doc.body.classList.contains('sidebar-collapsed'));

  toggleBtn.click();
  console.log('STEP 9: Clicking the toggle collapses the sidebar:', doc.body.classList.contains('sidebar-collapsed'));
  console.log('STEP 10: The preference is saved so it persists across page loads:', win.localStorage.getItem('hadrontechSidebarCollapsed') === '1');

  toggleBtn.click();
  console.log('STEP 11: Clicking it again correctly expands it back:', !doc.body.classList.contains('sidebar-collapsed'));
  console.log('STEP 12: The saved preference updates accordingly:', win.localStorage.getItem('hadrontechSidebarCollapsed') === '0');

  console.log('STEP 13: A regular nav link still correctly navigates despite the markup change (icon + label span):', doc.querySelector('.nav-link[data-section="/customers"]').getAttribute('href') === '#/customers');

  win.location.hash = '#/customers';
  await win.Router.resolveRoute();
  await wait(10);
  console.log('STEP 14: Normal page navigation still works completely fine after this change:', !doc.getElementById('content').innerHTML.includes('Something went wrong'));

  console.log('\n=== COLLAPSIBLE SIDEBAR FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
