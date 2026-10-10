/* ============================================================
   dashboard.js — home screen: summary cards, quick actions, activity feed
   ============================================================ */

Router.route('/dashboard', async () => {
  Router.setBreadcrumb([{ label: 'Dashboard' }]);
  const [customers, suppliers, quotations, customerPOs, salesOrders, supplierPOs, activity, proformaInvoicesRaw, technicalOffers, notes, distributions] = await Promise.all([
    DB.dbGetAll('customers'), DB.dbGetAll('suppliers'), DB.dbGetAll('quotations'),
    DB.dbGetAll('customerPOs'), DB.dbGetAll('salesOrders'), DB.dbGetAll('supplierPOs'), DB.recentActivity(12),
    DB.dbGetAll('proformaInvoices'), DB.dbGetAll('technicalOffers'), DB.dbGetAll('notes'), DB.dbGetAll('distributions')
  ]);
  // Migrate any pre-payment-tracking invoices here too, the same way the Payments list does --
  // otherwise an invoice nobody has opened yet could still show a stale ₱0.00 in these stats.
  const proformaInvoices = await Promise.all(proformaInvoicesRaw.map(pi => ProformaInvoices.ensurePISnapshot(pi)));

  const latestQuotes = quotations.filter(q => q.isLatest);
  const activeCustomers = customers.filter(c => c.status === 'Active' && !c.archived).length;
  const activeSuppliers = suppliers.filter(s => s.status === 'Active' && !s.archived).length;
  const openQuotes = latestQuotes.filter(q => ['Draft', 'Sent', 'Under Review'].includes(q.status)).length;
  const awaitingResponse = latestQuotes.filter(q => q.status === 'Sent' || q.status === 'Under Review').length;
  const wonQuotes = latestQuotes.filter(q => q.status === 'Won').length;
  const lostQuotes = latestQuotes.filter(q => q.status === 'Lost').length;
  const winRate = (wonQuotes + lostQuotes) > 0 ? Math.round((wonQuotes / (wonQuotes + lostQuotes)) * 100) : 0;
  const cpoReceived = customerPOs.length;
  const openSO = salesOrders.filter(o => !['Delivered', 'Cancelled'].includes(o.status)).length;
  // Cancelled Supplier POs are not a debt and not waiting for anything.
  const liveSPOs = supplierPOs.filter(p => p.status !== 'Cancelled');
  // Ordered from the supplier but not fully received yet (a Draft has not been ordered).
  const spoAwaitingReceipt = liveSPOs.filter(p => !['Draft', 'Received'].includes(p.status) && (p.lines || []).some(l => (l.receivedQty || 0) < l.qty));
  const awaitingDeliveryOrders = salesOrders.filter(o => ['Ready for Delivery', 'Partially Delivered'].includes(o.status));
  const awaitingDelivery = awaitingDeliveryOrders.length;
  const completedOrders = salesOrders.filter(o => o.status === 'Delivered').length;
  const outstandingValue = salesOrders.filter(o => !['Delivered', 'Cancelled'].includes(o.status)).reduce((s, o) => s + (o.grandTotal || 0), 0);
  const expiredNeedingReview = latestQuotes.filter(q => getExpiryInfo(q).state === 'expired');
  const expiringWithin7 = latestQuotes.filter(q => ['today', 'soon'].includes(getExpiryInfo(q).state));

  // Outstanding invoices can span more than one currency (PHP, USD, ...) -- summing them into a
  // single figure would silently add mismatched currencies together, so this groups by currency
  // instead and only shows a tile for currencies that actually have something outstanding.
  const outstandingPIs = proformaInvoices.filter(pi => ProformaInvoices.piPaymentStatus(pi) !== 'Paid');
  const outstandingByCurrency = {};
  outstandingPIs.forEach(pi => {
    const cur = pi.currency || 'PHP';
    outstandingByCurrency[cur] = (outstandingByCurrency[cur] || 0) + ProformaInvoices.piBalanceDue(pi);
  });
  // Mirror of the customer-side outstanding stats above, but for what WE owe suppliers rather
  // than what customers owe us. Same reasoning on currency: local suppliers bill in PHP,
  // overseas ones (e.g. Pentair) in USD, so this is broken down per-currency too rather than
  // summed into one meaningless combined figure.
  const outstandingSPOs = liveSPOs.filter(po => (po.totalCost || 0) > 0 && SupplierPOs.spoPaymentStatus(po) !== 'Paid');
  const owedByCurrency = {};
  outstandingSPOs.forEach(po => {
    const cur = po.currency || 'PHP';
    owedByCurrency[cur] = (owedByCurrency[cur] || 0) + SupplierPOs.spoBalanceDue(po);
  });
  const totalTechnicalOffers = technicalOffers.length;
  const offersAwaitingResponse = technicalOffers.filter(t => t.status === 'Sent').length;
  const offersNeedingRevision = technicalOffers.filter(t => t.status === 'Revision Requested').length;
  // "Needing action" = overdue or due today specifically -- the same two states that get the
  // red row highlight on the Notes list itself, so this tile and that page always agree.
  const notesNeedingAction = notes.filter(n => ['overdue', 'today'].includes(getReminderInfo(n).state)).length;
  // Running total of everything ever held back as reserve, across every distribution made --
  // the same figure the Distributions page itself shows, kept in sync since both read from the
  // same underlying records rather than a separately-maintained balance that could drift.
  // Balance = everything set aside minus what was recorded as used (Distributions -> Use Reserve).
  const reserveSettings = await DB.getSettings();
  const totalReserve = r2(distributions.reduce((s, d) => s + (d.reserveAmount || 0), 0) - (reserveSettings.reserveWithdrawals || []).reduce((s, w) => s + (Number(w.amount) || 0), 0));

  // sales value by month (last 6 months) from sales orders
  const monthMap = {};
  salesOrders.forEach(o => {
    if (!o.orderDate || ['Cancelled', 'Draft'].includes(o.status)) return;
    const key = o.orderDate.slice(0, 7);
    monthMap[key] = (monthMap[key] || 0) + (o.grandTotal || 0);
  });
  const months = Object.keys(monthMap).sort().slice(-6);
  const maxVal = Math.max(1, ...months.map(m => monthMap[m]));

  // ---- Chart data -------------------------------------------------------------------------
  const monthLabel = (m) => new Date(m + '-01T00:00:00').toLocaleDateString('en-US', { month: 'short' }) + " '" + m.slice(2, 4);
  const pipeline = [
    { label: 'Draft', n: latestQuotes.filter(q => q.status === 'Draft').length, color: '#2a78d6' },
    { label: 'Sent', n: latestQuotes.filter(q => q.status === 'Sent').length, color: '#eb6834' },
    { label: 'Under Review', n: latestQuotes.filter(q => q.status === 'Under Review').length, color: '#eda100' },
    { label: 'Won', n: wonQuotes, color: '#1baf7a' },
    { label: 'Lost', n: lostQuotes, color: '#e34948' }
  ];
  const soStages = ['Draft', 'Confirmed', 'Sourcing', 'Ordered from Supplier', 'Partially Received', 'Ready for Delivery', 'Partially Delivered', 'Delivered']
    .map(st => ({ label: st, n: salesOrders.filter(o => o.status === st).length }));
  const collectByCur = outstandingByCurrency; const payByCur = owedByCurrency;
  const moneyCurs = [...new Set([...Object.keys(collectByCur), ...Object.keys(payByCur)])].sort();
  const attention = [
    { n: awaitingDelivery, text: 'Orders ready to deliver', hash: '/sales-orders' },
    { n: spoAwaitingReceipt.length, text: 'Supplier POs to receive', hash: '/supplier-pos' },
    { n: outstandingPIs.length, text: 'Invoices to collect', hash: '/payments' },
    { n: outstandingSPOs.length, text: 'Supplier POs to pay', hash: '/supplier-pos' },
    { n: expiringWithin7.length, text: 'Quotations expiring in 7 days', hash: '/quotations' },
    { n: expiredNeedingReview.length, text: 'Expired quotations', hash: '/quotations?status=Expired' },
    { n: notesNeedingAction, text: 'Notes needing action', hash: '/notes' }
  ];
  const allClear = attention.every(a => a.n === 0);

  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="page-head"><h1>Dashboard</h1></div>

    <div class="quick-actions">
      <button class="qa-btn" data-hash="/customers/new">+ New Customer</button>
      <button class="qa-btn" data-hash="/suppliers/new">+ New Supplier</button>
      <button class="qa-btn" data-hash="/products/new">+ New Product</button>
      <button class="qa-btn" data-hash="/quotations/new">+ New Quotation</button>
      <button class="qa-btn" data-hash="/customer-pos/new">Record Customer PO</button>
      <button class="qa-btn" data-hash="/technical-offers/new">+ New Technical Offer</button>
      <button class="qa-btn" data-hash="/notes/new">+ New Note</button>
      <button class="qa-btn" data-hash="/distributions/new">+ New Distribution</button>
      <button class="qa-btn" data-hash="/reports">Search Records</button>
      <button class="qa-btn" data-hash="/settings/backup">Backup Data</button>
    </div>

    <div class="card attention-card">
      <h3 class="section-title">Needs your attention${allClear ? ' — all clear ✓' : ''}</h3>
      <div class="attention-row">
        ${attention.map(a => `<button type="button" class="att-chip ${a.n > 0 ? 'on' : 'off'}" data-hash="${a.hash}"><span class="att-num">${a.n}</span><span class="att-txt">${a.n > 0 ? '' : '✓ '}${escapeHtml(a.text)}</span></button>`).join('')}
      </div>
    </div>

    <div class="dash-grid">
      <div class="card">
        <h3 class="section-title">Sales Value by Month</h3>
        <div class="viz-sub">Confirmed orders (Draft and Cancelled left out), last 6 months</div>
        ${months.length === 0 ? `<div class="empty-inline">No sales orders yet.</div>` : barChartSVG(months.map(m => ({ label: monthLabel(m), v: monthMap[m] })))}
        <div class="stat-inline">Outstanding Order Value: <b>${formatMoney(outstandingValue)}</b></div>
      </div>

      <div class="card">
        <h3 class="section-title">Quotation Pipeline</h3>
        <div class="viz-sub">Latest revision of every quotation · Win rate ${winRate}%</div>
        ${donutSVG(pipeline)}
      </div>
    </div>

    <div class="dash-grid dash-grid-even">
      <div class="card">
        <h3 class="section-title">Orders by Progress</h3>
        <div class="viz-sub">Where every sales order stands right now</div>
        ${hbarsHTML(soStages, '#2a78d6', '/sales-orders')}
      </div>

      <div class="card">
        <h3 class="section-title">Money: To Collect vs To Pay</h3>
        <div class="viz-sub">Unpaid invoices to customers vs unpaid Supplier POs</div>
        ${moneyCurs.length === 0 ? `<div class="empty-inline">Nothing outstanding either way.</div>` : moneyCurs.map(cur => {
          const a = collectByCur[cur] || 0, b = payByCur[cur] || 0, mx = Math.max(a, b, 1);
          return `<div class="money-block"><div class="money-cur">${cur}</div>
            <div class="hbar-row" data-tip="To collect (${cur}): ${escapeHtml(formatMoney(a, cur))}"><span class="hbar-lbl">To collect</span><span class="hbar-track"><span class="hbar-fill" style="width:${Math.max(a > 0 ? 3 : 0, a / mx * 100)}%; background:#1baf7a;"></span></span><span class="hbar-val">${escapeHtml(formatMoney(a, cur))}</span></div>
            <div class="hbar-row" data-tip="To pay suppliers (${cur}): ${escapeHtml(formatMoney(b, cur))}"><span class="hbar-lbl">To pay</span><span class="hbar-track"><span class="hbar-fill" style="width:${Math.max(b > 0 ? 3 : 0, b / mx * 100)}%; background:#eb6834;"></span></span><span class="hbar-val">${escapeHtml(formatMoney(b, cur))}</span></div></div>`;
        }).join('')}
      </div>
    </div>

    <h3 class="dash-heading">All the numbers</h3>
    <div class="stat-grid">
      ${statCard(activeCustomers, 'Active Customers', '/customers')}
      ${statCard(activeSuppliers, 'Active Suppliers', '/suppliers')}
      ${statCard(openQuotes, 'Open Quotations', '/quotations')}
      ${statCard(awaitingResponse, 'Awaiting Customer Response', '/quotations')}
      ${statCard(expiringWithin7.length, 'Quotations Expiring Within 7 Days', '/quotations')}
      ${statCard(expiredNeedingReview.length, 'Expired Quotations Needing Review', '/quotations?status=Expired')}
      ${statCard(wonQuotes, 'Won Quotations', '/quotations')}
      ${statCard(lostQuotes, 'Lost Quotations', '/quotations')}
      ${statCard(cpoReceived, 'Customer POs Received', '/customer-pos')}
      ${statCard(openSO, 'Open Sales Orders', '/sales-orders')}
      ${statCard(spoAwaitingReceipt.length, 'Supplier POs Awaiting Receipt', '/supplier-pos')}
      ${statCard(awaitingDelivery, 'Orders Awaiting Delivery', '/sales-orders')}
      ${statCard(completedOrders, 'Delivered Orders', '/sales-orders')}
      ${statCard(winRate + '%', 'Quotation Win Rate', '/quotations')}
      ${statCard(outstandingPIs.length, 'Invoices Awaiting Payment', '/payments')}
      ${Object.keys(outstandingByCurrency).sort().map(cur => statCard(formatMoney(outstandingByCurrency[cur], cur), `Outstanding (${cur})`, '/payments')).join('')}
      ${statCard(outstandingSPOs.length, 'Supplier POs Awaiting Payment', '/supplier-pos')}
      ${Object.keys(owedByCurrency).sort().map(cur => statCard(formatMoney(owedByCurrency[cur], cur), `Owed to Suppliers (${cur})`, '/supplier-pos')).join('')}
      ${statCard(totalTechnicalOffers, 'Technical Offers', '/technical-offers')}
      ${statCard(offersAwaitingResponse, 'Technical Offers Awaiting Response', '/technical-offers')}
      ${statCard(offersNeedingRevision, 'Technical Offers Needing Revision', '/technical-offers')}
      ${statCard(notesNeedingAction, 'Notes Needing Action', '/notes')}
      ${statCard(formatMoney(totalReserve, 'PHP'), 'Business Reserve', '/distributions')}
    </div>

    <div class="dash-grid dash-grid-even">
      <div class="card">
        <h3 class="section-title">Expired Quotations — Needs Review</h3>
        ${expiredNeedingReview.length === 0 ? `<div class="empty-inline">None — nothing overdue.</div>` : `
        <table class="data-table compact"><tbody>
          ${expiredNeedingReview.map(q => `<tr class="clickable-row" data-hash="/quotations/${q.id}"><td>${escapeHtml(q.quotationNo)}</td><td>${escapeHtml(q.customerSnapshot?.companyName || '')}</td><td class="text-danger">${escapeHtml(getExpiryInfo(q).text)}</td></tr>`).join('')}
        </tbody></table>`}
      </div>

      <div class="card">
        <h3 class="section-title">Quotations Expiring Soon</h3>
        ${expiringWithin7.length === 0 ? `<div class="empty-inline">None in the next 7 days.</div>` : `
        <table class="data-table compact"><tbody>
          ${expiringWithin7.map(q => `<tr class="clickable-row" data-hash="/quotations/${q.id}"><td>${escapeHtml(q.quotationNo)}</td><td>${escapeHtml(q.customerSnapshot?.companyName || '')}</td><td class="${getExpiryInfo(q).state === 'today' ? 'text-amber' : 'text-warn'}">${escapeHtml(getExpiryInfo(q).text)}</td></tr>`).join('')}
        </tbody></table>`}
      </div>
    </div>

    <div class="card">
      <h3 class="section-title">Recent Activity</h3>
      ${activity.length === 0 ? `<div class="empty-inline">No activity yet — start by adding a customer or supplier.</div>` : `
      <ul class="activity-list">
        ${activity.map(a => `<li><span class="activity-dot"></span>${escapeHtml(a.text)} <span class="activity-time">${formatDate(a.date)}</span></li>`).join('')}
      </ul>`}
    </div>
  `;

  content.querySelectorAll('[data-hash]').forEach(b => b.onclick = () => Router.navigate(b.dataset.hash));
});

/* ---------- Small chart helpers (inline SVG / HTML — no libraries, works offline) ---------- */
function shortMoney(n) {
  const a = Math.abs(n);
  if (a >= 1e6) return '₱' + (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (a >= 1e3) return '₱' + (n / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'K';
  return '₱' + Math.round(n);
}
function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v))); const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
function barChartSVG(rows) {
  const W = 560, H = 230, L = 52, R = 10, T = 12, B = 30;
  const max = niceMax(Math.max(...rows.map(r => r.v), 1));
  const iw = W - L - R, ih = H - T - B, slot = iw / rows.length, bw = Math.min(46, slot * 0.55);
  const grid = [0, 1, 2, 3, 4].map(i => { const y = T + ih - (ih * i / 4); return `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" class="viz-grid"/><text x="${L - 8}" y="${y + 4}" text-anchor="end" class="viz-axis">${shortMoney(max * i / 4)}</text>`; }).join('');
  const bars = rows.map((r, i) => {
    const h = Math.max(r.v > 0 ? 3 : 0, ih * r.v / max), x = L + slot * i + (slot - bw) / 2, y = T + ih - h;
    return `<g class="viz-hit" data-tip="${escapeHtml(r.label)}: ${escapeHtml(formatMoney(r.v))}"><rect x="${L + slot * i}" y="${T}" width="${slot}" height="${ih}" fill="transparent"/>
      <path class="viz-bar" d="M${x},${T + ih} V${y + 4} Q${x},${y} ${x + 4},${y} H${x + bw - 4} Q${x + bw},${y} ${x + bw},${y + 4} V${T + ih} Z" fill="#c8720a"/>
      <text x="${x + bw / 2}" y="${y - 5}" text-anchor="middle" class="viz-val">${r.v > 0 ? shortMoney(r.v) : ''}</text>
      <text x="${x + bw / 2}" y="${H - 10}" text-anchor="middle" class="viz-axis">${escapeHtml(r.label)}</text></g>`;
  }).join('');
  return `<svg class="viz-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Sales value by month">${grid}${bars}</svg>`;
}
function donutSVG(segs) {
  const total = segs.reduce((s, x) => s + x.n, 0);
  if (total === 0) return `<div class="empty-inline">No quotations yet.</div>`;
  const R = 62, C = 2 * Math.PI * R; let off = 0;
  const arcs = segs.filter(x => x.n > 0).map(x => {
    const len = C * x.n / total, gap = segs.filter(y => y.n > 0).length > 1 ? 2 : 0;
    const el = `<circle class="viz-hit viz-arc" data-tip="${escapeHtml(x.label)}: ${x.n} (${Math.round(x.n / total * 100)}%)" cx="80" cy="80" r="${R}" fill="none" stroke="${x.color}" stroke-width="22" stroke-dasharray="${Math.max(len - gap, 0.5)} ${C - Math.max(len - gap, 0.5)}" stroke-dashoffset="${-off}" transform="rotate(-90 80 80)"/>`;
    off += len; return el;
  }).join('');
  const legend = segs.map(x => `<li data-tip="${escapeHtml(x.label)}: ${x.n}"><span class="dot" style="background:${x.color}"></span><span class="lg-lbl">${escapeHtml(x.label)}</span><span class="lg-n">${x.n}</span><span class="lg-pct">${Math.round(x.n / total * 100)}%</span></li>`).join('');
  return `<div class="donut-wrap"><svg class="donut-svg" viewBox="0 0 160 160" role="img" aria-label="Quotations by status">${arcs}<text x="80" y="78" text-anchor="middle" class="donut-num">${total}</text><text x="80" y="96" text-anchor="middle" class="viz-axis">quotations</text></svg><ul class="donut-legend">${legend}</ul></div>`;
}
function hbarsHTML(rows, color, hash) {
  const max = Math.max(...rows.map(r => r.n), 1);
  return `<div class="hbars">${rows.map(r => `<div class="hbar-row" data-hash="${hash}" data-tip="${escapeHtml(r.label)}: ${r.n}"><span class="hbar-lbl">${escapeHtml(r.label)}</span><span class="hbar-track"><span class="hbar-fill" style="width:${r.n > 0 ? Math.max(3, r.n / max * 100) : 0}%; background:${color};"></span></span><span class="hbar-val">${r.n}</span></div>`).join('')}</div>`;
}
(function bindVizTooltip() {
  if (window.__vizTipBound) return; window.__vizTipBound = true;
  let tip = null;
  const ensure = () => tip || (tip = Object.assign(document.createElement('div'), { className: 'viz-tip' }), document.body.appendChild(tip), tip);
  document.addEventListener('mouseover', (e) => {
    const t = e.target.closest && e.target.closest('[data-tip]'); if (!t) return;
    const el = ensure(); el.textContent = t.getAttribute('data-tip'); el.style.display = 'block';
  });
  document.addEventListener('mousemove', (e) => { if (tip && tip.style.display === 'block') { tip.style.left = (e.clientX + 14) + 'px'; tip.style.top = (e.clientY + 14) + 'px'; } });
  document.addEventListener('mouseout', (e) => { const t = e.target.closest && e.target.closest('[data-tip]'); if (t && tip) tip.style.display = 'none'; });
})();

function statCard(value, label, hash) {
  return `<div class="stat-card${hash ? ' clickable' : ''}" ${hash ? `data-hash="${hash}" tabindex="0"` : ''}><div class="stat-card-num">${value}</div><div class="stat-card-lbl">${escapeHtml(label)}</div></div>`;
}
