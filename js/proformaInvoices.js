/* ============================================================
   proformaInvoices.js — Proforma Invoices generated from a Sales Order.
   A proforma invoice keeps the SAME number every time you reprint it —
   generating one against a Sales Order that already has one just takes
   you back to the existing record rather than creating a duplicate,
   matching how a real proforma invoice is expected to behave (one
   stable reference number per transaction, not a new one each time).

   IMPORTANT: a proforma invoice SNAPSHOTS its line items and totals at
   the moment it's generated, rather than reading the Sales Order live.
   This matters once payment tracking exists on top of it -- an invoice
   already sent to a customer, with payments being recorded against it,
   should not silently change amount if the underlying Sales Order gets
   revised afterward. If the order genuinely changes after invoicing,
   that's a new invoice or a credit note in real accounting practice,
   not a retroactive edit to one a customer may have already paid part
   of. The PI's own numbers are the source of truth from here on.
   ============================================================ */

Router.route('/proforma-invoices/:id', (p) => renderPIDetail(p.id));
Router.route('/payments', () => renderPaymentsList());

/** One-time migration for PIs generated before the snapshot fields existed (before payment
    tracking was added) -- those records have no stored grandTotal/lines at all, which would
    otherwise silently show as a ₱0.00 invoice. Backfills from the linked Sales Order's
    CURRENT figures (the best available source at this point) and persists it, so it becomes
    a proper frozen snapshot from here on -- same protection new invoices get automatically. */
async function ensurePISnapshot(pi) {
  if (pi.grandTotal !== undefined && pi.lines !== undefined) return pi;
  const so = await DB.dbGet('salesOrders', pi.salesOrderId);
  if (!so) return pi; // nothing to backfill from; leave as-is rather than guess
  pi.lines = (so.lines || []).map(l => Object.assign({}, l));
  pi.subtotal = so.subtotal; pi.vatTotal = so.vatTotal; pi.freight = so.freight; pi.other = so.other;
  pi.grandTotal = so.grandTotal; pi.currency = so.currency;
  pi.paymentTerms = so.paymentTerms; pi.incoterms = so.incoterms;
  pi.payments = pi.payments || [];
  await DB.dbPut('proformaInvoices', pi);
  return pi;
}

function piAmountPaid(pi) {
  return r2((pi.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0));
}
function piBalanceDue(pi) {
  return r2((pi.grandTotal || 0) - piAmountPaid(pi));
}
function piPaymentStatus(pi) {
  const paid = piAmountPaid(pi);
  const total = pi.grandTotal || 0;
  if (paid <= 0) return 'Unpaid';
  if (paid >= total) return 'Paid';
  return 'Partially Paid';
}

async function renderPIDetail(id) {
  let pi = await DB.dbGet('proformaInvoices', Number(id));
  const content = document.getElementById('content');
  if (!pi) { content.innerHTML = `<div class="empty-state"><h3>Proforma Invoice not found</h3></div>`; return; }
  pi = await ensurePISnapshot(pi);

  const so = await DB.dbGet('salesOrders', pi.salesOrderId);
  const customer = so ? await DB.dbGet('customers', so.customerId) : null;
  const amountPaid = piAmountPaid(pi);
  const balanceDue = piBalanceDue(pi);
  const status = piPaymentStatus(pi);

  Router.setBreadcrumb([{ label: 'Payments', hash: '/payments' }, { label: pi.piNo }]);

  content.innerHTML = `
    <div class="page-head">
      <div><div class="doc-number-tag">${escapeHtml(pi.piNo)}</div><h1>Proforma Invoice ${statusBadge(status)}</h1></div>
      <div class="page-actions">
        <button class="btn-line" id="btnPrintPI">Print</button>
        <button class="btn-amber" id="btnRecordPayment">Record Payment</button>
        <button class="btn-danger" id="btnDeletePI">Delete</button>
      </div>
    </div>

    <div class="card">
      <div class="detail-grid">
        <div class="detail-item"><div class="detail-label">Sales Order</div><div class="detail-value">${so ? `<a href="#/sales-orders/${so.id}">${escapeHtml(so.soNo)}</a>` : '—'}</div></div>
        <div class="detail-item"><div class="detail-label">Customer</div><div class="detail-value">${customer ? `<a href="#/customers/${customer.id}">${escapeHtml(customer.companyName)}</a>` : '—'}</div></div>
        <div class="detail-item"><div class="detail-label">Date</div><div class="detail-value">${formatDate(pi.date)}</div></div>
        <div class="detail-item"><div class="detail-label">Invoice Amount</div><div class="detail-value">${formatMoney(pi.grandTotal, pi.currency)}</div></div>
        <div class="detail-item"><div class="detail-label">Amount Paid</div><div class="detail-value text-ok">${formatMoney(amountPaid, pi.currency)}</div></div>
        <div class="detail-item"><div class="detail-label">Balance Due</div><div class="detail-value" style="font-weight:700;">${formatMoney(balanceDue, pi.currency)}</div></div>
      </div>
    </div>

    <div id="recordPaymentHost"></div>

    <div class="card">
      <h3 class="section-title">Payment History</h3>
      ${(pi.payments || []).length === 0 ? `<div class="empty-inline">No payments recorded yet.</div>` : `
      <table class="data-table compact">
        <thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Reference / Note</th><th>Logged By</th></tr></thead>
        <tbody>${[...pi.payments].reverse().map(p => `<tr>
          <td>${formatDate(p.date)}</td><td class="text-ok">${formatMoney(p.amount, pi.currency)}</td>
          <td>${escapeHtml(p.method || '—')}</td><td>${escapeHtml(p.reference || '—')}</td><td>${escapeHtml(p.createdBy || '—')}</td>
        </tr>`).join('')}</tbody>
      </table>
      <p class="muted-text" style="margin-top:8px;">Payment history is a permanent record — to correct a mistaken entry, log an offsetting adjustment rather than deleting history, the same way stock movements work elsewhere in this system.</p>`}
    </div>

    <div class="card">
      <h3 class="section-title">Note (shown on the printed proforma invoice)</h3>
      <p class="muted-text">Use this for anything that applies to the invoice as a whole — e.g. sample disclaimers, delivery notes — instead of writing it into a line item's description.</p>
      <textarea id="piNotes" rows="3" style="width:100%;">${escapeHtml(pi.notes || '')}</textarea>
      <div class="btn-row" style="margin-top:10px;"><button class="btn-line btn-sm" id="btnSaveNotes">Save Note</button></div>
    </div>

    <div class="meta-strip">Created ${formatDate(pi.createdAt)} by ${escapeHtml(pi.createdBy || '—')}</div>
  `;

  document.getElementById('btnPrintPI').onclick = () => Print.printProformaInvoice(pi, so, customer);
  document.getElementById('piNotes').addEventListener('input', markDirty);
  document.getElementById('btnSaveNotes').onclick = async () => {
    pi.notes = document.getElementById('piNotes').value;
    await DB.dbPut('proformaInvoices', pi);
    clearDirty();
    toast('Note saved.');
  };
  document.getElementById('btnDeletePI').onclick = async () => {
    const warn = (pi.payments || []).length > 0 ? ` This invoice has ${pi.payments.length} recorded payment(s) totaling ${formatMoney(amountPaid, pi.currency)} — deleting it will lose that payment history.` : '';
    if (!confirm(`Delete proforma invoice ${pi.piNo}?${warn} This cannot be undone.`)) return;
    await DB.dbDelete('proformaInvoices', pi.id);
    await DB.logActivity(`Deleted proforma invoice ${pi.piNo}`);
    toast('Deleted.');
    Router.navigate(so ? `/sales-orders/${so.id}` : '/sales-orders');
  };
  document.getElementById('btnRecordPayment').onclick = () => renderRecordPaymentForm(pi, id);
}

function renderRecordPaymentForm(pi, id) {
  const host = document.getElementById('recordPaymentHost');
  const balanceDue = piBalanceDue(pi);
  host.innerHTML = `
    <div class="card">
      <h3 class="section-title">Record Payment</h3>
      <div class="form-grid">
        <div class="field"><label>Date</label><input type="date" id="pay_date" value="${todayISO()}"></div>
        <div class="field"><label>Amount</label><input type="number" min="0" step="0.01" id="pay_amount" value="${balanceDue > 0 ? balanceDue : ''}"></div>
        <div class="field"><label>Method</label>
          <select id="pay_method">
            <option>Bank Transfer</option><option>Cash</option><option>Check</option><option>GCash</option><option>Other</option>
          </select>
        </div>
        <div class="field field-wide"><label>Reference / Note</label><input id="pay_reference" placeholder="e.g. Bank reference number, OR number, or any note"></div>
      </div>
      <div class="btn-row" style="margin-top:12px;">
        <button class="btn-amber btn-sm" id="btnConfirmPayment">Save Payment</button>
        <button class="btn-line btn-sm" id="btnCancelPayment">Cancel</button>
      </div>
    </div>
  `;
  host.scrollIntoView && host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  document.getElementById('btnCancelPayment').onclick = () => { host.innerHTML = ''; };
  document.getElementById('btnConfirmPayment').onclick = async () => {
    const amount = r2(Number(document.getElementById('pay_amount').value) || 0);
    if (amount <= 0) { toast('Enter a payment amount greater than 0.', 'err'); return; }
    const newBalance = r2(balanceDue - amount);
    if (newBalance < 0) {
      if (!confirm(`This payment of ${formatMoney(amount, pi.currency)} is more than the remaining balance of ${formatMoney(balanceDue, pi.currency)} — it would overpay this invoice by ${formatMoney(-newBalance, pi.currency)}.\n\nSave anyway? (This can be correct — e.g. a customer overpayment to credit toward a future order.)`)) return;
    }
    const settings = await DB.getSettings();
    pi.payments = (pi.payments || []).concat([{
      id: 'P' + Math.random().toString(36).slice(2, 9),
      date: document.getElementById('pay_date').value || todayISO(),
      amount, method: document.getElementById('pay_method').value,
      reference: document.getElementById('pay_reference').value,
      createdBy: settings.userName, createdAt: new Date().toISOString()
    }]);
    await DB.dbPut('proformaInvoices', pi);
    await DB.logActivity(`Recorded payment of ${formatMoney(amount, pi.currency)} against proforma invoice ${pi.piNo}`);
    toast('Payment recorded.');
    renderPIDetail(id);
  };
}

async function renderPaymentsList() {
  const content = document.getElementById('content');
  Router.setBreadcrumb([{ label: 'Payments' }]);
  const [allPIsRaw, salesOrders, customers] = await Promise.all([
    DB.dbGetAll('proformaInvoices'), DB.dbGetAll('salesOrders'), DB.dbGetAll('customers')
  ]);
  const allPIs = await Promise.all(allPIsRaw.map(pi => ensurePISnapshot(pi)));
  const soMap = Object.fromEntries(salesOrders.map(s => [s.id, s]));
  const custMap = Object.fromEntries(customers.map(c => [c.id, c]));

  // Outstanding invoices first (most actionable), fully paid ones settle toward the bottom.
  const rows = allPIs.map(pi => ({ pi, status: piPaymentStatus(pi), paid: piAmountPaid(pi), balance: piBalanceDue(pi) }))
    .sort((a, b) => (a.status === 'Paid') - (b.status === 'Paid') || new Date(b.pi.date) - new Date(a.pi.date));

  content.innerHTML = `
    <div class="page-head"><h1>Payments</h1></div>
    <p class="muted-text" style="margin:-8px 0 16px;">Payment status for every proforma invoice sent to a customer — sourced from each invoice's own recorded payment history.</p>
    <div class="card" style="padding:0;">
      ${rows.length === 0 ? `<div class="empty-inline">No proforma invoices yet. Generate one from a Sales Order to start tracking payments.</div>` : `
      <table class="data-table">
        <thead><tr><th>PI #</th><th>Customer</th><th>Sales Order</th><th>Date</th><th>Invoice Amount</th><th>Paid</th><th>Balance Due</th><th>Status</th></tr></thead>
        <tbody>${rows.map(({ pi, status, paid, balance }) => {
          const so = soMap[pi.salesOrderId];
          const cust = so ? custMap[so.customerId] : null;
          return `<tr class="clickable-row" data-hash="/proforma-invoices/${pi.id}">
            <td>${escapeHtml(pi.piNo)}</td>
            <td>${escapeHtml(cust?.companyName || '—')}</td>
            <td>${so ? escapeHtml(so.soNo) : '—'}</td>
            <td>${formatDate(pi.date)}</td>
            <td>${formatMoney(pi.grandTotal, pi.currency)}</td>
            <td class="text-ok">${formatMoney(paid, pi.currency)}</td>
            <td>${formatMoney(balance, pi.currency)}</td>
            <td>${statusBadge(status)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>`}
    </div>
  `;
}

/** Called from the Sales Order detail page. Reuses an existing PI for this Sales Order
    if one already exists, rather than ever generating a second number for the same order. */
async function getOrCreateProformaInvoice(so) {
  const existing = await DB.dbQueryIndex('proformaInvoices', 'salesOrderId', so.id);
  if (existing.length > 0) { Router.navigate(`/proforma-invoices/${existing[0].id}`); return; }

  const settings = await DB.getSettings();
  const now = new Date().toISOString();
  const piNo = await DB.nextDocNumber('proformaInvoice');
  const newId = await DB.dbAdd('proformaInvoices', {
    piNo, salesOrderId: so.id, date: todayISO(),
    // Snapshot — see the file header comment for why this matters once payments are tracked.
    lines: (so.lines || []).map(l => Object.assign({}, l)),
    subtotal: so.subtotal, vatTotal: so.vatTotal, freight: so.freight, other: so.other,
    grandTotal: so.grandTotal, currency: so.currency,
    paymentTerms: so.paymentTerms, incoterms: so.incoterms,
    payments: [],
    createdAt: now, createdBy: settings.userName
  });
  await DB.logActivity(`Generated proforma invoice ${piNo} for sales order ${so.soNo}`);
  Router.navigate(`/proforma-invoices/${newId}`);
}

window.ProformaInvoices = { getOrCreateProformaInvoice, piAmountPaid, piBalanceDue, piPaymentStatus, ensurePISnapshot };
