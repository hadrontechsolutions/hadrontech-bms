/* ============================================================
   ownerReport.js — the Business Performance Report: one complete picture of the business for the owners.

   The Bookkeeper Pack answers "what do the books need?". This answers "how is the business doing and what needs
   our attention?": sales vs. the previous period, the quotation pipeline, active orders, best customers,
   a 12-month trend, profit on won jobs, who owes us / whom we owe, expenses, cash and the Business Reserve.

   Money figures come from BookkeeperPack.buildPack (the same rules: sales on invoice date, cancelled/draft excluded,
   each document at its own saved exchange rate) so the Business Performance Report and the Bookkeeper Pack never disagree.
   buildOwnerReport() is pure data (testable); the Excel file is written with the Bookkeeper Pack's own writer.
   ============================================================ */

(function () {
  const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
  const d10 = (d) => String(d || '').slice(0, 10);
  const todayStr = () => (typeof todayISO === 'function' ? todayISO() : new Date().toISOString().slice(0, 10));
  const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
  const pct = (a, b) => (b ? r2(((a - b) / Math.abs(b)) * 100) : null);
  const OPEN_Q = ['Draft', 'Sent', 'Under Review'];
  const ACTIVE_SO = ['Confirmed', 'Sourcing', 'Ordered from Supplier', 'Partially Received', 'Ready for Delivery', 'Partially Delivered'];
  const monthEnd = (ym) => { const y = +ym.slice(0, 4), m = +ym.slice(5, 7); return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; };
  const shiftMonth = (ym, n) => { let y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + n; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12; return `${y}-${String(m + 1).padStart(2, '0')}`; };

  /* The period we compare with: a full month → the month before; a full quarter → the quarter before; a full year → the year before;
     "this month so far" → the same days of last month; anything else → the same number of days directly before. */
  function previousPeriod(from, to) {
    const y = +from.slice(0, 4), m = +from.slice(5, 7), pad = (n) => String(n).padStart(2, '0');
    const lastDay = (yy, mm) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
    const fullMonth = from.slice(8) === '01' && to === `${from.slice(0, 7)}-${pad(lastDay(y, m))}`;
    const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y;
    if (fullMonth) return { from: `${py}-${pad(pm)}-01`, to: `${py}-${pad(pm)}-${pad(lastDay(py, pm))}`, kind: 'the month before' };
    if (from.slice(8) === '01' && [1, 4, 7, 10].includes(m)) { const qEnd = shiftMonth(from.slice(0, 7), 2); if (to === monthEnd(qEnd)) { const ps = shiftMonth(from.slice(0, 7), -3); return { from: ps + '-01', to: monthEnd(shiftMonth(ps, 2)), kind: 'the quarter before' }; } }
    if (from === `${y}-01-01` && to === `${y}-12-31`) return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, kind: 'the year before' };
    if (from.slice(8) === '01' && from.slice(0, 7) === to.slice(0, 7)) { const d = Math.min(+to.slice(8), lastDay(py, pm)); return { from: `${py}-${pad(pm)}-01`, to: `${py}-${pad(pm)}-${pad(d)}`, kind: 'the same days last month' }; }
    const len = daysBetween(from, to) + 1; return { from: addDays(from, -len), to: addDays(from, -1), kind: 'the same number of days before' };
  }
  const nice = (d) => (typeof formatDate === 'function' ? formatDate(d) : d);
  const rangeText = (a, b) => a === b ? nice(a) : `${nice(a)} – ${nice(b)}`;

  function buildOwnerReport(opts) {
    const { from, to, data } = opts; const BP = window.BookkeeperPack;
    const pack = BP.buildPack({ from, to, data, rates: opts.rates });
    const t = pack.totals;
    // previous period of the same length, directly before this one
    const pp = previousPeriod(from, to); const pFrom = pp.from, pTo = pp.to;
    const prev = BP.buildPack({ from: pFrom, to: pTo, data, rates: opts.rates }).totals;
    const custMap = {}; (data.customers || []).forEach(c => custMap[c.id] = c);
    const cname = (id) => (custMap[id] || {}).companyName || '';
    const quotes = (data.quotations || []).filter(q => q.isLatest !== false);
    const phpOnly = (q) => (q.currency || 'PHP') === 'PHP';
    const inR = (d) => { const x = d10(d); return !!x && x >= from && x <= to; };
    const out = { from, to, prevFrom: pFrom, prevTo: pTo, prevKind: pp.kind, periodText: rangeText(from, to), prevText: rangeText(pFrom, pTo), pack, totals: t, prev };

    /* ---- headline figures with change vs previous period ---- */
    const netCash = r2(t.collections - t.disbursements), prevNetCash = r2(prev.collections - prev.disbursements);
    out.kpis = [
      { label: 'Sales invoiced', value: t.salesTotal, prev: prev.salesTotal, good: 'up' },
      { label: 'Cash collected', value: t.collections, prev: prev.collections, good: 'up' },
      { label: 'Purchases (supplier POs)', value: t.purchases, prev: prev.purchases, good: 'neutral' },
      { label: 'Operating expenses', value: t.expenses, prev: prev.expenses, good: 'down' },
      { label: 'Gross margin', value: t.marginPurchasesBasis, prev: prev.marginPurchasesBasis, good: 'up' },
      { label: 'Net cash movement', value: netCash, prev: prevNetCash, good: 'up' }
    ].map(k => Object.assign(k, { change: pct(k.value, k.prev) }));
    // When a figure is zero, say exactly why and where the nearest activity is, so a zero never looks like a bug.
    const livePI = (data.proformaInvoices || []).filter(pi => { const so = (data.salesOrders || []).find(o => o.id === pi.salesOrderId); return !(so && so.status === 'Cancelled'); });
    const latestInv = livePI.map(pi => ({ no: pi.officialInvoiceNo || pi.piNo, date: d10(pi.date) })).filter(x => x.date).sort((a, b) => b.date.localeCompare(a.date))[0];
    const latestPay = [].concat(...livePI.map(pi => (pi.payments || []).map(p => ({ no: pi.officialInvoiceNo || pi.piNo, date: d10(p.date) })))).filter(x => x.date).sort((a, b) => b.date.localeCompare(a.date))[0];
    const where = (x) => x ? ` The latest is ${x.no} on ${nice(x.date)}${x.date > to ? ' (after this period)' : x.date < from ? ' (before this period)' : ''}.` : '';
    out.kpis[0].basis = 'by invoice date'; out.kpis[1].basis = 'by payment date'; out.kpis[2].basis = 'by supplier PO date'; out.kpis[3].basis = 'by expense date'; out.kpis[4].basis = 'sales less purchases'; out.kpis[5].basis = 'cash collected less everything paid out';
    if (!t.salesTotal) out.kpis[0].hint = 'No invoice is dated within this period.' + where(latestInv);
    if (!t.collections) out.kpis[1].hint = 'No customer payment is dated within this period.' + where(latestPay);
    if (!t.purchases) out.kpis[2].hint = 'No supplier PO is dated within this period.';
    if (!t.expenses) out.kpis[3].hint = 'No expense is dated within this period.';

    /* ---- sales pipeline (quotations) ---- */
    const periodQ = quotes.filter(q => inR(q.date));
    const byStatus = {}; periodQ.forEach(q => { const b = byStatus[q.status] || (byStatus[q.status] = { count: 0, value: 0, nonPhp: 0 }); b.count++; if (phpOnly(q)) b.value = r2(b.value + (Number(q.grandTotal) || 0)); else b.nonPhp++; });
    const won = byStatus.Won || { count: 0, value: 0 }, lost = byStatus.Lost || { count: 0, value: 0 };
    const decided = won.count + lost.count;
    const openNow = quotes.filter(q => OPEN_Q.includes(q.status));
    const expInfo = typeof getExpiryInfo === 'function' ? getExpiryInfo : () => ({ state: 'none' });
    const expired = openNow.filter(q => expInfo(q).state === 'expired'), expiring = openNow.filter(q => ['today', 'soon'].includes(expInfo(q).state));
    out.pipeline = {
      byStatus, quotedCount: periodQ.length, quotedValue: r2(periodQ.filter(phpOnly).reduce((s, q) => s + (Number(q.grandTotal) || 0), 0)),
      winRateCount: decided ? r2((won.count / decided) * 100) : null, winRateValue: (won.value + lost.value) ? r2((won.value / (won.value + lost.value)) * 100) : null,
      openCount: openNow.length, openValue: r2(openNow.filter(phpOnly).reduce((s, q) => s + (Number(q.grandTotal) || 0), 0)),
      expiredCount: expired.length, expiringCount: expiring.length,
      rows: periodQ.slice().sort((a, b) => d10(a.date).localeCompare(d10(b.date))).map(q => ({ no: q.quotationNo, date: d10(q.date), customer: cname(q.customerId), endUser: q.endUser || '', status: q.status, validUntil: d10(q.validUntil), currency: q.currency || 'PHP', total: r2(q.grandTotal), expiry: expInfo(q).text || '' })),
      needsAction: expired.concat(expiring).map(q => ({ no: q.quotationNo, customer: cname(q.customerId), status: q.status, validUntil: d10(q.validUntil), total: r2(q.grandTotal), currency: q.currency || 'PHP', note: expInfo(q).text }))
    };

    /* ---- profit on won quotations (same figures as the Gross Profit report) ---- */
    const wonQ = periodQ.filter(q => q.status === 'Won' && phpOnly(q));
    out.profit = { rows: wonQ.map(q => ({ no: q.quotationNo, customer: cname(q.customerId), date: d10(q.date), net: r2(q.netSubtotal), profit: r2(q.grossProfit), margin: Number(q.grossMarginPercent) || 0 })), net: r2(wonQ.reduce((s, q) => s + (Number(q.netSubtotal) || 0), 0)), profitTotal: r2(wonQ.reduce((s, q) => s + (Number(q.grossProfit) || 0), 0)) };
    out.orderProfit = window.OrderProfit ? window.OrderProfit.compute(data, { from, to }) : { rows: [], totals: { counted: 0, notCounted: 0 } };
    out.profit.margin = out.profit.net ? r2((out.profit.profitTotal / out.profit.net) * 100) : 0;

    /* ---- orders ---- */
    const soCount = {}; (data.salesOrders || []).forEach(o => { soCount[o.status] = (soCount[o.status] || 0) + 1; });
    const active = (data.salesOrders || []).filter(o => ACTIVE_SO.includes(o.status));
    const poBySO = {}; (data.supplierPOs || []).filter(p => !['Cancelled', 'Draft'].includes(p.status)).forEach(p => { (poBySO[p.salesOrderId] = poBySO[p.salesOrderId] || []).push(p); });
    const piBySO = {}; (data.proformaInvoices || []).forEach(pi => { (piBySO[pi.salesOrderId] = piBySO[pi.salesOrderId] || []).push(pi); });
    out.orders = {
      counts: soCount, activeCount: active.length, activeValue: r2(active.filter(o => (o.currency || 'PHP') === 'PHP').reduce((s, o) => s + (Number(o.grandTotal) || 0), 0)),
      awaitingDelivery: active.filter(o => ['Ready for Delivery', 'Partially Delivered'].includes(o.status)).length,
      rows: active.slice().sort((a, b) => d10(a.orderDate).localeCompare(d10(b.orderDate))).map(o => {
        const pos = poBySO[o.id] || []; const pis = piBySO[o.id] || []; const billed = r2(pis.reduce((s, x) => s + (Number(x.grandTotal) || 0), 0)), paid = r2(pis.reduce((s, x) => s + (x.payments || []).reduce((u, p) => u + (Number(p.amount) || 0), 0), 0));
        return { no: o.soNo, date: d10(o.orderDate), customer: cname(o.customerId), status: o.status, currency: o.currency || 'PHP', total: r2(o.grandTotal), age: daysBetween(d10(o.orderDate) || to, to), supplierPOs: pos.map(p => p.poNo + ' (' + p.status + ')').join('; '), billed, paid };
      })
    };

    /* ---- customers ---- */
    const cust = {};
    pack.salesRows.forEach(r => { const c = cust[r.customer] || (cust[r.customer] = { name: r.customer, invoices: 0, invoiced: 0, collected: 0, outstanding: 0 }); c.invoices++; c.invoiced = r2(c.invoiced + r.phpTotal); });
    pack.receipts.forEach(r => { const c = cust[r.customer] || (cust[r.customer] = { name: r.customer, invoices: 0, invoiced: 0, collected: 0, outstanding: 0 }); c.collected = r2(c.collected + r.phpAmount); });
    pack.arRows.forEach(r => { const c = cust[r.customer] || (cust[r.customer] = { name: r.customer, invoices: 0, invoiced: 0, collected: 0, outstanding: 0 }); c.outstanding = r2(c.outstanding + r.phpBalance); });
    out.customers = Object.values(cust).sort((a, b) => b.invoiced - a.invoiced || b.outstanding - a.outstanding);
    out.customers.forEach(c => { c.share = t.salesTotal ? c.invoiced / t.salesTotal : 0; });

    /* ---- 12-month trend ending at the period's last month ---- */
    const endYM = to.slice(0, 7); out.trend = [];
    for (let i = 11; i >= 0; i--) {
      const ym = shiftMonth(endYM, -i); const m = BP.buildPack({ from: ym + '-01', to: monthEnd(ym), data, rates: opts.rates }).totals;
      out.trend.push({ month: ym, invoiced: m.salesTotal, collected: m.collections, purchases: m.purchases, expenses: m.expenses });
    }

    /* ---- things that need attention ---- */
    const att = out.attention = [];
    if (!t.salesTotal && !t.collections) att.push({ level: 'info', text: `Nothing was invoiced or collected between ${rangeText(from, to)}.${where(latestInv)} Choose another period above if you expected to see activity.` });
    const od = pack.arRows.filter(r => r.days > 30); if (od.length) att.push({ level: 'warn', text: `${od.length} unpaid invoice(s) are older than 30 days — ${pack.arRows.filter(r => r.days > 30).reduce((s, r) => s + r.phpBalance, 0).toFixed(2)} still to collect.` });
    if (pack.apRows.length) att.push({ level: 'info', text: `${pack.apRows.length} supplier PO(s) not fully paid — ${t.apClosing.toFixed(2)} owed to suppliers.` });
    if (out.pipeline.expiredCount) att.push({ level: 'warn', text: `${out.pipeline.expiredCount} open quotation(s) have expired and need a decision (extend, mark Lost or follow up).` });
    if (out.pipeline.expiringCount) att.push({ level: 'info', text: `${out.pipeline.expiringCount} quotation(s) expire within ${typeof EXPIRING_SOON_DAYS === 'number' ? EXPIRING_SOON_DAYS : 7} days.` });
    if (out.orders.awaitingDelivery) att.push({ level: 'info', text: `${out.orders.awaitingDelivery} order(s) are ready for (or partly) delivery.` });
    pack.warnings.filter(w => w.level === 'warn').forEach(w => att.push({ level: 'warn', text: w.text }));
    out.warnings = pack.warnings;
    return out;
  }

  /* ---------- workbook ---------- */
  function buildSheets(rep, co) {
    const { H, titleBlock, money } = window.BookkeeperPack.xl; const t = rep.totals; const period = `Period: ${rep.periodText}  ·  compared with ${rep.prevText} (${rep.prevKind})`; const sheets = [];
    const colName = (i) => { let n = i + 1, s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
    const table = (name, title, headers, widths, body, sums, note) => {
      const rows = titleBlock(co, title, period); const hdr = rows.length + 1; rows.push(H(headers)); const first = rows.length + 1; body.forEach(r => rows.push(r)); const last = rows.length;
      if (body.length && sums && sums.length) { const tot = headers.map(() => ({ v: '', s: 'totLbl' })); tot[0] = { v: 'TOTAL', s: 'totLbl' }; sums.forEach(([ci, v]) => { tot[ci] = { v: r2(v), s: 'totMoney', f: `SUM(${colName(ci)}${first}:${colName(ci)}${last})` }; }); rows.push(tot); }
      else if (!body.length) rows.push([{ v: 'Nothing to show for this period.', s: 'note' }]);
      let merges, heights; if (note) { rows.push([]); rows.push([{ v: note, s: 'note' }]); const ri = rows.length; merges = [`A${ri}:${colName(headers.length - 1)}${ri}`]; heights = { [ri - 1]: 13 * Math.max(1, Math.ceil(note.length * 1.1 / widths.reduce((a, b) => a + b, 0))) + 4 }; }
      sheets.push({ name, widths, rows, freezeRow: hdr, filterRow: body.length ? hdr : 0, filterEnd: last, merges, heights });
    };

    /* Overview */
    const S = []; const sec = (x) => S.push([{ v: x, s: 'section' }, { v: '', s: 'section' }, { v: '', s: 'section' }, { v: '', s: 'section' }, { v: '', s: 'section' }]);
    S.push([{ v: 'BUSINESS PERFORMANCE REPORT', s: 'title' }]); S.push([{ v: co.name, s: 'bold' }]); S.push([{ v: period + `   ·   Prepared ${todayStr()}`, s: 'sub' }]); S.push([]);
    sec('1. How we did (PHP)'); S.push([{ v: 'Measure', s: 'hdr' }, { v: 'This period: ' + rep.periodText, s: 'hdrR' }, { v: 'Compared with: ' + rep.prevText, s: 'hdrR' }, { v: 'Change', s: 'hdrR' }, { v: '% change', s: 'hdrR' }]);
    rep.kpis.forEach(k => S.push([{ v: `${k.label} (${k.basis})`, s: 'txt' }, money(k.value), money(k.prev), money(k.value - k.prev), k.change == null ? { v: 'n/a', s: 'txt' } : { v: k.change / 100, s: 'pct' }]));
    S.push([]); sec('2. Position at period end (PHP)');
    [['Receivables — customers owe us', t.arClosing], ['Payables — we owe suppliers', t.apClosing], ['Inventory on hand (standard cost)', t.inventory], ['Business Reserve', t.reserveEnd]].forEach(([l, v]) => S.push([{ v: l, s: 'txt' }, money(v)]));
    S.push([]); sec('3. Pipeline & orders');
    const P = rep.pipeline, O = rep.orders;
    [['Quotations issued in the period', `${P.quotedCount}  (${P.quotedValue.toFixed(2)} PHP)`], ['Won / Lost in the period', `${(P.byStatus.Won || { count: 0 }).count} / ${(P.byStatus.Lost || { count: 0 }).count}` + (P.winRateCount != null ? `   → win rate ${P.winRateCount}% by count, ${P.winRateValue}% by value` : '')], ['Open quotations right now', `${P.openCount}  (${P.openValue.toFixed(2)} PHP)  ·  ${P.expiredCount} expired, ${P.expiringCount} expiring within ${typeof EXPIRING_SOON_DAYS === 'number' ? EXPIRING_SOON_DAYS : 10} days`], ['Active sales orders right now', `${O.activeCount}  (${O.activeValue.toFixed(2)} PHP)  ·  ${O.awaitingDelivery} ready / partly delivered`], ['Gross profit on won quotations', `${rep.profit.profitTotal.toFixed(2)} PHP on ${rep.profit.net.toFixed(2)} net sales  (${rep.profit.margin}% margin)`]].forEach(([l, v]) => S.push([{ v: l, s: 'txt' }, { v, s: 'txt' }]));
    S.push([]); sec('4. Needs your attention');
    if (!rep.attention.length) S.push([{ v: 'Nothing urgent.', s: 'ok' }]); rep.attention.forEach(a => S.push([{ v: (a.level === 'warn' ? '⚠ ' : 'ℹ ') + a.text, s: a.level === 'warn' ? 'warn' : 'info' }]));
    const mg = S.map((r, i) => (r.length === 1 && r[0] && ['warn', 'info', 'ok'].includes(r[0].s)) ? i : -1).filter(i => i >= 0);
    sheets.push({ name: 'Overview', widths: [58, 32, 32, 18, 12], rows: S, landscape: false, merges: mg.map(i => `A${i + 1}:E${i + 1}`), heights: Object.fromEntries(mg.map(i => [i, 15 * Math.max(1, Math.ceil(String(S[i][0].v).length / 110))])) });

    table('Sales Pipeline', 'SALES PIPELINE — quotations issued in the period', ['Quotation', 'Date', 'Customer', 'End-user', 'Status', 'Valid until', 'Expiry', 'Cur', 'Total'], [16, 11, 32, 24, 14, 12, 24, 6, 16],
      rep.pipeline.rows.map(r => [{ v: r.no, s: 'txt' }, { d: r.date, s: 'date' }, { v: r.customer, s: 'txt' }, { v: r.endUser, s: 'txt' }, { v: r.status, s: 'txt' }, r.validUntil ? { d: r.validUntil, s: 'date' } : { v: '', s: 'txt' }, { v: r.expiry, s: 'txt' }, { v: r.currency, s: 'txt' }, money(r.total)]),
      [[8, rep.pipeline.rows.filter(r => r.currency === 'PHP').reduce((s, r) => s + r.total, 0)]], 'Total covers PHP quotations only. Win rate = Won ÷ (Won + Lost) for quotations issued in the period; quotations still open or expired are not counted as lost.');
    table('Orders', 'ACTIVE SALES ORDERS — right now (not yet delivered)', ['Sales Order', 'Order date', 'Days open', 'Customer', 'Status', 'Cur', 'Order total', 'Supplier POs', 'Invoiced', 'Collected'], [14, 11, 10, 32, 22, 6, 16, 50, 15, 15],
      rep.orders.rows.map(r => [{ v: r.no, s: 'txt' }, r.date ? { d: r.date, s: 'date' } : { v: '', s: 'txt' }, { v: r.age, s: 'int' }, { v: r.customer, s: 'txt' }, { v: r.status, s: 'txt' }, { v: r.currency, s: 'txt' }, money(r.total), { v: r.supplierPOs, s: 'txt' }, money(r.billed), money(r.paid)]),
      [[6, rep.orders.rows.filter(r => r.currency === 'PHP').reduce((s, r) => s + r.total, 0)], [8, rep.orders.rows.reduce((s, r) => s + r.billed, 0)], [9, rep.orders.rows.reduce((s, r) => s + r.paid, 0)]]);
    table('Customers', 'CUSTOMERS — who we sold to and who owes us', ['Customer', 'Invoices', 'Invoiced (PHP)', '% of sales', 'Collected (PHP)', 'Still owing at period end'], [36, 10, 18, 11, 18, 22],
      rep.customers.map(c => [{ v: c.name, s: 'txt' }, { v: c.invoices, s: 'int' }, money(c.invoiced), { v: c.share, s: 'pct' }, money(c.collected), money(c.outstanding)]),
      [[2, t.salesTotal], [4, t.collections], [5, rep.customers.reduce((s, c) => s + c.outstanding, 0)]]);
    table('Monthly Trend', 'LAST 12 MONTHS — month by month (PHP)', ['Month', 'Invoiced', 'Collected', 'Purchases', 'Expenses', 'Invoiced less purchases & expenses'], [12, 18, 18, 18, 18, 30],
      rep.trend.map(m => [{ v: m.month, s: 'txt' }, money(m.invoiced), money(m.collected), money(m.purchases), money(m.expenses), money(m.invoiced - m.purchases - m.expenses)]),
      [[1, rep.trend.reduce((s, m) => s + m.invoiced, 0)], [2, rep.trend.reduce((s, m) => s + m.collected, 0)], [3, rep.trend.reduce((s, m) => s + m.purchases, 0)], [4, rep.trend.reduce((s, m) => s + m.expenses, 0)], [5, rep.trend.reduce((s, m) => s + m.invoiced - m.purchases - m.expenses, 0)]],
      'Each month is built with the same rules as the Bookkeeper Pack (sales on invoice date, purchases on PO date). The last column is indicative only — it does not adjust for inventory or accruals.');
    table('Profitability', 'PROFIT ON WON QUOTATIONS — issued in the period', ['Quotation', 'Date', 'Customer', 'Net sales', 'Gross profit', 'Margin %'], [16, 11, 36, 18, 18, 11],
      rep.profit.rows.map(r => [{ v: r.no, s: 'txt' }, { d: r.date, s: 'date' }, { v: r.customer, s: 'txt' }, money(r.net), money(r.profit), { v: r.margin / 100, s: 'pct' }]),
      [[3, rep.profit.net], [4, rep.profit.profitTotal]], 'Gross profit is the figure calculated on each quotation (selling price less its costs) — the same as Reports → Gross Profit. PHP quotations only.');
    table('Order Profit', 'ORDER PROFIT — gross profit as ordered vs ACTUAL profit, orders placed in the period', ['Sales Order', 'Order date', 'Customer', vatSalesLabel(rep.orderProfit.rows.map(r => r.vatMode)), 'Quoted cost', 'Gross profit as ordered', 'Cost at PO rates (computed)', 'Actual cost', 'Of which additional costs', 'Actual profit', 'Difference (actual − ordered)', 'Customer payment'], [16, 11, 32, 18, 16, 18, 20, 16, 16, 16, 20, 22],
      rep.orderProfit.rows.map(r => [{ v: r.soNo, s: 'txt' }, r.orderDate ? { d: r.orderDate, s: 'date' } : { v: '', s: 'txt' }, { v: r.customer, s: 'txt' }, money(r.sales), money(r.quotedCost), money(r.quotedProfit), money(r.computedCost), money(r.actualCost), money(r.additional), r.actualProfit == null ? { v: 'Not fully paid yet', s: 'txt' } : money(r.actualProfit), r.difference == null ? { v: '', s: 'txt' } : money(r.difference), { v: r.payState + (r.costConfirmed ? '' : ' · cost not confirmed'), s: 'txt' }]),
      [[3, rep.orderProfit.totals.sales], [4, rep.orderProfit.totals.quotedCost], [5, rep.orderProfit.totals.quotedProfit], [6, rep.orderProfit.totals.computedCost], [7, rep.orderProfit.totals.actualCost], [8, rep.orderProfit.totals.additional], [9, rep.orderProfit.totals.actualProfit], [10, rep.orderProfit.totals.difference]],
      'Internal figures. Gross profit as ordered = sales less the quoted cost (same as Reports → Gross Profit and Distributions). Cost at PO rates (computed) = Supplier PO totals at the exchange rate on each PO. Actual profit = what the customer paid, less the pesos actually paid to suppliers (entered on the Supplier PO payment), less Additional Costs; orders marked "cost not confirmed" still contain an estimated rate or an unpaid supplier. Only orders PAID IN FULL are counted in the totals; others are listed as "Not fully paid yet". Orders are picked by order date.');
    table('Receivables', `WHO OWES US — unpaid invoices as of ${rep.to}`, ['Invoice', 'Customer', 'Invoice date', 'Days', 'Cur', 'Balance', 'PHP Balance', 'Current (0-30)', '31-60', '61-90', 'Over 90'], [16, 34, 12, 7, 6, 15, 17, 15, 14, 14, 14],
      rep.pack.arRows.map(r => [{ v: r.invoiceNo, s: 'txt' }, { v: r.customer, s: 'txt' }, { d: r.date, s: 'date' }, { v: r.days, s: 'int' }, { v: r.currency, s: 'txt' }, money(r.balance), money(r.phpBalance), money(r.bucket === 'b0' ? r.phpBalance : 0), money(r.bucket === 'b30' ? r.phpBalance : 0), money(r.bucket === 'b60' ? r.phpBalance : 0), money(r.bucket === 'b90' ? r.phpBalance : 0)]),
      [[6, t.arClosing], [7, rep.pack.arAging.b0], [8, rep.pack.arAging.b30], [9, rep.pack.arAging.b60], [10, rep.pack.arAging.b90]]);
    table('Payables', `WHOM WE OWE — unpaid supplier POs as of ${rep.to}`, ['PO', 'Supplier', 'PO date', 'Days', 'Status', 'Cur', 'Balance', 'PHP Balance (at PO rate)', 'Current (0-30)', '31-60', '61-90', 'Over 90'], [15, 34, 12, 7, 20, 6, 15, 20, 15, 14, 14, 14],
      rep.pack.apRows.map(r => [{ v: r.poNo, s: 'txt' }, { v: r.supplier, s: 'txt' }, { d: r.date, s: 'date' }, { v: r.days, s: 'int' }, { v: r.status, s: 'txt' }, { v: r.currency, s: 'txt' }, money(r.balance), money(r.phpBalance), money(r.bucket === 'b0' ? r.phpBalance : 0), money(r.bucket === 'b30' ? r.phpBalance : 0), money(r.bucket === 'b60' ? r.phpBalance : 0), money(r.bucket === 'b90' ? r.phpBalance : 0)]),
      [[7, t.apClosing], [8, rep.pack.apAging.b0], [9, rep.pack.apAging.b30], [10, rep.pack.apAging.b60], [11, rep.pack.apAging.b90]]);
    /* Expenses & cash */
    {
      const rows = titleBlock(co, 'EXPENSES, CASH & DISTRIBUTIONS', period); const hdr = rows.length + 1; rows.push(H(['Measure', 'Amount (PHP)', 'Note']));
      const cats = Object.entries(rep.pack.expenseByCategory).sort((a, b) => b[1].total - a[1].total);
      rows.push([{ v: 'Operating expenses by category', s: 'section' }, { v: '', s: 'section' }, { v: '', s: 'section' }]);
      cats.forEach(([c, v]) => rows.push([{ v: c, s: 'txt' }, money(v.total), { v: `${v.count} item(s)`, s: 'txt' }]));
      rows.push([{ v: 'Total operating expenses', s: 'totLbl' }, { v: t.expenses, s: 'totMoney' }, { v: '', s: 'totLbl' }]);
      rows.push([{ v: 'Cash in and out', s: 'section' }, { v: '', s: 'section' }, { v: '', s: 'section' }]);
      [['Cash received from customers', t.collections, ''], ['Paid to suppliers', -t.supplierPaid, ''], ['Operating expenses paid', -t.expenses, ''], ['Owner draws paid', -t.ownerDrawsPaid, ''], ['Employee compensation paid', -t.employeePaid, '']].forEach(([l, v, n]) => rows.push([{ v: l, s: 'txt' }, money(v), { v: n, s: 'txt' }]));
      rows.push([{ v: 'Net cash movement', s: 'totLbl' }, { v: r2(t.collections - t.disbursements), s: 'totMoney' }, { v: '', s: 'totLbl' }]);
      rows.push([{ v: 'Business Reserve', s: 'section' }, { v: '', s: 'section' }, { v: '', s: 'section' }]);
      [['Opening balance', t.reserveStart], ['Set aside in the period', t.reserveAdded], ['Used in the period', -t.reserveUsed]].forEach(([l, v]) => rows.push([{ v: l, s: 'txt' }, money(v), { v: '', s: 'txt' }]));
      rows.push([{ v: 'Closing balance', s: 'totLbl' }, { v: t.reserveEnd, s: 'totMoney' }, { v: '', s: 'totLbl' }]);
      if (Math.abs(t.fxLoss) > 0.004) { rows.push([]); rows.push([{ v: 'Foreign-exchange ' + (t.fxLoss > 0 ? 'loss' : 'gain') + ' on supplier payments', s: 'txt' }, money(Math.abs(t.fxLoss)), { v: '', s: 'txt' }]); }
      sheets.push({ name: 'Expenses & Cash', widths: [46, 20, 30], rows, freezeRow: hdr });
    }
    /* Notes */
    {
      const rows = titleBlock(co, 'NOTES', period);
      ['These are management figures from the owners’ own records (unaudited). Sales are counted on the invoice date; purchases on the supplier PO date; cancelled and draft documents are left out.',
        'The previous period is the period of the same length immediately before the one chosen, so the comparison is always like-for-like.',
        'Foreign-currency purchases use the exchange rate saved on each supplier PO; payments use the rate entered on payment day. Quotation values are shown in PHP only where the quotation is in PHP.',
        'The matching Bookkeeper Pack for the same period carries the full books (sales book, cash receipts, purchases, disbursements, aging, inventory) for your bookkeeper.'
      ].forEach(n => rows.push([{ v: n, s: 'wrap' }]));
      sheets.push({ name: 'Notes', widths: [140], rows, heights: Object.fromEntries(rows.map((r, i) => [i, r[0] && r[0].s === 'wrap' ? 30 : 0]).filter(x => x[1])) });
    }
    return sheets;
  }

  /* ---------- one-page PDF ---------- */
  function summaryHTML(rep, co) {
    const f = (n) => formatMoney(n, 'PHP'); const t = rep.totals; const P = rep.pipeline, O = rep.orders;
    const row = (l, v, b) => `<tr${b ? ' style="font-weight:800;"' : ''}><td>${escapeHtml(l)}</td><td class="p-num">${v}</td></tr>`;
    const block = (title, rows) => `<div class="bp-sec">${escapeHtml(title)}</div><table class="p-items">${rows.join('')}</table>`;
    const chg = (k) => ` <span style="font-weight:400;color:#777;">(${k.change == null ? 'before: ' + f(k.prev) : (k.change > 0 ? '+' : '') + k.change + '% vs ' + f(k.prev)})</span>`;
    const top = rep.customers.slice(0, 5);
    return `<style>.bp-sec{margin:16px 0 4px; font-size:11px; font-weight:800; letter-spacing:.1em; text-transform:uppercase; color:#a85f04;} table.p-items td:first-child{width:62%;}</style>
      <div class="p-head"><div><div class="p-co-name">${escapeHtml(co.name)}</div><div class="p-co-meta">${escapeHtml(co.tin ? 'TIN: ' + co.tin : '')}</div></div>
      <div><div class="p-doc-title">Business Performance Report</div><div class="p-doc-no">${escapeHtml(rep.periodText)}</div><div class="p-dates">Compared with ${escapeHtml(rep.prevText)} (${escapeHtml(rep.prevKind)})<br>Prepared ${todayStr()}</div></div></div>
      ${block('How we did', rep.kpis.map(k => row(`${k.label} — ${k.basis}`, f(k.value) + chg(k))))}
      ${block('Position at period end', [row('Receivables — customers owe us', f(t.arClosing)), row('Payables — we owe suppliers', f(t.apClosing)), row('Inventory on hand', f(t.inventory)), row('Business Reserve', f(t.reserveEnd))])}
      ${block('Pipeline & orders', [row('Quotations issued', `${P.quotedCount} · ${f(P.quotedValue)}`), row('Won / Lost', `${(P.byStatus.Won || { count: 0 }).count} / ${(P.byStatus.Lost || { count: 0 }).count}${P.winRateCount != null ? ' · win rate ' + P.winRateCount + '%' : ''}`), row('Open quotations now', `${P.openCount} · ${f(P.openValue)}`), row('Active sales orders now', `${O.activeCount} · ${f(O.activeValue)}`), row('Gross profit on won quotations', `${f(rep.profit.profitTotal)} (${rep.profit.margin}%)`)])}
      ${top.length ? block('Top customers this period', top.map(c => row(c.name || '(no name)', f(c.invoiced) + ` <span style="font-weight:400;color:#777;">(${Math.round(c.share * 100)}%)</span>`))) : ''}
      ${rep.orderProfit.totals.counted ? block('Profit: as ordered vs actual (fully paid orders placed in this period)', [row('Orders counted', String(rep.orderProfit.totals.counted)), row('Gross profit as ordered', f(rep.orderProfit.totals.quotedProfit) + ` (${rep.orderProfit.totals.quotedPct}%)`), row('Actual profit', f(rep.orderProfit.totals.actualProfit) + ` (${rep.orderProfit.totals.actualPct}%)`), row('Difference (actual − ordered)', f(rep.orderProfit.totals.difference), true)].concat(rep.orderProfit.totals.additional ? [row('Of the actual cost: unexpected additional costs', f(rep.orderProfit.totals.additional))] : [])) : ''}
      ${rep.attention.length ? `<div class="bp-sec">Needs attention</div><ul style="font-size:11px; line-height:1.6; margin:6px 0 0 18px;">${rep.attention.map(a => `<li style="color:${a.level === 'warn' ? '#b3261e' : '#555'}">${escapeHtml(a.text)}</li>`).join('')}</ul>` : ''}
      <div class="p-terms">Management figures from the owners’ own records, unaudited. The full detail — pipeline, active orders, customers, 12-month trend, profit, receivables, payables, expenses and cash — is in the accompanying Excel workbook.</div>`;
  }

  /* On-screen card: same figures as the Order Profit page. */
  function orderProfitCardHTML(rep) {
    const op = rep.orderProfit, t = op.totals, f = (n) => formatMoney(n, 'PHP');
    const pc = (v) => (Math.round(v * 100) / 100) + '%';
    const tn = (d) => d == null ? '' : d > 0.005 ? 'profit-green' : d < -0.005 ? 'cost-red' : '';
    const sg = (v) => (v > 0.005 ? '+' : v < -0.005 ? '\u2212' : '') + f(Math.abs(v));
    if (!op.rows.length) return `<div class="card"><h3 class="section-title">Profit: gross profit as ordered vs actual profit</h3><div class="empty-inline">No delivered or paid order was placed between ${escapeHtml(rep.periodText)}. This section lists orders by the date the order was placed.</div></div>`;
    return `<div class="card"><h3 class="section-title">Profit: gross profit as ordered vs actual profit <span class="muted-text" style="font-weight:400;">(orders placed ${escapeHtml(rep.periodText)} · internal)</span></h3>
      <div style="overflow-x:auto;"><table class="data-table compact"><thead><tr><th>Sales Order</th><th>Customer</th><th>Gross profit as ordered</th><th>Cost at PO rates (computed)</th><th>Actual cost</th><th>Actual profit</th><th>Difference (actual − ordered)</th></tr></thead><tbody>
      ${op.rows.map(r => `<tr class="clickable-row" data-hash="/order-profit/${r.id}"><td><a href="#/order-profit/${r.id}">${escapeHtml(r.soNo)}</a></td><td>${escapeHtml(r.customer || '—')}</td><td>${f(r.quotedProfit)} <span class="muted-text">(${pc(r.quotedPct)})</span></td><td>${f(r.computedCost)}</td><td>${f(r.actualCost)}${r.costConfirmed ? '' : ' <span class="cost-tag">⚠ not confirmed</span>'}${r.additional ? ` <span class="cost-tag">⚠ incl. ${f(r.additional)}</span>` : ''}</td><td>${r.actualProfit == null ? '<span class="badge badge-pending">Not fully paid yet</span>' : `<b class="${tn(r.difference)}">${f(r.actualProfit)}</b> <span class="muted-text">(${pc(r.diffPct)})</span>`}</td><td>${r.difference == null ? '—' : `<span class="${tn(r.difference)}">${sg(r.difference)}</span>`}</td></tr>`).join('')}</tbody>
      <tfoot><tr style="font-weight:700; border-top:2px solid var(--ink); background:rgba(0,0,0,.03);"><td colspan="2">TOTAL — ${t.counted} fully paid order${t.counted === 1 ? '' : 's'}</td><td>${f(t.quotedProfit)} (${pc(t.quotedPct)})</td><td>${f(t.computedCost)}</td><td>${f(t.actualCost)}</td><td><span class="${tn(t.difference)}">${f(t.actualProfit)}</span> (${pc(t.actualPct)})</td><td><span class="${tn(t.difference)}">${sg(t.difference)}</span></td></tr></tfoot></table></div>
      <p class="muted-text small" style="margin-bottom:0;">${t.notCounted ? `${t.notCounted} order${t.notCounted === 1 ? ' is' : 's are'} not fully paid yet and left out of the totals. ` : ''}Actual profit = what the customer paid less Supplier POs (at the rates actually paid) and Additional Costs. Orders are picked by the date the order was placed. Detail: <a href="#/order-profit">Order Profit</a>.</p></div>`;
  }

  /* ---------- page ---------- */
  async function loadData() {
    const data = await window.BookkeeperPack.loadData();
    data.quotations = await DB.dbGetAll('quotations');
    return data;
  }
  async function render(host) {
    const content = host || document.getElementById('content');
    const data = await loadData(); const co = window.BookkeeperPack.company(data.settings);
    if (!content.isConnected) return; // the page was re-rendered while the data was loading
    const cur = window.BookkeeperPack.periodPreset('monthToDate');
    content.innerHTML = `
      <div class="card">
        <h2 class="section-title" style="margin-top:0;">Business Performance Report</h2>
        <p class="muted-text" style="margin-top:0;">The complete picture for the owners: how we did against the previous period, the quotation pipeline, active orders, best customers, a 12-month trend, profit on won jobs, who owes us / whom we owe, expenses, cash and the Business Reserve — as an <b>Excel workbook</b> plus a <b>one-page PDF</b>. (The <a href="#/reports/bookkeeperPack">Bookkeeper Pack</a> carries the books for your bookkeeper.)</p>
        <div class="bp-controls">
          <label>Period <select id="orPreset"><option value="monthToDate">This month so far</option><option value="lastMonth">Last month (full)</option><option value="thisMonth">This month (full)</option><option value="lastQuarter">Last quarter</option><option value="thisQuarter">This quarter</option><option value="lastYear">Last year</option><option value="thisYear">This year</option><option value="custom">Custom…</option></select></label>
          <label>From <input type="date" id="orFrom" value="${cur.from}"></label>
          <label>To <input type="date" id="orTo" value="${cur.to}"></label>
        </div>
        <div id="orPeriodNote" class="muted-text" style="margin-top:10px; line-height:1.6;"></div>
      </div>
      <div id="orPreview"></div>`;
    const q = (id) => document.getElementById(id); let rep = null;
    const refresh = () => {
      const from = q('orFrom').value, to = q('orTo').value;
      if (!from || !to || from > to) { q('orPreview').innerHTML = '<div class="card"><div class="empty-inline">Choose a valid period (From must not be after To).</div></div>'; rep = null; return; }
      rep = buildOwnerReport({ from, to, data }); const f = (n) => formatMoney(n, 'PHP');
      q('orPeriodNote').innerHTML = `Showing <b>${escapeHtml(rep.periodText)}</b>, compared with <b>${escapeHtml(rep.prevText)}</b> (${escapeHtml(rep.prevKind)}). Sales are counted on the <b>invoice date</b> and collections on the <b>payment date</b> — so an invoice dated in one period and paid in another appears in each separately.`;
      const arrow = (k) => k.change == null ? '' : `<span class="${(k.good === 'up' ? k.change >= 0 : k.good === 'down' ? k.change <= 0 : true) ? 'text-ok' : 'cell-needs-input'}" style="font-size:11px;"> ${k.change > 0 ? '▲' : k.change < 0 ? '▼' : '•'} ${Math.abs(k.change)}%</span>`;
      const tile = (k) => `<div class="stat-card"><div class="stat-card-num">${f(k.value)}</div><div class="stat-card-lbl"><b>${escapeHtml(k.label)}</b> <span class="muted-text">(${escapeHtml(k.basis)})</span>${arrow(k)}<br><span class="muted-text" style="font-size:11px;">Before: ${f(k.prev)}</span>${k.hint ? `<br><span style="font-size:11px; color:var(--amber-dk, #a85f04);">${escapeHtml(k.hint)}</span>` : ''}</div></div>`;
      const P = rep.pipeline, O = rep.orders;
      q('orPreview').innerHTML = `
        <div class="stat-grid">${rep.kpis.map(tile).join('')}</div>
        <div class="stat-grid">
          <div class="stat-card"><div class="stat-card-num">${f(rep.totals.arClosing)}</div><div class="stat-card-lbl">Customers owe us</div></div>
          <div class="stat-card"><div class="stat-card-num">${f(rep.totals.apClosing)}</div><div class="stat-card-lbl">We owe suppliers</div></div>
          <div class="stat-card"><div class="stat-card-num">${P.openCount}</div><div class="stat-card-lbl">Open quotations (${f(P.openValue)})</div></div>
          <div class="stat-card"><div class="stat-card-num">${O.activeCount}</div><div class="stat-card-lbl">Active orders (${f(O.activeValue)})</div></div>
        </div>
        <div class="card"><h3 class="section-title">Needs your attention</h3>${rep.attention.length ? `<ul class="bp-warn">${rep.attention.map(a => `<li class="${a.level}">${a.level === 'warn' ? '⚠' : 'ℹ'} ${escapeHtml(a.text)}</li>`).join('')}</ul>` : '<div class="text-ok">✓ Nothing urgent.</div>'}</div>
        ${orderProfitCardHTML(rep)}
        <div class="card"><div class="btn-row"><button class="btn-amber" id="orXlsx">Download Excel workbook (.xlsx)</button><button class="btn-line" id="orPdf">Open PDF summary (Print → Save as PDF)</button></div>
        <div class="muted-text" style="margin-top:8px;">Workbook tabs: Overview, Sales Pipeline, Orders, Customers, Monthly Trend, Profitability, Order Profit, Receivables, Payables, Expenses &amp; Cash, Notes.</div></div>`;
      q('orXlsx').onclick = () => {
        const bytes = window.BookkeeperPack.xl.workbookBytes(buildSheets(rep, co));
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
        a.download = `Performance-Report_${(co.name || 'Hadrontech').replace(/[^A-Za-z0-9]+/g, '-')}_${rep.from}_to_${rep.to}.xlsx`; document.body.appendChild(a); a.click(); a.remove(); toast('Business Performance Report downloaded.');
      };
      q('orPdf').onclick = () => printShell(`Business Performance Report ${rep.from} to ${rep.to}`, summaryHTML(rep, co));
    };
    q('orPreset').onchange = () => { const v = q('orPreset').value; if (v !== 'custom') { const p = window.BookkeeperPack.periodPreset(v); q('orFrom').value = p.from; q('orTo').value = p.to; } refresh(); };
    ['orFrom', 'orTo'].forEach(id => q(id).onchange = () => { q('orPreset').value = 'custom'; refresh(); });
    refresh();
  }

  window.OwnerReport = { buildOwnerReport, buildSheets, summaryHTML, render, loadData };
})();
