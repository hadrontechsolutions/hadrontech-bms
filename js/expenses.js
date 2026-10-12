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

/** The Payee is always our own business. Fills blanks and fixes variants such as "Hadrontech Solutions". */
const isOurName = (v) => !v || /^\s*hadrontech\b/i.test(v);
async function normalizeExpensePayees() {
  const name = (await DB.getSettings()).companyName || 'Hadrontech Industrial Solutions';
  for (const x of await DB.dbGetAll('expenses')) if (isOurName(x.payee) && x.payee !== name) { x.payee = name; await DB.dbPut('expenses', x); }
}

/** New expense: Payee pre-filled with our business name. Saving warns when the same description and amount
 *  was already recorded within 7 days (a likely double entry) - recurring monthly bills are not flagged. */
async function setupExpenseForm(form, record) {
  const name = (await DB.getSettings()).companyName || 'Hadrontech Industrial Solutions';
  const pay = form.querySelector('#f_payee'); if (pay && (!record || isOurName(pay.value))) pay.value = name;
  const others = (await DB.dbGetAll('expenses')).filter(x => !record || x.id !== record.id);
  form.addEventListener('submit', (e) => {
    const g = (id) => (form.querySelector('#f_' + id) || {}).value || '';
    const desc = g('description').trim().toLowerCase(), amt = Number(g('amount')), date = g('date');
    const dup = others.find(x => String(x.description || '').trim().toLowerCase() === desc && Number(x.amount) === amt && date && x.date && Math.abs(daysBetweenISO(String(x.date).slice(0, 10), date)) <= 7);
    if (dup && !confirm(`Possible double entry: "${dup.description}" for ${formatMoney(dup.amount, 'PHP')} is already recorded on ${formatDate(dup.date)}. Save this one anyway?`)) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
}

Entities.defineEntity({
  key: 'expenses',
  label: 'Expense',
  labelPlural: 'Expenses',
  numberField: 'expenseNo',
  counterName: 'expense',
  titleField: 'description',
  defaultStatus: 'Recorded',
  searchFields: ['description', 'payee', 'vendor', 'category', 'referenceNo'],
  // Newest expense date first (the entry order used to leave Oct 8 below Oct 12 and Aug 24 last).
  sortList: (a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')),
  beforeList: async () => { await normalizeExpensePayees(); },
  afterFormRender: (form, record) => setupExpenseForm(form, record),
  listColumns: [
    { key: 'date', label: 'Date', render: r => formatDate(r.date) },
    { key: 'category', label: 'Category' },
    { key: 'description', label: 'Description' },
    { key: 'vendor', label: 'Paid to / Bought from', render: r => escapeHtml(r.vendor || '—') },
    { key: 'payee', label: 'Payee' },
    { key: 'amount', label: 'Amount', render: r => formatMoney(r.amount, 'PHP') }
  ],
  fields: [
    { name: 'date', label: 'Date', type: 'date', required: true },
    { name: 'category', label: 'Category', type: 'select', options: EXPENSE_CATEGORIES, required: true },
    { name: 'description', label: 'Description', type: 'text', required: true },
    { name: 'payee', label: 'Payee (our business)', type: 'text' },
    { name: 'vendor', label: 'Paid to / Bought from (landlord, utility, store — optional)', type: 'text' },
    { name: 'amount', label: 'Amount (PHP)', type: 'money', required: true },
    { name: 'paymentMethod', label: 'Payment Method', type: 'select', options: EXPENSE_PAYMENT_METHODS },
    { name: 'referenceNo', label: 'Reference / OR No.', type: 'text' },
    { name: 'notes', label: 'Notes', type: 'textarea' }
  ]
});

window.ExpenseCategories = EXPENSE_CATEGORIES;
