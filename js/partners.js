/* ============================================================
   partners.js — People who share in the business's distributable
   profit: partners (family) and employees (Type field; an Employee's
   payslip shows only their own earnings, never the business totals). Uses the shared generic entity engine since this is a
   straightforward reusable list: name + a default split %, so a
   Distribution doesn't require retyping the same people and
   percentages every time.

   defaultSplitPercent is only a starting point pre-filled onto a new
   Distribution -- the actual percentage used is always editable per
   distribution and gets snapshotted there, so changing a partner's
   default here never rewrites past distribution history.
   ============================================================ */

Entities.defineEntity({
  key: 'partners',
  label: 'Partner / Employee',
  labelPlural: 'Partners & Employees',
  numberField: 'partnerNo',
  counterName: 'partner',
  // Employees get an Employee # (HT-EMP-…), partners a Partner # (HT-PTR-…); both print on the payslip.
  counterFor: (obj) => obj.partnerType === 'Employee' ? 'employee' : 'partner',
  // If the Type is changed later, the number is re-issued so the payslip never says "Employee #HT-PTR-…".
  beforeSave: async (obj, form, record) => {
    if (!record) return;
    const want = obj.partnerType === 'Employee' ? 'HT-EMP-' : 'HT-PTR-';
    if (!String(record.partnerNo || '').startsWith(want)) obj.partnerNo = await DB.nextDocNumber(obj.partnerType === 'Employee' ? 'employee' : 'partner');
  },
  afterFormRender: (form, record) => {
    const h = form.parentElement && form.parentElement.querySelector('.page-head h1'); if (!h) return;
    h.insertAdjacentHTML('afterend', `<div class="doc-number-tag" style="margin:-4px 0 12px;">${record ? escapeHtml((record.partnerType === 'Employee' ? 'Employee #' : 'Partner #') + ' ' + (record.partnerNo || '')) : 'The Employee # / Partner # is assigned automatically when you save.'}</div>`);
  },
  titleField: 'name',
  defaultStatus: 'Active',
  searchFields: ['name', 'role', 'partnerNo'],
  listColumns: [
    { key: 'partnerNo', label: 'Employee # / Partner #', render: r => escapeHtml(r.partnerNo || '—') },
    { key: 'name', label: 'Name' },
    { key: 'partnerType', label: 'Type', render: r => escapeHtml(r.partnerType || 'Partner') },
    { key: 'role', label: 'Position / Role' },
    { key: 'defaultSplitPercent', label: 'Default Split %', render: r => `${r.defaultSplitPercent ?? 0}%` },
    { key: 'status', label: 'Status', render: r => statusBadge(r.status) }
  ],
  fields: [
    { name: 'name', label: 'Name', type: 'text', required: true },
    { name: 'partnerType', label: 'Type (an Employee\'s payslip hides the business totals)', type: 'select', options: ['Partner', 'Employee'] },
    { name: 'role', label: 'Position / Role', type: 'text' },
    { name: 'defaultSplitPercent', label: 'Default Share %', type: 'number' },
    { name: 'notes', label: 'Notes', type: 'textarea' }
  ]
});
