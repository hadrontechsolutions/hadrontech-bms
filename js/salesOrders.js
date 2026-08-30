/* ============================================================
   salesOrders.js — Sales Orders. Created from a won Quotation +
   Customer PO (line items/pricing are copied in, not re-typed).
   One Sales Order can spawn multiple Supplier POs (grouped by supplier).
   ============================================================ */

const SO_STATUSES = ['Draft', 'Confirmed', 'Sourcing', 'Ordered from Supplier', 'Partially Received', 'Ready for Delivery', 'Delivered', 'Cancelled'];

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
  const [all, customers, customerPOs, quotations] = await Promise.all([DB.dbGetAll('salesOrders'), DB.dbGetAll('customers'), DB.dbGetAll('customerPOs'), DB.dbGetAll('quotations')]);
  const custMap = Object.fromEntries(customers.map(c => [c.id, c]));
  const cpoMap = Object.fromEntries(customerPOs.map(p => [p.id, p]));
  const quoteMap = Object.fromEntries(quotations.map(q => [q.id, q]));
  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="page-head"><h1>Sales Orders</h1></div>
    <div class="card">
      <table class="data-table">
        <thead><tr><th>SO #</th><th>Customer</th><th>Quotation #</th><th>Customer PO #</th><th>Order Date</th><th>Status</th><th>Total</th></tr></thead>
        <tbody>
          ${all.map(so => {
            const mismatched = so.status === 'Delivered' && (so.lines || []).some(l => (l.deliveredQty || 0) < l.qty);
            const badgeHTML = mismatched ? `<span class="badge badge-lost">DELIVERED — INCOMPLETE</span>` : statusBadge(so.status);
            return `
            <tr class="clickable-row" data-hash="/sales-orders/${so.id}">
              <td>${escapeHtml(so.soNo)}</td><td>${escapeHtml(custMap[so.customerId]?.companyName || '—')}</td>
              <td>${escapeHtml(quoteMap[so.quotationId]?.quotationNo || '—')}</td>
              <td>${escapeHtml(cpoMap[so.customerPOId]?.customerPoNumber || cpoMap[so.customerPOId]?.poNo || '—')}</td>
              <td>${formatDate(so.orderDate)}</td><td>${badgeHTML}</td><td>${formatMoney(so.grandTotal, so.currency)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      ${all.length === 0 ? `<div class="empty-inline">No sales orders yet. Convert a won quotation's customer PO to create one.</div>` : ''}
    </div>
  `;
});

Router.route('/sales-orders/:id', (p) => renderSODetail(p.id));

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
  const supMap = Object.fromEntries(suppliers.map(s => [s.id, s]));

  Router.setBreadcrumb([{ label: 'Sales Orders', hash: '/sales-orders' }, { label: so.soNo }]);

  // group lines by supplier that don't yet have a supplier PO created
  const linesWithSupplierPO = new Set();
  const spoByLineId = {}; // lineId -> the supplier PO that sourced it, for showing its live status
  supplierPOs.forEach(spo => (spo.lineIds || []).forEach(lid => { linesWithSupplierPO.add(lid); spoByLineId[lid] = spo; }));
  const pendingLines = (so.lines || []).filter(l => l.supplierId && !linesWithSupplierPO.has(l.lineId));
  const pendingBySupplier = {};
  pendingLines.forEach(l => { (pendingBySupplier[l.supplierId] = pendingBySupplier[l.supplierId] || []).push(l); });

  const undeliveredLines = (so.lines || []).filter(l => (l.deliveredQty || 0) < l.qty);
  const showDeliveryMismatch = so.status === 'Delivered' && undeliveredLines.length > 0;
  const headerBadge = showDeliveryMismatch ? `<span class="badge badge-lost">DELIVERED — INCOMPLETE</span>` : statusBadge(so.status);

  content.innerHTML = `
    <div class="page-head">
      <div><div class="doc-number-tag">${escapeHtml(so.soNo)}</div><h1>${escapeHtml(customer?.companyName || '—')} ${headerBadge}</h1></div>
      <div class="page-actions">
        <button class="btn-line" id="btnPrint">Print</button>
        <button class="btn-line" id="btnProforma">${existingPI ? `View Proforma Invoice (${escapeHtml(existingPI.piNo)})` : 'Generate Proforma Invoice'}</button>
        <button class="btn-amber" id="btnRecordDelivery">Record Delivery</button>
        <button class="btn-line" id="btnEditDetails">Edit / Revise Order</button>
        <button class="btn-danger" id="btnDelete">Delete</button>
      </div>
    </div>

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
        <thead><tr><th>Description</th><th>Qty</th><th>Delivered</th><th>Supplier</th><th>Amount</th><th class="internal-only-col">Amount w/ VAT</th><th>Sourcing</th></tr></thead>
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
              ? `${l.deliveredQty || 0} ${escapeHtml(l.uom)} ✓`
              : `<span class="cell-needs-input">${l.deliveredQty || 0} of ${l.qty} ${escapeHtml(l.uom)}</span>`;
            return `<tr><td>${escapeHtml(l.description)}</td><td>${l.qty} ${escapeHtml(l.uom)}</td><td>${deliveredCell}</td><td>${supplierCell}</td><td>${amt}</td><td class="internal-only-col">${amtWithVat}</td><td>${sourcingCell}</td></tr>`;
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

    <div id="recordDeliveryHost"></div>

    <div class="meta-strip">Created ${formatDate(so.createdAt)} by ${escapeHtml(so.createdBy || '—')} · Last modified ${formatDate(so.updatedAt)} by ${escapeHtml(so.modifiedBy || '—')}</div>
  `;

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

function renderRecordDeliveryForm(so, id) {
  const host = document.getElementById('recordDeliveryHost');
  const deliverableLines = (so.lines || []).filter(l => (l.deliveredQty || 0) < l.qty);
  if (deliverableLines.length === 0) {
    host.innerHTML = `<div class="card"><div class="empty-inline">Everything on this order has already been delivered. Nothing left to record.</div></div>`;
    return;
  }
  host.innerHTML = `
    <div class="card">
      <h3 class="section-title">Record Delivery</h3>
      <p class="muted-text">Enter how many units actually went out to the customer for each line. This can be done more than once for partial shipments — only the quantity entered here leaves stock.</p>
      <table class="data-table compact">
        <thead><tr><th>Description</th><th>Ordered</th><th>Delivered So Far</th><th>Delivering Now</th></tr></thead>
        <tbody>
          ${deliverableLines.map(l => {
            const remaining = r2(l.qty - (l.deliveredQty || 0));
            return `<tr data-lineid="${l.lineId}">
              <td>${escapeHtml(l.description)}${!l.itemId ? ' <span class="muted-text">(not linked to a catalog product — won\'t affect stock)</span>' : ''}</td>
              <td>${l.qty} ${escapeHtml(l.uom)}</td>
              <td>${l.deliveredQty || 0} ${escapeHtml(l.uom)}</td>
              <td><input type="number" min="0" max="${remaining}" step="any" class="deliv-qty" value="${remaining}" style="width:90px;"></td>
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
    let anyDelivered = false;

    for (const row of rows) {
      const lineId = row.dataset.lineid;
      const qtyNow = r2(Number(row.querySelector('.deliv-qty').value) || 0);
      if (qtyNow <= 0) continue;
      const line = so.lines.find(l => l.lineId === lineId);
      if (!line) continue;
      const remaining = r2(line.qty - (line.deliveredQty || 0));
      if (qtyNow > remaining) { toast(`Cannot deliver more than the remaining ${remaining} for "${line.description}".`, 'err'); return; }

      line.deliveredQty = r2((line.deliveredQty || 0) + qtyNow);
      anyDelivered = true;

      if (line.itemId) {
        await DB.dbAdd('stockMovements', {
          productId: Number(line.itemId), type: 'Delivery', qty: -qtyNow, date: todayISO(),
          reference: `Sales Order ${so.soNo}`, referenceId: so.id, referenceLineId: lineId,
          note: '', createdBy: settings.userName, createdAt: now
        });
      }
    }

    if (!anyDelivered) { toast('Enter a quantity greater than 0 for at least one line.', 'err'); return; }

    const allDelivered = so.lines.every(l => (l.deliveredQty || 0) >= l.qty);
    if (allDelivered && so.status !== 'Cancelled') {
      so.status = 'Delivered';
      so.statusHistory = (so.statusHistory || []).concat([{ status: 'Delivered', date: now }]);
    }
    so.updatedAt = now; so.modifiedBy = settings.userName;
    await DB.dbPut('salesOrders', so);
    await DB.logActivity(`Recorded delivery for sales order ${so.soNo}`);
    toast('Delivery recorded.');
    renderSODetail(id);
  };
}

window.SalesOrders = { createFromCustomerPO };

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
        <td><textarea class="so-desc" rows="1" style="width:160px;">${escapeHtml(l.description || '')}</textarea></td>
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
      bind('.so-desc', 'description'); bind('.so-qty', 'qty', true); bind('.so-uom', 'uom');
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
    editLines.push({ lineId: 'L' + Math.random().toString(36).slice(2, 9), itemId: '', brand: '', modelNo: '', description: '', qty: 1, uom: 'pc', unitCost: 0, unitPrice: 0, discountPercent: 0, vatRate: 12, supplierId: '', deliveredQty: 0 });
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
