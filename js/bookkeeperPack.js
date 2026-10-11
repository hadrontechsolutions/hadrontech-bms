/* ============================================================
   bookkeeperPack.js — one complete, clean package for the bookkeeper.

   The bookkeeper has no access to the BMS, so this builds ONE Excel workbook (and a printable PDF
   summary) from the records the owners already keep:

     Summary · Sales Book · Cash Receipts Book · Purchases Book · Cash Disbursements Book · Expenses ·
     Receivables (aging) · Payables (aging) · Inventory · Distributions · Business Reserve · Notes & Exclusions

   Basis (Philippine practice, RA 11976 / EOPT): a sale is recognised when it is INVOICED, not when it is paid,
   so the Sales Book is by invoice date and the Cash Receipts Book holds the collections. These are the
   source books the bookkeeper posts into the BIR-registered Journal and Ledger — the BMS itself is not a
   double-entry ledger, and the pack says so on its Notes sheet.

   Pure data building lives in buildPack() (no DOM) so it can be tested; the .xlsx file is written by hand
   (inline strings, formulas with cached values, a STORE-only zip) so it works offline with no library.
   ============================================================ */

(function () {
  const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
  const d10 = (d) => String(d || '').slice(0, 10);
  const todayStr = () => (typeof todayISO === 'function' ? todayISO() : new Date().toISOString().slice(0, 10));

  const SUGGESTED_ACCOUNT = {
    'Rent': 'Rent Expense', 'Utilities (Electricity, Water)': 'Utilities Expense', 'Communication (Phone, Internet)': 'Communication Expense',
    'Salaries & Wages': 'Salaries and Wages', 'Office Supplies': 'Office Supplies Expense', 'Transportation & Fuel': 'Transportation and Travel',
    'Professional Fees': 'Professional Fees', 'Taxes & Licenses': 'Taxes and Licenses', 'Repairs & Maintenance': 'Repairs and Maintenance',
    'Insurance': 'Insurance Expense', 'Bank Charges': 'Bank Charges', 'Representation & Entertainment': 'Representation and Entertainment',
    'Freight & Delivery': 'Freight-out / Delivery Expense', 'Miscellaneous': 'Miscellaneous Expense'
  };

  /* ---------- Period helpers ---------- */
  function addDays(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function periodPreset(kind, ref) {
    const t = ref || todayStr(); const y = +t.slice(0, 4), m = +t.slice(5, 7);
    const pad = (n) => String(n).padStart(2, '0');
    const last = (yy, mm) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
    if (kind === 'thisMonth') return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${last(y, m)}` };
    if (kind === 'lastMonth') { const yy = m === 1 ? y - 1 : y, mm = m === 1 ? 12 : m - 1; return { from: `${yy}-${pad(mm)}-01`, to: `${yy}-${pad(mm)}-${last(yy, mm)}` }; }
    const q = Math.floor((m - 1) / 3);
    if (kind === 'thisQuarter') { const sm = q * 3 + 1; return { from: `${y}-${pad(sm)}-01`, to: `${y}-${pad(sm + 2)}-${last(y, sm + 2)}` }; }
    if (kind === 'lastQuarter') { let yy = y, qq = q - 1; if (qq < 0) { qq = 3; yy = y - 1; } const sm = qq * 3 + 1; return { from: `${yy}-${pad(sm)}-01`, to: `${yy}-${pad(sm + 2)}-${last(yy, sm + 2)}` }; }
    if (kind === 'thisYear') return { from: `${y}-01-01`, to: `${y}-12-31` };
    if (kind === 'lastYear') return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${last(y, m)}` };
  }

  /* ============================================================
     buildPack — everything the workbook and the PDF need, as plain data.
     data = { settings, customers, suppliers, salesOrders, proformaInvoices, supplierPOs, expenses, distributions, products, stockMovements }
     ============================================================ */
  function buildPack(opts) {
    const { from, to } = opts; const data = opts.data;
    const settings = data.settings || {};
    const rates = Object.assign({ PHP: 1 }, settings.referenceRates || {}, opts.rates || {});
    const missingRates = new Set();
    const rate = (cur) => { const c = cur || 'PHP'; if (c === 'PHP') return 1; if (!rates[c]) { missingRates.add(c); return 1; } return Number(rates[c]); };
    const php = (amt, cur) => r2((Number(amt) || 0) * rate(cur));
    const inR = (d) => { const x = d10(d); return !!x && x >= from && x <= to; };
    const before = (d) => { const x = d10(d); return !!x && x < from; };
    const upTo = (d) => { const x = d10(d); return !!x && x <= to; };
    const custMap = {}; (data.customers || []).forEach(c => custMap[c.id] = c);
    const supMap = {}; (data.suppliers || []).forEach(s => supMap[s.id] = s);
    const soMap = {}; (data.salesOrders || []).forEach(o => soMap[o.id] = o);
    const poById = {}; (data.supplierPOs || []).forEach(p => poById[p.id] = p);
    const out = { from, to, rates: {}, warnings: [], excluded: [] };
    const used = new Set();

    /* ---- Sales (invoiced) ---- */
    const allPIs = (data.proformaInvoices || []).map(pi => { const so = soMap[pi.salesOrderId]; return { pi, so, cust: custMap[so && so.customerId] }; });
    const livePIs = allPIs.filter(x => !(x.so && x.so.status === 'Cancelled'));
    allPIs.filter(x => x.so && x.so.status === 'Cancelled' && inR(x.pi.date)).forEach(x => out.excluded.push({ type: 'Invoice', no: x.pi.piNo, date: d10(x.pi.date), party: x.cust ? x.cust.companyName : '', amount: x.pi.grandTotal, currency: x.pi.currency || 'PHP', reason: 'Sales order ' + x.so.soNo + ' is Cancelled' }));
    const paidOnPI = (pi, cutoff) => r2((pi.payments || []).filter(p => !cutoff || upTo(p.date)).reduce((s, p) => s + (Number(p.amount) || 0), 0));
    const paidBeforeFrom = (pi) => r2((pi.payments || []).filter(p => before(p.date)).reduce((s, p) => s + (Number(p.amount) || 0), 0));
    const salesRows = livePIs.filter(x => inR(x.pi.date)).sort((a, b) => d10(a.pi.date).localeCompare(d10(b.pi.date)) || String(a.pi.piNo).localeCompare(String(b.pi.piNo))).map(({ pi, so, cust }) => {
      const cur = pi.currency || 'PHP'; used.add(cur);
      const net = r2((pi.grandTotal || 0) - (pi.vatTotal || 0));
      return { date: d10(pi.date), invoiceNo: pi.piNo, orderNo: so ? so.soNo : '', customer: cust ? cust.companyName : '', tin: cust ? (cust.tin || '') : '', vatMode: (so && so.vatMode) || pi.vatMode || '', currency: cur, net, vat: r2(pi.vatTotal || 0), total: r2(pi.grandTotal || 0), rate: rate(cur), phpTotal: php(pi.grandTotal, cur), phpNet: php(net, cur), phpVat: php(pi.vatTotal, cur), paidToDate: paidOnPI(pi, true), balance: r2((pi.grandTotal || 0) - paidOnPI(pi, true)), customerId: cust && cust.id };
    });

    /* ---- Collections ---- */
    const receipts = [];
    livePIs.forEach(({ pi, so, cust }) => (pi.payments || []).filter(p => inR(p.date)).forEach(p => { const cur = pi.currency || 'PHP'; used.add(cur); receipts.push({ date: d10(p.date), ref: p.reference || '', customer: cust ? cust.companyName : '', tin: cust ? (cust.tin || '') : '', invoiceNo: pi.piNo, orderNo: so ? so.soNo : '', method: p.method || '', currency: cur, amount: r2(p.amount), rate: rate(cur), phpAmount: php(p.amount, cur) }); }));
    receipts.sort((a, b) => a.date.localeCompare(b.date) || a.invoiceNo.localeCompare(b.invoiceNo));

    /* ---- Purchases ---- */
    const livePOs = (data.supplierPOs || []).filter(p => !['Cancelled', 'Draft'].includes(p.status));
    (data.supplierPOs || []).filter(p => ['Cancelled', 'Draft'].includes(p.status) && inR(p.poDate)).forEach(p => out.excluded.push({ type: 'Supplier PO', no: p.poNo, date: d10(p.poDate), party: (supMap[p.supplierId] || {}).companyName || '', amount: p.totalCost, currency: p.currency || 'PHP', reason: 'Status is ' + p.status + (p.status === 'Draft' ? ' (not ordered yet)' : '') }));
    (data.salesOrders || []).filter(o => ['Cancelled', 'Draft'].includes(o.status) && inR(o.orderDate)).forEach(o => out.excluded.push({ type: 'Sales Order', no: o.soNo, date: d10(o.orderDate), party: (custMap[o.customerId] || {}).companyName || '', amount: o.grandTotal, currency: o.currency || 'PHP', reason: 'Status is ' + o.status }));
    const itemsTotal = (p) => r2((p.lines || []).reduce((s, l) => s + (Number(l.amount) || 0), 0));
    const purchaseRows = livePOs.filter(p => inR(p.poDate)).sort((a, b) => d10(a.poDate).localeCompare(d10(b.poDate)) || String(a.poNo).localeCompare(String(b.poNo))).map(p => {
      const sup = supMap[p.supplierId] || {}; const cur = p.currency || 'PHP'; used.add(cur);
      return { date: d10(p.poDate), poNo: p.poNo, supplier: sup.companyName || '', tin: sup.tin || '', country: sup.country || '', salesOrder: (soMap[p.salesOrderId] || {}).soNo || '', status: p.status, currency: cur, items: itemsTotal(p), freight: r2(p.freight || 0), taxes: r2(p.taxes || 0), total: r2(p.totalCost || 0), rate: rate(cur), phpTotal: php(p.totalCost, cur), supplierId: p.supplierId };
    });

    /* ---- Supplier payments ---- */
    const supplierPayments = [];
    livePOs.forEach(p => (p.payments || []).filter(x => inR(x.date)).forEach(x => { const sup = supMap[p.supplierId] || {}; const cur = p.currency || 'PHP'; used.add(cur); supplierPayments.push({ date: d10(x.date), payee: sup.companyName || '', ref: x.reference || '', particulars: 'Payment of ' + p.poNo, method: x.method || '', currency: cur, amount: r2(x.amount), rate: rate(cur), phpAmount: php(x.amount, cur) }); }));

    /* ---- Expenses ---- */
    const expenseRows = (data.expenses || []).filter(x => inR(x.date)).sort((a, b) => String(a.category).localeCompare(String(b.category)) || d10(a.date).localeCompare(d10(b.date))).map(x => ({ date: d10(x.date), expenseNo: x.expenseNo || '', category: x.category || '', account: SUGGESTED_ACCOUNT[x.category] || 'Miscellaneous Expense', description: x.description || '', payee: x.payee || '', method: x.paymentMethod || '', ref: x.referenceNo || '', amount: r2(x.amount) }));
    const expenseByCategory = {}; expenseRows.forEach(x => { expenseByCategory[x.category] = (expenseByCategory[x.category] || { count: 0, total: 0, account: x.account }); expenseByCategory[x.category].count++; expenseByCategory[x.category].total = r2(expenseByCategory[x.category].total + x.amount); });

    /* ---- Distributions & reserve ---- */
    const mFrom = from.slice(0, 7), mTo = to.slice(0, 7);
    const dists = (data.distributions || []).filter(d => d.month && d.month >= mFrom && d.month <= mTo).sort((a, b) => String(a.month).localeCompare(String(b.month)));
    const distRows = [];
    dists.forEach(d => (d.splits || []).forEach(s => distRows.push({ distNo: d.distributionNo || '', month: d.month, name: s.partnerName || '', type: (s.partnerType === 'Employee') ? 'Employee compensation' : 'Owner draw (partner)', percent: Number(s.percent) || 0, gross: r2(s.amount), net: r2(s.netPay != null ? s.netPay : s.amount), paidDate: d10(s.paidDate), method: s.paidMethod || '', ref: s.paidReference || '' })));
    const reserveAdded = r2(dists.reduce((s, d) => s + (Number(d.reserveAmount) || 0), 0));
    const withdrawals = (settings.reserveWithdrawals || []).filter(w => inR(w.date)).sort((a, b) => d10(a.date).localeCompare(d10(b.date)));
    const reserveBalanceEnd = r2((data.distributions || []).filter(d => d.month && d.month <= mTo).reduce((s, d) => s + (Number(d.reserveAmount) || 0), 0) - (settings.reserveWithdrawals || []).filter(w => upTo(w.date)).reduce((s, w) => s + (Number(w.amount) || 0), 0));
    const reserveBalanceStart = r2((data.distributions || []).filter(d => d.month && d.month < mFrom).reduce((s, d) => s + (Number(d.reserveAmount) || 0), 0) - (settings.reserveWithdrawals || []).filter(w => before(w.date)).reduce((s, w) => s + (Number(w.amount) || 0), 0));

    /* ---- Cash disbursements book ---- */
    const disbursements = [];
    supplierPayments.forEach(x => disbursements.push({ date: x.date, type: 'Supplier payment', payee: x.payee, particulars: x.particulars, ref: x.ref, method: x.method, currency: x.currency, amount: x.amount, rate: x.rate, phpAmount: x.phpAmount }));
    expenseRows.forEach(x => disbursements.push({ date: x.date, type: 'Operating expense', payee: x.payee, particulars: x.category + ' — ' + x.description, ref: x.ref || x.expenseNo, method: x.method, currency: 'PHP', amount: x.amount, rate: 1, phpAmount: x.amount }));
    dists.forEach(d => (d.splits || []).filter(s => inR(s.paidDate)).forEach(s => { const net = r2(s.netPay != null ? s.netPay : s.amount); disbursements.push({ date: d10(s.paidDate), type: s.partnerType === 'Employee' ? 'Employee compensation' : 'Owner draw', payee: s.partnerName || '', particulars: (d.distributionNo || 'Distribution') + ' · ' + d.month, ref: s.paidReference || '', method: s.paidMethod || '', currency: 'PHP', amount: net, rate: 1, phpAmount: net }); }));
    withdrawals.forEach(w => { /* reserve withdrawals are internal movements, shown on the Business Reserve sheet only */ });
    disbursements.sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type));

    /* ---- Receivables / payables (balances at period end, aging by document date) ---- */
    const bucketOf = (days) => days <= 30 ? 'b0' : days <= 60 ? 'b30' : days <= 90 ? 'b60' : 'b90';
    const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
    const arRows = [];
    livePIs.filter(x => upTo(x.pi.date)).forEach(({ pi, so, cust }) => { const cur = pi.currency || 'PHP'; const bal = r2((pi.grandTotal || 0) - paidOnPI(pi, true)); if (bal > 0.004) { const dd = daysBetween(d10(pi.date), to); const b = bucketOf(dd); used.add(cur); arRows.push({ invoiceNo: pi.piNo, orderNo: so ? so.soNo : '', customer: cust ? cust.companyName : '', tin: cust ? (cust.tin || '') : '', date: d10(pi.date), days: dd, currency: cur, total: r2(pi.grandTotal), paid: paidOnPI(pi, true), balance: bal, rate: rate(cur), phpBalance: php(bal, cur), bucket: b }); } });
    arRows.sort((a, b) => b.days - a.days);
    const arOpening = r2(livePIs.filter(x => before(x.pi.date)).reduce((s, x) => s + php(x.pi.grandTotal, x.pi.currency) - php(paidBeforeFrom(x.pi), x.pi.currency), 0));
    const apRows = [];
    const paidOnPO = (p, cutoff) => r2((p.payments || []).filter(x => !cutoff || upTo(x.date)).reduce((s, x) => s + (Number(x.amount) || 0), 0));
    livePOs.filter(p => upTo(p.poDate)).forEach(p => { const cur = p.currency || 'PHP'; const bal = r2((p.totalCost || 0) - paidOnPO(p, true)); if (bal > 0.004 && (p.totalCost || 0) > 0) { const dd = daysBetween(d10(p.poDate), to); used.add(cur); apRows.push({ poNo: p.poNo, supplier: (supMap[p.supplierId] || {}).companyName || '', tin: (supMap[p.supplierId] || {}).tin || '', date: d10(p.poDate), days: dd, status: p.status, currency: cur, total: r2(p.totalCost), paid: paidOnPO(p, true), balance: bal, rate: rate(cur), phpBalance: php(bal, cur), bucket: bucketOf(dd) }); } });
    apRows.sort((a, b) => b.days - a.days);
    const apOpening = r2(livePOs.filter(p => before(p.poDate)).reduce((s, p) => s + php(p.totalCost, p.currency) - php((p.payments || []).filter(x => before(x.date)).reduce((t, x) => t + (Number(x.amount) || 0), 0), p.currency), 0));

    /* ---- Inventory (stock-tracked catalog items, at standard cost) ---- */
    const qtyBy = {};
    (data.stockMovements || []).filter(m => upTo(m.date)).forEach(m => { qtyBy[m.productId] = r2((qtyBy[m.productId] || 0) + (Number(m.qty) || 0)); });
    const inventoryRows = (data.products || []).filter(p => p.type !== 'Project Package' && Math.abs(qtyBy[p.id] || 0) > 0.0001).map(p => { const cur = p.currency || 'PHP'; used.add(cur); const unit = php(p.standardCost, cur); return { itemNo: p.itemNo || '', description: p.description || '', uom: p.uom || '', qty: qtyBy[p.id], currency: cur, unitCost: r2(p.standardCost), rate: rate(cur), phpUnit: unit, phpValue: r2(unit * qtyBy[p.id]) }; }).sort((a, b) => String(a.itemNo).localeCompare(String(b.itemNo)));

    /* ---- Totals & summary ---- */
    const sum = (arr, k) => r2(arr.reduce((s, x) => s + (Number(x[k]) || 0), 0));
    const t = {
      salesNet: sum(salesRows, 'phpNet'), salesVat: sum(salesRows, 'phpVat'), salesTotal: sum(salesRows, 'phpTotal'),
      collections: sum(receipts, 'phpAmount'), purchases: sum(purchaseRows, 'phpTotal'), supplierPaid: sum(supplierPayments, 'phpAmount'),
      expenses: sum(expenseRows, 'amount'),
      ownerDrawsPaid: r2(disbursements.filter(x => x.type === 'Owner draw').reduce((s, x) => s + x.phpAmount, 0)),
      employeePaid: r2(disbursements.filter(x => x.type === 'Employee compensation').reduce((s, x) => s + x.phpAmount, 0)),
      arOpening, arClosing: sum(arRows, 'phpBalance'), apOpening, apClosing: sum(apRows, 'phpBalance'), inventory: sum(inventoryRows, 'phpValue'),
      reserveStart: reserveBalanceStart, reserveAdded, reserveUsed: r2(withdrawals.reduce((s, w) => s + (Number(w.amount) || 0), 0)), reserveEnd: reserveBalanceEnd
    };
    t.disbursements = sum(disbursements, 'phpAmount');
    t.marginPurchasesBasis = r2(t.salesNet - t.purchases);
    t.resultBeforeDraws = r2(t.marginPurchasesBasis - t.expenses);
    t.arDiff = r2(t.arClosing - (t.arOpening + t.salesTotal - t.collections));
    t.apDiff = r2(t.apClosing - (t.apOpening + t.purchases - t.supplierPaid));
    const aging = (rows, k) => ({ b0: sum(rows.filter(x => x.bucket === 'b0'), k), b30: sum(rows.filter(x => x.bucket === 'b30'), k), b60: sum(rows.filter(x => x.bucket === 'b60'), k), b90: sum(rows.filter(x => x.bucket === 'b90'), k) });
    const arAging = aging(arRows, 'phpBalance'), apAging = aging(apRows, 'phpBalance');

    // Quarterly gross sales for the calendar year of the period end (the base figure behind the quarterly returns)
    const yr = to.slice(0, 4); const quarters = [1, 2, 3, 4].filter(q => `${yr}-${String((q - 1) * 3 + 1).padStart(2, '0')}-01` <= to).map(q => { const qf = `${yr}-${String((q - 1) * 3 + 1).padStart(2, '0')}-01`; const qt = `${yr}-${String(q * 3).padStart(2, '0')}-${new Date(Date.UTC(+yr, q * 3, 0)).getUTCDate()}`; const rows = livePIs.filter(x => { const d = d10(x.pi.date); return d >= qf && d <= qt; }); return { q, from: qf, to: qt, invoices: rows.length, gross: r2(rows.reduce((s, x) => s + php(x.pi.grandTotal, x.pi.currency), 0)), collected: r2(livePIs.reduce((s, x) => s + (x.pi.payments || []).filter(p => d10(p.date) >= qf && d10(p.date) <= qt).reduce((u, p) => u + php(p.amount, x.pi.currency), 0), 0)) }; });
    const ytdSales = r2(livePIs.filter(x => d10(x.pi.date) >= `${yr}-01-01` && d10(x.pi.date) <= to).reduce((s, x) => s + php(x.pi.grandTotal, x.pi.currency), 0));

    /* ---- Warnings / data-quality ---- */
    const w = out.warnings;
    const noTinCust = [...new Set(salesRows.filter(r => !r.tin).map(r => r.customer))].filter(Boolean);
    if (noTinCust.length) w.push({ level: 'warn', text: `${noTinCust.length} customer(s) invoiced this period have no TIN on file: ${noTinCust.slice(0, 6).join(', ')}${noTinCust.length > 6 ? '…' : ''}.` });
    const noTinSup = [...new Set(purchaseRows.filter(r => !r.tin).map(r => r.supplier))].filter(Boolean);
    if (noTinSup.length) w.push({ level: 'info', text: `${noTinSup.length} supplier(s) have no TIN recorded (add it on the Supplier page): ${noTinSup.slice(0, 6).join(', ')}${noTinSup.length > 6 ? '…' : ''}.` });
    const foreign = [...used].filter(c => c !== 'PHP');
    if (foreign.length) w.push({ level: 'info', text: `Foreign-currency documents are converted to PHP at the rates shown on the Summary (${foreign.map(c => c + ' @ ' + rate(c)).join(', ')}). The BMS does not store a rate per document, so please confirm these with the actual rates used.` });
    if (missingRates.size) w.push({ level: 'warn', text: `No exchange rate set for ${[...missingRates].join(', ')} — treated as 1:1. Set it before sending.` });
    const noRefExp = expenseRows.filter(x => !x.ref).length;
    if (noRefExp) w.push({ level: 'warn', text: `${noRefExp} expense(s) have no receipt / reference number.` });
    const noRefRec = receipts.filter(x => !x.ref).length;
    if (noRefRec) w.push({ level: 'info', text: `${noRefRec} collection(s) have no payment reference.` });
    const deliveredNoPI = (data.salesOrders || []).filter(o => o.status === 'Delivered' && !allPIs.some(x => x.pi.salesOrderId === o.id)).map(o => o.soNo);
    if (deliveredNoPI.length) w.push({ level: 'warn', text: `${deliveredNoPI.length} delivered sales order(s) have no invoice yet and are therefore NOT in the Sales Book: ${deliveredNoPI.slice(0, 6).join(', ')}${deliveredNoPI.length > 6 ? '…' : ''}.` });
    if (Math.abs(t.arDiff) > 0.01) w.push({ level: 'warn', text: `Receivables roll-forward is off by ${t.arDiff.toFixed(2)} (usually a payment dated before its invoice). Please review.` });
    if (Math.abs(t.apDiff) > 0.01) w.push({ level: 'warn', text: `Payables roll-forward is off by ${t.apDiff.toFixed(2)} (usually a payment dated before its PO). Please review.` });
    if (ytdSales > 3000000) w.push({ level: 'warn', text: `Year-to-date invoiced sales are ${ytdSales.toFixed(2)} — above the ₱3,000,000 threshold. Please check VAT-registration and audited-statement requirements with your accountant.` });

    out.rates = Object.fromEntries([...used].filter(c => c !== 'PHP').map(c => [c, rate(c)]));
    Object.assign(out, { salesRows, receipts, purchaseRows, supplierPayments, expenseRows, expenseByCategory, distRows, withdrawals, disbursements, arRows, apRows, arAging, apAging, inventoryRows, totals: t, quarters, ytdSales, year: yr });
    return out;
  }

  /* ============================================================
     Minimal .xlsx writer (inline strings, formulas + cached values, STORE zip)
     ============================================================ */
  const X = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  const colName = (i) => { let n = i + 1, s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const serial = (iso) => Math.round((Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86400000);
  const STYLE = { def: 0, title: 1, sub: 2, hdr: 3, txt: 4, money: 5, date: 6, qty: 7, rate: 8, totLbl: 9, totMoney: 10, section: 11, note: 12, warn: 13, ok: 14, bold: 15, boldMoney: 16, pct: 17, wrap: 18, plainMoney: 19, int: 20, hdrR: 21, info: 22 };

  function stylesXML() {
    const f = (b, sz, color, i) => `<font>${b ? '<b/>' : ''}${i ? '<i/>' : ''}<sz val="${sz}"/>${color ? `<color rgb="FF${color}"/>` : ''}<name val="Calibri"/></font>`;
    const fonts = [f(0, 10), f(1, 10), f(1, 10, 'FFFFFF'), f(1, 15, '151D2B'), f(0, 9, '6B7686', 1), f(1, 10, 'B3261E'), f(1, 10, '0A7A52')];
    const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>', '<fill><patternFill patternType="solid"><fgColor rgb="FF151D2B"/></patternFill></fill>', '<fill><patternFill patternType="solid"><fgColor rgb="FFEEF1F6"/></patternFill></fill>', '<fill><patternFill patternType="solid"><fgColor rgb="FFFFF3E2"/></patternFill></fill>'];
    const borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>', '<border><left/><right/><top/><bottom style="thin"><color rgb="FFE1E6EE"/></bottom><diagonal/></border>', '<border><left/><right/><top style="thin"><color rgb="FF151D2B"/></top><bottom style="double"><color rgb="FF151D2B"/></bottom><diagonal/></border>'];
    const xf = (num, font, fill, border, align) => `<xf numFmtId="${num}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"${align ? ' applyAlignment="1"' : ''}>${align ? `<alignment ${align}/>` : ''}</xf>`;
    const xfs = [
      xf(0, 0, 0, 0), xf(0, 3, 0, 0), xf(0, 4, 0, 0), xf(0, 2, 2, 0, 'vertical="center" wrapText="1"'), xf(0, 0, 0, 1, 'vertical="top"'), xf(164, 0, 0, 1),
      xf(165, 0, 0, 1, 'horizontal="left"'), xf(168, 0, 0, 1), xf(167, 0, 0, 1), xf(0, 1, 0, 2), xf(164, 1, 0, 2), xf(0, 1, 3, 0), xf(0, 4, 0, 0, 'wrapText="1" vertical="top"'),
      xf(0, 5, 0, 0, 'wrapText="1" vertical="top"'), xf(0, 6, 0, 0, 'wrapText="1" vertical="top"'), xf(0, 1, 0, 0), xf(164, 1, 0, 0), xf(166, 0, 0, 1), xf(0, 0, 0, 0, 'wrapText="1" vertical="top"'),
      xf(164, 0, 0, 0), xf(1, 0, 0, 1), xf(0, 2, 2, 0, 'horizontal="right" vertical="center" wrapText="1"'), xf(0, 0, 4, 0, 'wrapText="1" vertical="top"')
    ];
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="5"><numFmt numFmtId="164" formatCode="#,##0.00;[Red]\\-#,##0.00"/><numFmt numFmtId="165" formatCode="yyyy\\-mm\\-dd"/><numFmt numFmtId="166" formatCode="0.0%"/><numFmt numFmtId="167" formatCode="#,##0.0000"/><numFmt numFmtId="168" formatCode="#,##0.##"/></numFmts><fonts count="${fonts.length}">${fonts.join('')}</fonts><fills count="${fills.length}">${fills.join('')}</fills><borders count="${borders.length}">${borders.join('')}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  }

  /* sheet = { name, widths:[..], rows:[[cell,...]], freezeRow, filterRow, merges:[..], landscape } ; cell = null | string | number | {v, s, f} */
  function sheetXML(sh) {
    let rowsXML = ''; let maxCol = 0;
    sh.rows.forEach((row, ri) => {
      if (!row) { return; }
      let cells = '';
      row.forEach((c, ci) => {
        if (c == null || c === '') return;
        const o = (typeof c === 'object') ? c : { v: c };
        const ref = colName(ci) + (ri + 1); maxCol = Math.max(maxCol, ci + 1);
        const s = o.s != null ? STYLE[o.s] : (typeof o.v === 'number' ? STYLE.plainMoney : STYLE.def);
        if (o.f) cells += `<c r="${ref}" s="${s}"><f>${X(o.f)}</f><v>${Number(o.v) || 0}</v></c>`;
        else if (o.d) cells += `<c r="${ref}" s="${s}"><v>${serial(o.d)}</v></c>`;
        else if (typeof o.v === 'number') cells += `<c r="${ref}" s="${s}"><v>${o.v}</v></c>`;
        else cells += `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${X(o.v)}</t></is></c>`;
      });
      const ht = sh.heights && sh.heights[ri] ? ` ht="${sh.heights[ri]}" customHeight="1"` : '';
      rowsXML += `<row r="${ri + 1}"${ht}>${cells}</row>`;
    });
    const cols = (sh.widths || []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
    const pane = sh.freezeRow ? `<sheetView workbookViewId="0" showGridLines="0"><pane ${sh.freezeCol ? `xSplit="${sh.freezeCol}" ` : ''}ySplit="${sh.freezeRow}" topLeftCell="${colName(sh.freezeCol || 0)}${sh.freezeRow + 1}" activePane="${sh.freezeCol ? 'bottomRight' : 'bottomLeft'}" state="frozen"/></sheetView>` : '<sheetView workbookViewId="0" showGridLines="0"/>';
    const filter = sh.filterRow ? `<autoFilter ref="A${sh.filterRow}:${colName((sh.widths || []).length - 1)}${sh.filterEnd || sh.filterRow}"/>` : '';
    const merges = (sh.merges || []).length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews>${pane}</sheetViews><sheetFormatPr defaultRowHeight="14"/><cols>${cols}</cols><sheetData>${rowsXML}</sheetData>${filter}${merges}<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="${sh.landscape === false ? 'portrait' : 'landscape'}" fitToWidth="1" fitToHeight="0"/><headerFooter><oddFooter>&amp;L&amp;A&amp;RPage &amp;P of &amp;N</oddFooter></headerFooter></worksheet>`;
  }

  function utf8(str) {
    const out = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i);
      if (c >= 0xD800 && c < 0xDC00 && i + 1 < str.length) { const d = str.charCodeAt(i + 1); if (d >= 0xDC00 && d < 0xE000) { c = 0x10000 + ((c - 0xD800) << 10) + (d - 0xDC00); i++; } }
      if (c < 0x80) out.push(c); else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63)); else if (c < 0x10000) out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); else out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
    return new Uint8Array(out);
  }
  let CRC_T = null;
  function crc32(buf) { if (!CRC_T) { CRC_T = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); CRC_T[n] = c >>> 0; } } let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zipStore(files) {
    const now = new Date(); const dt = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate(); const tm = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const chunks = []; const central = []; let offset = 0;
    const u16 = (n) => [n & 255, (n >> 8) & 255]; const u32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
    files.forEach(f => { const name = utf8(f.name); const data = typeof f.data === 'string' ? utf8(f.data) : f.data; const crc = crc32(data);
      const lh = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(tm), ...u16(dt), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)]);
      chunks.push(lh, name, data);
      central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(tm), ...u16(dt), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name);
      offset += lh.length + name.length + data.length; });
    const cdStart = offset; let cdSize = 0; central.forEach(c => { chunks.push(c); cdSize += c.length; });
    chunks.push(new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(cdStart), ...u16(0)]));
    const total = chunks.reduce((s, c) => s + c.length, 0); const out = new Uint8Array(total); let p = 0; chunks.forEach(c => { out.set(c, p); p += c.length; }); return out;
  }
  function workbookBytes(sheets) {
    const files = [
      { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
      { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${sheets.map((s, i) => `<sheet name="${X(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
      { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: 'xl/styles.xml', data: stylesXML() }
    ];
    sheets.forEach((s, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXML(s) }));
    return zipStore(files);
  }

  /* ============================================================
     Sheets
     ============================================================ */
  const money = (v) => ({ v: r2(v), s: 'money' });
  const H = (labels) => labels.map(l => ({ v: l, s: /^(Amount|Total|Net|VAT|Items|Freight|Taxes|Paid|Balance|Qty|Rate|Unit|Value|Gross|Days|Current|1-|31-|61-|Over|PHP|%)/.test(l) ? 'hdrR' : 'hdr' }));
  function titleBlock(co, title, period, extra) {
    return [[{ v: title, s: 'title' }], [{ v: `${co.name}${co.tin ? '  ·  TIN ' + co.tin : ''}`, s: 'sub' }], [{ v: period + (extra ? '  ·  ' + extra : ''), s: 'sub' }], []];
  }

  function buildSheets(pack, co) {
    const t = pack.totals; const period = `Period: ${pack.from} to ${pack.to}`; const sheets = [];
    const colSum = (col, r1, r2_) => `SUM(${col}${r1}:${col}${r2_})`;

    /* --- Summary --- */
    const S = [];
    S.push([{ v: 'BOOKKEEPER PACK', s: 'title' }]);
    S.push([{ v: co.name, s: 'bold' }]);
    S.push([{ v: [co.address, co.tin ? 'TIN: ' + co.tin : '', 'Sole proprietorship · Non-VAT registered'].filter(Boolean).join('  ·  '), s: 'sub' }]);
    S.push([{ v: period + `   ·   Prepared ${todayStr()} from the Hadrontech BMS (unaudited management records)`, s: 'sub' }]);
    S.push([]);
    const sec = (title) => { S.push([{ v: title, s: 'section' }, { v: '', s: 'section' }, { v: '', s: 'section' }, { v: '', s: 'section' }]); };
    const line = (label, val, note, bold) => S.push([{ v: label, s: bold ? 'bold' : 'txt' }, { v: r2(val), s: bold ? 'totMoney' : 'money' }, { v: note || '', s: 'sub' }]);
    sec('1. Income statement items for the period (management basis, PHP)');
    line('Sales invoiced (net of VAT, if any)', t.salesNet, 'Sales Book — recognised on invoice date');
    line('Output VAT charged', t.salesVat, 'Business is Non-VAT, so normally 0');
    line('Total invoiced (gross sales)', t.salesTotal, 'Base for the quarterly percentage-tax / income-tax returns', true);
    line('Purchases of goods (Supplier POs ordered in the period)', t.purchases, 'Purchases Book — Draft and Cancelled POs excluded');
    line('Gross margin on a purchases basis', t.marginPurchasesBasis, 'Sales (net) less purchases. Inventory movement is NOT adjusted — see Inventory sheet', true);
    line('Operating expenses', t.expenses, 'Expenses sheet');
    line('Result before owner draws and employee distributions', t.resultBeforeDraws, 'Indicative only; the bookkeeper should adjust for opening/closing inventory and accruals', true);
    S.push([]);
    sec('2. Cash movements in the period (PHP)');
    line('Cash received from customers', t.collections, 'Cash Receipts Book');
    line('Paid to suppliers', t.supplierPaid, 'Cash Disbursements Book — supplier payments');
    line('Operating expenses paid', t.expenses, 'Cash Disbursements Book — expenses (recorded as paid)');
    line('Owner draws paid out', t.ownerDrawsPaid, 'Distributions sheet — partners');
    line('Employee compensation paid via distributions', t.employeePaid, 'Distributions sheet — employees (payslips)');
    line('Total cash disbursements', t.disbursements, '', true);
    S.push([]);
    sec('3. Receivables & payables roll-forward (PHP)');
    line('Accounts receivable — opening', t.arOpening, 'Unpaid invoices at the start of the period');
    line('+ Invoiced in the period', t.salesTotal);
    line('− Collected in the period', -t.collections);
    line('Accounts receivable — closing', t.arClosing, 'Receivables sheet. Check difference: ' + t.arDiff.toFixed(2), true);
    line('Accounts payable — opening', t.apOpening, 'Unpaid supplier POs at the start of the period');
    line('+ Purchases in the period', t.purchases);
    line('− Paid to suppliers', -t.supplierPaid);
    line('Accounts payable — closing', t.apClosing, 'Payables sheet. Check difference: ' + t.apDiff.toFixed(2), true);
    S.push([]);
    sec('4. Other balances at period end (PHP)');
    line('Inventory on hand (at standard cost)', t.inventory, 'Inventory sheet — catalog items only; project items are not kept in stock');
    line('Business Reserve balance', t.reserveEnd, `Business Reserve sheet (opening ${t.reserveStart.toFixed(2)}, +${t.reserveAdded.toFixed(2)} set aside, −${t.reserveUsed.toFixed(2)} used)`);
    S.push([]);
    sec(`5. Gross sales per quarter, ${pack.year} (invoiced, PHP)`);
    S.push([{ v: 'Quarter', s: 'hdr' }, { v: 'Gross sales invoiced', s: 'hdrR' }, { v: 'Invoices', s: 'hdrR' }, { v: 'Cash collected', s: 'hdrR' }]);
    const qStart = S.length + 1;
    pack.quarters.forEach(q => S.push([{ v: `Q${q.q}  (${q.from} – ${q.to})`, s: 'txt' }, money(q.gross), { v: q.invoices, s: 'int' }, money(q.collected)]));
    S.push([{ v: 'Year total', s: 'totLbl' }, { v: r2(pack.quarters.reduce((s, q) => s + q.gross, 0)), s: 'totMoney', f: colSum('B', qStart, S.length) }, { v: pack.quarters.reduce((s, q) => s + q.invoices, 0), s: 'totLbl', f: colSum('C', qStart, S.length) }, { v: r2(pack.quarters.reduce((s, q) => s + q.collected, 0)), s: 'totMoney', f: colSum('D', qStart, S.length) }]);
    S.push([{ v: `Year-to-date invoiced sales through ${pack.to}: ${pack.ytdSales.toFixed(2)}`, s: 'note' }]);
    S.push([]);
    sec('6. Exchange rates used (PHP per 1 unit)');
    const rk = Object.keys(pack.rates);
    if (!rk.length) S.push([{ v: 'All documents in this period are in PHP.', s: 'note' }]); else rk.forEach(c => S.push([{ v: c, s: 'txt' }, { v: pack.rates[c], s: 'rate' }]));
    S.push([]);
    sec('7. Please note');
    if (!pack.warnings.length) S.push([{ v: 'No data-quality warnings.', s: 'ok' }]);
    pack.warnings.forEach(w => S.push([{ v: (w.level === 'warn' ? '⚠ ' : 'ℹ ') + w.text, s: w.level === 'warn' ? 'warn' : 'info' }]));
    sheets.push({ name: 'Summary', widths: [58, 20, 16, 20], rows: S, landscape: false, merges: S.map((r, i) => (r.length === 1 && r[0] && (r[0].s === 'warn' || r[0].s === 'info' || r[0].s === 'ok' || (r[0].s === 'note'))) ? `A${i + 1}:D${i + 1}` : null).filter(Boolean), heights: Object.fromEntries(S.map((r, i) => [i, (r.length === 1 && r[0] && (r[0].s === 'warn' || r[0].s === 'info') && String(r[0].v).length > 95) ? 15 * Math.ceil(String(r[0].v).length / 95) : 0]).filter(x => x[1])) });

    const dataSheet = (name, title, headers, widths, rowsFn, sumCols, opts2) => {
      const rows = titleBlock(co, title, period, opts2 && opts2.extra); const hdrIdx = rows.length + 1; rows.push(H(headers));
      const body = rowsFn(); const first = rows.length + 1; body.forEach(r => rows.push(r)); const last = rows.length;
      if (body.length) { const tot = headers.map(() => null); tot[0] = { v: 'TOTAL', s: 'totLbl' }; for (let i = 1; i < headers.length; i++) tot[i] = { v: '', s: 'totLbl' }; sumCols.forEach(([ci, val]) => { tot[ci] = { v: r2(val), s: 'totMoney', f: colSum(colName(ci), first, last) }; }); rows.push(tot); }
      else rows.push([{ v: 'No records in this period.', s: 'note' }]);
      let merges, heights;
      if (opts2 && opts2.note) { rows.push([]); rows.push([{ v: opts2.note, s: 'note' }]); const ri = rows.length; merges = [`A${ri}:${colName(headers.length - 1)}${ri}`]; const totalW = widths.reduce((a, b) => a + b, 0); heights = { [ri - 1]: 13 * Math.max(1, Math.ceil(opts2.note.length * 1.1 / totalW)) + 4 }; }
      sheets.push({ name, widths, rows, freezeRow: hdrIdx, filterRow: hdrIdx, filterEnd: last, merges, heights });
    };

    dataSheet('Sales Book', 'SALES BOOK (Sales Journal) — by invoice date', ['Date', 'Invoice No.', 'Sales Order', 'Customer', 'TIN', 'Cur', 'Net Sales', 'VAT', 'Total Invoiced', 'Rate', 'PHP Net', 'PHP VAT', 'PHP Total', 'Paid to date*', 'Balance*'],
      [11, 15, 14, 34, 16, 6, 14, 11, 15, 9, 15, 12, 16, 15, 15],
      () => pack.salesRows.map(r => [{ d: r.date, s: 'date' }, { v: r.invoiceNo, s: 'txt' }, { v: r.orderNo, s: 'txt' }, { v: r.customer, s: 'txt' }, { v: r.tin, s: 'txt' }, { v: r.currency, s: 'txt' }, money(r.net), money(r.vat), money(r.total), { v: r.rate, s: 'rate' }, money(r.phpNet), money(r.phpVat), money(r.phpTotal), money(r.paidToDate), money(r.balance)]),
      [[6, pack.salesRows.reduce((s, r) => s + (r.currency === 'PHP' ? r.net : 0), 0)], [8, pack.salesRows.reduce((s, r) => s + (r.currency === 'PHP' ? r.total : 0), 0)], [10, t.salesNet], [11, t.salesVat], [12, t.salesTotal]],
      { note: '* Paid to date and Balance are as of the period end. Net / VAT / Total columns total PHP invoices only; use the PHP columns for the converted grand total. "Invoice No." is the BMS invoice reference — if you issue a separate BIR-registered invoice, match it by customer and amount.' });

    dataSheet('Cash Receipts', 'CASH RECEIPTS BOOK — collections from customers', ['Date', 'Payment Ref.', 'Customer', 'TIN', 'Invoice No.', 'Sales Order', 'Method', 'Cur', 'Amount', 'Rate', 'PHP Amount'],
      [11, 22, 34, 16, 15, 14, 14, 6, 15, 9, 16],
      () => pack.receipts.map(r => [{ d: r.date, s: 'date' }, { v: r.ref, s: 'txt' }, { v: r.customer, s: 'txt' }, { v: r.tin, s: 'txt' }, { v: r.invoiceNo, s: 'txt' }, { v: r.orderNo, s: 'txt' }, { v: r.method, s: 'txt' }, { v: r.currency, s: 'txt' }, money(r.amount), { v: r.rate, s: 'rate' }, money(r.phpAmount)]),
      [[8, pack.receipts.reduce((s, r) => s + (r.currency === 'PHP' ? r.amount : 0), 0)], [10, t.collections]]);

    dataSheet('Purchases Book', 'PURCHASES BOOK (Purchases Journal) — Supplier POs by PO date', ['Date', 'PO No.', 'Supplier', 'TIN', 'Country', 'Sales Order', 'Status', 'Cur', 'Items', 'Freight', 'Taxes', 'Total', 'Rate', 'PHP Total'],
      [11, 15, 34, 16, 14, 14, 20, 6, 14, 12, 11, 15, 9, 16],
      () => pack.purchaseRows.map(r => [{ d: r.date, s: 'date' }, { v: r.poNo, s: 'txt' }, { v: r.supplier, s: 'txt' }, { v: r.tin, s: 'txt' }, { v: r.country, s: 'txt' }, { v: r.salesOrder, s: 'txt' }, { v: r.status, s: 'txt' }, { v: r.currency, s: 'txt' }, money(r.items), money(r.freight), money(r.taxes), money(r.total), { v: r.rate, s: 'rate' }, money(r.phpTotal)]),
      [[8, pack.purchaseRows.reduce((s, r) => s + (r.currency === 'PHP' ? r.items : 0), 0)], [9, pack.purchaseRows.reduce((s, r) => s + (r.currency === 'PHP' ? r.freight : 0), 0)], [10, pack.purchaseRows.reduce((s, r) => s + (r.currency === 'PHP' ? r.taxes : 0), 0)], [11, pack.purchaseRows.reduce((s, r) => s + (r.currency === 'PHP' ? r.total : 0), 0)], [13, t.purchases]],
      { note: 'Draft and Cancelled POs are excluded (see Notes & Exclusions). Item/Freight/Taxes/Total columns total PHP POs only; use PHP Total for the converted figure. Supplier invoice numbers are not stored per PO in the BMS — see the payment reference on the Cash Disbursements Book.' });

    dataSheet('Cash Disbursements', 'CASH DISBURSEMENTS BOOK — all payments made', ['Date', 'Type', 'Payee', 'Particulars', 'Reference', 'Method', 'Cur', 'Amount', 'Rate', 'PHP Amount'],
      [11, 22, 30, 44, 22, 14, 6, 15, 9, 16],
      () => pack.disbursements.map(r => [{ d: r.date, s: 'date' }, { v: r.type, s: 'txt' }, { v: r.payee, s: 'txt' }, { v: r.particulars, s: 'txt' }, { v: r.ref, s: 'txt' }, { v: r.method, s: 'txt' }, { v: r.currency, s: 'txt' }, money(r.amount), { v: r.rate, s: 'rate' }, money(r.phpAmount)]),
      [[7, pack.disbursements.reduce((s, r) => s + (r.currency === 'PHP' ? r.amount : 0), 0)], [9, t.disbursements]],
      { note: 'Includes supplier payments, operating expenses (as recorded, dated on the expense date), and owner / employee payouts marked as paid in Distributions. Reserve withdrawals are internal and shown on the Business Reserve sheet.' });

    // Expenses with category subtotals
    {
      const rows = titleBlock(co, 'OPERATING EXPENSES — by category', period); const hdrIdx = rows.length + 1;
      rows.push(H(['Date', 'Expense No.', 'Category', 'Suggested account', 'Description', 'Payee', 'Method', 'Reference / OR No.', 'Amount']));
      const first = rows.length + 1; let cat = null, catStart = 0; const subRows = [];
      const closeCat = () => { if (cat !== null) { const lastR = rows.length; const amt = pack.expenseByCategory[cat].total; rows.push([{ v: `Subtotal — ${cat}`, s: 'bold' }, null, null, null, null, null, null, null, { v: amt, s: 'boldMoney', f: `SUM(I${catStart}:I${lastR})` }]); subRows.push(rows.length); } };
      pack.expenseRows.forEach(x => { if (x.category !== cat) { closeCat(); cat = x.category; catStart = rows.length + 1; } rows.push([{ d: x.date, s: 'date' }, { v: x.expenseNo, s: 'txt' }, { v: x.category, s: 'txt' }, { v: x.account, s: 'txt' }, { v: x.description, s: 'txt' }, { v: x.payee, s: 'txt' }, { v: x.method, s: 'txt' }, { v: x.ref, s: 'txt' }, money(x.amount)]); });
      closeCat();
      if (pack.expenseRows.length) rows.push([{ v: 'TOTAL EXPENSES', s: 'totLbl' }, { v: '', s: 'totLbl' }, { v: '', s: 'totLbl' }, { v: '', s: 'totLbl' }, { v: '', s: 'totLbl' }, { v: '', s: 'totLbl' }, { v: '', s: 'totLbl' }, { v: '', s: 'totLbl' }, { v: t.expenses, s: 'totMoney', f: subRows.map(r => `I${r}`).join('+') }]);
      else rows.push([{ v: 'No expenses recorded in this period.', s: 'note' }]);
      rows.push([]); rows.push([{ v: '"Suggested account" is a mapping from the BMS category to a typical account title — please map it to your own chart of accounts.', s: 'sub' }]);
      sheets.push({ name: 'Expenses', widths: [11, 13, 28, 30, 40, 24, 14, 20, 15], rows, freezeRow: hdrIdx });
    }

    dataSheet('Receivables', `ACCOUNTS RECEIVABLE AGING — as of ${pack.to}`, ['Invoice No.', 'Sales Order', 'Customer', 'TIN', 'Invoice Date', 'Days', 'Cur', 'Invoice Total', 'Paid', 'Balance', 'Rate', 'PHP Balance', 'Current (0-30)', '31-60', '61-90', 'Over 90'],
      [15, 14, 34, 16, 12, 7, 6, 15, 15, 15, 9, 16, 15, 14, 14, 14],
      () => pack.arRows.map(r => [{ v: r.invoiceNo, s: 'txt' }, { v: r.orderNo, s: 'txt' }, { v: r.customer, s: 'txt' }, { v: r.tin, s: 'txt' }, { d: r.date, s: 'date' }, { v: r.days, s: 'int' }, { v: r.currency, s: 'txt' }, money(r.total), money(r.paid), money(r.balance), { v: r.rate, s: 'rate' }, money(r.phpBalance), money(r.bucket === 'b0' ? r.phpBalance : 0), money(r.bucket === 'b30' ? r.phpBalance : 0), money(r.bucket === 'b60' ? r.phpBalance : 0), money(r.bucket === 'b90' ? r.phpBalance : 0)]),
      [[11, t.arClosing], [12, pack.arAging.b0], [13, pack.arAging.b30], [14, pack.arAging.b60], [15, pack.arAging.b90]], { note: 'Aging is counted from the invoice date to the period end. Payments dated after the period end are not applied.' });

    dataSheet('Payables', `ACCOUNTS PAYABLE AGING — as of ${pack.to}`, ['PO No.', 'Supplier', 'TIN', 'PO Date', 'Days', 'Status', 'Cur', 'PO Total', 'Paid', 'Balance', 'Rate', 'PHP Balance', 'Current (0-30)', '31-60', '61-90', 'Over 90'],
      [15, 34, 16, 12, 7, 20, 6, 15, 15, 15, 9, 16, 15, 14, 14, 14],
      () => pack.apRows.map(r => [{ v: r.poNo, s: 'txt' }, { v: r.supplier, s: 'txt' }, { v: r.tin, s: 'txt' }, { d: r.date, s: 'date' }, { v: r.days, s: 'int' }, { v: r.status, s: 'txt' }, { v: r.currency, s: 'txt' }, money(r.total), money(r.paid), money(r.balance), { v: r.rate, s: 'rate' }, money(r.phpBalance), money(r.bucket === 'b0' ? r.phpBalance : 0), money(r.bucket === 'b30' ? r.phpBalance : 0), money(r.bucket === 'b60' ? r.phpBalance : 0), money(r.bucket === 'b90' ? r.phpBalance : 0)]),
      [[11, t.apClosing], [12, pack.apAging.b0], [13, pack.apAging.b30], [14, pack.apAging.b60], [15, pack.apAging.b90]]);

    dataSheet('Inventory', `INVENTORY ON HAND — as of ${pack.to}`, ['Item No.', 'Description', 'UOM', 'Qty on hand', 'Cur', 'Standard cost', 'Rate', 'PHP unit cost', 'PHP Value'],
      [14, 54, 7, 13, 6, 15, 9, 15, 17],
      () => pack.inventoryRows.map(r => [{ v: r.itemNo, s: 'txt' }, { v: r.description, s: 'txt' }, { v: r.uom, s: 'txt' }, { v: r.qty, s: 'qty' }, { v: r.currency, s: 'txt' }, money(r.unitCost), { v: r.rate, s: 'rate' }, money(r.phpUnit), money(r.phpValue)]),
      [[8, t.inventory]], { note: 'Catalog items only, valued at their standard cost converted at the rate above (not weighted-average or FIFO). Project Package items are bought for a specific order and are not kept in stock, so they are not listed — they appear in the Purchases Book.' });

    dataSheet('Distributions', 'OWNER DRAWS & EMPLOYEE PAYOUTS — from monthly distributions', ['Distribution', 'Month', 'Name', 'Type', '%', 'Gross amount', 'Net pay', 'Paid on', 'Method', 'Reference'],
      [16, 10, 26, 24, 8, 15, 15, 12, 14, 24],
      () => pack.distRows.map(r => [{ v: r.distNo, s: 'txt' }, { v: r.month, s: 'txt' }, { v: r.name, s: 'txt' }, { v: r.type, s: 'txt' }, { v: r.percent, s: 'qty' }, money(r.gross), money(r.net), r.paidDate ? { d: r.paidDate, s: 'date' } : { v: 'Unpaid', s: 'txt' }, { v: r.method, s: 'txt' }, { v: r.ref, s: 'txt' }]),
      [[5, pack.distRows.reduce((s, r) => s + r.gross, 0)], [6, pack.distRows.reduce((s, r) => s + r.net, 0)]],
      { note: 'Owner draws of a sole proprietor are withdrawals of capital, not an expense. Employee payouts are compensation and may need withholding-tax treatment — the BMS does not compute withholding tax; the bookkeeper should.' });

    {
      const rows = titleBlock(co, 'BUSINESS RESERVE — set-aside and usage', period); const hdrIdx = rows.length + 1;
      rows.push(H(['Item', 'Date / Month', 'Amount', 'Reason / Note']));
      rows.push([{ v: 'Opening balance', s: 'bold' }, { v: pack.from, s: 'txt' }, { v: t.reserveStart, s: 'boldMoney' }, null]);
      pack.distRows.length; // (reserve is set per distribution)
      const dd = (pack._dists || []);
      rows.push([{ v: 'Set aside from distributions in the period', s: 'txt' }, { v: pack.from.slice(0, 7) + ' – ' + pack.to.slice(0, 7), s: 'txt' }, money(t.reserveAdded), null]);
      pack.withdrawals.forEach(w => rows.push([{ v: 'Used (withdrawal)', s: 'txt' }, { d: d10(w.date), s: 'date' }, money(-(Number(w.amount) || 0)), { v: w.reason || '', s: 'txt' }]));
      rows.push([{ v: 'CLOSING BALANCE', s: 'totLbl' }, { v: pack.to, s: 'totLbl' }, { v: t.reserveEnd, s: 'totMoney' }, { v: '', s: 'totLbl' }]);
      sheets.push({ name: 'Business Reserve', widths: [44, 22, 16, 50], rows, freezeRow: hdrIdx });
    }

    // Notes & exclusions
    {
      const rows = titleBlock(co, 'NOTES, BASIS OF PREPARATION & EXCLUDED ITEMS', period);
      const sec2 = (t2) => rows.push([{ v: t2, s: 'section' }, { v: '', s: 'section' }, { v: '', s: 'section' }, { v: '', s: 'section' }, { v: '', s: 'section' }, { v: '', s: 'section' }]);
      sec2('Basis of preparation');
      [
        'Source: the owners’ Hadrontech BMS records (quotation → customer PO → sales order → supplier PO → invoice → payments). The bookkeeper has no system access, so this workbook carries everything needed.',
        'Sales are recognised on the INVOICE date (accrual basis, per the Ease of Paying Taxes Act). Collections are in the Cash Receipts Book. Purchases are listed by Supplier PO date; Draft and Cancelled documents are excluded.',
        'These are SOURCE BOOKS (sales, receipts, purchases, disbursements). The BMS is not a double-entry ledger — the bookkeeper posts these into the BIR-registered Journal and Ledger and prepares the final financial statements.',
        'Foreign-currency documents are converted to PHP at the single rate per currency shown on the Summary. The BMS does not store a rate per document or per payment, so there is no realised/unrealised foreign-exchange gain or loss in this pack.',
        'Inventory is at standard cost. The “gross margin” on the Summary is Sales less Purchases (not cost of goods sold) — adjust for opening and closing inventory.',
        'Not tracked by the BMS (the bookkeeper should add): withholding taxes on payroll, rent and professional fees; SSS / PhilHealth / Pag-IBIG; bank statements and reconciliation; fixed assets and depreciation; supplier invoice / receipt numbers; BIR-registered sales invoice numbers if different from the BMS invoice reference.',
        'Reminders (general Philippine practice — confirm with your accountant): books of accounts must be BIR-registered and kept for 10 years; annual gross sales above ₱3,000,000 require audited financial statements by an independent CPA and VAT registration; quarterly percentage-tax / income-tax returns are based on the gross sales per quarter shown on the Summary.'
      ].forEach(n => rows.push([{ v: n, s: 'wrap' }]));
      rows.push([]);
      sec2('Excluded from this pack (so nothing disappears silently)');
      rows.push(H(['Type', 'Document No.', 'Date', 'Party', 'Amount', 'Reason']));
      if (!pack.excluded.length) rows.push([{ v: 'Nothing was excluded in this period.', s: 'note' }]);
      pack.excluded.sort((a, b) => a.date.localeCompare(b.date)).forEach(x => rows.push([{ v: x.type, s: 'txt' }, { v: x.no, s: 'txt' }, { d: x.date, s: 'date' }, { v: x.party, s: 'txt' }, { v: (x.currency + ' ' + r2(x.amount).toFixed(2)), s: 'txt' }, { v: x.reason, s: 'txt' }]));
      const nm = rows.map((r, i) => (r.length === 1 && r[0] && r[0].s === 'wrap') ? i : -1).filter(i => i >= 0);
      sheets.push({ name: 'Notes & Exclusions', widths: [22, 18, 12, 36, 20, 50], rows, merges: nm.map(i => `A${i + 1}:F${i + 1}`), heights: Object.fromEntries(nm.map(i => [i, 15 * Math.ceil(String(rows[i][0].v).length / 140)])), landscape: true });
    }
    return sheets;
  }

  /* ============================================================
     PDF summary (printable page; use the browser's "Save as PDF")
     ============================================================ */
  function summaryHTML(pack, co) {
    const t = pack.totals; const f = (n) => formatMoney(n, 'PHP');
    const row = (l, v, b) => `<tr${b ? ' style="font-weight:800;"' : ''}><td>${escapeHtml(l)}</td><td class="p-num">${v}</td></tr>`;
    const block = (title, rows) => `<div class="bp-sec">${escapeHtml(title)}</div><table class="p-items">${rows.join('')}</table>`;
    const warn = pack.warnings.length ? `<div class="bp-sec">Please note</div><ul style="font-size:11px; line-height:1.6; margin:6px 0 0 18px;">${pack.warnings.map(w => `<li style="color:${w.level === 'warn' ? '#b3261e' : '#555'}">${escapeHtml(w.text)}</li>`).join('')}</ul>` : '';
    return `<style>.bp-sec{margin:18px 0 4px; font-size:11px; font-weight:800; letter-spacing:.1em; text-transform:uppercase; color:#a85f04;} table.p-items td:first-child{width:70%;}</style>
      <div class="p-head"><div><div class="p-co-name">${escapeHtml(co.name)}</div><div class="p-co-meta">${escapeHtml([co.address, co.tin ? 'TIN: ' + co.tin : '', 'Sole proprietorship · Non-VAT registered'].filter(Boolean).join('\n'))}</div></div>
      <div><div class="p-doc-title">Bookkeeper Pack — Summary</div><div class="p-doc-no">${pack.from} → ${pack.to}</div><div class="p-dates">Prepared ${todayStr()}<br>Unaudited management records</div></div></div>
      ${block('Income statement items (PHP, management basis)', [row('Sales invoiced (net of VAT)', f(t.salesNet)), row('Output VAT', f(t.salesVat)), row('Total invoiced (gross sales)', f(t.salesTotal), true), row('Purchases of goods', f(t.purchases)), row('Gross margin (purchases basis)', f(t.marginPurchasesBasis), true), row('Operating expenses', f(t.expenses)), row('Result before owner draws & employee distributions', f(t.resultBeforeDraws), true)])}
      ${block('Cash movements', [row('Received from customers', f(t.collections)), row('Paid to suppliers', f(t.supplierPaid)), row('Operating expenses paid', f(t.expenses)), row('Owner draws paid', f(t.ownerDrawsPaid)), row('Employee compensation paid', f(t.employeePaid)), row('Total disbursements', f(t.disbursements), true)])}
      ${block('Receivables & payables', [row('Receivables — opening', f(t.arOpening)), row('+ invoiced', f(t.salesTotal)), row('− collected', f(-t.collections)), row('Receivables — closing', f(t.arClosing), true), row('Payables — opening', f(t.apOpening)), row('+ purchases', f(t.purchases)), row('− paid', f(-t.supplierPaid)), row('Payables — closing', f(t.apClosing), true)])}
      ${block('Other balances at period end', [row('Inventory on hand (standard cost)', f(t.inventory)), row('Business Reserve', f(t.reserveEnd))])}
      ${block(`Gross sales per quarter, ${pack.year}`, pack.quarters.map(q => row(`Q${q.q} (${q.from} – ${q.to}) · ${q.invoices} invoice(s)`, f(q.gross))))}
      ${Object.keys(pack.rates).length ? block('Exchange rates used (PHP per unit)', Object.keys(pack.rates).map(c => row(c, String(pack.rates[c])))) : ''}
      ${warn}
      <div class="p-terms">The full detail — Sales Book, Cash Receipts, Purchases, Cash Disbursements, Expenses, Receivables, Payables, Inventory, Distributions, Business Reserve and exclusions — is in the accompanying Excel workbook. These are source books for posting into the BIR-registered Journal and Ledger; they are not audited financial statements.</div>
      <div class="p-sign"><div class="box">Prepared by (Owner)</div><div class="box">Received by (Bookkeeper) / Date</div></div>`;
  }

  /* ============================================================
     Page
     ============================================================ */
  async function loadData() {
    const g = (s) => DB.dbGetAll(s);
    const [customers, suppliers, salesOrders, pisRaw, supplierPOs, expenses, distributions, products, stockMovements, settings] = await Promise.all([g('customers'), g('suppliers'), g('salesOrders'), g('proformaInvoices'), g('supplierPOs'), g('expenses'), g('distributions'), g('products'), g('stockMovements'), DB.getSettings()]);
    const proformaInvoices = window.ProformaInvoices && ProformaInvoices.ensurePISnapshot ? await Promise.all(pisRaw.map(pi => ProformaInvoices.ensurePISnapshot(pi))) : pisRaw;
    return { customers, suppliers, salesOrders, proformaInvoices, supplierPOs, expenses, distributions, products, stockMovements, settings };
  }
  const company = (settings) => ({ name: settings.companyName || 'Hadrontech Industrial Solutions', tin: settings.tin || '', address: (settings.address || '').replace(/\s*\n\s*/g, ', ') });

  async function render() {
    Router.setBreadcrumb([{ label: 'Reports', hash: '/reports' }, { label: 'Bookkeeper Pack' }]);
    const content = document.getElementById('content');
    const data = await loadData(); const co = company(data.settings);
    const cur = periodPreset('lastMonth');
    const knownCur = new Set(); (data.supplierPOs || []).forEach(p => p.currency && p.currency !== 'PHP' && knownCur.add(p.currency)); (data.products || []).forEach(p => p.currency && p.currency !== 'PHP' && p.type !== 'Project Package' && knownCur.add(p.currency)); (data.proformaInvoices || []).forEach(p => p.currency && p.currency !== 'PHP' && knownCur.add(p.currency));
    const baseRates = Object.assign({}, data.settings.referenceRates || {});
    content.innerHTML = `
      <div class="page-head"><h1>Bookkeeper Pack</h1><div class="page-actions"><a class="btn-line" href="#/reports">← All reports</a></div></div>
      <div class="card">
        <p class="muted-text" style="margin-top:0;">One complete package for your bookkeeper (who has no access to the BMS): an <b>Excel workbook</b> with every book and schedule on its own tab, plus a <b>PDF summary</b>. Choose the period, review the preview, then download.</p>
        <div class="bp-controls">
          <label>Period <select id="bpPreset"><option value="lastMonth">Last month</option><option value="thisMonth">This month</option><option value="lastQuarter">Last quarter</option><option value="thisQuarter">This quarter</option><option value="lastYear">Last year</option><option value="thisYear">This year</option><option value="custom">Custom…</option></select></label>
          <label>From <input type="date" id="bpFrom" value="${cur.from}"></label>
          <label>To <input type="date" id="bpTo" value="${cur.to}"></label>
          ${[...knownCur].sort().map(c => `<label>${c} → PHP <input type="number" step="0.0001" min="0" id="bpRate_${c}" class="bp-rate" data-cur="${c}" value="${baseRates[c] || ''}" style="width:90px;"></label>`).join('')}
        </div>
        <div class="muted-text" style="margin-top:6px;">Exchange rates default to Company Settings → Currencies &amp; Exchange Rates. Change them here if the period needs a different rate; the rates used are printed on the Summary.</div>
      </div>
      <div id="bpPreview"></div>`;
    const q = (id) => document.getElementById(id);
    let pack = null;
    const getRates = () => { const r = {}; document.querySelectorAll('.bp-rate').forEach(i => { const v = Number(i.value); if (v > 0) r[i.dataset.cur] = v; }); return r; };
    const refresh = () => {
      const from = q('bpFrom').value, to = q('bpTo').value;
      if (!from || !to || from > to) { q('bpPreview').innerHTML = '<div class="card"><div class="empty-inline">Choose a valid period (From must not be after To).</div></div>'; pack = null; return; }
      pack = buildPack({ from, to, data, rates: getRates() }); const t = pack.totals; const f = (n) => formatMoney(n, 'PHP');
      const tile = (v, l) => `<div class="stat-card"><div class="stat-card-num">${v}</div><div class="stat-card-lbl">${escapeHtml(l)}</div></div>`;
      q('bpPreview').innerHTML = `
        <div class="stat-grid">${tile(f(t.salesTotal), `Invoiced (${pack.salesRows.length} invoice${pack.salesRows.length === 1 ? '' : 's'})`)}${tile(f(t.collections), `Collected (${pack.receipts.length})`)}${tile(f(t.purchases), `Purchases (${pack.purchaseRows.length} PO${pack.purchaseRows.length === 1 ? '' : 's'})`)}${tile(f(t.expenses), `Expenses (${pack.expenseRows.length})`)}${tile(f(t.arClosing), 'Receivables at period end')}${tile(f(t.apClosing), 'Payables at period end')}${tile(f(t.inventory), 'Inventory on hand')}${tile(f(t.reserveEnd), 'Business Reserve')}</div>
        <div class="card"><h3 class="section-title">Before you send it</h3>${pack.warnings.length ? `<ul class="bp-warn">${pack.warnings.map(w => `<li class="${w.level}">${w.level === 'warn' ? '⚠' : 'ℹ'} ${escapeHtml(w.text)}</li>`).join('')}</ul>` : '<div class="text-ok">✓ No warnings — everything in this period looks complete.</div>'}
          ${pack.excluded.length ? `<div class="muted-text" style="margin-top:8px;">${pack.excluded.length} cancelled / draft document(s) were left out and are listed on the “Notes &amp; Exclusions” tab.</div>` : ''}</div>
        <div class="card"><div class="btn-row"><button class="btn-amber" id="bpXlsx">Download Excel workbook (.xlsx)</button><button class="btn-line" id="bpPdf">Open PDF summary (Print → Save as PDF)</button></div>
        <div class="muted-text" style="margin-top:8px;">The workbook has ${12} tabs: Summary, Sales Book, Cash Receipts, Purchases Book, Cash Disbursements, Expenses, Receivables, Payables, Inventory, Distributions, Business Reserve, Notes &amp; Exclusions.</div></div>`;
      q('bpXlsx').onclick = () => downloadPack(pack, co);
      q('bpPdf').onclick = () => printShell(`Bookkeeper Pack ${pack.from} to ${pack.to}`, summaryHTML(pack, co));
    };
    q('bpPreset').onchange = () => { const v = q('bpPreset').value; if (v !== 'custom') { const p = periodPreset(v); q('bpFrom').value = p.from; q('bpTo').value = p.to; } refresh(); };
    ['bpFrom', 'bpTo'].forEach(id => q(id).onchange = () => { q('bpPreset').value = 'custom'; refresh(); });
    document.querySelectorAll('.bp-rate').forEach(i => i.oninput = refresh);
    refresh();
  }

  function pack2bytes(pack, co) { return workbookBytes(buildSheets(pack, co)); }
  function downloadPack(pack, co) {
    const bytes = pack2bytes(pack, co);
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `Bookkeeper-Pack_${(co.name || 'Hadrontech').replace(/[^A-Za-z0-9]+/g, '-')}_${pack.from}_to_${pack.to}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove();
    toast('Bookkeeper Pack downloaded.');
  }

  window.BookkeeperPack = { render, buildPack, buildSheets, workbookBytes, pack2bytes, summaryHTML, periodPreset, company, loadData };
})();
