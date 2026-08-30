/* ============================================================
   seed.js — inserts sample records on first run only, so the app
   isn't empty out of the box. Every sample record can be deleted
   normally through the UI.
   ============================================================ */

async function seedIfEmpty() {
  const existing = await DB.dbGetAll('customers');
  if (existing.length > 0) return; // already has data (or user's real data) — never overwrite

  const now = new Date().toISOString();
  const by = { createdAt: now, updatedAt: now, createdBy: 'Sample Data', modifiedBy: 'Sample Data' };

  const cust1Id = await DB.dbAdd('customers', Object.assign({
    customerNo: await DB.nextDocNumber('customer'), companyName: 'Luzon Water Treatment Corp.',
    customerType: 'Contractor', contactPerson: 'Maria Santos', jobTitle: 'Procurement Manager',
    email: 'maria.santos@example.com', telephone: '(046) 123-4567', mobile: '0917-000-1111',
    billingAddress: 'Km 30 National Highway, General Trias, Cavite', shippingAddress: 'Same as billing',
    country: 'Philippines', tin: '000-111-222-000', vatStatus: 'VAT Registered', defaultCurrency: 'PHP',
    paymentTerms: '50% down / 50% before delivery', incoterms: 'EXW', creditLimit: 500000,
    salesperson: 'Admin', industry: 'Water Treatment', status: 'Active', notes: 'Sample record — safe to delete.'
  }, by));

  const cust2Id = await DB.dbAdd('customers', Object.assign({
    customerNo: await DB.nextDocNumber('customer'), companyName: 'Cavite Steel Fabrication Inc.',
    customerType: 'Wholesale', contactPerson: 'Robert Cruz', jobTitle: 'Purchasing Officer',
    email: 'robert.cruz@example.com', telephone: '(046) 987-6543', mobile: '0917-222-3333',
    billingAddress: 'Governor\'s Drive, Dasmariñas, Cavite', shippingAddress: 'Same as billing',
    country: 'Philippines', tin: '000-333-444-000', vatStatus: 'VAT Registered', defaultCurrency: 'PHP',
    paymentTerms: '30 days after delivery', incoterms: 'DAP', creditLimit: 300000,
    salesperson: 'Admin', industry: 'Steel Fabrication', status: 'Active', notes: 'Sample record — safe to delete.'
  }, by));

  const sup1Id = await DB.dbAdd('suppliers', Object.assign({
    supplierNo: await DB.nextDocNumber('supplier'), companyName: 'Grundfos Pumps Asia Pte Ltd',
    contactPerson: 'John Lim', email: 'john.lim@example.com', telephone: '+65 6000 0000',
    website: 'https://www.grundfos.com', address: 'Singapore', country: 'Singapore',
    brandsSupplied: 'Grundfos', productCategories: 'Centrifugal Pumps, Submersible Pumps',
    currency: 'USD', paymentTerms: '30% down / 70% before shipment', incoterms: 'FOB',
    leadTime: '6-8 weeks', authorizedDistributor: true, rating: '5', status: 'Active', notes: 'Sample record — safe to delete.'
  }, by));

  const sup2Id = await DB.dbAdd('suppliers', Object.assign({
    supplierNo: await DB.nextDocNumber('supplier'), companyName: 'Victaulic Fittings Trading Co.',
    contactPerson: 'Amy Tan', email: 'amy.tan@example.com', telephone: '+65 6111 1111',
    website: 'https://www.victaulic.com', address: 'Singapore', country: 'Singapore',
    brandsSupplied: 'Victaulic', productCategories: 'Pipe Fittings, Valves, Couplings',
    currency: 'USD', paymentTerms: '50% down / 50% before shipment', incoterms: 'FOB',
    leadTime: '4-6 weeks', authorizedDistributor: false, rating: '4', status: 'Active', notes: 'Sample record — safe to delete.'
  }, by));

  const prod1Id = await DB.dbAdd('products', Object.assign({
    itemNo: await DB.nextDocNumber('product'), type: 'Product', category: 'Pumps',
    manufacturer: 'Grundfos', brand: 'Grundfos', modelNo: 'CR 15-4',
    description: 'Vertical multistage centrifugal pump, CR 15-4, cast iron', uom: 'pc',
    defaultSupplierId: sup1Id, supplierPartNo: 'CR15-4-A-FGJ-A-E-HQQE',
    standardCost: 850, standardPrice: 1150, currency: 'USD', markupPercent: 35,
    vatClass: 'VATable', countryOfOrigin: 'Denmark', leadTime: '6-8 weeks',
    warranty: '1 year from delivery', status: 'Active', notes: 'Sample record — safe to delete.'
  }, by));

  const prod2Id = await DB.dbAdd('products', Object.assign({
    itemNo: await DB.nextDocNumber('product'), type: 'Product', category: 'Valves',
    manufacturer: 'Victaulic', brand: 'Victaulic', modelNo: 'Series 761',
    description: 'Butterfly valve, 6 inch, ductile iron body', uom: 'pc',
    defaultSupplierId: sup2Id, supplierPartNo: '761-6IN',
    standardCost: 180, standardPrice: 260, currency: 'USD', markupPercent: 44,
    vatClass: 'VATable', countryOfOrigin: 'USA', leadTime: '4-6 weeks',
    warranty: '1 year from delivery', status: 'Active', notes: 'Sample record — safe to delete.'
  }, by));

  const prod3Id = await DB.dbAdd('products', Object.assign({
    itemNo: await DB.nextDocNumber('product'), type: 'Service', category: 'Installation',
    manufacturer: '', brand: '', modelNo: '', description: 'On-site installation and commissioning service',
    uom: 'lot', defaultSupplierId: '', supplierPartNo: '', standardCost: 0, standardPrice: 25000,
    currency: 'PHP', markupPercent: 0, vatClass: 'VATable', countryOfOrigin: 'Philippines',
    leadTime: '', warranty: '', status: 'Active', notes: 'Sample record — safe to delete.'
  }, by));

  // Sample quotation
  const custRec = await DB.dbGet('customers', cust1Id);
  const lines = [
    { lineId: 'L1', itemId: prod1Id, brand: 'Grundfos', modelNo: 'CR 15-4', description: 'Vertical multistage centrifugal pump, CR 15-4', qty: 2, uom: 'pc', unitCost: 850, markupPercent: 35, unitPrice: 1150, discountPercent: 0, vatRate: 12, supplierId: sup1Id, supplierQuoteRef: 'GRD-Q-1187', leadTime: '6-8 weeks', remarks: '' },
    { lineId: 'L2', itemId: prod2Id, brand: 'Victaulic', modelNo: 'Series 761', description: 'Butterfly valve, 6 inch, ductile iron body', qty: 4, uom: 'pc', unitCost: 180, markupPercent: 44, unitPrice: 260, discountPercent: 5, vatRate: 12, supplierId: sup2Id, supplierQuoteRef: 'VIC-Q-4521', leadTime: '4-6 weeks', remarks: '' },
    { lineId: 'L3', itemId: prod3Id, brand: '', modelNo: '', description: 'On-site installation and commissioning service', qty: 1, uom: 'lot', unitCost: 0, markupPercent: 0, unitPrice: 25000, discountPercent: 0, vatRate: 12, supplierId: '', supplierQuoteRef: '', leadTime: '', remarks: '' }
  ];
  const quoteHeader = {
    customerId: cust1Id,
    customerSnapshot: { companyName: custRec.companyName, address: custRec.billingAddress, contactPerson: custRec.contactPerson, email: custRec.email, tin: custRec.tin },
    rfqRef: 'RFQ-2026-0044', projectName: 'Booster Pump Station Upgrade', endUser: 'Luzon Water Treatment Corp.',
    salesperson: 'Admin', date: todayISO(), validUntil: addDaysISO(todayISO(), 30), currency: 'PHP',
    paymentTerms: '50% down payment, 50% before delivery', incoterms: 'DAP',
    deliveryLeadTime: '8-10 weeks from PO', warranty: '1 year from delivery', vatMode: 'Standard12',
    overallDiscountPercent: 0, freightCharge: 5000, otherCharges: 0,
    internalNotes: 'Sample record — safe to delete.', customerNotes: 'Thank you for the opportunity to quote.',
    lines
  };
  const totals = QuoteCalc.computeQuotationTotals(quoteHeader);
  Object.assign(quoteHeader, totals);
  const quotationNo = await DB.nextDocNumber('quotation');
  const qId = await DB.dbAdd('quotations', Object.assign({
    quotationNo, revision: 0, isLatest: true, status: 'Sent', statusHistory: [{ status: 'Draft', date: now }, { status: 'Sent', date: now }]
  }, quoteHeader, by));
  const qRec = await DB.dbGet('quotations', qId);
  qRec.familyId = qId;
  await DB.dbPut('quotations', qRec);

  await DB.logActivity('Sample data loaded (customers, suppliers, products, one sample quotation)');
}

window.seedIfEmpty = seedIfEmpty;
