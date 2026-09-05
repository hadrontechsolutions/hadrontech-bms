/* ============================================================
   dashboard.js — home screen: summary cards, quick actions, activity feed
   ============================================================ */

Router.route('/dashboard', async () => {
  Router.setBreadcrumb([{ label: 'Dashboard' }]);
  const [customers, suppliers, quotations, customerPOs, salesOrders, supplierPOs, activity, proformaInvoicesRaw, technicalOffers] = await Promise.all([
    DB.dbGetAll('customers'), DB.dbGetAll('suppliers'), DB.dbGetAll('quotations'),
    DB.dbGetAll('customerPOs'), DB.dbGetAll('salesOrders'), DB.dbGetAll('supplierPOs'), DB.recentActivity(12),
    DB.dbGetAll('proformaInvoices'), DB.dbGetAll('technicalOffers')
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
  const spoAwaiting = supplierPOs.filter(p => p.status === 'Awaiting Confirmation').length;
  const awaitingDelivery = salesOrders.filter(o => ['Ready for Delivery', 'Partially Received'].includes(o.status)).length;
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
  const outstandingSPOs = supplierPOs.filter(po => SupplierPOs.spoPaymentStatus(po) !== 'Paid');
  const owedByCurrency = {};
  outstandingSPOs.forEach(po => {
    const cur = po.currency || 'PHP';
    owedByCurrency[cur] = (owedByCurrency[cur] || 0) + SupplierPOs.spoBalanceDue(po);
  });
  const totalTechnicalOffers = technicalOffers.length;
  const offersAwaitingResponse = technicalOffers.filter(t => t.status === 'Sent').length;
  const offersNeedingRevision = technicalOffers.filter(t => t.status === 'Revision Requested').length;

  // sales value by month (last 6 months) from sales orders
  const monthMap = {};
  salesOrders.forEach(o => {
    if (!o.orderDate) return;
    const key = o.orderDate.slice(0, 7);
    monthMap[key] = (monthMap[key] || 0) + (o.grandTotal || 0);
  });
  const months = Object.keys(monthMap).sort().slice(-6);
  const maxVal = Math.max(1, ...months.map(m => monthMap[m]));

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
      <button class="qa-btn" data-hash="/reports">Search Records</button>
      <button class="qa-btn" data-hash="/settings/backup">Backup Data</button>
    </div>

    <div class="stat-grid">
      ${statCard(activeCustomers, 'Active Customers')}
      ${statCard(activeSuppliers, 'Active Suppliers')}
      ${statCard(openQuotes, 'Open Quotations')}
      ${statCard(awaitingResponse, 'Awaiting Customer Response')}
      ${statCard(expiringWithin7.length, 'Quotations Expiring Within 7 Days')}
      ${statCard(expiredNeedingReview.length, 'Expired Quotations Needing Review')}
      ${statCard(wonQuotes, 'Won Quotations')}
      ${statCard(lostQuotes, 'Lost Quotations')}
      ${statCard(cpoReceived, 'Customer POs Received')}
      ${statCard(openSO, 'Open Sales Orders')}
      ${statCard(spoAwaiting, 'Supplier POs Awaiting Confirmation')}
      ${statCard(awaitingDelivery, 'Orders Awaiting Delivery')}
      ${statCard(completedOrders, 'Delivered Orders')}
      ${statCard(winRate + '%', 'Quotation Win Rate')}
      ${statCard(outstandingPIs.length, 'Invoices Awaiting Payment')}
      ${Object.keys(outstandingByCurrency).sort().map(cur => statCard(formatMoney(outstandingByCurrency[cur], cur), `Outstanding (${cur})`)).join('')}
      ${statCard(outstandingSPOs.length, 'Supplier POs Awaiting Payment')}
      ${Object.keys(owedByCurrency).sort().map(cur => statCard(formatMoney(owedByCurrency[cur], cur), `Owed to Suppliers (${cur})`)).join('')}
      ${statCard(totalTechnicalOffers, 'Technical Offers')}
      ${statCard(offersAwaitingResponse, 'Technical Offers Awaiting Response')}
      ${statCard(offersNeedingRevision, 'Technical Offers Needing Revision')}
    </div>

    <div class="dash-grid">
      <div class="card">
        <h3 class="section-title">Sales Value by Month</h3>
        ${months.length === 0 ? `<div class="empty-inline">No sales orders yet.</div>` : `
        <div class="bar-chart">
          ${months.map(m => `
            <div class="bar-col">
              <div class="bar" style="height:${Math.max(6, (monthMap[m] / maxVal) * 130)}px;" title="${formatMoney(monthMap[m])}"></div>
              <div class="bar-label">${m}</div>
            </div>`).join('')}
        </div>`}
        <div class="stat-inline">Outstanding Order Value: <b>${formatMoney(outstandingValue)}</b></div>
      </div>

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

function statCard(value, label) {
  return `<div class="stat-card"><div class="stat-card-num">${value}</div><div class="stat-card-lbl">${escapeHtml(label)}</div></div>`;
}
