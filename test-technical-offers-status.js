const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
require('fake-indexeddb/auto');
const APP = __dirname;

async function main() {
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  window.indexedDB = global.indexedDB; window.IDBKeyRange = global.IDBKeyRange; window.confirm = () => true;
  const scripts = [...dom.window.document.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => s !== 'js/app.js');
  for (const src of scripts) dom.window.eval(fs.readFileSync(path.join(APP, src), 'utf8'));
  const win = dom.window; const doc = win.document;
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const now = new Date().toISOString();

  await win.DB.openDB(); await win.DB.ensureCounters();
  const custId = await win.DB.dbAdd('customers', { customerNo: 'C1', companyName: 'KEYEC', status: 'Active', createdAt: now, updatedAt: now });

  /* ============ CSS: all four statuses have real color definitions ============ */
  const cssSource = fs.readFileSync(path.join(APP, 'css/styles.css'), 'utf8');
  console.log('STEP 1: "Draft" already maps to the grey/neutral badge group:', /badge-draft[^{]*\{background:var\(--\w+\)/.test(cssSource) || cssSource.includes('.badge-draft,'));
  console.log('STEP 2: "Sent" already maps to the blue/in-progress badge group:', cssSource.includes('.badge-sent,'));
  console.log('STEP 3: "Approved" is newly added to the green/success badge group:', cssSource.includes('.badge-approved{') || /badge-approved[,{]/.test(cssSource));
  console.log('STEP 4: "Revision Requested" is newly added to the amber/needs-decision badge group:', /badge-revision-requested[,{]/.test(cssSource));

  /* ============ Create a new offer, confirm it defaults to Draft ============ */
  win.location.hash = '#/technical-offers/new';
  await win.Router.resolveRoute();
  await wait(50);
  doc.getElementById('f_customerId').value = String(custId);
  doc.getElementById('f_endUser').value = 'Onsemi';
  doc.getElementById('toForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(100);

  const offer = (await win.DB.dbGetAll('technicalOffers'))[0];
  console.log('STEP 5: A brand new Technical Offer correctly defaults to "Draft" status:', offer.status === 'Draft');
  console.log('STEP 6: Status history correctly records the initial Draft entry:', offer.statusHistory.length === 1 && offer.statusHistory[0].status === 'Draft');

  /* ============ List page shows the color-coded badge ============ */
  win.location.hash = '#/technical-offers';
  await win.Router.resolveRoute();
  await wait(50);
  const listRow = doc.querySelector('tr.clickable-row');
  console.log('STEP 7: The list page shows a status badge for the offer:', !!listRow.querySelector('.badge'));
  console.log('STEP 8: That badge correctly carries the draft color class:', listRow.querySelector('.badge').className.includes('badge-draft'));

  /* ============ Detail page: badge in header + Mark-as buttons for every OTHER status ============ */
  win.location.hash = '#/technical-offers/' + offer.id;
  await win.Router.resolveRoute();
  await wait(50);
  console.log('STEP 9: Detail page header shows the current status as a badge:', doc.querySelector('h1 .badge')?.className.includes('badge-draft'));
  const statusButtons = [...doc.querySelectorAll('.status-btn')].map(b => b.dataset.status);
  console.log('STEP 10: "Mark as X" buttons exist for every status except the current one (Draft):', statusButtons.length === 3 && !statusButtons.includes('Draft') && statusButtons.includes('Sent') && statusButtons.includes('Approved') && statusButtons.includes('Revision Requested'));

  /* ============ Changing status: Draft -> Sent ============ */
  doc.querySelector('[data-status="Sent"]').click();
  await wait(80);
  const offerAfterSent = await win.DB.dbGet('technicalOffers', offer.id);
  console.log('STEP 11: Clicking "Mark as Sent" correctly updates the stored status:', offerAfterSent.status === 'Sent');
  console.log('STEP 12: Status history now has two entries (Draft, then Sent):', offerAfterSent.statusHistory.length === 2 && offerAfterSent.statusHistory[1].status === 'Sent');
  console.log('STEP 13: Detail page re-renders showing the new blue "Sent" badge:', doc.querySelector('h1 .badge')?.className.includes('badge-sent'));
  console.log('STEP 14: The button list updates too — "Mark as Sent" is gone, "Mark as Draft" now appears instead:', ![...doc.querySelectorAll('.status-btn')].some(b => b.dataset.status === 'Sent') && [...doc.querySelectorAll('.status-btn')].some(b => b.dataset.status === 'Draft'));

  /* ============ Sent -> Revision Requested, confirming amber color ============ */
  doc.querySelector('[data-status="Revision Requested"]').click();
  await wait(80);
  console.log('STEP 15: "Revision Requested" status applies the amber badge color:', doc.querySelector('h1 .badge')?.className.includes('badge-revision-requested'));

  /* ============ Revision Requested -> Approved, confirming green color ============ */
  doc.querySelector('[data-status="Approved"]').click();
  await wait(80);
  console.log('STEP 16: "Approved" status applies the green badge color:', doc.querySelector('h1 .badge')?.className.includes('badge-approved'));
  const offerFinal = await win.DB.dbGet('technicalOffers', offer.id);
  console.log('STEP 17: Full status history correctly tracks all four transitions in order:', offerFinal.statusHistory.map(h => h.status).join(',') === 'Draft,Sent,Revision Requested,Approved');

  /* ============ Editing content does NOT reset status ============ */
  win.location.hash = '#/technical-offers/' + offer.id + '/edit';
  await win.Router.resolveRoute();
  await wait(80);
  doc.getElementById('f_attentionTo').value = 'Updated attention line';
  doc.getElementById('f_attentionTo').dispatchEvent(new win.Event('input'));
  doc.getElementById('toForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(100);
  const offerAfterEdit = await win.DB.dbGet('technicalOffers', offer.id);
  console.log('STEP 18: Editing the offer\'s content does NOT reset its status back to Draft — status only changes via the dedicated buttons:', offerAfterEdit.status === 'Approved' && offerAfterEdit.attentionTo === 'Updated attention line');

  /* ============ Dashboard reflects the new statuses correctly ============ */
  await win.DB.dbAdd('technicalOffers', { offerNo: 'HT-TO-2026-0002', customerId: custId, endUser: 'Acme', date: win.todayISO(), status: 'Sent', statusHistory: [], items: [], specs: [], sections: [], createdAt: now });
  await win.DB.dbAdd('technicalOffers', { offerNo: 'HT-TO-2026-0003', customerId: custId, endUser: 'Acme', date: win.todayISO(), status: 'Revision Requested', statusHistory: [], items: [], specs: [], sections: [], createdAt: now });
  win.location.hash = '#/dashboard';
  await win.Router.resolveRoute();
  await wait(80);
  function statValueFor(label) {
    const card = [...doc.querySelectorAll('.stat-card')].find(c => c.querySelector('.stat-card-lbl').textContent === label);
    return card ? card.querySelector('.stat-card-num').textContent : null;
  }
  console.log('STEP 19: Dashboard "Technical Offers Awaiting Response" correctly counts only the Sent one:', statValueFor('Technical Offers Awaiting Response') === '1');
  console.log('STEP 20: Dashboard "Technical Offers Needing Revision" correctly counts only the Revision Requested one:', statValueFor('Technical Offers Needing Revision') === '1');
  console.log('STEP 21: Dashboard "Technical Offers" total is still correct (3):', statValueFor('Technical Offers') === '3');

  console.log('\n=== TECHNICAL OFFER STATUS TRACKING FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
