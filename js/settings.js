/* ============================================================
   settings.js — Company Settings: profile, defaults, document numbering
   ============================================================ */

const COUNTER_NAMES = [
  { name: 'customer', label: 'Customer' }, { name: 'supplier', label: 'Supplier' },
  { name: 'product', label: 'Product/Item' }, { name: 'quotation', label: 'Quotation' },
  { name: 'customerPO', label: 'Customer PO Record' }, { name: 'salesOrder', label: 'Sales Order' },
  { name: 'supplierPO', label: 'Supplier PO' }
];

Router.route('/settings', async () => {
  Router.setBreadcrumb([{ label: 'Company Settings' }]);
  const settings = await DB.getSettings();
  const counters = await Promise.all(COUNTER_NAMES.map(c => DB.dbGet('counters', c.name)));

  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="page-head"><h1>Company Settings</h1>
      <div class="page-actions"><button class="btn-line" id="btnGoBackup">Backup &amp; Restore →</button></div>
    </div>

    <form class="card form-card" id="settingsForm">
      <div class="settings-tabs">
        <button type="button" class="settings-tab-btn active" data-tab="profile">Company Profile</button>
        <button type="button" class="settings-tab-btn" data-tab="bank">Bank Details</button>
        <button type="button" class="settings-tab-btn" data-tab="defaults">Defaults &amp; Terms</button>
        <button type="button" class="settings-tab-btn" data-tab="currencies">Currencies &amp; Exchange Rates</button>
        <button type="button" class="settings-tab-btn" data-tab="numbering">Document Numbering</button>
      </div>

      <div class="settings-tab-panel active" data-tab="profile">
      <div class="form-grid">
        <div class="field"><label>Company Name</label><input id="s_companyName" value="${escapeHtml(settings.companyName)}"></div>
        <div class="field"><label>Logo Text (shown if no logo image is uploaded)</label><input id="s_logoText" value="${escapeHtml(settings.logoText)}"></div>
        <div class="field field-wide">
          <label>Company Logo</label>
          <div class="logo-upload-row">
            <div class="logo-preview" id="logoPreview">
              ${settings.logoDataUrl ? `<img src="${settings.logoDataUrl}" alt="Company logo">` : `<span class="logo-preview-empty">No logo uploaded</span>`}
            </div>
            <div class="logo-upload-controls">
              <input type="file" id="s_logoFile" accept="image/png,image/jpeg,image/svg+xml,image/webp" style="display:none;">
              <button type="button" class="btn-line btn-sm" id="btnChooseLogo">Choose Image...</button>
              <button type="button" class="btn-danger btn-sm" id="btnRemoveLogo" ${settings.logoDataUrl ? '' : 'style="display:none;"'}>Remove Logo</button>
              <div class="muted-text" style="margin-top:6px;">PNG, JPG, SVG or WEBP. Stored locally with your other data — recommended under 500 KB so backup files stay small. Appears on the sidebar header and on printed Quotations, Sales Orders, and Supplier POs.</div>
            </div>
          </div>
        </div>
        <div class="field field-wide"><label>Address</label><textarea id="s_address">${escapeHtml(settings.address)}</textarea></div>
        <div class="field"><label>Email</label><input id="s_email" value="${escapeHtml(settings.email)}"></div>
        <div class="field"><label>Telephone</label><input id="s_telephone" value="${escapeHtml(settings.telephone)}"></div>
        <div class="field"><label>Website</label><input id="s_website" value="${escapeHtml(settings.website)}"></div>
        <div class="field"><label>Tax Identification Number</label><input id="s_tin" value="${escapeHtml(settings.tin)}"></div>
        <div class="field"><label>Authorized Signatory</label><input id="s_authorizedSignatory" value="${escapeHtml(settings.authorizedSignatory)}"></div>
        <div class="field field-wide">
          <label>Signature Image (appears on printed Quotations, Sales Orders, and Supplier POs)</label>
          <div class="logo-upload-row">
            <div class="logo-preview" id="signaturePreview">
              ${settings.signatureDataUrl ? `<img src="${settings.signatureDataUrl}" alt="Authorized signature">` : `<span class="logo-preview-empty">No signature uploaded</span>`}
            </div>
            <div class="logo-upload-controls">
              <input type="file" id="s_signatureFile" accept="image/png,image/jpeg,image/webp" style="display:none;">
              <button type="button" class="btn-line btn-sm" id="btnChooseSignature">Choose Image...</button>
              <button type="button" class="btn-danger btn-sm" id="btnRemoveSignature" ${settings.signatureDataUrl ? '' : 'style="display:none;"'}>Remove Signature</button>
              <div class="muted-text" style="margin-top:6px;">A transparent PNG works best. This becomes the default signature on all printed documents — it appears above the "${escapeHtml(settings.authorizedSignatory) || 'Authorized Signatory'}" line automatically, so you don't need to sign printouts by hand.</div>
            </div>
          </div>
        </div>
        <div class="field"><label>Your Name (for audit trail)</label><input id="s_userName" value="${escapeHtml(settings.userName)}"></div>
      </div>
      </div>

      <div class="settings-tab-panel" data-tab="bank">
      <p class="muted-text">Shown on Sales Order / Order Confirmation and Proforma Invoice printouts. Never shown on Quotations (still just a proposal at that stage) or Supplier POs (that's a document where you're the one paying a supplier).</p>
      <div class="form-grid">
        <div class="field"><label>Bank Name</label><input id="s_bankName" value="${escapeHtml(settings.bankName || '')}"></div>
        <div class="field"><label>Account Name</label><input id="s_bankAccountName" value="${escapeHtml(settings.bankAccountName || '')}"></div>
        <div class="field"><label>Account Number</label><input id="s_bankAccountNumber" value="${escapeHtml(settings.bankAccountNumber || '')}"></div>
        <div class="field"><label>SWIFT Code</label><input id="s_bankSwiftCode" value="${escapeHtml(settings.bankSwiftCode || '')}"></div>
        <div class="field field-wide"><label>Bank Address</label><textarea id="s_bankAddress">${escapeHtml(settings.bankAddress || '')}</textarea></div>
      </div>
      </div>

      <div class="settings-tab-panel" data-tab="defaults">
      <div class="form-grid">
        <div class="field"><label>Default Currency</label><select id="s_defaultCurrency"></select></div>
        <div class="field"><label>Default VAT Rate (%)</label><input type="number" id="s_defaultVatRate" value="${settings.defaultVatRate}"></div>
        <div class="field"><label>Default Payment Terms</label><input id="s_defaultPaymentTerms" value="${escapeHtml(settings.defaultPaymentTerms)}"></div>
        <div class="field"><label>Default Quotation Validity (days)</label><input type="number" id="s_defaultQuotationValidityDays" value="${settings.defaultQuotationValidityDays}"></div>
        <div class="field"><label>Default Warranty</label><input id="s_defaultWarranty" value="${escapeHtml(settings.defaultWarranty)}"></div>
        <div class="field"><label>Default Incoterms</label><input id="s_defaultIncoterms" value="${escapeHtml(settings.defaultIncoterms)}"></div>
        <div class="field field-wide"><label>Quotation Footer / Terms &amp; Conditions</label><textarea id="s_footerTerms" rows="5">${escapeHtml(settings.footerTerms)}</textarea></div>
      </div>
      </div>

      <div class="settings-tab-panel" data-tab="currencies">
      <p class="muted-text">Add any currency your suppliers quote in (SGD, HKD, QAR, AED — any 3-letter code) with its
        exchange rate to PHP. These become available everywhere a currency is picked — Products, Customers,
        Suppliers, and per-line item cost currency on Quotations. PHP itself is always available at a fixed rate of 1.</p>
      <table class="data-table compact" id="currencyTable">
        <thead><tr><th>Currency</th><th>Exchange Rate to PHP</th><th></th></tr></thead>
        <tbody>
          <tr><td><b>PHP</b></td><td>1 (fixed)</td><td></td></tr>
          ${Object.entries(settings.referenceRates || {}).map(([code, rate]) => `
            <tr data-ccy-row="${escapeHtml(code)}">
              <td><input class="ccy-code" value="${escapeHtml(code)}" maxlength="6" style="width:80px; text-transform:uppercase;"></td>
              <td><input class="ccy-rate" type="number" min="0" step="0.0001" value="${rate}" style="width:120px;"></td>
              <td><span class="row-del" data-delcurrency="${escapeHtml(code)}">✕</span></td>
            </tr>`).join('')}
        </tbody>
      </table>
      <div class="add-row-inline" style="margin-top:10px; display:flex; gap:8px; align-items:center;">
        <input type="text" id="newCcyCode" placeholder="e.g. SGD" maxlength="6" style="width:100px; text-transform:uppercase;">
        <input type="number" id="newCcyRate" placeholder="Rate to PHP" min="0" step="0.0001" style="width:130px;">
        <button type="button" class="btn-line btn-sm" id="btnAddCurrency">+ Add Currency</button>
      </div>
      </div>

      <div class="settings-tab-panel" data-tab="numbering">
      <table class="data-table compact">
        <thead><tr><th>Document</th><th>Prefix</th><th>Next Number</th></tr></thead>
        <tbody>
          ${COUNTER_NAMES.map((c, i) => `
            <tr>
              <td>${c.label}</td>
              <td><input class="cnt-prefix" data-name="${c.name}" value="${escapeHtml(counters[i]?.prefix || '')}" style="width:100px;"></td>
              <td><input class="cnt-next" type="number" min="1" data-name="${c.name}" value="${counters[i]?.next || 1}" style="width:90px;"></td>
            </tr>`).join('')}
        </tbody>
      </table>
      </div>

      <div class="form-actions"><button type="submit" class="btn-amber">Save Settings</button></div>
    </form>
  `;

  document.getElementById('btnGoBackup').onclick = () => Router.navigate('/settings/backup');
  content.querySelectorAll('input,textarea,select').forEach(i => i.addEventListener('input', markDirty));

  // ---- Tabs — purely visual grouping; everything still lives in one form, one Save button ----
  content.querySelectorAll('.settings-tab-btn').forEach(btn => btn.addEventListener('click', () => {
    content.querySelectorAll('.settings-tab-btn').forEach(b => b.classList.remove('active'));
    content.querySelectorAll('.settings-tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    content.querySelector(`.settings-tab-panel[data-tab="${btn.dataset.tab}"]`).classList.add('active');
  }));

  // ---- Default Currency dropdown, built from the currency table below (kept in sync live) ----
  function refreshDefaultCurrencyOptions() {
    const codes = ['PHP', ...[...content.querySelectorAll('#currencyTable [data-ccy-row]')].map(tr => tr.querySelector('.ccy-code').value.trim().toUpperCase()).filter(Boolean)];
    const sel = document.getElementById('s_defaultCurrency');
    const current = sel.value || settings.defaultCurrency;
    sel.innerHTML = codes.map(c => `<option ${c === current ? 'selected' : ''}>${c}</option>`).join('');
  }
  refreshDefaultCurrencyOptions();

  // ---- Currencies & Exchange Rates table ----
  const currencyBody = document.querySelector('#currencyTable tbody');
  function currencyRowHTML(code, rate) {
    return `<tr data-ccy-row="${escapeHtml(code)}">
      <td><input class="ccy-code" value="${escapeHtml(code)}" maxlength="6" style="width:80px; text-transform:uppercase;"></td>
      <td><input class="ccy-rate" type="number" min="0" step="0.0001" value="${rate}" style="width:120px;"></td>
      <td><span class="row-del" data-delcurrency="1">✕</span></td>
    </tr>`;
  }
  currencyBody.addEventListener('click', (e) => {
    if (e.target.dataset.delcurrency) {
      e.target.closest('tr').remove();
      refreshDefaultCurrencyOptions();
      markDirty();
    }
  });
  currencyBody.addEventListener('input', (e) => {
    if (e.target.classList.contains('ccy-code')) { e.target.value = e.target.value.toUpperCase(); refreshDefaultCurrencyOptions(); }
  });
  document.getElementById('btnAddCurrency').addEventListener('click', () => {
    const code = document.getElementById('newCcyCode').value.trim().toUpperCase();
    const rate = Number(document.getElementById('newCcyRate').value);
    if (!code) { toast('Enter a currency code, e.g. SGD.', 'err'); return; }
    if (code === 'PHP') { toast('PHP is already included by default.', 'err'); return; }
    const existing = [...currencyBody.querySelectorAll('.ccy-code')].some(i => i.value.trim().toUpperCase() === code);
    if (existing) { toast(code + ' is already in the list.', 'err'); return; }
    if (!rate || rate <= 0) { toast('Enter a valid exchange rate to PHP.', 'err'); return; }
    currencyBody.insertAdjacentHTML('beforeend', currencyRowHTML(code, rate));
    document.getElementById('newCcyCode').value = '';
    document.getElementById('newCcyRate').value = '';
    refreshDefaultCurrencyOptions();
    markDirty();
  });

  // ---- Logo upload ----
  let pendingLogoDataUrl = settings.logoDataUrl || '';
  const MAX_LOGO_BYTES = 1.5 * 1024 * 1024; // 1.5MB safety cap so backups don't bloat
  document.getElementById('btnChooseLogo').onclick = () => document.getElementById('s_logoFile').click();
  document.getElementById('s_logoFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES) {
      toast('That image is too large (max 1.5 MB). Please use a smaller file.', 'err');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      pendingLogoDataUrl = ev.target.result;
      document.getElementById('logoPreview').innerHTML = `<img src="${pendingLogoDataUrl}" alt="Company logo">`;
      document.getElementById('btnRemoveLogo').style.display = '';
      markDirty();
    };
    reader.onerror = () => toast('Could not read that image file.', 'err');
    reader.readAsDataURL(file);
    e.target.value = '';
  });
  document.getElementById('btnRemoveLogo').onclick = () => {
    pendingLogoDataUrl = '';
    document.getElementById('logoPreview').innerHTML = `<span class="logo-preview-empty">No logo uploaded</span>`;
    document.getElementById('btnRemoveLogo').style.display = 'none';
    markDirty();
  };

  // ---- Signature upload (same pattern as logo upload above) ----
  let pendingSignatureDataUrl = settings.signatureDataUrl || '';
  const MAX_SIGNATURE_BYTES = 1.5 * 1024 * 1024;
  document.getElementById('btnChooseSignature').onclick = () => document.getElementById('s_signatureFile').click();
  document.getElementById('s_signatureFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > MAX_SIGNATURE_BYTES) {
      toast('That image is too large (max 1.5 MB). Please use a smaller file.', 'err');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      pendingSignatureDataUrl = ev.target.result;
      document.getElementById('signaturePreview').innerHTML = `<img src="${pendingSignatureDataUrl}" alt="Authorized signature">`;
      document.getElementById('btnRemoveSignature').style.display = '';
      markDirty();
    };
    reader.onerror = () => toast('Could not read that image file.', 'err');
    reader.readAsDataURL(file);
    e.target.value = '';
  });
  document.getElementById('btnRemoveSignature').onclick = () => {
    pendingSignatureDataUrl = '';
    document.getElementById('signaturePreview').innerHTML = `<span class="logo-preview-empty">No signature uploaded</span>`;
    document.getElementById('btnRemoveSignature').style.display = 'none';
    markDirty();
  };

  document.getElementById('settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const updated = Object.assign({}, settings, {
      companyName: document.getElementById('s_companyName').value,
      logoText: document.getElementById('s_logoText').value,
      logoDataUrl: pendingLogoDataUrl,
      address: document.getElementById('s_address').value,
      email: document.getElementById('s_email').value,
      telephone: document.getElementById('s_telephone').value,
      website: document.getElementById('s_website').value,
      tin: document.getElementById('s_tin').value,
      authorizedSignatory: document.getElementById('s_authorizedSignatory').value,
      bankName: document.getElementById('s_bankName').value,
      bankAccountName: document.getElementById('s_bankAccountName').value,
      bankAccountNumber: document.getElementById('s_bankAccountNumber').value,
      bankSwiftCode: document.getElementById('s_bankSwiftCode').value,
      bankAddress: document.getElementById('s_bankAddress').value,
      signatureDataUrl: pendingSignatureDataUrl,
      userName: document.getElementById('s_userName').value,
      defaultCurrency: document.getElementById('s_defaultCurrency').value,
      defaultVatRate: Number(document.getElementById('s_defaultVatRate').value) || 12,
      referenceRates: Object.fromEntries(
        [...content.querySelectorAll('#currencyTable [data-ccy-row]')]
          .map(tr => [tr.querySelector('.ccy-code').value.trim().toUpperCase(), Number(tr.querySelector('.ccy-rate').value) || 0])
          .filter(([code, rate]) => code && code !== 'PHP' && rate > 0)
      ),
      defaultPaymentTerms: document.getElementById('s_defaultPaymentTerms').value,
      defaultQuotationValidityDays: Number(document.getElementById('s_defaultQuotationValidityDays').value) || 30,
      defaultWarranty: document.getElementById('s_defaultWarranty').value,
      defaultIncoterms: document.getElementById('s_defaultIncoterms').value,
      footerTerms: document.getElementById('s_footerTerms').value
    });
    await DB.dbPut('settings', updated);

    for (const row of content.querySelectorAll('.cnt-prefix')) {
      const name = row.dataset.name;
      const c = await DB.dbGet('counters', name);
      c.prefix = row.value;
      c.next = Number(content.querySelector(`.cnt-next[data-name="${name}"]`).value) || c.next;
      await DB.dbPut('counters', c);
    }

    toast('Settings saved.');
    clearDirty();
    if (window.applyBrandHeader) applyBrandHeader(updated);
  });
});
