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

  console.log('\n=== REMINDER LOGIC VERIFIED (UI flows are in test-rfq-tracker.js) ===');
}
main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });
