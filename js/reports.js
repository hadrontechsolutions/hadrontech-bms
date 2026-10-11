/* ============================================================
   reports.js — business reports, all filterable by date and exportable to CSV
   ============================================================ */

const REPORT_GROUPS = [
  { group: 'Quotations & Technical Offers', reports: [
    { key: 'quotationRegister', label: 'Quotation Register', filters: ['customer', 'endUser', 'status'], statusOptions: () => window.QUOTE_STATUSES || [] },
    { key: 'openQuotations', label: 'Open Quotation Report', filters: ['customer', 'endUser', 'status'], statusOptions: () => ['Draft', 'Sent', 'Under Review'] },
    { key: 'wonLost', label: 'Won & Lost Quotation Report', filters: ['customer', 'endUser', 'status'], statusOptions: () => ['Won', 'Lost'] },
    { key: 'expiringSoon', label: 'Quotations Expiring Soon', filters: ['customer', 'endUser'] },
    { key: 'expiredQuotations', label: 'Expired Quotations — Needs Review', filters: ['customer', 'endUser', 'status'], statusOptions: () => window.QUOTE_STATUSES || [] },
    { key: 'technicalOffersLog', label: 'Technical Offers Log', filters: ['customer', 'endUser', 'status'], statusOptions: () => window.TO_STATUSES || [] }
  ]},
  { group: 'Orders & Fulfillment', reports: [
    { key: 'salesOrderRegister', label: 'Sales Order Register', filters: ['customer', 'status'], statusOptions: () => window.SO_STATUSES || [] },
    { key: 'supplierPORegister', label: 'Supplier PO Register', filters: ['supplier', 'status'], statusOptions: () => window.SPO_STATUSES || [] },
    { key: 'awaitingDelivery', label: 'Orders Awaiting Delivery', filters: ['customer', 'status'], statusOptions: () => ['Ready for Delivery', 'Partially Delivered'] }
  ]},
  { group: 'Financial Performance', reports: [
    { key: 'salesByCustomer', label: 'Sales by Customer' },
    { key: 'salesByMonth', label: 'Sales by Month' },
    { key: 'grossProfit', label: 'Gross Profit Report (Won Only)', filters: ['customer', 'endUser'] },
    { key: 'projectedGrossProfit', label: 'Projected Gross Profit (All Stages)', filters: ['customer', 'endUser', 'status'], statusOptions: () => window.QUOTE_STATUSES || [] }
  ]},
  { group: 'Payments & Collections', reports: [
    { key: 'paymentsAging', label: 'Payments Aging Report', filters: ['customer'] },
    { key: 'supplierPaymentsAging', label: 'Supplier Payments Aging Report', filters: ['supplier'] }
  ]},
  { group: 'Bookkeeper Reports', reports: [
    { key: 'salesRegisterBookkeeper', label: 'Sales Register', filters: ['customer', 'status'], statusOptions: () => window.SO_STATUSES || [] },
    { key: 'purchaseRegisterBookkeeper', label: 'Purchase Register', filters: ['supplier', 'status'], statusOptions: () => window.SPO_STATUSES || [] },
    { key: 'expenseRegister', label: 'Expense Register' },
    { key: 'expensesByCategory', label: 'Expenses by Category' }
  ]}
];
// Flat lookup kept for anything that just needs a report's label or existence check by key.
const REPORT_DEFS = REPORT_GROUPS.flatMap(g => g.reports);

Router.route('/reports', () => renderReports('quotationRegister'));
Router.route('/reports/:key', (p) => renderReports(p.key));

async function renderReports(activeKey) {
  if (activeKey === 'bookkeeperPack') return window.BookkeeperPack.render();
  Router.setBreadcrumb([{ label: 'Reports' }]);
  const content = document.getElementById('content');
  // Which text filters (Customer / End-User) this specific report supports, if any -- set once
  // here and reused by the checklist below to decide which filter boxes to actually show.
  const activeReportDef = REPORT_GROUPS.flatMap(g => g.reports).find(r => r.key === activeKey);
  const supportedFilters = activeReportDef?.filters || [];

  content.innerHTML = `
    <div class="page-head"><h1>Reports</h1></div>
    <a class="bp-banner" href="#/reports/bookkeeperPack"><span class="bp-banner-ico">📒</span><span><b>Bookkeeper Pack</b> — one complete Excel workbook + PDF summary for your bookkeeper (sales, collections, purchases, payments, expenses, receivables, payables, inventory…)</span><span class="bp-banner-go">Open →</span></a>
    <div class="report-layout">
      <div class="report-nav-panel">
        <input type="text" id="reportFilter" class="report-filter-box" placeholder="Filter reports...">
        <div class="report-nav" id="reportNav">
          ${REPORT_GROUPS.map(g => `
            <div class="report-group" data-group>
              <div class="report-group-label">${escapeHtml(g.group)}</div>
              ${g.reports.map(r => `<a href="#/reports/${r.key}" class="report-link ${r.key === activeKey ? 'active' : ''}" data-label="${escapeHtml(r.label.toLowerCase())}" data-group="${escapeHtml(g.group.toLowerCase())}">${r.label}</a>`).join('')}
            </div>`).join('')}
          <div class="empty-inline" id="reportFilterEmpty" style="display:none;">No reports match.</div>
        </div>
      </div>
      <div class="report-body">
        <div class="card">
          <div class="page-actions" style="margin-bottom:12px;">
            <label style="font-size:12px;">From <input type="date" id="rFrom"></label>
            <label style="font-size:12px;">To <input type="date" id="rTo"></label>
            <label style="font-size:12px; ${supportedFilters.includes('customer') ? '' : 'display:none;'}" id="rCustomerLabel">Customer <input type="text" id="rCustomerFilter" placeholder="Type to filter..." style="width:140px;"></label>
            <label style="font-size:12px; ${supportedFilters.includes('endUser') ? '' : 'display:none;'}" id="rEndUserLabel">End-User <input type="text" id="rEndUserFilter" placeholder="Type to filter..." style="width:140px;"></label>
            <label style="font-size:12px; ${supportedFilters.includes('supplier') ? '' : 'display:none;'}" id="rSupplierLabel">Supplier <input type="text" id="rSupplierFilter" placeholder="Type to filter..." style="width:140px;"></label>
            <label style="font-size:12px; ${supportedFilters.includes('status') ? '' : 'display:none;'}" id="rStatusLabel">Status <select id="rStatusFilter"><option value="">All Statuses</option>${(activeReportDef?.statusOptions ? activeReportDef.statusOptions() : []).map(s => `<option>${escapeHtml(s)}</option>`).join('')}</select></label>
            <button class="btn-line btn-sm" id="rApply">Apply</button>
            <button class="btn-amber btn-sm" id="rExport">Export CSV</button>
          </div>
          <div id="reportTableWrap"></div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('reportFilter').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    let anyVisible = false;
    document.querySelectorAll('.report-group').forEach(groupEl => {
      let groupHasMatch = false;
      groupEl.querySelectorAll('.report-link').forEach(link => {
        const match = !q || link.dataset.label.includes(q) || link.dataset.group.includes(q);
        link.style.display = match ? '' : 'none';
        if (match) groupHasMatch = true;
      });
      groupEl.style.display = groupHasMatch ? '' : 'none';
      if (groupHasMatch) anyVisible = true;
    });
    document.getElementById('reportFilterEmpty').style.display = anyVisible ? 'none' : '';
  });

  let currentRows = [], currentCols = [], currentTotals = null;

  async function load() {
    const from = document.getElementById('rFrom').value;
    const to = document.getElementById('rTo').value;
    const endUserFilter = document.getElementById('rEndUserFilter').value;
    const customerFilter = document.getElementById('rCustomerFilter').value;
    const supplierFilter = document.getElementById('rSupplierFilter').value;
    const statusFilter = document.getElementById('rStatusFilter').value;
    const result = await buildReport(activeKey, from, to, endUserFilter, customerFilter, supplierFilter, statusFilter);
    currentRows = result.rows; currentCols = result.cols; currentTotals = result.totals || null;

    const wrap = document.getElementById('reportTableWrap');
    if (currentRows.length === 0) { wrap.innerHTML = `<div class="empty-inline">No data for this report yet.</div>`; return; }
    wrap.innerHTML = (result.note ? `<p class="muted-text" style="margin-bottom:10px;">${escapeHtml(result.note)}</p>` : '')
      + `<table class="data-table compact"><thead><tr>${currentCols.map(c => `<th>${escapeHtml(c.label)}</th>`).join('')}</tr></thead>
      <tbody>${currentRows.map(row => `<tr>${currentCols.map(c => {
        const raw = typeof c.value === 'function' ? c.value(row) : row[c.value] ?? '';
        // badge:true renders the cell as a color-coded status pill (statusBadge already escapes
        // its own text safely) instead of plain escaped text. CSV export below is untouched --
        // it always uses the plain raw value, so exported files never contain HTML markup.
        return `<td>${c.badge ? statusBadge(String(raw)) : escapeHtml(String(raw))}</td>`;
      }).join('')}</tr>`).join('')}</tbody>
      ${currentTotals ? `<tfoot><tr style="font-weight:700; border-top:2px solid var(--ink); background:rgba(0,0,0,.03);">${currentTotals.map(t => `<td>${escapeHtml(t)}</td>`).join('')}</tr></tfoot>` : ''}
      </table>`;
  }

  document.getElementById('rApply').onclick = load;
  // Live, debounced filtering as the person types -- not a dropdown, and not requiring a click
  // on Apply for every character. Debounced (not filtered on every single keystroke) since load()
  // re-queries and rebuilds the whole report each time.
  const debouncedLoad = debounce(load, 250);
  document.getElementById('rCustomerFilter').addEventListener('input', debouncedLoad);
  document.getElementById('rEndUserFilter').addEventListener('input', debouncedLoad);
  document.getElementById('rSupplierFilter').addEventListener('input', debouncedLoad);
  document.getElementById('rStatusFilter').addEventListener('change', load);
  document.getElementById('rExport').onclick = () => {
    let csv = arrayToCSV(currentRows, currentCols);
    if (currentTotals) csv += '\r\n' + currentTotals.map(csvEscape).join(',');
    downloadFile(`${activeKey}.csv`, csv, 'text/csv');
  };
  await load();
}

/** Shared calculation for the "customer-facing amounts are expected to always be in PHP" pattern
    already used on Payments Aging / Sales by Customer / Sales by Month -- sums only the PHP
    rows for a clean total, and separately counts+flags any non-PHP rows as a standalone anomaly
    rather than silently including them. Returns the total and a ready-to-use note string (empty
    if nothing non-PHP was found). Callers build their own totals row array, since column count
    and position differ per report. */
function phpAssumedTotal(rows, amountField) {
  const phpRows = rows.filter(r => (r.currency || 'PHP') === 'PHP');
  const nonPhpRows = rows.filter(r => (r.currency || 'PHP') !== 'PHP');
  const total = r2(phpRows.reduce((s, r) => s + (Number(r[amountField]) || 0), 0));
  const note = nonPhpRows.length === 0 ? '' :
    `⚠ ${nonPhpRows.length} record(s) in this period are NOT in PHP and are excluded from the total above — customer-facing amounts are expected to always be in PHP, so it's worth double-checking these.`;
  return { total, note };
}

/** Case-insensitive, partial-match text filter -- deliberately not an exact-match dropdown.
    Real-world data entry is inconsistent (e.g. "ONSEMI" vs "Onsemi" vs "onsemi" for the exact
    same end-user), and a dropdown of distinct exact strings would silently split what's actually
    one entity into several selectable options, missing whichever variants aren't chosen. Typing
    a fragment catches every capitalization and every record containing it, without needing to
    first clean up how the data was originally entered. */
function textMatches(value, filterText) {
  if (!filterText) return true;
  return (value || '').toLowerCase().includes(filterText.trim().toLowerCase());
}

async function buildReport(key, from, to, endUserFilter, customerFilter, supplierFilter, statusFilter) {
  const inRange = (d) => (!from || (d && d >= from)) && (!to || (d && d <= to));
  const quotations = (await DB.dbGetAll('quotations')).filter(q => q.isLatest);
  const salesOrders = await DB.dbGetAll('salesOrders');
  const supplierPOs = await DB.dbGetAll('supplierPOs');
  const customers = await DB.dbGetAll('customers');
  const suppliers = await DB.dbGetAll('suppliers');
  const custMap = Object.fromEntries(customers.map(c => [c.id, c]));
  const supMap = Object.fromEntries(suppliers.map(s => [s.id, s]));
  const soMap = Object.fromEntries(salesOrders.map(s => [s.id, s]));

  switch (key) {
    case 'quotationRegister': {
      const rows = quotations.filter(q => inRange(q.date)
        && textMatches(custMap[q.customerId]?.companyName, customerFilter)
        && textMatches(q.endUser, endUserFilter)
        && (!statusFilter || q.status === statusFilter));
      const cols = [
        { label: 'Quotation No', value: 'quotationNo' }, { label: 'Customer', value: r => custMap[r.customerId]?.companyName || r.customerSnapshot?.companyName || '' },
        { label: 'Date', value: r => formatDate(r.date) }, { label: 'Status', value: 'status', badge: true }, { label: 'VAT Amount', value: r => formatMoney(r.vatTotal || 0, r.currency) }, { label: 'Total', value: r => formatMoney(r.grandTotal, r.currency) }
      ];
      const { total, note } = phpAssumedTotal(rows, 'grandTotal');
      const totals = rows.length === 0 ? null : ['', '', '', '', 'TOTAL', formatMoney(total, 'PHP')];
      return { rows, cols, totals, note };
    }
    case 'openQuotations': {
      const rows = quotations.filter(q => ['Draft', 'Sent', 'Under Review'].includes(q.status) && inRange(q.date)
        && textMatches(custMap[q.customerId]?.companyName, customerFilter)
        && textMatches(q.endUser, endUserFilter)
        && (!statusFilter || q.status === statusFilter));
      const cols = [
        { label: 'Quotation No', value: 'quotationNo' }, { label: 'Customer', value: r => custMap[r.customerId]?.companyName || '' },
        { label: 'Status', value: 'status', badge: true }, { label: 'Valid Until', value: r => formatDate(r.validUntil) }, { label: 'Total', value: r => formatMoney(r.grandTotal, r.currency) }
      ];
      const { total, note } = phpAssumedTotal(rows, 'grandTotal');
      const totals = rows.length === 0 ? null : ['', '', '', 'TOTAL', formatMoney(total, 'PHP')];
      return { rows, cols, totals, note };
    }
    case 'wonLost': {
      const rows = quotations.filter(q => ['Won', 'Lost'].includes(q.status) && inRange(q.date)
        && textMatches(custMap[q.customerId]?.companyName, customerFilter)
        && textMatches(q.endUser, endUserFilter)
        && (!statusFilter || q.status === statusFilter));
      const cols = [
        { label: 'Quotation No', value: 'quotationNo' }, { label: 'Customer', value: r => custMap[r.customerId]?.companyName || '' },
        { label: 'Status', value: 'status', badge: true }, { label: 'Total', value: r => formatMoney(r.grandTotal, r.currency) }
      ];
      // Won and Lost are summed SEPARATELY, deliberately never combined into one figure --
      // a Lost quotation represents no realized value, so folding it into the same total as
      // Won business would understate how much was actually won, not just be uninformative.
      const { total: wonTotal, note: wonNote } = phpAssumedTotal(rows.filter(r => r.status === 'Won'), 'grandTotal');
      const { total: lostTotal, note: lostNote } = phpAssumedTotal(rows.filter(r => r.status === 'Lost'), 'grandTotal');
      const totals = rows.length === 0 ? null : ['', '', 'Won / Lost Totals', `${formatMoney(wonTotal, 'PHP')} / ${formatMoney(lostTotal, 'PHP')}`];
      const note = [wonNote, lostNote].filter(Boolean).join(' ');
      return { rows, cols, totals, note };
    }
    case 'salesOrderRegister': {
      const rows = salesOrders.filter(o => inRange(o.orderDate)
        && textMatches(custMap[o.customerId]?.companyName, customerFilter)
        && (!statusFilter || o.status === statusFilter));
      const cols = [
        { label: 'SO No', value: 'soNo' }, { label: 'Customer', value: r => custMap[r.customerId]?.companyName || '' },
        { label: 'Date', value: r => formatDate(r.orderDate) }, { label: 'Status', value: 'status', badge: true }, { label: 'VAT Amount', value: r => formatMoney(r.vatTotal || 0, r.currency) }, { label: 'Total', value: r => formatMoney(r.grandTotal, r.currency) }
      ];
      const { total, note } = phpAssumedTotal(rows, 'grandTotal');
      const totals = rows.length === 0 ? null : ['', '', '', '', 'TOTAL', formatMoney(total, 'PHP')];
      return { rows, cols, totals, note };
    }
    case 'supplierPORegister': {
      const rows = supplierPOs.filter(p => inRange(p.poDate)
        && textMatches(supMap[p.supplierId]?.companyName, supplierFilter)
        && (!statusFilter || p.status === statusFilter));
      const cols = [
        { label: 'PO No', value: 'poNo' }, { label: 'Supplier', value: r => supMap[r.supplierId]?.companyName || '' },
        { label: 'Date', value: r => formatDate(r.poDate) }, { label: 'Status', value: 'status', badge: true }, { label: 'Total Cost', value: r => formatMoney(r.totalCost, r.currency) }
      ];
      // Unlike customer-facing reports, supplier costs genuinely span multiple currencies for
      // this business (local suppliers in PHP, overseas manufacturers like Pentair in USD) --
      // broken down by currency rather than assuming PHP, matching Supplier Payments Aging.
      const byCurrency = {};
      rows.forEach(r => { const cur = r.currency || 'PHP'; byCurrency[cur] = (byCurrency[cur] || 0) + (Number(r.totalCost) || 0); });
      const currencies = Object.keys(byCurrency).sort();
      const note = rows.length === 0 ? '' :
        `Total by currency: ${currencies.map(cur => formatMoney(byCurrency[cur], cur)).join(', ')}. Figures are not combined across currencies, since summing different currencies together would be meaningless.`;
      return { rows, cols, note };
    }
    case 'salesByCustomer': {
      // BUG FIX: this previously called formatMoney(total) with no currency argument, which
      // silently defaults to PHP -- meaning if a customer had any non-PHP sales order, its
      // amount got summed in as if it were PHP and displayed with a ₱ symbol regardless. Fixed
      // using the same PHP-assumed-with-anomaly-flag approach used on the Payments Aging Report.
      const filtered = salesOrders.filter(o => inRange(o.orderDate));
      const phpMap = {}, nonPhpByCustomer = {};
      filtered.forEach(o => {
        if ((o.currency || 'PHP') === 'PHP') { phpMap[o.customerId] = (phpMap[o.customerId] || 0) + (o.grandTotal || 0); }
        else { nonPhpByCustomer[o.customerId] = (nonPhpByCustomer[o.customerId] || []).concat([o]); }
      });
      const rows = Object.entries(phpMap).map(([cid, total]) => ({ customer: custMap[cid]?.companyName || 'Unknown', total: formatMoney(total, 'PHP') }));
      const nonPhpCount = Object.values(nonPhpByCustomer).reduce((s, arr) => s + arr.length, 0);
      const note = nonPhpCount === 0 ? '' : `⚠ ${nonPhpCount} sales order(s) in this period are NOT in PHP and are excluded from these totals — customer sales are expected to always be in PHP, so it's worth double-checking these.`;
      const grandTotal = r2(Object.values(phpMap).reduce((s, v) => s + v, 0));
      const totals = rows.length === 0 ? null : ['TOTAL', formatMoney(grandTotal, 'PHP')];
      return { rows, cols: [{ label: 'Customer', value: 'customer' }, { label: 'Total Sales', value: 'total' }], totals, note };
    }
    case 'salesByMonth': {
      // Same bug, same fix as salesByCustomer above.
      const filtered = salesOrders.filter(o => inRange(o.orderDate));
      const phpMap = {}; let nonPhpCount = 0;
      filtered.forEach(o => {
        const m = (o.orderDate || '').slice(0, 7);
        if ((o.currency || 'PHP') === 'PHP') { phpMap[m] = (phpMap[m] || 0) + (o.grandTotal || 0); }
        else { nonPhpCount++; }
      });
      const rows = Object.keys(phpMap).sort().map(m => ({ month: m, total: formatMoney(phpMap[m], 'PHP') }));
      const note = nonPhpCount === 0 ? '' : `⚠ ${nonPhpCount} sales order(s) in this period are NOT in PHP and are excluded from these totals — customer sales are expected to always be in PHP, so it's worth double-checking these.`;
      const grandTotal = r2(Object.values(phpMap).reduce((s, v) => s + v, 0));
      const totals = rows.length === 0 ? null : ['TOTAL', formatMoney(grandTotal, 'PHP')];
      return { rows, cols: [{ label: 'Month', value: 'month' }, { label: 'Total Sales', value: 'total' }], totals, note };
    }
    case 'grossProfit': {
      const rows = quotations.filter(q => q.status === 'Won' && inRange(q.date)
        && textMatches(custMap[q.customerId]?.companyName, customerFilter)
        && textMatches(q.endUser, endUserFilter));
      const cols = [
        { label: 'Quotation No', value: 'quotationNo' }, { label: 'Customer', value: r => custMap[r.customerId]?.companyName || '' },
        { label: 'Net Sales', value: r => formatMoney(r.netSubtotal, r.currency) }, { label: 'Gross Profit', value: r => formatMoney(r.grossProfit, r.currency) },
        { label: 'Margin %', value: r => (r.grossMarginPercent || 0) + '%' }
      ];
      const { total: netTotal, note: netNote } = phpAssumedTotal(rows, 'netSubtotal');
      const { total: gpTotal, note: gpNote } = phpAssumedTotal(rows, 'grossProfit');
      const totals = rows.length === 0 ? null : ['', 'TOTAL', formatMoney(netTotal, 'PHP'), formatMoney(gpTotal, 'PHP'), netTotal ? `${r2((gpTotal / netTotal) * 100)}%` : '0%'];
      return { rows, cols, totals, note: netNote || gpNote };
    }
    case 'projectedGrossProfit': {
      // Same underlying figures as the Won-only Gross Profit Report above, but across EVERY
      // quotation stage (Draft, Sent, Under Review, Won, Lost, Expired) -- this is potential/
      // projected profit across the whole pipeline, not realized profit, and deliberately
      // labeled that way so the two reports are never confused with each other.
      const rows = quotations.filter(q => inRange(q.date)
        && textMatches(q.endUser, endUserFilter)
        && textMatches(custMap[q.customerId]?.companyName, customerFilter)
        && (!statusFilter || q.status === statusFilter));
      const cols = [
        { label: 'Quotation No', value: 'quotationNo' },
        { label: 'Date', value: r => formatDate(r.date) },
        { label: 'Customer', value: r => custMap[r.customerId]?.companyName || '' },
        { label: 'End-User', value: r => r.endUser || '' },
        { label: 'Status', value: 'status', badge: true },
        { label: 'Net Sales', value: r => formatMoney(r.netSubtotal, r.currency) },
        { label: 'Gross Profit', value: r => formatMoney(r.grossProfit, r.currency) },
        { label: 'Margin %', value: r => (r.grossMarginPercent || 0) + '%' }
      ];
      // Totals are computed from the SAME rows actually being displayed (post Customer/End-User
      // filtering), never the unfiltered set -- otherwise the total at the bottom would silently
      // disagree with what's shown above it the moment either filter narrows the list.
      const { total: gpTotal, note } = phpAssumedTotal(rows, 'grossProfit');
      const totals = rows.length === 0 ? null : ['', '', '', '', '', '', 'TOTAL', formatMoney(gpTotal, 'PHP'), ''];
      return { rows, cols, totals, note };
    }
    case 'awaitingDelivery': {
      const rows = salesOrders.filter(o => ['Ready for Delivery', 'Partially Delivered'].includes(o.status)
        && textMatches(custMap[o.customerId]?.companyName, customerFilter)
        && (!statusFilter || o.status === statusFilter));
      const cols = [
        { label: 'SO No', value: 'soNo' }, { label: 'Customer', value: r => custMap[r.customerId]?.companyName || '' },
        { label: 'Status', value: 'status', badge: true }, { label: 'Total', value: r => formatMoney(r.grandTotal, r.currency) }
      ];
      const { total, note } = phpAssumedTotal(rows, 'grandTotal');
      const totals = rows.length === 0 ? null : ['', '', 'TOTAL', formatMoney(total, 'PHP')];
      return { rows, cols, totals, note };
    }
    case 'expiringSoon': {
      const rows = quotations.filter(q => ['today', 'soon'].includes(getExpiryInfo(q).state)
        && textMatches(custMap[q.customerId]?.companyName, customerFilter)
        && textMatches(q.endUser, endUserFilter));
      return { rows, cols: [
        { label: 'Quotation No', value: 'quotationNo' }, { label: 'Customer', value: r => custMap[r.customerId]?.companyName || '' },
        { label: 'Valid Until', value: r => formatDate(r.validUntil) }, { label: 'Status', value: r => getExpiryInfo(r).text }
      ]};
    }
    case 'expiredQuotations': {
      const rows = quotations.filter(q => getExpiryInfo(q).state === 'expired'
        && textMatches(custMap[q.customerId]?.companyName, customerFilter)
        && textMatches(q.endUser, endUserFilter)
        && (!statusFilter || q.status === statusFilter));
      return { rows, cols: [
        { label: 'Quotation No', value: 'quotationNo' }, { label: 'Customer', value: r => custMap[r.customerId]?.companyName || '' },
        { label: 'Valid Until', value: r => formatDate(r.validUntil) }, { label: 'Status', value: 'status', badge: true }, { label: 'Expired', value: r => getExpiryInfo(r).text }
      ]};
    }
    case 'salesRegisterBookkeeper': {
      // Built from Sales Orders (confirmed, actually-realized sales), not Quotations — a
      // quotation is only potential business until a customer PO turns it into a real order.
      // Cancelled and Draft orders are not real sales, so they stay out unless that exact status is picked.
      const rows = salesOrders.filter(o => inRange(o.orderDate)
        && textMatches(custMap[o.customerId]?.companyName, customerFilter)
        && (statusFilter ? o.status === statusFilter : !['Cancelled', 'Draft'].includes(o.status)));
      const vatLabel = { Standard12: 'Standard 12%', ZeroRated: 'Zero-Rated', Exempt: 'VAT Exempt', NonVat: 'Non-VAT (not VAT-registered)' };
      const netOf = r => r2((r.grandTotal || 0) - (r.vatTotal || 0));
      const vatableOf = r => (r.vatMode || 'Standard12') === 'Standard12' ? netOf(r) : 0;
      const zeroRatedOf = r => r.vatMode === 'ZeroRated' ? netOf(r) : 0;
      const exemptOf = r => r.vatMode === 'Exempt' ? netOf(r) : 0;
      const nonVatOf = r => r.vatMode === 'NonVat' ? netOf(r) : 0;
      const cols = [
        { label: 'Date', value: r => formatDate(r.orderDate) },
        { label: 'SO No', value: 'soNo' },
        { label: 'Customer', value: r => custMap[r.customerId]?.companyName || '' },
        { label: 'VAT Classification', value: r => vatLabel[r.vatMode || 'Standard12'] || r.vatMode },
        { label: 'VATable Sales', value: r => formatMoney(vatableOf(r)) },
        { label: 'Zero-Rated Sales', value: r => formatMoney(zeroRatedOf(r)) },
        { label: 'VAT-Exempt Sales', value: r => formatMoney(exemptOf(r)) },
        { label: 'Non-VAT Sales', value: r => formatMoney(nonVatOf(r)) },
        { label: 'VAT Amount', value: r => formatMoney(r.vatTotal || 0) },
        { label: 'Total Amount', value: r => formatMoney(r.grandTotal || 0) }
      ];
      const totals = ['', '', '', 'TOTAL',
        formatMoney(r2(rows.reduce((s, r) => s + vatableOf(r), 0))),
        formatMoney(r2(rows.reduce((s, r) => s + zeroRatedOf(r), 0))),
        formatMoney(r2(rows.reduce((s, r) => s + exemptOf(r), 0))),
        formatMoney(r2(rows.reduce((s, r) => s + nonVatOf(r), 0))),
        formatMoney(r2(rows.reduce((s, r) => s + (r.vatTotal || 0), 0))),
        formatMoney(r2(rows.reduce((s, r) => s + (r.grandTotal || 0), 0)))
      ];
      return { rows, cols, totals, note: 'Figures are shown in PHP. If any orders were in a foreign currency, their amounts are summed as raw numbers, not converted — please review those individually before handing this to your bookkeeper.' };
    }
    case 'purchaseRegisterBookkeeper': {
      const rows = supplierPOs.filter(p => inRange(p.poDate)
        && textMatches(supMap[p.supplierId]?.companyName, supplierFilter)
        && (statusFilter ? p.status === statusFilter : !['Cancelled', 'Draft'].includes(p.status)));
      const itemsTotalOf = r => r2((r.lines || []).reduce((s, l) => s + (l.amount || 0), 0));
      const cols = [
        { label: 'Date', value: r => formatDate(r.poDate) },
        { label: 'PO No', value: 'poNo' },
        { label: 'Supplier', value: r => supMap[r.supplierId]?.companyName || '' },
        { label: 'Items Total', value: r => formatMoney(itemsTotalOf(r)) },
        { label: 'Freight', value: r => formatMoney(r.freight || 0) },
        { label: 'Taxes', value: r => formatMoney(r.taxes || 0) },
        { label: 'Total Cost', value: r => formatMoney(r.totalCost || 0) }
      ];
      const totals = ['', '', 'TOTAL',
        formatMoney(r2(rows.reduce((s, r) => s + itemsTotalOf(r), 0))),
        formatMoney(r2(rows.reduce((s, r) => s + (r.freight || 0), 0))),
        formatMoney(r2(rows.reduce((s, r) => s + (r.taxes || 0), 0))),
        formatMoney(r2(rows.reduce((s, r) => s + (r.totalCost || 0), 0)))
      ];
      return { rows, cols, totals, note: 'Figures are shown in PHP. If any purchase orders were in a foreign currency, their amounts are summed as raw numbers, not converted — please review those individually before handing this to your bookkeeper.' };
    }
    case 'technicalOffersLog': {
      const technicalOffers = await DB.dbGetAll('technicalOffers');
      const rows = technicalOffers.filter(t => inRange(t.date)
        && textMatches(custMap[t.customerId]?.companyName, customerFilter)
        && textMatches(t.endUser, endUserFilter)
        && (!statusFilter || (t.status || 'Draft') === statusFilter));
      return { rows, cols: [
        { label: 'Offer No', value: 'offerNo' },
        { label: 'Date', value: r => formatDate(r.date) },
        { label: 'Submitted Via', value: r => custMap[r.customerId]?.companyName || '' },
        { label: 'End User', value: r => r.endUser || '' },
        { label: 'RFQ Reference', value: r => r.rfqReference || '' },
        { label: 'Status', value: r => r.status || 'Draft', badge: true }
      ]};
    }
    case 'paymentsAging': {
      // Proforma Invoices link to a Sales Order, not directly to a customer -- resolve through
      // the same chain the Payments list itself uses. Also apply the same legacy-invoice
      // migration used there, so an invoice nobody has opened yet still reports its real balance.
      const proformaInvoicesRaw = await DB.dbGetAll('proformaInvoices');
      const proformaInvoices = await Promise.all(proformaInvoicesRaw.map(pi => ProformaInvoices.ensurePISnapshot(pi)));
      const rows = proformaInvoices.filter(pi => ProformaInvoices.piPaymentStatus(pi) !== 'Paid' && inRange(pi.date)
        && textMatches(custMap[soMap[pi.salesOrderId]?.customerId]?.companyName, customerFilter));
      const daysOutstanding = (d) => d ? Math.max(0, Math.floor((Date.now() - new Date(d + 'T00:00:00').getTime()) / 86400000)) : '';
      const cols = [
        { label: 'PI No', value: 'piNo' },
        { label: 'Customer', value: r => custMap[soMap[r.salesOrderId]?.customerId]?.companyName || '' },
        { label: 'SO No', value: r => soMap[r.salesOrderId]?.soNo || '' },
        { label: 'Date', value: r => formatDate(r.date) },
        { label: 'Days Outstanding', value: r => daysOutstanding(r.date) },
        { label: 'Invoice Amount', value: r => formatMoney(r.grandTotal, r.currency) },
        { label: 'Amount Paid', value: r => formatMoney(ProformaInvoices.piAmountPaid(r), r.currency) },
        { label: 'Balance Due', value: r => formatMoney(ProformaInvoices.piBalanceDue(r), r.currency) },
        { label: 'Status', value: r => ProformaInvoices.piPaymentStatus(r), badge: true }
      ];
      // Customer invoices are expected to always be in PHP for this business. Rather than
      // treating multiple currencies as a normal case to gracefully average together, PHP
      // invoices get one simple, clean total -- and if a non-PHP invoice ever shows up, it's
      // flagged as a standalone anomaly worth double-checking, not folded into the total.
      const phpRows = rows.filter(r => (r.currency || 'PHP') === 'PHP');
      const nonPhpRows = rows.filter(r => (r.currency || 'PHP') !== 'PHP');
      const totalOutstandingPHP = r2(phpRows.reduce((s, r) => s + ProformaInvoices.piBalanceDue(r), 0));
      const totals = rows.length === 0 ? null : ['', '', '', '', '', '', 'TOTAL', formatMoney(totalOutstandingPHP, 'PHP'), ''];
      const note = nonPhpRows.length === 0 ? '' :
        `⚠ ${nonPhpRows.length} invoice(s) shown are NOT in PHP (${nonPhpRows.map(r => `${r.piNo} — ${r.currency}`).join(', ')}) and are excluded from the total above — customer invoices are expected to always be in PHP, so it's worth double-checking these.`;
      return { rows, cols, totals, note };
    }
    case 'supplierPaymentsAging': {
      // Unlike customer invoices, supplier costs genuinely span multiple currencies for this
      // business (local suppliers in PHP, overseas manufacturers like Pentair in USD) -- so
      // this one properly breaks the outstanding total down BY currency instead of assuming
      // one. Summing PHP and USD together would produce a number that looks precise but means
      // nothing, so each currency gets its own total row instead of a single blind sum.
      const rows = supplierPOs.filter(po => SupplierPOs.spoPaymentStatus(po) !== 'Paid' && inRange(po.poDate)
        && textMatches(supMap[po.supplierId]?.companyName, supplierFilter));
      const daysOutstanding = (d) => d ? Math.max(0, Math.floor((Date.now() - new Date(d + 'T00:00:00').getTime()) / 86400000)) : '';
      const cols = [
        { label: 'PO No', value: 'poNo' },
        { label: 'Supplier', value: r => supMap[r.supplierId]?.companyName || '' },
        { label: 'PO Date', value: r => formatDate(r.poDate) },
        { label: 'Days Outstanding', value: r => daysOutstanding(r.poDate) },
        { label: 'Total Cost', value: r => formatMoney(r.totalCost, r.currency) },
        { label: 'Amount Paid', value: r => formatMoney(SupplierPOs.spoAmountPaid(r), r.currency) },
        { label: 'Balance Due', value: r => formatMoney(SupplierPOs.spoBalanceDue(r), r.currency) },
        { label: 'Status', value: r => SupplierPOs.spoPaymentStatus(r), badge: true }
      ];
      const byCurrency = {};
      rows.forEach(r => { const cur = r.currency || 'PHP'; byCurrency[cur] = (byCurrency[cur] || 0) + SupplierPOs.spoBalanceDue(r); });
      const currencies = Object.keys(byCurrency).sort();
      const note = rows.length === 0 ? '' :
        `Total outstanding by currency: ${currencies.map(cur => formatMoney(byCurrency[cur], cur)).join(', ')}. Figures are not combined across currencies, since summing different currencies together would be meaningless. Only Unpaid and Partially Paid POs are shown — fully paid ones are excluded.`;
      return { rows, cols, note };
    }
    case 'expenseRegister': {
      const expenses = (await DB.dbGetAll('expenses')).filter(x => inRange(x.date));
      const cols = [
        { label: 'Expense No', value: 'expenseNo' },
        { label: 'Date', value: r => formatDate(r.date) },
        { label: 'Category', value: 'category' },
        { label: 'Description', value: 'description' },
        { label: 'Payee', value: r => r.payee || '' },
        { label: 'Payment Method', value: r => r.paymentMethod || '' },
        { label: 'Reference No', value: r => r.referenceNo || '' },
        { label: 'Amount', value: r => formatMoney(r.amount, 'PHP') }
      ];
      const total = r2(expenses.reduce((s, x) => s + (x.amount || 0), 0));
      const totals = expenses.length === 0 ? null : ['', '', '', '', '', '', 'TOTAL', formatMoney(total, 'PHP')];
      return { rows: expenses, cols, totals };
    }
    case 'expensesByCategory': {
      const expenses = (await DB.dbGetAll('expenses')).filter(x => inRange(x.date));
      const byCategory = {};
      expenses.forEach(x => { byCategory[x.category] = (byCategory[x.category] || 0) + (x.amount || 0); });
      // Biggest spend categories first -- this is what a bookkeeper or owner actually wants to
      // see first when asking "where is the money going", not an arbitrary or alphabetical order.
      const rows = Object.entries(byCategory).sort((a, b) => b[1] - a[1]).map(([category, total]) => ({ category, total: formatMoney(total, 'PHP') }));
      const grandTotal = r2(expenses.reduce((s, x) => s + (x.amount || 0), 0));
      const totals = rows.length === 0 ? null : ['TOTAL', formatMoney(grandTotal, 'PHP')];
      return { rows, cols: [{ label: 'Category', value: 'category' }, { label: 'Total Amount', value: 'total' }], totals };
    }
    default: return { rows: [], cols: [] };
  }
}
