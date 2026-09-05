# Hadrontech BMS — System Map

This document exists to answer one question quickly: **"if I add or change something here, what else needs to know about it?"** It was written after finding the same class of bug three times in one review — a feature gets built in one place (a new field, a new store, a new report) but the surrounding systems that should also reflect it (CSV export, Dashboard, Reports) quietly don't get updated.

There are two things here:
1. **The map** — every data store, which file owns it, and its current integration status.
2. **A companion automated test** — `test-system-connectivity-map.js` — that checks several of these connections *structurally*, by reading the actual source files. Run it after adding any new store, field, or report. It exits with a non-zero code and a clear message if something's disconnected — it does not rely on this document being kept up to date to catch a mistake.

This document should still be kept current by hand, since it explains *why* things are the way they are, which the automated test can't.

---

## Data stores and their integrations

| Store | Owning file(s) | Backup | CSV Export | Search | Dashboard | Reports |
|---|---|---|---|---|---|---|
| `customers` | customers.js (generic entity engine) | ✅ | ✅ | ✅ | ✅ (Active Customers) | via Quotation/SO reports |
| `suppliers` | suppliers.js (generic entity engine) | ✅ | ✅ | ✅ | ✅ (Active Suppliers) | via Supplier PO reports |
| `products` | products.js (generic entity engine) | ✅ | ✅ | ✅ | — | — |
| `quotations` | quotations.js | ✅ | ✅ | ✅ | ✅ | Quotation Register, Open, Won & Lost, Expiring/Expired, Gross Profit |
| `customerPOs` | customerPOs.js | ✅ | ✅ | ✅ | ✅ (POs Received) | — |
| `salesOrders` | salesOrders.js | ✅ | ✅ | ✅ | ✅ | SO Register, Awaiting Delivery, Sales by Customer/Month, Sales Register (Bookkeeper) |
| `supplierPOs` | supplierPOs.js | ✅ | ✅ (incl. payment fields) | ✅ | ✅ (incl. payment stats) | PO Register, Purchase Register (Bookkeeper), **Supplier Payments Aging** |
| `enquiries` | enquiries.js | ✅ | ✅ | ⚠️ not searched | — | — |
| `stockMovements` | products.js (stock logic) | ✅ | ✅ | ⚠️ not searched | — | — |
| `proformaInvoices` | proformaInvoices.js | ✅ | ✅ (incl. payment fields) | ✅ | ✅ (Payments) | **Payments Aging** |
| `technicalOffers` | technicalOffers.js | ✅ | ✅ (incl. status) | ✅ | ✅ (incl. status breakdown) | **Technical Offers Log** |
| `counters` | db.js | ✅ | — (internal) | — | — | — |
| `settings` | settings.js | ✅ | — (internal) | — | — | — |
| `activity` | db.js | ✅ | — (internal) | — | — | — |

**Legend:** ✅ = connected and verified · ⚠️ = a known gap, not yet decided whether it's needed · — = not applicable for this store

### Known gaps (flagged, not fixed — worth a decision, not urgent)
- **Search doesn't cover `enquiries` or `stockMovements`.** Enquiries are short-lived lead records; stock movements are high-volume audit-style entries. It's plausible neither needs to be individually searchable, but this hasn't been explicitly decided — just noting it so it's a deliberate choice rather than an oversight.

### Deliberate non-connections (confirmed correct, not gaps)
- The **printed Supplier PO document** doesn't show payment status. A PO sent to a supplier is a commitment/order document, not a payment record — the supplier doesn't need to see what we've paid them printed on their own copy of the order.
- `counters`, `settings`, and `activity` don't get CSV exports, search entries, or Dashboard tiles — they're internal system bookkeeping, not business records a person would look up.

---

## Where things live, at a glance

- **Backup & Restore**: `js/backup.js` — `BACKUP_STORES` (what gets included in a full backup) and `CSV_COLUMNS` (what each individual CSV export contains) are two separate lists that must be kept in sync manually. A store can be backed up but have no CSV export column definition (rare, only makes sense for internal stores) — but every CSV column definition should have a matching export button in the Backup & Restore page's UI.
- **Search**: `js/search.js` — a single function that fetches from several stores and searches across them together. Adding a new searchable store means adding it to the `Promise.all` fetch list and adding a results section for it.
- **Dashboard**: `js/dashboard.js` — stat tiles are hand-picked, not automatic. Adding a new store doesn't put it on the Dashboard by itself; someone has to decide it's worth a tile and add one.
- **Reports**: `js/reports.js` — `REPORT_GROUPS` (what shows in the nav, organized by category) and the `buildReport()` switch statement (what each report actually computes) are two separate things that must both be updated together — a report key in one without a matching case in the other either shows nothing or is unreachable dead code.
- **Routing**: most modules call `Router.route('/path', handler)` directly. Customers, Suppliers, and Products are the exception — they go through a shared generic CRUD engine (`Entities.defineEntity({ key: '...' })` in `entities.js`), which registers their `/key`, `/key/new`, `/key/:id`, `/key/:id/edit` routes automatically from that one config object. This matters if you're ever grepping for `Router.route` to check what's registered — these three won't show up that way.

---

## Currency-handling convention (worth remembering)

Two different, deliberately different rules exist side by side:
- **Customer-facing money** (Proforma Invoices, Sales by Customer/Month) is assumed to always be PHP, since this business sells to Philippine customers. Reports show one clean PHP total, and if a non-PHP record ever shows up, it's flagged as a standalone anomaly worth double-checking — not silently included or averaged in.
- **Supplier-facing money** (Supplier PO payments) genuinely spans currencies — local suppliers bill in PHP, overseas manufacturers (e.g. Pentair) bill in USD. These reports and Dashboard tiles break totals down **by currency**, never combining them into one blind sum.

If you're ever adding up money across multiple records, ask first: is this customer-side (assume PHP, flag exceptions) or supplier-side (break down by currency, never combine)? Mixing these two conventions up is exactly the class of bug this system has hit before.

---

## Checklist for adding something new

When adding a new store, or a meaningful new field (especially a status or a financial figure) to an existing one:

1. **New store?** Add it to `BACKUP_STORES` and give it a `CSV_COLUMNS` entry + export button, unless it's purely internal system data.
2. **New status field?** Give it a color-coded badge (reuse an existing color group in `styles.css` if the semantics match — Draft/grey, in-progress/blue, needs-a-decision/amber, done/green — before inventing a new color). Check whether it should show up in any Reports table with `badge: true`.
3. **New financial figure?** Decide: customer-side (PHP-assumed) or supplier-side (multi-currency) — see above. Check whether an existing CSV export or Dashboard tile now needs updating to include it, the same way Proforma Invoices' and Supplier POs' CSV exports needed updating after payment tracking was added to each.
4. **New report?** Add it to both `REPORT_GROUPS` (which category it belongs under) and a matching `case` in `buildReport()`.
5. **Run `node test-system-connectivity-map.js`** before considering the work done. It won't catch everything (it checks structure, not business logic), but it catches exactly the class of mistake that prompted this whole document.
