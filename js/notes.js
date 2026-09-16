/* ============================================================
   notes.js — General follow-up notes with an optional reminder.
   A note has a date and a "remind after N days" setting; once that
   many days have passed since the note's date, it's flagged as
   needing action -- escalating from a neutral state, to "due soon"
   (amber) the day before, to "overdue" (red) once the reminder date
   has actually passed, matching the same red-for-urgent convention
   used for expired Quotations elsewhere in this app. Marking a note
   "Done" clears the urgency regardless of date.
   ============================================================ */

Router.route('/notes', () => renderNotesList());
Router.route('/notes/new', () => renderNoteForm(null));
Router.route('/notes/:id', (p) => renderNoteDetail(p.id));
Router.route('/notes/:id/edit', async (p) => {
  const rec = await DB.dbGet('notes', Number(p.id));
  renderNoteForm(rec);
});

/** Computes the current urgency state for a note relative to today.
    Reminder date = note.date + note.remindAfterDays. */
function getReminderInfo(note) {
  if (note.status === 'Done') return { state: 'done', badgeText: 'Done', badgeClass: 'badge-done', text: 'Resolved' };
  if (!note.date || note.remindAfterDays === '' || note.remindAfterDays == null) {
    return { state: 'none', badgeText: null, badgeClass: '', text: 'No reminder set' };
  }
  const reminderDate = addDaysISO(note.date, note.remindAfterDays);
  const diffDays = daysBetweenISO(todayISO(), reminderDate); // positive = reminder still ahead, negative = already passed

  if (diffDays < 0) {
    const daysAgo = Math.abs(diffDays);
    return { state: 'overdue', badgeText: 'Overdue', badgeClass: 'badge-overdue', text: `Overdue by ${daysAgo} day${daysAgo === 1 ? '' : 's'}` };
  }
  if (diffDays === 0) {
    return { state: 'today', badgeText: 'Due Today', badgeClass: 'badge-due-today', text: 'Due today' };
  }
  if (diffDays === 1) {
    return { state: 'soon', badgeText: 'Due Soon', badgeClass: 'badge-due-soon', text: 'Due tomorrow' };
  }
  return { state: 'upcoming', badgeText: null, badgeClass: '', text: `Reminder in ${diffDays} days` };
}

async function renderNotesList() {
  const content = document.getElementById('content');
  Router.setBreadcrumb([{ label: 'Notes' }]);
  const all = await DB.dbGetAll('notes');
  // Most urgent first: overdue, then due today, then due soon, then everything else by date.
  const urgencyRank = { overdue: 0, today: 1, soon: 2, upcoming: 3, none: 4, done: 5 };
  all.sort((a, b) => urgencyRank[getReminderInfo(a).state] - urgencyRank[getReminderInfo(b).state] || (a.date || '').localeCompare(b.date || ''));

  content.innerHTML = `
    <div class="page-head">
      <h1>Notes</h1>
      <div class="page-actions"><button class="btn-amber" id="btnNewNote">+ New Note</button></div>
    </div>
    <div class="card" style="padding:0;">
      ${all.length === 0 ? `<div class="empty-inline">No notes yet. Add one to keep track of something you need to follow up on.</div>` : `
      <table class="data-table">
        <thead><tr><th>Note No.</th><th>Date</th><th>Title</th><th>Reference Email</th><th>Reminder</th></tr></thead>
        <tbody>${all.map(n => {
          const info = getReminderInfo(n);
          // Urgent rows get a light red tint across the whole row, not just the badge --
          // meant to be genuinely hard to miss when scanning the list, matching what was asked for.
          const rowStyle = (info.state === 'overdue' || info.state === 'today') ? ' style="background:var(--danger-lt);"' : '';
          return `<tr class="clickable-row" data-hash="/notes/${n.id}"${rowStyle}>
            <td>${escapeHtml(n.noteNo)}</td>
            <td>${formatDate(n.date)}</td>
            <td>${escapeHtml(n.title)}</td>
            <td>${escapeHtml(n.referenceEmail || '—')}</td>
            <td>${info.badgeText ? statusBadge(info.badgeText) : `<span class="muted-text">${escapeHtml(info.text)}</span>`}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>`}
    </div>
  `;
  document.getElementById('btnNewNote').onclick = () => Router.navigate('/notes/new');
}

async function renderNoteDetail(id) {
  const note = await DB.dbGet('notes', Number(id));
  const content = document.getElementById('content');
  if (!note) { content.innerHTML = `<div class="empty-state"><h3>Note not found</h3></div>`; return; }
  const info = getReminderInfo(note);
  Router.setBreadcrumb([{ label: 'Notes', hash: '/notes' }, { label: note.noteNo }]);

  content.innerHTML = `
    <div class="page-head">
      <div><div class="doc-number-tag">${escapeHtml(note.noteNo)}</div><h1>${escapeHtml(note.title)} ${info.badgeText ? statusBadge(info.badgeText) : ''}</h1></div>
      <div class="page-actions">
        <button class="btn-amber" id="btnToggleDone">${note.status === 'Done' ? 'Reopen' : 'Mark as Done'}</button>
        <button class="btn-line" id="btnEditNote">Edit</button>
        <button class="btn-danger" id="btnDeleteNote">Delete</button>
      </div>
    </div>

    ${(info.state === 'overdue' || info.state === 'today') ? `<div class="card danger-card"><b>${escapeHtml(info.text)}</b> — this note needs action.</div>` : ''}

    <div class="card">
      <div class="detail-grid">
        <div class="detail-item"><div class="detail-label">Date</div><div class="detail-value">${formatDate(note.date)}</div></div>
        <div class="detail-item"><div class="detail-label">Reference Email</div><div class="detail-value">${escapeHtml(note.referenceEmail || '—')}</div></div>
        <div class="detail-item"><div class="detail-label">Remind After</div><div class="detail-value">${note.remindAfterDays !== '' && note.remindAfterDays != null ? `${note.remindAfterDays} day${Number(note.remindAfterDays) === 1 ? '' : 's'}` : '—'}</div></div>
        <div class="detail-item"><div class="detail-label">Reminder Status</div><div class="detail-value">${escapeHtml(info.text)}</div></div>
      </div>
    </div>

    <div class="card">
      <h3 class="section-title">Note</h3>
      <p style="white-space:pre-line;">${escapeHtml(note.body || '')}</p>
    </div>

    <div class="meta-strip">Created ${formatDate(note.createdAt)} by ${escapeHtml(note.createdBy || '—')}${note.updatedAt && note.updatedAt !== note.createdAt ? ` · Last modified ${formatDate(note.updatedAt)}` : ''}</div>
  `;

  document.getElementById('btnEditNote').onclick = () => Router.navigate(`/notes/${note.id}/edit`);
  document.getElementById('btnToggleDone').onclick = async () => {
    note.status = note.status === 'Done' ? 'Open' : 'Done';
    note.updatedAt = new Date().toISOString();
    await DB.dbPut('notes', note);
    await DB.logActivity(`${note.status === 'Done' ? 'Resolved' : 'Reopened'} note ${note.noteNo}`);
    toast(note.status === 'Done' ? 'Marked as done.' : 'Reopened.');
    renderNoteDetail(id);
  };
  document.getElementById('btnDeleteNote').onclick = async () => {
    if (!confirm(`Delete ${note.noteNo}? This cannot be undone.`)) return;
    await DB.dbDelete('notes', note.id);
    await DB.logActivity(`Deleted note ${note.noteNo}`);
    toast('Deleted.');
    Router.navigate('/notes');
  };
}

async function renderNoteForm(record) {
  const content = document.getElementById('content');
  const isNew = !record;
  Router.setBreadcrumb(isNew
    ? [{ label: 'Notes', hash: '/notes' }, { label: 'New' }]
    : [{ label: 'Notes', hash: '/notes' }, { label: record.noteNo, hash: `/notes/${record.id}` }, { label: 'Edit' }]);

  content.innerHTML = `
    <div class="page-head"><h1>${isNew ? 'New Note' : `Edit ${escapeHtml(record.noteNo)}`}</h1></div>
    <form id="noteForm" class="form-card">
      <div class="card">
        <div class="form-grid">
          <div class="field"><label>Title</label><input id="f_title" value="${escapeHtml(record?.title || '')}" required></div>
          <div class="field"><label>Reference Email</label><input id="f_referenceEmail" type="email" value="${escapeHtml(record?.referenceEmail || '')}" placeholder="e.g. contact@customer.com"></div>
          <div class="field"><label>Date</label><input type="date" id="f_date" value="${record?.date || todayISO()}"></div>
          <div class="field"><label>Remind After (days)</label><input type="number" min="0" id="f_remindAfterDays" value="${record?.remindAfterDays ?? 3}" placeholder="e.g. 3">
            <p class="muted-text" style="margin-top:4px;">You'll be flagged once this many days have passed since the Date above.</p>
          </div>
        </div>
        <div class="field" style="margin-top:14px;">
          <label>Note</label>
          <textarea id="f_body" rows="6" placeholder="What do you need to remember or follow up on?">${escapeHtml(record?.body || '')}</textarea>
        </div>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn-amber" id="btnSaveNote">Save</button>
        <button type="button" class="btn-line" id="btnCancelNote">Cancel</button>
      </div>
    </form>
  `;

  content.querySelectorAll('#noteForm input, #noteForm textarea').forEach(i => i.addEventListener('input', markDirty));

  document.getElementById('btnCancelNote').onclick = () => {
    if (!guardNavigation()) return;
    clearDirty();
    Router.navigate(isNew ? '/notes' : `/notes/${record.id}`);
  };

  document.getElementById('noteForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btnSaveNote');
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      const settings = await DB.getSettings();
      const now = new Date().toISOString();
      const payload = {
        title: document.getElementById('f_title').value.trim(),
        referenceEmail: document.getElementById('f_referenceEmail').value.trim(),
        date: document.getElementById('f_date').value || todayISO(),
        remindAfterDays: document.getElementById('f_remindAfterDays').value === '' ? '' : Number(document.getElementById('f_remindAfterDays').value),
        body: document.getElementById('f_body').value,
        updatedAt: now
      };
      if (!payload.title) { toast('Title is required.', 'err'); btn.disabled = false; return; }
      if (isNew) {
        payload.noteNo = await DB.nextDocNumber('note');
        payload.status = 'Open';
        payload.createdAt = now;
        payload.createdBy = settings.userName;
        const newId = await DB.dbAdd('notes', payload);
        await DB.logActivity(`Created note ${payload.noteNo}`);
        clearDirty();
        toast('Note created.');
        Router.navigate(`/notes/${newId}`);
      } else {
        Object.assign(record, payload);
        await DB.dbPut('notes', record);
        await DB.logActivity(`Updated note ${record.noteNo}`);
        clearDirty();
        toast('Saved.');
        Router.navigate(`/notes/${record.id}`);
      }
    } finally {
      btn.disabled = false;
    }
  });
}
