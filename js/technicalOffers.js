/* ============================================================
   technicalOffers.js — Technical Offers: a standalone document type for
   proposing what a supplier can offer, for a customer's technical
   evaluation/approval, before pricing is finalized or an item is
   formally onboarded into the Products catalog.

   Deliberately NOT linked to Products or a Quotation's line items --
   every item and spec row is free text, since a Technical Offer is
   often built from a supplier's own quote/nameplate before Hadrontech
   has (or needs) a catalog record for the item at all.
   ============================================================ */

Router.route('/technical-offers', () => renderTOList());
Router.route('/technical-offers/new', () => renderTOForm(null));
Router.route('/technical-offers/:id', (p) => renderTODetail(p.id));
Router.route('/technical-offers/:id/edit', async (p) => {
  const rec = await DB.dbGet('technicalOffers', Number(p.id));
  renderTOForm(rec);
});

async function renderTOList() {
  const content = document.getElementById('content');
  Router.setBreadcrumb([{ label: 'Technical Offers' }]);
  const [all, customers] = await Promise.all([DB.dbGetAll('technicalOffers'), DB.dbGetAll('customers')]);
  const custMap = Object.fromEntries(customers.map(c => [c.id, c]));
  all.sort((a, b) => new Date(b.date) - new Date(a.date));

  content.innerHTML = `
    <div class="page-head">
      <h1>Technical Offers</h1>
      <div class="page-actions"><a href="#/technical-offers/new" class="btn-amber">+ New Technical Offer</a></div>
    </div>
    <div class="card" style="padding:0;">
      ${all.length === 0 ? `<div class="empty-inline">No technical offers yet. Create one to propose a supplier's offering for a customer's technical evaluation.</div>` : `
      <table class="data-table">
        <thead><tr><th>Offer No.</th><th>Date</th><th>Submitted Via</th><th>End User</th><th>RFQ Reference</th></tr></thead>
        <tbody>${all.map(t => `
          <tr class="clickable-row" data-hash="/technical-offers/${t.id}">
            <td>${escapeHtml(t.offerNo)}</td>
            <td>${formatDate(t.date)}</td>
            <td>${escapeHtml(custMap[t.customerId]?.companyName || '—')}</td>
            <td>${escapeHtml(t.endUser || '—')}</td>
            <td>${escapeHtml(t.rfqReference || '—')}</td>
          </tr>`).join('')}</tbody>
      </table>`}
    </div>
  `;
}

async function renderTODetail(id) {
  const t = await DB.dbGet('technicalOffers', Number(id));
  const content = document.getElementById('content');
  if (!t) { content.innerHTML = `<div class="empty-state"><h3>Technical Offer not found</h3></div>`; return; }
  const customer = t.customerId ? await DB.dbGet('customers', t.customerId) : null;
  Router.setBreadcrumb([{ label: 'Technical Offers', hash: '/technical-offers' }, { label: t.offerNo }]);

  content.innerHTML = `
    <div class="page-head">
      <div><div class="doc-number-tag">${escapeHtml(t.offerNo)}</div><h1>Technical Offer</h1></div>
      <div class="page-actions">
        <button class="btn-line" id="btnPrintTO">Print</button>
        <button class="btn-line" id="btnEditTO">Edit</button>
        <button class="btn-danger" id="btnDeleteTO">Delete</button>
      </div>
    </div>

    <div class="card">
      <div class="detail-grid">
        <div class="detail-item"><div class="detail-label">Submitted Via</div><div class="detail-value">${customer ? `<a href="#/customers/${customer.id}">${escapeHtml(customer.companyName)}</a>` : '—'}</div></div>
        <div class="detail-item"><div class="detail-label">End User</div><div class="detail-value">${escapeHtml(t.endUser || '—')}</div></div>
        <div class="detail-item"><div class="detail-label">Attention</div><div class="detail-value">${escapeHtml(t.attentionTo || '—')}</div></div>
        <div class="detail-item"><div class="detail-label">RFQ Reference</div><div class="detail-value">${escapeHtml(t.rfqReference || '—')}</div></div>
        <div class="detail-item"><div class="detail-label">Date</div><div class="detail-value">${formatDate(t.date)}</div></div>
      </div>
    </div>

    <div class="card">
      <h3 class="section-title">Summary of Offered Items</h3>
      ${(t.items || []).length === 0 ? `<div class="empty-inline">No items added.</div>` : `
      <table class="data-table compact">
        <thead><tr><th>#</th><th>Description</th><th>Qty</th><th>Manufacturer / Origin</th></tr></thead>
        <tbody>${t.items.map((it, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(it.description)}</td><td>${escapeHtml(it.qty)}</td><td>${escapeHtml(it.manufacturer)}</td></tr>`).join('')}</tbody>
      </table>`}
    </div>

    <div class="card">
      <h3 class="section-title">Technical Data Sheet</h3>
      ${(t.specs || []).length === 0 ? `<div class="empty-inline">No spec rows added.</div>` : `
      <table class="data-table compact">
        <thead><tr><th>Item</th><th>Requested (RFQ / End-User)</th><th>Offered (Supplier / Nameplate)</th></tr></thead>
        <tbody>${t.specs.map(s => `<tr><td>${escapeHtml(s.item)}</td><td>${escapeHtml(s.requested)}</td><td>${escapeHtml(s.offered)}</td></tr>`).join('')}</tbody>
      </table>`}
      <p class="muted-text" style="margin-top:10px;">For technical evaluation only — this document does not represent a declaration of full compliance.</p>
    </div>

    <div class="meta-strip">Created ${formatDate(t.createdAt)} by ${escapeHtml(t.createdBy || '—')}${t.updatedAt && t.updatedAt !== t.createdAt ? ` · Last modified ${formatDate(t.updatedAt)}` : ''}</div>
  `;

  document.getElementById('btnPrintTO').onclick = () => Print.printTechnicalOffer(t, customer);
  document.getElementById('btnEditTO').onclick = () => Router.navigate(`/technical-offers/${t.id}/edit`);
  document.getElementById('btnDeleteTO').onclick = async () => {
    if (!confirm(`Delete ${t.offerNo}? This cannot be undone.`)) return;
    await DB.dbDelete('technicalOffers', t.id);
    await DB.logActivity(`Deleted technical offer ${t.offerNo}`);
    toast('Deleted.');
    Router.navigate('/technical-offers');
  };
}

async function renderTOForm(record) {
  const content = document.getElementById('content');
  const isNew = !record;
  const customers = await DB.dbGetAll('customers');
  let items = record ? record.items.map(it => Object.assign({}, it)) : [];
  let specs = record ? record.specs.map(s => Object.assign({}, s)) : [];

  Router.setBreadcrumb(isNew
    ? [{ label: 'Technical Offers', hash: '/technical-offers' }, { label: 'New' }]
    : [{ label: 'Technical Offers', hash: '/technical-offers' }, { label: record.offerNo, hash: `/technical-offers/${record.id}` }, { label: 'Edit' }]);

  content.innerHTML = `
    <div class="page-head"><h1>${isNew ? 'New Technical Offer' : `Edit ${escapeHtml(record.offerNo)}`}</h1></div>
    <form id="toForm" class="form-card">
      <div class="card">
        <div class="form-grid">
          <div class="field"><label>Submitted Via (Customer)</label>
            <select id="f_customerId">
              <option value="">— Select customer —</option>
              ${customers.filter(c => !c.archived).map(c => `<option value="${c.id}" ${record?.customerId === c.id ? 'selected' : ''}>${escapeHtml(c.companyName)}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>End User</label><input id="f_endUser" value="${escapeHtml(record?.endUser || '')}" placeholder="e.g. Onsemi"></div>
          <div class="field"><label>Attention</label><input id="f_attentionTo" value="${escapeHtml(record?.attentionTo || '')}" placeholder="e.g. Technical / Procurement Department"></div>
          <div class="field"><label>RFQ Reference</label><input id="f_rfqReference" value="${escapeHtml(record?.rfqReference || '')}"></div>
          <div class="field"><label>Date</label><input type="date" id="f_date" value="${record?.date || todayISO()}"></div>
        </div>
      </div>

      <div class="card">
        <h3 class="section-title">Summary of Offered Items</h3>
        <p class="muted-text">Entered as plain text — items here don't need to already exist in your Products &amp; Services catalog, since a Technical Offer is often proposing what a supplier can provide before that's settled.</p>
        <div style="overflow-x:auto; max-width:100%;">
        <table class="data-table compact">
          <thead><tr><th>Description</th><th style="width:110px;">Qty</th><th style="width:220px;">Manufacturer / Origin</th><th></th></tr></thead>
          <tbody id="itemsBody"></tbody>
        </table>
        </div>
        <button type="button" class="btn-line btn-sm" id="btnAddItem" style="margin-top:8px;">+ Add Item</button>
      </div>

      <div class="card">
        <h3 class="section-title">Technical Data Sheet</h3>
        <p class="muted-text">One row per spec you want to compare — e.g. Connection Size, Timer Cycle, Power Supply. Add as many as this offer needs.</p>
        <div style="overflow-x:auto; max-width:100%;">
        <table class="data-table compact">
          <thead><tr><th style="width:220px;">Item</th><th>Requested (RFQ / End-User)</th><th>Offered (Supplier / Nameplate)</th><th></th></tr></thead>
          <tbody id="specsBody"></tbody>
        </table>
        </div>
        <button type="button" class="btn-line btn-sm" id="btnAddSpec" style="margin-top:8px;">+ Add Spec Row</button>
      </div>

      <div class="form-actions">
        <button type="submit" class="btn-amber" id="btnSaveTO">Save</button>
        <a href="#${isNew ? '/technical-offers' : `/technical-offers/${record.id}`}" class="btn-line">Cancel</a>
      </div>
    </form>
  `;

  function drawItems() {
    const body = document.getElementById('itemsBody');
    body.innerHTML = items.map((it, i) => `
      <tr data-idx="${i}">
        <td><textarea class="it-desc" rows="1">${escapeHtml(it.description || '')}</textarea></td>
        <td><input class="it-qty" value="${escapeHtml(it.qty || '')}" placeholder="e.g. 2 pcs"></td>
        <td><input class="it-manuf" value="${escapeHtml(it.manufacturer || '')}" placeholder="e.g. Pentair, Made in Italy"></td>
        <td class="row-del" data-itemdel="${i}">✕</td>
      </tr>`).join('');
    body.querySelectorAll('tr').forEach(tr => {
      const idx = Number(tr.dataset.idx);
      const bind = (sel, field) => tr.querySelector(sel).addEventListener('input', (e) => { items[idx][field] = e.target.value; markDirty(); });
      bind('.it-desc', 'description'); bind('.it-qty', 'qty'); bind('.it-manuf', 'manufacturer');
    });
    body.querySelectorAll('[data-itemdel]').forEach(btn => btn.addEventListener('click', () => {
      items.splice(Number(btn.dataset.itemdel), 1); drawItems(); markDirty();
    }));
  }
  function drawSpecs() {
    const body = document.getElementById('specsBody');
    body.innerHTML = specs.map((s, i) => `
      <tr data-idx="${i}">
        <td><input class="sp-item" value="${escapeHtml(s.item || '')}" placeholder="e.g. Connection Size"></td>
        <td><input class="sp-req" value="${escapeHtml(s.requested || '')}"></td>
        <td><input class="sp-off" value="${escapeHtml(s.offered || '')}"></td>
        <td class="row-del" data-specdel="${i}">✕</td>
      </tr>`).join('');
    body.querySelectorAll('tr').forEach(tr => {
      const idx = Number(tr.dataset.idx);
      const bind = (sel, field) => tr.querySelector(sel).addEventListener('input', (e) => { specs[idx][field] = e.target.value; markDirty(); });
      bind('.sp-item', 'item'); bind('.sp-req', 'requested'); bind('.sp-off', 'offered');
    });
    body.querySelectorAll('[data-specdel]').forEach(btn => btn.addEventListener('click', () => {
      specs.splice(Number(btn.dataset.specdel), 1); drawSpecs(); markDirty();
    }));
  }
  drawItems(); drawSpecs();

  document.getElementById('btnAddItem').onclick = () => { items.push({ description: '', qty: '', manufacturer: '' }); drawItems(); markDirty(); };
  document.getElementById('btnAddSpec').onclick = () => { specs.push({ item: '', requested: '', offered: '' }); drawSpecs(); markDirty(); };

  content.querySelectorAll('input,textarea,select').forEach(i => i.addEventListener('input', markDirty));

  document.getElementById('toForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btnSaveTO');
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      const settings = await DB.getSettings();
      const now = new Date().toISOString();
      const payload = {
        customerId: document.getElementById('f_customerId').value ? Number(document.getElementById('f_customerId').value) : '',
        endUser: document.getElementById('f_endUser').value,
        attentionTo: document.getElementById('f_attentionTo').value,
        rfqReference: document.getElementById('f_rfqReference').value,
        date: document.getElementById('f_date').value || todayISO(),
        items: items.filter(it => (it.description || '').trim()),
        specs: specs.filter(s => (s.item || '').trim()),
        updatedAt: now, modifiedBy: settings.userName
      };
      if (isNew) {
        payload.offerNo = await DB.nextDocNumber('technicalOffer');
        payload.createdAt = now;
        payload.createdBy = settings.userName;
        const newId = await DB.dbAdd('technicalOffers', payload);
        await DB.logActivity(`Created technical offer ${payload.offerNo}`);
        clearDirty();
        toast('Technical Offer created.');
        Router.navigate(`/technical-offers/${newId}`);
      } else {
        Object.assign(record, payload);
        await DB.dbPut('technicalOffers', record);
        await DB.logActivity(`Updated technical offer ${record.offerNo}`);
        clearDirty();
        toast('Saved.');
        Router.navigate(`/technical-offers/${record.id}`);
      }
    } finally {
      btn.disabled = false;
    }
  });
}
