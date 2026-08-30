/* ============================================================
   entities.js — generic list/form/detail engine.
   Customers, Suppliers, and Products are all "master records" with
   the same CRUD shape, so they share this engine instead of each
   having hand-written list/form code. Quotations/Orders are more
   workflow-specific and are handled in their own modules.
   ============================================================ */

// Registry so other modules (quotations, etc.) can look up config/records.
const EntityRegistry = {};

function defineEntity(cfg) {
  EntityRegistry[cfg.key] = cfg;

  Router.route(`/${cfg.key}`, () => renderList(cfg));
  Router.route(`/${cfg.key}/new`, () => renderForm(cfg, null));
  Router.route(`/${cfg.key}/:id/edit`, (p) => renderForm(cfg, p.id));
  Router.route(`/${cfg.key}/:id`, (p) => renderDetail(cfg, p.id));

  return cfg;
}

/* ---------- LIST ---------- */

async function renderList(cfg) {
  Router.setBreadcrumb([{ label: cfg.labelPlural }]);
  const all = (await DB.dbGetAll(cfg.key)).filter(r => !r.archived);
  const content = document.getElementById('content');

  content.innerHTML = `
    <div class="page-head">
      <h1>${cfg.labelPlural}</h1>
      <div class="page-actions">
        <input type="search" id="listSearch" placeholder="Search ${cfg.labelPlural.toLowerCase()}..." class="search-box">
        <button class="btn-amber" id="btnNewEntity">+ New ${cfg.label}</button>
      </div>
    </div>
    <div class="card">
      <table class="data-table" id="entityTable">
        <thead><tr>${cfg.listColumns.map(c => `<th>${escapeHtml(c.label)}</th>`).join('')}</tr></thead>
        <tbody></tbody>
      </table>
      <div class="empty-inline" id="emptyMsg" style="display:none;">No records found. Click "New ${cfg.label}" to add one.</div>
    </div>
  `;

  document.getElementById('btnNewEntity').onclick = () => Router.navigate(`/${cfg.key}/new`);

  function draw(rows) {
    const tbody = content.querySelector('tbody');
    tbody.innerHTML = rows.map(row => `
      <tr class="clickable-row" data-id="${row.id}">
        ${cfg.listColumns.map(c => `<td>${c.render ? c.render(row) : escapeHtml(row[c.key] ?? '')}</td>`).join('')}
      </tr>
    `).join('');
    tbody.querySelectorAll('tr').forEach(tr => {
      tr.onclick = () => Router.navigate(`/${cfg.key}/${tr.dataset.id}`);
    });
    document.getElementById('emptyMsg').style.display = rows.length ? 'none' : 'block';
  }

  draw(all);

  document.getElementById('listSearch').addEventListener('input', debounce((e) => {
    const q = e.target.value.trim().toLowerCase();
    if (!q) return draw(all);
    const filtered = all.filter(r => cfg.searchFields.some(f => String(r[f] || '').toLowerCase().includes(q)));
    draw(filtered);
  }, 200));
}

/* ---------- FORM (create/edit) ---------- */

function fieldInputHTML(f, value) {
  const id = 'f_' + f.name;
  const v = value == null ? (f.default ?? '') : value;
  const req = f.required ? 'required' : '';
  switch (f.type) {
    case 'textarea':
      return `<textarea id="${id}" name="${f.name}" ${req}>${escapeHtml(v)}</textarea>`;
    case 'select':
      return `<select id="${id}" name="${f.name}" ${req}>` +
        f.options.map(o => `<option value="${escapeHtml(o)}" ${o === v ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('') +
        `</select>`;
    case 'select-dynamic': // options resolved at render time (e.g. supplier list)
      return `<select id="${id}" name="${f.name}" ${req}>` +
        `<option value="">—</option>` +
        (f._resolvedOptions || []).map(o => `<option value="${o.value}" ${String(o.value) === String(v) ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('') +
        `</select>`;
    case 'currency-select': // options resolved from Settings → Currencies & Exchange Rates
      return `<select id="${id}" name="${f.name}" ${req}>` +
        (f._resolvedOptions || [{ value: 'PHP', label: 'PHP' }]).map(o => `<option value="${o.value}" ${o.value === v ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('') +
        `</select>`;
    case 'checkbox':
      return `<input type="checkbox" id="${id}" name="${f.name}" ${v ? 'checked' : ''}>`;
    case 'number':
      return `<input type="number" step="any" id="${id}" name="${f.name}" value="${escapeHtml(v)}" ${req}>`;
    case 'money':
      return `<input type="number" step="0.01" min="0" id="${id}" name="${f.name}" value="${escapeHtml(v)}" ${req}>`;
    case 'date':
      return `<input type="date" id="${id}" name="${f.name}" value="${escapeHtml(v)}" ${req}>`;
    case 'email':
      return `<input type="email" id="${id}" name="${f.name}" value="${escapeHtml(v)}" ${req}>`;
    case 'url':
      return `<input type="url" id="${id}" name="${f.name}" value="${escapeHtml(v)}" placeholder="https://..." ${req}>`;
    default:
      return `<input type="text" id="${id}" name="${f.name}" value="${escapeHtml(v)}" ${req}>`;
  }
}

/** Resolves dropdown options for select-dynamic / currency-select fields. Critically, if the
    record being edited currently holds a value that's no longer in the "live" list (e.g. the
    supplier was archived, or a currency was removed from Settings), that value is still
    included — marked as such — so simply saving the form for an unrelated reason can never
    silently wipe out a real reference. Without this, editing anything else on a record whose
    linked supplier/currency had since been archived/removed would blank that field out. */
async function resolveDynamicOptions(fields, record) {
  for (const f of fields) {
    if (f.type === 'select-dynamic') {
      const rows = await DB.dbGetAll(f.optionsFrom);
      const active = rows.filter(r => !r.archived);
      f._resolvedOptions = active.map(r => ({ value: r.id, label: r[f.optionsLabel] }));
      const currentValue = record ? record[f.name] : null;
      if (currentValue && !active.some(r => String(r.id) === String(currentValue))) {
        const archivedMatch = rows.find(r => String(r.id) === String(currentValue));
        f._resolvedOptions.unshift({ value: currentValue, label: (archivedMatch ? archivedMatch[f.optionsLabel] : `#${currentValue}`) + ' (Archived)' });
      }
    }
    if (f.type === 'currency-select') {
      const settings = await DB.getSettings();
      const active = currencyList(settings);
      f._resolvedOptions = active.map(c => ({ value: c, label: c }));
      const currentValue = record ? record[f.name] : null;
      if (currentValue && !active.includes(currentValue)) {
        f._resolvedOptions.unshift({ value: currentValue, label: currentValue + ' (no longer in Settings)' });
      }
    }
  }
}

async function renderForm(cfg, id) {
  const isEdit = !!id;
  const record = isEdit ? await DB.dbGet(cfg.key, Number(id)) : null;
  await resolveDynamicOptions(cfg.fields, record);

  Router.setBreadcrumb([
    { label: cfg.labelPlural, hash: `/${cfg.key}` },
    { label: isEdit ? (record[cfg.titleField] || 'Edit') : `New ${cfg.label}` }
  ]);

  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="page-head"><h1>${isEdit ? 'Edit' : 'New'} ${cfg.label}</h1></div>
    <form class="card form-card" id="entityForm">
      <div class="form-grid">
        ${cfg.fields.map(f => `
          <div class="field ${f.type === 'textarea' ? 'field-wide' : ''}">
            <label>${escapeHtml(f.label)}${f.required ? ' *' : ''}</label>
            ${fieldInputHTML(f, record ? record[f.name] : undefined)}
          </div>
        `).join('')}
      </div>
      <div class="form-actions">
        <button type="submit" class="btn-amber">Save ${cfg.label}</button>
        <button type="button" class="btn-line" id="btnCancel">Cancel</button>
      </div>
    </form>
  `;

  content.querySelectorAll('input,textarea,select').forEach(i => i.addEventListener('input', markDirty));
  document.getElementById('btnCancel').onclick = () => {
    if (!guardNavigation()) return;
    clearDirty();
    Router.navigate(isEdit ? `/${cfg.key}/${id}` : `/${cfg.key}`);
  };

  document.getElementById('entityForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn.disabled) return; // guards against a double-click firing this handler twice
    submitBtn.disabled = true;
    try {
    const fd = new FormData(e.target);
    const obj = record ? Object.assign({}, record) : {};
    for (const f of cfg.fields) {
      if (f.type === 'checkbox') obj[f.name] = e.target.querySelector(`#f_${f.name}`).checked;
      else if (f.type === 'number' || f.type === 'money') obj[f.name] = Number(fd.get(f.name)) || 0;
      else obj[f.name] = fd.get(f.name) || '';
    }
    const now = new Date().toISOString();
    const settings = await DB.getSettings();
    if (isEdit) {
      obj.updatedAt = now; obj.modifiedBy = settings.userName;
      await DB.dbPut(cfg.key, obj);
      await DB.logActivity(`Updated ${cfg.label.toLowerCase()} ${obj[cfg.titleField]}`);
      toast(`${cfg.label} updated.`);
    } else {
      obj.createdAt = now; obj.updatedAt = now;
      obj.createdBy = settings.userName; obj.modifiedBy = settings.userName;
      obj.status = obj.status || (cfg.defaultStatus || 'Active');
      obj[cfg.numberField] = await DB.nextDocNumber(cfg.counterName);
      const newId = await DB.dbAdd(cfg.key, obj);
      obj.id = newId;
      await DB.logActivity(`Created ${cfg.label.toLowerCase()} ${obj[cfg.numberField]} — ${obj[cfg.titleField]}`);
      toast(`${cfg.label} created.`);
      clearDirty();
      Router.navigate(`/${cfg.key}/${newId}`);
      return;
    }
    clearDirty();
    Router.navigate(`/${cfg.key}/${obj.id}`);
    } finally {
      submitBtn.disabled = false;
    }
  });
}

/* ---------- DETAIL ---------- */

async function renderDetail(cfg, id) {
  const record = await DB.dbGet(cfg.key, Number(id));
  const content = document.getElementById('content');
  if (!record) { content.innerHTML = `<div class="empty-state"><h3>Record not found</h3></div>`; return; }
  await resolveDynamicOptions(cfg.fields, record); // must run here too, independent of whether the edit form was ever opened this session

  Router.setBreadcrumb([
    { label: cfg.labelPlural, hash: `/${cfg.key}` },
    { label: record[cfg.titleField] || record[cfg.numberField] }
  ]);

  const relatedHTML = cfg.relatedPanels ? await cfg.relatedPanels(record) : '';

  content.innerHTML = `
    <div class="page-head">
      <div>
        <div class="doc-number-tag">${escapeHtml(record[cfg.numberField] || '')}</div>
        <h1>${escapeHtml(record[cfg.titleField] || '')} ${statusBadge(record.status)}</h1>
      </div>
      <div class="page-actions">
        <button class="btn-line" id="btnEdit">Edit</button>
        ${record.archived
          ? `<button class="btn-line" id="btnUnarchive">Unarchive</button>`
          : `<button class="btn-line" id="btnArchive">Archive</button>`}
        <button class="btn-danger" id="btnDelete">Delete</button>
      </div>
    </div>

    <div class="card">
      <div class="detail-grid">
        ${cfg.fields.map(f => `
          <div class="detail-item">
            <div class="detail-label">${escapeHtml(f.label)}</div>
            <div class="detail-value">${renderDetailValue(f, record)}</div>
          </div>
        `).join('')}
      </div>
    </div>

    ${relatedHTML}

    <div class="meta-strip">
      Created ${formatDate(record.createdAt)} by ${escapeHtml(record.createdBy || '—')} ·
      Last modified ${formatDate(record.updatedAt)} by ${escapeHtml(record.modifiedBy || '—')}
    </div>
  `;

  document.getElementById('btnEdit').onclick = () => Router.navigate(`/${cfg.key}/${id}/edit`);

  const archiveBtn = document.getElementById('btnArchive');
  if (archiveBtn) archiveBtn.onclick = async () => {
    const settings = await DB.getSettings();
    record.archived = true;
    record.updatedAt = new Date().toISOString();
    record.modifiedBy = settings.userName;
    await DB.dbPut(cfg.key, record);
    await DB.logActivity(`Archived ${cfg.label.toLowerCase()} ${record[cfg.titleField]}`);
    toast(`${cfg.label} archived.`);
    renderDetail(cfg, id);
  };
  const unarchiveBtn = document.getElementById('btnUnarchive');
  if (unarchiveBtn) unarchiveBtn.onclick = async () => {
    const settings = await DB.getSettings();
    record.archived = false;
    record.updatedAt = new Date().toISOString();
    record.modifiedBy = settings.userName;
    await DB.dbPut(cfg.key, record);
    await DB.logActivity(`Restored ${cfg.label.toLowerCase()} ${record[cfg.titleField]}`);
    toast(`${cfg.label} restored.`);
    renderDetail(cfg, id);
  };

  document.getElementById('btnDelete').onclick = async () => {
    const related = cfg.checkRelatedBeforeDelete ? await cfg.checkRelatedBeforeDelete(record) : 0;
    if (related > 0) {
      alert(`"${record[cfg.titleField]}" can't be deleted — it's referenced by ${related} existing transaction record(s) (e.g. a quotation, order, or stock movement). Deleting it would leave those records pointing at something that no longer exists.\n\nUse Archive instead — it hides this ${cfg.label.toLowerCase()} from active lists and new transactions, without breaking anything that already references it.`);
      return;
    }
    if (!confirm(`Permanently delete "${record[cfg.titleField]}"? This cannot be undone.`)) return;
    await DB.dbDelete(cfg.key, Number(id));
    await DB.logActivity(`Deleted ${cfg.label.toLowerCase()} ${record[cfg.titleField]}`);
    toast(`${cfg.label} deleted.`);
    Router.navigate(`/${cfg.key}`);
  };

  // Optional hook for an entity to wire up its own interactive elements inside relatedHTML —
  // the generic engine only knows how to wire the standard Edit/Archive/Delete buttons above.
  if (cfg.afterRender) await cfg.afterRender(record, id);
}

function renderDetailValue(f, record) {
  const v = record[f.name];
  if (f.type === 'checkbox') return v ? 'Yes' : 'No';
  if (f.type === 'money') return formatMoney(v, record.currency || record.defaultCurrency);
  if (f.type === 'date') return formatDate(v);
  if (f.type === 'select-dynamic') {
    const opt = (f._resolvedOptions || []).find(o => String(o.value) === String(v));
    return opt ? escapeHtml(opt.label) : '—';
  }
  if (f.type === 'url') {
    return v ? `<a href="${escapeHtml(v)}" target="_blank" rel="noopener">🔗 Open Listing</a>` : '—';
  }
  return escapeHtml(v || '—');
}

window.Entities = { defineEntity, EntityRegistry };
