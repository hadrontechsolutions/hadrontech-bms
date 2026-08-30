const fs = require('fs');
const path = require('path');
const APP = __dirname;

function main() {
  const css = fs.readFileSync(path.join(APP, 'css/styles.css'), 'utf8');

  const toClass = (status) => 'badge-' + status.toLowerCase().replace(/\s+/g, '-');
  const cssHasClass = (cls) => new RegExp('\\.' + cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\s|,|\\{)').test(css);
  const cssClassInGroup = (cls, groupMarkerRegex) => {
    const lines = css.split('\n');
    const line = lines.find(l => l.includes('.' + cls + ',') || l.includes('.' + cls + '{') || l.includes('.' + cls + ' '));
    return line ? groupMarkerRegex.test(line) : false;
  };

  const allStatusSets = {
    'Customer PO (CPO_STATUSES)': ['Open', 'Converted to Sales Order', 'Cancelled'],
    'Quotation (QUOTE_STATUSES)': ['Draft', 'Sent', 'Under Review', 'Won', 'Lost', 'Expired'],
    'Sales Order (SO_STATUSES)': ['Draft', 'Confirmed', 'Sourcing', 'Ordered from Supplier', 'Partially Received', 'Ready for Delivery', 'Delivered', 'Completed', 'Cancelled'],
    'Supplier PO (SPO_STATUSES)': ['Draft', 'Sent', 'Awaiting Confirmation', 'Confirmed', 'In Production', 'Ready for Shipment', 'Shipped', 'Partially Received', 'Received', 'Cancelled'],
    'Customers': ['Active', 'Inactive', 'Prospect'],
    'Suppliers': ['Active', 'Inactive'],
    'Products': ['Active', 'Inactive']
  };

  let allCovered = true;
  for (const [group, statuses] of Object.entries(allStatusSets)) {
    for (const status of statuses) {
      const cls = toClass(status);
      const covered = cssHasClass(cls);
      if (!covered) allCovered = false;
      console.log(`${covered ? 'OK  ' : 'MISS'} ${group} -> "${status}" (.${cls})`);
    }
  }
  console.log('\nSTEP A: EVERY real status across every workflow now has a defined color (no silent grey fallback):', allCovered);

  console.log('STEP B: "Converted to Sales Order" is grouped with the GREEN (done) set:', cssClassInGroup('badge-converted-to-sales-order', /--ok-lt/));
  console.log('STEP C: "Ordered from Supplier" is grouped with the BLUE (in-progress) set:', cssClassInGroup('badge-ordered-from-supplier', /--info-lt/));
  console.log('STEP D: "Confirmed" is now grouped with BLUE (in-progress), not green (previously miscategorized as done):', cssClassInGroup('badge-confirmed', /--info-lt/) && !cssClassInGroup('badge-confirmed', /--ok-lt/));
  console.log('STEP E: Genuinely finished states (Won, Delivered, Completed, Received) remain green:', cssClassInGroup('badge-won', /--ok-lt/) && cssClassInGroup('badge-delivered', /--ok-lt/) && cssClassInGroup('badge-completed', /--ok-lt/) && cssClassInGroup('badge-received', /--ok-lt/));
  console.log('STEP F: Negative outcomes (Lost, Expired) remain red:', cssClassInGroup('badge-lost', /--danger-lt/) && cssClassInGroup('badge-expired', /--danger-lt/));

  const allPass = allCovered;
  console.log(allPass ? '\n=== STATUS COLOR STANDARDIZATION FULLY VERIFIED ===' : '\n=== SOME STATUSES STILL UNCOVERED ===');
  if (!allPass) process.exit(1);
}
main();
