/* ============================================================
   supplierPOs.js — Purchase Orders sent TO suppliers, created from a
   group of Sales Order lines assigned to that supplier.
   ============================================================ */

const SPO_STATUSES = ['Draft', 'Sent', 'Awaiting Confirmation', 'Confirmed', 'In Production', 'Ready for Shipment', 'Shipped', 'Partially Received', 'Received', 'Cancelled'];

async function createFromSalesOrder(so, supplierId, lines) {
  const settings = await DB.getSettings();
  const supplier = await DB.dbGet('suppliers', supplierId);
  const customerPO = so.customerPOId ? await DB.dbGet('customerPOs', so.customerPOId) : null;
  const now = new Date().toISOString();
  const poLines = lines.map(l => ({
    lineId: l.lineId, itemId: l.itemId || '', description: l.description, brand: l.brand, modelNo: l.modelNo,
    qty: l.qty, uom: l.uom, unitCost: l.unitCost, discountPercent: 0, receivedQty: 0,
    amount: r2((Number(l.qty) || 0) * (Number(l.unitCost) || 0))
  }));
  const totalCost = r2(poLines.reduce((s, l) => s + l.amount, 0));
  const poNo = await DB.nextDocNumber('supplierPO');
  const rec = {
    poNo, supplierId, salesOrderId: so.id, quotationId: so.quotationId || null,
    customerPORef: customerPO ? (customerPO.customerPoNumber || customerPO.poNo) : '',
    poDate: todayISO(), currency: supplier?.currency || 'PHP', supplierQuoteRef: '',
    paymentTerms: supplier?.paymentTerms || '', incoterms: supplier?.incoterms || '',
    shippingTerms: '', deliveryAddress: so.shippingAddress || '',
    expectedDeliveryDate: '', lineIds: lines.map(l => l.lineId), lines: poLines,
    freight: 0, taxes: 0, totalCost, status: 'Draft',
    statusHistory: [{ status: 'Draft', date: now }],
    notes: '', createdAt: now, updatedAt: now, createdBy: settings.userName, modifiedBy: settings.userName
  };
  const newId = await DB.dbAdd('supplierPOs', rec);
  await DB.logActivity(`Created supplier PO ${poNo} for ${supplier?.companyName || 'supplier'} from sales order ${so.soNo}`);
  toast('Supplier PO created.');
  Router.navigate(`/supplier-pos/${newId}`);
}

Router.route('/supplier-pos', async () => {
  Router.setBreadcrumb([{ label: 'Supplier Purchase Orders' }]);
  const [all, suppliers, salesOrders] = await Promise.all([DB.dbGetAll('supplierPOs'), DB.dbGetAll('suppliers'), DB.dbGetAll('salesOrders')]);
  const supMap = Object.fromEntries(suppliers.map(s => [s.id, s]));
  const soMap = Object.fromEntries(salesOrders.map(s => [s.id, s]));
  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="page-head"><h1>Supplier Purchase Orders</h1></div>
    <div class="card">
      <table class="data-table">
        <thead><tr><th>PO #</th><th>Supplier</th><th>Sales Order</th><th>PO Date</th><th>Status</th><th>Total Cost</th></tr></thead>
        <tbody>
          ${all.map(po => {
            const mismatched = po.status === 'Received' && (po.lines || []).some(l => (l.receivedQty || 0) < l.qty);
            const badgeHTML = mismatched ? `<span class="badge badge-lost">RECEIVED — INCOMPLETE</span>` : statusBadge(po.status);
            return `
            <tr class="clickable-row" data-hash="/supplier-pos/${po.id}">
              <td>${escapeHtml(po.poNo)}</td><td>${escapeHtml(supMap[po.supplierId]?.companyName || '—')}</td>
              <td>${escapeHtml(soMap[po.salesOrderId]?.soNo || '—')}</td>
              <td>${formatDate(po.poDate)}</td><td>${badgeHTML}</td><td>${formatMoney(po.totalCost, po.currency)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      ${all.length === 0 ? `<div class="empty-inline">No supplier POs yet. Create one from a Sales Order.</div>` : ''}
    </div>
  `;
});

Router.route('/supplier-pos/:id', (p) => renderSPODetail(p.id));

async function renderSPODetail(id) {
  const po = await DB.dbGet('supplierPOs', Number(id));
  const content = document.getElementById('content');
  if (!po) { content.innerHTML = `<div class="empty-state"><h3>Record not found</h3></div>`; return; }
  const [supplier, salesOrder] = await Promise.all([
    DB.dbGet('suppliers', po.supplierId),
    po.salesOrderId ? DB.dbGet('salesOrders', po.salesOrderId) : null
  ]);
  const customerPO = salesOrder?.customerPOId ? await DB.dbGet('customerPOs', salesOrder.customerPOId) : null;

  Router.setBreadcrumb([{ label: 'Supplier Purchase Orders', hash: '/supplier-pos' }, { label: po.poNo }]);

  const unreceivedLines = (po.lines || []).filter(l => (l.receivedQty || 0) < l.qty);
  const showReceiveMismatch = po.status === 'Received' && unreceivedLines.length > 0;
  const headerBadge = showReceiveMismatch ? `<span class="badge badge-lost">RECEIVED — INCOMPLETE</span>` : statusBadge(po.status);

  content.innerHTML = `
    <div class="page-head">
      <div><div class="doc-number-tag">${escapeHtml(po.poNo)}</div><h1>${escapeHtml(supplier?.companyName || '—')} ${headerBadge}</h1></div>
      <div class="page-actions">
        <button class="btn-line" id="btnPrint">Print</button>
        <button class="btn-amber" id="btnReceiveStock">Receive Stock</button>
        <button class="btn-line" id="btnEditHeader">Edit / Revise PO</button>
        <button class="btn-danger" id="btnDelete">Delete</button>
      </div>
    </div>

    ${showReceiveMismatch ? `<div class="card danger-card">⚠ This PO is marked <b>Received</b>, but ${unreceivedLines.length} line(s) don't actually have their received quantity recorded — the "Received Qty" column below still shows less than what was ordered. This usually means the status was set manually instead of through "Receive Stock," so your inventory was never actually updated. Use <b>Receive Stock</b> above to correct this.</div>` : ''}

    <div class="card"><div class="status-actions">
      ${SPO_STATUSES.filter(s => s !== po.status).map(s => `<button class="btn-line btn-sm status-btn" data-status="${s}">Mark: ${s}</button>`).join('')}
    </div></div>

    <div class="card">
      <div class="detail-grid">
        <div class="detail-item"><div class="detail-label">Supplier</div><div class="detail-value">${supplier ? `<a href="#/suppliers/${supplier.id}">${escapeHtml(supplier.companyName)}</a>` : '—'}</div></div>
        <div class="detail-item"><div class="detail-label">Sales Order</div><div class="detail-value">${salesOrder ? `<a href="#/sales-orders/${salesOrder.id}">${escapeHtml(salesOrder.soNo)}</a>` : '—'}</div></div>
        <div class="detail-item"><div class="detail-label">Customer PO</div><div class="detail-value">${customerPO ? `<a href="#/customer-pos/${customerPO.id}">${escapeHtml(customerPO.customerPoNumber || customerPO.poNo)}</a>` : escapeHtml(po.customerPORef || '—')}</div></div>
        <div class="detail-item"><div class="detail-label">PO Date</div><div class="detail-value">${formatDate(po.poDate)}</div></div>
        <div class="detail-item"><div class="detail-label">Expected Delivery</div><div class="detail-value">${formatDate(po.expectedDeliveryDate) || '—'}</div></div>
        <div class="detail-item"><div class="detail-label">Supplier's Quotation Ref</div><div class="detail-value">${escapeHtml(po.supplierQuoteRef || '—')}</div></div>
        <div class="detail-item"><div class="detail-label">Payment Terms</div><div class="detail-value">${escapeHtml(po.paymentTerms || '—')}</div></div>
        <div class="detail-item"><div class="detail-label">Incoterms</div><div class="detail-value">${escapeHtml(po.incoterms || '—')}</div></div>
        <div class="detail-item"><div class="detail-label">Shipping Terms</div><div class="detail-value">${escapeHtml(po.shippingTerms || '—')}</div></div>
        <div class="detail-item"><div class="detail-label">Delivery Address</div><div class="detail-value">${escapeHtml(po.deliveryAddress || '—')}</div></div>
        <div class="detail-item"><div class="detail-label">Notes</div><div class="detail-value">${escapeHtml(po.notes || '—')}</div></div>
      </div>
    </div>

    <div class="card">
      <h3 class="section-title">Items</h3>
      <table class="data-table compact">
        <thead><tr><th>Description</th><th>Ordered Qty</th><th>Received Qty</th><th>Unit Cost</th><th>Amount</th></tr></thead>
        <tbody>${po.lines.map(l => {
          const receivedCell = (l.receivedQty || 0) >= l.qty
            ? `${l.receivedQty || 0} ${escapeHtml(l.uom)} ✓`
            : `<span class="cell-needs-input">${l.receivedQty || 0} of ${l.qty} ${escapeHtml(l.uom)}</span>`;
          return `<tr><td>${escapeHtml(l.description)}</td><td>${l.qty} ${escapeHtml(l.uom)}</td><td>${receivedCell}</td><td>${formatMoney(l.unitCost, po.currency)}</td><td>${formatMoney(l.amount, po.currency)}</td></tr>`;
        }).join('')}</tbody>
      </table>
      <div class="totals">
        <div class="line"><span>Items Total</span><span>${formatMoney(po.lines.reduce((s, l) => s + l.amount, 0), po.currency)}</span></div>
        <div class="line"><span>Freight</span><span>${formatMoney(po.freight, po.currency)}</span></div>
        <div class="line"><span>Taxes</span><span>${formatMoney(po.taxes, po.currency)}</span></div>
        <div class="line grand"><span>Total Purchase Cost</span><span>${formatMoney(po.totalCost, po.currency)}</span></div>
      </div>
    </div>

    <div id="receiveStockHost"></div>

    <div class="meta-strip">Created ${formatDate(po.createdAt)} by ${escapeHtml(po.createdBy || '—')} · Last modified ${formatDate(po.updatedAt)} by ${escapeHtml(po.modifiedBy || '—')}</div>
  `;

  document.getElementById('btnPrint').onclick = () => Print.printSupplierPO(po, supplier, salesOrder);
  document.getElementById('btnEditHeader').onclick = () => renderSPOHeaderEdit(po);
  document.getElementById('btnReceiveStock').onclick = () => {
    if (po.status === 'Cancelled') { toast('This PO is cancelled — nothing to receive against it.', 'err'); return; }
    renderReceiveStockForm(po, id);
  };
  document.getElementById('btnDelete').onclick = async () => {
    if (!confirm(`Delete supplier PO ${po.poNo}? This cannot be undone.`)) return;
    await DB.dbDelete('supplierPOs', po.id);
    await DB.logActivity(`Deleted supplier PO ${po.poNo}`);
    toast('Deleted.'); Router.navigate('/supplier-pos');
  };
  const SPO_TERMINAL = ['Received', 'Cancelled'];
  content.querySelectorAll('.status-btn').forEach(btn => btn.onclick = async () => {
    const newStatus = btn.dataset.status;
    if (newStatus === 'Received') {
      // "Receive Stock" is the correct path — it logs real quantities and moves actual
      // stock into inventory. Manually flipping the status here bypasses both, so if
      // quantities don't actually match, the person needs to know exactly what they're
      // overriding.
      const unreceived = (po.lines || []).filter(l => (l.receivedQty || 0) < l.qty);
      if (unreceived.length > 0) {
        const detail = unreceived.map(l => `• ${l.description}: ${l.receivedQty || 0} of ${l.qty} ${l.uom} recorded`).join('\n');
        if (!confirm(`${unreceived.length} line(s) don't actually have their received quantity recorded yet:\n\n${detail}\n\nThe correct way to mark this PO Received is the "Receive Stock" button above — it logs the real quantities and updates your inventory correctly. Marking it Received here will NOT do either of those things.\n\nOverride and mark it Received anyway?`)) return;
      }
    }
    if (SPO_TERMINAL.includes(newStatus)) {
      if (!confirm(`Mark ${po.poNo} as ${newStatus}? This is a terminal status for this purchase order.`)) return;
    }
    po.status = newStatus;
    po.statusHistory = (po.statusHistory || []).concat([{ status: newStatus, date: new Date().toISOString() }]);
    po.updatedAt = new Date().toISOString();
    await DB.dbPut('supplierPOs', po);
    await DB.logActivity(`Supplier PO ${po.poNo} marked as ${newStatus}`);
    toast('Status updated.'); renderSPODetail(id);
  });
}

function renderSPOHeaderEdit(po) {
  const content = document.getElementById('content');
  const alreadySentToSupplier = !['Draft'].includes(po.status);
  content.innerHTML = `
    <div class="page-head"><h1>Edit Supplier PO — ${escapeHtml(po.poNo)}</h1></div>
    ${alreadySentToSupplier ? `<div class="card warning-card">⚠ This PO's status is currently <b>${escapeHtml(po.status)}</b> — it may have already been sent to the supplier. Revising quantities, costs, or items here only updates your own records; remember to notify the supplier of any changes separately.</div>` : ''}
    <form class="card form-card" id="spoForm">
      <div class="form-grid">
        <div class="field"><label>Supplier Quotation Reference</label><input id="f_supplierQuoteRef" value="${escapeHtml(po.supplierQuoteRef || '')}"></div>
        <div class="field"><label>Payment Terms</label><input id="f_paymentTerms" value="${escapeHtml(po.paymentTerms || '')}"></div>
        <div class="field"><label>Incoterms</label><input id="f_incoterms" value="${escapeHtml(po.incoterms || '')}"></div>
        <div class="field"><label>Shipping Terms</label><input id="f_shippingTerms" value="${escapeHtml(po.shippingTerms || '')}"></div>
        <div class="field"><label>Expected Delivery Date</label><input type="date" id="f_expectedDeliveryDate" value="${po.expectedDeliveryDate || ''}"></div>
        <div class="field"><label>Freight</label><input type="number" step="0.01" id="f_freight" value="${po.freight || 0}"></div>
        <div class="field"><label>Taxes</label><input type="number" step="0.01" id="f_taxes" value="${po.taxes || 0}"></div>
        <div class="field field-wide"><label>Delivery Address</label><textarea id="f_deliveryAddress">${escapeHtml(po.deliveryAddress || '')}</textarea></div>
        <div class="field field-wide"><label>Notes</label><textarea id="f_notes">${escapeHtml(po.notes || '')}</textarea></div>
      </div>

      <h3 class="section-title" style="margin-top:16px;">Items</h3>
      <p class="muted-text">Revise quantities, costs, or descriptions if the supplier's actual pricing/availability differs from the original — for example after receiving their formal quotation.</p>
      <div style="overflow-x:auto; max-width:100%;">
      <table class="data-table compact">
        <thead><tr><th>Description</th><th style="width:55px;">Qty</th><th style="width:45px;">UOM</th><th style="width:75px;">Unit Cost</th><th>Amount</th><th></th></tr></thead>
        <tbody id="spoLinesBody"></tbody>
      </table>
      </div>
      <button type="button" class="btn-line btn-sm" id="btnAddSpoLine" style="margin-top:8px;">+ Add Line</button>

      <div class="form-actions">
        <button type="submit" class="btn-amber">Save</button>
        <button type="button" class="btn-line" id="btnCancel">Cancel</button>
      </div>
    </form>
  `;
  content.querySelectorAll('input,textarea').forEach(i => i.addEventListener('input', markDirty));

  let editLines = (po.lines || []).map(l => Object.assign({}, l));
  function drawSpoLines() {
    const body = document.getElementById('spoLinesBody');
    body.innerHTML = editLines.map((l, i) => {
      const amount = r2((Number(l.qty) || 0) * (Number(l.unitCost) || 0));
      l.amount = amount;
      return `<tr data-idx="${i}">
        <td class="line-desc-locked" title="Description is locked to keep it consistent across the Quotation/Customer PO/Sales Order/Supplier PO chain — use a Note for any clarification.">${escapeHtml(l.description || '')}</td>
        <td><input class="spo-qty" type="number" min="0" step="any" value="${l.qty || 0}" style="width:55px;"></td>
        <td><input class="spo-uom" value="${escapeHtml(l.uom || 'pc')}" style="width:45px;"></td>
        <td><input class="spo-cost" type="number" min="0" step="0.01" value="${l.unitCost || 0}" style="width:75px;"></td>
        <td class="spo-amount" style="text-align:right; font-family:var(--mono);">${formatMoney(amount, po.currency)}</td>
        <td class="row-del" data-spodel="${i}">✕</td>
      </tr>`;
    }).join('');
    body.querySelectorAll('tr').forEach(tr => {
      const idx = Number(tr.dataset.idx);
      const bind = (sel, field, isNum) => tr.querySelector(sel).addEventListener('input', (e) => {
        editLines[idx][field] = isNum ? (Number(e.target.value) || 0) : e.target.value;
        const amt = r2((Number(editLines[idx].qty) || 0) * (Number(editLines[idx].unitCost) || 0));
        editLines[idx].amount = amt;
        tr.querySelector('.spo-amount').textContent = formatMoney(amt, po.currency);
        markDirty();
      });
      bind('.spo-qty', 'qty', true); bind('.spo-uom', 'uom'); bind('.spo-cost', 'unitCost', true);
    });
    body.querySelectorAll('[data-spodel]').forEach(btn => btn.addEventListener('click', () => {
      if (editLines.length === 1) { toast('A supplier PO needs at least one line item.', 'err'); return; }
      editLines.splice(Number(btn.dataset.spodel), 1);
      drawSpoLines(); markDirty();
    }));
  }
  drawSpoLines();
  document.getElementById('btnAddSpoLine').onclick = () => {
    const description = prompt('Description for this new line item:');
    if (!description || !description.trim()) return;
    editLines.push({ lineId: 'L' + Math.random().toString(36).slice(2, 9), itemId: '', description: description.trim(), brand: '', modelNo: '', qty: 1, uom: 'pc', unitCost: 0, discountPercent: 0, receivedQty: 0, amount: 0 });
    drawSpoLines(); markDirty();
  };

  document.getElementById('btnCancel').onclick = () => { if (!guardNavigation()) return; clearDirty(); renderSPODetail(po.id); };
  document.getElementById('spoForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!editLines.every(l => l.description && Number(l.qty) > 0)) { toast('Every line needs a description and quantity greater than 0.', 'err'); return; }
    const settings = await DB.getSettings();
    Object.assign(po, {
      supplierQuoteRef: document.getElementById('f_supplierQuoteRef').value,
      paymentTerms: document.getElementById('f_paymentTerms').value,
      incoterms: document.getElementById('f_incoterms').value,
      shippingTerms: document.getElementById('f_shippingTerms').value,
      expectedDeliveryDate: document.getElementById('f_expectedDeliveryDate').value,
      freight: Number(document.getElementById('f_freight').value) || 0,
      taxes: Number(document.getElementById('f_taxes').value) || 0,
      deliveryAddress: document.getElementById('f_deliveryAddress').value,
      notes: document.getElementById('f_notes').value,
      lines: editLines, lineIds: editLines.map(l => l.lineId),
      updatedAt: new Date().toISOString(), modifiedBy: settings.userName
    });
    po.totalCost = r2(po.lines.reduce((s, l) => s + l.amount, 0) + po.freight + po.taxes);
    await DB.dbPut('supplierPOs', po);
    await DB.logActivity(`Revised supplier PO ${po.poNo}`);
    toast('Saved.'); clearDirty(); Router.navigate(`/supplier-pos/${po.id}`);
  });
}

/* ---------- RECEIVE STOCK ---------- */

function renderReceiveStockForm(po, id) {
  const host = document.getElementById('receiveStockHost');
  const receivableLines = po.lines.filter(l => (l.receivedQty || 0) < l.qty);
  if (receivableLines.length === 0) {
    host.innerHTML = `<div class="card"><div class="empty-inline">Everything on this PO has already been received. Nothing left to receive.</div></div>`;
    return;
  }
  host.innerHTML = `
    <div class="card">
      <h3 class="section-title">Receive Stock</h3>
      <p class="muted-text">Enter how many units actually arrived for each line. This can be done more than once if the shipment comes in partial batches — only the quantity entered here moves into stock.</p>
      <table class="data-table compact">
        <thead><tr><th>Description</th><th>Ordered</th><th>Received So Far</th><th>Receiving Now</th></tr></thead>
        <tbody>
          ${receivableLines.map((l, i) => {
            const remaining = r2(l.qty - (l.receivedQty || 0));
            return `<tr data-lineid="${l.lineId}">
              <td>${escapeHtml(l.description)}${!l.itemId ? ' <span class="muted-text">(not linked to a catalog product — won\'t affect stock)</span>' : ''}</td>
              <td>${l.qty} ${escapeHtml(l.uom)}</td>
              <td>${l.receivedQty || 0} ${escapeHtml(l.uom)}</td>
              <td><input type="number" min="0" max="${remaining}" step="any" class="recv-qty" value="${remaining}" style="width:90px;"></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      <div class="btn-row" style="margin-top:14px;">
        <button class="btn-amber btn-sm" id="btnConfirmReceive">Confirm Receipt</button>
        <button class="btn-line btn-sm" id="btnCancelReceive">Cancel</button>
      </div>
    </div>
  `;
  host.scrollIntoView && host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  document.getElementById('btnCancelReceive').onclick = () => { host.innerHTML = ''; };
  document.getElementById('btnConfirmReceive').onclick = async () => {
    const rows = [...host.querySelectorAll('tr[data-lineid]')];
    const settings = await DB.getSettings();
    const now = new Date().toISOString();
    let anyReceived = false;

    for (const row of rows) {
      const lineId = row.dataset.lineid;
      const qtyNow = r2(Number(row.querySelector('.recv-qty').value) || 0);
      if (qtyNow <= 0) continue;
      const line = po.lines.find(l => l.lineId === lineId);
      if (!line) continue;
      const remaining = r2(line.qty - (line.receivedQty || 0));
      if (qtyNow > remaining) { toast(`Cannot receive more than the remaining ${remaining} for "${line.description}".`, 'err'); return; }

      line.receivedQty = r2((line.receivedQty || 0) + qtyNow);
      anyReceived = true;

      if (line.itemId) {
        await DB.dbAdd('stockMovements', {
          productId: Number(line.itemId), type: 'Receipt', qty: qtyNow, date: todayISO(),
          reference: `Supplier PO ${po.poNo}`, referenceId: po.id, referenceLineId: lineId,
          note: '', createdBy: settings.userName, createdAt: now
        });
      }
    }

    if (!anyReceived) { toast('Enter a quantity greater than 0 for at least one line.', 'err'); return; }

    // Auto-reflect the receiving progress in the PO's own status, without overriding a
    // manually-chosen status like Cancelled if that were somehow already set.
    const allReceived = po.lines.every(l => (l.receivedQty || 0) >= l.qty);
    if (po.status !== 'Cancelled') {
      po.status = allReceived ? 'Received' : 'Partially Received';
      po.statusHistory = (po.statusHistory || []).concat([{ status: po.status, date: now }]);
    }
    po.updatedAt = now; po.modifiedBy = settings.userName;
    await DB.dbPut('supplierPOs', po);
    await DB.logActivity(`Received stock against supplier PO ${po.poNo}`);
    toast('Stock received.');
    renderSPODetail(id);
  };
}

window.SupplierPOs = { createFromSalesOrder };
