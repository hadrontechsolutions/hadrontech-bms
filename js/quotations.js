/* ============================================================
   quotations.js — Quotation module
   Quotations are workflow-heavy (line items, calculations, revisions,
   status transitions) so unlike Customers/Suppliers/Products this
   module is hand-written rather than using the generic entity engine.

   Revision model: all revisions of "the same quotation" share a
   familyId (= the id of revision 1). Each revision is its own DB
   record with its own id, so old revisions are never overwritten.
   Only one revision per family has isLatest = true.
   ============================================================ */

const QUOTE_STATUSES = ['Draft', 'Sent', 'Under Review', 'Won', 'Lost', 'Expired'];

/** Displays revision numbers zero-padded to 2 digits (Rev 00, Rev 01, ...) — a brand new
    quotation starts at revision 0 since nothing has been revised yet. */
function padRev(n) { return String(n).padStart(2, '0'); }

/* ============================================================
   VALIDITY / EXPIRY — computed display state, never a stored status.
   "Expired" is deliberately never written into q.status automatically:
   the quotation's real lifecycle status (Draft/Sent/.../Won/Lost) stays
   whatever the user set it to. Expiry is an independent, always-current
   signal layered on top, so it can never go stale or fight with the
   status the user is actually managing. Won/Lost quotations are treated
   as closed and are never flagged, regardless of their validity date.
   ============================================================ */
const OPEN_STATUSES_FOR_EXPIRY = ['Draft', 'Sent', 'Under Review'];

function getExpiryInfo(q) {
  if (!q.validUntil) return { state: 'none', badgeText: null, badgeClass: '', text: 'No validity date set' };
  if (!OPEN_STATUSES_FOR_EXPIRY.includes(q.status)) return { state: 'closed', badgeText: null, badgeClass: '', text: '' };

  const diffDays = daysBetweenISO(todayISO(), q.validUntil); // validUntil minus today; negative = already past

  if (diffDays < 0) {
    const daysAgo = Math.abs(diffDays);
    return { state: 'expired', badgeText: 'Expired', badgeClass: 'badge-expired', text: `Expired ${daysAgo} day${daysAgo === 1 ? '' : 's'} ago` };
  }
  if (diffDays === 0) {
    return { state: 'today', badgeText: 'Expires Today', badgeClass: 'badge-expires-today', text: 'Expires today' };
  }
  if (diffDays <= 7) {
    return { state: 'soon', badgeText: 'Expiring Soon', badgeClass: 'badge-expiring-soon', text: `Valid for ${diffDays} more day${diffDays === 1 ? '' : 's'}` };
  }
  return { state: 'active', badgeText: null, badgeClass: '', text: `Valid for ${diffDays} more days` };
}

/** Small inline cell used on lists/search — colored text + short label, never color alone. */
function validityCellHTML(q) {
  const info = getExpiryInfo(q);
  const dateStr = q.validUntil ? formatDate(q.validUntil) : '—';
  if (info.state === 'none') return `<span class="muted-text">${dateStr}</span>`;
  if (info.state === 'closed' || info.state === 'active') return dateStr;
  const cls = info.state === 'expired' ? 'text-danger' : (info.state === 'today' ? 'text-amber' : 'text-warn');
  return `<span class="${cls}">${dateStr}<br><span style="font-size:10.5px;">${escapeHtml(info.text)}</span></span>`;
}

function emptyLine() {
  return { lineId: 'L' + Math.random().toString(36).slice(2, 9), itemId: '', brand: '', modelNo: '',
    description: '', qty: 1, uom: 'pc', unitCost: 0, costCurrency: 'PHP', costExchangeRate: 1,
    markupPercent: 0, unitPrice: 0, discountPercent: 0, vatRate: 12, supplierId: '',
    supplierQuoteRef: '', leadTime: '', remarks: '', optionGroup: '' };
}

/** Reference rate to convert an amount FROM fromCur TO toCur, using PHP as the anchor currency.
 *  Falls back to 1 (with the caller responsible for warning) for currency pairs with no rate on file. */
function referenceRate(fromCur, toCur, settings) {
  if (!fromCur || !toCur || fromCur === toCur) return 1;
  const rates = (settings && settings.referenceRates) || { USD: 58, EUR: 62 };
  if (toCur === 'PHP') return rates[fromCur] || 1;
  if (fromCur === 'PHP') return rates[toCur] ? r2(1 / rates[toCur]) : 1;
  // Cross pair (e.g. USD -> EUR): convert via PHP as an intermediate step.
  const toPHP = rates[fromCur] || 1;
  const phpToTarget = rates[toCur] ? 1 / rates[toCur] : 1;
  return r2(toPHP * phpToTarget);
}

/** Selling price/VAT stay entirely in the quotation's own currency (that's what the customer
 *  sees). Cost is the only value that may be in a different currency (e.g. a USD-priced pump
 *  quoted to a PHP customer) — costExchangeRate converts unitCost INTO the quotation's currency
 *  before it's used for the internal gross-profit calculation. quoteCurrency is optional for
 *  backward compatibility with line items saved before this field existed (treated as already
 *  matching, i.e. rate 1 — unchanged behavior for old records). */
function computeLine(l, quoteCurrency) {
  const qty = Number(l.qty) || 0, price = Number(l.unitPrice) || 0, cost = Number(l.unitCost) || 0;
  const base = r2(qty * price);
  const discAmt = r2(base * (Number(l.discountPercent) || 0) / 100);
  const net = r2(base - discAmt);
  const vatAmt = r2(net * (Number(l.vatRate) || 0) / 100);
  const costCcy = l.costCurrency || quoteCurrency || 'PHP';
  const needsConversion = quoteCurrency && costCcy !== quoteCurrency;
  const costInQuoteCurrency = needsConversion ? r2(cost * (Number(l.costExchangeRate) || 1)) : cost;
  const costTotal = r2(qty * costInQuoteCurrency);
  return { base, discAmt, net, vatAmt, costTotal, lineTotal: r2(net + vatAmt) };
}

/* ============================================================
   OPTION GROUPS — a quotation can present alternative choices the
   customer will pick ONE of (e.g. "208L Drum" vs "20L Pail" of the
   same product). Any line can be tagged with a free-text Option
   label; lines with no tag are treated as common/always-included.
   When 2+ distinct tags are in use, totals are computed SEPARATELY
   per option (each = common lines + that option's lines) instead of
   summed together, which would misrepresent the quotation — the
   customer is choosing one, not buying every option at once.
   When only one (or zero) tags are in use, this collapses back to
   the exact same single-total behavior as before — fully backward
   compatible with every quotation saved before this feature existed.
   ============================================================ */
function computeQuotationTotals(q) {
  const lines = q.lines || [];
  const optionValues = [...new Set(lines.map(l => (l.optionGroup || '').trim()).filter(Boolean))];
  const isMultiOption = optionValues.length >= 2;

  function computeForLineSet(lineSet) {
    let subtotal = 0, vatTotal = 0, costTotal = 0;
    lineSet.forEach(l => {
      const c = computeLine(l, q.currency);
      subtotal = r2(subtotal + c.net);
      vatTotal = r2(vatTotal + c.vatAmt);
      costTotal = r2(costTotal + c.costTotal);
    });
    const overallDiscAmt = r2(subtotal * (Number(q.overallDiscountPercent) || 0) / 100);
    const netSubtotal = r2(subtotal - overallDiscAmt);
    const freight = r2(Number(q.freightCharge) || 0);
    const other = r2(Number(q.otherCharges) || 0);
    const grandTotal = r2(netSubtotal + vatTotal + freight + other);
    const grossProfit = r2(netSubtotal - costTotal);
    const grossMarginPercent = netSubtotal ? r2((grossProfit / netSubtotal) * 100) : 0;
    return { subtotal, overallDiscAmt, netSubtotal, vatTotal, freight, other, grandTotal, costTotal, grossProfit, grossMarginPercent };
  }

  if (!isMultiOption) {
    return Object.assign({ isMultiOption: false, optionTotals: null }, computeForLineSet(lines));
  }

  // Freight/Other/Overall Discount are header-level, not per-line — the practical assumption is
  // that they apply the same way regardless of which option the customer picks (e.g. freight cost
  // doesn't change based on which drum size they choose), so each option's total includes them.
  const commonLines = lines.filter(l => !(l.optionGroup || '').trim());
  const optionTotals = optionValues.map(g => {
    const groupLines = lines.filter(l => (l.optionGroup || '').trim() === g);
    const totals = computeForLineSet(commonLines.concat(groupLines));
    return Object.assign({ group: g, label: g, lineIds: groupLines.map(l => l.lineId) }, totals);
  });

  // Top-level fields mirror the FIRST option (by line order) — used wherever the rest of the
  // app needs a single number (list "Total" column, dashboard/report sums, customer's total
  // quoted value). This is a documented convention, not a real combined total.
  const primary = optionTotals[0];
  return Object.assign({ isMultiOption: true, optionTotals, commonLineIds: commonLines.map(l => l.lineId) }, primary);
}

/* ---------- LIST ---------- */

Router.route('/quotations', async () => {
  Router.setBreadcrumb([{ label: 'Quotations' }]);
  const all = (await DB.dbGetAll('quotations')).filter(q => q.isLatest);
  const customers = await DB.dbGetAll('customers');
  const custMap = Object.fromEntries(customers.map(c => [c.id, c]));
  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="page-head">
      <h1>Quotations</h1>
      <div class="page-actions">
        <input type="search" id="listSearch" placeholder="Search quotation #, RFQ ref, project, end-user, customer..." class="search-box">
        <select id="statusFilter"><option value="">All Statuses</option>${QUOTE_STATUSES.map(s => `<option>${s}</option>`).join('')}</select>
        <select id="expiryFilter">
          <option value="">All Validity</option>
          <option value="active">Active</option>
          <option value="soon">Expiring Soon</option>
          <option value="today">Expires Today</option>
          <option value="expired">Past Due</option>
          <option value="extended">Extended</option>
        </select>
        <button class="btn-amber" id="btnNew">+ New Quotation</button>
      </div>
    </div>
    <div class="card">
      <table class="data-table">
        <thead><tr><th>Quotation #</th><th>Customer</th><th>RFQ Ref</th><th>Project</th><th>Date</th><th>Valid Until</th><th>Rev</th><th>Status</th><th>Total</th></tr></thead>
        <tbody id="qBody"></tbody>
      </table>
      <div class="empty-inline" id="emptyMsg" style="display:none;">No quotations yet. Click "New Quotation" to create one.</div>
    </div>
  `;
  document.getElementById('btnNew').onclick = () => Router.navigate('/quotations/new');

  function draw(rows) {
    const body = document.getElementById('qBody');
    body.innerHTML = rows.map(q => {
      const info = getExpiryInfo(q);
      return `
      <tr class="clickable-row" data-hash="/quotations/${q.id}">
        <td>${escapeHtml(q.quotationNo)}</td>
        <td>${escapeHtml(custMap[q.customerId]?.companyName || q.customerSnapshot?.companyName || '—')}</td>
        <td>${escapeHtml(q.rfqRef || '—')}</td>
        <td>${escapeHtml(q.projectName || '—')}</td>
        <td>${formatDate(q.date)}</td>
        <td>${validityCellHTML(q)}</td>
        <td>Rev ${padRev(q.revision)}</td>
        <td>${statusBadge(q.status)}${info.badgeText ? ' ' + statusBadge(info.badgeText) : ''}</td>
        <td>${formatMoney(q.grandTotal, q.currency)}${q.isMultiOption ? ` <span class="muted-text">(${escapeHtml(q.optionTotals?.[0]?.label || 'Option 1')})</span>` : ''}</td>
      </tr>`;
    }).join('');
    document.getElementById('emptyMsg').style.display = rows.length ? 'none' : 'block';
  }
  draw(all);

  const applyFilters = () => {
    const q = document.getElementById('listSearch').value.trim().toLowerCase();
    const st = document.getElementById('statusFilter').value;
    const ex = document.getElementById('expiryFilter').value;
    let rows = all;
    if (st) rows = rows.filter(r => r.status === st);
    if (ex === 'extended') rows = rows.filter(r => r.validityHistory && r.validityHistory.length > 0);
    else if (ex) rows = rows.filter(r => getExpiryInfo(r).state === ex);
    if (q) rows = rows.filter(r => [r.quotationNo, r.rfqRef, r.projectName, r.endUser, custMap[r.customerId]?.companyName].join(' ').toLowerCase().includes(q));
    draw(rows);
  };
  document.getElementById('listSearch').addEventListener('input', debounce(applyFilters, 200));
  document.getElementById('statusFilter').addEventListener('change', applyFilters);
  document.getElementById('expiryFilter').addEventListener('change', applyFilters);
});

/* ---------- FORM (new / edit) ---------- */

Router.route('/quotations/new', () => renderQuoteForm(null));
Router.route('/quotations/:id/edit', (p) => renderQuoteForm(p.id));

async function renderQuoteForm(id) {
  const isEdit = !!id;
  const record = isEdit ? await DB.dbGet('quotations', Number(id)) : null;
  if (isEdit && !record.isLatest) { toast('Only the latest revision can be edited.', 'err'); return Router.navigate(`/quotations/${id}`); }

  const [customers, products, suppliers, settings] = await Promise.all([
    DB.dbGetAll('customers'), DB.dbGetAll('products'), DB.dbGetAll('suppliers'), DB.getSettings()
  ]);

  const q = record ? JSON.parse(JSON.stringify(record)) : {
    date: todayISO(), validUntil: addDaysISO(todayISO(), settings.defaultQuotationValidityDays),
    salesperson: settings.userName, currency: 'PHP',
    paymentTerms: settings.defaultPaymentTerms, incoterms: settings.defaultIncoterms,
    deliveryLeadTime: '', warranty: settings.defaultWarranty, vatMode: 'Standard12',
    overallDiscountPercent: 0, freightCharge: 0, otherCharges: 0,
    internalNotes: '', customerNotes: '', lines: [emptyLine()]
  };

  Router.setBreadcrumb([{ label: 'Quotations', hash: '/quotations' }, { label: isEdit ? q.quotationNo : 'New Quotation' }]);

  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="page-head"><h1>${isEdit ? 'Edit Quotation ' + escapeHtml(q.quotationNo) + ' (Rev ' + padRev(q.revision) + ')' : 'New Quotation'}</h1></div>
    <form class="card form-card" id="qForm">
      <div class="form-grid">
        <div class="field"><label>Customer *</label>
          <select id="f_customerId" required>
            <option value="">— Select customer —</option>
            ${customers.filter(c => !c.archived).map(c => `<option value="${c.id}" ${c.id === q.customerId ? 'selected' : ''}>${escapeHtml(c.companyName)}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>RFQ / Inquiry Reference</label><input id="f_rfqRef" value="${escapeHtml(q.rfqRef || '')}"></div>
        <div class="field"><label>Project Name</label><input id="f_projectName" value="${escapeHtml(q.projectName || '')}"></div>
        <div class="field"><label>End-User (optional)</label><input id="f_endUser" value="${escapeHtml(q.endUser || '')}"></div>
        <div class="field"><label>Salesperson</label><input id="f_salesperson" value="${escapeHtml(q.salesperson || '')}"></div>
        <div class="field"><label>Quotation Date</label><input type="date" id="f_date" value="${q.date || ''}"></div>
        <div class="field"><label>Valid Until</label><input type="date" id="f_validUntil" value="${q.validUntil || ''}"></div>
        <div class="field"><label>Payment Terms</label><input id="f_paymentTerms" value="${escapeHtml(q.paymentTerms || '')}"></div>
        <div class="field"><label>Incoterms</label><input id="f_incoterms" value="${escapeHtml(q.incoterms || '')}"></div>
        <div class="field"><label>Delivery Lead Time</label><input id="f_deliveryLeadTime" value="${escapeHtml(q.deliveryLeadTime || '')}"></div>
        <div class="field"><label>Warranty</label><input id="f_warranty" value="${escapeHtml(q.warranty || '')}"></div>
        <div class="field"><label>VAT Mode</label>
          <select id="f_vatMode">
            <option value="Standard12" ${q.vatMode === 'Standard12' ? 'selected' : ''}>Standard 12%</option>
            <option value="ZeroRated" ${q.vatMode === 'ZeroRated' ? 'selected' : ''}>Zero-Rated</option>
            <option value="Exempt" ${q.vatMode === 'Exempt' ? 'selected' : ''}>VAT Exempt</option>
          </select>
        </div>
      </div>

      <h3 class="section-title">Line Items</h3>
      <div style="overflow-x:auto; max-width:100%;">
      <table class="data-table items-table" id="linesTable">
        <thead><tr>
          <th style="width:26px;">#</th><th>Catalog</th><th>Brand</th><th>Model/Part No.</th><th>Description *</th>
          <th>Option</th>
          <th>Qty</th><th>UOM</th><th class="internal-only-col">Unit Cost</th><th class="internal-only-col">Cost Ccy</th><th class="internal-only-col">Rate→<span id="rateArrowCcy"></span></th><th class="internal-only-col">Markup %</th><th>Unit Price</th><th>Disc %</th><th>VAT %</th>
          <th class="internal-only-col">Supplier</th><th>Amount</th><th class="internal-only-col">Amount w/ VAT</th><th></th>
        </tr></thead>
        <tbody id="linesBody"></tbody>
      </table>
      </div>
      <datalist id="optionSuggestions"><option value="Option 1"><option value="Option 2"><option value="Option 3"></datalist>
      <button type="button" class="btn-line btn-sm" id="btnAddLine">+ Add Line Item</button>
      <p class="muted-text" style="margin-top:6px;">Tag lines with the same <b>Option</b> label (e.g. "Option 1") when the customer must choose ONE alternative — the system will then total each option separately instead of adding them together. Leave blank for items that apply to every option (e.g. shared freight).</p>

      <div class="totals-panel">
        <div class="field"><label>Overall Discount %</label><input type="number" step="0.01" id="f_overallDiscountPercent" value="${q.overallDiscountPercent || 0}"></div>
        <div class="field"><label>Freight / Shipping Charge</label><input type="number" step="0.01" id="f_freightCharge" value="${q.freightCharge || 0}"></div>
        <div class="field"><label>Other Charges</label><input type="number" step="0.01" id="f_otherCharges" value="${q.otherCharges || 0}"></div>
      </div>

      <div class="totals" id="totalsBox"></div>

      <div class="form-grid" style="margin-top:10px;">
        <div class="field field-wide"><label>Internal Notes (not printed)</label><textarea id="f_internalNotes">${escapeHtml(q.internalNotes || '')}</textarea></div>
        <div class="field field-wide"><label>Customer-Facing Notes (printed)</label><textarea id="f_customerNotes">${escapeHtml(q.customerNotes || '')}</textarea></div>
      </div>

      <div class="form-actions">
        <button type="submit" class="btn-amber">Save Quotation</button>
        <button type="button" class="btn-line" id="btnCancel">Cancel</button>
      </div>
    </form>
  `;

  let lines = q.lines && q.lines.length ? q.lines : [emptyLine()];

  function supplierOptions(selectedId) {
    return `<option value="">—</option>` + suppliers.filter(s => !s.archived).map(s =>
      `<option value="${s.id}" ${String(s.id) === String(selectedId) ? 'selected' : ''}>${escapeHtml(s.companyName).slice(0, 25)}</option>`).join('');
  }

  function currentCurrency() { return 'PHP'; } // this business always quotes customers in PHP

  /** The cost figure a line's markup should be calculated against — always converted
      into PHP first, since a foreign-currency cost (e.g. USD 850) must never be used
      directly against a PHP selling price. This was the source of the "negative gross
      profit" bug: markup was previously applied to the raw foreign-currency cost. */
  function costInQuoteCurrency(line, qCur) {
    const costCcy = line.costCurrency || qCur;
    const rate = costCcy === qCur ? 1 : (Number(line.costExchangeRate) || 1);
    return (Number(line.unitCost) || 0) * rate;
  }

  function drawLines() {
    const body = document.getElementById('linesBody');
    const qCur = currentCurrency();
    const arrowLabel = document.getElementById('rateArrowCcy');
    if (arrowLabel) arrowLabel.textContent = qCur;
    body.innerHTML = lines.map((l, i) => {
      const c = computeLine(l, qCur);
      const diffCurrency = (l.costCurrency || qCur) !== qCur;
      return `
      <tr data-lid="${l.lineId}">
        <td>${i + 1}</td>
        <td><button type="button" class="item-picker-trigger ln-catalog-btn">${l.itemId ? escapeHtml(products.find(p => String(p.id) === String(l.itemId))?.itemNo || '(item removed)') : '+ Select Item'}</button></td>
        <td><input class="ln-brand" value="${escapeHtml(l.brand)}" style="width:70px;"></td>
        <td><input class="ln-model" value="${escapeHtml(l.modelNo)}" style="width:90px;"></td>
        <td><textarea class="ln-desc" rows="1" style="width:160px;">${escapeHtml(l.description)}</textarea></td>
        <td><input class="ln-option" list="optionSuggestions" value="${escapeHtml(l.optionGroup || '')}" placeholder="e.g. Option 1" style="width:85px;"></td>
        <td><input class="ln-qty" type="number" min="0" step="any" value="${l.qty}" style="width:55px;"></td>
        <td><input class="ln-uom" value="${escapeHtml(l.uom)}" style="width:45px;"></td>
        <td class="internal-only-col"><input class="ln-cost" type="number" min="0" step="0.01" value="${l.unitCost}" style="width:75px;"></td>
        <td class="internal-only-col"><select class="ln-costccy" style="width:62px;">${currencyList(settings).map(c2 => `<option ${c2 === (l.costCurrency || qCur) ? 'selected' : ''}>${c2}</option>`).join('')}</select></td>
        <td class="internal-only-col"><input class="ln-rate" type="number" step="0.0001" min="0" value="${l.costExchangeRate ?? 1}" style="width:60px;" ${diffCurrency ? '' : 'disabled title="Only used when Cost Currency differs from the quotation currency"'}></td>
        <td class="internal-only-col"><input class="ln-markup" type="number" step="0.01" value="${l.markupPercent}" style="width:60px;"></td>
        <td><input class="ln-price" type="number" min="0" step="0.01" value="${l.unitPrice}" style="width:80px;"></td>
        <td><input class="ln-disc" type="number" step="0.01" value="${l.discountPercent}" style="width:55px;"></td>
        <td><input class="ln-vat" type="number" step="0.01" value="${l.vatRate}" style="width:50px;"></td>
        <td class="internal-only-col"><select class="ln-supplier" style="min-width:100px;">${supplierOptions(l.supplierId)}</select></td>
        <td class="ln-amount" style="text-align:right;font-family:var(--mono);white-space:nowrap;">${formatMoney(c.net, qCur)}</td>
        <td class="internal-only-col ln-amount-vat" style="text-align:right;font-family:var(--mono);white-space:nowrap;">${formatMoney(c.lineTotal, qCur)}</td>
        <td class="row-del" data-del="${l.lineId}">✕</td>
      </tr>`;
    }).join('');

    body.querySelectorAll('tr').forEach(tr => {
      const lid = tr.dataset.lid;
      const line = lines.find(x => x.lineId === lid);
      const bind = (sel, field, isNum) => {
        const el = tr.querySelector(sel);
        el.addEventListener('input', () => {
          line[field] = isNum ? (Number(el.value) || 0) : el.value;
          if (sel === '.ln-cost' || sel === '.ln-markup' || sel === '.ln-rate') {
            // Keep selling price following cost+markup until the user directly
            // overrides the Unit Price field itself (that input sets unitPrice
            // straight through and isn't touched here). Markup is always applied
            // to the PHP-converted cost, never the raw foreign-currency cost.
            line.unitPrice = r2(costInQuoteCurrency(line, currentCurrency()) * (1 + (Number(line.markupPercent) || 0) / 100));
            tr.querySelector('.ln-price').value = line.unitPrice;
          }
          const c2 = computeLine(line, currentCurrency());
          tr.querySelector('.ln-amount').textContent = formatMoney(c2.net, currentCurrency());
          tr.querySelector('.ln-amount-vat').textContent = formatMoney(c2.lineTotal, currentCurrency());
          refreshTotals();
          markDirty();
        });
      };
      bind('.ln-brand', 'brand'); bind('.ln-model', 'modelNo'); bind('.ln-desc', 'description');
      bind('.ln-option', 'optionGroup');
      bind('.ln-qty', 'qty', true); bind('.ln-uom', 'uom'); bind('.ln-cost', 'unitCost', true);
      bind('.ln-markup', 'markupPercent', true); bind('.ln-price', 'unitPrice', true);
      bind('.ln-disc', 'discountPercent', true); bind('.ln-vat', 'vatRate', true);
      bind('.ln-rate', 'costExchangeRate', true);

      tr.querySelector('.ln-costccy').addEventListener('change', (e) => {
        line.costCurrency = e.target.value;
        // Pre-fill a sensible starting rate from Settings' reference rates; still fully editable per line.
        line.costExchangeRate = referenceRate(line.costCurrency, currentCurrency(), settings);
        line.unitPrice = r2(costInQuoteCurrency(line, currentCurrency()) * (1 + (Number(line.markupPercent) || 0) / 100));
        drawLines(); refreshTotals(); markDirty();
      });
      tr.querySelector('.ln-supplier').addEventListener('change', (e) => { line.supplierId = e.target.value; markDirty(); });
      tr.querySelector('.ln-catalog-btn').addEventListener('click', () => {
        openItemPicker(
          products.filter(p => !p.archived),
          {
            title: 'Select Item from Catalog',
            getLabel: (p) => `${p.itemNo} — ${p.description || ''}`,
            getSubLabel: (p) => [p.brand, p.modelNo].filter(Boolean).join(' · '),
            getSearchText: (p) => [p.itemNo, p.description, p.brand, p.modelNo].filter(Boolean).join(' ')
          },
          (p) => {
            line.itemId = p.id;
            line.brand = p.brand || ''; line.modelNo = p.modelNo || ''; line.description = p.description || '';
            line.unitCost = p.standardCost || 0; line.unitPrice = p.standardPrice || 0; line.uom = p.uom || 'pc';
            line.supplierId = p.defaultSupplierId || '';
            line.costCurrency = p.currency || currentCurrency();
            line.costExchangeRate = referenceRate(line.costCurrency, currentCurrency(), settings);
            const headerVat = document.getElementById('f_vatMode').value;
            if (p.vatClass === 'Zero-Rated' || p.vatClass === 'VAT Exempt' || headerVat !== 'Standard12') line.vatRate = 0;
            else line.vatRate = 12;
            drawLines(); refreshTotals(); markDirty();
          }
        );
      });
      tr.querySelector('[data-del]').addEventListener('click', () => {
        if (lines.length === 1) { toast('A quotation needs at least one line item.', 'err'); return; }
        lines = lines.filter(x => x.lineId !== lid);
        drawLines(); refreshTotals(); markDirty();
      });
    });
  }

  function currentHeaderValues() {
    return {
      currency: currentCurrency(),
      overallDiscountPercent: Number(document.getElementById('f_overallDiscountPercent').value) || 0,
      freightCharge: Number(document.getElementById('f_freightCharge').value) || 0,
      otherCharges: Number(document.getElementById('f_otherCharges').value) || 0,
      lines
    };
  }

  function refreshTotals() {
    const cur = currentCurrency();
    const t = computeQuotationTotals(currentHeaderValues());
    if (!t.isMultiOption) {
      document.getElementById('totalsBox').innerHTML = `
        <div class="line"><span>Subtotal</span><span>${formatMoney(t.subtotal, cur)}</span></div>
        <div class="line"><span>Overall Discount</span><span>-${formatMoney(t.overallDiscAmt, cur)}</span></div>
        <div class="line"><span>VAT</span><span>${formatMoney(t.vatTotal, cur)}</span></div>
        <div class="line"><span>Freight</span><span>${formatMoney(t.freight, cur)}</span></div>
        <div class="line"><span>Other Charges</span><span>${formatMoney(t.other, cur)}</span></div>
        <div class="line grand"><span>Grand Total</span><span>${formatMoney(t.grandTotal, cur)}</span></div>
        <div class="line internal-only"><span>Est. Gross Profit (internal)</span><span>${formatMoney(t.grossProfit, cur)} (${t.grossMarginPercent}%)</span></div>
      `;
      return;
    }
    document.getElementById('totalsBox').innerHTML = `
      <div class="callout-info callout" style="margin-bottom:10px;">This quotation has ${t.optionTotals.length} alternative Options — each is totaled separately below since the customer will choose only one, rather than being added together.</div>
      ${t.optionTotals.map(o => `
        <div style="border:1px solid var(--line); border-radius:6px; padding:10px 14px; margin-bottom:10px;">
          <div style="font-weight:700; margin-bottom:6px;">${escapeHtml(o.label)}</div>
          <div class="line"><span>Subtotal</span><span>${formatMoney(o.subtotal, cur)}</span></div>
          <div class="line"><span>Overall Discount</span><span>-${formatMoney(o.overallDiscAmt, cur)}</span></div>
          <div class="line"><span>VAT</span><span>${formatMoney(o.vatTotal, cur)}</span></div>
          <div class="line"><span>Freight</span><span>${formatMoney(o.freight, cur)}</span></div>
          <div class="line"><span>Other Charges</span><span>${formatMoney(o.other, cur)}</span></div>
          <div class="line grand"><span>${escapeHtml(o.label)} Total</span><span>${formatMoney(o.grandTotal, cur)}</span></div>
          <div class="line internal-only"><span>Est. Gross Profit (internal)</span><span>${formatMoney(o.grossProfit, cur)} (${o.grossMarginPercent}%)</span></div>
        </div>
      `).join('')}
    `;
  }

  drawLines(); refreshTotals();

  document.getElementById('btnAddLine').onclick = () => { lines.push(emptyLine()); drawLines(); refreshTotals(); markDirty(); };
  content.querySelectorAll('#qForm input, #qForm select, #qForm textarea').forEach(i => i.addEventListener('input', () => { markDirty(); refreshTotals(); }));

  // When a customer is picked, pull their own stored Payment Terms / Incoterms / Salesperson
  // in automatically — falling back to the company-wide Settings defaults only when the
  // customer's own record doesn't have that field filled in.
  document.getElementById('f_customerId').addEventListener('change', (e) => {
    const selectedCustomer = customers.find(c => c.id === Number(e.target.value));
    if (!selectedCustomer) return;
    const paymentTermsEl = document.getElementById('f_paymentTerms');
    const incotermsEl = document.getElementById('f_incoterms');
    const salespersonEl = document.getElementById('f_salesperson');
    paymentTermsEl.value = selectedCustomer.paymentTerms || settings.defaultPaymentTerms;
    incotermsEl.value = selectedCustomer.incoterms || settings.defaultIncoterms;
    if (selectedCustomer.salesperson) salespersonEl.value = selectedCustomer.salesperson;
    markDirty(); refreshTotals();
    toast(`Applied ${selectedCustomer.companyName}'s saved payment terms and Incoterms.`);
  });
  document.getElementById('btnCancel').onclick = () => {
    if (!guardNavigation()) return; clearDirty();
    Router.navigate(isEdit ? `/quotations/${id}` : '/quotations');
  };

  document.getElementById('qForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn.disabled) return; // guards against a double-click firing this handler twice
    submitBtn.disabled = true;
    try {
    const customerId = Number(document.getElementById('f_customerId').value);
    if (!customerId) { toast('Please select a customer.', 'err'); return; }
    if (!lines.every(l => l.description && Number(l.qty) > 0)) { toast('Every line needs a description and quantity greater than 0.', 'err'); return; }

    const customer = customers.find(c => c.id === customerId);
    const header = {
      customerId,
      customerSnapshot: { companyName: customer.companyName, address: customer.billingAddress, contactPerson: customer.contactPerson, email: customer.email, tin: customer.tin },
      rfqRef: document.getElementById('f_rfqRef').value,
      projectName: document.getElementById('f_projectName').value,
      endUser: document.getElementById('f_endUser').value,
      salesperson: document.getElementById('f_salesperson').value,
      date: document.getElementById('f_date').value,
      validUntil: document.getElementById('f_validUntil').value,
      currency: 'PHP',
      paymentTerms: document.getElementById('f_paymentTerms').value,
      incoterms: document.getElementById('f_incoterms').value,
      deliveryLeadTime: document.getElementById('f_deliveryLeadTime').value,
      warranty: document.getElementById('f_warranty').value,
      vatMode: document.getElementById('f_vatMode').value,
      overallDiscountPercent: Number(document.getElementById('f_overallDiscountPercent').value) || 0,
      freightCharge: Number(document.getElementById('f_freightCharge').value) || 0,
      otherCharges: Number(document.getElementById('f_otherCharges').value) || 0,
      internalNotes: document.getElementById('f_internalNotes').value,
      customerNotes: document.getElementById('f_customerNotes').value,
      lines
    };
    const totals = computeQuotationTotals(header);
    Object.assign(header, totals);

    const now = new Date().toISOString();
    const settings2 = await DB.getSettings();

    if (isEdit) {
      const updated = Object.assign({}, q, header, { updatedAt: now, modifiedBy: settings2.userName });
      await DB.dbPut('quotations', updated);
      await DB.logActivity(`Updated quotation ${updated.quotationNo} (Rev ${padRev(updated.revision)})`);
      toast('Quotation saved.');
      clearDirty();
      Router.navigate(`/quotations/${updated.id}`);
    } else {
      const quotationNo = await DB.nextDocNumber('quotation');
      const newRec = Object.assign({}, header, {
        quotationNo, revision: 0, isLatest: true, status: 'Draft',
        statusHistory: [{ status: 'Draft', date: now }],
        createdAt: now, updatedAt: now, createdBy: settings2.userName, modifiedBy: settings2.userName
      });
      const newId = await DB.dbAdd('quotations', newRec);
      newRec.id = newId; // dbAdd doesn't mutate the object we passed in — this line was missing,
      newRec.familyId = newId; // which meant the dbPut below created a SECOND record instead of updating this one
      await DB.dbPut('quotations', newRec);
      await DB.logActivity(`Created quotation ${quotationNo} for ${customer.companyName}`);
      toast('Quotation created.');
      clearDirty();
      Router.navigate(`/quotations/${newId}`);
    }
    } finally {
      submitBtn.disabled = false;
    }
  });
}

/* ---------- DETAIL ---------- */

Router.route('/quotations/:id', (p) => renderQuoteDetail(p.id));

async function renderQuoteDetail(id) {
  const q = await DB.dbGet('quotations', Number(id));
  const content = document.getElementById('content');
  if (!q) { content.innerHTML = `<div class="empty-state"><h3>Quotation not found</h3></div>`; return; }

  const [customer, family, customerPOs, suppliers] = await Promise.all([
    DB.dbGet('customers', q.customerId),
    DB.dbQueryIndex('quotations', 'familyId', q.familyId),
    DB.dbQueryIndex('customerPOs', 'quotationId', q.id),
    DB.dbGetAll('suppliers')
  ]);
  const supMap = Object.fromEntries(suppliers.map(s => [s.id, s]));
  const vatModeLabel = { Standard12: 'Standard 12%', ZeroRated: 'Zero-Rated', Exempt: 'VAT Exempt' }[q.vatMode] || (q.vatMode || '—');

  Router.setBreadcrumb([{ label: 'Quotations', hash: '/quotations' }, { label: `${q.quotationNo} (Rev ${padRev(q.revision)})` }]);

  const revisionsHTML = family.length > 1 ? `
    <div class="card related-card">
      <h3>Revision History</h3>
      <table class="data-table compact"><thead><tr><th>Rev</th><th>Date</th><th>Status</th><th>Total</th></tr></thead>
      <tbody>
        ${family.sort((a, b) => a.revision - b.revision).map(r => `
          <tr class="clickable-row ${r.id === q.id ? 'current-row' : ''}" data-hash="/quotations/${r.id}">
            <td>Rev ${padRev(r.revision)}${r.isLatest ? ' (latest)' : ''}</td><td>${formatDate(r.date)}</td>
            <td>${statusBadge(r.status)}</td><td>${formatMoney(r.grandTotal, r.currency)}</td>
          </tr>`).join('')}
      </tbody></table>
    </div>` : '';

  const canEditInPlace = q.isLatest && q.status === 'Draft';
  const orphanWarning = (customerPOs.length > 0 && q.status !== 'Won')
    ? `<div class="card warning-card">⚠ This quotation's status is currently <b>${escapeHtml(q.status)}</b>, but Customer PO
        ${customerPOs.map(p => `<a href="#/customer-pos/${p.id}"><b>${escapeHtml(p.poNo)}</b></a>`).join(', ')}
        was already recorded against it earlier. Double-check this is intentional — the PO record itself was not changed.</div>`
    : '';

  const expiryInfo = getExpiryInfo(q);
  const expiredWarningHTML = expiryInfo.state === 'expired' ? `
    <div class="card warning-card">
      ⚠ <b>This quotation has expired</b> (${escapeHtml(expiryInfo.text)}). Please verify supplier pricing, availability,
      freight, exchange rate, and lead time before extending or revising it.
      <div class="btn-row" style="margin-top:10px;"><button class="btn-line btn-sm" id="btnExtendValidity">Extend Validity</button>
      ${q.isLatest ? `<span class="muted-text" style="align-self:center;">— or use "New Revision" above to create an updated version instead.</span>` : ''}</div>
    </div>` : '';
  const expiringSoonHTML = (expiryInfo.state === 'today' || expiryInfo.state === 'soon') ? `
    <div class="card callout-info callout">
      ${expiryInfo.state === 'today' ? '⏰' : '⚠'} <b>${escapeHtml(expiryInfo.badgeText)}</b> — ${escapeHtml(expiryInfo.text)}.
      <button class="btn-line btn-sm" id="btnExtendValidity" style="margin-left:8px;">Extend Validity</button>
    </div>` : '';

  const validityHistoryHTML = (q.validityHistory && q.validityHistory.length > 0) ? `
    <div class="card related-card">
      <h3>Validity Extension History <span class="count-pill">${q.validityHistory.length}</span></h3>
      <table class="data-table compact"><thead><tr><th>Date/Time</th><th>Old Date</th><th>New Date</th><th>By</th><th>Note</th></tr></thead>
      <tbody>
        ${q.validityHistory.slice().reverse().map(h => `<tr><td>${formatDate(h.at)}</td><td>${formatDate(h.oldDate)}</td><td>${formatDate(h.newDate)}</td><td>${escapeHtml(h.by || '—')}</td><td>${escapeHtml(h.note || '—')}</td></tr>`).join('')}
      </tbody></table>
    </div>` : '';

  const lineRowHTML = (l, i) => {
    const c = computeLine(l, q.currency);
    const lineMarginPct = c.net > 0 ? r2((c.net - c.costTotal) / c.net * 100) : 0;
    const costDisplay = l.costCurrency && l.costCurrency !== q.currency
      ? `${formatMoney(l.unitCost, l.costCurrency)} <span class="muted-text">(→${formatMoney((Number(l.unitCost) || 0) * (Number(l.costExchangeRate) || 1), q.currency)})</span>`
      : formatMoney(l.unitCost, q.currency);
    return `<tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(l.brand ? l.brand + ' — ' : '')}${escapeHtml(l.modelNo ? l.modelNo + ' — ' : '')}${escapeHtml(l.description)}</td>
      <td>${l.qty} ${escapeHtml(l.uom)}</td>
      <td class="internal-only-col">${costDisplay}</td>
      <td class="internal-only-col">${escapeHtml(supMap[l.supplierId]?.companyName || '—')}</td>
      <td>${formatMoney(l.unitPrice, q.currency)}</td>
      <td>${l.discountPercent || 0}%</td>
      <td>${l.vatRate || 0}%</td>
      <td class="internal-only-col">${lineMarginPct}%</td>
      <td>${formatMoney(c.net, q.currency)}</td>
      <td class="internal-only-col">${formatMoney(c.lineTotal, q.currency)}</td>
    </tr>`;
  };
  const lineItemsHead = `<thead><tr><th>#</th><th>Description</th><th>Qty</th><th class="internal-only-col">Unit Cost</th><th class="internal-only-col">Supplier</th><th>Unit Price</th><th>Disc%</th><th>VAT%</th><th class="internal-only-col">Margin%</th><th>Amount</th><th class="internal-only-col">Amount w/ VAT</th></tr></thead>`;
  const totalsBlockHTML = (t, label) => `
    <div class="totals">
      ${label ? `<div style="font-weight:700; margin-bottom:6px;">${escapeHtml(label)}</div>` : ''}
      <div class="line"><span>Subtotal</span><span>${formatMoney(t.subtotal, q.currency)}</span></div>
      <div class="line"><span>Overall Discount (${q.overallDiscountPercent || 0}%)</span><span>−${formatMoney(t.overallDiscAmt, q.currency)}</span></div>
      <div class="line"><span>VAT</span><span>${formatMoney(t.vatTotal, q.currency)}</span></div>
      <div class="line"><span>Freight</span><span>${formatMoney(t.freight, q.currency)}</span></div>
      <div class="line"><span>Other</span><span>${formatMoney(t.other, q.currency)}</span></div>
      <div class="line grand"><span>${label ? escapeHtml(label) + ' Total' : 'Grand Total'}</span><span>${formatMoney(t.grandTotal, q.currency)}</span></div>
      <div class="line internal-only"><span>Total Cost (internal)</span><span>${formatMoney(t.costTotal, q.currency)}</span></div>
      <div class="line internal-only"><span>Est. Gross Profit (internal)</span><span>${formatMoney(t.grossProfit, q.currency)} (${t.grossMarginPercent}%)</span></div>
    </div>`;

  let lineItemsAndTotalsHTML;
  if (q.isMultiOption && q.optionTotals && q.optionTotals.length > 0) {
    const commonLines = (q.lines || []).filter(l => (q.commonLineIds || []).includes(l.lineId));
    lineItemsAndTotalsHTML = `
      <div class="callout-info callout">This quotation presents ${q.optionTotals.length} alternative Options for the customer to choose from — each is priced and totaled separately below, not combined.</div>
      ${commonLines.length > 0 ? `
        <h3 class="section-title" style="margin-top:14px;">Common Items (included with every option)</h3>
        <div style="overflow-x:auto; max-width:100%;"><table class="data-table compact">${lineItemsHead}<tbody>${commonLines.map((l, i) => lineRowHTML(l, i)).join('')}</tbody></table></div>` : ''}
      ${q.optionTotals.map(o => {
        const groupLines = (q.lines || []).filter(l => (o.lineIds || []).includes(l.lineId));
        return `
        <h3 class="section-title" style="margin-top:14px;">${escapeHtml(o.label)}</h3>
        <div style="overflow-x:auto; max-width:100%;"><table class="data-table compact">${lineItemsHead}<tbody>${groupLines.map((l, i) => lineRowHTML(l, i)).join('')}</tbody></table></div>
        ${totalsBlockHTML(o, o.label)}`;
      }).join('')}
    `;
  } else {
    lineItemsAndTotalsHTML = `
      <div style="overflow-x:auto; max-width:100%;"><table class="data-table compact">${lineItemsHead}<tbody>${(q.lines || []).map((l, i) => lineRowHTML(l, i)).join('')}</tbody></table></div>
      ${totalsBlockHTML(q, null)}
    `;
  }

  content.innerHTML = `
    <div class="page-head">
      <div>
        <div class="doc-number-tag">${escapeHtml(q.quotationNo)} · Rev ${padRev(q.revision)}</div>
        <h1>${escapeHtml(customer?.companyName || q.customerSnapshot?.companyName || 'Unknown Customer')} ${statusBadge(q.status)}</h1>
      </div>
      <div class="page-actions">
        <button class="btn-line" id="btnPrint">Print</button>
        ${canEditInPlace ? `<button class="btn-line" id="btnEdit">Edit</button>` : ''}
        ${q.isLatest ? `<button class="btn-line" id="btnDuplicate">Duplicate</button>` : ''}
        ${q.isLatest ? `<button class="btn-line" id="btnRevise">New Revision</button>` : ''}
        <button class="btn-danger" id="btnDelete">Delete</button>
      </div>
    </div>

    ${!canEditInPlace && q.isLatest ? `<div class="card muted-text" style="padding:12px 20px;">This quotation has moved past Draft, so it's locked from direct editing to keep the sent/quoted version intact. Use <b>New Revision</b> to make changes.</div>` : ''}
    ${orphanWarning}
    ${expiredWarningHTML}
    ${expiringSoonHTML}
    <div id="extendValidityHost"></div>

    ${q.isLatest ? `
    <div class="card">
      <div class="status-actions">
        ${QUOTE_STATUSES.filter(s => s !== q.status).map(s => `<button class="btn-line btn-sm status-btn" data-status="${s}">Mark as ${s}</button>`).join('')}
      </div>
    </div>` : `<div class="card muted-text" style="padding:12px 20px;">This is a past revision — status changes are only made on the latest revision.</div>`}

    <div class="card">
      <div class="detail-grid">
        <div class="detail-item"><div class="detail-label">Customer</div><div class="detail-value">${customer ? `<a href="#/customers/${customer.id}">${escapeHtml(customer.companyName)}</a>` : escapeHtml(q.customerSnapshot?.companyName || '—')}</div></div>
        <div class="detail-item"><div class="detail-label">Date</div><div class="detail-value">${formatDate(q.date)}</div></div>
        <div class="detail-item"><div class="detail-label">Valid Until</div><div class="detail-value">${formatDate(q.validUntil) || 'No validity date set'}${expiryInfo.badgeText ? ' ' + statusBadge(expiryInfo.badgeText) : ''}${expiryInfo.state !== 'none' && expiryInfo.state !== 'closed' ? `<br><span class="muted-text">${escapeHtml(expiryInfo.text)}</span>` : ''}</div></div>
        <div class="detail-item"><div class="detail-label">RFQ Reference</div><div class="detail-value">${escapeHtml(q.rfqRef || '—')}</div></div>
        <div class="detail-item"><div class="detail-label">Project</div><div class="detail-value">${escapeHtml(q.projectName || '—')}</div></div>
        <div class="detail-item"><div class="detail-label">End-User</div><div class="detail-value">${escapeHtml(q.endUser || '—')}</div></div>
        <div class="detail-item"><div class="detail-label">Salesperson</div><div class="detail-value">${escapeHtml(q.salesperson || '—')}</div></div>
        <div class="detail-item"><div class="detail-label">Payment Terms</div><div class="detail-value">${escapeHtml(q.paymentTerms || '—')}</div></div>
        <div class="detail-item"><div class="detail-label">Incoterms</div><div class="detail-value">${escapeHtml(q.incoterms || '—')}</div></div>
        <div class="detail-item"><div class="detail-label">Delivery Lead Time</div><div class="detail-value">${escapeHtml(q.deliveryLeadTime || '—')}</div></div>
        <div class="detail-item"><div class="detail-label">Warranty</div><div class="detail-value">${escapeHtml(q.warranty || '—')}</div></div>
        <div class="detail-item"><div class="detail-label">VAT Mode</div><div class="detail-value">${escapeHtml(vatModeLabel)}</div></div>
        <div class="detail-item"><div class="detail-label">Overall Discount</div><div class="detail-value">${q.overallDiscountPercent || 0}%${q.overallDiscAmt ? ` (−${formatMoney(q.overallDiscAmt, q.currency)})` : ''}</div></div>
      </div>
    </div>

    ${(q.internalNotes || q.customerNotes) ? `
    <div class="card">
      <div class="detail-grid">
        ${q.internalNotes ? `<div class="detail-item internal-only"><div class="detail-label">Internal Notes (not printed)</div><div class="detail-value">${escapeHtml(q.internalNotes)}</div></div>` : ''}
        ${q.customerNotes ? `<div class="detail-item"><div class="detail-label">Customer-Facing Notes (printed)</div><div class="detail-value">${escapeHtml(q.customerNotes)}</div></div>` : ''}
      </div>
    </div>` : ''}

    <div class="card">
      <h3 class="section-title">Line Items</h3>
      ${lineItemsAndTotalsHTML}
    </div>

    ${revisionsHTML}
    ${validityHistoryHTML}
    ${relatedTable('Linked Customer POs', customerPOs, ['poNo', 'poDate', 'status', 'poAmount'], '/customer-pos', q.currency)}

    ${q.isLatest && q.status === 'Won' && customerPOs.length === 0 ? `<div class="card"><button class="btn-amber" id="btnRecordPO">Record Customer PO for this Quotation</button></div>` : ''}

    <div class="meta-strip">Created ${formatDate(q.createdAt)} by ${escapeHtml(q.createdBy || '—')} · Last modified ${formatDate(q.updatedAt)} by ${escapeHtml(q.modifiedBy || '—')}</div>
  `;

  const editBtn = document.getElementById('btnEdit'); if (editBtn) editBtn.onclick = () => Router.navigate(`/quotations/${q.id}/edit`);
  document.getElementById('btnPrint').onclick = () => Print.printQuotation(q, customer);
  const extendBtn = document.getElementById('btnExtendValidity');
  if (extendBtn) extendBtn.onclick = () => renderExtendValidityForm(q, id);

  const dupBtn = document.getElementById('btnDuplicate');
  if (dupBtn) dupBtn.onclick = async () => {
    if (dupBtn.disabled) return;
    dupBtn.disabled = true;
    const settings = await DB.getSettings();
    const quotationNo = await DB.nextDocNumber('quotation');
    const now = new Date().toISOString();
    const copy = Object.assign({}, q);
    delete copy.id;
    Object.assign(copy, {
      quotationNo, revision: 0, isLatest: true, status: 'Draft', statusHistory: [{ status: 'Draft', date: now }],
      date: todayISO(), createdAt: now, updatedAt: now, createdBy: settings.userName, modifiedBy: settings.userName,
      lines: q.lines.map(l => Object.assign({}, l, { lineId: 'L' + Math.random().toString(36).slice(2, 9) }))
    });
    const newId = await DB.dbAdd('quotations', copy);
    copy.id = newId; // same fix as above — must set this before the follow-up dbPut
    copy.familyId = newId; await DB.dbPut('quotations', copy);
    await DB.logActivity(`Duplicated quotation into ${quotationNo}`);
    toast('Quotation duplicated.');
    Router.navigate(`/quotations/${newId}/edit`);
  };

  const reviseBtn = document.getElementById('btnRevise');
  if (reviseBtn) reviseBtn.onclick = async () => {
    if (!confirm(`Create Revision ${padRev(q.revision + 1)} of ${q.quotationNo}? The current revision will be preserved as read-only history.`)) return;
    if (reviseBtn.disabled) return;
    reviseBtn.disabled = true;
    const settings = await DB.getSettings();
    const now = new Date().toISOString();
    q.isLatest = false; await DB.dbPut('quotations', q);
    const newRev = Object.assign({}, q);
    delete newRev.id;
    Object.assign(newRev, {
      revision: q.revision + 1, isLatest: true, status: 'Draft', statusHistory: [{ status: 'Draft', date: now }],
      createdAt: now, updatedAt: now, createdBy: settings.userName, modifiedBy: settings.userName,
      lines: q.lines.map(l => Object.assign({}, l))
    });
    const newId = await DB.dbAdd('quotations', newRev);
    await DB.logActivity(`Created Rev ${padRev(newRev.revision)} of ${newRev.quotationNo}`);
    toast('New revision created.');
    Router.navigate(`/quotations/${newId}/edit`);
  };

  const CONSEQUENTIAL_QUOTE_STATUSES = ['Won', 'Lost', 'Expired'];
  content.querySelectorAll('.status-btn').forEach(btn => {
    btn.onclick = async () => {
      const newStatus = btn.dataset.status;
      const movingIntoConsequential = CONSEQUENTIAL_QUOTE_STATUSES.includes(newStatus) && !CONSEQUENTIAL_QUOTE_STATUSES.includes(q.status);
      const movingAwayWithPO = customerPOs.length > 0 && q.status !== newStatus;
      if (newStatus === 'Won' && expiryInfo.state === 'expired') {
        if (!confirm(`This quotation expired ${escapeHtml(expiryInfo.text.replace('Expired ', '').replace(' ago', ''))} days ago. Before accepting it as Won, please verify supplier pricing, availability, freight, exchange rate, and lead time are still accurate. Continue anyway?`)) return;
      } else if (movingIntoConsequential) {
        const extra = newStatus === 'Won' ? ' This will also enable recording a Customer PO against it.' : '';
        if (!confirm(`Mark ${q.quotationNo} as ${newStatus}?${extra}`)) return;
      } else if (movingAwayWithPO) {
        if (!confirm(`Change status to ${newStatus}? Note: a Customer PO was already recorded against this quotation — that PO record will NOT be changed or removed.`)) return;
      }
      q.status = newStatus;
      q.statusHistory = (q.statusHistory || []).concat([{ status: newStatus, date: new Date().toISOString() }]);
      q.updatedAt = new Date().toISOString();
      await DB.dbPut('quotations', q);
      await DB.logActivity(`Quotation ${q.quotationNo} marked as ${newStatus}`);
      toast(`Marked as ${newStatus}.`);
      renderQuoteDetail(id);
    };
  });

  const recordPOBtn = document.getElementById('btnRecordPO');
  if (recordPOBtn) recordPOBtn.onclick = () => {
    if (expiryInfo.state === 'expired') {
      if (!confirm(`This quotation expired (${expiryInfo.text}). Please verify supplier pricing, availability, freight, exchange rate, and lead time before recording a Customer PO against it. Continue anyway?`)) return;
    }
    Router.navigate(`/customer-pos/new?quotationId=${q.id}`);
  };

  document.getElementById('btnDelete').onclick = async () => {
    const relatedCount = customerPOs.length;
    const warn = relatedCount > 0 ? `This quotation has ${relatedCount} linked Customer PO record(s). Deleting it will NOT delete those, but their link will show as missing. ` : '';
    if (!confirm(`${warn}Permanently delete quotation ${q.quotationNo} (Rev ${padRev(q.revision)})? This cannot be undone.`)) return;
    await DB.dbDelete('quotations', q.id);
    // If we just deleted the latest revision of a family that still has older revisions,
    // promote the next-highest one so the family doesn't silently vanish from the Quotations list.
    if (q.isLatest) {
      const siblings = family.filter(r => r.id !== q.id);
      if (siblings.length > 0) {
        const promote = siblings.sort((a, b) => b.revision - a.revision)[0];
        promote.isLatest = true;
        promote.updatedAt = new Date().toISOString();
        await DB.dbPut('quotations', promote);
        await DB.logActivity(`Rev ${padRev(promote.revision)} of ${promote.quotationNo} restored as latest after Rev ${padRev(q.revision)} was deleted`);
      }
    }
    await DB.logActivity(`Deleted quotation ${q.quotationNo} (Rev ${padRev(q.revision)})`);
    toast('Quotation deleted.');
    Router.navigate('/quotations');
  };
}

/* ---------- EXTEND VALIDITY ---------- */

const EXTEND_VALIDITY_CHECKLIST = ['Supplier price', 'Product availability', 'Freight and delivery cost', 'Exchange rate', 'Lead time', 'Payment and commercial terms'];

function renderExtendValidityForm(q, id) {
  const host = document.getElementById('extendValidityHost');
  host.innerHTML = `
    <div class="card">
      <h3 class="section-title">Extend Validity</h3>
      <p class="muted-text">Current Valid Until: <b>${formatDate(q.validUntil) || 'No validity date set'}</b>. This keeps the same quotation number and does not change pricing, availability, freight, exchange rate, or lead time — it only updates the validity date, and records who did it and when.</p>
      <div class="form-grid">
        <div class="field"><label>New Valid Until Date *</label><input type="date" id="extNewDate" value="${addDaysISO(todayISO(), 30)}"></div>
        <div class="field field-wide"><label>Note / Reason (optional)</label><input id="extNote" placeholder="e.g. Customer requested more time to decide"></div>
      </div>
      <div style="background:rgba(0,0,0,.03); padding:12px 14px; border-radius:6px; margin-top:10px;">
        <b>Please confirm that the following remain valid:</b>
        <div style="margin-top:8px;">
          ${EXTEND_VALIDITY_CHECKLIST.map((c, i) => `<label style="display:block; margin-bottom:6px; font-size:13px;"><input type="checkbox" class="ext-check" data-idx="${i}"> ${escapeHtml(c)}</label>`).join('')}
        </div>
      </div>
      <div class="btn-row" style="margin-top:14px;">
        <button class="btn-amber btn-sm" id="btnConfirmExtend">Confirm Extension</button>
        <button class="btn-line btn-sm" id="btnCancelExtend">Cancel</button>
      </div>
    </div>
  `;
  host.scrollIntoView && host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  document.getElementById('btnCancelExtend').onclick = () => { host.innerHTML = ''; };
  document.getElementById('btnConfirmExtend').onclick = async () => {
    const checks = [...document.querySelectorAll('.ext-check')];
    if (!checks.every(c => c.checked)) { toast('Please confirm every checklist item before extending.', 'err'); return; }
    const newDate = document.getElementById('extNewDate').value;
    if (!newDate) { toast('Please select a new valid-until date.', 'err'); return; }
    const settings = await DB.getSettings();
    const now = new Date().toISOString();
    const oldDate = q.validUntil;
    q.validityHistory = (q.validityHistory || []).concat([{ oldDate, newDate, by: settings.userName, at: now, note: document.getElementById('extNote').value }]);
    q.validUntil = newDate;
    q.updatedAt = now; q.modifiedBy = settings.userName;
    await DB.dbPut('quotations', q);
    await DB.logActivity(`Extended validity of ${q.quotationNo} from ${oldDate ? formatDate(oldDate) : 'no date'} to ${formatDate(newDate)}`);
    toast('Validity extended.');
    renderQuoteDetail(id);
  };
}

window.QuoteCalc = { computeLine, computeQuotationTotals };
