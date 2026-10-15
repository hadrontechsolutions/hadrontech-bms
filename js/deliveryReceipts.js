/* ============================================================
   deliveryReceipts.js — Delivery Receipts (proof of delivery).

   A Delivery Receipt is created from a Sales Order every time a delivery is recorded
   (Sales Order -> Record Delivery), so each partial delivery has its own numbered, printable,
   customer-signable document. It carries NO prices. It is supplementary: the BIR-registered
   official invoice is a separate (physical) document - its number can be written on the receipt.

   Each record snapshots what was delivered (description, quantities, balance) so later edits to
   the Sales Order never rewrite a receipt that was already handed to a customer. Voiding a
   receipt reverses its quantities and stock; nothing is ever silently deleted.
   ============================================================ */

const DR_STATUSES = ['Issued', 'Signed copy received', 'Voided'];
const drR2 = (x) => Math.round((Number(x) || 0) * 100) / 100;

Router.route('/delivery-receipts', () => renderDRList());
Router.route('/delivery-receipts/:id', (p) => renderDRDetail(p.id));

/** Creates the receipt for a delivery that has just been saved on the Sales Order.
 *  deliveredLines: [{ lineId, qty }] (this delivery only). Returns the new receipt id. */
async function createDeliveryReceipt(so, deliveredLines, info) {
  const settings = await DB.getSettings();
  const [customer, customerPO] = await Promise.all([DB.dbGet('customers', so.customerId), so.customerPOId ? DB.dbGet('customerPOs', so.customerPOId) : null]);
  const now = new Date().toISOString();
  const lines = deliveredLines.map(d => {
    const l = (so.lines || []).find(x => x.lineId === d.lineId) || {};
    return { lineId: d.lineId, description: l.description || '', brand: l.brand || '', modelNo: l.modelNo || '', uom: l.uom || '', itemId: l.itemId || '', compNo: l.compNo || '',
      qty: drR2(d.qty), ordered: drR2(l.qty), deliveredToDate: drR2(l.deliveredQty), balance: drR2((l.qty || 0) - (l.deliveredQty || 0)) };
  });
  const rec = {
    drNo: await DB.nextDocNumber('deliveryReceipt'), salesOrderId: so.id, soNo: so.soNo, customerId: so.customerId,
    customerSnapshot: { companyName: customer ? customer.companyName : '', address: customer ? (customer.shippingAddress || customer.billingAddress || '') : '', contactPerson: customer ? customer.contactPerson : '' },
    shippingAddress: so.shippingAddress || (customer ? (customer.shippingAddress || customer.billingAddress || '') : ''),
    customerPoNo: customerPO ? (customerPO.customerPoNumber || customerPO.poNo || '') : '',
    date: info.date || todayISO(), deliveredBy: info.deliveredBy || '', vehicle: info.vehicle || '', remarks: info.remarks || '', invoiceNo: info.invoiceNo || '',
    lines, status: 'Issued', receivedBy: '', receivedDate: '',
    createdAt: now, updatedAt: now, createdBy: settings.userName
  };
  const id = await DB.dbAdd('deliveryReceipts', rec);
  await DB.logActivity(`Issued delivery receipt ${rec.drNo} for sales order ${so.soNo}`);
  return { id, drNo: rec.drNo };
}

/* ------------------------------ LIST ------------------------------ */
async function renderDRList() {
  Router.setBreadcrumb([{ label: 'Delivery Receipts' }]);
  const content = document.getElementById('content');
  const all = (await DB.dbGetAll('deliveryReceipts')).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  content.innerHTML = `
    <div class="page-head"><div><h1>Delivery Receipts</h1><div class="muted-text">One receipt per delivery, created from a Sales Order (open the order and click “Record Delivery”).</div></div>
      <div class="page-actions"><input type="search" id="listSearch" class="search-box" placeholder="Search receipt #, customer, order #, PO #, invoice #…"></div></div>
    <div class="card" style="padding:0;" id="drWrap"></div>`;
  const draw = () => {
    const term = document.getElementById('listSearch').value.trim().toLowerCase();
    const rows = all.filter(r => !term || [r.drNo, r.soNo, r.customerPoNo, r.invoiceNo, (r.customerSnapshot || {}).companyName, r.deliveredBy].join(' ').toLowerCase().includes(term));
    document.getElementById('drWrap').innerHTML = rows.length ? `<table class="data-table"><thead><tr><th>Receipt No.</th><th>Delivery Date</th><th>Customer</th><th>Sales Order</th><th>Customer PO</th><th>Items Delivered</th><th>Status</th></tr></thead><tbody>
      ${rows.map(r => `<tr class="clickable-row" data-id="${r.id}"><td>${escapeHtml(r.drNo)}</td><td>${formatDate(r.date)}</td><td>${escapeHtml((r.customerSnapshot || {}).companyName || '—')}</td><td>${escapeHtml(r.soNo || '—')}</td><td>${escapeHtml(r.customerPoNo || '—')}</td><td>${(r.lines || []).length} line${(r.lines || []).length === 1 ? '' : 's'}</td><td>${statusBadge(r.status)}</td></tr>`).join('')}</tbody></table>`
      : `<div class="empty-inline">${all.length ? 'Nothing matches the search.' : 'No delivery receipts yet. Open a Sales Order and click “Record Delivery” — a receipt is created for every delivery.'}</div>`;
    document.querySelectorAll('#drWrap tr[data-id]').forEach(tr => tr.onclick = () => Router.navigate(`/delivery-receipts/${tr.dataset.id}`));
  };
  document.getElementById('listSearch').addEventListener('input', draw); draw();
}

/* ----------------------------- DETAIL ----------------------------- */
async function renderDRDetail(id) {
  const content = document.getElementById('content');
  const dr = await DB.dbGet('deliveryReceipts', Number(id));
  if (!dr) { Router.setBreadcrumb([{ label: 'Delivery Receipts', hash: '/delivery-receipts' }, { label: 'Not found' }]); content.innerHTML = `<div class="empty-state"><h3>Delivery receipt not found</h3><p><a href="#/delivery-receipts">Back to Delivery Receipts</a></p></div>`; return; }
  const [so, customer] = await Promise.all([DB.dbGet('salesOrders', dr.salesOrderId), DB.dbGet('customers', dr.customerId)]);
  Router.setBreadcrumb([{ label: 'Delivery Receipts', hash: '/delivery-receipts' }, { label: dr.drNo }]);
  const voided = dr.status === 'Voided', signed = dr.status === 'Signed copy received';
  content.innerHTML = `
    <div class="page-head">
      <div><div class="doc-number-tag">${escapeHtml(dr.drNo)}</div><h1>${escapeHtml((dr.customerSnapshot || {}).companyName || '—')} ${statusBadge(dr.status)}</h1></div>
      <div class="page-actions">
        ${voided ? '' : `<button class="btn-amber" id="btnPrintDR">Print Delivery Receipt</button>
        <button class="btn-line" id="btnSigned">${signed ? 'Edit signed-copy details' : 'Mark signed copy received'}</button>
        <button class="btn-line" id="btnEditDR">Edit details</button>
        <button class="btn-danger" id="btnVoidDR">Void</button>`}
      </div>
    </div>
    ${voided ? `<div class="card danger-card"><b>Voided on ${formatDate(dr.voidedAt)}.</b> Reason: ${escapeHtml(dr.voidReason || '—')}. The delivered quantities and stock were put back on the Sales Order.</div>` : ''}
    ${!voided && !signed ? `<div class="card next-step"><div class="ns-label">Next step</div><div class="ns-text">Print this receipt, have the customer sign it on delivery, then click “Mark signed copy received”.</div></div>` : ''}
    <div class="card"><div class="detail-grid">
      <div class="detail-item"><div class="detail-label">Customer</div><div class="detail-value">${customer ? `<a href="#/customers/${customer.id}">${escapeHtml(customer.companyName)}</a>` : escapeHtml((dr.customerSnapshot || {}).companyName || '—')}</div></div>
      <div class="detail-item"><div class="detail-label">Sales Order</div><div class="detail-value">${so ? `<a href="#/sales-orders/${so.id}">${escapeHtml(so.soNo)}</a>` : escapeHtml(dr.soNo || '—')}</div></div>
      <div class="detail-item"><div class="detail-label">Customer PO</div><div class="detail-value">${escapeHtml(dr.customerPoNo || '—')}</div></div>
      <div class="detail-item"><div class="detail-label">Delivery Date</div><div class="detail-value">${formatDate(dr.date)}</div></div>
      <div class="detail-item"><div class="detail-label">Delivered By</div><div class="detail-value">${escapeHtml(dr.deliveredBy || '—')}</div></div>
      <div class="detail-item"><div class="detail-label">Vehicle / Courier / Waybill</div><div class="detail-value">${escapeHtml(dr.vehicle || '—')}</div></div>
      <div class="detail-item"><div class="detail-label">Official Invoice No. (BIR)</div><div class="detail-value">${escapeHtml(dr.invoiceNo || '—')}</div></div>
      <div class="detail-item"><div class="detail-label">Signed Copy</div><div class="detail-value">${signed ? `Received ${formatDate(dr.receivedDate)} — signed by ${escapeHtml(dr.receivedBy || '—')}` : voided ? '—' : 'Not yet received back'}</div></div>
      ${!signed && !voided && (dr.receivedBy || dr.receivedDate) ? `<div class="detail-item"><div class="detail-label">Received By (customer) / Date Received</div><div class="detail-value">${escapeHtml(dr.receivedBy || '—')}${dr.receivedDate ? ' · ' + formatDate(dr.receivedDate) : ''}</div></div>` : ''}
      <div class="detail-item field-wide"><div class="detail-label">Delivered To</div><div class="detail-value" style="white-space:pre-line;">${escapeHtml(dr.shippingAddress || '—')}</div></div>
      ${dr.remarks ? `<div class="detail-item field-wide"><div class="detail-label">Remarks</div><div class="detail-value" style="white-space:pre-line;">${escapeHtml(dr.remarks)}</div></div>` : ''}
    </div></div>
    <div class="card"><h3 class="section-title">Items delivered</h3>
      <table class="data-table compact"><thead><tr><th>#</th><th>Description</th><th>Delivered Now</th><th>Ordered</th><th>Delivered So Far</th><th>Balance</th></tr></thead><tbody>
      ${(dr.lines || []).map((l, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(l.description)}${l.brand || l.modelNo ? `<div class="muted-text" style="font-size:11px;">${escapeHtml([l.brand, l.modelNo].filter(Boolean).join(' · '))}</div>` : ''}</td><td><b>${l.qty} ${escapeHtml(l.uom)}</b></td><td>${l.ordered} ${escapeHtml(l.uom)}</td><td>${l.deliveredToDate} ${escapeHtml(l.uom)}</td><td>${l.balance} ${escapeHtml(l.uom)}</td></tr>`).join('')}
      </tbody></table></div>
    <div id="drHost"></div>
    <div class="meta-strip">Issued ${formatDate(dr.createdAt)} by ${escapeHtml(dr.createdBy || '—')}${dr.updatedAt && dr.updatedAt !== dr.createdAt ? ` · Last modified ${formatDate(dr.updatedAt)}` : ''}</div>`;
  if (voided) return;
  const host = document.getElementById('drHost');
  const save = async (msg) => { dr.updatedAt = new Date().toISOString(); await DB.dbPut('deliveryReceipts', dr); if (msg) await DB.logActivity(msg); renderDRDetail(id); };
  document.getElementById('btnPrintDR').onclick = () => Print.printDeliveryReceipt(dr);
  document.getElementById('btnSigned').onclick = () => {
    host.innerHTML = `<div class="card"><h3 class="section-title">Signed copy</h3><div class="form-grid">
      <div class="field"><label>Signed / received by (customer’s name)</label><input id="dr_receivedBy" value="${escapeHtml(dr.receivedBy || '')}"></div>
      <div class="field"><label>Date received</label><input type="date" id="dr_receivedDate" value="${dr.receivedDate || todayISO()}"></div></div>
      <div class="btn-row" style="margin-top:10px;"><button class="btn-amber btn-sm" id="drSaveSigned">Save</button>
      ${signed ? '<button class="btn-line btn-sm" id="drUnsign">Mark as not received</button>' : ''}<button class="btn-line btn-sm" id="drCancel">Cancel</button></div></div>`;
    document.getElementById('drCancel').onclick = () => { host.innerHTML = ''; };
    document.getElementById('drSaveSigned').onclick = async () => {
      const by = document.getElementById('dr_receivedBy').value.trim();
      if (!by) { toast('Enter the name of the person who signed for the delivery.', 'err'); return; }
      dr.status = 'Signed copy received'; dr.receivedBy = by; dr.receivedDate = document.getElementById('dr_receivedDate').value || todayISO();
      await save(`Delivery receipt ${dr.drNo}: signed copy received (${by})`);
    };
    if (signed) document.getElementById('drUnsign').onclick = async () => { dr.status = 'Issued'; dr.receivedBy = ''; dr.receivedDate = ''; await save(`Delivery receipt ${dr.drNo}: signed copy marked as not received`); };
  };
  document.getElementById('btnEditDR').onclick = () => {
    host.innerHTML = `<div class="card"><h3 class="section-title">Edit details</h3><p class="muted-text">The items and quantities can’t be changed here — void this receipt and record the delivery again if they are wrong.</p><div class="form-grid">
      <div class="field"><label>Delivery date</label><input type="date" id="dr_date" value="${dr.date || ''}"></div>
      <div class="field"><label>Delivered by</label><input id="dr_by" value="${escapeHtml(dr.deliveredBy || '')}"></div>
      <div class="field"><label>Vehicle / courier / waybill</label><input id="dr_vehicle" value="${escapeHtml(dr.vehicle || '')}"></div>
      <div class="field"><label>Official invoice no. (BIR)</label><input id="dr_inv" value="${escapeHtml(dr.invoiceNo || '')}"></div>
      <div class="field"><label>Received by (customer’s name)</label><input id="dr_recBy" value="${escapeHtml(dr.receivedBy || '')}" placeholder="Prints under the customer’s signature line"></div>
      <div class="field"><label>Date received</label><input type="date" id="dr_recDate" value="${dr.receivedDate || ''}"></div>
      <div class="field field-wide"><label>Delivered to (address)</label><textarea id="dr_addr">${escapeHtml(dr.shippingAddress || '')}</textarea></div>
      <div class="field field-wide"><label>Remarks</label><textarea id="dr_remarks">${escapeHtml(dr.remarks || '')}</textarea></div></div>
      <div class="btn-row" style="margin-top:10px;"><button class="btn-amber btn-sm" id="drSaveEdit">Save</button><button class="btn-line btn-sm" id="drCancel">Cancel</button></div></div>`;
    document.getElementById('drCancel').onclick = () => { host.innerHTML = ''; };
    document.getElementById('drSaveEdit').onclick = async () => {
      dr.date = document.getElementById('dr_date').value || dr.date; dr.deliveredBy = document.getElementById('dr_by').value.trim(); dr.vehicle = document.getElementById('dr_vehicle').value.trim();
      dr.receivedBy = document.getElementById('dr_recBy').value.trim(); dr.receivedDate = document.getElementById('dr_recDate').value; dr.invoiceNo = document.getElementById('dr_inv').value.trim(); dr.shippingAddress = document.getElementById('dr_addr').value; dr.remarks = document.getElementById('dr_remarks').value;
      await save(`Updated delivery receipt ${dr.drNo}`);
    };
  };
  document.getElementById('btnVoidDR').onclick = () => {
    host.innerHTML = `<div class="card"><h3 class="section-title">Void ${escapeHtml(dr.drNo)}</h3>
      <p class="muted-text">Use this if the receipt was made by mistake or the goods were not actually delivered. The quantities go back to “not delivered” on the Sales Order and stock is returned. The receipt stays in the list as Voided.</p>
      <div class="field"><label>Reason (required)</label><input id="dr_reason"></div>
      <div class="btn-row" style="margin-top:10px;"><button class="btn-danger btn-sm" id="drConfirmVoid">Void this receipt</button><button class="btn-line btn-sm" id="drCancel">Cancel</button></div></div>`;
    document.getElementById('drCancel').onclick = () => { host.innerHTML = ''; };
    document.getElementById('drConfirmVoid').onclick = async () => {
      const reason = document.getElementById('dr_reason').value.trim(); if (!reason) { toast('Give a reason for voiding this receipt.', 'err'); return; }
      await voidDeliveryReceipt(dr, reason); toast('Delivery receipt voided.'); renderDRDetail(id);
    };
  };
}

/** Puts a receipt's quantities (and stock) back and marks it Voided. */
async function voidDeliveryReceipt(dr, reason) {
  const settings = await DB.getSettings(); const now = new Date().toISOString();
  const so = await DB.dbGet('salesOrders', dr.salesOrderId);
  if (so) {
    for (const l of dr.lines || []) {
      const line = (so.lines || []).find(x => x.lineId === l.lineId); if (!line) continue;
      line.deliveredQty = Math.max(0, drR2((line.deliveredQty || 0) - l.qty));
      if (l.itemId && !l.compNo) await DB.dbAdd('stockMovements', { productId: Number(l.itemId), type: 'Delivery', qty: l.qty, date: todayISO(), reference: `Voided delivery receipt ${dr.drNo} (${so.soNo})`, referenceId: so.id, referenceLineId: l.lineId, note: reason, createdBy: settings.userName, createdAt: now });
    }
    if (so.status !== 'Cancelled') {
      const any = (so.lines || []).some(l => (l.deliveredQty || 0) > 0), all = (so.lines || []).every(l => (l.deliveredQty || 0) >= l.qty);
      so.status = all ? 'Delivered' : any ? 'Partially Delivered' : 'Confirmed';
      so.statusHistory = (so.statusHistory || []).concat([{ status: so.status, date: now }]);
    }
    so.updatedAt = now; so.modifiedBy = settings.userName; await DB.dbPut('salesOrders', so);
    if (so.status === 'Confirmed' && window.SalesOrders) await window.SalesOrders.syncStatus(so.id);   // moves it forward again if supplier goods are already in
  }
  dr.status = 'Voided'; dr.voidedAt = now; dr.voidReason = reason; dr.updatedAt = now;
  await DB.dbPut('deliveryReceipts', dr);
  await DB.logActivity(`Voided delivery receipt ${dr.drNo}: ${reason}`);
}

window.DeliveryReceipts = { createDeliveryReceipt, voidDeliveryReceipt };
