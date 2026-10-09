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

const VAT_MODE_EXPLANATIONS = {
  NonVat: 'Non-VAT means this business is not VAT-registered (below the ₱3M threshold) and doesn\u2019t charge VAT at all \u2014 different from Zero-Rated or VAT Exempt, which are still VAT-registered classifications for specific transactions.',
  Standard12: 'Standard 12% means this business is VAT-registered and charges the standard 12% VAT rate on this sale.',
  ZeroRated: 'Zero-Rated means this business is VAT-registered, but this specific transaction (e.g. exports, or sales to PEZA-registered buyers) is taxed at 0% \u2014 the seller is still VAT-registered, just not charging VAT on this particular sale.',
  Exempt: 'VAT Exempt means this business is VAT-registered, but this specific transaction is statutorily exempt from VAT under the Tax Code (e.g. certain agricultural goods or specific exempt services).'
};

// Matched live against whatever's typed in the Incoterms field -- shows only the one relevant
// explanation, the same single-explanation-at-a-time pattern as VAT Mode, rather than a static
// list of all of them at once.
const INCOTERMS_EXPLANATIONS = {
  EXW: '<b>EXW</b> (Ex Works) \u2014 buyer picks up from <b>our warehouse</b>; buyer arranges and pays for <b>everything from there</b> (shipping, insurance, import duties)',
  FOB: '<b>FOB</b> (Free on Board) \u2014 we deliver to the <b>port and load it</b>; buyer takes over cost and risk <b>once it\u2019s on the vessel</b>',
  CIF: '<b>CIF</b> (Cost, Insurance, Freight) \u2014 we pay <b>shipping and insurance to the destination port</b>; buyer still handles <b>import duties/customs</b>',
  DAP: '<b>DAP</b> (Delivered at Place) \u2014 we deliver to the agreed location <b>ready to unload</b>; buyer still handles <b>import duties/customs</b>',
  DDP: '<b>DDP</b> (Delivered Duty Paid) \u2014 we handle <b>everything, including import duties/taxes</b>; buyer just receives the goods'
};
function matchIncoterm(text) {
  const t = (text || '').trim().toUpperCase();
  return Object.keys(INCOTERMS_EXPLANATIONS).find(code => t.startsWith(code));
}

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

function emptyLine(defaultVatRate) {
  return { lineId: 'L' + Math.random().toString(36).slice(2, 9), itemId: '', brand: '', modelNo: '',
    description: '', qty: 1, uom: 'pc', unitCost: 0, costCurrency: 'PHP', costExchangeRate: 1,
    markupPercent: 0, unitPrice: 0, discountPercent: 0, vatRate: defaultVatRate ?? 12, supplierId: '',
    supplierQuoteRef: '', leadTime: '', estimatedFreightCost: 0, freightMode: 'total', priceOverridden: false, remarks: '', optionGroup: '' };
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

/* ============================================================
   LINE FREIGHT MODEL
   New lines (freightMode 'total'): `estimatedFreightCost` is the TOTAL freight for the whole row
   (all units), in the row's own cost currency. Per-unit freight is derived (total / qty).
   Old saved lines have no freightMode: their `estimatedFreightCost` was a PER-UNIT figure. They
   are never silently reinterpreted -- they keep their original math ('legacy') and are flagged
   for review until the user explicitly converts them (convertLegacyFreight).
   All math here is full precision; only displayed money is rounded.
   ============================================================ */
function isTotalFreight(l) { return l.freightMode === 'total'; }
function lineCostRate(l, quoteCurrency) {
  const costCcy = l.costCurrency || quoteCurrency || 'PHP';
  return (quoteCurrency && costCcy !== quoteCurrency) ? (Number(l.costExchangeRate) || 1) : 1;
}
/** Freight per unit, in the row's cost currency. Division by zero safe (qty 0 -> 0). */
function lineFreightPerUnit(l) {
  const f = Number(l.estimatedFreightCost) || 0;
  if (!isTotalFreight(l)) return f;
  const qty = Number(l.qty) || 0;
  return qty > 0 ? f / qty : 0;
}
/** Landed unit cost in the quotation currency = (supplier unit cost + freight per unit) x rate. */
function lineLandedUnitCost(l, quoteCurrency) {
  return ((Number(l.unitCost) || 0) + lineFreightPerUnit(l)) * lineCostRate(l, quoteCurrency);
}
/** Calculated selling price per unit. New lines: landed unit cost x (1 + markup%).
    Legacy lines keep their original rule (markup on unit cost only, freight added at cost). */
function lineCalcPrice(l, quoteCurrency) {
  const m = 1 + (Number(l.markupPercent) || 0) / 100;
  if (isTotalFreight(l)) return r2(lineLandedUnitCost(l, quoteCurrency) * m);
  const rate = lineCostRate(l, quoteCurrency);
  return r2((Number(l.unitCost) || 0) * rate * m + lineFreightPerUnit(l) * rate);
}
/** Explicit conversion of an old per-unit freight line to a total-for-the-line figure.
    Saved Unit Price is left untouched (and protected from silent recalculation). */
function convertLegacyFreight(l) {
  if (isTotalFreight(l)) return l;
  l.estimatedFreightCost = (Number(l.estimatedFreightCost) || 0) * (Number(l.qty) || 0);
  l.freightMode = 'total';
  l.priceOverridden = true;
  return l;
}

/** Catalog freight is quoted for a quantity (e.g. USD 60 for 40 pcs). Per-unit = amount / qty it
    covers. Missing/0 covers-qty (all products saved before this field existed) means 1, so old
    per-unit values keep their exact meaning. */
function productFreightPerUnit(p) {
  const covers = Number(p.freightCoversQty) > 0 ? Number(p.freightCoversQty) : 1;
  return (Number(p.estimatedFreightCost) || 0) / covers;
}

/** Splits ONE shipment freight total across several rows so the shares always add up to exactly
    the shipment total (whole cents, largest-remainder method).
      method 'cost'   -> in proportion to each row's cost value (unit cost x qty)  [default; fair for mixed goods]
      method 'qty'    -> in proportion to quantity
      method 'manual' -> shares typed by the user (manual: {lineId: amount}); nothing is auto-fixed
    If the chosen weights are all zero it falls back to quantity, then to an equal split.
    rows: [{ lineId, qty, unitCost }]. Returns { shares, allocated, unassigned }. */
function allocateFreight(rows, total, method, manual) {
  const T = Math.round((Number(total) || 0) * 100);
  const shares = {};
  if (!rows.length) return { shares, allocated: 0, unassigned: T / 100 };
  if (method === 'manual') {
    let sum = 0;
    rows.forEach(r => { const c = Math.round((Number(manual && manual[r.lineId]) || 0) * 100); shares[r.lineId] = c / 100; sum += c; });
    return { shares, allocated: sum / 100, unassigned: (T - sum) / 100 };
  }
  const weightOf = (r, m) => m === 'qty' ? (Number(r.qty) || 0) : (Number(r.unitCost) || 0) * (Number(r.qty) || 0);
  let m = method === 'qty' ? 'qty' : 'cost';
  let w = rows.map(r => Math.max(0, weightOf(r, m)));
  if (w.reduce((a, b) => a + b, 0) <= 0) { m = 'qty'; w = rows.map(r => Math.max(0, weightOf(r, 'qty'))); }
  if (w.reduce((a, b) => a + b, 0) <= 0) w = rows.map(() => 1);
  const W = w.reduce((a, b) => a + b, 0);
  const raw = w.map(x => x / W * T);
  const cents = raw.map(Math.floor);
  let left = T - cents.reduce((a, b) => a + b, 0);
  raw.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac || a.i - b.i)
    .forEach(o => { if (left > 0) { cents[o.i] += 1; left -= 1; } });
  rows.forEach((r, i) => { shares[r.lineId] = cents[i] / 100; });
  return { shares, allocated: T / 100, unassigned: 0 };
}

/** Selling price/VAT stay entirely in the quotation's own currency (that's what the customer
 *  sees). Cost is the only value that may be in a different currency (e.g. a USD-priced pump
 *  quoted to a PHP customer) — costExchangeRate converts unitCost INTO the quotation's currency
 *  before it's used for the internal gross-profit calculation. quoteCurrency is optional for
 *  backward compatibility with line items saved before this field existed (treated as already
 *  matching, i.e. rate 1 — unchanged behavior for old records). */
function computeLine(l, quoteCurrency) {
  const qty = Number(l.qty) || 0, price = Number(l.unitPrice) || 0, cost = Number(l.unitCost) || 0;
  const freight = Number(l.estimatedFreightCost) || 0;
  const base = r2(qty * price);
  const discAmt = r2(base * (Number(l.discountPercent) || 0) / 100);
  const net = r2(base - discAmt);
  const vatAmt = r2(net * (Number(l.vatRate) || 0) / 100);
  const costCcy = l.costCurrency || quoteCurrency || 'PHP';
  const needsConversion = quoteCurrency && costCcy !== quoteCurrency;
  const rate = Number(l.costExchangeRate) || 1;
  const costInQuoteCurrency = needsConversion ? r2(cost * rate) : cost;
  // True cost = item cost + freight, both converted the same way (freight is quoted in the
  // same currency as the item itself -- an item sourced from Hong Kong has freight quoted in
  // HKD too, not PHP). Markup is applied only to the item's own cost elsewhere (see
  // computeMarkupPrice in quotations.js); this is the actual cost Gross Profit is measured
  // against, which must include freight or the figure silently understates a real expense.
  let costTotal;
  if (isTotalFreight(l)) {
    // (Supplier unit cost x Qty + Total line freight) x Exchange rate -- full precision, rounded once.
    costTotal = r2((cost * qty + freight) * lineCostRate(l, quoteCurrency));
  } else {
    // Legacy per-unit freight line: original math, so saved totals do not move.
    const freightInQuoteCurrency = needsConversion ? r2(freight * rate) : freight;
    costTotal = r2(qty * (costInQuoteCurrency + freightInQuoteCurrency));
  }
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
  const all = (await DB.dbGetAll('quotations')).filter(q => q.isLatest).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const expiredCount = all.filter(q => getExpiryInfo(q).state === 'expired').length;
  const customers = await DB.dbGetAll('customers');
  const custMap = Object.fromEntries(customers.map(c => [c.id, c]));
  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="page-head">
      <h1>Quotations</h1>
      <div class="page-actions">
        <input type="search" id="listSearch" placeholder="Search quotation #, RFQ ref, project, end-user, customer..." class="search-box">
        <select id="statusFilter"><option value="">All Statuses</option>${QUOTE_STATUSES.filter(s => s !== 'Expired').map(s => `<option>${s}</option>`).join('')}</select>
        <button class="btn-amber" id="btnNew">+ New Quotation</button>
      </div>
    </div>
    <label style="display:flex; align-items:center; gap:6px; margin-bottom:14px; font-size:13px;">
      <input type="checkbox" id="showExpired">
      Show expired quotations too${expiredCount ? ` (${expiredCount} hidden right now)` : ''}
    </label>
    <div class="card">
      <table class="data-table">
        <thead><tr><th>Quotation #</th><th>Customer</th><th>RFQ Ref</th><th>Date</th><th>Valid Until</th><th>Rev</th><th>Status</th><th>Total</th></tr></thead>
        <tbody id="qBody"></tbody>
      </table>
      <div class="empty-inline" id="emptyMsg" style="display:none;">No quotations yet. Click "New Quotation" to create one.</div>
      <div id="pgWrap"></div>
    </div>
  `;
  document.getElementById('btnNew').onclick = () => Router.navigate('/quotations/new');

  // Renders only one page's worth of rows at a time -- at a few hundred quotations, rebuilding
  // the whole table on every search keystroke (even debounced) is real, measurable work; a
  // fixed-size page keeps every render fast no matter how large the list grows.
  let currentPage = 1;
  function draw(rows) {
    const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    const pageRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
    const body = document.getElementById('qBody');
    body.innerHTML = pageRows.map(q => {
      const info = getExpiryInfo(q);
      return `
      <tr class="clickable-row" data-hash="/quotations/${q.id}">
        <td>${escapeHtml(q.quotationNo)}</td>
        <td>${escapeHtml(custMap[q.customerId]?.companyName || q.customerSnapshot?.companyName || '—')}</td>
        <td>${escapeHtml(q.rfqRef || '—')}</td>
        <td>${formatDate(q.date)}</td>
        <td>${validityCellHTML(q)}</td>
        <td>Rev ${padRev(q.revision)}</td>
        <td>${statusBadge(q.status)}${info.badgeText ? ' ' + statusBadge(info.badgeText) : ''}</td>
        <td>${formatMoney(q.grandTotal, q.currency)}${q.isMultiOption ? ` <span class="muted-text">(${escapeHtml(q.optionTotals?.[0]?.label || 'Option 1')})</span>` : ''}</td>
      </tr>`;
    }).join('');
    document.getElementById('emptyMsg').style.display = rows.length ? 'none' : 'block';
    document.getElementById('pgWrap').innerHTML = rows.length > PAGE_SIZE ? paginationControlsHTML(currentPage, rows.length, PAGE_SIZE) : '';
    wirePaginationControls((newPage) => { currentPage = Math.max(1, Math.min(newPage, totalPages)); draw(rows); }, currentPage);
  }

  // One clear, single control: expired quotations (still Draft/Sent/Under Review, past their
  // Valid Until date) are hidden by default, shown only if this box is checked. Deliberately
  // NOT a second dropdown next to Status -- Status already has its own "Expired" option (a
  // status someone sets by hand), and having two different "Expired"-sounding filters, in two
  // separate dropdowns, meaning two different things, is exactly what caused real confusion.
  // A Won or Lost quotation is never affected by this checkbox either way, since
  // getExpiryInfo() only flags an open-status quotation as expired to begin with.
  const applyFilters = () => {
    const q = document.getElementById('listSearch').value.trim().toLowerCase();
    const st = document.getElementById('statusFilter').value;
    const showExpired = document.getElementById('showExpired').checked;
    let rows = all;
    if (st) rows = rows.filter(r => r.status === st);
    if (!showExpired) rows = rows.filter(r => getExpiryInfo(r).state !== 'expired');
    if (q) rows = rows.filter(r => [r.quotationNo, r.rfqRef, r.projectName, r.endUser, custMap[r.customerId]?.companyName].join(' ').toLowerCase().includes(q));
    currentPage = 1;
    draw(rows);
  };
  applyFilters();
  document.getElementById('listSearch').addEventListener('input', debounce(applyFilters, 200));
  document.getElementById('statusFilter').addEventListener('change', applyFilters);
  document.getElementById('showExpired').addEventListener('change', applyFilters);
});

/* ---------- FORM (new / edit) ---------- */

Router.route('/quotations/new', () => renderQuoteForm(null));
Router.route('/quotations/:id/edit', (p) => renderQuoteForm(p.id));

async function renderQuoteForm(id) {
  const isEdit = !!id;
  const record = isEdit ? await DB.dbGet('quotations', Number(id)) : null;
  if (isEdit && !record) { Router.setBreadcrumb([{ label: 'Quotations', hash: '/quotations' }, { label: 'Not found' }]); document.getElementById('content').innerHTML = `<div class="empty-state"><h3>Quotation not found</h3><p><a href="#/quotations">Back to Quotations</a></p></div>`; return; }
  if (isEdit && !record.isLatest) { toast('Only the latest revision can be edited.', 'err'); return Router.navigate(`/quotations/${id}`); }

  const [customers, products, suppliers, settings] = await Promise.all([
    DB.dbGetAll('customers'), DB.dbGetAll('products'), DB.dbGetAll('suppliers'), DB.getSettings()
  ]);

  const q = record ? JSON.parse(JSON.stringify(record)) : {
    date: todayISO(), validUntil: addDaysISO(todayISO(), settings.defaultQuotationValidityDays),
    salesperson: settings.userName, currency: 'PHP',
    paymentTerms: settings.defaultPaymentTerms, incoterms: settings.defaultIncoterms,
    deliveryLeadTime: '', warranty: settings.defaultWarranty, vatMode: 'NonVat',
    overallDiscountPercent: 0, freightCharge: 0, otherCharges: 0,
    internalNotes: '', customerNotes: '', lines: [emptyLine(0)]
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
        <div class="field"><label>Incoterms</label><input id="f_incoterms" value="${escapeHtml(q.incoterms || '')}" placeholder="e.g. EXW, FOB Manila, DAP">
          <p class="muted-text" id="incotermsHint" style="margin-top:4px;"></p>
        </div>
        <div class="field"><label>Delivery Lead Time</label><input id="f_deliveryLeadTime" value="${escapeHtml(q.deliveryLeadTime || '')}"></div>
        <div class="field"><label>Warranty</label><input id="f_warranty" value="${escapeHtml(q.warranty || '')}"></div>
        <div class="field"><label>VAT Mode</label>
          <select id="f_vatMode">
            <option value="NonVat" ${q.vatMode === 'NonVat' ? 'selected' : ''}>Non-VAT (Percentage Tax)</option>
            <option value="Standard12" ${q.vatMode === 'Standard12' ? 'selected' : ''}>Standard 12%</option>
            <option value="ZeroRated" ${q.vatMode === 'ZeroRated' ? 'selected' : ''}>Zero-Rated</option>
            <option value="Exempt" ${q.vatMode === 'Exempt' ? 'selected' : ''}>VAT Exempt</option>
          </select>
          <p class="muted-text" id="vatModeHint" style="margin-top:4px;"></p>
        </div>
      </div>

      <h3 class="section-title">Line Items</h3>
      <div style="overflow-x:auto; max-width:100%;">
      <table class="data-table items-table" id="linesTable">
        <thead><tr>
          <th style="width:26px;">#</th><th>Catalog</th><th>Brand</th><th>Model/Part No.</th><th>Description *</th>
          <th>Option</th>
          <th>Qty</th><th>UOM</th><th class="internal-only-col">Lead Time</th><th class="internal-only-col">Total Freight for This Line</th><th class="internal-only-col">Unit Cost</th><th class="internal-only-col">Cost Ccy</th><th class="internal-only-col">Rate→<span id="rateArrowCcy"></span></th><th class="internal-only-col">Markup %</th><th>Unit Price</th><th>Disc %</th><th>VAT %</th>
          <th class="internal-only-col">Supplier</th><th>Amount</th><th class="internal-only-col">Amount w/ VAT</th><th></th>
        </tr></thead>
        <tbody id="linesBody"></tbody>
      </table>
      </div>
      <datalist id="optionSuggestions"><option value="Option 1"><option value="Option 2"><option value="Option 3"></datalist>
      <button type="button" class="btn-line btn-sm" id="btnAddLine">+ Add Line Item</button> <button type="button" class="btn-line btn-sm" id="btnSplitFreight" title="One supplier shipment covering several items? Split its freight across the rows">Split shipment freight…</button>
      <p class="muted-text" style="margin-top:6px;">Tag lines with the same <b>Option</b> label (e.g. "Option 1") when the customer must choose ONE alternative — the system will then total each option separately instead of adding them together. Leave blank for items that apply to every option (e.g. shared freight).</p>

      <div class="totals-panel">
        <div class="field"><label>Overall Discount %</label><input type="number" step="0.01" id="f_overallDiscountPercent" value="${q.overallDiscountPercent || 0}"></div>
        <div class="field"><label>Freight / Shipping Charge</label><input type="number" step="0.01" id="f_freightCharge" value="${q.freightCharge || 0}"><div id="freightInfo" style="font-size:11px; margin-top:3px;"></div></div>
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

  let lines = q.lines && q.lines.length ? q.lines : [emptyLine(q.vatMode === 'Standard12' ? 12 : 0)];

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

  /** Same conversion as costInQuoteCurrency, for Estimated Freight Cost -- freight is
      quoted in the same currency as the item itself (an item sourced from Hong Kong has
      freight quoted in HKD too), so it uses the line's own Cost Currency/rate, not PHP. */
  function freightInQuoteCurrency(line, qCur) {
    const costCcy = line.costCurrency || qCur;
    const rate = costCcy === qCur ? 1 : (Number(line.costExchangeRate) || 1);
    return (Number(line.estimatedFreightCost) || 0) * rate;
  }

  /** Unit Price computed from cost + freight + markup (see lineCalcPrice: new lines apply
      markup to the landed unit cost = supplier cost + freight per unit; old per-unit-freight
      lines keep their original rule until converted). */
  function computeMarkupPrice(line, qCur) {
    return lineCalcPrice(line, qCur);
  }

  /** Flags Unit Price in red whenever it's at or below TRUE cost (unit cost + freight;
      zero or negative margin once freight is accounted for) -- most often the result of a
      0% markup leaving price defaulted straight to cost, but also catches someone manually
      typing a price that happens to land there. A sanity-check highlight, not a validation
      error -- the person may genuinely intend to sell at cost sometimes, so nothing is
      blocked, it just should never happen without them noticing. */
  function updatePriceWarning(tr, line, qCur) {
    const priceEl = tr.querySelector('.ln-price');
    if (!priceEl) return;
    if (line.lotRole) { priceEl.classList.remove('ln-price-at-cost'); return; }
    const trueCost = r2(lineLandedUnitCost(line, qCur));
    const atOrBelowCost = r2(Number(line.unitPrice) || 0) <= trueCost && trueCost > 0;
    priceEl.classList.toggle('ln-price-at-cost', atOrBelowCost);
  }

  /** Price suggested for a project's lot line = what its component lines would each sell for
      (cost + freight + markup) x their quantities. A starting point only -- always editable. */
  function lotSuggestedPrice(header) {
    const qCur = currentCurrency();
    const comps = lines.filter(l => l.lotRole === 'component' && l.itemId === header.itemId)
      .reduce((sum, l) => sum + lineCalcPrice(l, qCur) * (Number(l.qty) || 0), 0);
    // The lot line's own cost/markup (if any is typed on it) counts too.
    const own = lineCalcPrice(header, qCur) * (Number(header.qty) || 0);
    return r2(comps + own);
  }
  /** The lot price follows its components automatically -- exactly like a normal line follows its
      cost + markup -- until the user types their own lot price (then it is kept; "Use that" returns
      to automatic). */
  function autoLotPrices() {
    lines.forEach(l => { if (l.lotRole === 'header' && !l.priceOverridden) l.unitPrice = lotSuggestedPrice(l); });
  }
  function syncLotHeaderDom() {
    const qCur = currentCurrency();
    document.querySelectorAll('#linesBody tr').forEach(tr => {
      const l = lines.find(x => x.lineId === tr.dataset.lid);
      if (!l || l.lotRole !== 'header') return;
      const priceEl = tr.querySelector('.ln-price');
      if (!l.priceOverridden && priceEl && document.activeElement !== priceEl) priceEl.value = l.unitPrice;
      const c = computeLine(l, qCur);
      tr.querySelector('.ln-amount').textContent = formatMoney(c.net, qCur);
      tr.querySelector('.ln-amount-vat').textContent = formatMoney(c.lineTotal, qCur);
    });
  }
  function refreshLotHeaders() {
    document.querySelectorAll('#linesBody tr').forEach(tr => {
      const l = lines.find(x => x.lineId === tr.dataset.lid);
      if (l && l.lotRole === 'header') refreshLineInfo(tr, l);
    });
  }

  /** Selecting a Project Package replaces the clicked row with the package's lines, in the order the
      package defines them. Each component is either:
        - "Own price": a normal line (cost + freight + markup -> its own unit price), or
        - "In lot price": a blank-price line whose cost/markup roll into ONE lot line placed just before
          the first such component (like the "Piping materials ... as detailed below" line + its breakdown).
      If no component is "In lot price" there is no lot line at all. */
  /** The single "lot" line of a project package: carries the lot price, no cost of its own, no supplier. */
  function makeLotHeader(itemId, name, vatRate, qCur, leadTime) {
    const h = emptyLine(vatRate);
    Object.assign(h, { itemId, lotRole: 'header', description: name || '', qty: 1, uom: 'lot', leadTime: leadTime || '',
      costCurrency: qCur, costExchangeRate: 1, unitCost: 0, markupPercent: 0, priceOverridden: false });
    return h;
  }
  /** Keeps each package's lot line consistent with its items: a component with a blank/zero price is part of the lot,
      a component with a price is priced on its own. The lot line sits just above the first in-lot item, exists only while
      some item is in the lot, and a lot line whose price was typed by hand is never removed. */
  function normalizeLotGroups() {
    const ids = [...new Set(lines.filter(l => l.lotRole && l.itemId).map(l => l.itemId))];
    const headerVat = document.getElementById('f_vatMode') ? document.getElementById('f_vatMode').value : 'Standard12';
    const vatRate = headerVat === 'Standard12' ? 12 : 0;
    ids.forEach(id => {
      const firstComp = lines.find(l => l.itemId === id && l.lotRole === 'component');
      let header = lines.find(l => l.itemId === id && l.lotRole === 'header');
      if (firstComp && !header) {
        const any = lines.find(l => l.itemId === id && l.compNo);
        header = makeLotHeader(id, (any && any.pkgName) || '', vatRate, currentCurrency(), any && any.leadTime);
      }
      if (!firstComp && header && !header.priceOverridden) { lines.splice(lines.indexOf(header), 1); return; }
      if (firstComp && header) {
        const hi = lines.indexOf(header);
        if (hi >= 0) lines.splice(hi, 1);
        lines.splice(lines.indexOf(firstComp), 0, header);
      }
    });
  }

  function loadProjectPackage(line, p) {
    const qCur = currentCurrency();
    const headerVat = document.getElementById('f_vatMode').value;
    const vatRate = headerVat === 'Standard12' ? 12 : 0;
    const buildComp = (c) => {
      const own = c.pricing === 'own';
      const l = emptyLine(vatRate);
      const qty = Number(c.qty) || 0;
      const covers = Number(c.freightCoversQty) > 0 ? Number(c.freightCoversQty) : 1;
      const perUnit = (Number(c.estimatedFreightCost) || 0) / covers;
      Object.assign(l, {
        itemId: p.id, compNo: c.compNo, pkgName: p.description || '', brand: c.brand || '', modelNo: c.modelNo || '',
        supplierId: p.defaultSupplierId ? Number(p.defaultSupplierId) : '', leadTime: p.leadTime || '',
        description: c.description, qty, uom: c.uom || 'pc', unitCost: Number(c.unitCost) || 0,
        costCurrency: c.costCurrency || qCur, markupPercent: Number(c.markupPercent) || 0,
        freightMode: 'total', freightSource: 'catalog', catalogFreightPerUnit: perUnit, estimatedFreightCost: perUnit * qty,
        unitPrice: 0
      });
      if (!own) l.lotRole = 'component';
      l.costExchangeRate = referenceRate(l.costCurrency, qCur, settings);
      if (own) l.unitPrice = lineCalcPrice(l, qCur);
      return l;
    };
    const out = [];
    let header = null;
    (p.components || []).forEach(c => {
      if (c.pricing !== 'own' && !header) {
        header = makeLotHeader(p.id, p.description, vatRate, qCur, p.leadTime);
        out.push(header);
      }
      out.push(buildComp(c));
    });
    const idx = lines.indexOf(line);
    lines.splice(idx < 0 ? lines.length : idx, 1, ...out);
    // Lead time and warranty are as per the package: fill the quotation's header fields (warranty always, lead time only if still empty).
    const wEl = document.getElementById('f_warranty'), dEl = document.getElementById('f_deliveryLeadTime');
    if (p.warranty && wEl) wEl.value = p.warranty;
    if (p.leadTime && dEl && !dEl.value.trim()) dEl.value = p.leadTime;
    autoLotPrices();
    drawLines(); refreshTotals(); markDirty();
  }

  function closeInfoPopup() { document.querySelectorAll('.ln-info-popup').forEach(p => p.remove()); }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeInfoPopup(); });
  const qtyReminders = new Set();

  /** Beside-the-inputs read-outs: freight per unit, landed unit cost, qty reminder, legacy
      review flag, manual-price flag. Display only -- rounding happens here, never in the math. */
  function refreshLineInfo(tr, line) {
    const qCur = currentCurrency();
    const costCcy = line.costCurrency || qCur;
    const info = tr.querySelector('.ln-freight-info');
    if (info) {
      // The details live in this hidden holder and are shown in a popup when the eye icon is clicked,
      // so the row stays one line tall. The eye gets an orange dot when something needs attention.
      const row = (t) => `<div style="margin:3px 0;">${t}</div>`;
      if (line.lotRole === 'header') {
        info.innerHTML = row('Project lot line — carries the lot price for the whole project; the component lines below carry the costs.');
      } else if (isTotalFreight(line)) {
        const perUnit = lineFreightPerUnit(line) * lineCostRate(line, qCur);
        const parts = [
          row(`Freight/unit: <b>${formatMoney(perUnit, qCur)}</b>`),
          row(`Landed/unit: <b>${formatMoney(lineLandedUnitCost(line, qCur), qCur)}</b>`)
        ];
        if (line.freightSource === 'catalog') parts.push(row(`<span class="muted-text">Catalog rate ${formatMoney(Number(line.catalogFreightPerUnit) || 0, costCcy)}/unit × qty. Type a freight amount to fix a different total.</span>`));
        if (line.freightNote) parts.push(row(`<span class="muted-text">${escapeHtml(line.freightNote)}</span>`));
        if ((Number(line.qty) || 0) <= 0 && (Number(line.estimatedFreightCost) || 0) > 0) parts.push(row('<span style="color:#b45309;">Enter a quantity to spread freight per unit.</span>'));
        if (qtyReminders.has(line.lineId)) parts.push(row('<span style="color:#b45309;">Qty changed — reconfirm supplier pricing and total freight.</span>'));
        info.innerHTML = parts.join('');
      } else {
        info.innerHTML = row('<span style="color:#b45309;">Old per-unit freight — review, then convert to a line total when ready.</span>') + '<button type="button" class="btn-line btn-sm ln-convert-freight">Convert to line total</button>';
      }
      const eye = tr.querySelector('.ln-info-btn:not(.ln-flag-btn)');
      if (eye) eye.classList.toggle('needs-attention',
        line.lotRole !== 'header' && (!isTotalFreight(line) || qtyReminders.has(line.lineId) || ((Number(line.qty) || 0) <= 0 && (Number(line.estimatedFreightCost) || 0) > 0)));
    }
    // Short labels stay under the price; anything long goes in the "!" popup (hidden holder + button).
    const flag = tr.querySelector('.ln-price-flag');
    const pInfo = tr.querySelector('.ln-price-info');
    const pBtn = tr.querySelector('.ln-flag-btn');
    let short = '', popHtml = '';
    let neutralBtn = false;
    if (line.lotRole === 'component') {
      short = '<span class="muted-text" title="Included in the project lot price; prints blank on the quotation.">In lot price</span>';
      popHtml = `<div style="margin:3px 0;">Part of the project's lot price, so its price prints blank on the quotation.</div><div style="margin:3px 0;">To price it separately, type a price here, or use its calculated price: <b>${formatMoney(lineCalcPrice(line, qCur), qCur)}</b></div><button type="button" class="btn-line btn-sm ln-own-price">Price it separately</button>`;
      neutralBtn = true;
    } else if (line.lotRole === 'header') {
      const sug = lotSuggestedPrice(line);
      const differs = line.priceOverridden && Math.abs((Number(line.unitPrice) || 0) - sug) > 0.005;
      short = `<span class="muted-text" title="Lot price for the project's In-lot-price items.">Lot items: ${formatMoney(sug, qCur)}</span>`;
      if (differs) popHtml = `<div style="margin:3px 0;">The lot items add up to <b>${formatMoney(sug, qCur)}</b>, but the lot price was typed in by hand.</div><button type="button" class="btn-line btn-sm ln-use-lot">Use that</button>`;
    } else {
      const calc = lineCalcPrice(line, qCur);
      const differs = line.priceOverridden && Math.abs((Number(line.unitPrice) || 0) - calc) > 0.005;
      if (differs) popHtml = `<div style="margin:3px 0;">Manual price — review.</div><div style="margin:3px 0;">Calculated price: <b>${formatMoney(calc, qCur)}</b></div><button type="button" class="btn-line btn-sm ln-use-calc">Use calculated</button>`;
    }
    if (flag) flag.innerHTML = short;
    if (pInfo) pInfo.innerHTML = popHtml;
    if (pBtn) { pBtn.style.display = popHtml ? '' : 'none'; pBtn.classList.toggle('needs-attention', !neutralBtn); pBtn.title = neutralBtn ? 'In the lot price — click for options' : 'Price needs review'; }
    const mEl = tr.querySelector('.ln-margin');
    if (mEl) {
      if (line.lotRole === 'component') { mEl.textContent = ''; }
      else {
        const lc = computeLine(line, qCur);
        let cost = lc.costTotal;
        if (line.lotRole === 'header') cost = lines.filter(l => l.itemId === line.itemId && l.lotRole).reduce((sum, l) => sum + computeLine(l, qCur).costTotal, 0);
        mEl.textContent = (lc.net > 0 && cost > 0) ? `${line.lotRole === 'header' ? 'Lot margin' : 'Margin'} ${(Math.round((lc.net - cost) / lc.net * 1000) / 10).toFixed(1)}%` : '';
      }
    }
    updatePriceWarning(tr, line, qCur);
    refreshFreightNote();
  }

  /** The note under Freight / Shipping Charge was removed (it was confusing). Kept as a no-op so callers stay valid. */
  function refreshFreightNote() {
    const el = document.getElementById('freightInfo');
    if (el) el.innerHTML = '';
  }

  function drawLines() {
    autoLotPrices();
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
        <td><button type="button" class="item-picker-trigger ln-catalog-btn">${l.itemId ? escapeHtml(l.compNo || products.find(p => String(p.id) === String(l.itemId))?.itemNo || '(item removed)') : '+ Select Item'}</button></td>
        <td><input class="ln-brand" value="${escapeHtml(l.brand)}" style="width:70px;"></td>
        <td><input class="ln-model" value="${escapeHtml(l.modelNo)}" style="width:90px;"></td>
        <td><textarea class="ln-desc" rows="1" style="width:160px;">${escapeHtml(l.description)}</textarea></td>
        <td><input class="ln-option" list="optionSuggestions" value="${escapeHtml(l.optionGroup || '')}" placeholder="e.g. Option 1" style="width:85px;"></td>
        <td><input class="ln-qty" type="number" min="0" step="any" value="${l.qty}" style="width:55px;"></td>
        <td><input class="ln-uom" value="${escapeHtml(l.uom)}" style="width:45px;"></td>
        <td class="internal-only-col" style="text-align:center; font-size:12px;" title="For internal reference only — not shown on the printed quotation">${escapeHtml(l.leadTime || '—')}</td>
        <td class="internal-only-col" title="For internal reference only — not shown on the printed quotation">
          <div style="display:flex; align-items:center; gap:4px;">
            <input class="ln-freight" type="number" min="0" step="0.01" value="${l.estimatedFreightCost || 0}" style="width:70px;">
            <button type="button" class="ln-info-btn" title="Freight details" aria-label="Freight details"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg></button>
          </div>
          <div class="ln-freight-info" style="display:none;"></div>
        </td>
        <td class="internal-only-col">
          <input class="ln-cost" type="number" min="0" step="0.01" value="${l.unitCost}" style="width:75px;">
          ${diffCurrency ? `<div class="ln-cost-php muted-text" style="font-size:10px; margin-top:2px; white-space:nowrap;">→${formatMoney((Number(l.unitCost) || 0) * (Number(l.costExchangeRate) || 1), qCur)}</div>` : ''}
        </td>
        <td class="internal-only-col"><select class="ln-costccy" style="width:62px;">${(() => {
          const list = currencyList(settings);
          const current = l.costCurrency || qCur;
          // Same safety net used elsewhere for archived references: if this line's actual
          // stored currency isn't in the currently configured list, still show it as a real,
          // selectable option instead of silently defaulting to whatever's first in the list —
          // that's exactly what was making the dropdown disagree with the value actually
          // driving the calculation.
          const options = list.includes(current) ? list : [current, ...list];
          return options.map(c2 => `<option value="${escapeHtml(c2)}" ${c2 === current ? 'selected' : ''}>${escapeHtml(c2)}${!list.includes(c2) ? ' (not in Settings)' : ''}</option>`).join('');
        })()}</select></td>
        <td class="internal-only-col"><input class="ln-rate" type="number" step="0.0001" min="0" value="${l.costExchangeRate ?? 1}" style="width:60px;" ${diffCurrency ? '' : 'disabled title="Only used when Cost Currency differs from the quotation currency"'}></td>
        <td class="internal-only-col"><input class="ln-markup" type="number" step="0.01" value="${l.markupPercent}" style="width:60px;"></td>
        <td><div style="display:flex; align-items:center; gap:4px;"><input class="ln-price" type="number" min="0" step="0.01" value="${l.unitPrice}" style="width:80px;"><button type="button" class="ln-info-btn ln-flag-btn needs-attention" title="Price needs review" aria-label="Price needs review" style="display:none;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></button></div><div class="ln-price-info" style="display:none;"></div><div class="ln-margin muted-text" style="font-size:10px; margin-top:2px; white-space:nowrap;" title="Gross margin = profit ÷ selling price (not the same as Markup %, which is profit ÷ cost)"></div><div class="ln-price-flag" style="font-size:10px; margin-top:2px; max-width:110px;"></div></td>
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
          const qCurNow = currentCurrency();
          if (sel === '.ln-price') {
            // Direct edit = manual override. Clears itself if the typed price equals the calculated one.
            // A project item with a blank/zero price is part of the lot; give it a price and it is priced on its own.
            if (line.compNo && line.lotRole !== 'header') {
              if (Number(line.unitPrice) > 0 && line.lotRole === 'component') line.lotRole = '';
              else if (!(Number(line.unitPrice) > 0) && !line.lotRole) { line.lotRole = 'component'; line.priceOverridden = false; }
            }
            if (line.lotRole === 'header') line.priceOverridden = Math.abs((Number(line.unitPrice) || 0) - lotSuggestedPrice(line)) > 0.005;
            else if (!line.lotRole) line.priceOverridden = Math.abs((Number(line.unitPrice) || 0) - lineCalcPrice(line, qCurNow)) > 0.005;
          } else if (['.ln-cost', '.ln-markup', '.ln-rate', '.ln-freight', '.ln-qty'].includes(sel)) {
            if (sel === '.ln-qty') {
              if (isTotalFreight(line)) qtyReminders.add(lid);
              if (line.freightSource === 'catalog' && isTotalFreight(line)) {
                // Freight that came from the catalog is a per-unit RATE: it follows the quantity.
                line.estimatedFreightCost = (Number(line.catalogFreightPerUnit) || 0) * (Number(line.qty) || 0);
                tr.querySelector('.ln-freight').value = line.estimatedFreightCost;
              }
            } else if (sel === '.ln-freight' || sel === '.ln-cost') {
              qtyReminders.delete(lid);
              if (sel === '.ln-freight') { delete line.freightNote; delete line.freightSource; delete line.catalogFreightPerUnit; }
            }
            // Selling price follows cost + freight + markup, but a manually typed price is never
            // silently replaced: it is kept and flagged for review (see refreshLineInfo).
            // Qty only affects price for total-freight lines (freight per unit = total / qty).
            const affectsPrice = sel !== '.ln-qty' || isTotalFreight(line);
            if (affectsPrice && !line.priceOverridden && !line.lotRole) {
              line.unitPrice = lineCalcPrice(line, qCurNow);
              tr.querySelector('.ln-price').value = line.unitPrice;
            }
          }
          autoLotPrices(); syncLotHeaderDom();
          const c2 = computeLine(line, currentCurrency());
          tr.querySelector('.ln-amount').textContent = formatMoney(c2.net, currentCurrency());
          tr.querySelector('.ln-amount-vat').textContent = formatMoney(c2.lineTotal, currentCurrency());
          const phpHint = tr.querySelector('.ln-cost-php');
          if (phpHint) phpHint.textContent = `→${formatMoney((Number(line.unitCost) || 0) * (Number(line.costExchangeRate) || 1), currentCurrency())}`;
          refreshLineInfo(tr, line); refreshLotHeaders();
          updatePriceWarning(tr, line, currentCurrency());
          refreshTotals();
          markDirty();
        });
      };
      bind('.ln-brand', 'brand'); bind('.ln-model', 'modelNo'); bind('.ln-desc', 'description');
      bind('.ln-option', 'optionGroup');
      bind('.ln-qty', 'qty', true); bind('.ln-uom', 'uom'); bind('.ln-freight', 'estimatedFreightCost', true); bind('.ln-cost', 'unitCost', true);
      bind('.ln-markup', 'markupPercent', true); bind('.ln-price', 'unitPrice', true);
      // Once the price box is left, re-arrange a project's lot line (add / move / remove it) if an item moved in or out of the lot.
      if (line.compNo) tr.querySelector('.ln-price').addEventListener('change', () => { normalizeLotGroups(); drawLines(); refreshTotals(); markDirty(); });
      bind('.ln-disc', 'discountPercent', true); bind('.ln-vat', 'vatRate', true);
      bind('.ln-rate', 'costExchangeRate', true);
      updatePriceWarning(tr, line, qCur);
      refreshLineInfo(tr, line);
      const openInfo = (btn, title, holderSel) => btn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeInfoPopup();
        const pop = document.createElement('div');
        pop.className = 'ln-info-popup';
        pop.innerHTML = '<div class="ln-info-popup-title">' + title + '</div>' + tr.querySelector(holderSel).innerHTML;
        document.body.appendChild(pop);
        const r = btn.getBoundingClientRect();
        pop.style.top = Math.min(window.innerHeight - pop.offsetHeight - 8, r.bottom + 6) + 'px';
        pop.style.left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.left - 20)) + 'px';
        const conv = pop.querySelector('.ln-convert-freight');
        if (conv) conv.addEventListener('click', () => { closeInfoPopup(); convertLegacyFreight(line); drawLines(); refreshTotals(); markDirty(); });
        const useCalc = pop.querySelector('.ln-use-calc');
        if (useCalc) useCalc.addEventListener('click', () => { closeInfoPopup(); line.priceOverridden = false; line.unitPrice = lineCalcPrice(line, currentCurrency()); drawLines(); refreshTotals(); markDirty(); });
        const ownBtn = pop.querySelector('.ln-own-price');
        if (ownBtn) ownBtn.addEventListener('click', () => { closeInfoPopup(); line.lotRole = ''; line.priceOverridden = false; line.unitPrice = lineCalcPrice(line, currentCurrency()); normalizeLotGroups(); drawLines(); refreshTotals(); markDirty(); });
        const useLot = pop.querySelector('.ln-use-lot');
        if (useLot) useLot.addEventListener('click', () => { closeInfoPopup(); line.priceOverridden = false; line.unitPrice = lotSuggestedPrice(line); drawLines(); refreshTotals(); markDirty(); });
        setTimeout(() => document.addEventListener('click', closeInfoPopup, { once: true }), 0);
      });
      const eyeBtn = tr.querySelector('.ln-info-btn:not(.ln-flag-btn)');
      if (eyeBtn) openInfo(eyeBtn, 'Freight details', '.ln-freight-info');
      const flagBtn = tr.querySelector('.ln-flag-btn');
      if (flagBtn) openInfo(flagBtn, 'Price review', '.ln-price-info');
      tr.addEventListener('click', (e) => {
        if (e.target.closest('.ln-convert-freight')) {
          convertLegacyFreight(line);
          drawLines(); refreshTotals(); markDirty();
        } else if (e.target.closest('.ln-use-lot')) {
          line.priceOverridden = false;
          line.unitPrice = lotSuggestedPrice(line);
          drawLines(); refreshTotals(); markDirty();
        } else if (e.target.closest('.ln-use-calc')) {
          line.priceOverridden = false;
          line.unitPrice = lineCalcPrice(line, currentCurrency());
          drawLines(); refreshTotals(); markDirty();
        }
      });

      tr.querySelector('.ln-costccy').addEventListener('change', (e) => {
        line.costCurrency = e.target.value;
        // A catalog freight rate is in the product's own currency; once the currency is changed it no longer applies.
        delete line.freightSource; delete line.catalogFreightPerUnit;
        // Pre-fill a sensible starting rate from Settings' reference rates; still fully editable per line.
        line.costExchangeRate = referenceRate(line.costCurrency, currentCurrency(), settings);
        if (!line.priceOverridden) line.unitPrice = computeMarkupPrice(line, currentCurrency());
        drawLines(); refreshTotals(); markDirty();
      });
      tr.querySelector('.ln-supplier').addEventListener('change', (e) => { line.supplierId = e.target.value; markDirty(); });
      tr.querySelector('.ln-catalog-btn').addEventListener('click', () => {
        openItemPicker(
          products.filter(p => !p.archived),
          {
            title: 'Select Item from Catalog',
            getLabel: (p) => `${p.itemNo} — ${p.description || ''}`,
            getSubLabel: (p) => p.type === 'Project Package' ? `Project Package · ${(p.components || []).length} component items` : [p.brand, p.modelNo].filter(Boolean).join(' · '),
            getSearchText: (p) => [p.itemNo, p.description, p.brand, p.modelNo].filter(Boolean).join(' ')
          },
          (p) => {
            if (p.type === 'Project Package') { loadProjectPackage(line, p); return; }
            line.itemId = p.id;
            line.brand = p.brand || ''; line.modelNo = p.modelNo || ''; line.description = p.description || '';
            line.unitCost = p.standardCost || 0; line.uom = p.uom || 'pc';
            line.supplierId = p.defaultSupplierId || '';
            line.costCurrency = p.currency || currentCurrency();
            line.costExchangeRate = referenceRate(line.costCurrency, currentCurrency(), settings);
            // BUG FIX: both of these fields already exist on a quotation line, and the product
            // catalog already has a value for them, but neither was actually being copied over
            // when picking an item — Default Markup % and Typical Lead Time were silently
            // dropped, always left at the line's own blank/zero default instead.
            line.markupPercent = p.markupPercent || 0;
            line.leadTime = p.leadTime || '';
            // Catalog freight is for a quantity (amount / 'covers qty' = per unit); the line stores TOTAL freight for the row.
            line.freightMode = 'total';
            line.priceOverridden = false;
            line.estimatedFreightCost = productFreightPerUnit(p) * (Number(line.qty) || 1);
            delete line.freightNote;
            // Remember the catalog RATE so the freight follows the quantity until the user takes over.
            line.freightSource = 'catalog';
            line.catalogFreightPerUnit = productFreightPerUnit(p);
            qtyReminders.delete(line.lineId);
            // BUG FIX (follow-up, twice now): unitPrice was originally set directly from
            // p.standardPrice, completely bypassing markup -- a markup-priced product with no
            // separately-typed Standard Selling Price landed at ₱0.00 despite showing the right
            // markup value. First fix computed price from cost+markup, but only when
            // line.markupPercent was truthy -- and 0 is falsy in JS, so an explicit 0% markup
            // (meaning "sell at cost", exactly what this conversation is about) still fell
            // through to Standard Selling Price and could still zero out. Always compute from
            // cost+markup now, unconditionally -- the same formula every other cost/markup edit
            // on this line already uses. Standard Selling Price is a catalog reference value for
            // browsing the product list, not something that overrides the live cost+markup
            // relationship once an item is actually on a quotation line.
            line.unitPrice = computeMarkupPrice(line, currentCurrency());
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
  document.getElementById('f_freightCharge').addEventListener('input', refreshFreightNote);

  /** One supplier freight total covering several different items -> split across the chosen rows
      (rows must share the shipment's currency, so no currency conversion can distort the split). */
  document.getElementById('btnSplitFreight').onclick = () => {
    const qCur = currentCurrency();
    const ccys = [...new Set(lines.map(l => l.costCurrency || qCur))];
    const overlay = document.createElement('div');
    overlay.className = 'item-picker-overlay';
    overlay.innerHTML = `<div class="item-picker-box" style="max-width:720px;">
      <div class="item-picker-header"><h3>Split shipment freight across items</h3></div>
      <div style="padding:12px 16px;">
        <div style="display:flex; gap:12px; flex-wrap:wrap; align-items:flex-end;">
          <div class="field"><label>Shipment freight total</label><input type="number" min="0" step="0.01" id="sf_total" value="0" style="width:120px;"></div>
          <div class="field"><label>Currency</label><select id="sf_ccy">${ccys.map(c => `<option>${escapeHtml(c)}</option>`).join('')}</select></div>
          <div class="field"><label>Split by</label><select id="sf_method"><option value="cost">Item cost (fairest for mixed items)</option><option value="qty">Quantity</option><option value="manual">Manual</option></select></div>
        </div>
        <table class="data-table compact" style="margin-top:10px;"><thead><tr><th></th><th>#</th><th>Item</th><th>Qty</th><th>Cost value</th><th>Freight share</th></tr></thead><tbody id="sf_rows"></tbody></table>
        <div id="sf_summary" style="margin-top:8px; font-weight:600;"></div>
        <p class="muted-text" style="font-size:12px;">Only rows whose Cost Ccy matches the shipment currency can be included. Applying replaces those rows' Total Freight; you can still edit any row afterwards.</p>
      </div>
      <div class="item-picker-footer"><button type="button" class="btn-amber btn-sm" id="sf_apply">Apply</button> <button type="button" class="btn-line btn-sm" id="sf_cancel">Cancel</button></div></div>`;
    document.body.appendChild(overlay);
    const $ = (id) => overlay.querySelector('#' + id);
    const picked = new Set(); const manual = {};
    let lastCcy = null;
    const eligible = () => lines.filter(l => (l.costCurrency || qCur) === $('sf_ccy').value);
    function render(full) {
      const el = eligible();
      if (full || lastCcy !== $('sf_ccy').value) { picked.clear(); el.forEach(l => picked.add(l.lineId)); lastCcy = $('sf_ccy').value; }
      const chosen = el.filter(l => picked.has(l.lineId));
      const method = $('sf_method').value, total = Number($('sf_total').value) || 0;
      const res = allocateFreight(chosen.map(l => ({ lineId: l.lineId, qty: l.qty, unitCost: l.unitCost })), total, method, manual);
      $('sf_rows').innerHTML = lines.map((l, i) => {
        const ok = el.includes(l), on = picked.has(l.lineId);
        const share = on ? res.shares[l.lineId] : 0;
        return `<tr data-lid="${l.lineId}" style="${ok ? '' : 'opacity:.45;'}"><td><input type="checkbox" class="sf_pick" ${on ? 'checked' : ''} ${ok ? '' : 'disabled'}></td><td>${i + 1}</td><td>${escapeHtml(l.description || '(no description)')}${ok ? '' : ' <span class="muted-text">(' + escapeHtml(l.costCurrency || qCur) + ')</span>'}</td><td>${l.qty}</td><td>${formatMoney((Number(l.unitCost) || 0) * (Number(l.qty) || 0), l.costCurrency || qCur)}</td><td>${method === 'manual' && on ? `<input type="number" step="0.01" min="0" class="sf_manual" value="${manual[l.lineId] ?? ''}" style="width:90px;">` : (on ? formatMoney(share, $('sf_ccy').value) : '—')}</td></tr>`;
      }).join('');
      overlay.querySelectorAll('.sf_pick').forEach(cb => cb.addEventListener('change', () => { const lid = cb.closest('tr').dataset.lid; cb.checked ? picked.add(lid) : picked.delete(lid); render(); }));
      overlay.querySelectorAll('.sf_manual').forEach(inp => inp.addEventListener('input', () => { manual[inp.closest('tr').dataset.lid] = inp.value; refreshSummary(); }));
      refreshSummary();
    }
    function refreshSummary() {
      const el = eligible().filter(l => picked.has(l.lineId));
      const total = Number($('sf_total').value) || 0, method = $('sf_method').value;
      const res = allocateFreight(el.map(l => ({ lineId: l.lineId, qty: l.qty, unitCost: l.unitCost })), total, method, manual);
      const ccy = $('sf_ccy').value;
      const balanced = el.length > 0 && total > 0 && Math.abs(res.unassigned) < 0.005;
      $('sf_summary').innerHTML = `Allocated ${formatMoney(res.allocated, ccy)} of ${formatMoney(total, ccy)}` + (balanced ? ' <span style="color:var(--ok, #15803d);">✓</span>' : ` <span style="color:#b45309;">— ${el.length === 0 ? 'select at least one row' : (total <= 0 ? 'enter the shipment total' : 'unassigned ' + formatMoney(res.unassigned, ccy))}</span>`);
      $('sf_apply').disabled = !balanced;
      if (method === 'manual') return;
      overlay.querySelectorAll('#sf_rows tr').forEach(tr => { const c = tr.children[5]; if (picked.has(tr.dataset.lid) && c && !c.querySelector('input')) c.textContent = formatMoney(res.shares[tr.dataset.lid] || 0, ccy); });
    }
    const close = () => { if (overlay.parentNode) document.body.removeChild(overlay); };
    $('sf_total').addEventListener('input', () => render());
    $('sf_ccy').addEventListener('change', () => render(true));
    $('sf_method').addEventListener('change', () => render());
    $('sf_cancel').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    $('sf_apply').addEventListener('click', () => {
      const chosen = eligible().filter(l => picked.has(l.lineId));
      const total = Number($('sf_total').value) || 0, method = $('sf_method').value, ccy = $('sf_ccy').value;
      const res = allocateFreight(chosen.map(l => ({ lineId: l.lineId, qty: l.qty, unitCost: l.unitCost })), total, method, manual);
      if (!chosen.length || Math.abs(res.unassigned) >= 0.005) return;
      chosen.forEach(l => {
        l.freightMode = 'total';
        delete l.freightSource; delete l.catalogFreightPerUnit;
        l.estimatedFreightCost = res.shares[l.lineId];
        l.freightNote = `Share of shipment ${formatMoney(total, ccy)} (${method === 'cost' ? 'by cost' : method === 'qty' ? 'by qty' : 'manual'})`;
        qtyReminders.delete(l.lineId);
        if (!l.priceOverridden) l.unitPrice = lineCalcPrice(l, qCur);
      });
      close(); drawLines(); refreshTotals(); markDirty();
    });
    render(true);
  };

  document.getElementById('btnAddLine').onclick = () => {
    const headerVat = document.getElementById('f_vatMode').value;
    lines.push(emptyLine(headerVat === 'Standard12' ? 12 : 0));
    drawLines(); refreshTotals(); markDirty();
  };
  content.querySelectorAll('#qForm input, #qForm select, #qForm textarea').forEach(i => i.addEventListener('input', () => { markDirty(); refreshTotals(); }));

  // Both hints show only the ONE relevant explanation for whatever's currently selected/typed,
  // not a static list of every possibility -- updates live as the person changes either field.
  const vatModeHintEl = document.getElementById('vatModeHint');
  const updateVatHint = () => { vatModeHintEl.textContent = VAT_MODE_EXPLANATIONS[document.getElementById('f_vatMode').value] || ''; };
  updateVatHint();
  document.getElementById('f_vatMode').addEventListener('change', updateVatHint);

  const incotermsHintEl = document.getElementById('incotermsHint');
  const updateIncotermsHint = () => {
    const matched = matchIncoterm(document.getElementById('f_incoterms').value);
    incotermsHintEl.innerHTML = matched ? INCOTERMS_EXPLANATIONS[matched] : '';
  };
  updateIncotermsHint();
  document.getElementById('f_incoterms').addEventListener('input', updateIncotermsHint);

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
    updateIncotermsHint();
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
  const vatModeLabel = { NonVat: 'Non-VAT (Percentage Tax)', Standard12: 'Standard 12%', ZeroRated: 'Zero-Rated', Exempt: 'VAT Exempt' }[q.vatMode] || (q.vatMode || '—');

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
    const fCcy = l.costCurrency || q.currency;
    const fRate = Number(l.costExchangeRate) || 1;
    const fAmt = Number(l.estimatedFreightCost) || 0;
    const fConv = (fCcy !== q.currency) ? ` <span class="muted-text">(→${formatMoney(fAmt * fRate, q.currency)})</span>` : '';
    const freightDisplay = isTotalFreight(l)
      ? `${formatMoney(fAmt, fCcy)}${fConv}<div class="muted-text" style="font-size:10px;">${formatMoney(lineFreightPerUnit(l), fCcy)}/unit</div>`
      : `${formatMoney(fAmt, fCcy)}${fConv}<div style="font-size:10px; color:#b45309;">per unit (old) — review</div>`;
    return `<tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(l.brand ? l.brand + ' — ' : '')}${escapeHtml(l.modelNo ? l.modelNo + ' — ' : '')}${escapeHtml(l.description)}</td>
      <td>${l.qty} ${escapeHtml(l.uom)}</td>
      <td class="internal-only-col" title="For internal reference only — not shown on the printed quotation">${escapeHtml(l.leadTime || '—')}</td>
      <td class="internal-only-col" title="For internal reference only — not shown on the printed quotation">${freightDisplay}</td>
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
  const lineItemsHead = `<thead><tr><th>#</th><th>Description</th><th>Qty</th><th class="internal-only-col">Lead Time</th><th class="internal-only-col">Total Freight for This Line</th><th class="internal-only-col">Unit Cost</th><th class="internal-only-col">Supplier</th><th>Unit Price</th><th>Disc%</th><th>VAT%</th><th class="internal-only-col">Margin%</th><th>Amount</th><th class="internal-only-col">Amount w/ VAT</th></tr></thead>`;
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
      // A revision is meant to be a fresh start -- carrying forward the OLD Valid Until date
      // would mean revising an already-expired quotation just creates another quotation
      // that's immediately expired too, the moment it's saved. Reset it the same way a
      // brand-new quotation gets its default validity period, not left stale.
      validUntil: addDaysISO(todayISO(), settings.defaultQuotationValidityDays),
      validityHistory: [],
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

window.QuoteCalc = { allocateFreight, productFreightPerUnit, computeLine, computeQuotationTotals, lineFreightPerUnit, lineLandedUnitCost, lineCalcPrice, convertLegacyFreight };
window.QUOTE_STATUSES = QUOTE_STATUSES;
