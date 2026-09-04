/* ============================================================
   search.js — global search across customers, suppliers, quotations,
   customer POs, sales orders, supplier POs, products
   ============================================================ */

Router.route('/search', (p, query) => renderSearch(query.q || ''));

async function renderSearch(initialQuery) {
  Router.setBreadcrumb([{ label: 'Search' }]);
  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="page-head"><h1>Search Records</h1></div>
    <div class="card">
      <input type="search" id="globalSearchInput" class="search-box" style="width:100%;" placeholder="Search customers, suppliers, quotations, POs, orders, brands, part numbers..." value="${escapeHtml(initialQuery)}">
    </div>
    <div id="searchResults"></div>
  `;
  const input = document.getElementById('globalSearchInput');
  input.focus();
  const run = debounce(async () => {
    const q = input.value.trim();
    if (!q) { document.getElementById('searchResults').innerHTML = ''; return; }
    await doSearch(q);
  }, 200);
  input.addEventListener('input', run);
  if (initialQuery) run();
}

async function doSearch(q) {
  const ql = q.toLowerCase();
  const [customers, suppliers, products, quotations, customerPOs, salesOrders, supplierPOs, proformaInvoices, technicalOffers] = await Promise.all([
    DB.dbGetAll('customers'), DB.dbGetAll('suppliers'), DB.dbGetAll('products'), DB.dbGetAll('quotations'),
    DB.dbGetAll('customerPOs'), DB.dbGetAll('salesOrders'), DB.dbGetAll('supplierPOs'), DB.dbGetAll('proformaInvoices'), DB.dbGetAll('technicalOffers')
  ]);
  const has = (obj, fields) => fields.some(f => String(obj[f] || '').toLowerCase().includes(ql));

  const sections = [
    { title: 'Customers', hash: '/customers', rows: customers.filter(c => has(c, ['companyName', 'contactPerson', 'email', 'customerNo'])), label: r => r.companyName },
    { title: 'Suppliers', hash: '/suppliers', rows: suppliers.filter(s => has(s, ['companyName', 'contactPerson', 'email', 'supplierNo', 'brandsSupplied'])), label: r => r.companyName },
    { title: 'Products', hash: '/products', rows: products.filter(p => has(p, ['description', 'brand', 'modelNo', 'itemNo'])), label: r => `${r.itemNo} — ${r.description}` },
    { title: 'Quotations', hash: '/quotations', rows: quotations.filter(q2 => has(q2, ['quotationNo', 'rfqRef', 'projectName']) || has(q2.customerSnapshot || {}, ['companyName'])), label: r => `${r.quotationNo} — ${r.customerSnapshot?.companyName || ''}`, badge: r => { const info = getExpiryInfo(r); return info.badgeText ? ' ' + statusBadge(info.badgeText) : ''; } },
    { title: 'Customer POs', hash: '/customer-pos', rows: customerPOs.filter(p => has(p, ['poNo', 'customerPoNumber'])), label: r => r.poNo },
    { title: 'Sales Orders', hash: '/sales-orders', rows: salesOrders.filter(o => has(o, ['soNo'])), label: r => r.soNo },
    { title: 'Supplier POs', hash: '/supplier-pos', rows: supplierPOs.filter(p => has(p, ['poNo'])), label: r => r.poNo },
    { title: 'Proforma Invoices', hash: '/proforma-invoices', rows: proformaInvoices.filter(p => has(p, ['piNo'])), label: r => r.piNo },
    { title: 'Technical Offers', hash: '/technical-offers', rows: technicalOffers.filter(t => has(t, ['offerNo', 'endUser', 'rfqReference'])), label: r => `${r.offerNo} — ${r.endUser || ''}` }
  ].filter(s => s.rows.length > 0);

  const wrap = document.getElementById('searchResults');
  if (sections.length === 0) { wrap.innerHTML = `<div class="card"><div class="empty-inline">No matches for "${escapeHtml(q)}".</div></div>`; return; }
  wrap.innerHTML = sections.map(s => `
    <div class="card related-card">
      <h3>${s.title} <span class="count-pill">${s.rows.length}</span></h3>
      <ul class="search-result-list">
        ${s.rows.slice(0, 15).map(r => `<li><a href="#${s.hash}/${r.id}">${escapeHtml(s.label(r))}</a>${s.badge ? s.badge(r) : ''}</li>`).join('')}
      </ul>
    </div>
  `).join('');
}
