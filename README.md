# Hadrontech Business Management System — Version 1

An offline, browser-based business management app for Hadrontech Industrial Solutions:
Customers → Quotations → Customer POs → Sales Orders → Supplier POs, with dashboard,
reports, global search, and JSON backup/restore. No installation, no internet connection,
and no server required.

---

## 1. How to open it

1. Unzip this folder anywhere on your Windows computer (e.g. `Documents\Hadrontech-BMS`).
2. Double-click **`index.html`**. It opens in your default browser.
3. **Use Google Chrome or Microsoft Edge.** The app uses IndexedDB, which both support
   fully. Avoid opening it in a "private/incognito" window — some browsers restrict
   local storage there and the app won't be able to save anything.
4. Keep the whole folder together — `index.html` needs the `css/` and `js/` folders next
   to it to work. You can create a desktop shortcut to `index.html` for quick access.
5. The first time you open it, sample data is loaded automatically (2 customers, 2
   suppliers, 3 products, 1 sample quotation) so the app isn't empty. Every sample
   record is clearly marked "Sample record — safe to delete" in its Notes field, and
   can be deleted normally from its detail page.

No Node.js, no build step, and no local server is required for daily use.

---

## 2. How the data flows

```
Customer → Quotation (with revisions) → Customer PO → Sales Order → Supplier PO(s) → Completed
```

- A **Quotation** always belongs to a Customer. Revising a quotation creates a new,
  separate record (Rev 2, Rev 3, ...) — the old revision is kept, untouched, in the
  "Revision History" panel.
- Marking a Quotation **Won** reveals a **"Record Customer PO"** button.
- A recorded **Customer PO** shows a **"Convert to Sales Order"** button, which copies
  the quotation's line items and pricing into a new Sales Order (no re-typing).
- A **Sales Order** groups its line items by the supplier assigned to each item (set
  when the item was picked from the product catalog, or edited manually on the
  quotation). Each supplier group gets its own **"Create Supplier PO"** button — so one
  Sales Order can produce several Supplier POs, one per supplier.
- Every record detail page shows clickable links to everything it's connected to
  (customer ↔ quotation ↔ customer PO ↔ sales order ↔ supplier PO), so you can always
  navigate the full chain in either direction.
- A new quotation always starts at **Revision 00** (nothing has been revised yet).
  Using "New Revision" bumps it to 01, 02, and so on — each old revision is kept as
  read-only history, never overwritten.
- **Company Settings** lets you upload a company logo and an **authorized signature
  image** (a transparent PNG works best). Once uploaded, the signature appears
  automatically above the signature line on every printed Quotation, Sales Order, and
  Supplier PO — no need to sign printouts by hand.

---

## 3. Enquiries — dormant feature (not currently active)

**This module is not currently visible or usable in the app.** It was built, then removed
from the sidebar and active navigation by request — but the code (`js/enquiries.js`) and
its underlying data were deliberately left in place rather than deleted, so it can be
restored later without losing anything. `js/enquiries.js` is **not** included in
`index.html`'s script list right now, so none of the code below actually runs.

What it did, for reference (all of this would work again if re-enabled):

- **Board view**: a Kanban board, one column per stage (New Enquiry → Quotation
  Sent → Won - Processing → In Delivery → Delivered → Payment Complete, plus Lost /
  Cancelled). Drag a card to a different column to move its stage.
- **Table view**: the same enquiries as a sortable list.
- **Three progress tracks per enquiry**: Quotation Status (read live from the linked
  Quotation), Delivery Status (a 7-step tracker with a dated milestone log), and Payment
  Status (a running ledger with an automatic Overdue flag).
- **Auto-linking** to the Customer PO / Sales Order chain as an order progresses.

**To re-enable it:** add `<script src="js/enquiries.js"></script>` back into
`index.html` (after `entities.js`, before `quotations.js`), and restore its entry in the
sidebar navigation. No data migration needed — the `enquiries` store was never removed.

---

## 4. Backup & Restore

**This is a fully offline app — all data lives only in this browser, on this computer.**
There is no cloud copy unless you make one yourself.

Go to **Settings → Backup & Restore**:

- **Export Full Backup (.json)** — downloads everything (all records + settings +
  document number counters) into one dated file, e.g. `hadrontech-backup-2026-08-05.json`.
  Save this file somewhere safe: Google Drive, OneDrive, a USB stick, or email it to
  yourself. Do this regularly — weekly at minimum, or after any heavy data-entry session.
- **Restore from Backup** — pick a previously exported `.json` file. The app shows you
  exactly what it's about to load and asks for confirmation before it **replaces all
  current data**. This is destructive by design (it's a full restore, not a merge), so
  only use it when you're sure.
- **CSV Export** — per-table exports (Customers.csv, Quotations.csv, etc.) you can open
  directly in Excel for quick reporting or sharing, separate from the full backup.

**Recommendation:** since everything lives in one browser on one computer, if that
computer is lost, reformatted, or the browser's storage is cleared, your data goes with
it unless you have a recent backup file saved elsewhere. Treat exporting backups as a
routine task, the same way you'd back up an Excel file.

### Built-in backup reminder

You don't have to remember this on your own — the app tracks the date of your last
export and reminds you automatically:

- A banner appears at the top of **every page** once too much time has passed since your
  last backup (7 days by default — change this on the Backup & Restore page under
  "Remind me if no backup in (days)"). It has a one-click **Back Up Now** button and
  clears itself the moment you export.
- If a backup is left *very* overdue (double your reminder setting — 14+ days by
  default), closing the browser tab will also trigger the browser's own "leave this
  page?" confirmation, as a last-resort nudge. This only kicks in when it's been
  neglected a while — it won't nag you during normal day-to-day use.
- The Backup & Restore page always shows plainly how long it's been since your last
  export ("Today", "3 days ago", "Never backed up yet").

---

## 5. Project structure

```
index.html              Main app shell (sidebar, header, content area)
css/styles.css           All styling
js/db.js                 IndexedDB layer — schema, generic CRUD, document numbering
js/utils.js               Formatting, toasts, unsaved-changes guard, CSV/download helpers, searchable Item Picker
js/router.js              Hash-based navigation (#/customers/12, etc.)
js/entities.js             Generic list/form/detail engine (used by Customers/Suppliers/Products)
js/customers.js            Customer fields + related-records panel
js/suppliers.js            Supplier fields + related-records panel
js/products.js             Product/Service fields, On Hand/Committed/Available stock tracking
js/quotations.js           Quotation module: line items, calculations, revisions, status workflow
js/customerPOs.js          Customer PO module
js/salesOrders.js          Sales Order module + "create Supplier PO" grouping logic
js/supplierPOs.js          Supplier PO module
js/proformaInvoices.js     Proforma Invoice generation (from a Sales Order)
js/enquiries.js            Enquiry tracker — NOT currently loaded/active, see Section 3
js/print.js                A4 printable documents (Quotation, Sales Order, Supplier PO, Proforma Invoice)
js/dashboard.js            Summary cards, quick actions, activity feed, mini charts
js/reports.js              10 filterable reports + CSV export
js/search.js               Global search across all record types
js/settings.js             Company profile, defaults, document numbering prefixes/counters
js/backup.js               Full JSON backup/restore, per-table CSV export
js/backupReminder.js       Automatic "please back up" banner + close-tab nag
js/seed.js                 First-run sample data (deletable)
js/app.js                  Boots the app (opens DB, seeds, wires header search, starts router)
```

Every record gets a permanent auto-increment ID from IndexedDB. Records link to each
other by ID (e.g. a Sales Order stores `customerId`, `quotationId`, `customerPOId`), and
a **snapshot** of key details (customer name, address, prices) is captured at the moment
a quotation/order is created — so if you later edit a customer's address, old printed
quotations still show what was true when they were issued.

Money fields are rounded to the nearest centavo (`Math.round(x*100)/100`) at each
calculation step, which is a lightweight, practical way to avoid the worst of
floating-point drift on totals without a full integer-cents rewrite. See Limitations
below.

---

## 6. Test checklist — confirmed working

Two automated end-to-end scripts (included for reference — not needed for normal use)
drove the app through the full sequences below with **zero errors**:

**`test-routes.js`** — confirms every active page in the app renders without a
JavaScript error: Dashboard, Customers, Suppliers, Products, Quotations, Customer POs,
Sales Orders, Supplier POs, Proforma Invoices, Reports, Search, Settings, Backup &
Restore. (Enquiries is excluded — see Section 3, it's not currently loaded.)

**The full test suite is 40 files** covering the system end-to-end — the full
Quotation → Customer PO → Sales Order → Supplier PO → Proforma Invoice chain, multi-
option quotations, inventory/stock tracking, VAT handling, currency conversion, backup/
restore, and the deletion-protection and status-validation safeguards described
elsewhere in this README. Every file is independently runnable and named for what it
covers (e.g. `test-inventory-tracking.js`, `test-cpo-line-items.js`). There's no single
master checklist kept in sync by hand — the tests themselves are the source of truth,
and all 40 pass together as a regression check before anything ships.

To re-run them yourself (optional, requires Node.js — not needed to use the app):
```
npm install jsdom fake-indexeddb
node test-routes.js
# or run all of them:
for f in test-*.js; do node "$f"; done
```

---

## 7. Limitations of this offline V1

Being upfront about what's simplified, so nothing surprises you later:

- **Single computer, single user.** Data lives in one browser's IndexedDB. It is not
  shared across devices or people. Two people cannot edit the same record at the same
  time. (The data model — IDs, snapshots, linked references — is deliberately built so
  that adding multi-user/cloud sync later is a backend change, not a redesign.)
- **No file attachments.** Customer PO scans, supplier quotations, etc. aren't stored in
  the app. IndexedDB *can* technically store files, but reliably including them inside
  a single portable JSON backup (without bloating it or hitting browser storage limits)
  is a meaningfully bigger feature. Practical workaround for now: keep PO/attachment
  files in a normal folder (e.g. `Documents\Hadrontech-BMS\Attachments\CPO-2026-0001\`)
  named after the record number, and reference the file name in the record's Notes field.
- **VAT/discount calculation is simplified.** Each line computes its own discount and
  VAT; the "overall discount %" is applied to the subtotal only (it does not recompute
  VAT on the discounted amount). This is accurate for the common case but is not a full
  tax engine — always sanity-check unusual discount/VAT combinations before sending a
  quotation to a customer.
- **Supplier PO line items ARE independently editable after creation** — via "Edit /
  Revise PO," you can adjust quantities, unit cost, and UOM, or add/remove lines
  entirely (e.g. if the supplier's actual quote differs from what was first assumed).
  Description text is locked once a line exists, by design — see the note on
  traceability below.
- **No login/authentication.** Anyone with access to this computer/browser profile can
  open and edit the data. The "Your Name" field in Settings is used only for the
  created-by/modified-by audit trail, not as a security boundary.
- **Money is rounded to centavos at each calculation step** rather than using a true
  fixed-point/integer-cents engine internally. For typical trading-company invoice
  sizes this is accurate to the centavo; extremely high line counts with compounding
  rounding are the theoretical edge case where a stricter engine would matter more.
- **Reports are computed live from current data**, not pre-aggregated — with very large
  data volumes (thousands of records) report screens may take a moment to load, though
  this hasn't been an issue at normal trading-company data volumes.

---

## 8. Recommendations for a future networked/cloud version

When Hadrontech outgrows a single-computer tool (more than one person needs to enter
quotations, or you want access from outside the office), the natural next step is:

- Move the same data model (this app's IndexedDB schema translates directly) into a
  real backend — e.g. a small Node.js/Express or Python/FastAPI API backed by
  PostgreSQL — with the browser app becoming the frontend talking to that API instead
  of IndexedDB directly.
- Add real user accounts and permissions (e.g. sales staff can create quotations but
  only a manager can mark Won/Lost or edit Settings).
- Add file attachment storage (S3-compatible object storage or similar) once there's a
  server to store them on.
- Keep the JSON export/import format as a compatible "escape hatch" for migrating
  existing offline data into the new system.

This isn't needed to use Version 1 today — it's here so the next step is planned for,
not a surprise rebuild.
