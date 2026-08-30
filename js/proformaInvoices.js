/* ============================================================
   proformaInvoices.js — Proforma Invoices generated from a Sales Order.
   A proforma invoice keeps the SAME number every time you reprint it —
   generating one against a Sales Order that already has one just takes
   you back to the existing record rather than creating a duplicate,
   matching how a real proforma invoice is expected to behave (one
   stable reference number per transaction, not a new one each time).
   ============================================================ */

Router.route('/proforma-invoices/:id', (p) => renderPIDetail(p.id));

async function renderPIDetail(id) {
  const pi = await DB.dbGet('proformaInvoices', Number(id));
  const content = document.getElementById('content');
  if (!pi) { content.innerHTML = `<div class="empty-state"><h3>Proforma Invoice not found</h3></div>`; return; }

  const so = await DB.dbGet('salesOrders', pi.salesOrderId);
  const customer = so ? await DB.dbGet('customers', so.customerId) : null;

  Router.setBreadcrumb([{ label: 'Sales Orders', hash: '/sales-orders' }, { label: so ? so.soNo : '—', hash: so ? `/sales-orders/${so.id}` : '' }, { label: pi.piNo }]);

  content.innerHTML = `
    <div class="page-head">
      <div><div class="doc-number-tag">${escapeHtml(pi.piNo)}</div><h1>Proforma Invoice</h1></div>
      <div class="page-actions">
        <button class="btn-amber" id="btnPrintPI">Print</button>
        <button class="btn-danger" id="btnDeletePI">Delete</button>
      </div>
    </div>

    <div class="card">
      <div class="detail-grid">
        <div class="detail-item"><div class="detail-label">Sales Order</div><div class="detail-value">${so ? `<a href="#/sales-orders/${so.id}">${escapeHtml(so.soNo)}</a>` : '—'}</div></div>
        <div class="detail-item"><div class="detail-label">Customer</div><div class="detail-value">${customer ? `<a href="#/customers/${customer.id}">${escapeHtml(customer.companyName)}</a>` : '—'}</div></div>
        <div class="detail-item"><div class="detail-label">Date</div><div class="detail-value">${formatDate(pi.date)}</div></div>
        <div class="detail-item"><div class="detail-label">Amount</div><div class="detail-value">${so ? formatMoney(so.grandTotal, so.currency) : '—'}</div></div>
      </div>
    </div>

    <div class="card">
      <h3 class="section-title">Note (shown on the printed proforma invoice)</h3>
      <p class="muted-text">Use this for anything that applies to the invoice as a whole — e.g. sample disclaimers, delivery notes — instead of writing it into a line item's description.</p>
      <textarea id="piNotes" rows="3" style="width:100%;">${escapeHtml(pi.notes || '')}</textarea>
      <div class="btn-row" style="margin-top:10px;"><button class="btn-line btn-sm" id="btnSaveNotes">Save Note</button></div>
    </div>

    <div class="card muted-text" style="padding:14px 20px;">This shows the current Sales Order amount live — if the Sales Order is revised after this proforma invoice was generated, printing again will reflect the updated figures. The PI number itself stays the same either way.</div>

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
    if (!confirm(`Delete proforma invoice ${pi.piNo}? This cannot be undone.`)) return;
    await DB.dbDelete('proformaInvoices', pi.id);
    await DB.logActivity(`Deleted proforma invoice ${pi.piNo}`);
    toast('Deleted.');
    Router.navigate(so ? `/sales-orders/${so.id}` : '/sales-orders');
  };
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
    createdAt: now, createdBy: settings.userName
  });
  await DB.logActivity(`Generated proforma invoice ${piNo} for sales order ${so.soNo}`);
  Router.navigate(`/proforma-invoices/${newId}`);
}

window.ProformaInvoices = { getOrCreateProformaInvoice };
