/* ============================================================
   distributions.js — Profit distributions computed per CALENDAR
   MONTH, using Net Profit (not Gross Profit) as the base.

   Why net, not gross: established partnership practice splits what's
   left after ALL costs -- not just cost of goods, but real operating
   expenses too (rent, utilities, everything already tracked in the
   Expenses module) -- usually on a regular cadence, not per order.
   A single order's gross margin doesn't account for the business's
   actual running costs, so distributing on it in isolation risks
   handing out money the business still needs for its own bills.

   Waterfall: Gross Profit (sum of every Sales Order's own computed
   margin, across the month) MINUS Expenses (sum of every Expense
   recorded in that same month) = Net Profit -> minus Reserve % (an
   optional extra buffer, since real expenses are already subtracted
   here) -> Distributable Amount -> split among partners by their
   (editable, per-distribution) %.

   Still fully manual: the business owner decides WHEN to create a
   distribution and picks WHICH month it covers. Nothing is
   auto-triggered by a payment or a calendar date. Gross Profit and
   Expenses are auto-computed from real records the moment a month is
   chosen, but both stay editable, in case an adjustment is genuinely
   needed (e.g. excluding a one-off outlier).

   Cash Received in the month (actual customer payments collected,
   from Proforma Invoice payment history) is shown alongside the
   Distributable Amount as a sanity check -- Net Profit is still an
   earned/accrual figure, and some of a month's orders may not be
   fully paid yet. If Distributable Amount exceeds Cash Received,
   a live red warning appears. A nudge, not a block.
   ============================================================ */

Router.route('/distributions', () => renderDistributionsList());
Router.route('/distributions/new', () => renderDistributionForm(null));
Router.route('/distributions/:id', (p) => renderDistributionDetail(p.id));
Router.route('/distributions/:id/edit', async (p) => {
  const rec = await DB.dbGet('distributions', Number(p.id));
  renderDistributionForm(rec);
});

/** A Sales Order's own Gross Profit -- reusing the exact same per-line formula Quotations
    already use (revenue minus cost, per line, summed), rather than inventing a second way to
    compute the same thing. Sales Orders carry the same lines[] shape (unitCost/unitPrice/qty)
    but don't store a precomputed grossProfit field of their own. */
function soGrossProfit(so) {
  const lines = so.lines || [];
  let net = 0, cost = 0;
  lines.forEach(l => {
    const c = QuoteCalc.computeLine(l, so.currency);
    net = r2(net + c.net);
    cost = r2(cost + c.costTotal);
  });
  return r2(net - cost);
}

function monthLabel(month) {
  if (!month) return '';
  const [y, m] = month.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/** Pulls together everything auto-computable for a given calendar month ('YYYY-MM'):
    - grossProfitTotal: sum of every Sales Order's own Gross Profit, for orders placed that month
    - expensesTotal: sum of every recorded Expense in that same month
    - cashReceivedInMonth: sum of every customer payment actually collected that month, across
      every Proforma Invoice (not just ones tied to that month's own orders -- this is a genuine
      cash-basis figure: money that landed in the bank during the month, regardless of which
      order it was for) */
function computeMonthlyFigures(month, salesOrders, expenses, proformaInvoices) {
  const ordersInMonth = salesOrders.filter(so => (so.orderDate || '').slice(0, 7) === month);
  const grossProfitTotal = r2(ordersInMonth.reduce((s, so) => s + soGrossProfit(so), 0));
  const expensesInMonth = expenses.filter(x => (x.date || '').slice(0, 7) === month);
  const expensesTotal = r2(expensesInMonth.reduce((s, x) => s + (Number(x.amount) || 0), 0));
  const cashReceivedInMonth = r2(proformaInvoices.reduce((sum, pi) =>
    sum + (pi.payments || []).filter(p => (p.date || '').slice(0, 7) === month)
      .reduce((s2, p) => s2 + (Number(p.amount) || 0), 0), 0));
  // Orders created without a Quotation behind them (sample requests, bare Customer POs) default
  // their line cost to ₱0, since there was never a sourcing step to know the real cost from --
  // if that's never corrected on the order afterward, this month's Gross Profit silently treats
  // that order's entire revenue as pure profit. Flag it rather than let it pass unnoticed.
  const zeroCostOrders = ordersInMonth.filter(so =>
    (so.lines || []).some(l => (Number(l.unitCost) || 0) === 0 && (Number(l.unitPrice) || 0) > 0)
  );
  return { ordersCount: ordersInMonth.length, grossProfitTotal, expensesCount: expensesInMonth.length, expensesTotal, cashReceivedInMonth, zeroCostOrders };
}

function computeDistribution(grossProfitTotal, expensesTotal, reservePercent, splits) {
  const gross = Number(grossProfitTotal) || 0;
  const expenses = Number(expensesTotal) || 0;
  const netProfit = r2(gross - expenses);
  const resPct = Number(reservePercent) || 0;
  const reserveAmount = r2(netProfit * resPct / 100);
  const distributableAmount = r2(netProfit - reserveAmount);
  const splitsWithAmounts = splits.map(s => ({
    ...s,
    amount: r2(distributableAmount * (Number(s.percent) || 0) / 100)
  }));
  const totalPercent = r2(splits.reduce((sum, s) => sum + (Number(s.percent) || 0), 0));
  return { gross, expenses, netProfit, reserveAmount, distributableAmount, splits: splitsWithAmounts, totalPercent };
}


/** Payslip figures for one partner's split: gross share + additions (e.g. bonus) - deductions (e.g. cash advance) = net pay. */
function splitAdjustments(s) { return Array.isArray(s.adjustments) ? s.adjustments : []; }
function splitNetPay(s) {
  const adds = splitAdjustments(s).filter(a => a.kind === 'add').reduce((t, a) => t + (Number(a.amount) || 0), 0);
  const less = splitAdjustments(s).filter(a => a.kind !== 'add').reduce((t, a) => t + (Number(a.amount) || 0), 0);
  return r2((Number(s.amount) || 0) + adds - less);
}
/** Stable payslip number: the distribution number + the split's own sequence (kept even if other rows are removed later). */
function slipNumber(dist, s, i) {
  return `${dist.distributionNo}-${String(s.slipSeq || (i + 1)).padStart(2, '0')}`;
}

async function renderDistributionsList() {
  const content = document.getElementById('content');
  Router.setBreadcrumb([{ label: 'Distributions' }]);
  const all = (await DB.dbGetAll('distributions')).sort((a, b) => (b.month || '').localeCompare(a.month || ''));
  const settings = await DB.getSettings();
  const withdrawals = (settings.reserveWithdrawals || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const totalReserve = r2(all.reduce((s, d) => s + (d.reserveAmount || 0), 0));
  const totalUsed = r2(withdrawals.reduce((s, w) => s + (Number(w.amount) || 0), 0));
  const reserveBalance = r2(totalReserve - totalUsed);
  const totalDistributed = r2(all.reduce((s, d) => s + (d.distributableAmount || 0), 0));

  content.innerHTML = `
    <div class="page-head">
      <h1>Distributions</h1>
      <div class="page-actions">
        <a href="#/partners" class="btn-line">Manage Partners &amp; Employees</a>
        <button class="btn-line" id="btnUseReserve">Use Reserve</button>
        <button class="btn-amber" id="btnNewDist">+ New Distribution</button>
      </div>
    </div>
    <div class="stat-grid" style="margin-bottom:16px;">
      ${statCardLocal(formatMoney(reserveBalance, 'PHP'), 'Business Reserve Balance')}
      ${statCardLocal(formatMoney(totalReserve, 'PHP'), 'Reserve Set Aside (all time)')}
      ${statCardLocal(formatMoney(totalUsed, 'PHP'), 'Reserve Used')}
      ${statCardLocal(formatMoney(totalDistributed, 'PHP'), 'Total Distributed')}
      ${statCardLocal(all.length, 'Distributions Made')}
    </div>
    <div id="reserveHost"></div>
    ${withdrawals.length ? `<div class="card"><h3 class="section-title">Reserve Used</h3>
      <table class="data-table compact"><thead><tr><th>Date</th><th>Reason</th><th>Amount</th><th>Recorded by</th><th></th></tr></thead>
      <tbody>${withdrawals.map(w => `<tr><td>${formatDate(w.date)}</td><td>${escapeHtml(w.reason)}</td><td>-${formatMoney(w.amount, 'PHP')}</td><td>${escapeHtml(w.createdBy || '—')}</td><td class="row-del" data-wdel="${escapeHtml(w.id)}" title="Remove this entry">✕</td></tr>`).join('')}</tbody></table></div>` : ''}
    <div class="card" style="padding:0;">
      ${all.length === 0 ? `<div class="empty-inline">No distributions yet. Create one once a month has real profit worth splitting.</div>` : `
      <table class="data-table">
        <thead><tr><th>Distribution No.</th><th>Month</th><th>Gross Profit</th><th>Expenses</th><th>Net Profit</th><th>Reserve %</th><th>Distributed</th><th>Cash Received</th><th>Reference</th></tr></thead>
        <tbody>${all.map(d => `
          <tr class="clickable-row" data-hash="/distributions/${d.id}">
            <td>${escapeHtml(d.distributionNo)}</td>
            <td>${escapeHtml(monthLabel(d.month))}</td>
            <td>${formatMoney(d.grossProfitTotal, 'PHP')}</td>
            <td>${formatMoney(d.expensesTotal, 'PHP')}</td>
            <td>${formatMoney(d.netProfit, 'PHP')}</td>
            <td>${d.reservePercent}%</td>
            <td>${formatMoney(d.distributableAmount, 'PHP')}</td>
            <td>${formatMoney(d.cashReceivedInMonth, 'PHP')}${d.distributableAmount > (d.cashReceivedInMonth || 0) ? ' <span style="color:var(--danger);" title="Distributable amount exceeded cash actually received this month">⚠</span>' : ''}</td>
            <td>${escapeHtml(d.reference || '—')}</td>
          </tr>`).join('')}</tbody>
      </table>`}
    </div>
  `;
  document.getElementById('btnNewDist').onclick = () => Router.navigate('/distributions/new');
  document.getElementById('btnUseReserve').onclick = () => {
    const host = document.getElementById('reserveHost');
    host.innerHTML = `
      <div class="card">
        <h3 class="section-title">Use Reserve</h3>
        <p class="muted-text">Record money taken out of the Business Reserve. Available now: <b>${formatMoney(reserveBalance, 'PHP')}</b>.</p>
        <div class="form-grid">
          <div class="field"><label>Date</label><input type="date" id="rv_date" value="${todayISO()}"></div>
          <div class="field"><label>Amount</label><input type="number" min="0" step="0.01" id="rv_amount"></div>
          <div class="field field-wide"><label>Reason *</label><input id="rv_reason" placeholder="e.g. Equipment purchase, tax payment, slow-month shortfall"></div>
        </div>
        <div class="btn-row" style="margin-top:12px;">
          <button class="btn-amber btn-sm" id="btnSaveReserveUse">Save</button>
          <button class="btn-line btn-sm" id="btnCancelReserveUse">Cancel</button>
        </div>
      </div>`;
    host.scrollIntoView && host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    document.getElementById('btnCancelReserveUse').onclick = () => { host.innerHTML = ''; };
    document.getElementById('btnSaveReserveUse').onclick = async () => {
      const amount = r2(Number(document.getElementById('rv_amount').value) || 0);
      const reason = document.getElementById('rv_reason').value.trim();
      if (amount <= 0) { toast('Enter an amount greater than 0.', 'err'); return; }
      if (!reason) { toast('Give a reason for using the reserve.', 'err'); return; }
      if (amount > reserveBalance) { toast(`Only ${formatMoney(reserveBalance, 'PHP')} is in the reserve.`, 'err'); return; }
      const fresh = await DB.getSettings();
      fresh.reserveWithdrawals = (fresh.reserveWithdrawals || []).concat([{ id: 'R' + Math.random().toString(36).slice(2, 9), date: document.getElementById('rv_date').value || todayISO(), amount, reason, createdBy: fresh.userName, createdAt: new Date().toISOString() }]);
      await DB.dbPut('settings', fresh);
      await DB.logActivity(`Used ${formatMoney(amount, 'PHP')} from the business reserve: ${reason}`);
      toast('Reserve use recorded.');
      renderDistributionsList();
    };
  };
  content.querySelectorAll('[data-wdel]').forEach(el => el.onclick = async () => {
    if (!confirm('Remove this reserve entry? The amount goes back into the reserve balance.')) return;
    const fresh = await DB.getSettings();
    fresh.reserveWithdrawals = (fresh.reserveWithdrawals || []).filter(w => w.id !== el.dataset.wdel);
    await DB.dbPut('settings', fresh);
    await DB.logActivity('Removed a business reserve entry');
    toast('Entry removed.');
    renderDistributionsList();
  });
}

// A small local stat-card helper, matching the Dashboard's own visual style without depending
// on dashboard.js being loaded (Distributions can be reached independently of the Dashboard).
function statCardLocal(value, label) {
  return `<div class="stat-card"><div class="stat-card-num">${value}</div><div class="stat-card-lbl">${escapeHtml(label)}</div></div>`;
}

async function renderDistributionDetail(id) {
  const dist = await DB.dbGet('distributions', Number(id));
  const content = document.getElementById('content');
  if (!dist) { content.innerHTML = `<div class="empty-state"><h3>Distribution not found</h3></div>`; return; }
  Router.setBreadcrumb([{ label: 'Distributions', hash: '/distributions' }, { label: dist.distributionNo }]);
  const exceeds = dist.distributableAmount > (dist.cashReceivedInMonth || 0);
  const peopleById = {}; (await DB.dbGetAll('partners')).forEach(p => { peopleById[String(p.id)] = p; });
  // The person's CURRENT type wins (so switching someone to Employee protects their old payslips too), then the saved snapshot.
  const isEmployeeSplit = (s) => ((peopleById[String(s.partnerId)] || {}).partnerType || s.partnerType) === 'Employee';

  content.innerHTML = `
    <div class="page-head">
      <div><div class="doc-number-tag">${escapeHtml(dist.distributionNo)}</div><h1>Distribution — ${escapeHtml(monthLabel(dist.month))}</h1></div>
      <div class="page-actions">
        <button class="btn-amber" id="btnPrintAllSlips">Print All Payslips</button>
        <button class="btn-line" id="btnEditDist">Edit</button>
        <button class="btn-danger" id="btnDeleteDist">Delete</button>
      </div>
    </div>

    <div class="card">
      <div class="totals">
        <div class="line"><span>Gross Profit (${dist.month})</span><span>${formatMoney(dist.grossProfitTotal, 'PHP')}</span></div>
        <div class="line"><span>Expenses (${dist.month})</span><span>-${formatMoney(dist.expensesTotal, 'PHP')}</span></div>
        <div class="line grand"><span>Net Profit</span><span>${formatMoney(dist.netProfit, 'PHP')}</span></div>
        <div class="line"><span>Reserve (${dist.reservePercent}%)</span><span>-${formatMoney(dist.reserveAmount, 'PHP')}</span></div>
        <div class="line grand"><span>Distributable Amount</span><span>${formatMoney(dist.distributableAmount, 'PHP')}</span></div>
      </div>
      <div class="detail-item" style="margin-top:10px;">
        <div class="detail-label">Cash Received This Month (actual, all customer payments)</div>
        <div class="detail-value">${formatMoney(dist.cashReceivedInMonth, 'PHP')}</div>
        ${exceeds ? `<div style="color:var(--danger); font-weight:700; margin-top:4px;">⚠ The Distributable Amount exceeded the cash actually received this month, at the time of distribution.</div>` : ''}
      </div>
    </div>

    <div class="card">
      <h3 class="section-title">Partner Splits &amp; Payslips</h3>
      <table class="data-table compact">
        <thead><tr><th>Name</th><th>Percent</th><th>Share</th><th>Advances / Adjustments</th><th>Net Pay</th><th>Paid</th><th></th></tr></thead>
        <tbody>${(dist.splits || []).map((s, i) => {
          const adj = splitAdjustments(s).reduce((t, a) => t + (a.kind === 'add' ? 1 : -1) * (Number(a.amount) || 0), 0);
          return `<tr><td>${escapeHtml(s.partnerName)}${isEmployeeSplit(s) ? ' <span class="badge badge-info">Employee</span>' : ''}</td><td>${s.percent}%</td><td>${formatMoney(s.amount, 'PHP')}</td>
            <td>${adj ? (adj > 0 ? '+' : '-') + formatMoney(Math.abs(adj), 'PHP') : '—'}</td>
            <td><b>${formatMoney(splitNetPay(s), 'PHP')}</b></td>
            <td>${s.paidDate ? `<span class="badge badge-paid">Paid ${formatDate(s.paidDate)}</span>` : '<span class="badge badge-pending">Unpaid</span>'}</td>
            <td style="white-space:nowrap;"><button class="btn-line btn-sm" data-slip-edit="${i}">Payslip details</button> <button class="btn-amber btn-sm" data-slip-print="${i}">Print Payslip</button></td></tr>`;
        }).join('')}</tbody>
      </table>
      <p class="muted-text" style="margin-top:8px;">A partner's payslip shows their own share and the month's business totals. An employee's payslip shows only their own earnings.</p>
    </div>
    <div id="slipHost"></div>

    ${dist.reference || dist.notes ? `<div class="card">
      ${dist.reference ? `<div class="detail-item"><div class="detail-label">Reference</div><div class="detail-value">${escapeHtml(dist.reference)}</div></div>` : ''}
      ${dist.notes ? `<p style="white-space:pre-line; margin-top:10px;">${escapeHtml(dist.notes)}</p>` : ''}
    </div>` : ''}

    <div class="meta-strip">Created ${formatDate(dist.createdAt)} by ${escapeHtml(dist.createdBy || '—')}</div>
  `;

  document.getElementById('btnEditDist').onclick = () => Router.navigate(`/distributions/${dist.id}/edit`);
  document.getElementById('btnPrintAllSlips').onclick = () => Print.printPayslips(dist, null);
  content.querySelectorAll('[data-slip-print]').forEach(b => b.onclick = () => Print.printPayslips(dist, Number(b.dataset.slipPrint)));
  content.querySelectorAll('[data-slip-edit]').forEach(b => b.onclick = () => openSlipDetails(dist, Number(b.dataset.slipEdit)));
  document.getElementById('btnDeleteDist').onclick = async () => {
    if (!confirm(`Delete ${dist.distributionNo}? This cannot be undone.`)) return;
    await DB.dbDelete('distributions', dist.id);
    await DB.logActivity(`Deleted distribution ${dist.distributionNo}`);
    toast('Deleted.');
    Router.navigate('/distributions');
  };
}


/** Payslip details for one partner: advances / deductions / bonus lines, and when and how the share was paid. */
function openSlipDetails(dist, idx) {
  const s = dist.splits[idx];
  const host = document.getElementById('slipHost');
  let adj = splitAdjustments(s).map(a => ({ ...a }));
  const draw = () => {
    const net = splitNetPay({ amount: s.amount, adjustments: adj });
    host.innerHTML = `
      <div class="card">
        <h3 class="section-title">Payslip details — ${escapeHtml(s.partnerName)} (${escapeHtml(slipNumber(dist, s, idx))})</h3>
        <p class="muted-text">Share for the month: <b>${formatMoney(s.amount, 'PHP')}</b>. Add anything already taken (a cash advance) as a deduction, or anything extra (a bonus) as an addition.</p>
        <table class="data-table compact"><thead><tr><th>Description</th><th style="width:130px;">Type</th><th style="width:140px;">Amount</th><th></th></tr></thead>
          <tbody>${adj.map((a, i) => `<tr data-ai="${i}">
            <td><input class="adj-label" value="${escapeHtml(a.label || '')}" placeholder="e.g. Cash advance, Sept 12" style="width:100%;"></td>
            <td><select class="adj-kind"><option value="less" ${a.kind !== 'add' ? 'selected' : ''}>Deduction</option><option value="add" ${a.kind === 'add' ? 'selected' : ''}>Addition</option></select></td>
            <td><input class="adj-amount" type="number" min="0" step="0.01" value="${a.amount ?? ''}"></td>
            <td class="row-del" data-adel="${i}">✕</td></tr>`).join('') || '<tr><td colspan="4" class="muted-text">No advances or adjustments.</td></tr>'}</tbody></table>
        <button type="button" class="btn-line btn-sm" id="btnAddAdj" style="margin-top:8px;">+ Add line</button>
        <div class="totals" style="margin-top:12px;"><div class="line grand"><span>Net Pay</span><span id="slipNet">${formatMoney(net, 'PHP')}</span></div></div>
        <div class="form-grid" style="margin-top:12px;">
          <div class="field"><label>Date Paid</label><input type="date" id="slip_paidDate" value="${s.paidDate || ''}"></div>
          <div class="field"><label>Method</label><select id="slip_method">${['Bank Transfer', 'Cash', 'GCash', 'Check', 'Other'].map(m => `<option ${s.paidMethod === m ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
          <div class="field field-wide"><label>Reference / Note</label><input id="slip_ref" value="${escapeHtml(s.paidReference || '')}" placeholder="e.g. bank reference number"></div>
        </div>
        <div class="btn-row" style="margin-top:12px;">
          <button class="btn-amber btn-sm" id="btnSaveSlip">Save</button>
          <button class="btn-line btn-sm" id="btnCancelSlip">Cancel</button>
        </div>
      </div>`;
    host.scrollIntoView && host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const sync = () => {
      host.querySelectorAll('tr[data-ai]').forEach(tr => {
        const a = adj[Number(tr.dataset.ai)];
        a.label = tr.querySelector('.adj-label').value; a.kind = tr.querySelector('.adj-kind').value; a.amount = Number(tr.querySelector('.adj-amount').value) || 0;
      });
      document.getElementById('slipNet').textContent = formatMoney(splitNetPay({ amount: s.amount, adjustments: adj }), 'PHP');
    };
    host.querySelectorAll('tr[data-ai] input, tr[data-ai] select').forEach(el => el.addEventListener('input', sync));
    host.querySelectorAll('[data-adel]').forEach(el => el.onclick = () => { sync(); adj.splice(Number(el.dataset.adel), 1); draw(); });
    document.getElementById('btnAddAdj').onclick = () => { sync(); adj.push({ label: '', kind: 'less', amount: 0 }); draw(); };
    document.getElementById('btnCancelSlip').onclick = () => { host.innerHTML = ''; };
    document.getElementById('btnSaveSlip').onclick = async () => {
      sync();
      const clean = adj.filter(a => (a.label && a.label.trim()) || a.amount > 0);
      if (clean.some(a => !a.label || !a.label.trim())) { toast('Give each advance / adjustment a description.', 'err'); return; }
      const net = splitNetPay({ amount: s.amount, adjustments: clean });
      if (net < 0) { toast('Deductions are more than the share — Net Pay cannot be negative.', 'err'); return; }
      s.adjustments = clean.map(a => ({ label: a.label.trim(), kind: a.kind === 'add' ? 'add' : 'less', amount: r2(a.amount) }));
      s.netPay = net;
      s.paidDate = document.getElementById('slip_paidDate').value || '';
      s.paidMethod = s.paidDate ? document.getElementById('slip_method').value : '';
      s.paidReference = document.getElementById('slip_ref').value.trim();
      if (!s.slipSeq) s.slipSeq = idx + 1;
      await DB.dbPut('distributions', dist);
      await DB.logActivity(`Updated payslip ${slipNumber(dist, s, idx)} (${s.partnerName}): net pay ${formatMoney(net, 'PHP')}${s.paidDate ? ', paid ' + s.paidDate : ''}`);
      toast('Payslip details saved.');
      renderDistributionDetail(dist.id);
    };
  };
  draw();
}

async function renderDistributionForm(record) {
  const content = document.getElementById('content');
  const isNew = !record;
  const companySettings = await DB.getSettings();
  const partners = (await DB.dbGetAll('partners')).filter(p => p.status !== 'Archived' && p.status !== 'Inactive');
  const [salesOrders, expenses, proformaInvoicesRaw] = await Promise.all([
    DB.dbGetAll('salesOrders'), DB.dbGetAll('expenses'), DB.dbGetAll('proformaInvoices')
  ]);
  const proformaInvoices = await Promise.all(proformaInvoicesRaw.map(pi => ProformaInvoices.ensurePISnapshot(pi)));

  Router.setBreadcrumb(isNew
    ? [{ label: 'Distributions', hash: '/distributions' }, { label: 'New' }]
    : [{ label: 'Distributions', hash: '/distributions' }, { label: record.distributionNo, hash: `/distributions/${record.id}` }, { label: 'Edit' }]);

  // A brand new distribution starts one split row per active partner, pre-filled with their own
  // default % -- editing an existing one instead shows exactly the partners/percentages it was
  // originally saved with (its own snapshot), not today's Partners list, so past history never
  // silently shifts if partners or their defaults change later.
  let splits = isNew
    ? partners.map(p => ({ partnerId: p.id, partnerName: p.name, partnerRole: p.role || '', partnerType: p.partnerType || '', percent: p.defaultSplitPercent ?? 0 }))
    : (record.splits || []).map(s => ({ ...s }));

  const defaultMonth = record?.month || todayISO().slice(0, 7);

  content.innerHTML = `
    <div class="page-head"><h1>${isNew ? 'New Distribution' : `Edit ${escapeHtml(record.distributionNo)}`}</h1></div>
    <form id="distForm" class="form-card">
      <div class="card">
        <div class="form-grid">
          <div class="field"><label>Month</label><input type="month" id="f_month" value="${defaultMonth}"></div>
        </div>
        <div id="monthSummary" class="muted-text" style="margin-top:6px;"></div>

        <div class="form-grid" style="margin-top:14px;">
          <div class="field"><label>Gross Profit (PHP)</label><input type="number" min="0" step="0.01" id="f_grossProfit" value="${record?.grossProfitTotal ?? 0}">
            <p class="muted-text" style="margin-top:4px;">Auto-filled from this month's Sales Orders — adjustable if needed.</p>
          </div>
          <div class="field"><label>Expenses (PHP)</label><input type="number" min="0" step="0.01" id="f_expenses" value="${record?.expensesTotal ?? 0}">
            <p class="muted-text" style="margin-top:4px;">Auto-filled from this month's recorded Expenses — adjustable if needed.</p>
          </div>
          <div class="field"><label>Reserve %</label><input type="number" min="0" max="100" step="0.01" id="f_reservePercent" value="${record?.reservePercent ?? (companySettings.defaultReservePercent ?? 10)}">
            <p class="muted-text" style="margin-top:4px;">Set aside for the business before the split. Starts at your default from Settings → Defaults &amp; Terms; change it for this month if needed.</p>
          </div>
        </div>

        <div class="totals" id="distTotalsPreview" style="margin-top:14px;"></div>
        <div id="cashWarning" style="margin-top:8px;"></div>
      </div>

      <div class="card">
        <h3 class="section-title">Partner Splits</h3>
        <table class="data-table compact" id="splitsTable">
          <thead><tr><th>Partner</th><th style="width:120px;">Percent</th><th>Amount</th><th></th></tr></thead>
          <tbody id="splitsBody"></tbody>
        </table>
        <div id="splitTotalWarning" class="muted-text" style="margin-top:8px;"></div>
        <button type="button" class="btn-line btn-sm" id="btnAddSplit" style="margin-top:10px;">+ Add Partner / Employee</button>
        ${partners.length === 0 ? `<p class="muted-text" style="margin-top:8px;">No partners or employees set up yet — <a href="#/partners/new">add one first</a>, or add a one-off row above.</p>` : ''}
      </div>

      <div class="field" style="margin: 0 0 14px;">
        <label>Reference</label>
        <input id="f_reference" value="${escapeHtml(record?.reference || '')}" placeholder="e.g. September profit split">
      </div>
      <div class="field" style="margin-bottom:14px;">
        <label>Notes</label>
        <textarea id="f_notes" rows="3">${escapeHtml(record?.notes || '')}</textarea>
      </div>

      <div class="form-actions">
        <button type="submit" class="btn-amber" id="btnSaveDist">Save</button>
        <button type="button" class="btn-line" id="btnCancelDist">Cancel</button>
      </div>
    </form>
  `;

  // On a brand new distribution, auto-fill Gross Profit/Expenses the moment a month is picked
  // (or immediately, for today's default month). Editing an existing one does NOT re-run this --
  // it shows exactly what was saved, since today's Sales Orders/Expenses for that month may have
  // changed since (e.g. a late-entered expense) and silently updating a past record's basis
  // would be worse than leaving it as the snapshot it was saved as.
  let currentCashReceived = record?.cashReceivedInMonth ?? 0;

  function applyMonthDefaults() {
    const month = document.getElementById('f_month').value;
    const figures = computeMonthlyFigures(month, salesOrders, expenses, proformaInvoices);
    document.getElementById('f_grossProfit').value = figures.grossProfitTotal;
    document.getElementById('f_expenses').value = figures.expensesTotal;
    currentCashReceived = figures.cashReceivedInMonth;
    const summaryLine = `${figures.ordersCount} sales order${figures.ordersCount === 1 ? '' : 's'} and ${figures.expensesCount} expense${figures.expensesCount === 1 ? '' : 's'} found for ${monthLabel(month)}.`;
    const zeroCostWarning = figures.zeroCostOrders.length === 0 ? '' : `<div style="color:var(--danger); font-weight:600; margin-top:4px;">
        ⚠ ${figures.zeroCostOrders.length} order${figures.zeroCostOrders.length === 1 ? '' : 's'} this month (${figures.zeroCostOrders.map(so => escapeHtml(so.soNo)).join(', ')}) ${figures.zeroCostOrders.length === 1 ? 'has a' : 'have'} line with ₱0 recorded cost — likely created without a Quotation behind it. Gross Profit may be overstated unless that's corrected on the order first.
      </div>`;
    document.getElementById('monthSummary').innerHTML = escapeHtml(summaryLine) + zeroCostWarning;
    refreshAll();
  }

  function currentInputs() {
    return {
      grossProfit: document.getElementById('f_grossProfit').value,
      expenses: document.getElementById('f_expenses').value,
      reservePercent: document.getElementById('f_reservePercent').value
    };
  }

  function drawSplits() {
    const body = document.getElementById('splitsBody');
    const { grossProfit, expenses, reservePercent } = currentInputs();
    const computed = computeDistribution(grossProfit, expenses, reservePercent, splits);
    body.innerHTML = splits.map((s, i) => `
      <tr data-idx="${i}">
        <td><input class="sp-name" value="${escapeHtml(s.partnerName)}" style="width:160px;" ${s.partnerId ? 'readonly' : ''}></td>
        <td><input class="sp-percent" type="number" min="0" max="100" step="0.01" value="${s.percent}" style="width:90px;"></td>
        <td class="sp-amount">${formatMoney(computed.splits[i]?.amount ?? 0, 'PHP')}</td>
        <td class="row-del" data-del="${i}">✕</td>
      </tr>`).join('');

    body.querySelectorAll('tr').forEach(tr => {
      const idx = Number(tr.dataset.idx);
      tr.querySelector('.sp-name').addEventListener('input', (e) => { splits[idx].partnerName = e.target.value; markDirty(); });
      tr.querySelector('.sp-percent').addEventListener('input', (e) => { splits[idx].percent = Number(e.target.value) || 0; refreshAll(); markDirty(); });
    });
    body.querySelectorAll('[data-del]').forEach(el => el.addEventListener('click', () => {
      splits.splice(Number(el.dataset.del), 1);
      refreshAll(); markDirty();
    }));

    const warnEl = document.getElementById('splitTotalWarning');
    const totalPct = computed.totalPercent;
    if (splits.length === 0) {
      warnEl.textContent = '';
    } else if (r2(totalPct) !== 100) {
      warnEl.innerHTML = `<span style="color:var(--danger); font-weight:600;">⚠ Percentages add up to ${totalPct}%, not 100% — the distributable amount won't be fully accounted for.</span>`;
    } else {
      warnEl.innerHTML = `<span style="color:var(--ok);">✓ Percentages add up to 100%.</span>`;
    }
  }

  function drawTotalsPreview() {
    const { grossProfit, expenses, reservePercent } = currentInputs();
    const computed = computeDistribution(grossProfit, expenses, reservePercent, splits);
    document.getElementById('distTotalsPreview').innerHTML = `
      <div class="line"><span>Gross Profit</span><span>${formatMoney(computed.gross, 'PHP')}</span></div>
      <div class="line"><span>Expenses</span><span>-${formatMoney(computed.expenses, 'PHP')}</span></div>
      <div class="line grand"><span>Net Profit</span><span>${formatMoney(computed.netProfit, 'PHP')}</span></div>
      <div class="line"><span>Reserve (${Number(reservePercent) || 0}%)</span><span>-${formatMoney(computed.reserveAmount, 'PHP')}</span></div>
      <div class="line grand"><span>Distributable Amount</span><span>${formatMoney(computed.distributableAmount, 'PHP')}</span></div>
    `;

    // Net Profit is still an earned/accrual figure -- some of this month's orders may not be
    // fully paid yet. Comparing against actual cash collected this month keeps this distribution
    // grounded in real money, the same principle behind every other sanity check in this app.
    const warnEl = document.getElementById('cashWarning');
    if (computed.distributableAmount > currentCashReceived) {
      warnEl.innerHTML = `<span style="color:var(--danger); font-weight:700;">⚠ Distributable Amount (${formatMoney(computed.distributableAmount, 'PHP')}) exceeds the ${formatMoney(currentCashReceived, 'PHP')} actually received in cash this month.</span>`;
    } else {
      warnEl.innerHTML = `<span class="muted-text">Cash Received This Month: ${formatMoney(currentCashReceived, 'PHP')}</span>`;
    }
  }

  function refreshAll() { drawTotalsPreview(); drawSplits(); }

  document.getElementById('f_month').addEventListener('change', () => { applyMonthDefaults(); markDirty(); });
  document.getElementById('f_grossProfit').addEventListener('input', () => { refreshAll(); markDirty(); });
  document.getElementById('f_expenses').addEventListener('input', () => { refreshAll(); markDirty(); });
  document.getElementById('f_reservePercent').addEventListener('input', () => { refreshAll(); markDirty(); });
  document.getElementById('btnAddSplit').addEventListener('click', () => {
    splits.push({ partnerId: null, partnerName: '', percent: 0 });
    refreshAll(); markDirty();
  });
  content.querySelectorAll('#f_reference, #f_notes').forEach(el => el.addEventListener('input', markDirty));

  if (isNew) applyMonthDefaults(); else refreshAll();

  document.getElementById('btnCancelDist').onclick = () => {
    if (!guardNavigation()) return;
    clearDirty();
    Router.navigate(isNew ? '/distributions' : `/distributions/${record.id}`);
  };

  document.getElementById('distForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btnSaveDist');
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      const { grossProfit, expenses, reservePercent } = currentInputs();
      const month = document.getElementById('f_month').value;
      if (!month) { toast('Choose a month.', 'err'); btn.disabled = false; return; }
      const computed = computeDistribution(grossProfit, expenses, reservePercent, splits);
      if (computed.netProfit <= 0) { toast('Net Profit must be greater than 0 to distribute anything.', 'err'); btn.disabled = false; return; }
      if (splits.some(s => !s.partnerName || !s.partnerName.trim())) { toast('Every partner split needs a name.', 'err'); btn.disabled = false; return; }
      const settings = await DB.getSettings();
      const now = new Date().toISOString();
      const payload = {
        month,
        grossProfitTotal: computed.gross,
        expensesTotal: computed.expenses,
        netProfit: computed.netProfit,
        reservePercent: Number(reservePercent) || 0,
        reserveAmount: computed.reserveAmount,
        distributableAmount: computed.distributableAmount,
        cashReceivedInMonth: currentCashReceived,
        // Payslip data (advances, payment details, payslip number) rides along on each split so editing the distribution never loses it.
        splits: (() => {
          let nextSeq = Math.max(0, ...computed.splits.map(x => Number(x.slipSeq) || 0)) + 1;
          return computed.splits.map(s => {
            const out = { partnerId: s.partnerId, partnerName: s.partnerName, partnerRole: s.partnerRole || '', partnerType: s.partnerType || '', percent: Number(s.percent) || 0, amount: s.amount,
              slipSeq: s.slipSeq || nextSeq++, adjustments: splitAdjustments(s), paidDate: s.paidDate || '', paidMethod: s.paidMethod || '', paidReference: s.paidReference || '' };
            out.netPay = splitNetPay(out);
            return out;
          });
        })(),
        reference: document.getElementById('f_reference').value.trim(),
        notes: document.getElementById('f_notes').value,
        updatedAt: now
      };
      if (isNew) {
        payload.distributionNo = await DB.nextDocNumber('distribution');
        payload.createdAt = now;
        payload.createdBy = settings.userName;
        const newId = await DB.dbAdd('distributions', payload);
        await DB.logActivity(`Recorded distribution ${payload.distributionNo} for ${monthLabel(month)} — ${formatMoney(payload.distributableAmount, 'PHP')} distributed`);
        clearDirty();
        toast('Distribution saved.');
        Router.navigate(`/distributions/${newId}`);
      } else {
        Object.assign(record, payload);
        await DB.dbPut('distributions', record);
        await DB.logActivity(`Updated distribution ${record.distributionNo}`);
        clearDirty();
        toast('Saved.');
        Router.navigate(`/distributions/${record.id}`);
      }
    } finally {
      btn.disabled = false;
    }
  });
}

window.Distributions = Object.assign(window.Distributions || {}, { splitAdjustments, splitNetPay, slipNumber, monthLabel });
