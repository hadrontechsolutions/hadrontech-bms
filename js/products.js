/* ============================================================
   products.js — Product / Service master records
   ============================================================ */

Entities.defineEntity({
  key: 'products',
  label: 'Product',
  labelPlural: 'Products & Services',
  numberField: 'itemNo',
  counterName: 'product',
  titleField: 'description',
  defaultStatus: 'Active',
  searchFields: ['description', 'brand', 'modelNo', 'itemNo', 'manufacturer'],
  listColumns: [
    { key: 'itemNo', label: 'Item #' },
    { key: 'description', label: 'Description' },
    { key: 'brand', label: 'Brand' },
    { key: 'modelNo', label: 'Model / Part No.' },
    { key: 'standardPrice', label: 'Selling Price', render: r => formatMoney(r.standardPrice, r.currency) },
    { key: 'status', label: 'Status', render: r => statusBadge(r.status) }
  ],
  fields: [
    { name: 'type', label: 'Type', type: 'select', options: ['Product', 'Service'], default: 'Product' },
    { name: 'category', label: 'Category', type: 'text' },
    { name: 'manufacturer', label: 'Manufacturer', type: 'text' },
    { name: 'brand', label: 'Brand', type: 'text' },
    { name: 'modelNo', label: 'Model / Part Number', type: 'text' },
    { name: 'description', label: 'Description', type: 'textarea', required: true },
    { name: 'uom', label: 'Unit of Measure', type: 'text', default: 'pc' },
    { name: 'defaultSupplierId', label: 'Default Supplier', type: 'select-dynamic', optionsFrom: 'suppliers', optionsLabel: 'companyName' },
    { name: 'supplierListingUrl', label: 'Supplier Listing URL', type: 'url' },
    { name: 'supplierPartNo', label: 'Supplier Part Number', type: 'text' },
    { name: 'standardCost', label: 'Standard Cost', type: 'money' },
    { name: 'standardPrice', label: 'Standard Selling Price', type: 'money' },
    { name: 'currency', label: 'Currency', type: 'currency-select', default: 'PHP' },
    { name: 'markupPercent', label: 'Default Markup %', type: 'number' },
    { name: 'vatClass', label: 'VAT Classification', type: 'select', options: ['VATable', 'Zero-Rated', 'VAT Exempt'] },
    { name: 'countryOfOrigin', label: 'Country of Origin', type: 'text' },
    { name: 'leadTime', label: 'Typical Lead Time', type: 'text' },
    { name: 'warranty', label: 'Warranty', type: 'text' },
    { name: 'status', label: 'Status', type: 'select', options: ['Active', 'Inactive'] },
    { name: 'notes', label: 'Notes', type: 'textarea' }
  ],
  checkRelatedBeforeDelete: async (record) => {
    const quotations = await DB.dbGetAll('quotations');
    return quotations.filter(q => (q.lines || []).some(l => String(l.itemId) === String(record.id))).length;
  },
  relatedPanels: async (record) => {
    if (record.type === 'Service') return ''; // services don't carry physical stock
    const [movements, salesOrders] = await Promise.all([
      DB.dbQueryIndex('stockMovements', 'productId', record.id),
      DB.dbGetAll('salesOrders')
    ]);
    const onHand = r2(movements.reduce((s, m) => s + m.qty, 0));
    const OPEN_SO_STATUSES = ['Draft', 'Confirmed', 'Sourcing', 'Ordered from Supplier', 'Partially Received', 'Ready for Delivery'];
    let committed = 0;
    salesOrders.forEach(so => {
      if (!OPEN_SO_STATUSES.includes(so.status)) return;
      (so.lines || []).forEach(l => {
        if (String(l.itemId) === String(record.id)) committed = r2(committed + (Number(l.qty) - Number(l.deliveredQty || 0)));
      });
    });
    const available = r2(onHand - committed);
    const uom = record.uom || 'pc';
    const sortedMovements = movements.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id - a.id);

    return `
      <div class="card">
        <h3 class="section-title">Stock</h3>
        <div class="stat-row">
          <div class="stat-box"><div class="stat-num">${onHand} ${escapeHtml(uom)}</div><div class="stat-lbl">On Hand</div></div>
          <div class="stat-box"><div class="stat-num">${committed} ${escapeHtml(uom)}</div><div class="stat-lbl">Committed (open orders)</div></div>
          <div class="stat-box"><div class="stat-num ${available < 0 ? 'text-danger' : ''}">${available < 0 ? `Short by ${Math.abs(available)}` : available + ' ' + escapeHtml(uom)}</div><div class="stat-lbl">Available</div></div>
        </div>
        <div class="btn-row" style="margin-top:10px;"><button class="btn-line btn-sm" id="btnAdjustStock">Adjust Stock</button></div>
        <div id="adjustStockHost"></div>
        ${sortedMovements.length > 0 ? `
          <h4 style="margin-top:16px; font-size:13px; color:var(--muted);">Stock Movement History</h4>
          <table class="data-table compact"><thead><tr><th>Date</th><th>Type</th><th>Qty</th><th>Reference</th><th>Note</th></tr></thead>
          <tbody>${sortedMovements.map(m => `<tr><td>${formatDate(m.date)}</td><td>${escapeHtml(m.type)}</td><td class="${m.qty < 0 ? 'text-danger' : 'text-ok'}">${m.qty > 0 ? '+' : ''}${m.qty}</td><td>${m.referenceId && m.type === 'Receipt' ? `<a href="#/supplier-pos/${m.referenceId}">${escapeHtml(m.reference || '')}</a>` : m.referenceId && m.type === 'Delivery' ? `<a href="#/sales-orders/${m.referenceId}">${escapeHtml(m.reference || '')}</a>` : escapeHtml(m.reference || '—')}</td><td>${escapeHtml(m.note || '—')}</td></tr>`).join('')}</tbody></table>
        ` : `<div class="empty-inline" style="margin-top:12px;">No stock movements recorded yet.</div>`}
      </div>
    `;
  },
  afterRender: (record, id) => {
    if (record.type === 'Service') return;
    const btn = document.getElementById('btnAdjustStock');
    if (!btn) return;
    btn.onclick = () => {
      const host = document.getElementById('adjustStockHost');
      host.innerHTML = `
        <div class="card" style="margin-top:10px;">
          <div class="form-grid">
            <div class="field"><label>Adjustment Quantity (use a negative number to reduce)</label><input type="number" step="any" id="adjQty" placeholder="e.g. 10 or -2"></div>
            <div class="field field-wide"><label>Reason *</label><input id="adjReason" placeholder="e.g. Initial stock count, damaged goods, physical count correction"></div>
          </div>
          <div class="btn-row" style="margin-top:10px;">
            <button class="btn-amber btn-sm" id="btnConfirmAdjust">Confirm Adjustment</button>
            <button class="btn-line btn-sm" id="btnCancelAdjust">Cancel</button>
          </div>
        </div>
      `;
      document.getElementById('btnCancelAdjust').onclick = () => { host.innerHTML = ''; };
      document.getElementById('btnConfirmAdjust').onclick = async () => {
        const qty = r2(Number(document.getElementById('adjQty').value) || 0);
        const reason = document.getElementById('adjReason').value.trim();
        if (qty === 0) { toast('Enter a non-zero quantity.', 'err'); return; }
        if (!reason) { toast('Please enter a reason for this adjustment.', 'err'); return; }
        const settings = await DB.getSettings();
        await DB.dbAdd('stockMovements', {
          productId: record.id, type: 'Adjustment', qty, date: todayISO(),
          reference: 'Manual Adjustment', referenceId: null, referenceLineId: null,
          note: reason, createdBy: settings.userName, createdAt: new Date().toISOString()
        });
        await DB.logActivity(`Adjusted stock for ${record.description} by ${qty > 0 ? '+' : ''}${qty} (${reason})`);
        toast('Stock adjusted.');
        renderDetail(Entities.EntityRegistry['products'], id);
      };
    };
  }
});
