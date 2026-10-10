/* ============================================================
   products.js — Product / Service master records
   ============================================================ */

/* ============================================================
   PROJECT PACKAGE — one catalog item (ITEM-P-0001) that stands for a whole project and carries
   its own component items (ITEM-P-0001-01, -02, ...). Components live INSIDE the package record,
   so they never flood the main Products & Services list; picking the package on a quotation loads
   the package line plus every component. Numbering: the package gets the next ITEM-P-#### number;
   components are numbered per project, in order, and a number is never reused after a delete.
   ============================================================ */
function pkgAssignComponentNumbers(obj) {
  const comps = obj.components || [];
  let seq = Number(obj.nextCompSeq) || 1;
  comps.forEach(c => { const m = c.compNo && /-(\d+)$/.exec(c.compNo); if (m) seq = Math.max(seq, Number(m[1]) + 1); });
  comps.forEach(c => { if (!c.compNo) { c.compNo = `${obj.itemNo}-${String(seq).padStart(2, '0')}`; seq += 1; } });
  obj.nextCompSeq = seq;
}

function pkgEmptyComponent() {
  return { compNo: '', description: '', brand: '', modelNo: '', qty: 1, uom: 'pc', unitCost: 0, costCurrency: 'USD', estimatedFreightCost: 0, freightCoversQty: 1, markupPercent: 0 };
}

function pkgComponentsPanelHTML(record) {
  const comps = record.components || [];
  return `<div class="card"><h3 class="section-title">Package Components <span class="count-pill">${comps.length}</span></h3>
    ${comps.length === 0 ? '<div class="empty-inline">No components yet.</div>' : `
    <table class="data-table compact"><thead><tr><th>Item No.</th><th>Description</th><th>Brand / Model</th><th>Qty</th><th>Unit Cost</th><th>Freight (per unit)</th><th>Markup %</th></tr></thead><tbody>
    ${comps.map(c => {
      const covers = Number(c.freightCoversQty) > 0 ? Number(c.freightCoversQty) : 1;
      return `<tr><td>${escapeHtml(c.compNo || '—')}</td><td class="desc-col">${descClip(c.description)}</td><td>${escapeHtml([c.brand, c.modelNo].filter(Boolean).join(' · ') || '—')}</td><td>${c.qty} ${escapeHtml(c.uom || '')}</td><td>${formatMoney(c.unitCost, c.costCurrency)}</td><td>${formatMoney((Number(c.estimatedFreightCost) || 0) / covers, c.costCurrency)}</td><td>${c.markupPercent || 0}%</td></tr>`;
    }).join('')}</tbody></table>`}
    <p class="muted-text" style="margin-top:8px;">Select this package in a quotation's <b>Select Item</b> to load all of these as lines. Edit the package to add or change components.</p></div>`;
}

/** Turns the generic product form into the Project Package form when Type = Project Package:
    hides the single-item cost/price fields and shows the component editor. */
function setupProjectPackageForm(form, record) {
  const typeSel = form.querySelector('#f_type');
  if (!typeSel) return;
  const HIDE = ['category', 'manufacturer', 'brand', 'modelNo', 'uom', 'supplierListingUrl', 'supplierPartNo', 'estimatedFreightCost', 'freightCoversQty', 'standardCost', 'currency', 'standardPrice', 'markupPercent', 'vatClass', 'countryOfOrigin'];
  const hideEls = HIDE.map(n => form.querySelector('#f_' + n)).filter(Boolean).map(el => el.closest('.field'));
  const descLabel = form.querySelector('#f_description') && form.querySelector('#f_description').closest('.field').querySelector('label');
  const comps = (record && record.components || []).map(c => Object.assign({}, c));
  form._pkgComps = comps;
  let ccyOptions = ['PHP', 'USD'];
  DB.getSettings().then(st => { ccyOptions = currencyList(st); if (host.style.display !== 'none') draw(); });

  if (record) { typeSel.style.pointerEvents = 'none'; typeSel.style.opacity = '.6'; typeSel.tabIndex = -1; typeSel.title = 'The type cannot be changed after the item is created.'; }

  const host = document.createElement('div');
  host.id = 'pkgEditor'; host.style.cssText = 'margin-top:18px; display:none;';
  const actions = form.querySelector('.form-actions');
  form.insertBefore(host, actions);

  function draw() {
    const numStyle = 'width:70px;';
    host.innerHTML = `<h3 class="section-title">Package Components</h3>
      <p class="muted-text">Each component gets its own number under this package (e.g. ITEM-P-0001-01). On a quotation every component loads with a <b>blank price</b> and is part of the project's single lot price (its cost, freight and markup roll into the lot line). To price an item separately, type a price on that line. Freight is quoted for a quantity, same as a normal item. All items are quoted by the supplier chosen above.</p>
      <div style="overflow-x:auto;"><table class="data-table compact"><thead><tr><th>Item No.</th><th>Description *</th><th>Brand</th><th>Model</th><th>Qty</th><th>UOM</th><th>Unit Cost</th><th>Cost Ccy</th><th>Est. Freight</th><th>Freight Covers Qty</th><th>Markup %</th><th></th></tr></thead><tbody>
      ${comps.map((c, i) => `<tr data-i="${i}">
        <td style="white-space:nowrap;">${escapeHtml(c.compNo || '(new)')}</td>
        <td><input data-k="description" value="${escapeHtml(c.description)}" style="width:170px;"></td>
        <td><input data-k="brand" value="${escapeHtml(c.brand)}" style="width:80px;"></td>
        <td><input data-k="modelNo" value="${escapeHtml(c.modelNo)}" style="width:90px;"></td>
        <td><input data-k="qty" type="number" step="any" min="0" value="${c.qty}" style="width:60px;"></td>
        <td><input data-k="uom" value="${escapeHtml(c.uom)}" style="width:50px;"></td>
        <td><input data-k="unitCost" type="number" step="0.01" min="0" value="${c.unitCost}" style="${numStyle}"></td>
        <td><select data-k="costCurrency">${(ccyOptions.includes(c.costCurrency) ? ccyOptions : [c.costCurrency, ...ccyOptions]).map(x => `<option ${x === c.costCurrency ? 'selected' : ''}>${escapeHtml(x)}</option>`).join('')}</select></td>
        <td><input data-k="estimatedFreightCost" type="number" step="0.01" min="0" value="${c.estimatedFreightCost}" style="${numStyle}"></td>
        <td><input data-k="freightCoversQty" type="number" step="any" min="0" value="${c.freightCoversQty}" style="width:60px;"></td>
        <td><input data-k="markupPercent" type="number" step="0.01" value="${c.markupPercent}" style="width:60px;"></td>
        <td class="row-del" data-del="${i}">✕</td></tr>`).join('')}
      </tbody></table></div>
      <button type="button" class="btn-line btn-sm" id="pkgAddComp" style="margin-top:8px;">+ Add component</button>`;
    host.querySelectorAll('tr[data-i]').forEach(tr => {
      const c = comps[Number(tr.dataset.i)];
      tr.querySelectorAll('[data-k]').forEach(el => {
        const k = el.dataset.k;
        const upd = () => { c[k] = (el.type === 'number') ? (Number(el.value) || 0) : el.value; if (typeof markDirty === 'function') markDirty(); };
        el.addEventListener('input', upd); el.addEventListener('change', upd);
      });
      tr.querySelector('[data-del]').addEventListener('click', () => { comps.splice(Number(tr.dataset.i), 1); draw(); });
    });
    host.querySelector('#pkgAddComp').addEventListener('click', () => { comps.push(pkgEmptyComponent()); draw(); });
  }

  function sync() {
    const isPkg = typeSel.value === 'Project Package';
    hideEls.forEach(el => { el.style.display = isPkg ? 'none' : ''; });
    host.style.display = isPkg ? '' : 'none';
    if (descLabel) descLabel.textContent = isPkg ? 'Project Name / Description *' : 'Description *';
    const supLabel = form.querySelector('#f_defaultSupplierId') && form.querySelector('#f_defaultSupplierId').closest('.field').querySelector('label');
    if (supLabel) supLabel.textContent = isPkg ? 'Supplier (quotes all items and work) *' : 'Default Supplier';
    if (isPkg) { if (comps.length === 0) comps.push(pkgEmptyComponent()); draw(); }
  }
  typeSel.addEventListener('change', sync);
  sync();
}

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
    { key: 'standardCost', label: 'Standard Cost', render: r => r.type === 'Project Package' ? `<span class="muted-text">Project Package · ${(r.components || []).length} items</span>` : formatMoney(r.standardCost, r.currency) },
    { key: 'leadTime', label: 'Typical Lead Time', render: r => r.leadTime || '—' },
    { key: 'status', label: 'Status', render: r => statusBadge(r.status) }
  ],
  fields: [
    { name: 'type', label: 'Type', type: 'select', options: ['Product', 'Service', 'Project Package'], default: 'Product' },
    { name: 'category', label: 'Category', type: 'text' },
    { name: 'manufacturer', label: 'Manufacturer', type: 'text' },
    { name: 'brand', label: 'Brand', type: 'text' },
    { name: 'modelNo', label: 'Model / Part Number', type: 'text' },
    { name: 'description', label: 'Description', type: 'textarea', required: true },
    { name: 'uom', label: 'Unit of Measure', type: 'text', default: 'pc' },
    { name: 'defaultSupplierId', label: 'Default Supplier', type: 'select-dynamic', optionsFrom: 'suppliers', optionsLabel: 'companyName' },
    { name: 'supplierListingUrl', label: 'Supplier Listing URL', type: 'url' },
    { name: 'supplierPartNo', label: 'Supplier Part Number', type: 'text' },
    { name: 'estimatedFreightCost', label: 'Estimated Freight Cost', type: 'money', highlight: true },
    { name: 'freightCoversQty', label: 'Freight Covers Qty (pcs)', type: 'number', default: 1, highlight: true },
    { name: 'standardCost', label: 'Standard Cost', type: 'money', highlight: true },
    { name: 'currency', label: 'Currency', type: 'currency-select', default: 'USD' },
    { name: 'standardPrice', label: 'Standard Selling Price (₱ PHP)', type: 'money' },
    { name: 'markupPercent', label: 'Default Markup %', type: 'number' },
    { name: 'vatClass', label: 'VAT Classification', type: 'select', options: ['VATable', 'Zero-Rated', 'VAT Exempt'] },
    { name: 'countryOfOrigin', label: 'Country of Origin', type: 'text' },
    { name: 'leadTime', label: 'Typical Lead Time', type: 'text' },
    { name: 'warranty', label: 'Warranty', type: 'text' },
    { name: 'status', label: 'Status', type: 'select', options: ['Active', 'Inactive'] },
    { name: 'notes', label: 'Notes', type: 'textarea' }
  ],
  counterFor: (obj) => obj.type === 'Project Package' ? 'projectPackage' : 'product',
  afterNumber: (obj) => { if (obj.type === 'Project Package') pkgAssignComponentNumbers(obj); },
  // A project package carries its cost/price on its components, so the single-item fields are not shown on its page.
  detailHiddenFields: (r) => r.type === 'Project Package' ? ['category', 'manufacturer', 'brand', 'modelNo', 'uom', 'supplierListingUrl', 'supplierPartNo', 'estimatedFreightCost', 'freightCoversQty', 'standardCost', 'currency', 'standardPrice', 'markupPercent', 'vatClass', 'countryOfOrigin'] : [],
  beforeSave: (obj, form, orig) => {
    if (orig) obj.type = orig.type; // a record's type is fixed once created (it decides its numbering)
    if (obj.type !== 'Project Package') return null;
    const comps = (form._pkgComps || []).filter(c => String(c.description || '').trim())
      .map(c => Object.assign({}, c, { description: String(c.description).trim() }));
    if (!obj.defaultSupplierId) return 'Choose the supplier who quotes this project package.';
    if (comps.length === 0) return 'Add at least one component item to this project package.';
    obj.components = comps;
    // Package-level item fields don't apply to a project (the name/description carries it; each component has its own UOM).
    obj.category = ''; obj.manufacturer = ''; obj.brand = ''; obj.modelNo = ''; obj.uom = 'lot';
    if (orig) pkgAssignComponentNumbers(obj); // new records get numbers right after the package number exists
    return null;
  },
  afterFormRender: (form, record) => {
    const fr = form.querySelector('#f_estimatedFreightCost'), qty = form.querySelector('#f_freightCoversQty'), ccy = form.querySelector('#f_currency');
    // Shows the per-unit freight the highlighted fields work out to (cost amount / qty it covers).
    if (fr && qty) {
      const hint = document.createElement('div');
      hint.id = 'freightPerUnitHint'; hint.style.cssText = 'font-size:11px; margin-top:4px; color:var(--amber);';
      qty.parentNode.appendChild(hint);
      const update = () => {
        const q = Number(qty.value) > 0 ? Number(qty.value) : 1;
        const f = Number(fr.value) || 0;
        hint.textContent = f > 0 ? `= ${formatMoney(f / q, ccy ? ccy.value : 'USD')} freight per unit` : '';
      };
      [fr, qty, ccy].forEach(el => el && el.addEventListener('input', update));
      if (ccy) ccy.addEventListener('change', update);
      update();
    }
    setupProjectPackageForm(form, record);
  },
  checkRelatedBeforeDelete: async (record) => {
    const [quotations, stockMovements] = await Promise.all([
      DB.dbGetAll('quotations'),
      DB.dbQueryIndex('stockMovements', 'productId', record.id)
    ]);
    return quotations.filter(q => (q.lines || []).some(l => String(l.itemId) === String(record.id))).length + stockMovements.length;
  },
  relatedPanels: async (record) => {
    if (record.type === 'Project Package') return pkgComponentsPanelHTML(record);
    if (record.type === 'Service') return ''; // services don't carry physical stock
    const [movements, salesOrders] = await Promise.all([
      DB.dbQueryIndex('stockMovements', 'productId', record.id),
      DB.dbGetAll('salesOrders')
    ]);
    const onHand = r2(movements.reduce((s, m) => s + m.qty, 0));
    const OPEN_SO_STATUSES = ['Draft', 'Confirmed', 'Sourcing', 'Ordered from Supplier', 'Partially Received', 'Ready for Delivery', 'Partially Delivered'];
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
    if (record.type === 'Service' || record.type === 'Project Package') return;
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
