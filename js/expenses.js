/* ============================================================
   expenses.js — General operating expenses (rent, utilities, salaries,
   supplies, etc.) for bookkeeping. Uses the shared generic entity
   engine (entities.js) since this is a straightforward record type
   with no special workflow, the same way Customers/Suppliers/
   Products do.

   Deliberately kept separate from Supplier POs: most expenses (rent,
   government fees, employee reimbursements, bank charges) don't come
   from a "supplier" in the purchasing/inventory sense at all, and
   forcing every expense through the Supplier catalog would mean
   creating throwaway supplier records for a landlord or a power
   company. Payee here is free text instead.

   Amount is treated as PHP-only, matching the same convention as
   customer-facing money elsewhere in this system (Hadrontech is a
   domestic Non-VAT business; an operating expense in a foreign
   currency would be a rare exception, not the normal case worth
   building a whole currency picker around).
   ============================================================ */

const EXPENSE_CATEGORIES = [
  'Rent', 'Utilities (Electricity, Water)', 'Communication (Phone, Internet)',
  'Salaries & Wages', 'Office Supplies', 'Transportation & Fuel', 'Professional Fees',
  'Taxes & Licenses', 'Repairs & Maintenance', 'Insurance', 'Bank Charges',
  'Representation & Entertainment', 'Freight & Delivery', 'Miscellaneous'
];
const EXPENSE_PAYMENT_METHODS = ['Cash', 'Bank Transfer', 'Check', 'Company Card', 'Other'];

Entities.defineEntity({
  key: 'expenses',
  label: 'Expense',
  labelPlural: 'Expenses',
  numberField: 'expenseNo',
  counterName: 'expense',
  titleField: 'description',
  defaultStatus: 'Recorded',
  searchFields: ['description', 'payee', 'category', 'referenceNo'],
  listColumns: [
    { key: 'date', label: 'Date', render: r => formatDate(r.date) },
    { key: 'category', label: 'Category' },
    { key: 'description', label: 'Description' },
    { key: 'payee', label: 'Payee' },
    { key: 'amount', label: 'Amount', render: r => formatMoney(r.amount, 'PHP') }
  ],
  fields: [
    { name: 'date', label: 'Date', type: 'date', required: true },
    { name: 'category', label: 'Category', type: 'select', options: EXPENSE_CATEGORIES, required: true },
    { name: 'description', label: 'Description', type: 'text', required: true },
    { name: 'payee', label: 'Payee', type: 'text' },
    { name: 'amount', label: 'Amount (PHP)', type: 'money', required: true },
    { name: 'paymentMethod', label: 'Payment Method', type: 'select', options: EXPENSE_PAYMENT_METHODS },
    { name: 'referenceNo', label: 'Reference / OR No.', type: 'text' },
    { name: 'notes', label: 'Notes', type: 'textarea' }
  ]
});

window.ExpenseCategories = EXPENSE_CATEGORIES;
