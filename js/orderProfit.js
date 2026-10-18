/* ============================================================
   orderProfit.js — Order Profit: quoted (gross) profit versus ACTUAL profit for every Sales Order. INTERNAL ONLY.

   Quoted profit  = what the order was priced to earn: sales (before VAT) less the quoted cost of its lines. This is the same
                    figure the Gross Profit report and Distributions use (soGrossProfit), plus any freight billed to the customer.
   Actual profit  = what the customer really paid (before VAT) less what the order really cost us:
                      · Supplier POs of the order, in PHP — the part already paid at the rate on each payment slip, the
                        unpaid part at the PO's own rate (cancelled and draft POs are left out)
                      · Additional Costs on the order (import duties, courier ... recorded as Expenses linked to the order)
   Actual profit is only worked out when the customer's invoice is paid in full — an order that is not fully paid yet is
   listed as "Not fully paid yet" and left out of the totals, so unpaid money is never counted as profit.

   Nothing is entered twice: an extra cost goes in as an Additional Cost on the Sales Order, so Expenses, Distributions,
   the Bookkeeper Pack and this page always agree. The only thing typed here is a review note.
   ============================================================ */
(function () {
  const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
  const d10 = (d) => String(d || '').slice(0, 10);
  const hasFn = (n) => typeof window[n] === 'function';

  /** Pure calculation. data = { salesOrders, supplierPOs, proformaInvoices, expenses, customers, settings }.
   *  opts = { from, to } filter on ORDER DATE (blank = all). Returns { rows, totals, ... }. */
  function compute(data, opts) {
    opts = opts || {};
    const custMap = {}; (data.customers || []).forEach(c => custMap[c.id] = c);
    const poBySO = {}, piBySO = {}, costBySO = {}, costLines = {};
    (data.supplierPOs || []).forEach(p => { if (p.salesOrderId) (poBySO[p.salesOrderId] = poBySO[p.salesOrderId] || []).push(p); });
    (data.proformaInvoices || []).forEach(p => { if (p.salesOrderId) (piBySO[p.salesOrderId] = piBySO[p.salesOrderId] || []).push(p); });
    (data.expenses || []).forEach(x => { if (x.salesOrderId) { (costLines[x.salesOrderId] = costLines[x.salesOrderId] || []).push(x); costBySO[x.salesOrderId] = r2((costBySO[x.salesOrderId] || 0) + (Number(x.amount) || 0)); } });

    const rows = [];
    (data.salesOrders || []).forEach(so => {
      if (['Cancelled', 'Draft'].includes(so.status)) return;
      const pos = (poBySO[so.id] || []).filter(p => !['Cancelled', 'Draft'].includes(p.status));
      const pis = piBySO[so.id] || [];
      const customerPaid = r2(pis.reduce((s, pi) => s + (pi.payments || []).reduce((u, p) => u + (Number(p.amount) || 0), 0), 0));
      const supplierPaid = pos.some(p => (p.payments || []).length > 0);
      // Which orders appear: delivered (fully or partly) or already carrying a customer / supplier payment.
      if (!(['Delivered', 'Partially Delivered'].includes(so.status) || customerPaid > 0 || supplierPaid)) return;
      if (opts.from && !(d10(so.orderDate) >= opts.from)) return;
      if (opts.to && !(d10(so.orderDate) <= opts.to)) return;

      const warnings = [];
      // ----- quoted side (same basis as Gross Profit report / Distributions) -----
      const soSales = r2((Number(so.grandTotal) || 0) - (Number(so.vatTotal) || 0));
      // Freight billed to the customer is sales. The matching freight we pay the supplier is cost: if the order lines already
      // carry a freight estimate it is inside the line cost; if not, we expect it to be passed straight through (cost = billed).
      const billedFreight = Number(so.freight) || 0;
      const lineHasFreight = (so.lines || []).some(l => Number(l.estimatedFreightCost) > 0);
      const freightAssumed = !lineHasFreight && billedFreight > 0 ? billedFreight : 0;
      const quotedProfit = r2((hasFn('soGrossProfit') ? soGrossProfit(so) : 0) + billedFreight - freightAssumed + (Number(so.other) || 0));
      const quotedCost = r2(soSales - quotedProfit);
      const soPHP = (so.currency || 'PHP') === 'PHP';

      // ----- actual sales (customer's invoice before VAT) and whether it has been paid in full -----
      const piPHP = pis.every(pi => (pi.currency || 'PHP') === 'PHP');
      const invoiced = pis.length ? r2(pis.reduce((s, pi) => s + (Number(pi.grandTotal) || 0) - (Number(pi.vatTotal) || 0), 0)) : 0;
      const invoicedWithVat = r2(pis.reduce((s, pi) => s + (Number(pi.grandTotal) || 0), 0));
      const balance = r2(invoicedWithVat - customerPaid);
      const paidInFull = pis.length > 0 && balance <= 0.005;
      let payState = paidInFull ? 'Paid in full' : (pis.length ? `Not fully paid yet` : 'No invoice yet');

      // ----- actual cost -----
      const payPHP = (p, x) => SupplierPOs.spoPaymentPHP(p, x, data.settings);
      const supplierLines = pos.map(p => {
        const cur = p.currency || 'PHP';
        const info = poRateInfo(p, data.settings); let poRate = info.rate;
        if (!poRate) { poRate = 1; warnings.push(`Supplier PO ${p.poNo} (${cur}) has no exchange rate saved and none in Settings`); }
        const pays = p.payments || [];
        const paidAmt = r2(pays.reduce((s, x) => s + (Number(x.amount) || 0), 0));
        const calc = pays.map(x => payPHP(p, x));
        const paidPHP = r2(calc.reduce((s, c) => s + c.php, 0));
        const estimatedPaid = calc.some(c => c.estimated);
        const unpaid = Math.max(0, r2((Number(p.totalCost) || 0) - paidAmt));
        return { id: p.id, poNo: p.poNo, supplierId: p.supplierId, status: p.status, currency: cur, poRate, total: r2(p.totalCost), computedPHP: r2((Number(p.totalCost) || 0) * poRate), paidPHP, unpaidPHP: r2(unpaid * poRate), costPHP: r2(paidPHP + unpaid * poRate), fullyPaid: unpaid <= 0.005, estimatedPaid, confirmed: !estimatedPaid && unpaid <= 0.005 };
      });
      const suppliersCost = r2(supplierLines.reduce((s, l) => s + l.costPHP, 0));
      const suppliersComputed = r2(supplierLines.reduce((s, l) => s + l.computedPHP, 0));
      const additional = costBySO[so.id] || 0;
      const actualCost = r2(suppliersCost + additional);
      const computedCost = r2(suppliersComputed + additional);
      const costConfirmed = supplierLines.every(l => l.confirmed);
      const unpaidSuppliers = supplierLines.filter(l => !l.fullyPaid).length;

      let actualSales = null, actualProfit = null, difference = null, diffPct = null, note = '';
      if (!soPHP || !piPHP) note = 'Not in PHP — actual profit is not worked out here.';
      else if (paidInFull) {
        actualSales = invoiced;
        actualProfit = r2(actualSales - actualCost);
        difference = r2(actualProfit - quotedProfit);
        diffPct = actualSales ? r2(actualProfit / actualSales * 100) : 0;
      } else if (pis.length) note = `Customer still owes ${balance.toFixed(2)} — actual profit is worked out once the invoice is paid in full.`;
      else note = 'No invoice has been made for this order yet.';
      if (!supplierLines.length && paidInFull) warnings.push('No Supplier PO is linked to this order — the actual cost may be incomplete');

      rows.push({
        id: so.id, soNo: so.soNo, orderDate: d10(so.orderDate), status: so.status, customer: (custMap[so.customerId] || {}).companyName || '', customerId: so.customerId,
        vatMode: so.vatMode || '', sales: soSales, quotedCost, freightAssumed, quotedProfit, quotedPct: soSales ? r2(quotedProfit / soSales * 100) : 0,
        invoiced, customerPaid, balance, paidInFull, payState, actualSales,
        suppliersCost, suppliersComputed, computedCost, costConfirmed, additional, actualCost, supplierLines, additionalLines: (costLines[so.id] || []).slice().sort((a, b) => d10(a.date).localeCompare(d10(b.date))),
        unpaidSuppliers, actualProfit, difference, diffPct, note, warnings, profitNote: so.profitNote || '', counted: actualProfit != null
      });
    });
    rows.sort((a, b) => (b.orderDate || '').localeCompare(a.orderDate || '') || String(b.soNo).localeCompare(String(a.soNo)));

    const counted = rows.filter(r => r.counted);
    const sum = (arr, k) => r2(arr.reduce((s, r) => s + (Number(r[k]) || 0), 0));
    const totals = {
      shown: rows.length, counted: counted.length, notCounted: rows.length - counted.length,
      sales: sum(counted, 'sales'), actualSales: sum(counted, 'actualSales'), quotedCost: sum(counted, 'quotedCost'), quotedProfit: sum(counted, 'quotedProfit'),
      actualCost: sum(counted, 'actualCost'), computedCost: sum(counted, 'computedCost'), actualProfit: sum(counted, 'actualProfit'), additional: sum(counted, 'additional'), difference: sum(counted, 'difference')
    };
    totals.quotedPct = totals.sales ? r2(totals.quotedProfit / totals.sales * 100) : 0;
    totals.actualPct = totals.actualSales ? r2(totals.actualProfit / totals.actualSales * 100) : 0;
    return { rows, totals };
  }

  async function loadData() {
    const g = (s) => DB.dbGetAll(s);
    const [salesOrders, supplierPOs, pisRaw, expenses, customers, suppliers, settings] = await Promise.all([g('salesOrders'), g('supplierPOs'), g('proformaInvoices'), g('expenses'), g('customers'), g('suppliers'), DB.getSettings()]);
    const proformaInvoices = window.ProformaInvoices && ProformaInvoices.ensurePISnapshot ? await Promise.all(pisRaw.map(pi => ProformaInvoices.ensurePISnapshot(pi))) : pisRaw;
    return { salesOrders, supplierPOs, proformaInvoices, expenses, customers, suppliers, settings };
  }

  const money = (v) => formatMoney(v, 'PHP');
  const pctTxt = (v) => (v == null ? '—' : (Math.round(v * 100) / 100) + '%');
  /* Colour rule used on every screen: profit above what the order was priced to earn = green, below = red, equal (within 1 centavo) = plain. */
  const tone = (diff) => diff == null ? '' : diff > 0.005 ? 'profit-green' : diff < -0.005 ? 'cost-red' : '';
  const signed = (v) => (v > 0.005 ? '+' : v < -0.005 ? '\u2212' : '') + money(Math.abs(v));
  const diffCell = (r) => r.difference == null ? '—' : `<span class="${tone(r.difference)}">${signed(r.difference)}</span>`;
  const profitCell = (r) => r.actualProfit == null ? `<span class="badge badge-pending" title="${escapeHtml(r.note)}">${r.paidInFull || !r.balance ? 'Not worked out' : 'Not fully paid yet'}</span>` : money(r.actualProfit);

  /* ---------------- list page ---------------- */
  Router.route('/order-profit', () => renderList());
  Router.route('/order-profit/:id', (p) => renderDetail(p.id));

  async function renderList() {
    Router.setBreadcrumb([{ label: 'Order Profit' }]);
    const data = await loadData();
    const content = document.getElementById('content');
    content.innerHTML = `
      <div class="page-head"><h1>Order Profit</h1></div>
      <div class="card">
        <p class="muted-text" style="margin-top:0;">For each Sales Order: the <b>gross profit as ordered</b> (sales less quoted cost — the same figure the Gross Profit report and Distributions use) against the <b>actual profit</b> (what the customer paid, less what the order really cost: Supplier POs at the rates actually paid, plus Additional Costs). Internal only. Actual profit is worked out once the customer's invoice is <b>paid in full</b>; other orders are listed but left out of the totals.</p>
        <div class="bp-controls">
          <label>Order date from <input type="date" id="opFrom"></label>
          <label>to <input type="date" id="opTo"></label>
          <label>Search <input type="text" id="opSearch" placeholder="order no. or customer"></label>
        </div>
      </div>
      <div class="card" id="opWrap"></div>`;
    const q = (i) => document.getElementById(i);
    const draw = () => {
      const res = compute(data, { from: q('opFrom').value, to: q('opTo').value });
      const s = q('opSearch').value.trim().toLowerCase();
      const rows = res.rows.filter(r => !s || (r.soNo + ' ' + r.customer).toLowerCase().includes(s));
      const t = res.totals;
      if (!rows.length) { q('opWrap').innerHTML = '<div class="empty-inline">No orders to show yet. Orders appear here once they are delivered, or once a customer payment or a supplier payment has been recorded.</div>'; return; }
      q('opWrap').innerHTML = `
        <div style="overflow-x:auto;"><table class="data-table compact">
          <thead><tr><th>Sales Order</th><th>Customer</th><th>Order date</th><th>${escapeHtml(vatSalesLabel(rows.map(r => r.vatMode)))}</th><th>Quoted cost</th><th>Gross profit as ordered</th><th>Cost at PO rates (computed)</th><th>Actual cost</th><th>Actual profit</th><th>Difference (actual − ordered)</th><th>Customer payment</th></tr></thead>
          <tbody>${rows.map(r => `<tr class="clickable-row" data-hash="/order-profit/${r.id}">
            <td style="white-space:nowrap;"><a href="#/order-profit/${r.id}">${escapeHtml(r.soNo)}</a></td><td>${escapeHtml(r.customer || '—')}</td><td style="white-space:nowrap;">${formatDate(r.orderDate)}</td>
            <td>${money(r.sales)}</td><td>${money(r.quotedCost)}</td><td>${money(r.quotedProfit)} <span class="muted-text">(${pctTxt(r.quotedPct)})</span></td>
            <td>${money(r.computedCost)}</td>
            <td>${money(r.actualCost)}${r.costConfirmed ? '' : ' <span class="cost-tag" title="Some supplier payments are still on the estimated rate, or a supplier is not fully paid — enter the actual PHP paid on the Supplier PO">⚠ not confirmed</span>'}${r.additional ? ` <span class="cost-tag" title="Includes additional costs">⚠ incl. ${money(r.additional)}</span>` : ''}</td>
            <td>${r.actualProfit == null ? profitCell(r) : `<b class="${tone(r.difference)}">${money(r.actualProfit)}</b> <span class="muted-text">(${pctTxt(r.diffPct)})</span>`}</td>
            <td>${diffCell(r)}</td><td>${escapeHtml(r.payState)}</td></tr>`).join('')}</tbody>
          <tfoot><tr style="font-weight:700; border-top:2px solid var(--ink); background:rgba(0,0,0,.03);"><td colspan="3">TOTAL — ${t.counted} fully paid order${t.counted === 1 ? '' : 's'}</td><td>${money(t.sales)}</td><td>${money(t.quotedCost)}</td><td>${money(t.quotedProfit)} (${pctTxt(t.quotedPct)})</td><td>${money(t.computedCost)}</td><td>${money(t.actualCost)}</td><td><span class="${tone(t.difference)}">${money(t.actualProfit)}</span> (${pctTxt(t.actualPct)})</td><td><span class="${tone(t.difference)}">${signed(t.difference)}</span></td><td></td></tr></tfoot>
        </table></div>
        <p class="muted-text small" style="margin-top:10px;">${t.notCounted ? `${t.notCounted} order${t.notCounted === 1 ? ' is' : 's are'} not fully paid yet (or not in PHP) and ${t.notCounted === 1 ? 'is' : 'are'} left out of the totals. ` : ''}Totals count only the fully paid orders above. “Cost at PO rates (computed)” is each Supplier PO's total at the exchange rate on the PO; “Actual cost” uses the pesos you actually paid (type them on the Supplier PO payment). A “not confirmed” tag means part of the actual cost is still an estimate. "Difference" is actual profit less gross profit as ordered; a positive difference is shown in green and a negative one in red. Click an order to see exactly where the cost came from.</p>`;
    };
    ['opFrom', 'opTo'].forEach(i => q(i).onchange = draw); q('opSearch').oninput = draw;
    draw();
  }

  /* ---------------- detail page ---------------- */
  async function renderDetail(id) {
    const data = await loadData();
    const so = data.salesOrders.find(o => String(o.id) === String(id));
    const content = document.getElementById('content');
    if (!so) { content.innerHTML = '<div class="empty-state"><h3>Sales order not found</h3><p><a href="#/order-profit">Back to Order Profit</a></p></div>'; return; }
    Router.setBreadcrumb([{ label: 'Order Profit', hash: '/order-profit' }, { label: so.soNo }]);
    const res = compute(data, {}); const r = res.rows.find(x => x.id === so.id);
    if (!r) { content.innerHTML = `<div class="empty-state"><h3>${escapeHtml(so.soNo)} is not on the Order Profit list yet</h3><p>Orders appear here once they are delivered, or once a customer or supplier payment is recorded. <a href="#/sales-orders/${so.id}">Open the Sales Order</a> · <a href="#/order-profit">Back to Order Profit</a></p></div>`; return; }
    const supMap = Object.fromEntries((data.suppliers || []).map(s => [s.id, s]));
    const pi = (data.proformaInvoices || []).find(p => p.salesOrderId === so.id);
    const worse = r.difference != null && r.difference < -0.005;
    const costDiff = r2(r.actualCost - r.quotedCost);
    const costTone = costDiff < -0.005 ? 'profit-green' : costDiff > 0.005 ? 'cost-red' : '';
    content.innerHTML = `
      <div class="page-head"><div><div class="doc-number-tag">${escapeHtml(r.soNo)}</div><h1>${escapeHtml(r.customer || '—')} — Order Profit</h1></div>
        <div class="page-actions"><a class="btn-line" href="#/sales-orders/${so.id}">Open Sales Order</a><button class="btn-amber" id="opAddCost">+ Add Additional Cost</button></div></div>
      ${r.actualProfit == null ? `<div class="card next-step"><div class="ns-label">Actual profit not worked out yet</div><div class="ns-text">${escapeHtml(r.note)}</div></div>` : ''}
      <div class="card">
        <h3 class="section-title">Gross profit as ordered vs actual profit (PHP)</h3>
        <table class="data-table compact"><thead><tr><th></th><th>As ordered (quoted)</th><th>Actual</th><th>Difference</th></tr></thead><tbody>
          <tr><td>${escapeHtml(vatSalesLabel(r.vatMode))}</td><td>${money(r.sales)}</td><td>${r.actualSales == null ? '—' : money(r.actualSales)}</td><td>${r.actualSales == null ? '—' : money(r.actualSales - r.sales)}</td></tr>
          <tr><td>Supplier costs (incl. their freight &amp; taxes, and any estimated import charges)</td><td rowspan="2">${money(r.quotedCost)}<div class="muted-text small">${r.freightAssumed > 0 ? `quoted item cost ${money(r.quotedCost - r.freightAssumed)} + freight ${money(r.freightAssumed)} (expected to be passed straight through, same as the freight billed to the customer)` : 'quoted cost of the lines'}</div></td><td>${money(r.suppliersCost)}</td><td rowspan="2" class="${costTone}">${signed(costDiff)}</td></tr>
          <tr><td>Additional costs (unexpected)</td><td class="${r.additional ? 'cost-red' : ''}">${money(r.additional)}</td></tr>
          <tr style="font-weight:700;"><td>Total cost</td><td>${money(r.quotedCost)}</td><td>${money(r.actualCost)}</td><td class="${costTone}">${signed(costDiff)}</td></tr>
          <tr style="font-weight:800; border-top:2px solid var(--ink);"><td>Profit</td><td>${money(r.quotedProfit)} <span class="muted-text">(${pctTxt(r.quotedPct)})</span></td><td>${r.actualProfit == null ? profitCell(r) : `<span class="${tone(r.difference)}">${money(r.actualProfit)}</span> <span class="muted-text">(${pctTxt(r.diffPct)})</span>`}</td><td>${diffCell(r)}</td></tr>
        </tbody></table>
        <p class="muted-text small">${r.actualProfit == null ? '' : worse ? 'The actual profit is LOWER than the profit this order was priced to earn.' : 'The actual profit is at or above the profit this order was priced to earn.'} Green means we earned more than the order was priced to earn and red means less. In the cost rows, a plus Difference means the order cost more than quoted (red); a minus means it cost less (green).</p>
      </div>
      <div class="card"><h3 class="section-title">Where the actual cost came from</h3>
        <table class="data-table compact"><thead><tr><th>Supplier PO</th><th>Supplier</th><th>Status</th><th>PO total</th><th>Computed in PHP</th><th>Actually paid (PHP)</th><th>Still unpaid (at PO rate)</th><th>Cost used (PHP)</th></tr></thead><tbody>
          ${r.supplierLines.length ? r.supplierLines.map(l => `<tr><td><a href="#/supplier-pos/${l.id}">${escapeHtml(l.poNo)}</a></td><td>${escapeHtml((supMap[l.supplierId] || {}).companyName || '—')}</td><td>${statusBadge(l.status)}</td><td>${formatMoney(l.total, l.currency)}</td><td>${money(l.computedPHP)}</td><td>${money(l.paidPHP)}${l.estimatedPaid ? ` <span class="cost-tag" title="No actual PHP amount entered — estimated rate">⚠ estimated rate</span>` : ''}</td><td>${l.unpaidPHP ? money(l.unpaidPHP) : '—'}</td><td>${money(l.costPHP)}</td></tr>`).join('') : '<tr><td colspan="8" class="muted-text">No Supplier PO is linked to this order.</td></tr>'}
          <tr style="font-weight:700;"><td colspan="4" style="text-align:right;">Supplier costs</td><td>${money(r.suppliersComputed)}</td><td colspan="2"></td><td>${money(r.suppliersCost)}</td></tr>
          ${r.additionalLines.map(x => `<tr><td colspan="2"><a class="cost-tag" href="#/expenses/${x.id}">⚠ ${escapeHtml(x.expenseNo || 'Expense')}</a></td><td>${escapeHtml(x.category || '')}</td><td colspan="4">${escapeHtml(x.description || '')}${x.vendor ? ' — ' + escapeHtml(x.vendor) : ''} (${formatDate(x.date)})</td><td class="cost-red">${money(x.amount)}</td></tr>`).join('')}
          <tr style="font-weight:700;"><td colspan="7" style="text-align:right;">Additional costs</td><td class="${r.additional ? 'cost-red' : ''}">${money(r.additional)}</td></tr>
          <tr style="font-weight:800; border-top:2px solid var(--ink);"><td colspan="4" style="text-align:right;">Total computed cost in PHP</td><td>${money(r.computedCost)}</td><td colspan="2" style="text-align:right;">Total actual cost</td><td>${money(r.actualCost)}</td></tr>
        </tbody></table>
        ${r.costConfirmed ? '<p class="muted-text small">Every supplier payment on this order has the actual PHP paid entered, and every Supplier PO is fully paid — this is the actual cost.</p>' : '<p class="small" style="color:var(--danger);">⚠ Not confirmed yet: some payments still use the estimated rate, or a Supplier PO is not fully paid. Open the Supplier PO and enter the <b>actual PHP paid</b> to confirm the cost.</p>'}
        ${r.unpaidSuppliers ? `<p class="muted-text small">${r.unpaidSuppliers} Supplier PO${r.unpaidSuppliers === 1 ? ' is' : 's are'} not fully paid yet; the unpaid part is counted at the PO's own exchange rate.</p>` : ''}
        ${r.warnings.length ? `<p class="small" style="color:var(--danger);">⚠ ${r.warnings.map(escapeHtml).join(' · ')}</p>` : ''}
      </div>
      <div class="card"><h3 class="section-title">Customer payment</h3>
        <div class="detail-grid">
          <div class="detail-item"><div class="detail-label">${escapeHtml(vatSalesLabel(r.vatMode, 'Customer invoice'))}</div><div class="detail-value">${pi ? money(r.invoiced) : '—'}</div></div>
          <div class="detail-item"><div class="detail-label">Received so far</div><div class="detail-value">${money(r.customerPaid)}</div></div>
          <div class="detail-item"><div class="detail-label">Status</div><div class="detail-value">${escapeHtml(r.payState)}${!r.paidInFull && r.balance > 0 ? ` — ${money(r.balance)} outstanding` : ''}</div></div>
          <div class="detail-item"><div class="detail-label">Invoice</div><div class="detail-value">${pi ? `<a href="#/proforma-invoices/${pi.id}">${escapeHtml(pi.officialInvoiceNo || pi.piNo)}</a>` : '—'}</div></div>
        </div>
      </div>
      <div class="card"><h3 class="section-title">Review note</h3>
        <p class="muted-text small" style="margin-top:0;">For your own reference — why the actual differs from the quote (for example "supplier gave a better price"). It does not change any figure. To record another cost, use <b>+ Add Additional Cost</b>, so Expenses and Distributions stay in step.</p>
        <textarea id="opNote" rows="3" style="width:100%;">${escapeHtml(r.profitNote)}</textarea>
        <div class="btn-row" style="margin-top:8px;"><button class="btn-line btn-sm" id="opSaveNote">Save note</button></div>
      </div>`;
    document.getElementById('opAddCost').onclick = () => { window.__openAddCost = so.id; Router.navigate(`/sales-orders/${so.id}`); };
    document.getElementById('opSaveNote').onclick = async () => {
      const cur = await DB.dbGet('salesOrders', so.id); cur.profitNote = document.getElementById('opNote').value.trim();
      await DB.dbPut('salesOrders', cur); toast('Note saved.');
    };
  }

  window.OrderProfit = { tone: (d) => d == null ? '' : d > 0.005 ? 'profit-green' : d < -0.005 ? 'cost-red' : '', compute, loadData };
})();
