const fs = require('fs'); const path = require('path');
const { JSDOM } = require('jsdom'); require('fake-indexeddb/auto');
let fails = 0; const ok = (n, c, x) => { console.log(n + ':', !!c, c ? '' : (x || '')); if (!c) fails++; };
(async () => {
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'), { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const win = dom.window, doc = win.document; const errs = [];
  win.indexedDB = global.indexedDB; win.IDBKeyRange = global.IDBKeyRange; win.confirm = () => true; win.addEventListener('error', e => errs.push(e.message));
  for (const s of [...doc.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => s !== 'js/app.js')) win.eval(fs.readFileSync(path.join(__dirname, s), 'utf8'));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  await win.DB.openDB(); await win.DB.ensureCounters(); const today = win.todayISO(), now = new Date().toISOString();
  const c = await win.DB.dbAdd('customers', { companyName: 'Key Electrochem Limited Co./KEYEC', status: 'Active', archived: false });
  const mk = (no, st, d, tot, cur) => win.DB.dbAdd('quotations', { quotationNo: no, customerId: c, revision: 0, isLatest: true, status: st, date: d, validUntil: win.addDaysISO(d, 30), currency: cur || 'PHP', lines: [], vatTotal: 0, grandTotal: tot, createdAt: now, updatedAt: now, customerSnapshot: { companyName: 'Key Electrochem Limited Co./KEYEC' }, endUser: 'Shindengen' });
  const qid = await mk('HT-Q-1', 'Sent', '2026-09-04', 33120); { const q = await win.DB.dbGet('quotations', qid); q.lines = [{ brand: 'Pentair', modelNo: 'PN-123', description: 'Pump', qty: 4, uom: 'pc', unitPrice: 100, discountPercent: 0, vatRate: 0 }, { brand: 'Kärcher', modelNo: 'T 11/1', description: 'Vacuum', qty: 2, uom: 'pc', unitPrice: 50.5, discountPercent: 10, vatRate: 0 }]; await win.DB.dbPut('quotations', q); } await mk('HT-Q-2', 'Sent', '2026-09-17', 12336.8); await mk('HT-Q-3', 'Sent', '2026-09-20', 1500.5);

  // 1: unit — typing
  const RE = win.ReportExcel; const co = { name: 'Hadrontech', tin: '' };
  const sh = RE.buildReportSheet({ title: 'T', rows: [{ a: '₱1,000.00', b: 'Sep 4, 2026', c: '12.5%', d: '3', e: 'HT-Q-0018', f: '₱5.00', g: '$7.00' }, { a: '₱2,500.50', b: 'Sep 5, 2026', c: '7.0%', d: '4', e: 'HT-Q-0019', f: '₱6.00', g: '₱8.00' }], cols: ['Amount', 'Date', 'Margin %', 'Days Outstanding', 'Ref', 'Other', 'Mixed'].map((l, i) => ({ label: l, value: 'abcdefg'[i] })), totals: ['₱3,500.50', '', '', '', 'TOTAL', '₱11.00', ''], company: co, exportedOn: 'Oct 11, 2026', basis: 'Showing all' });
  const body = sh.rows.slice(sh.freezeRow);
  ok('1 money column becomes numbers with currency in header', body[0][0].v === 1000 && body[0][0].s === 'money' && sh.rows[sh.freezeRow - 1][0].v === 'Amount (PHP)');
  ok('2 dates become real dates', body[0][1].d === '2026-09-04' && body[0][1].s === 'date');
  ok('3 percent becomes fraction, days becomes int, reference stays text', Math.abs(body[0][2].v - 0.125) < 1e-9 && body[0][3].v === 3 && body[0][3].s === 'int' && body[0][4].v === 'HT-Q-0018' && body[0][4].s === 'txt');
  ok('4 mixed-currency column stays text (currency not lost)', body[0][6].v === '$7.00' && body[1][6].v === '₱8.00' && sh.rows[sh.freezeRow - 1][6].v === 'Mixed');
  const tot = body[2];
  ok('5 TOTAL row has a live SUM formula that matches', tot[0].f && /^SUM\(A\d+:A\d+\)$/.test(tot[0].f) && tot[0].v === 3500.5 && tot[4].v === 'TOTAL');
  ok('6 filter + frozen header set; title block present', sh.filterRow === sh.freezeRow && sh.rows[0][0].v === 'T' && sh.rows[2][0].v.startsWith('Exported Oct 11, 2026  ·  Showing all'));

  // 2: every table report exports without error, and a real workbook opens
  const keys = [...fs.readFileSync(path.join(__dirname, 'js/reports.js'), 'utf8').slice(0, 6000).matchAll(/\{ key: '(\w+)', label: '[^']*'(?!, page)/g)].map(m => m[1]);
  let captured = null; const real = win.BookkeeperPack.xl.workbookBytes; win.URL.createObjectURL = () => 'blob:x';
  win.BookkeeperPack.xl.workbookBytes = (s) => { captured = s; return real(s); };
  let exported = 0, bad = [];
  for (const k of keys) {
    captured = null; win.location.hash = '#/reports/' + k; await win.Router.resolveRoute(); await wait(250);
    const tbl = doc.querySelector('#reportTableWrap table'); doc.getElementById('rExport').click(); await wait(120);
    if (!tbl) { if (captured) bad.push(k + ' exported with no table'); continue; }
    if (!captured) { bad.push(k + ' no workbook'); continue; }
    exported++;
    const s0 = captured[0]; const hdrCells = s0.rows[s0.freezeRow - 1];
    const thCount = doc.querySelectorAll('#reportTableWrap thead th').length;
    const dataRows = doc.querySelectorAll('#reportTableWrap tbody tr').length;
    if (hdrCells.length < thCount) bad.push(k + ' header count');
    const nRows = s0.rows.length - s0.freezeRow; if (nRows < dataRows) bad.push(k + ' missing rows');
    if (k === 'quotationRegister') fs.writeFileSync('/tmp/report.xlsx', Buffer.from(real(captured)));
  }
  ok(`7 every report with data exports a matching workbook (${exported}/${keys.length} had data)`, bad.length === 0 && exported >= 1, bad.join('; '));
  win.location.hash = '#/reports/quotationRegister'; await win.Router.resolveRoute(); await wait(300); captured = null; doc.getElementById('rExport').click(); await wait(150);
  const qh = captured[0].rows[captured[0].freezeRow - 1].map(x => x.v); const q1 = captured[0].rows.slice(captured[0].freezeRow).find(r => r[0].v === 'HT-Q-1');
  ok('7a Quotation Register Excel includes Brand / Model / Pieces quoted (screen table unchanged)', qh.slice(-3).join() === 'Brand,Model / Part Number,Pieces quoted' && q1[qh.indexOf('Brand')].v === 'Pentair\nKärcher' && q1[qh.indexOf('Pieces quoted')].v === '4\n2' && doc.querySelectorAll('#reportTableWrap thead th').length === 6);
  ok('8 CSV button still available', !!doc.getElementById('rExportCsv'));
  ok('9 no JS errors', errs.length === 0, errs.join('|'));
  console.log(fails ? fails + ' FAILED' : '=== REPORT EXCEL VERIFIED ==='); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
