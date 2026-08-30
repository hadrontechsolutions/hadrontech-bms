/* ============================================================
   enquiries.js — Enquiry tracking: the "front door" record that a
   client's inquiry starts as. It links to (and reads status from)
   the Quotation/Customer PO/Sales Order/Supplier PO chain that
   already exists, plus tracks delivery milestones and a payment
   ledger explicitly, since those aren't single-field statuses.

   *** STATUS: NOT CURRENTLY LOADED / DORMANT ***
   This file is intentionally NOT included in index.html's script
   list — the Enquiries tab was removed from the UI by request, but
   the underlying 'enquiries' IndexedDB store and this file were
   deliberately left in place (not deleted) so the feature can be
   restored later without losing any historical data. If re-enabling
   this: add <script src="js/enquiries.js"></script> to index.html
   in the same relative position it originally had (after
   entities.js, before quotations.js), and re-add "Enquiries" to the
   sidebar navigation. Until then, nothing in this file executes.
   ============================================================ */

const ENQ_STAGES = ['New Enquiry', 'Quotation Sent', 'Won - Processing', 'In Delivery', 'Delivered', 'Payment Complete', 'Lost / Cancelled'];
const ENQ_STAGE_COLORS = {
  'New Enquiry': 'stage-new', 'Quotation Sent': 'stage-quoted', 'Won - Processing': 'stage-won',
  'In Delivery': 'stage-delivery', 'Delivered': 'stage-delivered', 'Payment Complete': 'stage-complete',
  'Lost / Cancelled': 'stage-lost'
};
const DELIVERY_STATUSES = ['Not Started', 'Sourcing from Supplier', 'Shipped from Factory', 'In Transit', 'Arrived Local Warehouse', 'Out for Delivery', 'Delivered to Client'];
const PRIORITIES = ['Low', 'Normal', 'High'];

function emptyPayment() { return { totalAmount: 0, currency: 'PHP', dueDate: '', terms: '', payments: [] }; }
function emptyDelivery() { return { status: 'Not Started', milestones: [], eta: '', actualDeliveryDate: '', carrier: '', trackingRef: '' }; }

function paymentSummary(enq) {
  const p = enq.payment || emptyPayment();
  const totalPaid = r2((p.payments || []).reduce((s, x) => s + (Number(x.amount) || 0), 0));
  const balance = r2((Number(p.totalAmount) || 0) - totalPaid);
  let status = 'Unpaid';
  if (balance <= 0 && (Number(p.totalAmount) || 0) > 0) status = 'Fully Paid';
  else if (totalPaid > 0) status = 'Partially Paid';
  const overdue = balance > 0.009 && p.dueDate && p.dueDate < todayISO();
  return { totalPaid, balance, status, overdue };
}

/** Suggests a stage from the linked quotation/sales order/supplier PO statuses. Never overrides a manual "Lost / Cancelled". */
function suggestStage(enq, quotation, salesOrder, supplierPOs) {
  if (enq.stage === 'Lost / Cancelled') return enq.stage;
  if (salesOrder) {
    if (salesOrder.status === 'Completed') return 'Payment Complete' === enq.stage ? enq.stage : 'Delivered';
    if (salesOrder.status === 'Delivered') return 'Delivered';
    if (['Sourcing', 'Ordered from Supplier', 'Partially Received', 'Ready for Delivery'].includes(salesOrder.status)) return 'In Delivery';
    return 'Won - Processing';
  }
  if (quotation) {
    if (quotation.status === 'Lost') return 'Lost / Cancelled';
    if (quotation.status === 'Won') return 'Won - Processing';
    if (['Sent', 'Under Review'].includes(quotation.status)) return 'Quotation Sent';
  }
  return 'New Enquiry';
}

/* ---------- LIST (board + table toggle) ---------- */

let _enqView = 'board';

Router.route('/enquiries', () => renderEnquiries());
Router.route('/enquiries/board', () => renderEnquiries('board'));
Router.route('/enquiries/table', () => renderEnquiries('table'));

async function renderEnquiries(forceView) {
  if (forceView) _enqView = forceView;
  Router.setBreadcrumb([{ label: 'Enquiries' }]);
  const [enquiries, customers, quotations, salesOrders] = await Promise.all([
    DB.dbGetAll('enquiries'), DB.dbGetAll('customers'), DB.dbGetAll('quotations'), DB.dbGetAll('salesOrders')
  ]);
  const custMap = Object.fromEntries(customers.map(c => [c.id, c]));
  const quoteMap = Object.fromEntries(quotations.map(q => [q.id, q]));
  const soMap = Object.fromEntries(salesOrders.map(s => [s.id, s]));

  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="page-head">
      <h1>Enquiries</h1>
      <div class="page-actions">
        <div class="view-toggle">
          <button class="vt-btn ${_enqView === 'board' ? 'active' : ''}" id="vtBoard">▦ Board</button>
          <button class="vt-btn ${_enqView === 'table' ? 'active' : ''}" id="vtTable">☰ Table</button>
        </div>
        <button class="btn-amber" id="btnNewEnq">+ New Enquiry</button>
      </div>
    </div>
    <div id="enqViewHost"></div>
  `;
  document.getElementById('btnNewEnq').onclick = () => Router.navigate('/enquiries/new');
  document.getElementById('vtBoard').onclick = () => { _enqView = 'board'; renderEnquiries(); };
  document.getElementById('vtTable').onclick = () => { _enqView = 'table'; renderEnquiries(); };

  const host = document.getElementById('enqViewHost');
  if (enquiries.length === 0) {
    host.innerHTML = `<div class="card"><div class="empty-inline">No enquiries yet. Click "New Enquiry" to log the first client inquiry.</div></div>`;
    return;
  }

  if (_enqView === 'board') drawBoard(host, enquiries, custMap, quoteMap, soMap);
  else drawTable(host, enquiries, custMap, quoteMap, soMap);
}

function daysSince(iso) {
  if (!iso) return '';
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return d <= 0 ? 'today' : `${d}d`;
}

function enqCardHTML(e, cust, quote, so) {
  const pay = paymentSummary(e);
  const delivery = e.delivery || emptyDelivery();
  return `
    <div class="enq-card priority-${(e.priority || 'Normal').toLowerCase()}" draggable="true" data-id="${e.id}">
      <div class="enq-card-top">
        <span class="enq-no">${escapeHtml(e.enquiryNo)}</span>
        ${pay.overdue ? '<span class="overdue-flag">⚠ Overdue</span>' : ''}
      </div>
      <div class="enq-card-cust">${escapeHtml(cust?.companyName || e.customerSnapshot?.companyName || '—')}</div>
      <div class="enq-card-subj">${escapeHtml(e.subject || '')}</div>
      <div class="enq-card-badges">
        ${quote ? `<span class="mini-badge">Q: ${escapeHtml(quote.status)}</span>` : ''}
        ${so ? `<span class="mini-badge">Del: ${escapeHtml(delivery.status)}</span>` : ''}
        <span class="mini-badge ${pay.status === 'Fully Paid' ? 'mini-ok' : (pay.overdue ? 'mini-danger' : '')}">Pay: ${pay.status}</span>
      </div>
      <div class="enq-card-foot"><span>${escapeHtml(e.salesperson || '')}</span><span>${daysSince(e.updatedAt)} ago</span></div>
    </div>`;
}

function drawBoard(host, enquiries, custMap, quoteMap, soMap) {
  host.innerHTML = `<div class="kanban-board">
    ${ENQ_STAGES.map(stage => {
      const rows = enquiries.filter(e => e.stage === stage);
      return `
      <div class="kanban-col ${ENQ_STAGE_COLORS[stage]}" data-stage="${escapeHtml(stage)}">
        <div class="kanban-col-head">${escapeHtml(stage)} <span class="count-pill">${rows.length}</span></div>
        <div class="kanban-col-body" data-dropzone="${escapeHtml(stage)}">
          ${rows.map(e => enqCardHTML(e, custMap[e.customerId], quoteMap[e.quotationId], soMap[e.salesOrderId])).join('')}
        </div>
      </div>`;
    }).join('')}
  </div>`;

  host.querySelectorAll('.enq-card').forEach(card => {
    card.addEventListener('click', (e) => { if (!card.classList.contains('dragging')) Router.navigate(`/enquiries/${card.dataset.id}`); });
    card.addEventListener('dragstart', () => { card.classList.add('dragging'); });
    card.addEventListener('dragend', () => { card.classList.remove('dragging'); });
  });
  host.querySelectorAll('.kanban-col-body').forEach(zone => {
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drop-hover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drop-hover'));
    zone.addEventListener('drop', async (e) => {
      e.preventDefault(); zone.classList.remove('drop-hover');
      const dragging = host.querySelector('.enq-card.dragging');
      if (!dragging) return;
      const id = Number(dragging.dataset.id);
      const newStage = zone.dataset.dropzone;
      const enq = await DB.dbGet('enquiries', id);
      if (!enq || enq.stage === newStage) return;
      enq.stage = newStage;
      enq.stageHistory = (enq.stageHistory || []).concat([{ stage: newStage, date: new Date().toISOString() }]);
      enq.updatedAt = new Date().toISOString();
      await DB.dbPut('enquiries', enq);
      await DB.logActivity(`Enquiry ${enq.enquiryNo} moved to "${newStage}"`);
      renderEnquiries();
    });
  });
}

function drawTable(host, enquiries, custMap, quoteMap, soMap) {
  host.innerHTML = `<div class="card">
    <table class="data-table">
      <thead><tr><th>Enquiry #</th><th>Customer</th><th>Subject</th><th>Stage</th><th>Quotation</th><th>Delivery</th><th>Payment</th><th>Balance</th></tr></thead>
      <tbody>
        ${enquiries.map(e => {
          const pay = paymentSummary(e);
          const quote = quoteMap[e.quotationId], so = soMap[e.salesOrderId];
          const delivery = e.delivery || emptyDelivery();
          return `<tr class="clickable-row" data-hash="/enquiries/${e.id}">
            <td>${escapeHtml(e.enquiryNo)}</td>
            <td>${escapeHtml(custMap[e.customerId]?.companyName || '—')}</td>
            <td>${escapeHtml(e.subject || '')}</td>
            <td><span class="badge ${ENQ_STAGE_COLORS[e.stage]}">${escapeHtml(e.stage)}</span></td>
            <td>${quote ? statusBadge(quote.status) : '—'}</td>
            <td>${so ? escapeHtml(delivery.status) : '—'}</td>
            <td>${pay.overdue ? '<span class="overdue-flag">⚠ </span>' : ''}${escapeHtml(pay.status)}</td>
            <td>${formatMoney(pay.balance, e.payment?.currency)}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>`;
}

/* ---------- FORM (new / edit) ---------- */

Router.route('/enquiries/new', () => renderEnquiryForm(null));
Router.route('/enquiries/:id/edit', (p) => renderEnquiryForm(p.id));

async function renderEnquiryForm(id) {
  const isEdit = !!id;
  const record = isEdit ? await DB.dbGet('enquiries', Number(id)) : null;
  const [customers, settings] = await Promise.all([DB.dbGetAll('customers'), DB.getSettings()]);

  const e = record || {
    dateReceived: todayISO(), salesperson: settings.userName, priority: 'Normal', source: 'Email',
    stage: 'New Enquiry', stageHistory: [{ stage: 'New Enquiry', date: new Date().toISOString() }],
    payment: emptyPayment(), delivery: emptyDelivery(), notes: ''
  };

  Router.setBreadcrumb([{ label: 'Enquiries', hash: '/enquiries' }, { label: isEdit ? e.enquiryNo : 'New Enquiry' }]);
  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="page-head"><h1>${isEdit ? 'Edit' : 'New'} Enquiry</h1></div>
    <form class="card form-card" id="enqForm">
      <div class="form-grid">
        <div class="field"><label>Customer *</label>
          <select id="f_customerId" required><option value="">— Select customer —</option>
            ${customers.filter(c => !c.archived).map(c => `<option value="${c.id}" ${c.id === e.customerId ? 'selected' : ''}>${escapeHtml(c.companyName)}</option>`).join('')}
          </select>
        </div>
        <div class="field field-wide"><label>Subject / What are they asking about? *</label><input id="f_subject" required value="${escapeHtml(e.subject || '')}" placeholder="e.g. Booster pumps for 3-storey building"></div>
        <div class="field"><label>Source</label><select id="f_source">${['Email', 'Phone', 'Walk-in', 'Referral', 'Website', 'Other'].map(s => `<option ${s === e.source ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <div class="field"><label>Date Received</label><input type="date" id="f_dateReceived" value="${e.dateReceived}"></div>
        <div class="field"><label>Salesperson</label><input id="f_salesperson" value="${escapeHtml(e.salesperson || '')}"></div>
        <div class="field"><label>Priority</label><select id="f_priority">${PRIORITIES.map(p => `<option ${p === e.priority ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
        <div class="field field-wide"><label>Notes</label><textarea id="f_notes">${escapeHtml(e.notes || '')}</textarea></div>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn-amber">Save Enquiry</button>
        <button type="button" class="btn-line" id="btnCancel">Cancel</button>
      </div>
    </form>
  `;
  content.querySelectorAll('input,textarea,select').forEach(i => i.addEventListener('input', markDirty));

  // If this customer has a designated account salesperson on file, offer that instead
  // of just whoever is currently logged in — still fully editable either way.
  document.getElementById('f_customerId').addEventListener('change', (ev) => {
    const selectedCustomer = customers.find(c => c.id === Number(ev.target.value));
    if (selectedCustomer && selectedCustomer.salesperson) {
      document.getElementById('f_salesperson').value = selectedCustomer.salesperson;
      markDirty();
    }
  });
  document.getElementById('btnCancel').onclick = () => { if (!guardNavigation()) return; clearDirty(); Router.navigate(isEdit ? `/enquiries/${id}` : '/enquiries'); };

  document.getElementById('enqForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const submitBtn = ev.target.querySelector('button[type="submit"]');
    if (submitBtn.disabled) return;
    submitBtn.disabled = true;
    try {
    const customerId = Number(document.getElementById('f_customerId').value);
    if (!customerId) { toast('Please select a customer.', 'err'); return; }
    const customer = customers.find(c => c.id === customerId);
    const now = new Date().toISOString();
    const settings2 = await DB.getSettings();
    const obj = record ? Object.assign({}, record) : Object.assign({}, e);
    Object.assign(obj, {
      customerId, customerSnapshot: { companyName: customer.companyName },
      subject: document.getElementById('f_subject').value,
      source: document.getElementById('f_source').value,
      dateReceived: document.getElementById('f_dateReceived').value,
      salesperson: document.getElementById('f_salesperson').value,
      priority: document.getElementById('f_priority').value,
      notes: document.getElementById('f_notes').value,
      updatedAt: now, modifiedBy: settings2.userName
    });
    if (isEdit) {
      await DB.dbPut('enquiries', obj);
      await DB.logActivity(`Updated enquiry ${obj.enquiryNo}`);
      toast('Enquiry saved.'); clearDirty(); Router.navigate(`/enquiries/${obj.id}`);
    } else {
      obj.enquiryNo = await DB.nextDocNumber('enquiry');
      obj.createdAt = now; obj.createdBy = settings2.userName;
      const newId = await DB.dbAdd('enquiries', obj);
      await DB.logActivity(`Logged new enquiry ${obj.enquiryNo} from ${customer.companyName}`);
      toast('Enquiry logged.'); clearDirty(); Router.navigate(`/enquiries/${newId}`);
    }
    } finally {
      submitBtn.disabled = false;
    }
  });
}

/* ---------- DETAIL ---------- */

Router.route('/enquiries/:id', (p) => renderEnquiryDetail(p.id));

async function renderEnquiryDetail(id) {
  const enq = await DB.dbGet('enquiries', Number(id));
  const content = document.getElementById('content');
  if (!enq) { content.innerHTML = `<div class="empty-state"><h3>Enquiry not found</h3></div>`; return; }

  const [customer, allQuotations, customerPO, salesOrder, supplierPOs, settings] = await Promise.all([
    DB.dbGet('customers', enq.customerId),
    DB.dbQueryIndex('quotations', 'customerId', enq.customerId),
    enq.customerPOId ? DB.dbGet('customerPOs', enq.customerPOId) : null,
    enq.salesOrderId ? DB.dbGet('salesOrders', enq.salesOrderId) : null,
    enq.salesOrderId ? DB.dbQueryIndex('supplierPOs', 'salesOrderId', enq.salesOrderId) : [],
    DB.getSettings()
  ]);
  const quotation = enq.quotationId ? await DB.dbGet('quotations', enq.quotationId) : null;
  const pay = paymentSummary(enq);
  const delivery = enq.delivery || emptyDelivery();

  Router.setBreadcrumb([{ label: 'Enquiries', hash: '/enquiries' }, { label: enq.enquiryNo }]);

  content.innerHTML = `
    <div class="page-head">
      <div><div class="doc-number-tag">${escapeHtml(enq.enquiryNo)}</div>
      <h1>${escapeHtml(customer?.companyName || '—')} <span class="badge ${ENQ_STAGE_COLORS[enq.stage]}">${escapeHtml(enq.stage)}</span></h1></div>
      <div class="page-actions">
        <button class="btn-line" id="btnEdit">Edit</button>
        <button class="btn-danger" id="btnDelete">Delete</button>
      </div>
    </div>

    <div class="card">
      <h3 class="section-title">Stage</h3>
      <div class="status-actions">
        ${ENQ_STAGES.filter(s => s !== enq.stage).map(s => `<button class="btn-line btn-sm stage-btn" data-stage="${escapeHtml(s)}">Move to: ${s}</button>`).join('')}
      </div>
    </div>

    <div class="progress-tracks">
      <div class="track-card">
        <div class="track-title">Quotation Status</div>
        ${quotation ? `
          <div class="track-value">${statusBadge(quotation.status)}</div>
          <div class="muted-text"><a href="#/quotations/${quotation.id}">${escapeHtml(quotation.quotationNo)}</a> · ${formatMoney(quotation.grandTotal, quotation.currency)}</div>
        ` : `<div class="empty-inline">No quotation linked yet.</div>
          <button class="btn-line btn-sm" id="btnLinkQuote">Link Existing Quotation</button>
          <button class="btn-amber btn-sm" id="btnNewQuote">Create Quotation</button>`}
      </div>

      <div class="track-card">
        <div class="track-title">Delivery Status</div>
        <div class="track-value">${escapeHtml(delivery.status)}</div>
        <div class="mini-stepper">
          ${DELIVERY_STATUSES.map((s, i) => `<span class="mini-step ${DELIVERY_STATUSES.indexOf(delivery.status) >= i ? 'done' : ''}"></span>`).join('')}
        </div>
        <select id="deliveryStatusSelect" class="mt-6">${DELIVERY_STATUSES.map(s => `<option ${s === delivery.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
        ${delivery.eta ? `<div class="muted-text">ETA: ${formatDate(delivery.eta)}</div>` : ''}
        <div class="milestone-list">
          ${(delivery.milestones || []).slice().reverse().map(m => `<div class="milestone-row"><b>${escapeHtml(m.status)}</b> — ${formatDate(m.date)}${m.notes ? ' — ' + escapeHtml(m.notes) : ''}</div>`).join('')}
        </div>
      </div>

      <div class="track-card">
        <div class="track-title">Payment Status</div>
        <div class="track-value ${pay.overdue ? 'text-danger' : ''}">${pay.overdue ? '⚠ ' : ''}${escapeHtml(pay.status)}</div>
        <div class="pay-figures">
          <div><span>Total</span><b>${formatMoney(enq.payment?.totalAmount, enq.payment?.currency)}</b></div>
          <div><span>Received</span><b>${formatMoney(pay.totalPaid, enq.payment?.currency)}</b></div>
          <div><span>Balance</span><b>${formatMoney(pay.balance, enq.payment?.currency)}</b></div>
        </div>
        ${enq.payment?.dueDate ? `<div class="muted-text ${pay.overdue ? 'text-danger' : ''}">Due: ${formatDate(enq.payment.dueDate)}</div>` : ''}
      </div>
    </div>

    <div class="card">
      <h3 class="section-title">Payment Ledger</h3>
      <div class="form-grid">
        <div class="field"><label>Total Amount</label><input type="number" step="0.01" id="p_totalAmount" value="${enq.payment?.totalAmount || 0}"></div>
        <div class="field"><label>Currency</label><select id="p_currency">${currencyList(settings).map(c => `<option ${c === (enq.payment?.currency || 'PHP') ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
        <div class="field"><label>Balance Due Date</label><input type="date" id="p_dueDate" value="${enq.payment?.dueDate || ''}"></div>
        <div class="field"><label>Payment Terms</label><input id="p_terms" value="${escapeHtml(enq.payment?.terms || '')}"></div>
      </div>
      <button class="btn-line btn-sm" id="btnSavePayInfo">Save Payment Info</button>

      <table class="data-table compact" style="margin-top:16px;">
        <thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Reference</th><th>Notes</th><th></th></tr></thead>
        <tbody id="paymentsBody">
          ${(enq.payment?.payments || []).map(p => `<tr><td>${formatDate(p.date)}</td><td>${formatMoney(p.amount, enq.payment?.currency)}</td><td>${escapeHtml(p.method || '')}</td><td>${escapeHtml(p.reference || '')}</td><td>${escapeHtml(p.notes || '')}</td><td class="row-del" data-delpay="${p.id}">✕</td></tr>`).join('')}
        </tbody>
      </table>
      <div class="add-payment-row">
        <input type="date" id="np_date" value="${todayISO()}">
        <input type="number" step="0.01" id="np_amount" placeholder="Amount">
        <select id="np_method"><option>Bank Transfer</option><option>Cash</option><option>Check</option><option>Online Payment</option><option>Other</option></select>
        <input id="np_reference" placeholder="Reference #">
        <input id="np_notes" placeholder="Notes">
        <button class="btn-amber btn-sm" id="btnAddPayment">+ Add Payment</button>
      </div>
    </div>

    <div class="card">
      <h3 class="section-title">Delivery Milestone</h3>
      <div class="add-payment-row">
        <select id="nm_status">${DELIVERY_STATUSES.map(s => `<option ${s === delivery.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <input type="date" id="nm_date" value="${todayISO()}">
        <input id="nm_notes" placeholder="Notes (carrier, tracking #, etc.)">
        <button class="btn-amber btn-sm" id="btnAddMilestone">+ Log Milestone</button>
      </div>
    </div>

    <div class="card related-card">
      <h3>Linked Records</h3>
      <table class="data-table compact"><tbody>
        <tr><td>Quotation</td><td>${quotation ? `<a href="#/quotations/${quotation.id}">${escapeHtml(quotation.quotationNo)}</a>` : '—'}</td></tr>
        <tr><td>Customer PO</td><td>${customerPO ? `<a href="#/customer-pos/${customerPO.id}">${escapeHtml(customerPO.poNo)}</a>` : '—'}</td></tr>
        <tr><td>Sales Order</td><td>${salesOrder ? `<a href="#/sales-orders/${salesOrder.id}">${escapeHtml(salesOrder.soNo)}</a>` : '—'}</td></tr>
        ${supplierPOs.map(spo => `<tr><td>Supplier PO</td><td><a href="#/supplier-pos/${spo.id}">${escapeHtml(spo.poNo)}</a></td></tr>`).join('')}
      </tbody></table>
    </div>

    <div class="meta-strip">Created ${formatDate(enq.createdAt)} by ${escapeHtml(enq.createdBy || '—')} · Last modified ${formatDate(enq.updatedAt)} by ${escapeHtml(enq.modifiedBy || '—')}</div>
  `;

  document.getElementById('btnEdit').onclick = () => Router.navigate(`/enquiries/${id}/edit`);
  document.getElementById('btnDelete').onclick = async () => {
    if (!confirm(`Delete enquiry ${enq.enquiryNo}? This does not delete any linked quotation/order records.`)) return;
    await DB.dbDelete('enquiries', enq.id);
    await DB.logActivity(`Deleted enquiry ${enq.enquiryNo}`);
    toast('Deleted.'); Router.navigate('/enquiries');
  };

  content.querySelectorAll('.stage-btn').forEach(btn => btn.onclick = async () => {
    enq.stage = btn.dataset.stage;
    enq.stageHistory = (enq.stageHistory || []).concat([{ stage: enq.stage, date: new Date().toISOString() }]);
    enq.updatedAt = new Date().toISOString();
    await DB.dbPut('enquiries', enq);
    await DB.logActivity(`Enquiry ${enq.enquiryNo} moved to "${enq.stage}"`);
    toast('Stage updated.'); renderEnquiryDetail(id);
  });

  const linkBtn = document.getElementById('btnLinkQuote');
  if (linkBtn) linkBtn.onclick = () => renderLinkQuotePicker(enq, allQuotations);
  const newQuoteBtn = document.getElementById('btnNewQuote');
  if (newQuoteBtn) newQuoteBtn.onclick = () => { sessionStorage.setItem('enqPendingLink', String(enq.id)); Router.navigate('/quotations/new'); };

  document.getElementById('deliveryStatusSelect').addEventListener('change', async (e2) => {
    enq.delivery = enq.delivery || emptyDelivery();
    enq.delivery.status = e2.target.value;
    enq.updatedAt = new Date().toISOString();
    await DB.dbPut('enquiries', enq);
    toast('Delivery status updated.'); renderEnquiryDetail(id);
  });

  document.getElementById('btnSavePayInfo').onclick = async () => {
    enq.payment = enq.payment || emptyPayment();
    enq.payment.totalAmount = Number(document.getElementById('p_totalAmount').value) || 0;
    enq.payment.currency = document.getElementById('p_currency').value;
    enq.payment.dueDate = document.getElementById('p_dueDate').value;
    enq.payment.terms = document.getElementById('p_terms').value;
    enq.updatedAt = new Date().toISOString();
    await DB.dbPut('enquiries', enq);
    toast('Payment info saved.'); renderEnquiryDetail(id);
  };

  document.getElementById('btnAddPayment').onclick = async () => {
    const amount = Number(document.getElementById('np_amount').value) || 0;
    if (amount <= 0) { toast('Enter a payment amount.', 'err'); return; }
    enq.payment = enq.payment || emptyPayment();
    enq.payment.payments = enq.payment.payments || [];
    enq.payment.payments.push({
      id: 'P' + Math.random().toString(36).slice(2, 9),
      date: document.getElementById('np_date').value || todayISO(),
      amount, method: document.getElementById('np_method').value,
      reference: document.getElementById('np_reference').value, notes: document.getElementById('np_notes').value
    });
    enq.updatedAt = new Date().toISOString();
    await DB.dbPut('enquiries', enq);
    await DB.logActivity(`Payment of ${formatMoney(amount, enq.payment.currency)} recorded for enquiry ${enq.enquiryNo}`);
    toast('Payment recorded.'); renderEnquiryDetail(id);
  };
  content.querySelectorAll('[data-delpay]').forEach(el => el.onclick = async () => {
    enq.payment.payments = enq.payment.payments.filter(p => p.id !== el.dataset.delpay);
    await DB.dbPut('enquiries', enq);
    renderEnquiryDetail(id);
  });

  document.getElementById('btnAddMilestone').onclick = async () => {
    enq.delivery = enq.delivery || emptyDelivery();
    enq.delivery.milestones = enq.delivery.milestones || [];
    const status = document.getElementById('nm_status').value;
    enq.delivery.milestones.push({ status, date: document.getElementById('nm_date').value || todayISO(), notes: document.getElementById('nm_notes').value });
    enq.delivery.status = status;
    enq.updatedAt = new Date().toISOString();
    await DB.dbPut('enquiries', enq);
    await DB.logActivity(`Delivery milestone "${status}" logged for enquiry ${enq.enquiryNo}`);
    toast('Milestone logged.'); renderEnquiryDetail(id);
  };
}

function renderLinkQuotePicker(enq, quotations) {
  const latest = quotations.filter(q => q.isLatest);
  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="page-head"><h1>Link Quotation to ${escapeHtml(enq.enquiryNo)}</h1></div>
    <div class="card">
      ${latest.length === 0 ? `<div class="empty-inline">This customer has no quotations yet.</div>` : `
      <table class="data-table"><thead><tr><th>Quotation #</th><th>Date</th><th>Status</th><th>Total</th><th></th></tr></thead>
      <tbody>
        ${latest.map(q => `<tr><td>${escapeHtml(q.quotationNo)}</td><td>${formatDate(q.date)}</td><td>${statusBadge(q.status)}</td><td>${formatMoney(q.grandTotal, q.currency)}</td>
          <td><button class="btn-line btn-sm" data-pick="${q.id}">Link</button></td></tr>`).join('')}
      </tbody></table>`}
      <button class="btn-line" id="btnBackToEnq" style="margin-top:12px;">Cancel</button>
    </div>
  `;
  document.getElementById('btnBackToEnq').onclick = () => Router.navigate(`/enquiries/${enq.id}`);
  content.querySelectorAll('[data-pick]').forEach(btn => btn.onclick = async () => {
    enq.quotationId = Number(btn.dataset.pick);
    enq.updatedAt = new Date().toISOString();
    await DB.dbPut('enquiries', enq);
    toast('Quotation linked.'); Router.navigate(`/enquiries/${enq.id}`);
  });
}

/** Called by quotations.js after saving, if an enquiry was waiting to be linked (see btnNewQuote above). */
async function consumePendingEnquiryLink(newQuotationId) {
  const pendingId = sessionStorage.getItem('enqPendingLink');
  if (!pendingId) return;
  sessionStorage.removeItem('enqPendingLink');
  const enq = await DB.dbGet('enquiries', Number(pendingId));
  if (!enq) return;
  enq.quotationId = newQuotationId;
  enq.stage = enq.stage === 'New Enquiry' ? 'Quotation Sent' : enq.stage;
  enq.updatedAt = new Date().toISOString();
  await DB.dbPut('enquiries', enq);
}
window.consumePendingEnquiryLink = consumePendingEnquiryLink;

/** Keeps an Enquiry's linked-record chain and stage in sync as downstream records get created elsewhere in the app. */
async function syncEnquiryFromQuotationLink(quotationId, customerPOId) {
  if (!quotationId) return;
  const enq = (await DB.dbGetAll('enquiries')).find(e => e.quotationId === quotationId);
  if (!enq) return;
  enq.customerPOId = customerPOId;
  if (enq.stage !== 'Lost / Cancelled') enq.stage = 'Won - Processing';
  enq.updatedAt = new Date().toISOString();
  await DB.dbPut('enquiries', enq);
}

async function syncEnquiryFromCustomerPOLink(customerPOId, salesOrderId) {
  const enq = (await DB.dbGetAll('enquiries')).find(e => e.customerPOId === customerPOId);
  if (!enq) return;
  enq.salesOrderId = salesOrderId;
  enq.delivery = enq.delivery || emptyDelivery();
  if (enq.delivery.status === 'Not Started') enq.delivery.status = 'Sourcing from Supplier';
  if (enq.stage !== 'Lost / Cancelled') enq.stage = 'In Delivery';
  enq.updatedAt = new Date().toISOString();
  await DB.dbPut('enquiries', enq);
}

window.EnquirySync = { syncEnquiryFromQuotationLink, syncEnquiryFromCustomerPOLink };
