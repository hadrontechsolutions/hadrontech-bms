/* ============================================================
   print.js — builds clean A4 printable documents in a new window.
   Internal-only fields (cost, markup, margin, supplier) are
   deliberately left out of the customer-facing quotation print.
   ============================================================ */

function printShell(title, bodyHTML) {
  const win = window.open('', '_blank', 'width=900,height=1000');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
  <style>
    body{font-family: Arial, Helvetica, sans-serif; color:#1c2430; margin:0; padding:36px 44px;}
    .p-head{display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #151d2b; padding-bottom:16px;}
    .p-co-name{font-size:22px; font-weight:800; color:#151d2b;}
    .p-co-meta{font-size:11px; color:#666; margin-top:4px; line-height:1.6; white-space:pre-line;}
    .p-doc-title{font-size:12px; font-weight:700; letter-spacing:.14em; text-transform:uppercase; color:#a85f04; text-align:right;}
    .p-doc-no{font-family:'Courier New',monospace; font-size:17px; font-weight:700; text-align:right; margin-top:2px;}
    .p-dates{font-size:11px; color:#555; text-align:right; margin-top:6px; line-height:1.7;}
    .p-grid2{display:grid; grid-template-columns:1fr 1fr; gap:24px; margin:20px 0;}
    .p-label{font-size:10px; letter-spacing:.1em; text-transform:uppercase; color:#888; margin-bottom:4px;}
    table.p-items{width:100%; border-collapse:collapse; margin-top:14px; font-size:12px;}
    table.p-items th{background:#151d2b; color:#fff; text-align:left; padding:7px 8px; font-size:10px; text-transform:uppercase; letter-spacing:.06em;}
    table.p-items td{padding:6px 8px; border-bottom:1px solid #e2e6ec;}
    .p-num{text-align:right; font-family:'Courier New',monospace;}
    .p-totals{width:280px; margin-left:auto; margin-top:14px;}
    .p-totals .ln{display:flex; justify-content:space-between; padding:4px 0; font-size:12px; border-bottom:1px solid #e2e6ec;}
    .p-totals .grand{font-weight:800; font-size:15px; border-top:2px solid #151d2b; border-bottom:none; padding-top:8px;}
    .p-terms{margin-top:24px; font-size:11px; color:#555; line-height:1.7; white-space:pre-line;}
    .p-sign{display:grid; grid-template-columns:1fr 1fr; gap:24px; margin-top:50px;}
    .p-sign .box{border-top:1px solid #1c2430; padding-top:6px; font-size:11px; color:#666;}
    .p-sign-img{height:52px; max-width:190px; object-fit:contain; display:block; margin-bottom:-8px;}
    .p-foot{margin-top:30px; padding-top:10px; border-top:1px solid #e2e6ec; font-size:9px; color:#999; text-align:center;}
    @media print { .no-print{display:none;} }
  </style></head><body>${bodyHTML}
  <div class="no-print" style="margin-top:24px;"><button onclick="window.print()">Print</button></div>
  </body></html>`);
  win.document.close();
}

/** Renders "our side" of a signature block — the uploaded signature image (if any)
    sits in the blank space above the printed name/line, which is the normal convention
    for a scanned or transparent-PNG signature. */
function signatureBlockHTML(settings, label) {
  const img = settings.signatureDataUrl ? `<img class="p-sign-img" src="${settings.signatureDataUrl}" alt="Authorized signature">` : '';
  return `<div>${img}<div class="box">${escapeHtml(settings.authorizedSignatory)}<br>${label}</div></div>`;
}

function coBlock(settings) {
  const meta = [settings.address, settings.tin ? 'TIN: ' + settings.tin : '', [settings.telephone, settings.email].filter(Boolean).join(' · ')].filter(Boolean).join('\n');
  const logo = settings.logoDataUrl ? `<img src="${settings.logoDataUrl}" alt="Logo" style="max-height:52px;max-width:220px;object-fit:contain;margin-bottom:8px;display:block;">` : '';
  return `<div>${logo}<div class="p-co-name">${escapeHtml(settings.companyName)}</div><div class="p-co-meta">${escapeHtml(meta)}</div></div>`;
}

/** Bank details block, shared across every document that's allowed to show it — keeping this
    in one place means the spacing/formatting can never drift or break independently per
    document. Only used on Sales Order and Proforma Invoice — never Quotation (still just a
    proposal at that stage) and never Supplier PO (that's an outbound document where WE are
    the one paying, not the customer, so our own bank details wouldn't belong there). */
function bankDetailsHTML(settings) {
  const hasBankDetails = settings.bankName || settings.bankAccountNumber;
  if (!hasBankDetails) return '';
  return `<div class="p-terms"><b>Bank Details for Payment</b>\n${[
    settings.bankName ? `Bank: ${escapeHtml(settings.bankName)}` : '',
    settings.bankAccountName ? `Account Name: ${escapeHtml(settings.bankAccountName)}` : '',
    settings.bankAccountNumber ? `Account Number: ${escapeHtml(settings.bankAccountNumber)}` : '',
    settings.bankSwiftCode ? `SWIFT Code: ${escapeHtml(settings.bankSwiftCode)}` : '',
    settings.bankAddress ? `Bank Address: ${escapeHtml(settings.bankAddress)}` : ''
  ].filter(Boolean).join('\n')}</div>`;
}

async function printQuotation(q, customer) {
  const settings = await DB.getSettings();
  const custName = customer?.companyName || q.customerSnapshot?.companyName || '';
  const custAddr = customer?.billingAddress || q.customerSnapshot?.address || '';

  const rowHTML = (l, i) => {
    const c = QuoteCalc.computeLine(l);
    return `<tr><td>${i + 1}</td><td>${escapeHtml((l.brand ? l.brand + ' — ' : '') + l.modelNo + (l.modelNo ? ' — ' : '') + l.description)}</td><td class="p-num">${l.qty} ${escapeHtml(l.uom)}</td><td class="p-num">${formatMoney(l.unitPrice, q.currency)}</td><td class="p-num">${l.discountPercent || 0}%</td><td class="p-num">${formatMoney(c.net, q.currency)}</td></tr>`;
  };
  const itemsHead = `<thead><tr><th>#</th><th>Description</th><th>Qty</th><th>Unit Price</th><th>Disc.</th><th>Amount</th></tr></thead>`;
  const totalsHTML = (t, label) => `
    <div class="p-totals">
      ${label ? `<div style="font-weight:800; margin-bottom:4px;">${escapeHtml(label)}</div>` : ''}
      <div class="ln"><span>Subtotal</span><span>${formatMoney(t.subtotal, q.currency)}</span></div>
      <div class="ln"><span>VAT</span><span>${formatMoney(t.vatTotal, q.currency)}</span></div>
      <div class="ln"><span>Freight</span><span>${formatMoney(t.freight, q.currency)}</span></div>
      <div class="ln"><span>Other Charges</span><span>${formatMoney(t.other, q.currency)}</span></div>
      <div class="ln grand"><span>${label ? escapeHtml(label) + ' Total' : 'Grand Total'}</span><span>${formatMoney(t.grandTotal, q.currency)}</span></div>
    </div>`;

  let itemsAndTotalsHTML;
  if (q.isMultiOption && q.optionTotals && q.optionTotals.length > 0) {
    const commonLines = (q.lines || []).filter(l => (q.commonLineIds || []).includes(l.lineId));
    itemsAndTotalsHTML = `
      <p style="font-size:12px; font-style:italic; margin:10px 0;">This quotation presents ${q.optionTotals.length} alternative options — please select ONE. Prices below are not cumulative.</p>
      ${commonLines.length > 0 ? `<div style="font-weight:800; margin-top:10px;">Included with Every Option</div><table class="p-items">${itemsHead}<tbody>${commonLines.map((l, i) => rowHTML(l, i)).join('')}</tbody></table>` : ''}
      ${q.optionTotals.map(o => {
        const groupLines = (q.lines || []).filter(l => (o.lineIds || []).includes(l.lineId));
        return `<div style="font-weight:800; margin-top:14px; border-top:2px solid #151d2b; padding-top:8px;">${escapeHtml(o.label)}</div>
          <table class="p-items">${itemsHead}<tbody>${groupLines.map((l, i) => rowHTML(l, i)).join('')}</tbody></table>
          ${totalsHTML(o, o.label)}`;
      }).join('')}
    `;
  } else {
    itemsAndTotalsHTML = `
      <table class="p-items">${itemsHead}<tbody>${(q.lines || []).map((l, i) => rowHTML(l, i)).join('')}</tbody></table>
      ${totalsHTML(q, null)}
    `;
  }

  printShell(q.quotationNo, `
    <div class="p-head">
      ${coBlock(settings)}
      <div><div class="p-doc-title">Sales Quotation</div><div class="p-doc-no">${escapeHtml(q.quotationNo)}</div>
      <div class="p-dates">${q.rfqRef ? `Your Ref: ${escapeHtml(q.rfqRef)}<br>` : ''}Revision: ${padRev(q.revision)}<br>Date: ${formatDate(q.date)}<br>Valid Until: ${formatDate(q.validUntil)}</div></div>
    </div>
    <div class="p-grid2">
      <div><div class="p-label">Quote For</div><b>${escapeHtml(custName)}</b><br><span style="font-size:11px;color:#666;">${escapeHtml(custAddr)}</span>
        ${q.projectName ? `<br><span style="font-size:11px;">Project: ${escapeHtml(q.projectName)}</span>` : ''}
        ${q.endUser ? `<br><span style="font-size:11px;">End-User: ${escapeHtml(q.endUser)}</span>` : ''}
      </div>
      <div><div class="p-label">Terms</div>
        <div style="font-size:11px;">Payment: ${escapeHtml(q.paymentTerms || '—')}<br>Delivery: ${escapeHtml(q.deliveryLeadTime || '—')}<br>Incoterms: ${escapeHtml(q.incoterms || '—')}<br>Warranty: ${escapeHtml(q.warranty || '—')}</div>
      </div>
    </div>
    ${itemsAndTotalsHTML}
    ${q.customerNotes ? `<div class="p-terms"><b>Notes:</b>\n${escapeHtml(q.customerNotes)}</div>` : ''}
    <div class="p-terms">${escapeHtml(settings.footerTerms)}</div>
    <div class="p-sign">
      ${signatureBlockHTML(settings, 'Prepared by / Sales Representative')}
      <div class="box">Conforme / Customer Signature Over Printed Name</div>
    </div>
    <div class="p-foot">${escapeHtml(settings.companyName)} · System-generated document</div>
  `);
}

async function printSalesOrder(so, customer, customerPO, quotation) {
  const settings = await DB.getSettings();
  const rows = so.lines.map((l, i) => {
    const c = QuoteCalc.computeLine(l);
    return `<tr><td>${i + 1}</td><td>${escapeHtml(l.description)}</td><td class="p-num">${l.qty} ${escapeHtml(l.uom)}</td><td class="p-num">${formatMoney(l.unitPrice, so.currency)}</td><td class="p-num">${formatMoney(c.net, so.currency)}</td></tr>`;
  }).join('');
  const custPoNo = customerPO ? (customerPO.customerPoNumber || customerPO.poNo) : '';
  printShell(so.soNo, `
    <div class="p-head">${coBlock(settings)}
      <div><div class="p-doc-title">Sales Order / Order Confirmation</div><div class="p-doc-no">${escapeHtml(so.soNo)}</div>
      <div class="p-dates">${custPoNo ? `Your PO #: ${escapeHtml(custPoNo)}<br>` : ''}${quotation ? `Our Quotation Ref: ${escapeHtml(quotation.quotationNo)}<br>` : ''}Order Date: ${formatDate(so.orderDate)}${so.requiredDeliveryDate ? `<br>Required Delivery: ${formatDate(so.requiredDeliveryDate)}` : ''}</div></div>
    </div>
    <div class="p-grid2">
      <div><div class="p-label">Customer</div><b>${escapeHtml(customer?.companyName || '')}</b><br><span style="font-size:11px;">Ship To: ${escapeHtml(so.shippingAddress || '—')}</span></div>
      <div><div class="p-label">Terms</div><div style="font-size:11px;">Payment: ${escapeHtml(so.paymentTerms || '—')}<br>Incoterms: ${escapeHtml(so.incoterms || '—')}</div></div>
    </div>
    <table class="p-items"><thead><tr><th>#</th><th>Description</th><th>Qty</th><th>Unit Price</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="p-totals">
      <div class="ln"><span>Subtotal</span><span>${formatMoney(so.subtotal, so.currency)}</span></div>
      <div class="ln"><span>VAT</span><span>${formatMoney(so.vatTotal, so.currency)}</span></div>
      <div class="ln"><span>Freight</span><span>${formatMoney(so.freight || 0, so.currency)}</span></div>
      <div class="ln grand"><span>Grand Total</span><span>${formatMoney(so.grandTotal, so.currency)}</span></div>
    </div>
    ${bankDetailsHTML(settings)}
    <div class="p-sign">${signatureBlockHTML(settings, '')}<div class="box">Customer Acknowledgement</div></div>
    <div class="p-foot">${escapeHtml(settings.companyName)} · System-generated document</div>
  `);
}

async function printSupplierPO(po, supplier, salesOrder) {
  const settings = await DB.getSettings();
  const rows = po.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(l.description)}</td><td class="p-num">${l.qty} ${escapeHtml(l.uom)}</td><td class="p-num">${formatMoney(l.unitCost, po.currency)}</td><td class="p-num">${formatMoney(l.amount, po.currency)}</td></tr>`).join('');
  printShell(po.poNo, `
    <div class="p-head">${coBlock(settings)}
      <div><div class="p-doc-title">Purchase Order</div><div class="p-doc-no">${escapeHtml(po.poNo)}</div>
      <div class="p-dates">${po.supplierQuoteRef ? `Your Ref: ${escapeHtml(po.supplierQuoteRef)}<br>` : ''}${salesOrder ? `Our Ref: ${escapeHtml(salesOrder.soNo)}<br>` : ''}Date: ${formatDate(po.poDate)}<br>Expected Delivery: ${formatDate(po.expectedDeliveryDate) || '—'}</div></div>
    </div>
    <div class="p-grid2">
      <div><div class="p-label">Supplier</div><b>${escapeHtml(supplier?.companyName || '')}</b><br><span style="font-size:11px;color:#666;">${escapeHtml(supplier?.address || '')}</span></div>
      <div><div class="p-label">Terms</div><div style="font-size:11px;">Payment: ${escapeHtml(po.paymentTerms || '—')}<br>Incoterms: ${escapeHtml(po.incoterms || '—')}<br>Deliver To: ${escapeHtml(po.deliveryAddress || '—')}</div></div>
    </div>
    <table class="p-items"><thead><tr><th>#</th><th>Description</th><th>Qty</th><th>Unit Cost</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="p-totals">
      <div class="ln"><span>Freight</span><span>${formatMoney(po.freight, po.currency)}</span></div>
      <div class="ln"><span>Taxes</span><span>${formatMoney(po.taxes, po.currency)}</span></div>
      <div class="ln grand"><span>Total Purchase Cost</span><span>${formatMoney(po.totalCost, po.currency)}</span></div>
    </div>
    <div class="p-sign">${signatureBlockHTML(settings, 'Authorized by')}<div class="box">Supplier Acknowledgement</div></div>
    <div class="p-foot">${escapeHtml(settings.companyName)} · System-generated document</div>
  `);
}

async function printProformaInvoice(pi, so, customer) {
  const settings = await DB.getSettings();
  const custName = customer?.companyName || so?.customerSnapshot?.companyName || '';
  const custAddr = customer?.billingAddress || '';
  // Uses the PI's OWN snapshot (lines/totals/terms), not the Sales Order live — this invoice's
  // numbers are frozen as of when it was generated, exactly what payment tracking is anchored to.
  const rows = (pi.lines || []).map((l, i) => {
    const c = QuoteCalc.computeLine(l);
    return `<tr><td>${i + 1}</td><td>${escapeHtml((l.brand ? l.brand + ' — ' : '') + (l.modelNo ? l.modelNo + ' — ' : '') + l.description)}</td><td class="p-num">${l.qty} ${escapeHtml(l.uom)}</td><td class="p-num">${formatMoney(l.unitPrice, pi.currency)}</td><td class="p-num">${formatMoney(c.net, pi.currency)}</td></tr>`;
  }).join('');

  printShell(pi.piNo, `
    <div class="p-head">${coBlock(settings)}
      <div><div class="p-doc-title">PROFORMA INVOICE</div><div class="p-doc-no">${escapeHtml(pi.piNo)}</div>
      <div class="p-dates">Sales Order Ref: ${escapeHtml(so?.soNo || '—')}<br>Date: ${formatDate(pi.date)}</div></div>
    </div>
    <div class="p-grid2">
      <div><div class="p-label">Bill To</div><b>${escapeHtml(custName)}</b><br><span style="font-size:11px;color:#666;">${escapeHtml(custAddr)}</span></div>
      <div><div class="p-label">Terms</div><div style="font-size:11px;">Payment: ${escapeHtml(pi.paymentTerms || '—')}<br>Incoterms: ${escapeHtml(pi.incoterms || '—')}</div></div>
    </div>
    <table class="p-items"><thead><tr><th>#</th><th>Description</th><th>Qty</th><th>Unit Price</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="p-totals">
      <div class="ln"><span>Subtotal</span><span>${formatMoney(pi.subtotal, pi.currency)}</span></div>
      <div class="ln"><span>VAT</span><span>${formatMoney(pi.vatTotal, pi.currency)}</span></div>
      <div class="ln"><span>Freight</span><span>${formatMoney(pi.freight || 0, pi.currency)}</span></div>
      <div class="ln grand"><span>Total Amount Due</span><span>${formatMoney(pi.grandTotal, pi.currency)}</span></div>
    </div>
    ${pi.notes ? `<div class="p-terms"><b>Note</b>\n${escapeHtml(pi.notes)}</div>` : ''}
    ${bankDetailsHTML(settings)}
    <div class="p-terms" style="font-style:italic;">This is a Proforma Invoice for advance payment / reference purposes only. It is not an Official Receipt or a Sales Invoice for tax purposes.</div>
    <div class="p-sign">${signatureBlockHTML(settings, 'Authorized Signatory')}</div>
    <div class="p-foot">${escapeHtml(settings.companyName)} · System-generated document</div>
  `);
}

window.Print = { printQuotation, printSalesOrder, printSupplierPO, printProformaInvoice };
