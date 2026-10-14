/* ============================================================
   salesOrders.js — Sales Orders. Created from a won Quotation +
   Customer PO (line items/pricing are copied in, not re-typed).
   One Sales Order can spawn multiple Supplier POs (grouped by supplier).
   ============================================================ */

const SO_STATUSES = ['Draft', 'Confirmed', 'Sourcing', 'Ordered from Supplier', 'Partially Received', 'Ready for Delivery', 'Partially Delivered', 'Delivered', 'Cancelled'];

/** Called from the Customer PO detail page. Builds a Sales Order from quotation lines (if any) or the PO amount alone. */
async function createFromCustomerPO(po, quotation) {
  if (!confirm(`Create a Sales Order from customer PO ${po.poNo}?`)) return;
  const settings = await DB.getSettings();
  const now = new Date().toISOString();

  let lines, totals, chosenOptionLabel = null;
  if (quotation && quotation.isMultiOption) {
    // The quotation had multiple mutually-exclusive options — only the ONE the customer
    // actually ordered (recorded on the Customer PO) should flow into the Sales Order,
    // never all of them combined.
    let chosenOpt = (quotation.optionTotals || []).find(o => o.group === po.chosenOptionGroup);
    if (!chosenOpt) {
      chosenOpt = quotation.optionTotals[0];
      toast(`No chosen option was recorded on this Customer PO — defaulting to "${chosenOpt.label}". Edit the Customer PO to correct this if that's wrong.`, 'err');
    }
    chosenOptionLabel = chosenOpt.label;
    lines = quotation.lines.filter(l => !(l.optionGroup || '').trim() || (l.optionGroup || '').trim() === chosenOpt.group).map(l => Object.assign({}, l));
    totals = { subtotal: chosenOpt.subtotal, vatTotal: chosenOpt.vatTotal, freight: chosenOpt.freight, other: chosenOpt.other, grandTotal: chosenOpt.grandTotal };
  } else {
    if (quotation) {
      lines = quotation.lines.map(l => Object.assign({}, l));
    } else if (po.lines && po.lines.length > 0) {
      // Real itemized lines recorded directly on the Customer PO (no quotation behind this
      // order — e.g. a sample request) — use those instead of a single vague catch-all line.
      // Each line's own VAT% carries through correctly now — this used to be silently
      // hardcoded to 0%, which meant every sample-style order lost its VAT the moment it
      // became a Sales Order.
      lines = po.lines.map(l => ({
        lineId: l.lineId || 'L' + Math.random().toString(36).slice(2, 9), itemId: l.itemId || '', brand: '', modelNo: '',
        description: l.description, qty: l.qty, uom: l.uom || 'pc',
        unitCost: 0, unitPrice: l.unitPrice, discountPercent: 0, vatRate: l.vatRate ?? 12, supplierId: '', supplierQuoteRef: '', leadTime: '', remarks: ''
      }));
    } else {
      lines = [{
        lineId: 'L' + Math.random().toString(36).slice(2, 9), itemId: '', brand: '', modelNo: '',
        description: 'As per Customer PO ' + (po.customerPoNumber || po.poNo), qty: 1, uom: 'lot',
        unitCost: 0, unitPrice: po.poAmount || 0, discountPercent: 0, vatRate: 0, supplierId: '', supplierQuoteRef: '', leadTime: '', remarks: ''
      }];
    }
    if (quotation) {
      totals = { subtotal: quotation.subtotal, vatTotal: quotation.vatTotal, freight: quotation.freight, other: quotation.other, grandTotal: quotation.grandTotal };
    } else if (po.lines && po.lines.length > 0) {
      // Recompute properly from each line's own VAT%, rather than assuming vatTotal is 0 —
      // this is the other half of the same fix: the total itself must actually reflect VAT too.
      // Freight carries straight across from the Customer PO's own Freight field, the same way
      // it already flows from Quotation → Sales Order — captured once, at the earliest point,
      // not re-entered by hand at every stage downstream.
      let subtotal = 0, vatTotal = 0;
      lines.forEach(l => { const c = QuoteCalc.computeLine(l, po.currency); subtotal = r2(subtotal + c.net); vatTotal = r2(vatTotal + c.vatAmt); });
      const freight = po.freight || 0;
      totals = { subtotal, vatTotal, freight, other: 0, grandTotal: r2(subtotal + vatTotal + freight) };
    } else {
      totals = { subtotal: po.poAmount || 0, vatTotal: 0, freight: 0, other: 0, grandTotal: po.poAmount || 0 };
    }
  }
  lines = lines.map(l => Object.assign({ deliveredQty: 0 }, l));

  const soNo = await DB.nextDocNumber('salesOrder');
  const rec = Object.assign({
    soNo, customerId: po.customerId, customerPOId: po.id, quotationId: quotation ? quotation.id : null,
    orderDate: todayISO(), requiredDeliveryDate: '', currency: po.currency || 'PHP',
    shippingAddress: po.shippingAddress || '', internalNotes: '', status: 'Draft', chosenOptionLabel,
    vatMode: quotation?.vatMode || 'Standard12', paymentTerms: quotation?.paymentTerms || '', incoterms: quotation?.incoterms || '',
    statusHistory: [{ status: 'Draft', date: now }],
    createdAt: now, updatedAt: now, createdBy: settings.userName, modifiedBy: settings.userName,
    lines
  }, totals);
  const newId = await DB.dbAdd('salesOrders', rec);
  po.status = 'Converted to Sales Order'; po.updatedAt = now;
  await DB.dbPut('customerPOs', po);
  await DB.logActivity(`Created sales order ${soNo} from customer PO ${po.poNo}${chosenOptionLabel ? ' (' + chosenOptionLabel + ')' : ''}`);
  toast('Sales order created.');
  Router.navigate(`/sales-orders/${newId}`);
}

Router.route('/sales-orders', async () => {
  Router.setBreadcrumb([{ label: 'Sales Orders' }]);
  const [allRaw, customers, customerPOs, quotations, expensesAll] = await Promise.all([DB.dbGetAll('salesOrders'), DB.dbGetAll('customers'), DB.dbGetAll('customerPOs'), DB.dbGetAll('quotations'), DB.dbGetAll('expenses')]);
  const costBySO = ExpenseHelpers.soCostTotals(expensesAll);
  const all = allRaw.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const custMap = Object.fromEntries(customers.map(c => [c.id, c]));
  const cpoMap = Object.fromEntries(customerPOs.map(p => [p.id, p]));
  const quoteMap = Object.fromEntries(quotations.map(q => [q.id, q]));
  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="page-head"><h1>Sales Orders</h1></div>
    <div class="card">
      <table class="data-table">
        <thead><tr><th>SO #</th><th>Customer</th><th>Quotation #</th><th>Customer PO #</th><th>Order Date</th><th>Status</th><th>Total</th></tr></thead>
        <tbody id="soBody"></tbody>
      </table>
      <div class="empty-inline" id="emptyMsg" style="display:none;">No sales orders yet. Convert a won quotation's customer PO to create one.</div>
      <div id="pgWrap"></div>
    </div>
  `;

  // One page at a time -- rebuilding hundreds of rows on every visit gets slower as this list
  // grows; a fixed-size page keeps this fast regardless of how many sales orders pile up.
  let currentPage = 1;
  function draw(rows) {
    const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    const pageRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
    document.getElementById('soBody').innerHTML = pageRows.map(so => {
      const mismatched = so.status === 'Delivered' && (so.lines || []).some(l => (l.deliveredQty || 0) < l.qty);
      const badgeHTML = mismatched ? `<span class="badge badge-lost">DELIVERED — INCOMPLETE</span>` : statusBadge(so.status);
      return `
      <tr class="clickable-row" data-hash="/sales-orders/${so.id}">
        <td>${escapeHtml(so.soNo)}</td><td>${escapeHtml(custMap[so.customerId]?.companyName || '—')}</td>
        <td>${escapeHtml(quoteMap[so.quotationId]?.quotationNo || '—')}</td>
        <td>${escapeHtml(cpoMap[so.customerPOId]?.customerPoNumber || cpoMap[so.customerPOId]?.poNo || '—')}</td>
        <td>${formatDate(so.orderDate)}</td><td>${badgeHTML}</td><td>${formatMoney(so.grandTotal, so.currency)}${costBySO[so.id] ? `<div><span class="cost-tag" title="Unexpected costs we paid on this order">⚠ +${formatMoney(costBySO[so.id], 'PHP')} costs</span></div>` : ''}</td>
      </tr>`;
    }).join('');
    document.getElementById('emptyMsg').style.display = rows.length ? 'none' : 'block';
    document.getElementById('pgWrap').innerHTML = rows.length > PAGE_SIZE ? paginationControlsHTML(currentPage, rows.length, PAGE_SIZE) : '';
    wirePaginationControls((newPage) => { currentPage = Math.max(1, Math.min(newPage, totalPages)); draw(rows); }, currentPage);
  }
  draw(all);
});


/* ---- Receiving progress & automatic status ----
   A Supplier PO line carries the same lineId as the Sales Order line it sourced, so what has actually
   arrived for each order line is read straight from the Supplier POs (cancelled POs don't count). */
const SO_RANK = Object.fromEntries(SO_STATUSES.map((s, i) => [s, i]));
function soReceiving(so, supplierPOs) {
  const live = (supplierPOs || []).filter(p => p.status !== 'Cancelled');
  const perLine = {};
  live.forEach(p => (p.lines || []).forEach(pl => {
    const r = perLine[pl.lineId] = perLine[pl.lineId] || { received: 0 };
    r.received = r2(r.received + (Number(pl.receivedQty) || 0));
  }));
  const sourcedIds = new Set(live.flatMap(p => p.lineIds || []));
  // Lines that are ordered from a supplier (or have one assigned) must arrive before the order is ready to deliver.
  const needed = (so.lines || []).filter(l => l.supplierId || sourcedIds.has(l.lineId));
  const fullyIn = needed.filter(l => ((perLine[l.lineId] || {}).received || 0) >= l.qty);
  const anyIn = needed.some(l => ((perLine[l.lineId] || {}).received || 0) > 0);
  return { perLine, sourcedIds, needed, fullyIn, anyIn, hasSPO: live.length > 0 };
}
/** Moves a Sales Order forward on its own as Supplier POs are created and received. Never moves it backwards and
    never touches Cancelled / Partially Delivered / Delivered. The "Mark: ..." buttons stay as manual overrides. */
async function syncSOStatusFromSupplierPOs(soId) {
  if (soId === undefined || soId === null || soId === '' || !Number.isFinite(Number(soId))) return null;
  const so = await DB.dbGet('salesOrders', Number(soId));
  if (!so || ['Cancelled', 'Partially Delivered', 'Delivered'].includes(so.status)) return so;
  const spos = await DB.dbQueryIndex('supplierPOs', 'salesOrderId', so.id);
  const r = soReceiving(so, spos);
  if (!r.hasSPO) return so;
  const target = r.needed.length > 0 && r.fullyIn.length === r.needed.length ? 'Ready for Delivery' : (r.anyIn ? 'Partially Received' : 'Ordered from Supplier');
  if ((SO_RANK[target] ?? 0) <= (SO_RANK[so.status] ?? 0)) return so;
  so.status = target;
  so.statusHistory = (so.statusHistory || []).concat([{ status: target, date: new Date().toISOString(), auto: true }]);
  so.updatedAt = new Date().toISOString();
  await DB.dbPut('salesOrders', so);
  await DB.logActivity(`Sales order ${so.soNo} moved to ${target} automatically`);
  return so;
}

Router.route('/sales-orders/:id', (p) => renderSODetail(p.id));

/** Profit figures for one order, in PHP, on the SAME basis as the Gross Profit report and Distributions:
 *  selling price (before VAT) less the quoted cost of its lines = gross profit as ordered; then less additional costs. */
function soMarginFigures(so, supplierPOs, addCosts) {
  const addTotal = r2(addCosts.reduce((s, x) => s + (Number(x.amount) || 0), 0));
  const reason = (so.currency || 'PHP') !== 'PHP' ? `This order is in ${so.currency}, so the profit after additional costs is not worked out here.` : '';
  const lines = so.lines || [];
  let sales = 0;
  lines.forEach(l => { sales = r2(sales + QuoteCalc.computeLine(l, so.currency).net); });
  const gp = typeof soGrossProfit === 'function' ? soGrossProfit(so) : 0;
  return { addTotal, sales, gp, reason, margin: reason ? null : r2(gp - addTotal) };
}

/** "Additional Costs" card: unexpected costs we absorb on this order (import duties, courier, brokerage...).
 *  Each row is an ordinary Expense linked to the order, so it is booked once and flows to the reports and bookkeeper pack. */
function soCostsCardHTML(so, supplierPOs, addCosts) {
  const f = soMarginFigures(so, supplierPOs, addCosts);
  const types = (window.ExpenseHelpers || {}).SO_COST_TYPES || ['Miscellaneous'];
  const rows = addCosts.map(x => `<tr><td>${formatDate(x.date)}</td><td>${escapeHtml(x.category || '')}</td><td>${escapeHtml(x.description || '')}${x.vendor ? `<div class="muted-text" style="font-size:11px;">${escapeHtml(x.vendor)}</div>` : ''}</td><td>${escapeHtml(x.referenceNo || '—')}</td><td class="cost-red">${formatMoney(x.amount, 'PHP')}</td><td><a href="#/expenses/${x.id}">${escapeHtml(x.expenseNo || 'View')}</a></td></tr>`).join('');
  const money = (v) => formatMoney(v, 'PHP');
  return `
    <div class="card ${addCosts.length ? 'cost-card' : ''}" id="soCostsCard"><h3 class="section-title">Additional Costs <span class="count-pill">${addCosts.length}</span></h3>
      <p class="muted-text small">Costs we pay on this order that were not in the quotation — import duties, brokerage, courier, bank charges. They are absorbed by us (not added to the customer's total) and are recorded in Expenses automatically.</p>
      ${addCosts.length ? `<table class="data-table compact"><thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Reference</th><th>Amount</th><th>Expense</th></tr></thead><tbody>${rows}
        <tr><td colspan="4" style="text-align:right;"><b>Total additional costs</b></td><td class="cost-red">${money(f.addTotal)}</td><td></td></tr></tbody></table>` : '<div class="empty-inline">No additional costs recorded for this order.</div>'}
      <div class="btn-row" style="margin-top:10px;"><button class="btn-line btn-sm" id="btnAddSoCost">+ Add Additional Cost</button></div>
      <div id="soCostForm" style="display:none; margin-top:12px;">
        <div class="form-grid">
          <div class="field"><label>Date *</label><input type="date" id="ac_date" value="${todayISO()}"></div>
          <div class="field"><label>Type *</label><select id="ac_type">${types.map(t => `<option>${escapeHtml(t)}</option>`).join('')}</select></div>
          <div class="field"><label>Description *</label><input type="text" id="ac_desc" placeholder="e.g. UPS import charges — brokerage, government charge, VAT on service"></div>
          <div class="field"><label>Amount (PHP) *</label><input type="number" step="0.01" min="0" id="ac_amount"></div>
          <div class="field"><label>Paid to (optional)</label><input type="text" id="ac_vendor" placeholder="e.g. UPS"></div>
          <div class="field"><label>Reference / Tracking / OR No.</label><input type="text" id="ac_ref"></div>
          <div class="field"><label>Payment Method</label><select id="ac_method">${((window.ExpenseHelpers || {}).EXPENSE_PAYMENT_METHODS || ['Cash']).map(m => `<option>${escapeHtml(m)}</option>`).join('')}</select></div>
        </div>
        <div class="btn-row" style="margin-top:10px;"><button class="btn-amber btn-sm" id="btnSaveSoCost">Save Cost</button><button class="btn-line btn-sm" id="btnCancelSoCost">Cancel</button></div>
      </div>
      <h4 style="margin:16px 0 6px;">Profit on this order (PHP) — same basis as the Gross Profit report and Distributions</h4>
      <div class="detail-grid">
        <div class="detail-item"><div class="detail-label">Order sales (before VAT)</div><div class="detail-value">${money(f.sales)}</div></div>
        <div class="detail-item"><div class="detail-label">Gross profit as ordered (sales less quoted cost)</div><div class="detail-value">${f.reason ? '—' : money(f.gp)}</div></div>
        <div class="detail-item"><div class="detail-label">Additional costs paid (unexpected)</div><div class="detail-value ${f.addTotal > 0 ? 'cost-red' : ''}">${money(f.addTotal)}</div></div>
        <div class="detail-item"><div class="detail-label">Profit after additional costs</div><div class="detail-value ${f.margin != null && f.sales > 0 && f.margin / f.sales < 0.10 ? 'cost-red' : ''}">${f.margin == null ? '—' : `<b>${money(f.margin)}</b>${f.sales > 0 ? ` <span class="muted-text">(${(f.margin / f.sales * 100).toFixed(1)}% of sales)</span>` : ''}`}</div></div>
      </div>
      <p class="muted-text small">${f.reason ? escapeHtml(f.reason) : 'Profit after additional costs = gross profit as ordered − additional costs. Operating expenses such as rent are not included. Actual Supplier PO prices are not used here, so this matches the reports.'}</p>
    </div>`;
}

async function wireSOCosts(so, id) {
  const q = (i) => document.getElementById(i);
  const form = q('soCostForm'); if (!form) return;
  q('btnAddSoCost').onclick = () => { form.style.display = ''; q('ac_desc').focus(); };
  q('btnCancelSoCost').onclick = () => { form.style.display = 'none'; };
  q('btnSaveSoCost').onclick = async () => {
    const date = q('ac_date').value, desc = q('ac_desc').value.trim(), amount = Number(q('ac_amount').value);
    if (!date || !desc || !(amount > 0)) { toast('Enter the date, a description and an amount above zero.', 'err'); return; }
    const all = await DB.dbGetAll('expenses');
    const dup = all.find(x => String(x.description || '').trim().toLowerCase() === desc.toLowerCase() && Number(x.amount) === amount && x.date && Math.abs(daysBetweenISO(String(x.date).slice(0, 10), date)) <= 7);
    if (dup && !confirm(`Possible double entry: "${dup.description}" for ${formatMoney(dup.amount, 'PHP')} is already recorded on ${formatDate(dup.date)}. Save this one anyway?`)) return;
    const settings = await DB.getSettings(), now = new Date().toISOString();
    const rec = {
      date, category: q('ac_type').value, description: desc, payee: settings.companyName || 'Hadrontech Industrial Solutions', vendor: q('ac_vendor').value.trim(),
      amount: r2(amount), paymentMethod: q('ac_method').value, referenceNo: q('ac_ref').value.trim(), notes: `Additional cost on ${so.soNo}`,
      salesOrderId: so.id, soNo: so.soNo, status: 'Recorded', createdAt: now, updatedAt: now, createdBy: settings.userName, modifiedBy: settings.userName
    };
    rec.expenseNo = await DB.nextDocNumber('expense');
    await DB.dbAdd('expenses', rec);
    await DB.logActivity(`Added additional cost ${rec.expenseNo} (${formatMoney(rec.amount, 'PHP')}) to sales order ${so.soNo}`);
    toast('Additional cost saved and recorded in Expenses.'); renderSODetail(id);
  };
}

async function renderSODetail(id) {
  const so = await DB.dbGet('salesOrders', Number(id));
  const content = document.getElementById('content');
  if (!so) { content.innerHTML = `<div class="empty-state"><h3>Sales order not found</h3></div>`; return; }
  const [customer, quotation, customerPO, supplierPOs, suppliers, existingPIs] = await Promise.all([
    DB.dbGet('customers', so.customerId),
    so.quotationId ? DB.dbGet('quotations', so.quotationId) : null,
    so.customerPOId ? DB.dbGet('customerPOs', so.customerPOId) : null,
    DB.dbQueryIndex('supplierPOs', 'salesOrderId', so.id),
    DB.dbGetAll('suppliers'),
    DB.dbQueryIndex('proformaInvoices', 'salesOrderId', so.id)
  ]);
  const existingPI = existingPIs[0] || null;
  const deliveryReceipts = (await DB.dbQueryIndex('deliveryReceipts', 'salesOrderId', so.id)).sort((a, b) => String(a.drNo).localeCompare(String(b.drNo)));
  const supMap = Object.fromEntries(suppliers.map(s => [s.id, s]));
  const addCosts = (await DB.dbGetAll('expenses')).filter(x => String(x.salesOrderId) === String(so.id)).sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));

  Router.setBreadcrumb([{ label: 'Sales Orders', hash: '/sales-orders' }, { label: so.soNo }]);

  // group lines by supplier that don't yet have a supplier PO created
  const linesWithSupplierPO = new Set();
  const spoByLineId = {}; // lineId -> the supplier PO that sourced it, for showing its live status
  supplierPOs.forEach(spo => (spo.lineIds || []).forEach(lid => { linesWithSupplierPO.add(lid); spoByLineId[lid] = spo; }));
  const pendingLines = (so.lines || []).filter(l => l.supplierId && !linesWithSupplierPO.has(l.lineId));
  const pendingBySupplier = {};
  pendingLines.forEach(l => { (pendingBySupplier[l.supplierId] = pendingBySupplier[l.supplierId] || []).push(l); });

  const recv = soReceiving(so, supplierPOs);
  const undeliveredLines = (so.lines || []).filter(l => (l.deliveredQty || 0) < l.qty);
  const allDelivered = (so.lines || []).length > 0 && undeliveredLines.length === 0;
  const readyToDeliver = (so.lines || []).filter(l => ((recv.perLine[l.lineId] || {}).received || 0) > (l.deliveredQty || 0));
  const showDeliveryMismatch = so.status === 'Delivered' && undeliveredLines.length > 0;
  const headerBadge = showDeliveryMismatch ? `<span class="badge badge-lost">DELIVERED — INCOMPLETE</span>` : statusBadge(so.status);

  // "Next step": one plain line saying what this order needs from you now.
  let nextStep = null;
  if (so.status !== 'Cancelled') {
    const pendingCount = pendingLines.length;
    const waiting = recv.needed.length - recv.fullyIn.length;
    if (allDelivered) {
      let bal = '';
      if (existingPI) { try { const piS = await ProformaInvoices.ensurePISnapshot(existingPI); const due = ProformaInvoices.piBalanceDue(piS); bal = due > 0 ? ` Proforma invoice balance: ${formatMoney(due, piS.currency)}.` : ' Proforma invoice paid in full.'; } catch (e) { /* hint only */ } }
      nextStep = { done: true, text: `All items delivered.${bal}` };
    } else if (pendingCount > 0) {
      nextStep = { text: `Create a Supplier PO — ${pendingCount} item${pendingCount === 1 ? '' : 's'} ready to order.` };
    } else if (readyToDeliver.length > 0) {
      nextStep = { text: `Record Delivery — ${readyToDeliver.length} item${readyToDeliver.length === 1 ? '' : 's'} received and ready to deliver${waiting > 0 ? `; ${waiting} still waiting on suppliers` : ''}.` };
    } else if (waiting > 0 && recv.hasSPO) {
      nextStep = { text: `Waiting on suppliers — ${recv.fullyIn.length} of ${recv.needed.length} item${recv.needed.length === 1 ? '' : 's'} received.` };
    } else if ((so.lines || []).some(l => !l.supplierId && !recv.sourcedIds.has(l.lineId) && ((l.deliveredQty || 0) < l.qty))) {
      nextStep = { text: 'Some items have no supplier yet — assign one in the table below if they need ordering.' };
    }
  }

  content.innerHTML = `
    <div class="page-head">
      <div><div class="doc-number-tag">${escapeHtml(so.soNo)}</div><h1>${escapeHtml(customer?.companyName || '—')} ${headerBadge}</h1></div>
      <div class="page-actions">
        <button class="btn-line" id="btnPrint">Print</button>
        <button class="btn-line" id="btnProforma">${existingPI ? `View Proforma Invoice (${escapeHtml(existingPI.piNo)})` : 'Generate Proforma Invoice'}</button>
        ${allDelivered && so.status !== 'Cancelled' ? `<button class="btn-done" id="btnRecordDelivery" disabled title="Every item has been delivered">✓ All Delivered</button>` : `<button class="btn-amber" id="btnRecordDelivery" ${so.status === 'Cancelled' ? 'disabled title="This order is cancelled"' : ''}>Record Delivery</button>`}
        <button class="btn-line" id="btnEditDetails">Edit / Revise Order</button>
        <button class="btn-danger" id="btnDelete">Delete</button>
      </div>
    </div>


    ${nextStep ? `<div class="card next-step ${nextStep.done ? 'done' : ''}"><div class="ns-label">Next step</div><div class="ns-text">${nextStep.done ? '✓ ' : ''}${escapeHtml(nextStep.text)}</div></div>` : ''}

    ${showDeliveryMismatch ? `<div class="card danger-card">⚠ This order is marked <b>Delivered</b>, but ${undeliveredLines.length} line(s) don't actually have their delivered quantity recorded — the "Delivered" column below still shows less than what was ordered. This usually means the status was set manually instead of through "Record Delivery," so stock was never actually moved. Use <b>Record Delivery</b> above to correct this.</div>` : ''}

    <div class="card">
      <div class="status-actions">
        ${SO_STATUSES.filter(s => s !== so.status).map(s => `<button class="btn-line btn-sm status-btn" data-status="${s}">Mark: ${s}</button>`).join('')}
      </div>
    </div>

    <div class="card">
      <div class="detail-grid">
        <div class="detail-item"><div class="detail-label">Customer</div><div class="detail-value">${customer ? `<a href="#/customers/${customer.id}">${escapeHtml(customer.companyName)}</a>` : '—'}</div></div>
        <div class="detail-item"><div class="detail-label">Quotation</div><div class="detail-value">${quotation ? `<a href="#/quotations/${quotation.id}">${escapeHtml(quotation.quotationNo)}</a>` : '—'}</div></div>
        <div class="detail-item"><div class="detail-label">Customer PO</div><div class="detail-value">${customerPO ? `<a href="#/customer-pos/${customerPO.id}">${escapeHtml(customerPO.poNo)}${customerPO.customerPoNumber ? ' (' + escapeHtml(customerPO.customerPoNumber) + ')' : ''}</a>` : '—'}</div></div>
        ${so.chosenOptionLabel ? `<div class="detail-item"><div class="detail-label">Option Ordered</div><div class="detail-value">${escapeHtml(so.chosenOptionLabel)}</div></div>` : ''}
        <div class="detail-item"><div class="detail-label">Order Date</div><div class="detail-value">${formatDate(so.orderDate)}</div></div>
        <div class="detail-item"><div class="detail-label">Required Delivery Date</div><div class="detail-value">${formatDate(so.requiredDeliveryDate) || '—'}</div></div>
        <div class="detail-item"><div class="detail-label">Payment Terms</div><div class="detail-value">${escapeHtml(so.paymentTerms || '—')}</div></div>
        <div class="detail-item"><div class="detail-label">Incoterms</div><div class="detail-value">${escapeHtml(so.incoterms || '—')}</div></div>
        <div class="detail-item"><div class="detail-label">Freight / Shipping Charge</div><div class="detail-value">${formatMoney(so.freight || 0, so.currency)}</div></div>
        <div class="detail-item"><div class="detail-label">Total</div><div class="detail-value">${formatMoney(so.grandTotal, so.currency)}</div></div>
        <div class="detail-item"><div class="detail-label">Shipping Address</div><div class="detail-value">${escapeHtml(so.shippingAddress || '—')}</div></div>
        <div class="detail-item"><div class="detail-label">Internal Notes</div><div class="detail-value">${escapeHtml(so.internalNotes || '—')}</div></div>
      </div>
    </div>

    <div class="card">
      <h3 class="section-title">Order Items</h3>
      <div style="overflow-x:auto; max-width:100%;">
      <table class="data-table compact">
        <thead><tr><th>Description</th><th>Qty</th><th>Received</th><th>Delivered</th><th>Supplier</th><th>Amount</th><th class="internal-only-col">Amount w/ VAT</th><th>Sourcing</th></tr></thead>
        <tbody>
          ${(so.lines || []).map(l => {
            const lineCalc = QuoteCalc.computeLine(l);
            const amt = formatMoney(lineCalc.net, so.currency);
            const amtWithVat = formatMoney(lineCalc.lineTotal, so.currency);
            const sourced = linesWithSupplierPO.has(l.lineId);
            let supplierCell, sourcingCell;
            if (sourced) {
              const spo = spoByLineId[l.lineId];
              supplierCell = escapeHtml(supMap[l.supplierId]?.companyName || '—');
              sourcingCell = `<a href="#/supplier-pos/${spo.id}">${statusBadge(spo.status)}</a>`;
            } else if (!l.supplierId) {
              // Only the genuinely-unassigned case gets the editable dropdown — a line that
              // already has a supplier (just not yet turned into a Supplier PO) stays as
              // plain text so it can't be confused with, or accidentally overwrite, this one.
              const canAssign = !['Delivered', 'Cancelled'].includes(so.status);
              supplierCell = canAssign
                ? `<select class="ln-assign-supplier" data-lineid="${l.lineId}" style="font-size:12px; padding:4px 6px;">
                     <option value="">— Assign supplier —</option>
                     ${suppliers.filter(s => !s.archived).map(s => `<option value="${s.id}">${escapeHtml(s.companyName)}</option>`).join('')}
                   </select>`
                : '—';
              sourcingCell = '<span class="badge badge-pending">No Supplier Assigned</span>';
            } else {
              supplierCell = escapeHtml(supMap[l.supplierId]?.companyName || '—');
              sourcingCell = '<span class="badge badge-pending">Pending</span>';
            }
            const deliveredCell = (l.deliveredQty || 0) >= l.qty
              ? `<span class="cell-ok">${l.deliveredQty || 0} of ${l.qty} ${escapeHtml(l.uom)}</span>`
              : `<span class="cell-needs-input">${l.deliveredQty || 0} of ${l.qty} ${escapeHtml(l.uom)}</span>`;
            const gotQty = (recv.perLine[l.lineId] || {}).received || 0;
            const receivedCell = !recv.sourcedIds.has(l.lineId) ? '<span class="muted-text">—</span>'
              : (gotQty >= l.qty ? `<span class="cell-ok">${gotQty} of ${l.qty} ${escapeHtml(l.uom)}</span>` : `<span class="cell-needs-input">${gotQty} of ${l.qty} ${escapeHtml(l.uom)}</span>`);
            const descCell = descClip(l.description);
            return `<tr><td class="desc-col">${descCell}</td><td class="nowrap">${l.qty} ${escapeHtml(l.uom)}</td><td class="nowrap">${receivedCell}</td><td class="nowrap deliv-col">${deliveredCell}</td><td>${supplierCell}</td><td>${amt}</td><td class="internal-only-col">${amtWithVat}</td><td>${sourcingCell}</td></tr>`;
          }).join('')}
        </tbody>
      </table>
      </div>
      <p class="small muted-text">Lines without a supplier assigned yet can be assigned directly above — once assigned, they'll appear below ready to convert into a Supplier PO.</p>
    </div>

    ${Object.keys(pendingBySupplier).length > 0 ? `
      <div class="card">
        <h3 class="section-title">Create Supplier Purchase Orders</h3>
        <p class="muted-text">Items are grouped by their assigned supplier. Create a supplier PO for each group as needed.</p>
        ${Object.entries(pendingBySupplier).map(([supId, lines]) => `
          <div class="supplier-group">
            <div><b>${escapeHtml(supMap[supId]?.companyName || 'Unknown Supplier')}</b> — ${lines.length} item(s)</div>
            <button class="btn-amber btn-sm" data-create-spo="${supId}">Create Supplier PO</button>
          </div>
        `).join('')}
      </div>` : ''}

    ${relatedTable('Supplier Purchase Orders', supplierPOs, ['poNo', 'poDate', 'status', 'totalCost'], '/supplier-pos', so.currency)}

    ${soCostsCardHTML(so, supplierPOs, addCosts)}

    <div class="card"><h3 class="section-title">Delivery Receipts</h3>
      ${deliveryReceipts.length ? `<table class="data-table compact"><thead><tr><th>Receipt No.</th><th>Delivery Date</th><th>Items</th><th>Status</th></tr></thead><tbody>${deliveryReceipts.map(d => `<tr class="clickable-row" data-hash="/delivery-receipts/${d.id}"><td><a href="#/delivery-receipts/${d.id}">${escapeHtml(d.drNo)}</a></td><td>${formatDate(d.date)}</td><td>${(d.lines || []).map(l => escapeHtml(l.qty + ' ' + l.uom + ' ' + l.description)).join('; ')}</td><td>${statusBadge(d.status)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty-inline">No deliveries yet. Click “Record Delivery” — a numbered Delivery Receipt is created for each delivery, ready to print and sign.</div>'}
    </div>

    <div id="recordDeliveryHost"></div>

    <div class="meta-strip">Created ${formatDate(so.createdAt)} by ${escapeHtml(so.createdBy || '—')} · Last modified ${formatDate(so.updatedAt)} by ${escapeHtml(so.modifiedBy || '—')}</div>
  `;

  wireSOCosts(so, id);
  if (window.__openAddCost === so.id) { window.__openAddCost = null; const b = document.getElementById('btnAddSoCost'); if (b) { b.click(); const cc = document.getElementById('soCostsCard'); if (cc && cc.scrollIntoView) cc.scrollIntoView(); } }
  document.getElementById('btnPrint').onclick = () => Print.printSalesOrder(so, customer, customerPO, quotation);
  document.getElementById('btnProforma').onclick = () => ProformaInvoices.getOrCreateProformaInvoice(so);
  document.getElementById('btnRecordDelivery').onclick = () => {
    if (so.status === 'Cancelled') { toast('This order is cancelled — nothing to deliver.', 'err'); return; }
    renderRecordDeliveryForm(so, id);
  };
  document.getElementById('btnEditDetails').onclick = () => renderSOHeaderEdit(so);
  content.querySelectorAll('.ln-assign-supplier').forEach(sel => sel.addEventListener('change', async (e) => {
    const line = so.lines.find(l => l.lineId === e.target.dataset.lineid);
    if (!line) return;
    line.supplierId = e.target.value ? Number(e.target.value) : '';
    so.updatedAt = new Date().toISOString();
    await DB.dbPut('salesOrders', so);
    await DB.logActivity(`Assigned supplier to a line on sales order ${so.soNo}`);
    renderSODetail(id);
  }));
  document.getElementById('btnDelete').onclick = async () => {
    if (deliveryReceipts.length) { alert(`Sales order ${so.soNo} has ${deliveryReceipts.length} delivery receipt(s) (${deliveryReceipts.map(d => d.drNo).join(', ')}) and can't be deleted. Void the receipts first if they were made by mistake.`); return; }
    if (!confirm(`Delete sales order ${so.soNo}? This cannot be undone.`)) return;
    await DB.dbDelete('salesOrders', so.id);
    await DB.logActivity(`Deleted sales order ${so.soNo}`);
    toast('Deleted.'); Router.navigate('/sales-orders');
  };
  content.querySelectorAll('.status-btn').forEach(btn => btn.onclick = async () => {
    const newStatus = btn.dataset.status;
    const SO_TERMINAL = ['Cancelled'];
    const movingIntoTerminal = SO_TERMINAL.includes(newStatus);
    const hasChildPOs = supplierPOs.length > 0;

    if (newStatus === 'Delivered') {
      // "Record Delivery" is the correct path — it logs real quantities and moves actual
      // stock. Manually flipping the status here bypasses both, so if quantities don't
      // actually match, the person needs to know exactly what they're overriding.
      const undelivered = (so.lines || []).filter(l => (l.deliveredQty || 0) < l.qty);
      if (undelivered.length > 0) {
        const detail = undelivered.map(l => `• ${l.description}: ${l.deliveredQty || 0} of ${l.qty} ${l.uom} recorded`).join('\n');
        if (!confirm(`${undelivered.length} line(s) don't actually have their delivered quantity recorded yet:\n\n${detail}\n\nThe correct way to mark this order Delivered is the "Record Delivery" button above — it logs the real quantities and updates stock correctly. Marking it Delivered here will NOT do either of those things.\n\nOverride and mark it Delivered anyway?`)) return;
      }
    }
    if (movingIntoTerminal) {
      const extra = newStatus === 'Cancelled' && hasChildPOs ? ` This sales order has ${supplierPOs.length} linked Supplier PO(s) that will NOT be automatically cancelled — check those separately.` : '';
      if (!confirm(`Mark ${so.soNo} as ${newStatus}?${extra}`)) return;
    }
    so.status = newStatus;
    so.statusHistory = (so.statusHistory || []).concat([{ status: newStatus, date: new Date().toISOString() }]);
    so.updatedAt = new Date().toISOString();
    await DB.dbPut('salesOrders', so);
    await DB.logActivity(`Sales order ${so.soNo} marked as ${newStatus}`);
    toast('Status updated.'); renderSODetail(id);
  });
  content.querySelectorAll('[data-create-spo]').forEach(btn => btn.onclick = async () => {
    const supId = Number(btn.dataset.createSpo);
    const lines = pendingBySupplier[supId];
    await SupplierPOs.createFromSalesOrder(so, supId, lines);
  });
}

/* ---------- RECORD DELIVERY ---------- */

/** Project Package items aren't kept in stock, so "what can be delivered" is what the Supplier POs have actually received
    minus what has already gone out. Same idea as the On Hand cap for catalog items. */
async function projectAvailableByLine(so) {
  const spos = await DB.dbQueryIndex('supplierPOs', 'salesOrderId', so.id);
  const recv = soReceiving(so, spos);
  const out = {};
  (so.lines || []).filter(l => l.compNo).forEach(l => {
    out[l.lineId] = Math.max(0, r2(((recv.perLine[l.lineId] || {}).received || 0) - (l.deliveredQty || 0)));
  });
  return out;
}
async function renderRecordDeliveryForm(so, id) {
  const host = document.getElementById('recordDeliveryHost');
  const deliverableLines = (so.lines || []).filter(l => (l.deliveredQty || 0) < l.qty);
  if (deliverableLines.length === 0) {
    host.innerHTML = `<div class="card"><div class="empty-inline">Everything on this order has already been delivered. Nothing left to record.</div></div>`;
    return;
  }
  // You can't hand a customer stock you don't actually have — cap what can be entered here to
  // what's really On Hand right now, the same number shown on the product's own Stock panel.
  const getOnHand = async (productId) => {
    const movements = await DB.dbQueryIndex('stockMovements', 'productId', Number(productId));
    return r2(movements.reduce((s, m) => s + m.qty, 0));
  };
  const projAvail = await projectAvailableByLine(so);
  const onHandByLine = {};
  for (const l of deliverableLines) {
    if (l.itemId && !l.compNo) onHandByLine[l.lineId] = await getOnHand(l.itemId);
  }
  host.innerHTML = `
    <div class="card">
      <h3 class="section-title">Record Delivery</h3>
      <p class="muted-text">Enter how many units actually went out to the customer for each line. This can be done more than once for partial shipments — only the quantity entered here leaves stock. You can't deliver more than what's actually On Hand — if a supplier order hasn't been received yet, receive it first.</p>
      <div class="form-grid" style="margin-bottom:12px;">
        <div class="field"><label>Delivery date</label><input type="date" id="dl_date" value="${todayISO()}"></div>
        <div class="field"><label>Delivered by</label><input id="dl_by" value="${escapeHtml((await DB.getSettings()).userName || '')}"></div>
        <div class="field"><label>Vehicle / courier / waybill (optional)</label><input id="dl_vehicle"></div>
        <div class="field"><label>Official invoice no. (BIR, optional)</label><input id="dl_inv"></div>
        <div class="field field-wide"><label>Remarks (optional, printed on the receipt)</label><input id="dl_remarks"></div>
      </div>
      <table class="data-table compact">
        <thead><tr><th>Description</th><th>Ordered</th><th>Delivered So Far</th><th>Delivering Now</th></tr></thead>
        <tbody>
          ${deliverableLines.map(l => {
            const remaining = r2(l.qty - (l.deliveredQty || 0));
            const onHand = (l.itemId && !l.compNo) ? (onHandByLine[l.lineId] ?? 0) : null;
            const pAvail = l.compNo ? (projAvail[l.lineId] ?? 0) : null;
            const cap = l.compNo ? Math.min(remaining, pAvail) : (onHand === null ? remaining : Math.min(remaining, Math.max(onHand, 0)));
            const stockNote = onHand !== null && onHand < remaining
              ? `<br><span class="cell-needs-input">Only ${onHand} in stock — receive more from the supplier first</span>`
              : (l.compNo && pAvail < remaining ? `<br><span class="cell-needs-input">${pAvail > 0 ? `Only ${pAvail} received so far` : 'Not received yet'} — receive it on the Supplier PO first</span>` : '');
            return `<tr data-lineid="${l.lineId}" data-onhand="${onHand === null ? '' : onHand}">
              <td class="desc-col">${descClip(l.description, (l.compNo ? '<span class="muted-text">(project item — not kept in stock)</span>' : (!l.itemId ? '<span class="muted-text">(not linked to a catalog product — won\'t affect stock)</span>' : '')) + stockNote)}</td>
              <td>${l.qty} ${escapeHtml(l.uom)}</td>
              <td>${l.deliveredQty || 0} ${escapeHtml(l.uom)}</td>
              <td><input type="number" min="0" max="${cap}" step="any" class="deliv-qty" value="${cap}" style="width:90px;"></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      <div class="btn-row" style="margin-top:14px;">
        <button class="btn-amber btn-sm" id="btnConfirmDeliver">Confirm Delivery</button>
        <button class="btn-line btn-sm" id="btnCancelDeliver">Cancel</button>
      </div>
    </div>
  `;
  host.scrollIntoView && host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  document.getElementById('btnCancelDeliver').onclick = () => { host.innerHTML = ''; };
  document.getElementById('btnConfirmDeliver').onclick = async () => {
    const rows = [...host.querySelectorAll('tr[data-lineid]')];
    const settings = await DB.getSettings();
    const now = new Date().toISOString();
    let anyDelivered = false; const deliveredNow = [], moveIds = [];
    const projAvailNow = await projectAvailableByLine(so);

    for (const row of rows) {
      const lineId = row.dataset.lineid;
      const qtyNow = r2(Number(row.querySelector('.deliv-qty').value) || 0);
      if (qtyNow <= 0) continue;
      const line = so.lines.find(l => l.lineId === lineId);
      if (!line) continue;
      const remaining = r2(line.qty - (line.deliveredQty || 0));
      if (qtyNow > remaining) { toast(`Cannot deliver more than the remaining ${remaining} for "${line.description}".`, 'err'); return; }

      if (line.compNo && qtyNow > (projAvailNow[line.lineId] ?? 0)) {
        toast(`Cannot deliver ${qtyNow} of "${line.description}" — only ${projAvailNow[line.lineId] ?? 0} received from the supplier so far. Receive it on the Supplier PO first, or reduce the quantity.`, 'err');
        return;
      }

      if (line.itemId && !line.compNo) {
        const currentOnHand = await getOnHand(line.itemId);
        if (qtyNow > currentOnHand) {
          toast(`Cannot deliver ${qtyNow} of "${line.description}" — only ${currentOnHand} actually in stock. Receive the supplier order first, or reduce the quantity.`, 'err');
          return;
        }
      }

      line.deliveredQty = r2((line.deliveredQty || 0) + qtyNow);
      anyDelivered = true; deliveredNow.push({ lineId, qty: qtyNow });

      if (line.itemId && !line.compNo) {
        moveIds.push(await DB.dbAdd('stockMovements', {
          productId: Number(line.itemId), type: 'Delivery', qty: -qtyNow, date: todayISO(),
          reference: `Sales Order ${so.soNo}`, referenceId: so.id, referenceLineId: lineId,
          note: '', createdBy: settings.userName, createdAt: now
        }));
      }
    }

    if (!anyDelivered) { toast('Enter a quantity greater than 0 for at least one line.', 'err'); return; }

    // Mirrors exactly how Supplier PO already auto-reflects receiving progress — a partial
    // delivery is a real, meaningful state, not silently invisible until everything's out.
    const allDelivered = so.lines.every(l => (l.deliveredQty || 0) >= l.qty);
    if (so.status !== 'Cancelled') {
      so.status = allDelivered ? 'Delivered' : 'Partially Delivered';
      so.statusHistory = (so.statusHistory || []).concat([{ status: so.status, date: now }]);
    }
    so.updatedAt = now; so.modifiedBy = settings.userName;
    await DB.dbPut('salesOrders', so);
    await DB.logActivity(`Recorded delivery for sales order ${so.soNo}`);
    // One numbered Delivery Receipt per delivery (printable, no prices, signed by the customer).
    const g = (i) => (document.getElementById(i) || {}).value || '';
    const made = await window.DeliveryReceipts.createDeliveryReceipt(so, deliveredNow, { date: g('dl_date'), deliveredBy: g('dl_by').trim(), vehicle: g('dl_vehicle').trim(), invoiceNo: g('dl_inv').trim(), remarks: g('dl_remarks').trim() });
    for (const mid of moveIds) { const m = await DB.dbGet('stockMovements', mid); if (m) { m.reference = `Delivery Receipt ${made.drNo} (${so.soNo})`; await DB.dbPut('stockMovements', m); } }
    toast(`Delivery recorded — Delivery Receipt ${made.drNo} created.`);
    Router.navigate(`/delivery-receipts/${made.id}`);
  };
}

window.SalesOrders = { createFromCustomerPO, syncStatus: syncSOStatusFromSupplierPOs, receiving: soReceiving };
window.SO_STATUSES = SO_STATUSES;

async function renderSOHeaderEdit(so) {
  const linkedSupplierPOs = await DB.dbQueryIndex('supplierPOs', 'salesOrderId', so.id);
  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="page-head"><h1>Edit Sales Order — ${escapeHtml(so.soNo)}</h1></div>
    ${linkedSupplierPOs.length > 0 ? `<div class="card warning-card">⚠ ${linkedSupplierPOs.length} Supplier PO(s) already exist for this Sales Order (${linkedSupplierPOs.map(p => p.poNo).join(', ')}). Revising line items here will <b>not</b> automatically update those — if quantities or items change, revise the affected Supplier PO(s) separately to match.</div>` : ''}
    <form class="card form-card" id="soForm">
      <div class="form-grid">
        <div class="field"><label>Required Delivery Date</label><input type="date" id="f_requiredDeliveryDate" value="${so.requiredDeliveryDate || ''}"></div>
        <div class="field"><label>Payment Terms</label><input id="f_paymentTerms" value="${escapeHtml(so.paymentTerms || '')}"></div>
        <div class="field"><label>Incoterms</label><input id="f_incoterms" value="${escapeHtml(so.incoterms || '')}"></div>
        <div class="field"><label>Freight / Shipping Charge</label><input type="number" step="0.01" id="f_freight" value="${so.freight || 0}"></div>
        <div class="field field-wide"><label>Shipping Address</label><textarea id="f_shippingAddress">${escapeHtml(so.shippingAddress || '')}</textarea></div>
        <div class="field field-wide"><label>Internal Notes</label><textarea id="f_internalNotes">${escapeHtml(so.internalNotes || '')}</textarea></div>
      </div>

      <h3 class="section-title" style="margin-top:16px;">Items</h3>
      <p class="muted-text">Correct quantities, prices, or descriptions if what the customer actually ordered differs slightly from the original quotation.</p>
      <div style="overflow-x:auto; max-width:100%;">
      <table class="data-table compact">
        <thead><tr><th>Description</th><th style="width:55px;">Qty</th><th style="width:45px;">UOM</th><th style="width:80px;">Unit Price</th><th class="internal-only-col" style="width:75px;">Unit Cost</th><th style="width:50px;">VAT%</th><th>Amount</th><th class="internal-only-col">Amount w/ VAT</th><th></th></tr></thead>
        <tbody id="soLinesBody"></tbody>
      </table>
      </div>
      <button type="button" class="btn-line btn-sm" id="btnAddSoLine" style="margin-top:8px;">+ Add Line</button>

      <div class="form-actions">
        <button type="submit" class="btn-amber">Save</button>
        <button type="button" class="btn-line" id="btnCancel">Cancel</button>
      </div>
    </form>
  `;
  content.querySelectorAll('input,textarea').forEach(i => i.addEventListener('input', markDirty));

  let editLines = (so.lines || []).map(l => Object.assign({}, l));
  function drawSoLines() {
    const body = document.getElementById('soLinesBody');
    body.innerHTML = editLines.map((l, i) => {
      const c = QuoteCalc.computeLine(l);
      return `<tr data-idx="${i}">
        <td class="line-desc-locked" title="Description is locked to keep it consistent across the Quotation/Customer PO/Sales Order/Supplier PO chain — use Internal Notes above for any clarification.">${escapeHtml(l.description || '')}</td>
        <td><input class="so-qty" type="number" min="0" step="any" value="${l.qty || 0}" style="width:55px;"></td>
        <td><input class="so-uom" value="${escapeHtml(l.uom || 'pc')}" style="width:45px;"></td>
        <td><input class="so-price" type="number" min="0" step="0.01" value="${l.unitPrice || 0}" style="width:80px;"></td>
        <td class="internal-only-col"><input class="so-cost" type="number" min="0" step="0.01" value="${l.unitCost || 0}" style="width:75px;"></td>
        <td><input class="so-vat" type="number" min="0" step="0.01" value="${l.vatRate ?? 12}" style="width:50px;"></td>
        <td class="so-amount" style="text-align:right; font-family:var(--mono);">${formatMoney(c.net, so.currency)}</td>
        <td class="internal-only-col so-amount-vat" style="text-align:right; font-family:var(--mono);">${formatMoney(c.lineTotal, so.currency)}</td>
        <td class="row-del" data-sodel="${i}">✕</td>
      </tr>`;
    }).join('');
    body.querySelectorAll('tr').forEach(tr => {
      const idx = Number(tr.dataset.idx);
      const bind = (sel, field, isNum) => tr.querySelector(sel).addEventListener('input', (e) => {
        editLines[idx][field] = isNum ? (Number(e.target.value) || 0) : e.target.value;
        const c = QuoteCalc.computeLine(editLines[idx]);
        tr.querySelector('.so-amount').textContent = formatMoney(c.net, so.currency);
        tr.querySelector('.so-amount-vat').textContent = formatMoney(c.lineTotal, so.currency);
        markDirty();
      });
      bind('.so-qty', 'qty', true); bind('.so-uom', 'uom');
      bind('.so-price', 'unitPrice', true); bind('.so-cost', 'unitCost', true); bind('.so-vat', 'vatRate', true);
    });
    body.querySelectorAll('[data-sodel]').forEach(btn => btn.addEventListener('click', () => {
      if (editLines.length === 1) { toast('A sales order needs at least one line item.', 'err'); return; }
      editLines.splice(Number(btn.dataset.sodel), 1);
      drawSoLines(); markDirty();
    }));
  }
  drawSoLines();
  document.getElementById('btnAddSoLine').onclick = () => {
    const description = prompt('Description for this new line item:');
    if (!description || !description.trim()) return; // no blank/locked-forever lines
    editLines.push({ lineId: 'L' + Math.random().toString(36).slice(2, 9), itemId: '', brand: '', modelNo: '', description: description.trim(), qty: 1, uom: 'pc', unitCost: 0, unitPrice: 0, discountPercent: 0, vatRate: 12, supplierId: '', deliveredQty: 0 });
    drawSoLines(); markDirty();
  };

  document.getElementById('btnCancel').onclick = () => { if (!guardNavigation()) return; clearDirty(); renderSODetail(so.id); };
  document.getElementById('soForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!editLines.every(l => l.description && Number(l.qty) > 0)) { toast('Every line needs a description and quantity greater than 0.', 'err'); return; }
    const settings = await DB.getSettings();
    let subtotal = 0, vatTotal = 0;
    editLines.forEach(l => { const c = QuoteCalc.computeLine(l); subtotal = r2(subtotal + c.net); vatTotal = r2(vatTotal + c.vatAmt); });
    const freight = Number(document.getElementById('f_freight').value) || 0;
    const grandTotal = r2(subtotal + vatTotal + freight + (Number(so.other) || 0));
    Object.assign(so, {
      requiredDeliveryDate: document.getElementById('f_requiredDeliveryDate').value,
      paymentTerms: document.getElementById('f_paymentTerms').value,
      incoterms: document.getElementById('f_incoterms').value,
      shippingAddress: document.getElementById('f_shippingAddress').value,
      internalNotes: document.getElementById('f_internalNotes').value,
      lines: editLines, subtotal, vatTotal, freight, grandTotal,
      updatedAt: new Date().toISOString(), modifiedBy: settings.userName
    });
    await DB.dbPut('salesOrders', so);
    await DB.logActivity(`Revised sales order ${so.soNo}`);
    toast('Saved.'); clearDirty(); Router.navigate(`/sales-orders/${so.id}`);
  });
}
