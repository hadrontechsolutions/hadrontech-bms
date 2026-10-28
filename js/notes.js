/* ============================================================
   notes.js — RFQ Tracker (replaces the old Notes tab).

   One record per customer RFQ / inquiry, kept in the existing 'notes' store (so backup, CSV export, search and the
   dashboard keep working and every old note is still there — an old note is simply a "General note" with no kind set).

   An RFQ record holds:
     • who/what: customer, the customer's RFQ / Inquiry Reference (their email subject — shown prominently everywhere),
       end-user (optional), date received, status
     • the emails we sent (free text: email, status, date, days since)
     • an activity log (emails sent/received, calls, notes) — every entry says WHO HAS THE BALL afterwards:
       Us · Supplier · Customer · End-User
     • a follow-up reminder (counted from the last activity)
     • a link to the quotation made from it ("Convert to Quotation")

   The list shows a bottleneck strip (how many RFQs wait on whom, and for how long) and has a Customer view that hides
   everything internal (suppliers, notes) so it can be shown or printed for the customer.
   ============================================================ */

const RFQ_STATUSES = ['New', 'Sourcing', 'Preparing Offer', 'Quoted', 'On Hold', 'Closed'];
const RFQ_STATUS_TEXT = {
  'New': 'New — needs sourcing', 'Sourcing': 'Sourcing — waiting for suppliers', 'Preparing Offer': 'Preparing our offer',
  'Quoted': 'Quotation sent', 'On Hold': 'On hold', 'Closed': 'Closed'
};
const BALL_PARTIES = ['Us', 'Supplier', 'Customer', 'End-User'];
const ACTIVITY_TYPES = ['Email sent', 'Email received', 'Phone / chat', 'Note'];
const BALL_EXPLAIN = { 'Us': 'we need to act', 'Supplier': 'waiting for a supplier', 'Customer': 'waiting for the customer', 'End-User': 'waiting for the end-user' };

/** Whole days from a saved date to today ("today", "1 day", "12 days"). */
function daysSinceText(iso) {
  if (!iso) return '—';
  const d = daysBetweenISO(String(iso).slice(0, 10), todayISO());
  return d <= 0 ? 'today' : d === 1 ? '1 day' : `${d} days`;
}

Router.route('/rfq-tracker', () => renderRfqList());
Router.route('/rfq-tracker/new', () => renderRfqForm(null));
Router.route('/rfq-tracker/new-note', () => renderGeneralNoteForm(null));
Router.route('/rfq-tracker/:id', (p) => renderRfqDetail(p.id));
Router.route('/rfq-tracker/:id/edit', async (p) => {
  const rec = await DB.dbGet('notes', Number(p.id));
  if (rec && rec.kind === 'RFQ') renderRfqForm(rec); else renderGeneralNoteForm(rec);
});
// The old Notes addresses keep working (bookmarks, search results, dashboard links).
Router.route('/notes', () => Router.navigate('/rfq-tracker'));
Router.route('/notes/new', () => Router.navigate('/rfq-tracker/new-note'));
Router.route('/notes/:id', (p) => Router.navigate(`/rfq-tracker/${p.id}`));
Router.route('/notes/:id/edit', (p) => Router.navigate(`/rfq-tracker/${p.id}/edit`));

const isRfq = (n) => n && n.kind === 'RFQ';
const isClosedNote = (n) => n.status === 'Done' || n.status === 'Closed';

/* Closed RFQs are kept for RFQ_KEEP_CLOSED_DAYS (still visible, can be reopened), then moved to the Trash,
   where they can be restored for RFQ_TRASH_DAYS before being deleted for good. Dates are saved on the record. */
var RFQ_KEEP_CLOSED_DAYS = 5, RFQ_TRASH_DAYS = 30;
const isTrashed = (n) => !!(n && n.trashedAt);
const closedOn = (n) => n.closedAt || null;
const trashDate = (n) => addDaysISO(n.closedAt, RFQ_KEEP_CLOSED_DAYS);          // date it moves to the Trash
const purgeDate = (n) => addDaysISO(n.trashedAt, RFQ_TRASH_DAYS);               // date it is deleted for good
const daysUntil = (iso) => daysBetweenISO(todayISO(), iso);
const plural = (n, w) => `${n} ${w}${Math.abs(n) === 1 ? '' : 's'}`;
function closedNotice(n) {
  if (isTrashed(n)) { const d = daysUntil(purgeDate(n)); return `In the Trash since ${formatDate(n.trashedAt)}. Deleted for good on ${formatDate(purgeDate(n))} (${plural(Math.max(d, 0), 'day')} left).`; }
  if (!n.closedAt) return '';
  const d = daysUntil(trashDate(n)); return `Closed on ${formatDate(n.closedAt)}. Moves to the Trash on ${formatDate(trashDate(n))} (${plural(Math.max(d, 0), 'day')} left).`;
}

/** Last thing that happened on a record (for "last update" and the reminder). */
function lastActivityDate(n) {
  const acts = (n.activity || []).map(a => a.date).filter(Boolean).sort();
  return acts.length ? acts[acts.length - 1] : (n.date || '');
}

/** Reminder state. Counted from the last activity (or the record date when there is none) plus "remind after N days". */
function getReminderInfo(note) {
  if (isClosedNote(note)) return { state: 'done', badgeText: note.status === 'Closed' ? 'Closed' : 'Done', badgeClass: 'badge-done', text: note.status === 'Closed' ? 'Closed' : 'Resolved' };
  const base = isRfq(note) ? lastActivityDate(note) : note.date;
  if (!base || note.remindAfterDays === '' || note.remindAfterDays == null) {
    return { state: 'none', badgeText: null, badgeClass: '', text: 'No reminder set' };
  }
  const reminderDate = addDaysISO(base, note.remindAfterDays);
  const diffDays = daysBetweenISO(todayISO(), reminderDate); // positive = reminder still ahead, negative = already passed
  if (diffDays < 0) { const d = Math.abs(diffDays); return { state: 'overdue', badgeText: 'Overdue', badgeClass: 'badge-overdue', text: `Follow-up overdue by ${d} day${d === 1 ? '' : 's'}`, date: reminderDate }; }
  if (diffDays === 0) return { state: 'today', badgeText: 'Due Today', badgeClass: 'badge-due-today', text: 'Follow-up due today', date: reminderDate };
  if (diffDays === 1) return { state: 'soon', badgeText: 'Due Soon', badgeClass: 'badge-due-soon', text: 'Follow-up due tomorrow', date: reminderDate };
  return { state: 'upcoming', badgeText: null, badgeClass: '', text: `Follow-up in ${diffDays} days (${formatDate(reminderDate)})`, date: reminderDate };
}

/** The quotation an RFQ points at may have been revised since: always follow the newest revision of that quotation. */
function latestQuote(q, all) {
  if (!q || q.isLatest) return q || null;
  return (all || []).find(x => x.familyId === q.familyId && x.isLatest) || q;
}
/** The current quotation of an RFQ: its newest revision; if the exact record was deleted, the surviving revision of the same quotation. */
function quoteForRfq(n, all) {
  if (!n.quotationId) return null;
  const q = (all || []).find(x => x.id === n.quotationId);
  if (q) return latestQuote(q, all);
  return n.quotationFamilyId ? ((all || []).find(x => x.familyId === n.quotationFamilyId && x.isLatest) || null) : null;
}

/** Keeps an RFQ in step with its quotation (idempotent — only acts when the quotation's revision or status changed since last time):
    · revised → follows the newest revision, ball with us while the new revision is prepared
    · Sent / Under Review → the ball moves to the customer
    · Won / Lost → the RFQ is closed (so its reminder stops and it leaves the "waiting" counts)
    · Expired → the ball comes back to us. Returns true when the RFQ was changed (caller saves it). */
function applyQuoteState(n, q) {
  if (!isRfq(n) || !q) return false;
  const key = `${q.id}|${q.revision}|${q.status}`;
  if (n.quoteSeen === key) return false;
  const first = !n.quoteSeen; const today = todayISO();
  const rev = q.revision ? `${q.quotationNo} Rev ${q.revision}` : q.quotationNo;
  const log = (text, party, ball) => { (n.activity = n.activity || []).push({ id: 'A' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), date: today, type: 'Note', party, supplierEntryId: '', text, ballAfter: ball, by: 'Automatic' }); n.ballWith = ball; n.ballSince = today; n.ballSupplierEntryId = ''; };
  n.quotationId = q.id; n.quotationNo = q.quotationNo; n.quotationFamilyId = q.familyId || q.id;
  if (q.status === 'Draft') { if (!first) log(`${rev} is being prepared.`, 'Us', 'Us'); }
  else if (q.status === 'Sent' || q.status === 'Under Review') log(`${rev} was sent to the customer — waiting for their reply.`, 'Customer', 'Customer');
  else if (q.status === 'Won') { log(`${rev} was marked Won — RFQ closed.`, 'Customer', 'Us'); n.status = 'Closed'; n.closedReason = 'Won'; n.closedAt = n.closedAt || today; }
  else if (q.status === 'Lost') { log(`${rev} was marked Lost — RFQ closed.`, 'Customer', 'Us'); n.status = 'Closed'; n.closedReason = 'Lost'; n.closedAt = n.closedAt || today; }
  else if (q.status === 'Expired') log(`${rev} has expired — extend or revise it.`, 'Us', 'Us');
  n.quoteSeen = key; n.updatedAt = new Date().toISOString();
  return true;
}

/** Moves RFQs closed for 5+ days to the Trash and deletes RFQs that have been in the Trash for 30+ days.
 *  Runs whenever RFQs are opened (the BMS only runs in the browser, so there is no background job). */
async function purgeClosedRfqs() {
  const today = todayISO(); const notes = await DB.dbGetAll('notes'); let moved = 0, deleted = 0;
  for (const n of notes) {
    if (!isRfq(n)) continue;
    if (n.status !== 'Closed') { if (n.closedAt || n.trashedAt) { delete n.closedAt; delete n.trashedAt; await DB.dbPut('notes', n); } continue; }
    if (n.trashedAt) {
      if (daysBetweenISO(n.trashedAt, today) >= RFQ_TRASH_DAYS) { await DB.dbDelete('notes', n.id); await DB.logActivity(`Deleted RFQ ${n.noteNo} (${n.referenceEmail || 'no reference'}) for good — it was in the Trash for ${RFQ_TRASH_DAYS} days`); deleted++; }
      continue;
    }
    if (!n.closedAt) { n.closedAt = today; await DB.dbPut('notes', n); continue; }   // closed before this rule existed: the 5 days start today
    if (daysBetweenISO(n.closedAt, today) >= RFQ_KEEP_CLOSED_DAYS) { n.trashedAt = today; await DB.dbPut('notes', n); await DB.logActivity(`Moved RFQ ${n.noteNo} (${n.referenceEmail || 'no reference'}) to the Trash — closed ${RFQ_KEEP_CLOSED_DAYS}+ days ago`); moved++; }
  }
  return { moved, deleted };
}

/** Brings every RFQ that has a quotation up to date (also fixes RFQs linked before this existed). */
async function reconcileRfqs() {
  await purgeClosedRfqs();
  const [notes, quotes] = await Promise.all([DB.dbGetAll('notes'), DB.dbGetAll('quotations')]);
  const byId = Object.fromEntries(quotes.map(q => [q.id, q])); let changed = 0;
  for (const n of notes) {
    if (!isRfq(n) || !n.quotationId || isTrashed(n)) continue;
    const q = quoteForRfq(n, quotes); if (!q) continue;
    if (applyQuoteState(n, q)) { await DB.dbPut('notes', n); changed++; }
  }
  return changed;
}

/** Who has the ball right now, and for how long. */
function ballInfo(n) {
  const party = n.ballWith || 'Us';
  const sup = party === 'Supplier' ? ((n.suppliers || []).find(s => s.id === n.ballSupplierEntryId) || null) : null;
  const since = n.ballSince || lastActivityDate(n);
  const days = since ? Math.max(0, daysBetweenISO(since, todayISO())) : 0;
  return { party, supplierName: sup ? sup.name : '', since, days, label: party === 'Supplier' && sup ? `Supplier: ${sup.name}` : party };
}

/** The status shown: a linked quotation decides (Draft → Preparing Offer, anything later → Quoted). */
function effectiveRfqStatus(n, quote) {
  if (!isRfq(n)) return n.status || 'Open';
  if (n.status === 'Closed') return 'Closed';
  if (quote) return quote.status === 'Draft' ? 'Preparing Offer' : 'Quoted';
  return n.status || 'New';
}

/** Customer-facing wording: nothing about suppliers, cost or internal notes. */
function customerStatusText(n, quote) {
  const st = effectiveRfqStatus(n, quote);
  if (st === 'New') return 'Received — being reviewed';
  if (st === 'Sourcing') return 'Sourcing prices and availability';
  if (st === 'Preparing Offer') return 'Preparing your quotation';
  if (st === 'Quoted') return `Quotation sent${quote ? ' (' + quote.quotationNo + ')' : ''}`;
  if (st === 'On Hold') return 'On hold';
  if (n.closedReason === 'Won') return 'Closed — order placed';
  if (n.closedReason === 'Lost') return 'Closed — quotation not awarded';
  return 'Closed';
}
function customerNextStep(n, quote) {
  const st = effectiveRfqStatus(n, quote);
  if (st === 'Closed') return '—';
  if (st === 'Quoted') return 'Waiting for your feedback on our quotation';
  if (st === 'On Hold') return 'On hold until further notice';
  const b = ballInfo(n).party;
  if (b === 'Customer') return 'Waiting for your reply';
  if (b === 'End-User') return 'Waiting for the end-user’s feedback';
  if (b === 'Supplier') return 'Waiting for supplier feedback';
  return 'We are working on it';
}

const ballChip = (b) => `<span class="ball-chip ball-${String(b.party).toLowerCase().replace(/[^a-z]/g, '')}">${escapeHtml(b.label)}</span>`;
const waitText = (b) => `${b.days} day${b.days === 1 ? '' : 's'} waiting`;
const waitClass = (b) => b.party === 'Us' ? (b.days >= 3 ? 'wait-red' : b.days >= 1 ? 'wait-amber' : '') : (b.days >= 10 ? 'wait-red' : b.days >= 5 ? 'wait-amber' : '');

/* ============================================================ LIST ============================================================ */

async function renderRfqList() {
  const content = document.getElementById('content');
  await reconcileRfqs();
  Router.setBreadcrumb([{ label: 'RFQ Tracker' }]);
  const [allRaw, customers, quotations] = await Promise.all([DB.dbGetAll('notes'), DB.dbGetAll('customers'), DB.dbGetAll('quotations')]);
  const all = allRaw.filter(n => !isTrashed(n)), trash = allRaw.filter(isTrashed);
  const custMap = Object.fromEntries(customers.map(c => [c.id, c]));
  const quoteOf = (n) => quoteForRfq(n, quotations);
  const custName = (n) => isRfq(n) ? ((custMap[n.customerId] || {}).companyName || n.title || '') : (n.title || '');

  const open = all.filter(n => isRfq(n) && n.status !== 'Closed');
  const groups = { 'Us': [], 'Supplier': [], 'Customer': [], 'End-User': [] };
  open.forEach(n => { if (effectiveRfqStatus(n, quoteOf(n)) === 'Quoted' && !(n.activity || []).length) return; groups[ballInfo(n).party].push(n); });
  const strip = BALL_PARTIES.map(p => {
    const arr = groups[p]; const oldest = arr.reduce((m, n) => Math.max(m, ballInfo(n).days), 0);
    return `<button type="button" class="ball-card ball-${p.toLowerCase().replace(/[^a-z]/g, '')}${arr.length ? '' : ' ball-empty'}" data-ball="${p}"><div class="ball-card-num">${arr.length}</div><div class="ball-card-lbl"><b>${p === 'Us' ? 'Waiting on us' : p === 'Supplier' ? 'Waiting on suppliers' : p === 'Customer' ? 'Waiting on the customer' : 'Waiting on the end-user'}</b><br><span>${arr.length ? `longest wait ${oldest} day${oldest === 1 ? '' : 's'}` : 'nothing waiting'}</span></div></button>`;
  }).join('');

  content.innerHTML = `
    <div class="page-head">
      <div><h1>RFQ Tracker</h1><div class="muted-text">Every customer RFQ / inquiry: where it stands, who has the ball, and what happened.</div></div>
      <div class="page-actions"><button class="btn-line" id="btnNewGeneral">+ General note</button><button class="btn-amber" id="btnNewRfq">+ New RFQ</button></div>
    </div>
    <div class="ball-strip" id="ballStrip">${strip}</div>
    <div class="card" style="padding:12px 16px;">
      <div class="page-actions" style="margin:0; flex-wrap:wrap; gap:10px;">
        <input type="search" id="rfqSearch" class="search-box" placeholder="Search RFQ reference, customer, end-user, supplier, notes…" style="min-width:280px;">
        <label style="font-size:12px;">Show <select id="rfqShow"><option value="open">Open RFQs and notes</option><option value="rfq">RFQs only</option><option value="general">General notes only</option><option value="closed">Closed / done</option><option value="all">Everything</option><option value="trash">Trash (${trash.length}) — restorable</option></select></label>
        <label style="font-size:12px;">Customer <select id="rfqCustomer"><option value="">All customers</option>${customers.filter(c => !c.archived).sort((a, b) => a.companyName.localeCompare(b.companyName)).map(c => `<option value="${c.id}">${escapeHtml(c.companyName)}</option>`).join('')}</select></label>
        <label style="font-size:12px;"><input type="checkbox" id="rfqCustView"> Customer view <span class="muted-text">(hides suppliers &amp; internal notes)</span></label>
        <button class="btn-line btn-sm" id="btnPrintCust" style="display:none;">Print customer update</button>
      </div>
      <div id="rfqBasis" class="muted-text" style="margin-top:8px; line-height:1.6;"></div>
    </div>
    <div class="card" style="padding:0;" id="rfqTableWrap"></div>`;

  let ballFilter = '';
  const q = (id) => document.getElementById(id);
  const urgencyRank = { overdue: 0, today: 1, soon: 2, upcoming: 3, none: 4, done: 5 };

  function filtered() {
    const term = q('rfqSearch').value.trim().toLowerCase(); const show = q('rfqShow').value; const cust = Number(q('rfqCustomer').value) || 0;
    const custView = q('rfqCustView').checked;
    return (show === 'trash' ? trash : all).filter(n => {
      const closed = isClosedNote(n);
      if (custView && !isRfq(n)) return false;
      if (show === 'open' && closed) return false; if (show === 'rfq' && (!isRfq(n) || closed)) return false;
      if (show === 'general' && (isRfq(n) || closed)) return false; if (show === 'closed' && !closed) return false;
      if (cust && !(isRfq(n) && n.customerId === cust)) return false;
      if (ballFilter && !(isRfq(n) && !closed && ballInfo(n).party === ballFilter)) return false;
      if (term) {
        const hay = [n.noteNo, n.referenceEmail, custName(n), n.endUser, n.body, ...(n.suppliers || []).map(s => s.name + ' ' + s.emailRef), ...(n.emailLog || []).map(e => e.text + ' ' + (e.status || '')), ...(n.activity || []).map(a => a.text)].join(' ').toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }

  function draw() {
    const custView = q('rfqCustView').checked; const rows = filtered();
    q('btnPrintCust').style.display = custView ? '' : 'none';
    document.querySelectorAll('.ball-card').forEach(b => b.classList.toggle('ball-active', b.dataset.ball === ballFilter));
    const showLbl = { open: 'open RFQs and general notes', rfq: 'open RFQs', general: 'open general notes', closed: 'closed RFQs (moved to the Trash 5 days after closing) and finished notes', all: 'everything except the Trash', trash: `RFQs in the Trash (deleted for good ${RFQ_TRASH_DAYS} days after moving there; open one and click “Restore RFQ”)` }[q('rfqShow').value];
    const cust = Number(q('rfqCustomer').value);
    q('rfqBasis').innerHTML = `Showing <b>${escapeHtml(showLbl)}</b>${cust ? ' for <b>' + escapeHtml((custMap[cust] || {}).companyName || '') + '</b>' : ' for all customers'}${ballFilter ? ' · where the ball is with <b>' + escapeHtml(ballFilter) + '</b>' : ''}${q('rfqSearch').value.trim() ? ' · matching “' + escapeHtml(q('rfqSearch').value.trim()) + '”' : ''}${custView ? ' · <b>Customer view</b>: internal details are hidden' : ''} · <b>${rows.length}</b> row${rows.length === 1 ? '' : 's'}.`;
    if (!rows.length) { q('rfqTableWrap').innerHTML = `<div class="empty-inline">${all.length ? 'Nothing matches these filters. Change “Show”, the customer or the search.' : 'No RFQs yet. Click “+ New RFQ” when a customer sends you an RFQ or inquiry.'}</div>`; return; }
    if (custView) {
      rows.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      q('rfqTableWrap').innerHTML = `<table class="data-table"><thead><tr><th>RFQ / Inquiry</th><th>Customer</th><th>End-User</th><th>Received</th><th>Status</th><th>Where things stand</th><th>Last update</th></tr></thead><tbody>${rows.map(n => {
        const qt = quoteOf(n); return `<tr class="clickable-row" data-hash="/rfq-tracker/${n.id}"><td>${escapeHtml(n.referenceEmail || '—')}</td><td>${escapeHtml(custName(n))}</td><td>${escapeHtml(n.endUser || '—')}</td><td>${formatDate(n.date)}</td><td>${escapeHtml(customerStatusText(n, qt))}</td><td>${escapeHtml(customerNextStep(n, qt))}</td><td>${formatDate(lastActivityDate(n))}</td></tr>`; }).join('')}</tbody></table>`;
      return;
    }
    rows.sort((a, b) => urgencyRank[getReminderInfo(a).state] - urgencyRank[getReminderInfo(b).state] || (b.date || '').localeCompare(a.date || ''));
    q('rfqTableWrap').innerHTML = `<table class="data-table"><thead><tr><th>No.</th><th>RFQ / Inquiry</th><th>Customer</th><th>End-User</th><th>Received</th><th>Status</th><th>Ball in court</th><th>Last update</th><th>Reminder</th></tr></thead><tbody>${rows.map(n => {
      const info = getReminderInfo(n); const rowStyle = (info.state === 'overdue' || info.state === 'today') ? ' style="background:var(--danger-lt);"' : '';
      if (!isRfq(n)) return `<tr class="clickable-row" data-hash="/rfq-tracker/${n.id}"${rowStyle}><td>${escapeHtml(n.noteNo)}</td><td><span class="kind-chip">General note</span> ${escapeHtml(n.referenceEmail || '')}</td><td>${escapeHtml(n.title || '')}</td><td>—</td><td>${formatDate(n.date)}</td><td>${statusBadge(n.status || 'Open')}</td><td class="muted-text">—</td><td>${descClip(n.body || '')}</td><td>${info.badgeText ? statusBadge(info.badgeText) : `<span class="muted-text">${escapeHtml(info.text)}</span>`}</td></tr>`;
      const qt = quoteOf(n); const st = effectiveRfqStatus(n, qt); const b = ballInfo(n); const closed = isClosedNote(n);
      const lastAct = (n.activity || []).slice().sort((a, b2) => (b2.date || '').localeCompare(a.date || ''))[0];
      return `<tr class="clickable-row" data-hash="/rfq-tracker/${n.id}"${rowStyle}><td>${escapeHtml(n.noteNo)}</td><td>${escapeHtml(n.referenceEmail || '—')}</td><td>${escapeHtml(custName(n))}</td><td>${escapeHtml(n.endUser || '—')}</td><td>${formatDate(n.date)}</td><td>${statusBadge(st)}</td>
        <td>${closed ? '<span class="muted-text">—</span>' : `${ballChip(b)}<div class="wait-text ${waitClass(b)}">${waitText(b)}</div>`}</td>
        <td>${formatDate(lastActivityDate(n))}${lastAct ? `<div class="muted-text">${escapeHtml(lastAct.type + ': ' + lastAct.text)}</div>` : ''}</td>
        <td>${info.badgeText ? statusBadge(info.badgeText) : `<span class="muted-text">${escapeHtml(info.text)}</span>`}${closed && isRfq(n) && closedNotice(n) ? `<div class="muted-text" style="font-size:11px;">${escapeHtml(closedNotice(n))}</div>` : ''}</td></tr>`;
    }).join('')}</tbody></table>`;
  }

  ['rfqShow', 'rfqCustomer', 'rfqCustView'].forEach(id => q(id).addEventListener('change', draw));
  q('rfqSearch').addEventListener('input', debounce(draw, 200));
  document.querySelectorAll('.ball-card').forEach(b => b.onclick = () => { ballFilter = ballFilter === b.dataset.ball ? '' : b.dataset.ball; if (ballFilter && q('rfqShow').value !== 'open' && q('rfqShow').value !== 'rfq') q('rfqShow').value = 'open'; draw(); });
  q('btnNewRfq').onclick = () => Router.navigate('/rfq-tracker/new');
  q('btnNewGeneral').onclick = () => Router.navigate('/rfq-tracker/new-note');
  q('btnPrintCust').onclick = () => {
    const rows = filtered().filter(isRfq).sort((a, b) => (b.date || '').localeCompare(a.date || '')); const cust = Number(q('rfqCustomer').value);
    printCustomerUpdate(rows.map(n => ({ n, qt: quoteOf(n) })), cust ? (custMap[cust] || {}).companyName : '', custName);
  };
  draw();
}

/** One clean page for the customer: reference, end-user, dates and plain-language status — nothing internal. */
async function printCustomerUpdate(items, customerName, custName) {
  const settings = await DB.getSettings();
  const co = settings.companyName || 'Hadrontech Industrial Solutions';
  const rowsHtml = items.map(({ n, qt }) => `<tr><td><b>${escapeHtml(n.referenceEmail || '—')}</b>${n.endUser ? `<div style="color:#667;font-size:11px;">End-user: ${escapeHtml(n.endUser)}</div>` : ''}</td>${customerName ? '' : `<td>${escapeHtml(custName(n))}</td>`}<td>${formatDate(n.date)}</td><td>${escapeHtml(customerStatusText(n, qt))}</td><td>${escapeHtml(customerNextStep(n, qt))}</td><td>${formatDate(lastActivityDate(n))}</td></tr>`).join('');
  printShell('RFQ status update', `
    <div class="p-head"><div><div class="p-co-name">${escapeHtml(co)}</div></div><div><div class="p-doc-title">RFQ Status Update</div><div class="p-doc-no">${escapeHtml(customerName || 'All customers')}</div><div class="p-dates">As of ${formatDate(todayISO())}</div></div></div>
    <table class="p-items" style="margin-top:18px;"><thead><tr><th>RFQ / Inquiry Reference</th>${customerName ? '' : '<th>Customer</th>'}<th>Received</th><th>Status</th><th>Where things stand</th><th>Last update</th></tr></thead><tbody>${rowsHtml || '<tr><td colspan="6">No RFQs to show.</td></tr>'}</tbody></table>
    <div class="p-terms">This is a status summary of the inquiries received from you. Please contact us if you need anything further.</div>`);
}

/* ============================================================ DETAIL ============================================================ */

async function renderRfqDetail(id) {
  const content = document.getElementById('content');
  await reconcileRfqs();
  const note = await DB.dbGet('notes', Number(id));
  if (!note) { Router.setBreadcrumb([{ label: 'RFQ Tracker', hash: '/rfq-tracker' }, { label: 'Not found' }]); content.innerHTML = `<div class="empty-state"><h3>Not found</h3><p><a href="#/rfq-tracker">Back to the RFQ Tracker</a></p></div>`; return; }
  if (!isRfq(note)) return renderGeneralNoteDetail(note);

  const [customer, quote] = await Promise.all([DB.dbGet('customers', note.customerId), note.quotationId ? DB.dbGetAll('quotations').then(all => quoteForRfq(note, all)) : null]);
  note.suppliers = note.suppliers || []; note.activity = note.activity || []; note.emailLog = note.emailLog || [];
  const info = getReminderInfo(note); const b = ballInfo(note); const st = effectiveRfqStatus(note, quote); const closed = note.status === 'Closed'; const trashed = isTrashed(note);
  Router.setBreadcrumb([{ label: 'RFQ Tracker', hash: '/rfq-tracker' }, { label: note.noteNo }]);
  const save = async (msg) => { note.updatedAt = new Date().toISOString(); await DB.dbPut('notes', note); if (msg) await DB.logActivity(msg); renderRfqDetail(id); };

  content.innerHTML = `
    <div class="page-head">
      <div><div class="doc-number-tag">${escapeHtml(note.noteNo)} · RFQ / Inquiry Reference</div><h1 class="rfq-ref-title">${escapeHtml(note.referenceEmail || '—')}</h1>
        <div style="margin-top:6px;">${statusBadge(st)} ${closed ? '' : ballChip(b)} ${info.badgeText && !closed ? statusBadge(info.badgeText) : ''}</div></div>
      <div class="page-actions">
        ${quote ? `<a class="btn-amber" href="#/quotations/${quote.id}">View Quotation ${escapeHtml(quote.quotationNo)}</a>` : `<button class="btn-amber" id="btnConvert" ${closed ? 'disabled' : ''}>Convert to Quotation</button>`}
        <button class="btn-line" id="btnCustUpdate">Customer update (print)</button>
        <button class="btn-line" id="btnEdit">Edit</button>
        <button class="btn-line" id="btnClose">${trashed ? 'Restore RFQ' : closed ? 'Reopen RFQ' : 'Close RFQ'}</button>
        <button class="btn-danger" id="btnDelete">Delete</button>
      </div>
    </div>
    ${closed && closedNotice(note) ? `<div class="card ${trashed ? 'danger-card' : ''}"><b>${escapeHtml(closedNotice(note))}</b> ${trashed ? 'Click “Restore RFQ” to bring it back as an open RFQ.' : 'Click “Reopen RFQ” to keep it.'}</div>` : ''}
    ${(info.state === 'overdue' || info.state === 'today') && !closed ? `<div class="card danger-card"><b>${escapeHtml(info.text)}</b> — the ball is with <b>${escapeHtml(b.label)}</b> (${escapeHtml(waitText(b))}). Log what you did, or follow up.</div>` : ''}

    <div class="card">
      <div class="detail-grid">
        <div class="detail-item"><div class="detail-label">Customer</div><div class="detail-value">${customer ? `<a href="#/customers/${customer.id}">${escapeHtml(customer.companyName)}</a>` : escapeHtml(note.title || '—')}</div></div>
        <div class="detail-item"><div class="detail-label">End-User</div><div class="detail-value">${escapeHtml(note.endUser || '—')}</div></div>
        <div class="detail-item"><div class="detail-label">Received</div><div class="detail-value">${formatDate(note.date)}</div></div>
        <div class="detail-item"><div class="detail-label">Status</div><div class="detail-value">${quote ? escapeHtml(RFQ_STATUS_TEXT[st] || st) + ` <span class="muted-text">(follows quotation ${escapeHtml(quote.quotationNo)}: ${escapeHtml(quote.status)})</span>` : `<select id="selStatus" ${closed ? 'disabled' : ''}>${RFQ_STATUSES.filter(s => s !== 'Closed').map(s => `<option value="${s}" ${s === note.status ? 'selected' : ''}>${escapeHtml(RFQ_STATUS_TEXT[s])}</option>`).join('')}${closed ? '<option selected>Closed</option>' : ''}</select>`}</div></div>
        <div class="detail-item"><div class="detail-label">Ball in court</div><div class="detail-value">${closed ? '—' : `${ballChip(b)} <span class="muted-text">since ${formatDate(b.since)} · <span class="${waitClass(b)}">${escapeHtml(waitText(b))}</span> — ${escapeHtml(BALL_EXPLAIN[b.party])}</span>`}</div></div>
        <div class="detail-item"><div class="detail-label">Follow-up reminder</div><div class="detail-value">${escapeHtml(info.text)}${note.remindAfterDays !== '' && note.remindAfterDays != null && !closed ? ` <span class="muted-text">(${note.remindAfterDays} day${Number(note.remindAfterDays) === 1 ? '' : 's'} after the last activity)</span>` : ''}</div></div>
      </div>
      ${note.body ? `<div style="margin-top:12px;"><div class="detail-label">Background / internal notes</div><p style="white-space:pre-line; margin:4px 0 0;">${escapeHtml(note.body)}</p></div>` : ''}
    </div>

    <div class="card">
      <h3 class="section-title">Emails sent for this RFQ — date and days since</h3>
      ${note.emailLog.length ? `<table class="data-table compact"><thead><tr><th style="width:36%;">Email (who / subject)</th><th style="width:28%;">Status</th><th>Date emailed</th><th>Days since the date (to today, ${formatDate(todayISO())})</th><th></th></tr></thead><tbody>${note.emailLog.slice().sort((a, c) => String(a.date || '').localeCompare(String(c.date || ''))).map(e => `<tr>
        <td><input type="text" class="emText" data-eid="${e.id}" value="${escapeHtml(e.text)}" style="width:100%; min-width:220px;" ${closed ? 'disabled' : ''}></td>
        <td><input type="text" class="emStatus" data-eid="${e.id}" value="${escapeHtml(e.status || '')}" placeholder="e.g. Awaiting reply" style="width:100%; min-width:160px;" ${closed ? 'disabled' : ''}></td>
        <td><input type="date" class="emDate" data-eid="${e.id}" value="${escapeHtml(e.date || '')}" ${closed ? 'disabled' : ''}></td>
        <td><b>${daysSinceText(e.date)}</b></td>
        <td>${closed ? '' : `<button class="btn-line btn-sm btnEmDel" data-eid="${e.id}" title="Remove this email from the list">✕</button>`}</td></tr>`).join('')}</tbody></table>` : '<p class="muted-text">No emails listed yet. Click “+ Add email” each time you email someone about this RFQ, then keep its status up to date.</p>'}
      <div id="emAddHost" style="margin-top:12px;"></div>
      ${closed ? '' : '<div class="btn-row" style="margin-top:10px;"><button class="btn-line btn-sm" id="btnAddEmail">+ Add email</button></div>'}
    </div>

    <div class="card">
      <h3 class="section-title">Activity log — what happened, and who has the ball</h3>
      ${closed ? '' : `<form id="actForm" class="act-form">
        <div class="form-grid">
          <div class="field"><label>Date</label><input type="date" id="act_date" value="${todayISO()}"></div>
          <div class="field"><label>What kind of entry</label><select id="act_type">${ACTIVITY_TYPES.map(t => `<option>${t}</option>`).join('')}</select></div>
          <div class="field field-wide"><label>What happened</label><textarea id="act_text" rows="2" ></textarea></div>
          <div class="field"><label>The ball is now with</label><select id="act_ball">${BALL_PARTIES.map(p => `<option>${p}</option>`).join('')}</select><div class="muted-text" style="font-size:11px; margin-top:3px;" id="act_ballHint"></div></div>
          <div class="field"><label>Remind me to follow up in (days)</label><input type="number" min="0" id="act_remind" value="${note.remindAfterDays === '' || note.remindAfterDays == null ? 3 : note.remindAfterDays}"></div>
        </div>
        <div class="btn-row"><button type="submit" class="btn-amber btn-sm">Add to log</button></div>
      </form>`}
      ${note.activity.length ? `<div class="timeline">${note.activity.slice().sort((a, c) => (c.date || '').localeCompare(a.date || '') || (c.id || '').localeCompare(a.id || '')).map(a => `<div class="timeline-item"><div class="timeline-date">${formatDate(a.date)}</div><div class="timeline-body"><span class="kind-chip">${escapeHtml(a.type)}</span> <span class="ball-chip ball-${String(a.party).toLowerCase().replace(/[^a-z]/g, '')}">${escapeHtml(a.party === 'Supplier' && a.supplierEntryId ? 'Supplier: ' + (supName(a.supplierEntryId) || a.supplierName || '') : a.party)}</span><div style="white-space:pre-line; margin-top:3px;">${escapeHtml(a.text)}</div><div class="muted-text" style="font-size:11px;">Ball afterwards: <b>${escapeHtml(a.ballAfter)}</b>${a.by ? ' · by ' + escapeHtml(a.by) : ''}</div></div></div>`).join('')}</div>` : '<p class="muted-text">Nothing logged yet.</p>'}
    </div>
    <div class="meta-strip">Created ${formatDate(note.createdAt)} by ${escapeHtml(note.createdBy || '—')}${note.updatedAt && note.updatedAt !== note.createdAt ? ` · Last modified ${formatDate(note.updatedAt)}` : ''}</div>`;

  const q = (i) => document.getElementById(i);
  q('btnEdit').onclick = () => Router.navigate(`/rfq-tracker/${note.id}/edit`);
  q('btnCustUpdate').onclick = () => printCustomerUpdate([{ n: note, qt: quote }], customer ? customer.companyName : note.title, () => '');
  q('btnClose').onclick = async () => {
    if (closed) { note.status = 'Sourcing'; delete note.closedAt; delete note.trashedAt; delete note.closedReason; note.ballWith = 'Us'; note.ballSince = todayISO(); }
    else { note.status = 'Closed'; note.closedAt = todayISO(); delete note.trashedAt; }
    await save(`${trashed ? 'Restored RFQ ' + note.noteNo + ' from the Trash' : closed ? 'Reopened RFQ ' + note.noteNo : 'Closed RFQ ' + note.noteNo}`);
  };
  q('btnDelete').onclick = async () => { if (!confirm(`Delete ${note.noteNo}? This cannot be undone.`)) return; await DB.dbDelete('notes', note.id); await DB.logActivity(`Deleted RFQ ${note.noteNo}`); toast('Deleted.'); Router.navigate('/rfq-tracker'); };
  if (q('btnConvert')) q('btnConvert').onclick = () => { window.RFQ_PREFILL = { rfqId: note.id, customerId: note.customerId, endUser: note.endUser || '', rfqRef: note.referenceEmail || '' }; Router.navigate('/quotations/new'); };
  if (q('selStatus')) q('selStatus').onchange = async (e) => { note.status = e.target.value; await save(`Set RFQ ${note.noteNo} status to ${note.status}`); };

  /* Emails list: plain text boxes + a date; "days since" is worked out from the date. */
  const emSave = async (eid, patch, msg) => { const e = note.emailLog.find(x => x.id === eid); if (!e) return; Object.assign(e, patch); await save(msg); };
  document.querySelectorAll('.emText').forEach(i => i.onchange = () => emSave(i.dataset.eid, { text: i.value.trim() || '(no text)' }, `Edited an email on ${note.noteNo}`));
  document.querySelectorAll('.emStatus').forEach(i => i.onchange = () => emSave(i.dataset.eid, { status: i.value.trim() }, `Updated the status of an email on ${note.noteNo}`));
  document.querySelectorAll('.emDate').forEach(i => i.onchange = () => { if (i.value) emSave(i.dataset.eid, { date: i.value }, `Changed the date of an email on ${note.noteNo}`); });
  document.querySelectorAll('.btnEmDel').forEach(b => b.onclick = async () => { const e = note.emailLog.find(x => x.id === b.dataset.eid); if (!e || !confirm(`Remove “${e.text}” from this list?`)) return; note.emailLog = note.emailLog.filter(x => x.id !== e.id); await save(`Removed an email from ${note.noteNo}`); });
  if (q('btnAddEmail')) q('btnAddEmail').onclick = () => {
    q('emAddHost').innerHTML = `<div class="card" style="background:var(--bg-soft, #f6f7fa);"><div class="form-grid">
      <div class="field"><label>Email (who / subject)</label><input type="text" id="em_text" placeholder="e.g. ANSAC Technology — RFQ level transmitter"></div>
      <div class="field"><label>Status</label><input type="text" id="em_status" placeholder="e.g. Follow-up sent — awaiting reply"></div>
      <div class="field"><label>Date emailed</label><input type="date" id="em_date" value="${todayISO()}"></div></div>
      <div class="btn-row"><button class="btn-amber btn-sm" id="em_save">Add email</button><button class="btn-line btn-sm" id="em_cancel">Cancel</button></div></div>`;
    q('em_text').focus();
    q('em_cancel').onclick = () => { q('emAddHost').innerHTML = ''; };
    q('em_save').onclick = async () => {
      const text = q('em_text').value.trim(); if (!text) { toast('Type the email (who / subject).', 'err'); return; }
      note.emailLog.push({ id: 'E' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), text, status: q('em_status').value.trim(), date: q('em_date').value || todayISO() });
      await save(`Added an email to ${note.noteNo}`);
    };
  };

  if (q('actForm')) {
    const sync = (e) => {
      const t = q('act_type').value;
      if (t === 'Email received') q('act_ball').value = 'Us';
      q('act_ballHint').textContent = t === 'Email sent' ? 'You sent it, so the ball usually moves to them — change if needed.' : t === 'Email received' ? 'They replied, so the ball is usually back with us — change if needed.' : 'Choose who needs to act next.';
    };
    q('act_type').addEventListener('change', sync); sync();
    q('actForm').addEventListener('submit', async (e) => {
      e.preventDefault(); const text = q('act_text').value.trim(); if (!text) { toast('Write what happened.', 'err'); return; }
      const ball0 = q('act_ball').value; const party = ball0 !== 'Us' ? ball0 : (q('act_type').value === 'Note' ? 'Us' : 'Customer');
      const date = q('act_date').value || todayISO(); const ball = q('act_ball').value; const settings = await DB.getSettings();
      note.activity.push({ id: 'A' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), date, type: q('act_type').value, party, supplierEntryId: '', supplierName: '', text, ballAfter: ball, by: settings.userName });
      if (ball !== note.ballWith || !note.ballSince) { note.ballSince = date; }
      note.ballWith = ball; note.ballSupplierEntryId = '';
      note.remindAfterDays = q('act_remind').value === '' ? '' : Number(q('act_remind').value);
      if (note.status === 'New' && ball === 'Supplier') note.status = 'Sourcing';
      await save(`Logged ${q('act_type').value.toLowerCase()} on ${note.noteNo}`);
    });
  }
}

/* ============================================================ RFQ FORM ============================================================ */

async function renderRfqForm(record) {
  const content = document.getElementById('content'); const isNew = !record;
  const customers = (await DB.dbGetAll('customers')).filter(c => !c.archived || (record && c.id === record.customerId)).sort((a, b) => a.companyName.localeCompare(b.companyName));
  Router.setBreadcrumb(isNew ? [{ label: 'RFQ Tracker', hash: '/rfq-tracker' }, { label: 'New RFQ' }] : [{ label: 'RFQ Tracker', hash: '/rfq-tracker' }, { label: record.noteNo, hash: `/rfq-tracker/${record.id}` }, { label: 'Edit' }]);
  content.innerHTML = `
    <div class="page-head"><h1>${isNew ? 'New RFQ' : `Edit ${escapeHtml(record.noteNo)}`}</h1></div>
    <form id="rfqForm" class="form-card"><div class="card">
      <div class="form-grid">
        <div class="field"><label>Customer *</label><select id="f_customerId" required><option value="">— Select customer —</option>${customers.map(c => `<option value="${c.id}" ${record && c.id === record.customerId ? 'selected' : ''}>${escapeHtml(c.companyName)}</option>`).join('')}</select></div>
        <div class="field"><label>End-User (optional)</label><input id="f_endUser" value="${escapeHtml(record?.endUser || '')}"></div>
        <div class="field field-wide"><label>RFQ / Inquiry Reference *</label><input id="f_ref" required value="${escapeHtml(record?.referenceEmail || '')}" placeholder="Paste the email subject"></div>
        <div class="field"><label>Date received</label><input type="date" id="f_date" value="${record?.date || todayISO()}"></div>
        <div class="field"><label>Remind me to follow up after (days)</label><input type="number" min="0" id="f_remind" value="${record?.remindAfterDays ?? 3}"><div class="muted-text" style="font-size:11px; margin-top:3px;">Counted from the last entry in the activity log.</div></div>
      </div>
      <div class="field" style="margin-top:14px;"><label>Background / internal notes (optional)</label><textarea id="f_body" rows="4">${escapeHtml(record?.body || '')}</textarea></div>
    </div><div class="form-actions"><button type="submit" class="btn-amber" id="btnSave">Save</button><button type="button" class="btn-line" id="btnCancel">Cancel</button></div></form>`;
  content.querySelectorAll('#rfqForm input, #rfqForm textarea, #rfqForm select').forEach(i => i.addEventListener('input', markDirty));
  document.getElementById('btnCancel').onclick = () => { if (!guardNavigation()) return; clearDirty(); Router.navigate(isNew ? '/rfq-tracker' : `/rfq-tracker/${record.id}`); };
  document.getElementById('rfqForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const btn = document.getElementById('btnSave'); if (btn.disabled) return; btn.disabled = true;
    try {
      const settings = await DB.getSettings(); const now = new Date().toISOString();
      const customerId = Number(document.getElementById('f_customerId').value); const cust = customers.find(c => c.id === customerId);
      if (!customerId) { toast('Please choose the customer.', 'err'); return; }
      const ref = document.getElementById('f_ref').value.trim(); if (!ref) { toast('Enter the RFQ / Inquiry Reference.', 'err'); return; }
      const payload = { kind: 'RFQ', customerId, title: cust.companyName, referenceEmail: ref, endUser: document.getElementById('f_endUser').value.trim(), date: document.getElementById('f_date').value || todayISO(), remindAfterDays: document.getElementById('f_remind').value === '' ? '' : Number(document.getElementById('f_remind').value), body: document.getElementById('f_body').value, updatedAt: now };
      if (isNew) {
        Object.assign(payload, { noteNo: await DB.nextDocNumber('rfq'), status: 'New', ballWith: 'Us', ballSince: payload.date, ballSupplierEntryId: '', suppliers: [], activity: [{ id: 'A' + Date.now().toString(36), date: payload.date, type: 'Note', party: 'Customer', supplierEntryId: '', text: 'RFQ received from the customer.', ballAfter: 'Us', by: settings.userName }], quotationId: null, createdAt: now, createdBy: settings.userName });
        const newId = await DB.dbAdd('notes', payload); await DB.logActivity(`Created RFQ ${payload.noteNo}`); clearDirty(); toast('RFQ created.'); Router.navigate(`/rfq-tracker/${newId}`);
      } else { Object.assign(record, payload); await DB.dbPut('notes', record); await DB.logActivity(`Updated RFQ ${record.noteNo}`); clearDirty(); toast('Saved.'); Router.navigate(`/rfq-tracker/${record.id}`); }
    } finally { btn.disabled = false; }
  });
}

/* ============================================================ GENERAL NOTES (the old Notes, unchanged in behaviour) ============================================================ */

async function renderGeneralNoteDetail(note) {
  const content = document.getElementById('content'); const info = getReminderInfo(note);
  Router.setBreadcrumb([{ label: 'RFQ Tracker', hash: '/rfq-tracker' }, { label: note.noteNo }]);
  content.innerHTML = `
    <div class="page-head">
      <div><div class="doc-number-tag">${escapeHtml(note.noteNo)} · General note</div><h1>${escapeHtml(note.title)} ${info.badgeText ? statusBadge(info.badgeText) : ''}</h1></div>
      <div class="page-actions"><button class="btn-amber" id="btnToggleDone">${note.status === 'Done' ? 'Reopen' : 'Mark as Done'}</button><button class="btn-line" id="btnEditNote">Edit</button><button class="btn-danger" id="btnDeleteNote">Delete</button></div>
    </div>
    ${(info.state === 'overdue' || info.state === 'today') ? `<div class="card danger-card"><b>${escapeHtml(info.text)}</b> — this note needs action.</div>` : ''}
    <div class="card"><div class="detail-grid">
      <div class="detail-item"><div class="detail-label">Date</div><div class="detail-value">${formatDate(note.date)}</div></div>
      <div class="detail-item"><div class="detail-label">Email Subject Reference</div><div class="detail-value">${escapeHtml(note.referenceEmail || '—')}</div></div>
      <div class="detail-item"><div class="detail-label">Remind After</div><div class="detail-value">${note.remindAfterDays !== '' && note.remindAfterDays != null ? `${note.remindAfterDays} day${Number(note.remindAfterDays) === 1 ? '' : 's'} after the date` : 'No reminder'}</div></div>
      <div class="detail-item"><div class="detail-label">Reminder Status</div><div class="detail-value">${escapeHtml(info.text)}</div></div>
    </div></div>
    <div class="card"><h3 class="section-title">Note</h3><p style="white-space:pre-line;">${escapeHtml(note.body || '')}</p></div>
    <div class="meta-strip">Created ${formatDate(note.createdAt)} by ${escapeHtml(note.createdBy || '—')}${note.updatedAt && note.updatedAt !== note.createdAt ? ` · Last modified ${formatDate(note.updatedAt)}` : ''}</div>`;
  document.getElementById('btnEditNote').onclick = () => Router.navigate(`/rfq-tracker/${note.id}/edit`);
  document.getElementById('btnToggleDone').onclick = async () => { note.status = note.status === 'Done' ? 'Open' : 'Done'; note.updatedAt = new Date().toISOString(); await DB.dbPut('notes', note); await DB.logActivity(`${note.status === 'Done' ? 'Resolved' : 'Reopened'} note ${note.noteNo}`); toast(note.status === 'Done' ? 'Marked as done.' : 'Reopened.'); renderRfqDetail(note.id); };
  document.getElementById('btnDeleteNote').onclick = async () => { if (!confirm(`Delete ${note.noteNo}? This cannot be undone.`)) return; await DB.dbDelete('notes', note.id); await DB.logActivity(`Deleted note ${note.noteNo}`); toast('Deleted.'); Router.navigate('/rfq-tracker'); };
}

async function renderGeneralNoteForm(record) {
  const content = document.getElementById('content'); const isNew = !record;
  Router.setBreadcrumb(isNew ? [{ label: 'RFQ Tracker', hash: '/rfq-tracker' }, { label: 'New general note' }] : [{ label: 'RFQ Tracker', hash: '/rfq-tracker' }, { label: record.noteNo, hash: `/rfq-tracker/${record.id}` }, { label: 'Edit' }]);
  content.innerHTML = `
    <div class="page-head"><h1>${isNew ? 'New general note' : `Edit ${escapeHtml(record.noteNo)}`}</h1></div>
    <form id="noteForm" class="form-card"><div class="card"><div class="form-grid">
      <div class="field"><label>For (Customer / Supplier)</label><input id="f_title" value="${escapeHtml(record?.title || '')}" placeholder="e.g. KEYEC, Onsemi Cebu, Pentair" required></div>
      <div class="field"><label>Email Subject Reference</label><input id="f_referenceEmail" type="text" value="${escapeHtml(record?.referenceEmail || '')}" placeholder="e.g. RE: QRF 566-25631 FCU double inlet centrifugal"></div>
      <div class="field"><label>Date</label><input type="date" id="f_date" value="${record?.date || todayISO()}"></div>
      <div class="field"><label>Remind After (days)</label><input type="number" min="0" id="f_remindAfterDays" value="${record?.remindAfterDays ?? 3}"><p class="muted-text" style="margin-top:4px;">You'll be flagged once this many days have passed since the Date above.</p></div>
    </div><div class="field" style="margin-top:14px;"><label>Note</label><textarea id="f_body" rows="6" placeholder="What do you need to remember or follow up on?">${escapeHtml(record?.body || '')}</textarea></div></div>
    <div class="form-actions"><button type="submit" class="btn-amber" id="btnSaveNote">Save</button><button type="button" class="btn-line" id="btnCancelNote">Cancel</button></div></form>
    <p class="muted-text">Is this about a customer RFQ? Use <a href="#/rfq-tracker/new">New RFQ</a> instead — it tracks the emails you sent, their status and who has the ball.</p>`;
  content.querySelectorAll('#noteForm input, #noteForm textarea').forEach(i => i.addEventListener('input', markDirty));
  document.getElementById('btnCancelNote').onclick = () => { if (!guardNavigation()) return; clearDirty(); Router.navigate(isNew ? '/rfq-tracker' : `/rfq-tracker/${record.id}`); };
  document.getElementById('noteForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const btn = document.getElementById('btnSaveNote'); if (btn.disabled) return; btn.disabled = true;
    try {
      const settings = await DB.getSettings(); const now = new Date().toISOString();
      const payload = { title: document.getElementById('f_title').value.trim(), referenceEmail: document.getElementById('f_referenceEmail').value.trim(), date: document.getElementById('f_date').value || todayISO(), remindAfterDays: document.getElementById('f_remindAfterDays').value === '' ? '' : Number(document.getElementById('f_remindAfterDays').value), body: document.getElementById('f_body').value, updatedAt: now };
      if (!payload.title) { toast('Please enter who this reminder is for.', 'err'); return; }
      if (isNew) { payload.noteNo = await DB.nextDocNumber('note'); payload.status = 'Open'; payload.createdAt = now; payload.createdBy = settings.userName; const newId = await DB.dbAdd('notes', payload); await DB.logActivity(`Created note ${payload.noteNo}`); clearDirty(); toast('Note created.'); Router.navigate(`/rfq-tracker/${newId}`); }
      else { Object.assign(record, payload); await DB.dbPut('notes', record); await DB.logActivity(`Updated note ${record.noteNo}`); clearDirty(); toast('Saved.'); Router.navigate(`/rfq-tracker/${record.id}`); }
    } finally { btn.disabled = false; }
  });
}

/** Called by the quotation form after it creates a quotation that started from an RFQ. */
async function linkRfqToQuotation(rfqId, quotationId, quotationNo) {
  const n = await DB.dbGet('notes', Number(rfqId)); if (!n) return;
  n.quotationId = quotationId; n.quotationNo = quotationNo; n.quotationFamilyId = quotationId; n.quoteSeen = `${quotationId}|0|Draft`; n.updatedAt = new Date().toISOString();
  (n.activity = n.activity || []).push({ id: 'A' + Date.now().toString(36), date: todayISO(), type: 'Note', party: 'Us', supplierEntryId: '', text: `Quotation ${quotationNo} created from this RFQ.`, ballAfter: 'Us', by: (await DB.getSettings()).userName });
  n.ballWith = 'Us'; n.ballSince = todayISO(); n.ballSupplierEntryId = '';
  await DB.dbPut('notes', n); await DB.logActivity(`Created quotation ${quotationNo} from RFQ ${n.noteNo}`);
}
window.RfqTracker = { purgeClosedRfqs, isTrashed, quoteForRfq, reconcileRfqs, applyQuoteState, latestQuote, linkRfqToQuotation, getReminderInfo, ballInfo, effectiveRfqStatus, customerStatusText, customerNextStep };
