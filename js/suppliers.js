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
    { name: 'address', label: 'Address', type: 'textarea' },
    { name: 'country', label: 'Country', type: 'text' },
    { name: 'brandsSupplied', label: 'Brands Supplied', type: 'text' },
    { name: 'productCategories', label: 'Product Categories', type: 'text' },
    { name: 'currency', label: 'Currency', type: 'currency-select', default: 'USD' },
    { name: 'paymentTerms', label: 'Payment Terms', type: 'text' },
    { name: 'incoterms', label: 'Incoterms', type: 'text' },
    { name: 'leadTime', label: 'Typical Lead Time', type: 'text' },
    { name: 'authorizedDistributor', label: 'Authorized Distributor', type: 'checkbox' },
    { name: 'rating', label: 'Supplier Rating', type: 'select', options: ['1', '2', '3', '4', '5'] },
    { name: 'status', label: 'Status', type: 'select', options: ['Active', 'Inactive'] },
    { name: 'notes', label: 'Notes', type: 'textarea' }
  ],
  checkRelatedBeforeDelete: async (record) => {
    const po = await DB.dbQueryIndex('supplierPOs', 'supplierId', record.id);
    return po.length;
  },
  relatedPanels: async (record) => {
    const pos = await DB.dbQueryIndex('supplierPOs', 'supplierId', record.id);
    return relatedTable('Supplier Purchase Orders', pos, ['poNo', 'poDate', 'status', 'totalCost'], '/supplier-pos', record.currency);
  }
});
