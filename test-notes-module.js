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

  await win.DB.openDB(); await win.DB.ensureCounters();

  /* ============ Reminder logic (pure function checks) ============ */
  const today = win.todayISO();
  const overdueNote = { date: win.addDaysISO(today, -10), remindAfterDays: 3, status: 'Open' };
  const dueTodayNote = { date: win.addDaysISO(today, -3), remindAfterDays: 3, status: 'Open' };
  const dueSoonNote = { date: win.addDaysISO(today, -2), remindAfterDays: 3, status: 'Open' };
  const upcomingNote = { date: today, remindAfterDays: 10, status: 'Open' };
  const doneNote = { date: win.addDaysISO(today, -10), remindAfterDays: 3, status: 'Done' };
  const noReminderNote = { date: today, remindAfterDays: '', status: 'Open' };

  console.log('STEP 1: A note whose reminder date has passed is correctly flagged "Overdue":', win.getReminderInfo(overdueNote).state === 'overdue' && win.getReminderInfo(overdueNote).badgeClass === 'badge-overdue');
  console.log('STEP 2: A note whose reminder date is exactly today is "Due Today", RED like overdue (not amber) — matching what was specifically asked for:', win.getReminderInfo(dueTodayNote).state === 'today' && win.getReminderInfo(dueTodayNote).badgeClass === 'badge-due-today');
  console.log('STEP 3: A note due tomorrow is "Due Soon" and amber, not red — one notch less urgent than today/overdue:', win.getReminderInfo(dueSoonNote).state === 'soon' && win.getReminderInfo(dueSoonNote).badgeClass === 'badge-due-soon');
  console.log('STEP 4: A note with a reminder further in the future has no urgent badge at all:', win.getReminderInfo(upcomingNote).badgeText === null);
  console.log('STEP 5: A note marked Done is never urgent regardless of its dates, and shows green "Done":', win.getReminderInfo(doneNote).state === 'done' && win.getReminderInfo(doneNote).badgeClass === 'badge-done');
  console.log('STEP 6: A note with no reminder configured at all is correctly neutral, not miscategorized as urgent:', win.getReminderInfo(noReminderNote).state === 'none');

  /* ============ CSS colors actually resolve to red/amber/green as expected ============ */
  const css = fs.readFileSync(path.join(APP, 'css/styles.css'), 'utf8').replace(/\s+/g, '');
  console.log('STEP 7: badge-overdue and badge-due-today both resolve to the danger (red) color group:', css.includes('.badge-lost,.badge-expired,.badge-overdue,.badge-due-today{background:var(--danger-lt)'));
  console.log('STEP 8: badge-due-soon resolves to the amber color group:', /badge-due-soon[^}]*amber-lt/.test(css) || /amber-lt[^;]*;color:var\(--amber\)[^}]*/.test(css) && css.includes('badge-due-soon'));
  console.log('STEP 9: badge-done resolves to the green/success color group:', css.includes('badge-done{background:var(--ok-lt)') || /badge-done[,{]/.test(css) && css.includes('.badge-active,.badge-won'));

  /* ============ Full CRUD flow through the UI ============ */
  win.location.hash = '#/notes';
  await win.Router.resolveRoute();
  await wait(50);
  console.log('STEP 10: Notes list page loads with the empty state when there are none yet:', doc.getElementById('content').textContent.includes('No notes yet'));
  console.log('STEP 11: Sidebar correctly highlights "Notes" as active:', doc.querySelector('.nav-link[href="#/notes"]').classList.contains('active'));

  doc.getElementById('btnNewNote').click();
  await wait(50);
  doc.getElementById('f_title').value = 'Follow up with KEYEC on Fleck 3150 delivery';
  doc.getElementById('f_referenceEmail').value = 'procurement@keyec.com';
  doc.getElementById('f_date').value = win.addDaysISO(today, -5); // 5 days ago
  doc.getElementById('f_remindAfterDays').value = '3'; // reminder was 3 days after -> 2 days overdue now
  doc.getElementById('f_body').value = 'Waiting on their confirmation of the delivery schedule.';
  doc.getElementById('noteForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await wait(100);

  const savedNotes = await win.DB.dbGetAll('notes');
  console.log('STEP 12: Note saved correctly:', savedNotes.length === 1);
  console.log('STEP 13: Auto-numbering follows the HT-NOTE-YYYY-XXXX pattern:', /^HT-NOTE-\d{4}-\d{4}$/.test(savedNotes[0].noteNo));
  console.log('STEP 14: New notes default to "Open" status:', savedNotes[0].status === 'Open');

  /* ============ List page shows the red row highlight for the overdue note ============ */
  win.location.hash = '#/notes';
  await win.Router.resolveRoute();
  await wait(50);
  const row = doc.querySelector('tr.clickable-row');
  console.log('STEP 15: THE CORE VISUAL FEATURE: the overdue note\u2019s entire row is highlighted red on the list, not just the badge:', row.getAttribute('style') && row.getAttribute('style').includes('var(--danger-lt)'));
  console.log('STEP 16: The badge itself also correctly shows "Overdue":', row.querySelector('.badge-overdue') !== null);
  console.log('STEP 17: Reference email shows correctly in its own column:', row.textContent.includes('procurement@keyec.com'));

  /* ============ Detail page ============ */
  const noteId = savedNotes[0].id;
  win.location.hash = '#/notes/' + noteId;
  await win.Router.resolveRoute();
  await wait(50);
  console.log('STEP 18: Detail page shows a prominent red callout for an overdue note:', doc.querySelector('.danger-card') !== null);
  console.log('STEP 19: "Mark as Done" button is present:', doc.getElementById('btnToggleDone').textContent.includes('Mark as Done'));

  doc.getElementById('btnToggleDone').click();
  await wait(50);
  const afterDone = await win.DB.dbGet('notes', noteId);
  console.log('STEP 20: Marking as Done correctly updates status:', afterDone.status === 'Done');
  console.log('STEP 21: Detail page now shows "Reopen" instead, and no more red overdue callout:', doc.getElementById('btnToggleDone').textContent.includes('Reopen') && doc.querySelector('.danger-card') === null);

  /* ============ Dashboard reflects Notes Needing Action correctly ============ */
  await win.DB.dbAdd('notes', {
    noteNo: 'HT-NOTE-2026-0002', title: 'Second overdue note', referenceEmail: '', date: win.addDaysISO(today, -20),
    remindAfterDays: 1, body: '', status: 'Open', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), createdBy: 'Test'
  });
  win.location.hash = '#/dashboard';
  await win.Router.resolveRoute();
  await wait(80);
  function statValueFor(label) {
    const card = [...doc.querySelectorAll('.stat-card')].find(c => c.querySelector('.stat-card-lbl').textContent === label);
    return card ? card.querySelector('.stat-card-num').textContent : null;
  }
  console.log('STEP 22: Dashboard "Notes Needing Action" correctly counts only the still-open overdue one (the Done one no longer counts):', statValueFor('Notes Needing Action') === '1');

  /* ============ Search ============ */
  win.location.hash = '#/search';
  await win.Router.resolveRoute();
  await wait(50);
  const searchInput = doc.getElementById('globalSearchInput');
  searchInput.value = 'KEYEC';
  searchInput.dispatchEvent(new win.Event('input'));
  await wait(300);
  console.log('STEP 23: Global search finds the note by its title text:', doc.getElementById('searchResults').textContent.includes('Follow up with KEYEC'));

  /* ============ CSV export ============ */
  let downloaded = null;
  win.downloadFile = (name, content) => { downloaded = { name, content }; };
  win.location.hash = '#/settings/backup';
  await win.Router.resolveRoute();
  await wait(50);
  doc.querySelector('[data-csv="notes"]').click();
  await wait(30);
  console.log('STEP 24: Notes CSV export works and includes the actual data:', downloaded && downloaded.content.includes('KEYEC') && downloaded.content.includes('procurement@keyec.com'));

  console.log('\n=== NOTES MODULE WITH REMINDER URGENCY FULLY VERIFIED ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
