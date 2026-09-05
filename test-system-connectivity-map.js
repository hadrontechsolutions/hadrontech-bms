/* ============================================================
   test-system-connectivity-map.js

   Purpose: this test exists specifically because of a recurring bug
   pattern discovered in review — a new feature (a DB field, a store,
   a report) gets built in ONE place, but the cross-cutting places
   that should also know about it (Backup CSV export, the Reports
   registry, sidebar routing) don't get updated to match. Three real
   examples found and fixed: Technical Offers' CSV export missing its
   Status column after status tracking was added, Supplier PO's CSV
   export missing payment fields after payment tracking was added,
   and Enquiries having CSV column definitions but no export button
   in the UI at all.

   This test parses the actual source files (not runtime behavior) and
   cross-checks these integration points against each other, so any
   future drift between them fails loudly here instead of silently
   sitting unnoticed for months. Run this after adding any new field,
   store, or report.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const APP = __dirname;
const read = (f) => fs.readFileSync(path.join(APP, f), 'utf8');

function main() {
  const backupJs = read('js/backup.js');
  const reportsJs = read('js/reports.js');
  const indexHtml = read('index.html');
  const allJs = fs.readdirSync(path.join(APP, 'js')).filter(f => f.endsWith('.js')).map(f => read('js/' + f)).join('\n');
  const failures = [];
  const check = (label, passed) => { console.log(label + ':', passed === true ? 'true' : passed); if (passed !== true) failures.push(label); };

  /* ---------- 1. BACKUP_STORES vs CSV_COLUMNS ---------- */
  const backupStoresMatch = backupJs.match(/const BACKUP_STORES = \[([^\]]+)\]/);
  const backupStores = [...backupStoresMatch[1].matchAll(/'([a-zA-Z]+)'/g)].map(m => m[1]);
  // counters/settings/activity are internal system data, not meant for a CSV download -- everything else should have one.
  const storesNeedingCSV = backupStores.filter(s => !['counters', 'settings', 'activity'].includes(s));

  const csvColumnsBlockMatch = backupJs.match(/const CSV_COLUMNS = \{([\s\S]+?)\n\};/);
  const csvColumnKeys = [...csvColumnsBlockMatch[1].matchAll(/^\s*([a-zA-Z]+):\s*\[/gm)].map(m => m[1]);

  check('STEP 1: Every backed-up store (except internal system data) has a CSV_COLUMNS definition',
    storesNeedingCSV.every(s => csvColumnKeys.includes(s)) || `MISSING: ${storesNeedingCSV.filter(s => !csvColumnKeys.includes(s)).join(', ')}`);

  /* ---------- 2. CSV_COLUMNS vs actual export buttons in the UI ---------- */
  const csvButtons = [...backupJs.matchAll(/data-csv="([a-zA-Z]+)"/g)].map(m => m[1]);
  check('STEP 2: Every store with CSV column definitions also has an actual export button in the UI (this exact gap existed for Enquiries before this check was written)',
    csvColumnKeys.every(k => csvButtons.includes(k)) || `MISSING BUTTON FOR: ${csvColumnKeys.filter(k => !csvButtons.includes(k)).join(', ')}`);
  check('STEP 3: No export button references a store that was never actually defined in CSV_COLUMNS (a button that would silently fail)',
    csvButtons.every(b => csvColumnKeys.includes(b)) || `ORPHANED BUTTON(S): ${csvButtons.filter(b => !csvColumnKeys.includes(b)).join(', ')}`);

  /* ---------- 3. REPORT_GROUPS keys vs buildReport() switch cases ---------- */
  const reportGroupKeys = [...reportsJs.matchAll(/key:\s*'([a-zA-Z]+)'/g)].map(m => m[1]);
  const buildReportCases = [...reportsJs.matchAll(/\n\s*case '([a-zA-Z]+)':/g)].map(m => m[1]);
  check('STEP 4: Every report listed in the nav has a matching case in buildReport() (no dead link that shows "no data" forever)',
    reportGroupKeys.every(k => buildReportCases.includes(k)) || `NO BUILD CASE FOR: ${reportGroupKeys.filter(k => !buildReportCases.includes(k)).join(', ')}`);
  check('STEP 5: No orphaned buildReport case exists that nothing in the nav actually links to (dead code)',
    buildReportCases.every(c => reportGroupKeys.includes(c)) || `ORPHANED CASE(S): ${buildReportCases.filter(c => !reportGroupKeys.includes(c)).join(', ')}`);
  check('STEP 6: No report key is accidentally listed twice in the nav',
    new Set(reportGroupKeys).size === reportGroupKeys.length || 'DUPLICATE KEY(S) FOUND');

  /* ---------- 4. Sidebar nav-link sections vs actually registered routes ---------- */
  const navSections = [...indexHtml.matchAll(/data-section="([^"]+)"/g)].map(m => m[1]);
  const literalRoutes = [...allJs.matchAll(/Router\.route\('([^']+)'/g)].map(m => m[1]);
  // Customers/Suppliers/Products don't call Router.route(...) directly with a literal string --
  // they go through a shared generic entity engine (Entities.defineEntity({ key: '...' })) that
  // registers /key, /key/new, /key/:id, /key/:id/edit via template literals. A plain regex for
  // Router.route('...') alone would miss these entirely and report a false gap, so they're
  // expanded out explicitly here to match what the engine actually registers at runtime.
  const entityKeys = [...allJs.matchAll(/Entities\.defineEntity\(\{\s*\n?\s*key:\s*'([a-zA-Z]+)'/g)].map(m => m[1]);
  const entityRoutes = entityKeys.flatMap(k => [`/${k}`, `/${k}/new`, `/${k}/:id`, `/${k}/:id/edit`]);
  const registeredRoutes = [...literalRoutes, ...entityRoutes];
  // A nav-link's section is a base path like "/quotations" -- it's "connected" if some registered
  // route starts with it (covers both the exact list route and its own detail/edit sub-routes).
  const unresolved = [];
  navSections.forEach(sectionAttr => sectionAttr.split(' ').forEach(section => {
    if (!registeredRoutes.some(r => r === section || r.startsWith(section + '/'))) unresolved.push(section);
  }));
  check('STEP 7: Every sidebar nav-link points at a section that has at least one real, registered route (no dead nav item)',
    unresolved.length === 0 || `UNRESOLVED: ${unresolved.join(', ')}`);

  /* ---------- 5. Every DB store defined in db.js is at least present in BACKUP_STORES ---------- */
  const dbJs = read('js/db.js');
  const dbStores = [...dbJs.matchAll(/mk\('([a-zA-Z]+)'/g)].map(m => m[1]);
  check('STEP 8: Every data store defined in the database schema is included in the backup (nothing silently excluded from Backup & Restore)',
    dbStores.every(s => backupStores.includes(s)) || `MISSING FROM BACKUP: ${dbStores.filter(s => !backupStores.includes(s)).join(', ')}`);

  if (failures.length > 0) {
    throw new Error(`${failures.length} connectivity check(s) failed:\n  - ${failures.join('\n  - ')}`);
  }
  console.log('\n=== SYSTEM CONNECTIVITY MAP — STRUCTURAL CONSISTENCY VERIFIED ===');
}
try {
  main();
} catch (err) {
  console.error('TEST FAILED:', err.message);
  process.exit(1);
}
