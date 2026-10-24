/* ============================================================
   customers.js — Customer master records (uses the generic entity engine)
   ============================================================ */

Entities.defineEntity({
  key: 'customers',
  label: 'Customer',
  labelPlural: 'Customers',
  numberField: 'customerNo',
  counterName: 'customer',
  titleField: 'companyName',
  defaultStatus: 'Active',
  searchFields: ['companyName', 'contactPerson', 'email', 'customerNo', 'tin'],
  listColumns: [
    { key: 'customerNo', label: 'Customer #' },
    { key: 'companyName', label: 'Company Name' },
    { key: 'contactPerson', label: 'Contact Person' },
    { key: 'email', label: 'Email' },
    { key: 'telephone', label: 'Telephone' },
    { key: 'status', label: 'Status', render: r => statusBadge(r.status) }
  ],
  fields: [
    { name: 'companyName', label: 'Company Name', type: 'text', required: true },
    { name: 'contactPerson', label: 'Contact Person', type: 'text' },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'telephone', label: 'Telephone', type: 'text' },
    { name: 'billingAddress', label: 'Billing Address', type: 'textarea' },
    { name: 'shippingAddress', label: 'Shipping Address', type: 'textarea' },
    { name: 'country', label: 'Country', type: 'text', default: 'Philippines' },
    { name: 'tin', label: 'Tax Identification Number', type: 'text' },
    { name: 'paymentTerms', label: 'Payment Terms', type: 'text' },
    { name: 'incoterms', label: 'Default Incoterms', type: 'text' },
    { name: 'salesperson', label: 'Salesperson', type: 'text' },
    { name: 'status', label: 'Status', type: 'select', options: ['Active', 'Inactive', 'Prospect'] },
    { name: 'notes', label: 'Notes', type: 'textarea' }
  ],
  checkRelatedBeforeDelete: async (record) => {
    const q = await DB.dbQueryIndex('quotations', 'customerId', record.id);
    const so = await DB.dbQueryIndex('salesOrders', 'customerId', record.id);
    const cpo = await DB.dbQueryIndex('customerPOs', 'customerId', record.id);
    return q.length + so.length + cpo.length;
  },
  relatedPanels: async (record) => {
    const [quotations, salesOrders, customerPOs] = await Promise.all([
      DB.dbQueryIndex('quotations', 'customerId', record.id),
      DB.dbQueryIndex('salesOrders', 'customerId', record.id),
      DB.dbQueryIndex('customerPOs', 'customerId', record.id)
    ]);
    const latestQuotes = quotations.filter(q => q.isLatest);
    const totalQuoted = latestQuotes.reduce((s, q) => s + (q.grandTotal || 0), 0);
    const totalOrdered = salesOrders.reduce((s, o) => s + (o.grandTotal || 0), 0);
    const lastDates = [...quotations, ...salesOrders, ...customerPOs].map(r => r.updatedAt).filter(Boolean).sort();
    const lastTx = lastDates.length ? lastDates[lastDates.length - 1] : null;

    return `
      <div class="stat-row">
        <div class="stat-box"><div class="stat-num">${formatMoney(totalQuoted, 'PHP')}</div><div class="stat-lbl">Total Quoted Value</div></div>
        <div class="stat-box"><div class="stat-num">${formatMoney(totalOrdered, 'PHP')}</div><div class="stat-lbl">Total Order Value</div></div>
        <div class="stat-box"><div class="stat-num">${lastTx ? formatDate(lastTx) : '—'}</div><div class="stat-lbl">Last Transaction</div></div>
      </div>

      ${relatedTable('Quotations', latestQuotes, ['quotationNo', 'date', 'status', 'grandTotal'], '/quotations', 'PHP')}
      ${relatedTable('Customer POs', customerPOs, ['poNo', 'poDate', 'status', 'poAmount'], '/customer-pos', 'PHP')}
      ${relatedTable('Sales Orders', salesOrders, ['soNo', 'orderDate', 'status', 'grandTotal'], '/sales-orders', 'PHP')}
    `;
  }
});

/** Shared small table renderer for "related records" panels across all detail pages. */
function relatedTable(title, rows, cols, baseHash, currency) {
  if (!rows || rows.length === 0) {
    return `<div class="card related-card"><h3>${escapeHtml(title)}</h3><div class="empty-inline">No ${title.toLowerCase()} yet.</div></div>`;
  }
  const colLabels = { quotationNo: 'No.', date: 'Date', orderDate: 'Date', poDate: 'Date', status: 'Status', grandTotal: 'Amount', poAmount: 'Amount', totalCost: 'Amount', poNo: 'No.', soNo: 'No.' };
  const sorted = rows.slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  return `
    <div class="card related-card">
      <h3>${escapeHtml(title)} <span class="count-pill">${rows.length}</span></h3>
      <table class="data-table compact">
        <thead><tr>${cols.map(c => `<th>${colLabels[c] || c}</th>`).join('')}</tr></thead>
        <tbody>
          ${sorted.map(r => `
            <tr class="clickable-row" data-hash="${baseHash}/${r.id}">
              ${cols.map(c => {
                if (c === 'status') return `<td>${statusBadge(r[c])}</td>`;
                if (['grandTotal', 'poAmount', 'totalCost'].includes(c)) return `<td>${formatMoney(r[c] || 0, currency || r.currency)}</td>`;
                if (c.toLowerCase().includes('date')) return `<td>${formatDate(r[c])}</td>`;
                return `<td>${escapeHtml(r[c] ?? '')}</td>`;
              }).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}
document.addEventListener('click', (e) => {
  const row = e.target.closest('tr[data-hash]');
  if (row) Router.navigate(row.dataset.hash);
});

window.relatedTable = relatedTable;
