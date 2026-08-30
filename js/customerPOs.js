/* ============================================================
   customerPOs.js — records a PO received FROM a customer, linked to
   the quotation it came from. Can be converted into a Sales Order.
   ============================================================ */

const CPO_STATUSES = ['Open', 'Converted to Sales Order', 'Cancelled'];

Router.route('/customer-pos', async () => {
  Router.setBreadcrumb([{ label: 'Customer Purchase Orders' }]);
  const [all, customers, quotations] = await Promise.all([DB.dbGetAll('customerPOs'), DB.dbGetAll('customers'), DB.dbGetAll('quotations')]);
  const custMap = Object.fromEntries(customers.map(c => [c.id, c]));
  const quoteMap = Object.fromEntries(quotations.map(q => [q.id, q]));
  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="page-head"><h1>Customer Purchase Orders</h1>
      <div class="page-actions"><button class="btn-amber" id="btnNew">+ Record Customer PO</button></div>
    </div>
    <div class="card">
      <table class="data-table">
        <thead><tr><th>Record #</th><th>Customer PO #</th><th>Customer</th><th>Quotation #</th><th>Date Received</th><th>Status</th><th>Amount</th></tr></thead>
        <tbody>
          ${all.map(po => `
            <tr class="clickable-row" data-hash="/customer-pos/${po.id}">
              <td>${escapeHtml(po.poNo)}</td><td>${escapeHtml(po.customerPoNumber || '—')}</td>
              <td>${escapeHtml(custMap[po.customerId]?.companyName || '—')}</td>
              <td>${escapeHtml(quoteMap[po.quotationId]?.quotationNo || '—')}</td>
              <td>${formatDate(po.dateReceived)}</td><td>${statusBadge(po.status)}</td>
              <td>${formatMoney(po.poAmount, po.currency)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      ${all.length === 0 ? `<div class="empty-inline">No customer POs recorded yet.</div>` : ''}
    </div>
  `;
  document.getElementById('btnNew').onclick = () => Router.navigate('/customer-pos/new');
});

Router.route('/customer-pos/new', (p, query) => renderCPOForm(null, query));
Router.route('/customer-pos/:id/edit', (p) => renderCPOForm(p.id));

async function renderCPOForm(id, query) {
  const isEdit = !!id;
  const record = isEdit ? await DB.dbGet('customerPOs', Number(id)) : null;
  const [customers, quotations, settings, existingSalesOrders, products] = await Promise.all([
    DB.dbGetAll('customers'), DB.dbGetAll('quotations'), DB.getSettings(),
    isEdit ? DB.dbQueryIndex('salesOrders', 'customerPOId', Number(id)) : [],
    DB.dbGetAll('products')
  ]);
  const latestQuotes = quotations.filter(q => q.isLatest);
  const prefillQuoteId = query && query.quotationId ? Number(query.quotationId) : (record ? record.quotationId : null);
  const prefillQuote = prefillQuoteId ? quotations.find(q => q.id === prefillQuoteId) : null;

  /** Builds the "Which Option Did the Customer Choose?" field — used both for the initial
      render AND rebuilt live if the Related Quotation dropdown is changed afterward, so the
      selector can never be silently skipped depending on how the quotation got linked. */
  function chosenOptionBlockHTML(quotationForBlock, currentChosenGroup, salesOrdersForBlock) {
    if (!quotationForBlock || !quotationForBlock.isMultiOption) return '';
    const sos = salesOrdersForBlock || [];
    return `
        <div class="field field-wide">
          <label>Which Option Did the Customer Choose? *</label>
          ${sos.length > 0 ? `<div class="card warning-card" style="margin-bottom:8px; padding:10px 14px;">⚠ A Sales Order (${sos.map(s => s.soNo).join(', ')}) was already created from this PO using "<b>${escapeHtml(record?.chosenOptionLabel || '')}</b>". Changing this selection will <b>not</b> automatically update that Sales Order — you'll need to revise it separately (its line items and supplier assignments) to match.</div>` : ''}
          <select id="f_chosenOption" required>
            <option value="">— Select the option the customer's PO is for —</option>
            ${quotationForBlock.optionTotals.map(o => `<option value="${escapeHtml(o.group)}" ${(currentChosenGroup || '') === o.group ? 'selected' : ''}>${escapeHtml(o.label)} — ${formatMoney(o.grandTotal, quotationForBlock.currency)}</option>`).join('')}
          </select>
          <span class="muted-text">This quotation had multiple alternative options — picking the right one here fills in the correct PO Amount and later makes sure the Sales Order only includes the items actually ordered.</span>
        </div>`;
  }

  /** Line items only apply when NO quotation is linked. When a quotation IS linked, that's
      already the source of truth for what's being ordered — if the customer's real PO differs
      (e.g. a different quantity), the right fix is a new quotation revision, not duplicating
      the items here. This is specifically for orders with nothing behind them yet — most
      commonly sample requests — where otherwise there'd be no structured record of what was
      actually asked for beyond a single lump PO Amount. */
  function productOptionsForCPO(selectedId) {
    return `<option value="">—</option>` + products.filter(p => !p.archived).map(p => `<option value="${p.id}" ${String(p.id) === String(selectedId) ? 'selected' : ''}>${escapeHtml(p.itemNo)} — ${escapeHtml(p.description || '').slice(0, 30)}</option>`).join('');
  }
  function poLinesBlockHTML(hasQuotation, freight) {
    if (hasQuotation) return '';
    return `
      <div class="card">
        <h3 class="section-title">Line Items</h3>
        <p class="muted-text">No quotation is linked, so this is the only record of what was actually ordered — e.g. a sample request. VAT defaults to 12% per line (set to 0% if not applicable). Use the Freight field below for delivery charges — not a line item — so it carries through to the Sales Order the same way Freight already works there. PO Amount is the VAT-inclusive total, calculated from these lines plus Freight.</p>
        <div style="overflow-x:auto; max-width:100%;">
        <table class="data-table compact">
          <thead><tr><th>Catalog</th><th>Description</th><th style="width:55px;">Qty</th><th style="width:45px;">UOM</th><th style="width:80px;">Unit Price</th><th style="width:50px;">VAT%</th><th>Amount</th><th class="internal-only-col">Amount w/ VAT</th><th></th></tr></thead>
          <tbody id="poLinesBody"></tbody>
        </table>
        </div>
        <button type="button" class="btn-line btn-sm" id="btnAddPOLine" style="margin-top:8px;">+ Add Line</button>
        <div class="field" style="margin-top:14px; max-width:220px;"><label>Freight / Shipping Charge</label><input type="number" step="0.01" id="f_poFreight" value="${freight || 0}"></div>
      </div>`;
  }

  Router.setBreadcrumb([{ label: 'Customer Purchase Orders', hash: '/customer-pos' }, { label: isEdit ? record.poNo : 'New' }]);

  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="page-head"><h1>${isEdit ? 'Edit' : 'Record'} Customer Purchase Order</h1></div>
    <form class="card form-card" id="cpoForm">
      <div class="form-grid">
        <div class="field"><label>Related Quotation</label>
          <select id="f_quotationId">
            <option value="">— None / not from a quotation —</option>
            ${latestQuotes.map(q => `<option value="${q.id}" ${q.id === (record?.quotationId || prefillQuoteId) ? 'selected' : ''}>${escapeHtml(q.quotationNo)} — ${escapeHtml(q.customerSnapshot?.companyName || '')}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Customer *</label>
          <select id="f_customerId" required>
            <option value="">— Select customer —</option>
            ${customers.map(c => `<option value="${c.id}" ${c.id === (record?.customerId || prefillQuote?.customerId) ? 'selected' : ''}>${escapeHtml(c.companyName)}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Customer's PO Number</label><input id="f_customerPoNumber" value="${escapeHtml(record?.customerPoNumber || '')}"></div>
        <div class="field"><label>PO Date</label><input type="date" id="f_poDate" value="${record?.poDate || todayISO()}"></div>
        <div class="field"><label>Date Received</label><input type="date" id="f_dateReceived" value="${record?.dateReceived || todayISO()}"></div>
        <div class="field"><label>Project / Inquiry Reference</label><input id="f_projectRef" value="${escapeHtml(record?.projectRef || prefillQuote?.rfqRef || prefillQuote?.projectName || '')}"></div>
        <div class="field"><label>Currency</label><select id="f_currency">${currencyList(settings).map(c => `<option ${c === (record?.currency || prefillQuote?.currency || 'PHP') ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
        <div id="chosenOptionContainer">${chosenOptionBlockHTML(prefillQuote, record?.chosenOptionGroup, existingSalesOrders)}</div>
        <div class="field" id="poAmountField"><label id="poAmountLabel">${(record?.lines && record.lines.length > 0) ? 'PO Amount (calculated from Line Items below)' : 'PO Amount'}</label><input type="number" step="0.01" id="f_poAmount" value="${record?.poAmount ?? (prefillQuote && !prefillQuote.isMultiOption ? prefillQuote.grandTotal : 0)}" ${(record?.lines && record.lines.length > 0) ? 'readonly' : ''}></div>
        <div class="field"><label>Customer Contact</label><input id="f_customerContact" value="${escapeHtml(record?.customerContact || '')}"></div>
        <div class="field field-wide"><label>Shipping Address</label><textarea id="f_shippingAddress">${escapeHtml(record?.shippingAddress || '')}</textarea></div>
        <div class="field field-wide"><label>Delivery Requirements</label><textarea id="f_deliveryRequirements">${escapeHtml(record?.deliveryRequirements || '')}</textarea></div>
        <div class="field"><label>Status</label><select id="f_status">${CPO_STATUSES.map(s => `<option ${s === (record?.status || 'Open') ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <div class="field field-wide"><label>Notes</label><textarea id="f_notes">${escapeHtml(record?.notes || '')}</textarea></div>
      </div>
      <div id="poLinesContainer">${poLinesBlockHTML(!!(record?.quotationId || prefillQuoteId), record?.freight)}</div>
      <div class="form-actions">
        <button type="submit" class="btn-amber">Save</button>
        <button type="button" class="btn-line" id="btnCancel">Cancel</button>
      </div>
    </form>
  `;

  content.querySelectorAll('input,textarea,select').forEach(i => i.addEventListener('input', markDirty));

  // Same idea as the Quotation form: pull the selected customer's own defaults in
  // automatically, only filling fields that are currently blank so we don't overwrite
  // anything the user has already typed.
  function applyCustomerDefaults(customerId) {
    const selectedCustomer = customers.find(c => c.id === Number(customerId));
    if (!selectedCustomer) return;
    const currencyEl = document.getElementById('f_currency');
    const contactEl = document.getElementById('f_customerContact');
    const shippingEl = document.getElementById('f_shippingAddress');
    if (selectedCustomer.defaultCurrency) currencyEl.value = selectedCustomer.defaultCurrency;
    if (!contactEl.value && selectedCustomer.contactPerson) contactEl.value = selectedCustomer.contactPerson;
    if (!shippingEl.value && selectedCustomer.shippingAddress) shippingEl.value = selectedCustomer.shippingAddress;
  }
  document.getElementById('f_customerId').addEventListener('change', (e) => {
    applyCustomerDefaults(e.target.value);
    markDirty();
  });
  // A pre-selected <option selected> (arriving via edit mode, or "?quotationId=" from a
  // quotation) never fires a 'change' event on its own — without this, Customer Contact
  // and Shipping Address silently stayed blank even though the customer was already known.
  const initialCustomerId = document.getElementById('f_customerId').value;
  if (initialCustomerId) applyCustomerDefaults(initialCustomerId);

  // Tracks whichever quotation is CURRENTLY linked for "chosen option" purposes — this
  // starts as prefillQuote, but must be able to change if the user picks a different
  // quotation from the dropdown after the form has already rendered.
  let currentOptionQuotation = prefillQuote;
  function wireChosenOptionSelect() {
    const sel = document.getElementById('f_chosenOption');
    if (sel) sel.addEventListener('change', (e) => {
      const opt = currentOptionQuotation.optionTotals.find(o => o.group === e.target.value);
      if (opt) document.getElementById('f_poAmount').value = opt.grandTotal;
      markDirty();
    });
  }
  wireChosenOptionSelect();

  // ---- Line Items (only relevant when no quotation is linked) ----
  let poLines = (!record?.quotationId && record?.lines) ? record.lines.map(l => Object.assign({}, l)) : [];
  // Tracked separately from the DOM, because the Freight input itself gets removed entirely
  // when a quotation is linked — without this, the value typed earlier would simply vanish
  // if the user switches to a quotation and then back to "None".
  let lastKnownFreight = record?.freight || 0;
  function syncPOAmountFromLines() {
    // PO Amount reflects the true VAT-inclusive total — what the customer's real PO would
    // actually state as the amount owed — plus Freight, matching how Sales Order totals work.
    const linesTotal = r2(poLines.reduce((s, l) => s + (Number(l.amountWithVat) || 0), 0));
    const freightInput = document.getElementById('f_poFreight');
    const freight = freightInput ? (Number(freightInput.value) || 0) : 0;
    document.getElementById('f_poAmount').value = r2(linesTotal + freight);
  }
  // PO Amount locks (and auto-computes) the moment there's ANY structured data behind it —
  // a line item or a Freight value — and unlocks for manual entry only when both are empty.
  function updatePOAmountLockState() {
    const freightInput = document.getElementById('f_poFreight');
    const freight = freightInput ? (Number(freightInput.value) || 0) : 0;
    const locked = poLines.length > 0 || freight !== 0;
    document.getElementById('f_poAmount').readOnly = locked;
    document.getElementById('poAmountLabel').textContent = locked ? 'PO Amount (calculated from Line Items below)' : 'PO Amount';
    if (locked) syncPOAmountFromLines();
  }
  function wireFreightInput() {
    const el = document.getElementById('f_poFreight');
    if (el) el.addEventListener('input', () => { lastKnownFreight = Number(el.value) || 0; updatePOAmountLockState(); markDirty(); });
  }
  function drawPOLines() {
    const body = document.getElementById('poLinesBody');
    if (!body) return; // no quotation-linked forms don't have this table at all
    body.innerHTML = poLines.map((l, i) => {
      const amount = r2((Number(l.qty) || 0) * (Number(l.unitPrice) || 0));
      const amountWithVat = r2(amount * (1 + (Number(l.vatRate) || 0) / 100));
      l.amount = amount; l.amountWithVat = amountWithVat;
      return `<tr data-idx="${i}">
        <td><select class="po-catalog" style="min-width:110px;">${productOptionsForCPO(l.itemId)}</select></td>
        <td><textarea class="po-desc" rows="1" style="width:160px;">${escapeHtml(l.description || '')}</textarea></td>
        <td><input class="po-qty" type="number" min="0" step="any" value="${l.qty || 0}" style="width:55px;"></td>
        <td><input class="po-uom" value="${escapeHtml(l.uom || 'pc')}" style="width:45px;"></td>
        <td><input class="po-price" type="number" min="0" step="0.01" value="${l.unitPrice || 0}" style="width:80px;"></td>
        <td><input class="po-vat" type="number" min="0" step="0.01" value="${l.vatRate ?? 12}" style="width:50px;"></td>
        <td class="po-amount" style="text-align:right; font-family:var(--mono);">${formatMoney(amount, document.getElementById('f_currency').value)}</td>
        <td class="po-amount-vat internal-only-col" style="text-align:right; font-family:var(--mono);">${formatMoney(amountWithVat, document.getElementById('f_currency').value)}</td>
        <td class="row-del" data-podel="${i}">✕</td>
      </tr>`;
    }).join('');
    body.querySelectorAll('tr').forEach(tr => {
      const idx = Number(tr.dataset.idx);
      const bind = (sel, field, isNum) => tr.querySelector(sel).addEventListener('input', (e) => {
        poLines[idx][field] = isNum ? (Number(e.target.value) || 0) : e.target.value;
        const amt = r2((Number(poLines[idx].qty) || 0) * (Number(poLines[idx].unitPrice) || 0));
        const amtWithVat = r2(amt * (1 + (Number(poLines[idx].vatRate) || 0) / 100));
        poLines[idx].amount = amt; poLines[idx].amountWithVat = amtWithVat;
        tr.querySelector('.po-amount').textContent = formatMoney(amt, document.getElementById('f_currency').value);
        tr.querySelector('.po-amount-vat').textContent = formatMoney(amtWithVat, document.getElementById('f_currency').value);
        syncPOAmountFromLines();
        markDirty();
      });
      bind('.po-desc', 'description'); bind('.po-qty', 'qty', true); bind('.po-uom', 'uom'); bind('.po-price', 'unitPrice', true); bind('.po-vat', 'vatRate', true);
      tr.querySelector('.po-catalog').addEventListener('change', (e) => {
        const p = products.find(pr => String(pr.id) === e.target.value);
        poLines[idx].itemId = e.target.value ? Number(e.target.value) : '';
        if (p) {
          poLines[idx].description = p.description || poLines[idx].description;
          poLines[idx].unitPrice = Number(p.standardPrice) || poLines[idx].unitPrice;
          poLines[idx].uom = p.uom || poLines[idx].uom || 'pc';
          drawPOLines();
          syncPOAmountFromLines();
        }
        markDirty();
      });
    });
    body.querySelectorAll('[data-podel]').forEach(btn => btn.addEventListener('click', () => {
      poLines.splice(Number(btn.dataset.podel), 1);
      drawPOLines();
      // Deleting the last line hands manual control of PO Amount back to the user, UNLESS a
      // Freight value is still keeping it locked — line items and freight are each optional,
      // but either one on its own is still structured data worth trusting over free typing.
      updatePOAmountLockState();
      markDirty();
    }));
  }
  function wireAddPOLineBtn() {
    const btn = document.getElementById('btnAddPOLine');
    if (btn) btn.onclick = () => {
      poLines.push({ lineId: 'L' + Math.random().toString(36).slice(2, 9), itemId: '', description: '', qty: 1, uom: 'pc', unitPrice: 0, vatRate: 12, amount: 0, amountWithVat: 0 });
      drawPOLines();
      updatePOAmountLockState();
      markDirty();
    };
  }
  if (!(record?.quotationId || prefillQuoteId)) {
    drawPOLines(); wireAddPOLineBtn(); wireFreightInput();
    updatePOAmountLockState();
  }

  // THE FIX: previously the "Which Option?" selector only ever appeared if the quotation
  // arrived via the "Record Customer PO for this Quotation" link. If someone instead opened
  // a blank form and picked a multi-option quotation from this dropdown directly, the
  // selector never showed up at all — silently skipping the option choice entirely.
  document.getElementById('f_quotationId').addEventListener('change', (e) => {
    const newQId = e.target.value ? Number(e.target.value) : null;
    currentOptionQuotation = newQId ? quotations.find(q => q.id === newQId) : null;
    document.getElementById('chosenOptionContainer').innerHTML = chosenOptionBlockHTML(currentOptionQuotation, null, []);
    wireChosenOptionSelect();
    // Line items only make sense with no quotation linked — rebuild the whole block so it
    // appears/disappears correctly no matter how the user gets there. Preserve whatever
    // Freight value was already typed, in case the user toggles back and forth.
    const existingFreightInput = document.getElementById('f_poFreight');
    if (existingFreightInput) lastKnownFreight = Number(existingFreightInput.value) || 0;
    document.getElementById('poLinesContainer').innerHTML = poLinesBlockHTML(!!newQId, lastKnownFreight);
    if (newQId) {
      document.getElementById('poAmountLabel').textContent = 'PO Amount';
      document.getElementById('f_poAmount').readOnly = false;
      if (currentOptionQuotation && !currentOptionQuotation.isMultiOption) {
        // A plain (non-multi-option) quotation was picked — fill in its total directly, same
        // as already happens when arriving via the quotation's own "Record Customer PO" link.
        document.getElementById('f_poAmount').value = currentOptionQuotation.grandTotal;
      }
    } else {
      drawPOLines(); wireAddPOLineBtn(); wireFreightInput();
      updatePOAmountLockState();
    }
    markDirty();
  });

  document.getElementById('btnCancel').onclick = () => { if (!guardNavigation()) return; clearDirty(); Router.navigate(isEdit ? `/customer-pos/${id}` : '/customer-pos'); };

  document.getElementById('cpoForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn.disabled) return;
    submitBtn.disabled = true;
    try {
    const customerId = Number(document.getElementById('f_customerId').value);
    if (!customerId) { toast('Please select a customer.', 'err'); return; }
    if (!document.getElementById('f_quotationId').value && poLines.length > 0 && !poLines.every(l => l.description && Number(l.qty) > 0)) {
      toast('Every line item needs a description and a quantity greater than 0.', 'err'); return;
    }
    let chosenOptionGroup = record?.chosenOptionGroup || '';
    let chosenOptionLabel = record?.chosenOptionLabel || '';
    const liveChosenOptionSelect = document.getElementById('f_chosenOption');
    if (liveChosenOptionSelect) {
      if (!liveChosenOptionSelect.value) { toast('Please select which option the customer chose.', 'err'); return; }
      const opt = currentOptionQuotation.optionTotals.find(o => o.group === liveChosenOptionSelect.value);
      chosenOptionGroup = opt.group; chosenOptionLabel = opt.label;
    }
    const settings = await DB.getSettings();
    const now = new Date().toISOString();
    const obj = record ? Object.assign({}, record) : {};
    Object.assign(obj, {
      quotationId: document.getElementById('f_quotationId').value ? Number(document.getElementById('f_quotationId').value) : null,
      customerId,
      customerPoNumber: document.getElementById('f_customerPoNumber').value,
      poDate: document.getElementById('f_poDate').value,
      dateReceived: document.getElementById('f_dateReceived').value,
      projectRef: document.getElementById('f_projectRef').value,
      currency: document.getElementById('f_currency').value,
      poAmount: Number(document.getElementById('f_poAmount').value) || 0,
      lines: document.getElementById('f_quotationId').value ? [] : poLines,
      freight: document.getElementById('f_quotationId').value ? 0 : (Number(document.getElementById('f_poFreight')?.value) || 0),
      customerContact: document.getElementById('f_customerContact').value,
      shippingAddress: document.getElementById('f_shippingAddress').value,
      deliveryRequirements: document.getElementById('f_deliveryRequirements').value,
      status: document.getElementById('f_status').value,
      notes: document.getElementById('f_notes').value,
      chosenOptionGroup, chosenOptionLabel,
      updatedAt: now, modifiedBy: settings.userName
    });
    if (isEdit) {
      await DB.dbPut('customerPOs', obj);
      await DB.logActivity(`Updated customer PO ${obj.poNo}`);
      toast('Customer PO saved.'); clearDirty(); Router.navigate(`/customer-pos/${obj.id}`);
    } else {
      obj.createdAt = now; obj.createdBy = settings.userName;
      obj.poNo = await DB.nextDocNumber('customerPO');
      const newId = await DB.dbAdd('customerPOs', obj);
      await DB.logActivity(`Recorded customer PO ${obj.poNo}`);
      toast('Customer PO recorded.'); clearDirty(); Router.navigate(`/customer-pos/${newId}`);
    }
    } finally {
      submitBtn.disabled = false;
    }
  });
}

Router.route('/customer-pos/:id', (p) => renderCPODetail(p.id));

async function renderCPODetail(id) {
  const po = await DB.dbGet('customerPOs', Number(id));
  const content = document.getElementById('content');
  if (!po) { content.innerHTML = `<div class="empty-state"><h3>Record not found</h3></div>`; return; }
  const [customer, quotation, salesOrders] = await Promise.all([
    DB.dbGet('customers', po.customerId),
    po.quotationId ? DB.dbGet('quotations', po.quotationId) : null,
    DB.dbQueryIndex('salesOrders', 'customerPOId', po.id)
  ]);

  Router.setBreadcrumb([{ label: 'Customer Purchase Orders', hash: '/customer-pos' }, { label: po.poNo }]);

  const orphanWarning = (salesOrders.length > 0 && po.status !== 'Converted to Sales Order')
    ? `<div class="card warning-card">⚠ This PO's status is currently <b>${escapeHtml(po.status)}</b>, but it was already converted into Sales Order
        ${salesOrders.map(s => `<a href="#/sales-orders/${s.id}"><b>${escapeHtml(s.soNo)}</b></a>`).join(', ')}. That sales order was not changed.</div>`
    : '';

  content.innerHTML = `
    <div class="page-head">
      <div><div class="doc-number-tag">${escapeHtml(po.poNo)}</div><h1>${escapeHtml(customer?.companyName || '—')} ${statusBadge(po.status)}</h1></div>
      <div class="page-actions">
        <button class="btn-line" id="btnEdit">Edit</button>
        <button class="btn-danger" id="btnDelete">Delete</button>
      </div>
    </div>

    <div class="card"><div class="status-actions">
      ${CPO_STATUSES.filter(s => s !== po.status).map(s => `<button class="btn-line btn-sm status-btn" data-status="${s}">Mark as ${s}</button>`).join('')}
    </div></div>

    ${orphanWarning}

    <div class="card">
      <div class="detail-grid">
        <div class="detail-item"><div class="detail-label">Customer's PO Number</div><div class="detail-value">${escapeHtml(po.customerPoNumber || '—')}</div></div>
        <div class="detail-item"><div class="detail-label">Customer</div><div class="detail-value">${customer ? `<a href="#/customers/${customer.id}">${escapeHtml(customer.companyName)}</a>` : '—'}</div></div>
        <div class="detail-item"><div class="detail-label">Related Quotation</div><div class="detail-value">${quotation ? `<a href="#/quotations/${quotation.id}">${escapeHtml(quotation.quotationNo)}</a>` : '—'}</div></div>
        ${po.chosenOptionLabel ? `<div class="detail-item"><div class="detail-label">Option Chosen by Customer</div><div class="detail-value">${escapeHtml(po.chosenOptionLabel)}</div></div>` : ''}
        <div class="detail-item"><div class="detail-label">Project / Inquiry Reference</div><div class="detail-value">${escapeHtml(po.projectRef || '—')}</div></div>
        <div class="detail-item"><div class="detail-label">Customer Contact</div><div class="detail-value">${escapeHtml(po.customerContact || '—')}</div></div>
        <div class="detail-item"><div class="detail-label">PO Date</div><div class="detail-value">${formatDate(po.poDate)}</div></div>
        <div class="detail-item"><div class="detail-label">Date Received</div><div class="detail-value">${formatDate(po.dateReceived)}</div></div>
        <div class="detail-item"><div class="detail-label">Amount</div><div class="detail-value">${formatMoney(po.poAmount, po.currency)}</div></div>
        <div class="detail-item"><div class="detail-label">Shipping Address</div><div class="detail-value">${escapeHtml(po.shippingAddress || '—')}</div></div>
        <div class="detail-item"><div class="detail-label">Delivery Requirements</div><div class="detail-value">${escapeHtml(po.deliveryRequirements || '—')}</div></div>
        <div class="detail-item"><div class="detail-label">Notes</div><div class="detail-value">${escapeHtml(po.notes || '—')}</div></div>
      </div>
    </div>
    ${((po.lines && po.lines.length > 0) || po.freight) ? `
    <div class="card">
      <h3 class="section-title">Line Items</h3>
      ${(po.lines && po.lines.length > 0) ? `
      <table class="data-table compact">
        <thead><tr><th>Description</th><th>Qty</th><th>Unit Price</th><th>VAT%</th><th>Amount</th><th class="internal-only-col">Amount w/ VAT</th></tr></thead>
        <tbody>${po.lines.map(l => {
          const vatRate = l.vatRate ?? 12;
          const amountWithVat = l.amountWithVat ?? r2((l.amount || 0) * (1 + vatRate / 100));
          return `<tr><td>${escapeHtml(l.description)}</td><td>${l.qty} ${escapeHtml(l.uom || 'pc')}</td><td>${formatMoney(l.unitPrice, po.currency)}</td><td>${vatRate}%</td><td>${formatMoney(l.amount, po.currency)}</td><td class="internal-only-col">${formatMoney(amountWithVat, po.currency)}</td></tr>`;
        }).join('')}</tbody>
      </table>` : `<div class="empty-inline">No itemized lines — Freight only.</div>`}
      ${po.freight ? `<div class="totals" style="margin-top:10px;"><div class="line"><span>Freight / Shipping</span><span>${formatMoney(po.freight, po.currency)}</span></div><div class="line grand"><span>PO Amount</span><span>${formatMoney(po.poAmount, po.currency)}</span></div></div>` : ''}
    </div>` : ''}
    ${relatedTable('Sales Orders', salesOrders, ['soNo', 'orderDate', 'status', 'grandTotal'], '/sales-orders', po.currency)}
    ${salesOrders.length === 0 && po.status !== 'Cancelled' ? `<div class="card"><button class="btn-amber" id="btnConvert">Convert to Sales Order</button></div>` : ''}
    <div class="meta-strip">Created ${formatDate(po.createdAt)} by ${escapeHtml(po.createdBy || '—')} · Last modified ${formatDate(po.updatedAt)} by ${escapeHtml(po.modifiedBy || '—')}</div>
  `;

  document.getElementById('btnEdit').onclick = () => Router.navigate(`/customer-pos/${id}/edit`);
  document.getElementById('btnDelete').onclick = async () => {
    const warn = salesOrders.length > 0 ? `This PO has ${salesOrders.length} linked Sales Order(s). Deleting it will NOT delete those, but their link will show as missing. ` : '';
    if (!confirm(`${warn}Delete customer PO ${po.poNo}? This cannot be undone.`)) return;
    await DB.dbDelete('customerPOs', po.id);
    await DB.logActivity(`Deleted customer PO ${po.poNo}`);
    toast('Deleted.'); Router.navigate('/customer-pos');
  };
  content.querySelectorAll('.status-btn').forEach(btn => btn.onclick = async () => {
    const newStatus = btn.dataset.status;
    if (newStatus === 'Cancelled' && !confirm(`Mark ${po.poNo} as Cancelled?`)) return;
    po.status = newStatus;
    po.updatedAt = new Date().toISOString();
    await DB.dbPut('customerPOs', po);
    await DB.logActivity(`Customer PO ${po.poNo} marked as ${newStatus}`);
    toast('Status updated.'); renderCPODetail(id);
  });
  const convertBtn = document.getElementById('btnConvert');
  if (convertBtn) convertBtn.onclick = () => SalesOrders.createFromCustomerPO(po, quotation);
}
