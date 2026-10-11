/* Standard Excel export for every table report in the Reports menu (Reports ▸ "Export Excel").
   One layout everywhere, the same as the Bookkeeper Pack / Business Performance Report workbooks:
   title · company (TIN) · what is shown + dates + export date · navy header row · typed cells
   (real numbers, real dates, % as %) · amount columns labelled with their currency · TOTAL row
   with a live SUM formula · frozen header · filter buttons · note under the table. */
(function () {
  const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
  const MONEY = /^(₱|\$|€|[A-Z]{3} )(-?[\d,]+(?:\.\d+)?)$/;
  const MONEY_NEG = /^-(₱|\$|€|[A-Z]{3} )([\d,]+(?:\.\d+)?)$/;
  const DATE = /^[A-Z][a-z]{2,8}\.? \d{1,2}, \d{4}$/;
  const PCT = /^-?\d+(?:\.\d+)?%$/;
  const INTISH = /^-?\d+$/;
  const CUR = { '₱': 'PHP', '$': 'USD', '€': 'EUR' };
  const colName = (i) => { let n = i + 1, s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

  function parseMoney(s) {
    s = String(s).trim(); let m = MONEY.exec(s), neg = false;
    if (!m) { m = MONEY_NEG.exec(s); neg = !!m; }
    if (!m) return null;
    const cur = CUR[m[1]] || m[1].trim(); const v = parseFloat(m[2].replace(/,/g, '')); if (isNaN(v)) return null;
    return { v: neg ? -v : v, cur };
  }
  function parseDate(s) { const d = new Date(String(s).trim()); if (isNaN(d)) return null; const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }

  /** Decide each column's type from what is actually in it, so nothing is mis-typed. */
  function detectKinds(cols, table) {
    return cols.map((c, ci) => {
      const vals = table.map(r => r[ci]).filter(v => v !== '' && v != null).map(String);
      if (!vals.length) return { kind: 'text' };
      if (c.wrap || vals.some(v => v.includes('\n'))) return { kind: 'wrap' };
      if (vals.every(v => DATE.test(v.trim()) && parseDate(v))) return { kind: 'date' };
      const ms = vals.map(parseMoney);
      if (ms.every(Boolean)) { const curs = [...new Set(ms.map(x => x.cur))]; if (curs.length === 1) return { kind: 'money', cur: curs[0] }; }
      if (vals.every(v => PCT.test(v.trim()))) return { kind: 'pct' };
      if (/days|qty|quantity|count|orders|lines|rev\b/i.test(c.label) && vals.every(v => INTISH.test(v.trim()))) return { kind: 'int' };
      return { kind: 'text' };
    });
  }

  /** def = { title, basis, rows, cols, totals, note, sheetName, company:{name,tin}, exportedOn } → sheet object for BookkeeperPack.xl.workbookBytes */
  function buildReportSheet(def) {
    const { titleBlock } = window.BookkeeperPack.xl;
    const table = def.rows.map(row => def.cols.map(c => { const v = typeof c.value === 'function' ? c.value(row) : row[c.value]; return v == null ? '' : String(v); }));
    const kinds = detectKinds(def.cols, table);
    const period = `Exported ${def.exportedOn}` + (def.basis ? '  ·  ' + def.basis : '');
    const rows = titleBlock(def.company, String(def.title).toUpperCase(), period);
    const hdrIdx = rows.length + 1;
    rows.push(def.cols.map((c, i) => { const k = kinds[i]; const label = k.kind === 'money' ? `${c.label} (${k.cur})` : c.label; return { v: label, s: (k.kind === 'money' || k.kind === 'pct' || k.kind === 'int') ? 'hdrR' : 'hdr' }; }));
    const first = rows.length + 1;
    table.forEach(vals => rows.push(vals.map((v, i) => {
      const k = kinds[i]; if (v === '') return { v: '', s: k.kind === 'date' ? 'date' : k.kind === 'wrap' ? 'wrapTxt' : 'txt' };
      if (k.kind === 'date') return { d: parseDate(v), s: 'date' };
      if (k.kind === 'money') return { v: r2(parseMoney(v).v), s: 'money' };
      if (k.kind === 'pct') return { v: r2(parseFloat(v)) / 100, s: 'pct' };
      if (k.kind === 'int') return { v: parseInt(v, 10), s: 'int' };
      return { v, s: k.kind === 'wrap' ? 'wrapTxt' : 'txt' };
    })));
    const last = rows.length;
    if (!table.length) rows.push([{ v: 'Nothing matches these filters.', s: 'note' }]);
    if (table.length && def.totals && def.totals.length) {
      rows.push(def.cols.map((c, i) => {
        const raw = String(def.totals[i] == null ? '' : def.totals[i]); const k = kinds[i];
        if (k.kind === 'money') { const p = parseMoney(raw); if (p) { const sum = r2(table.reduce((s, r) => s + (r[i] === '' ? 0 : parseMoney(r[i]).v), 0)); return Math.abs(sum - p.v) < 0.01 ? { v: sum, s: 'totMoney', f: `SUM(${colName(i)}${first}:${colName(i)}${last})` } : { v: r2(p.v), s: 'totMoney' }; } }
        return { v: raw, s: 'totLbl' };
      }));
    }
    const widths = def.cols.map((c, i) => { const k = kinds[i]; const longest = Math.max(String(c.label).length + (k.kind === 'money' ? 6 : 0), ...table.map(r => Math.max(...String(r[i]).split('\n').map(x => x.length)))); const min = k.kind === 'money' ? 16 : k.kind === 'date' ? 14 : 8; return Math.max(min, Math.min(longest + 2, 46)); });
    let merges, heights;
    if (def.note) { rows.push([]); rows.push([{ v: def.note, s: 'note' }]); const ri = rows.length; merges = [`A${ri}:${colName(def.cols.length - 1)}${ri}`]; heights = { [ri - 1]: 13 * Math.max(1, Math.ceil(def.note.length * 1.1 / widths.reduce((a, b) => a + b, 0))) + 4 }; }
    const name = String(def.sheetName || def.title).replace(/[\[\]:*?\/\\]/g, '-').slice(0, 31) || 'Report';
    return { name, widths, rows, freezeRow: hdrIdx, filterRow: table.length ? hdrIdx : 0, filterEnd: last, merges, heights, landscape: def.cols.length > 6 };
  }

  /** Brand / Model-Part No. / pieces quoted, one entry per item line (several lines share one cell, one item per line of the cell) */
  function quoteItemColumns() {
    const lines = (q) => (q.lines || []).filter(l => l && (l.brand || l.modelNo || l.description || Number(l.qty)));
    return [
      { label: 'Brand', wrap: true, value: q => lines(q).map(l => l.brand || '—').join('\n') },
      { label: 'Model / Part Number', wrap: true, value: q => lines(q).map(l => l.modelNo || '—').join('\n') },
      { label: 'Pieces quoted', wrap: true, value: q => lines(q).map(l => `${Number(l.qty) || 0}${l.uom && l.uom !== 'pc' ? ' ' + l.uom : ''}`).join('\n') }
    ];
  }
  window.ReportExcel = { quoteItemColumns, buildReportSheet, detectKinds, parseMoney, parseDate };
})();
