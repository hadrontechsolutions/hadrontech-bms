// Print shell: Print/Close bar must be hidden in print output (inline display:flex must not win)
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs');
(async () => {
  const src = fs.readFileSync('js/print.js', 'utf8');
  const m = src.match(/<style>[\s\S]*?<\/style>/);
  const bar = src.match(/<div class="no-print"[\s\S]*?<\/div>/)[0];
  const html = `<html><head>${m[0]}</head><body><p>Doc</p>${bar}</body></html>`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage(); await p.setContent(html);
  const vis = async () => p.$eval('.no-print', e => getComputedStyle(e).display);
  const screen = await vis(); await p.emulateMedia({ media: 'print' }); const print = await vis();
  await b.close();
  const ok = screen === 'flex' && print === 'none';
  console.log(`${ok ? 'PASS' : 'FAIL'} screen=${screen} print=${print}`);
  console.log(ok ? '1 passed, 0 failed' : '0 passed, 1 failed'); process.exit(ok ? 0 : 1);
})();
