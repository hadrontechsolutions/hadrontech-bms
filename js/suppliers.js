/* ============================================================
   suppliers.js — Supplier master records
   ============================================================ */

Entities.defineEntity({
  key: 'suppliers',
  label: 'Supplier',
  labelPlural: 'Suppliers',
  numberField: 'supplierNo',
  counterName: 'supplier',
  titleField: 'companyName',
  defaultStatus: 'Active',
  searchFields: ['companyName', 'contactPerson', 'email', 'supplierNo', 'brandsSupplied'],
  listColumns: [
    { key: 'supplierNo', label: 'Supplier #' },
    { key: 'companyName', label: 'Company Name' },
    { key: 'platform', label: 'Platform', render: r => r.platform && r.platform !== 'Direct / Traditional Supplier' ? `<span class="badge badge-info">${escapeHtml(r.platform)}</span>` : 'Direct' },
    { key: 'brandsSupplied', label: 'Brands' },
    { key: 'country', label: 'Country' },
    { key: 'status', label: 'Status', render: r => statusBadge(r.status) }
  ],
  fields: [
    { name: 'companyName', label: 'Company Name', type: 'text', required: true },
    { name: 'platform', label: 'Sourcing Platform', type: 'select', default: 'Direct / Traditional Supplier', options: ['Direct / Traditional Supplier', 'Alibaba', 'Shopee', 'Lazada', 'Other Marketplace'] },
    { name: 'contactPerson', label: 'Contact Person', type: 'text' },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'telephone', label: 'Telephone', type: 'text' },
    { name: 'website', label: 'Website', type: 'text' },
    { name: 'tin', label: 'Tax Identification Number (TIN)', type: 'text' },
    { name: 'address', label: 'Address', type: 'textarea' },
    { name: 'country', label: 'Country', type: 'text' },
    { name: 'currency', label: 'Currency We Pay This Supplier In', type: 'currency-select', required: true, blankOption: true },
    { name: 'brandsSupplied', label: 'Brands Supplied', type: 'text' },
    { name: 'productCategories', label: 'Product Categories', type: 'text' },
    { name: 'paymentTerms', label: 'Payment Terms', type: 'text' },
    { name: 'incoterms', label: 'Incoterms', type: 'text' },
    { name: 'status', label: 'Status', type: 'select', options: ['Active', 'Inactive'] },
    { name: 'notes', label: 'Notes', type: 'textarea' }
  ],
  /** Safety: if the supplier's currency is changed, products that name this supplier but use another currency would no longer match. */
  beforeSave: async (obj, form, orig) => {
    if (!orig || !obj.currency || obj.currency === orig.currency) return null;
    const mismatched = (await DB.dbGetAll('products')).filter(p => !p.archived && p.type !== 'Project Package' && String(p.defaultSupplierId) === String(orig.id) && p.currency && p.currency !== obj.currency);
    if (!mismatched.length) return null;
    const names = mismatched.slice(0, 5).map(p => `• ${p.itemNo} (${p.currency})`).join('\n') + (mismatched.length > 5 ? `\n…and ${mismatched.length - 5} more` : '');
    return confirm(`${mismatched.length} product(s) supplied by ${obj.companyName} are priced in a different currency than ${obj.currency}:\n\n${names}\n\nThey will not be changed, but they will not match this supplier until you update them (the product will be blocked from saving until it matches). Save the new currency anyway?`) ? null : 'Not saved — the supplier currency was left as it was.';
  },
  checkRelatedBeforeDelete: async (record) => {
    const po = await DB.dbQueryIndex('supplierPOs', 'supplierId', record.id);
    return po.length;
  },
  relatedPanels: async (record) => {
    const pos = await DB.dbQueryIndex('supplierPOs', 'supplierId', record.id);
    return relatedTable('Supplier Purchase Orders', pos, ['poNo', 'poDate', 'status', 'totalCost'], '/supplier-pos');
  }
});
