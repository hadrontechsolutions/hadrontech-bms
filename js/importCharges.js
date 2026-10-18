/* ============================================================
   IMPORT CHARGE ESTIMATE (Philippines)
   Quotation-stage safety allowance for the extra charges that arrive AFTER we buy from a
   foreign supplier (customs processing, government fees, courier brokerage, and — on bigger
   parcels — duty and import VAT). Modelled on the real UPS bill for HT-SO-2026-0005.

   Rules (agreed with the owner):
   - Only lines whose COST currency is foreign (not PHP) are counted.
   - Only the ITEM cost (unit cost x qty) counts as the declared goods value. Freight is left out.
   - Item cost is converted with the rate already on the quotation line (the BMS rate, which is
     deliberately set higher as a safety allowance).
   - All foreign lines on ONE quotation are added together (parcels are combined at customs).
   - It is an ESTIMATE. Every amount below can be changed in Settings > Import Charges.
   The result is spread over the foreign lines (by item cost) and stored on each line as
   `importCharge`, in the quotation's currency, so Sales Orders, Order Profit, Gross Profit and
   Distributions pick it up through the normal line-cost maths.
   ============================================================ */
var IMPORT_CHARGE_DEFAULTS = {
  deMinimis: 10000,        // goods value (PHP) up to this = no duty / no import VAT
  smallPct: 2.5,           // processing charge on small shipments, % of declared value
  smallMin: 50,            // ...never less than this (PHP)
  govFees: 140,            // Customs Documentary Stamp 100 + BIR DST 30 + Legal Research Fund 10
  brokerage: 112.5,        // courier brokerage / disbursement fee per shipment
  brokerageVatPct: 12,     // VAT on the brokerage (service charge)
  dutyPct: 0,              // import duty % on goods over the limit (set per your HS code)
  importVatPct: 12,        // import VAT on landed value over the limit
  // processing charge for goods above the limit: [up to goods value (PHP), charge (PHP)]
  ipcBrackets: [[25000, 250], [50000, 500], [100000, 750], [250000, 1000], [500000, 1500], [Infinity, 2000]]
};

function importChargeSettings(settings) {
  const s = Object.assign({}, IMPORT_CHARGE_DEFAULTS, (settings && settings.importCharges) || {});
  ['deMinimis', 'smallPct', 'smallMin', 'govFees', 'brokerage', 'brokerageVatPct', 'dutyPct', 'importVatPct']
    .forEach(k => { s[k] = Number(s[k]) >= 0 ? Number(s[k]) : IMPORT_CHARGE_DEFAULTS[k]; });
  s.ipcBrackets = IMPORT_CHARGE_DEFAULTS.ipcBrackets;
  return s;
}

/** Is the estimate switched on for this quotation? Quotations saved before this feature existed
    have no setting and stay OFF, so their saved figures never change on their own. */
function importEstimateOn(q) { return !!(q && q.includeImportEstimate === true); }

/** Goods value of one line in PHP: item cost only (no freight); 0 for PHP-cost lines. */
function importGoodsPHP(l, quoteCurrency, settings) {
  if (l.lotRole === 'header') return 0;
  const ccy = l.costCurrency || quoteCurrency || 'PHP';
  if (ccy === 'PHP') return 0;
  const item = (Number(l.unitCost) || 0) * (Number(l.qty) || 0);
  if (item <= 0) return 0;
  const rate = (quoteCurrency === 'PHP' ? Number(l.costExchangeRate) : 0) || referenceRate(ccy, 'PHP', settings) || 1;
  return item * rate;
}

/** Estimate for a set of lines. Returns { goodsPHP, totalPHP, parts:[{label,amount}], perLinePHP:{lineId:amount}, mode }. */
function estimateImportCharges(lines, quoteCurrency, settings) {
  const cfg = importChargeSettings(settings);
  const r = n => Math.round(n * 100) / 100;
  const goodsByLine = {};
  let goods = 0;
  (lines || []).forEach(l => { const g = importGoodsPHP(l, quoteCurrency, settings); if (g > 0) { goodsByLine[l.lineId] = g; goods += g; } });
  goods = r(goods);
  const res = { goodsPHP: goods, totalPHP: 0, parts: [], perLinePHP: {}, mode: 'none', cfg };
  if (goods <= 0) return res;
  const parts = [];
  let total = 0;
  const add = (label, amt) => { amt = r(amt); if (amt > 0) { parts.push({ label, amount: amt }); total += amt; } };
  if (goods <= cfg.deMinimis) {
    res.mode = 'small';
    add(`Customs processing charge (${cfg.smallPct}% of goods, min ₱${cfg.smallMin})`, Math.max(goods * cfg.smallPct / 100, cfg.smallMin));
    add('Government fees (documentary stamp, BIR stamp, legal research fund)', cfg.govFees);
    add('Courier brokerage', cfg.brokerage);
    add(`VAT on brokerage (${cfg.brokerageVatPct}%)`, cfg.brokerage * cfg.brokerageVatPct / 100);
  } else {
    res.mode = 'large';
    const br = cfg.ipcBrackets.find(b => goods <= b[0]);
    const ipc = br ? br[1] : 2000;
    const duty = goods * cfg.dutyPct / 100;
    add('Customs processing charge', ipc);
    add('Government fees (documentary stamp, BIR stamp, legal research fund)', cfg.govFees);
    add(`Import duty (${cfg.dutyPct}% of goods)`, duty);
    add(`Import VAT (${cfg.importVatPct}% of goods + duty + processing charge)`, (goods + duty + ipc) * cfg.importVatPct / 100);
    add('Courier brokerage', cfg.brokerage);
    add(`VAT on brokerage (${cfg.brokerageVatPct}%)`, cfg.brokerage * cfg.brokerageVatPct / 100);
  }
  res.parts = parts; res.totalPHP = r(total);
  // spread over the foreign lines by item cost; rounding remainder goes to the biggest line
  const ids = Object.keys(goodsByLine);
  let given = 0, biggest = ids[0];
  ids.forEach(id => {
    const share = r(res.totalPHP * goodsByLine[id] / goods);
    res.perLinePHP[id] = share; given += share;
    if (goodsByLine[id] > goodsByLine[biggest]) biggest = id;
  });
  res.perLinePHP[biggest] = r(res.perLinePHP[biggest] + (res.totalPHP - given));
  return res;
}

/** Writes `importCharge` (quotation currency, total for the row) onto every line. Off = all zero.
    Returns the estimate (also when off, so the screen can show "would be about ..."). */
function applyImportEstimate(q, settings) {
  const quoteCcy = q.currency || 'PHP';
  const est = estimateImportCharges(q.lines || [], quoteCcy, settings);
  const toQuote = quoteCcy === 'PHP' ? 1 : (referenceRate(quoteCcy, 'PHP', settings) || 1);
  const on = importEstimateOn(q);
  (q.lines || []).forEach(l => {
    const php = est.perLinePHP[l.lineId] || 0;
    l.importCharge = on && php ? Math.round(php / toQuote * 100) / 100 : 0;
  });
  est.inQuoteCurrency = Math.round(est.totalPHP / toQuote * 100) / 100;
  est.on = on;
  return est;
}
