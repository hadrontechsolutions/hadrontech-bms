/* ============================================================
   partners.js — People who share in the business's distributable
   profit (family partners today, could include actual employees
   later). Uses the shared generic entity engine since this is a
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
  label: 'Partner',
  labelPlural: 'Partners',
  numberField: 'partnerNo',
  counterName: 'partner',
  titleField: 'name',
  defaultStatus: 'Active',
  searchFields: ['name', 'role'],
  listColumns: [
    { key: 'name', label: 'Name' },
    { key: 'role', label: 'Role' },
    { key: 'defaultSplitPercent', label: 'Default Split %', render: r => `${r.defaultSplitPercent ?? 0}%` },
    { key: 'status', label: 'Status', render: r => statusBadge(r.status) }
  ],
  fields: [
    { name: 'name', label: 'Name', type: 'text', required: true },
    { name: 'role', label: 'Role', type: 'text' },
    { name: 'defaultSplitPercent', label: 'Default Split %', type: 'number' },
    { name: 'notes', label: 'Notes', type: 'textarea' }
  ]
});
