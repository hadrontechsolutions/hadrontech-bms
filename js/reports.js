/* ============================================================
   reports.js — business reports, all filterable by date and exportable to CSV
   ============================================================ */

const REPORT_DEFS = [
  { key: 'quotationRegister', label: 'Quotation Register' },
  { key: 'openQuotations', label: 'Open Quotation Report' },
  { key: 'wonLost', label: 'Won & Lost Quotation Report' },
  { key: 'salesOrderRegister', label: 'Sales Order Register' },
  { key: 'supplierPORegister', label: 'Supplier PO Register' },
  { key: 'salesByCustomer', label: 'Sales by Customer' },
  { key: 'salesByMonth', label: 'Sales by Month' },
  { key: 'grossProfit', label: 'Gross Profit Report' },
  { key: 'awaitingDelivery', label: 'Orders Awaiting Delivery' },
  { key: 'expiringSoon', label: 'Quotations Expiring Soon' },
  { key: 'expiredQuotations', label: 'Expired Quotations — Needs Review' },
  { key: 'salesRegisterBookkeeper', label: 'Sales Register (for Bookkeeper)' },
  { key: 'purchaseRegisterBookkeeper', label: 'Purchase Register (for Bookkeeper)' }
];

Router.route('/reports', () => renderReports('quotationRegister'));
Router.route('/reports/:key', (p) => renderReports(p.key));

async function renderReports(activeKey) {
  Router.setBreadcrumb([{ label: 'Reports' }]);
  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="page-head"><h1>Reports</h1></div>
    <div class="report-layout">
      <div class="report-nav">
        ${REPORT_DEFS.map(r => `<a href="#/reports/${r.key}" class="report-link ${r.key === activeKey ? 'active' : ''}">${r.label}</a>`).join('')}
      </div>
      <div class="report-body">
        <div class="card">
          <div class="page-actions" style="margin-bottom:12px;">
            <label style="font-size:12px;">From <input type="date" id="rFrom"></label>
            <label style="font-size:12px;">To <input type="date" id="rTo"></label>
            <button class="btn-line btn-sm" id="rApply">Apply</button>
            <button class="btn-amber btn-sm" id="rExport">Export CSV</button>
          </div>
          <div id="reportTableWrap"></div>
        </div>
      </div>
    </div>
  `;

  let currentRows = [], currentCols = [], currentTotals = null;

  async function load() {
    const from = document.getElementById('rFrom').value;
    const to = document.getElementById('rTo').value;
    const result = await buildReport(activeKey, from, to);
    currentRows = result.rows; currentCols = result.cols; currentTotals = result.totals || null;
    const wrap = document.getElementById('reportTableWrap');
    if (currentRows.length === 0) { wrap.innerHTML = `<div class="empty-inline">No data for this report yet.</div>`; return; }
    wrap.innerHTML = (result.note ? `<p class="muted-text" style="margin-bottom:10px;">${escapeHtml(result.note)}</p>` : '')
      + `<table class="data-table compact"><thead><tr>${currentCols.map(c => `<th>${escapeHtml(c.label)}</th>`).join('')}</tr></thead>
      <tbody>${currentRows.map(row => `<tr>${currentCols.map(c => `<td>${escapeHtml(String(typeof c.value === 'function' ? c.value(row) : row[c.value] ?? ''))}</td>`).join('')}</tr>`).join('')}</tbody>
      ${currentTotals ? `<tfoot><tr style="font-weight:700; border-top:2px solid var(--ink); background:rgba(0,0,0,.03);">${currentTotals.map(t => `<td>${escapeHtml(t)}</td>`).join('')}</tr></tfoot>` : ''}
      </table>`;
  }

  document.getElementById('rApply').onclick = load;
  document.getElementById('rExport').onclick = () => {
    let csv = arrayToCSV(currentRows, currentCols);
    if (currentTotals) csv += '\r\n' + currentTotals.map(csvEscape).join(',');
    downloadFile(`${activeKey}.csv`, csv, 'text/csv');
  };
  await load();
}

async function buildReport(key, from, to) {
  const inRange = (d) => (!from || (d && d >= from)) && (!to || (d && d <= to));
  const quotations = (await DB.dbGetAll('quotations')).filter(q => q.isLatest);
  const salesOrders = await DB.dbGetAll('salesOrders');
  const supplierPOs = await DB.dbGetAll('supplierPOs');
  const customers = await DB.dbGetAll('customers');
  const suppliers = await DB.dbGetAll('suppliers');
  const custMap = Object.fromEntries(customers.map(c => [c.id, c]));
  const supMap = Object.fromEntries(suppliers.map(s => [s.id, s]));

  switch (key) {
    case 'quotationRegister':
      return { rows: quotations.filter(q => inRange(q.date)), cols: [
        { label: 'Quotation No', value: 'quotationNo' }, { label: 'Customer', value: r => custMap[r.customerId]?.companyName || r.customerSnapshot?.companyName || '' },
        { label: 'Date', value: r => formatDate(r.date) }, { label: 'Status', value: 'status' }, { label: 'VAT Amount', value: r => formatMoney(r.vatTotal || 0, r.currency) }, { label: 'Total', value: r => formatMoney(r.grandTotal, r.currency) }
      ]};
    case 'openQuotations':
      return { rows: quotations.filter(q => ['Draft', 'Sent', 'Under Review'].includes(q.status) && inRange(q.date)), cols: [
        { label: 'Quotation No', value: 'quotationNo' }, { label: 'Customer', value: r => custMap[r.customerId]?.companyName || '' },
        { label: 'Status', value: 'status' }, { label: 'Valid Until', value: r => formatDate(r.validUntil) }, { label: 'Total', value: r => formatMoney(r.grandTotal, r.currency) }
      ]};
    case 'wonLost':
      return { rows: quotations.filter(q => ['Won', 'Lost'].includes(q.status) && inRange(q.date)), cols: [
        { label: 'Quotation No', value: 'quotationNo' }, { label: 'Customer', value: r => custMap[r.customerId]?.companyName || '' },
        { label: 'Status', value: 'status' }, { label: 'Total', value: r => formatMoney(r.grandTotal, r.currency) }
      ]};
    case 'salesOrderRegister':
      return { rows: salesOrders.filter(o => inRange(o.orderDate)), cols: [
        { label: 'SO No', value: 'soNo' }, { label: 'Customer', value: r => custMap[r.customerId]?.companyName || '' },
        { label: 'Date', value: r => formatDate(r.orderDate) }, { label: 'Status', value: 'status' }, { label: 'VAT Amount', value: r => formatMoney(r.vatTotal || 0, r.currency) }, { label: 'Total', value: r => formatMoney(r.grandTotal, r.currency) }
      ]};
    case 'supplierPORegister':
      return { rows: supplierPOs.filter(p => inRange(p.poDate)), cols: [
        { label: 'PO No', value: 'poNo' }, { label: 'Supplier', value: r => supMap[r.supplierId]?.companyName || '' },
        { label: 'Date', value: r => formatDate(r.poDate) }, { label: 'Status', value: 'status' }, { label: 'Total Cost', value: r => formatMoney(r.totalCost, r.currency) }
      ]};
    case 'salesByCustomer': {
      const map = {};
      salesOrders.filter(o => inRange(o.orderDate)).forEach(o => { map[o.customerId] = (map[o.customerId] || 0) + (o.grandTotal || 0); });
      const rows = Object.entries(map).map(([cid, total]) => ({ customer: custMap[cid]?.companyName || 'Unknown', total: formatMoney(total) }));
      return { rows, cols: [{ label: 'Customer', value: 'customer' }, { label: 'Total Sales', value: 'total' }] };
    }
    case 'salesByMonth': {
      const map = {};
      salesOrders.filter(o => inRange(o.orderDate)).forEach(o => { const m = (o.orderDate || '').slice(0, 7); map[m] = (map[m] || 0) + (o.grandTotal || 0); });
      const rows = Object.keys(map).sort().map(m => ({ month: m, total: formatMoney(map[m]) }));
      return { rows, cols: [{ label: 'Month', value: 'month' }, { label: 'Total Sales', value: 'total' }] };
    }
    case 'grossProfit':
      return { rows: quotations.filter(q => q.status === 'Won' && inRange(q.date)), cols: [
        { label: 'Quotation No', value: 'quotationNo' }, { label: 'Customer', value: r => custMap[r.customerId]?.companyName || '' },
        { label: 'Net Sales', value: r => formatMoney(r.netSubtotal, r.currency) }, { label: 'Gross Profit', value: r => formatMoney(r.grossProfit, r.currency) },
        { label: 'Margin %', value: r => (r.grossMarginPercent || 0) + '%' }
      ]};
    case 'awaitingDelivery':
      return { rows: salesOrders.filter(o => ['Ready for Delivery', 'Partially Received'].includes(o.status)), cols: [
        { label: 'SO No', value: 'soNo' }, { label: 'Customer', value: r => custMap[r.customerId]?.companyName || '' },
        { label: 'Status', value: 'status' }, { label: 'Total', value: r => formatMoney(r.grandTotal, r.currency) }
      ]};
    case 'expiringSoon': {
      return { rows: quotations.filter(q => ['today', 'soon'].includes(getExpiryInfo(q).state)), cols: [
        { label: 'Quotation No', value: 'quotationNo' }, { label: 'Customer', value: r => custMap[r.customerId]?.companyName || '' },
        { label: 'Valid Until', value: r => formatDate(r.validUntil) }, { label: 'Status', value: r => getExpiryInfo(r).text }
      ]};
    }
    case 'expiredQuotations': {
      return { rows: quotations.filter(q => getExpiryInfo(q).state === 'expired'), cols: [
        { label: 'Quotation No', value: 'quotationNo' }, { label: 'Customer', value: r => custMap[r.customerId]?.companyName || '' },
        { label: 'Valid Until', value: r => formatDate(r.validUntil) }, { label: 'Status', value: 'status' }, { label: 'Expired', value: r => getExpiryInfo(r).text }
      ]};
    }
    case 'salesRegisterBookkeeper': {
      // Built from Sales Orders (confirmed, actually-realized sales), not Quotations — a
      // quotation is only potential business until a customer PO turns it into a real order.
      const rows = salesOrders.filter(o => inRange(o.orderDate));
      const vatLabel = { Standard12: 'Standard 12%', ZeroRated: 'Zero-Rated', Exempt: 'VAT Exempt' };
      const netOf = r => r2((r.grandTotal || 0) - (r.vatTotal || 0));
      const vatableOf = r => (r.vatMode || 'Standard12') === 'Standard12' ? netOf(r) : 0;
      const zeroRatedOf = r => r.vatMode === 'ZeroRated' ? netOf(r) : 0;
      const exemptOf = r => r.vatMode === 'Exempt' ? netOf(r) : 0;
      const cols = [
        { label: 'Date', value: r => formatDate(r.orderDate) },
        { label: 'SO No', value: 'soNo' },
        { label: 'Customer', value: r => custMap[r.customerId]?.companyName || '' },
        { label: 'VAT Classification', value: r => vatLabel[r.vatMode || 'Standard12'] || r.vatMode },
        { label: 'VATable Sales', value: r => formatMoney(vatableOf(r)) },
        { label: 'Zero-Rated Sales', value: r => formatMoney(zeroRatedOf(r)) },
        { label: 'VAT-Exempt Sales', value: r => formatMoney(exemptOf(r)) },
        { label: 'VAT Amount', value: r => formatMoney(r.vatTotal || 0) },
        { label: 'Total Amount', value: r => formatMoney(r.grandTotal || 0) }
      ];
      const totals = ['', '', '', 'TOTAL',
        formatMoney(r2(rows.reduce((s, r) => s + vatableOf(r), 0))),
        formatMoney(r2(rows.reduce((s, r) => s + zeroRatedOf(r), 0))),
        formatMoney(r2(rows.reduce((s, r) => s + exemptOf(r), 0))),
        formatMoney(r2(rows.reduce((s, r) => s + (r.vatTotal || 0), 0))),
        formatMoney(r2(rows.reduce((s, r) => s + (r.grandTotal || 0), 0)))
      ];
      return { rows, cols, totals, note: 'Figures are shown in PHP. If any orders were in a foreign currency, their amounts are summed as raw numbers, not converted — please review those individually before handing this to your bookkeeper.' };
    }
    case 'purchaseRegisterBookkeeper': {
      const rows = supplierPOs.filter(p => inRange(p.poDate));
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
    default: return { rows: [], cols: [] };
  }
}
