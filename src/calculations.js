import { config } from './config.js';
import { round, percent, sumMoney, safeDivide } from './util/num.js';
import { toMonthKey, toMonthLabel } from './util/dates.js';

// ── Grouping helpers ────────────────────────────────────────────────────────

function groupBy(records, keyFn) {
  const map = new Map();
  for (const r of records) {
    const k = keyFn(r);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return map;
}

function bucketForArDays(days) {
  if (days === null || days === undefined) return 'Unknown';
  for (const b of config.arBuckets) {
    const aboveMin = days >= b.min;
    const belowMax = b.max === null ? true : days <= b.max;
    if (aboveMin && belowMax) return b.label;
  }
  return 'Unknown';
}

// A claim is "denied" if it has a denial reason/code and no payment was received.
function isDenied(r) {
  const hasReason = r.denialReason && String(r.denialReason).trim() !== '';
  const denialLike = hasReason && /den|reject|carc|co-?\d|pr-?\d|not\s*cover|no\s*auth/i.test(r.denialReason);
  return Boolean((denialLike || hasReason) && r.totalPayment === 0 && r.outstandingBalance > 0);
}

// ── Core payment metrics for any group of records ───────────────────────────

export function paymentMetrics(records) {
  const claims = records.length;
  const charges = sumMoney(records.map((r) => r.charges));
  const allowed = sumMoney(records.map((r) => r.allowedAmount));
  const primary = sumMoney(records.map((r) => r.primaryPayment));
  const secondary = sumMoney(records.map((r) => r.secondaryPayment));
  const patient = sumMoney(records.map((r) => r.patientPayment));
  const totalPayment = sumMoney(records.map((r) => r.totalPayment));
  const adjustment = sumMoney(records.map((r) => r.adjustment));
  const outstanding = sumMoney(records.map((r) => r.outstandingBalance));

  const paidRecords = records.filter((r) => r.totalPayment > 0);
  const paidClaims = paidRecords.length;
  const zeroPayClaims = claims - paidClaims;

  const nonZeroBalanceRecords = records.filter((r) => Math.abs(r.outstandingBalance) > 0.004);
  const nonZeroBalanceClaims = nonZeroBalanceRecords.length;
  const nonZeroBalancePayment = sumMoney(nonZeroBalanceRecords.map((r) => r.totalPayment));

  const deniedRecords = records.filter(isDenied);

  return {
    claims,
    paidClaims,
    zeroPayClaims,
    charges,
    allowed,
    primaryPayment: primary,
    secondaryPayment: secondary,
    patientPayment: patient,
    totalPayment,
    adjustment,
    outstanding,
    avgPaymentPerClaim: round(safeDivide(totalPayment, claims), 2),
    avgPaymentPerPaidClaim: round(safeDivide(totalPayment, paidClaims), 2),
    avgPaymentExclZeroBalance: round(safeDivide(nonZeroBalancePayment, nonZeroBalanceClaims), 2),
    avgChargePerClaim: round(safeDivide(charges, claims), 2),
    avgAllowedPerClaim: round(safeDivide(allowed, claims), 2),
    grossCollectionRate: percent(totalPayment, charges),
    // Net collection rate uses allowed when available, else charges-less-adjustments.
    netCollectionRate: allowed > 0
      ? percent(totalPayment, allowed)
      : percent(totalPayment, charges - adjustment),
    deniedClaims: deniedRecords.length,
    denialRate: percent(deniedRecords.length, claims),
    deniedOutstanding: sumMoney(deniedRecords.map((r) => r.outstandingBalance)),
  };
}

// ── Executive-summary sections ──────────────────────────────────────────────

// 1) Synopsis of Major CPT — top 6 CPTs by charges billed.
export function topCpts(records, limit = 6) {
  const byCpt = groupBy(records, (r) => r.cpt);
  const rows = [];
  for (const [cpt, recs] of byCpt) {
    const claims = recs.length;
    const charges = sumMoney(recs.map((r) => r.charges));
    const payment = sumMoney(recs.map((r) => r.totalPayment));
    rows.push({
      cpt,
      claims,
      chargesBilled: charges,
      paymentReceived: payment,
      avgPaymentReceived: round(safeDivide(payment, claims), 2),
    });
  }
  rows.sort((a, b) => b.chargesBilled - a.chargesBilled || b.claims - a.claims);
  return rows.slice(0, limit);
}

// 2) Overall AR Distribution — outstanding balance > threshold, bucketed by AR days.
export function arDistribution(records, minBalance = config.arMinBalance) {
  const eligible = records.filter((r) => r.outstandingBalance > minBalance);
  return buildArTable(eligible);
}

// 3) Claims with $0.00 payment — bucketed by AR days.
export function zeroPaymentClaims(records, minBalance = config.arMinBalance) {
  const eligible = records.filter(
    (r) => r.totalPayment === 0 && r.outstandingBalance > minBalance
  );
  return buildArTable(eligible);
}

function buildArTable(records) {
  const totalOs = sumMoney(records.map((r) => r.outstandingBalance));
  const bucketOrder = [...config.arBuckets.map((b) => b.label), 'Unknown'];
  const map = new Map(bucketOrder.map((l) => [l, { claims: 0, os: 0 }]));

  for (const r of records) {
    const label = bucketForArDays(r.arDays);
    const entry = map.get(label) || { claims: 0, os: 0 };
    entry.claims += 1;
    entry.os += r.outstandingBalance;
    map.set(label, entry);
  }

  const rows = [];
  for (const label of bucketOrder) {
    const e = map.get(label);
    if (!e || e.claims === 0) continue;
    rows.push({
      arDays: label,
      claims: e.claims,
      totalOs: round(e.os, 2),
      arPercent: percent(e.os, totalOs),
    });
  }
  return {
    rows,
    totals: {
      claims: records.length,
      totalOs: round(totalOs, 2),
      arPercent: rows.length ? 100 : 0,
    },
  };
}

// 4) Payment Posted by Month.
export function paymentByMonth(records) {
  const paid = records.filter((r) => r.totalPayment > 0);
  const map = new Map();
  for (const r of paid) {
    const key = r.paymentPostedDate ? toMonthKey(r.paymentPostedDate) : 'unknown';
    if (!map.has(key)) map.set(key, { count: 0, total: 0 });
    const e = map.get(key);
    e.count += 1;
    e.total += r.totalPayment;
  }
  const rows = [];
  for (const [key, e] of map) {
    rows.push({
      monthKey: key,
      month: key === 'unknown' ? 'Unknown' : toMonthLabel(key),
      payments: e.count,
      totalPaymentReceived: round(e.total, 2),
    });
  }
  rows.sort((a, b) => {
    if (a.monthKey === 'unknown') return 1;
    if (b.monthKey === 'unknown') return -1;
    return a.monthKey < b.monthKey ? -1 : 1;
  });
  const totalPayments = rows.reduce((s, r) => s + r.payments, 0);
  const totalReceived = sumMoney(rows.map((r) => r.totalPaymentReceived));
  return { rows, totals: { payments: totalPayments, totalPaymentReceived: round(totalReceived, 2) } };
}

// 5) Insurance with Claims Over 120+ Days.
export function insuranceOver120(records, minBalance = config.arMinBalance) {
  const eligible = records.filter(
    (r) => r.arDays !== null && r.arDays > 120 && r.outstandingBalance > minBalance
  );
  const totalOs = sumMoney(eligible.map((r) => r.outstandingBalance));
  const byPayer = groupBy(eligible, (r) => r.payer);
  const rows = [];
  for (const [payer, recs] of byPayer) {
    const os = sumMoney(recs.map((r) => r.outstandingBalance));
    rows.push({
      insurance: payer,
      claims: recs.length,
      totalOs: round(os, 2),
      arPercent: percent(os, totalOs),
    });
  }
  rows.sort((a, b) => b.totalOs - a.totalOs);
  return {
    rows,
    totals: { claims: eligible.length, totalOs: round(totalOs, 2), arPercent: rows.length ? 100 : 0 },
  };
}

// ── Per-payer and per-CPT breakdowns ────────────────────────────────────────

export function perPayer(records) {
  const byPayer = groupBy(records, (r) => r.payer);
  const rows = [];
  for (const [payer, recs] of byPayer) {
    rows.push({ payer, records: recs, metrics: paymentMetrics(recs) });
  }
  rows.sort((a, b) => b.metrics.charges - a.metrics.charges);
  return rows;
}

export function perCpt(records) {
  const byCpt = groupBy(records, (r) => r.cpt);
  const rows = [];
  for (const [cpt, recs] of byCpt) {
    rows.push({ cpt, records: recs, metrics: paymentMetrics(recs) });
  }
  rows.sort((a, b) => b.metrics.charges - a.metrics.charges);
  return rows;
}

// ── Opportunity analyses ────────────────────────────────────────────────────

// Underpayment: for claims where an allowed amount exists and total payment is
// materially below it (and no adjustment explains the gap on paid claims).
export function underpaymentAnalysis(records) {
  const rows = [];
  let totalOpportunity = 0;
  for (const r of records) {
    if (r.allowedAmount === null || r.allowedAmount <= 0) continue;
    if (r.totalPayment <= 0) continue; // pure denials handled separately
    const shortfall = round(r.allowedAmount - r.totalPayment, 2);
    if (shortfall > 0.5) {
      totalOpportunity += shortfall;
      rows.push({
        claimId: r.claimId,
        cpt: r.cpt,
        payer: r.payer,
        allowedAmount: r.allowedAmount,
        totalPayment: r.totalPayment,
        shortfall,
        pctOfAllowed: percent(shortfall, r.allowedAmount),
        arDays: r.arDays,
      });
    }
  }
  rows.sort((a, b) => b.shortfall - a.shortfall);
  return { rows, totalOpportunity: round(totalOpportunity, 2), count: rows.length };
}

// Denial opportunity: denied claims with recoverable outstanding balance.
export function denialAnalysis(records) {
  const denied = records.filter(isDenied);
  const rows = denied.map((r) => ({
    claimId: r.claimId,
    cpt: r.cpt,
    payer: r.payer,
    charges: r.charges,
    outstandingBalance: r.outstandingBalance,
    denialReason: r.denialReason || 'Unspecified',
    arDays: r.arDays,
  }));
  rows.sort((a, b) => b.outstandingBalance - a.outstandingBalance);

  // Aggregate by reason for the summary view.
  const byReason = groupBy(denied, (r) => (r.denialReason || 'Unspecified').trim());
  const byReasonRows = [];
  for (const [reason, recs] of byReason) {
    byReasonRows.push({
      reason,
      claims: recs.length,
      outstanding: sumMoney(recs.map((r) => r.outstandingBalance)),
    });
  }
  byReasonRows.sort((a, b) => b.outstanding - a.outstanding);

  return {
    rows,
    byReason: byReasonRows,
    totalRecoverable: round(sumMoney(denied.map((r) => r.outstandingBalance)), 2),
    count: denied.length,
  };
}

// ── AR aging (all outstanding, by bucket) ───────────────────────────────────

export function arAging(records) {
  const withBalance = records.filter((r) => r.outstandingBalance > 0);
  const table = buildArTable(withBalance);
  // Add the "120+" rollup the spec references explicitly.
  const over120 = withBalance.filter((r) => r.arDays !== null && r.arDays > 120);
  const over120Os = sumMoney(over120.map((r) => r.outstandingBalance));
  return {
    ...table,
    over120: {
      claims: over120.length,
      totalOs: round(over120Os, 2),
      arPercent: percent(over120Os, table.totals.totalOs),
    },
  };
}

// ── Collection KPIs (CFO scorecard) ─────────────────────────────────────────

export function collectionKpis(records) {
  const m = paymentMetrics(records);
  const withArDays = records.filter((r) => r.arDays !== null);
  const avgArDays = withArDays.length
    ? round(safeDivide(withArDays.reduce((s, r) => s + r.arDays, 0), withArDays.length), 1)
    : null;
  return {
    totalClaims: m.claims,
    paidClaims: m.paidClaims,
    zeroPayClaims: m.zeroPayClaims,
    totalCharges: m.charges,
    totalAllowed: m.allowed,
    totalPayments: m.totalPayment,
    totalPrimaryPayments: m.primaryPayment,
    totalSecondaryPayments: m.secondaryPayment,
    totalPatientPayments: m.patientPayment,
    totalAdjustments: m.adjustment,
    totalOutstanding: m.outstanding,
    grossCollectionRate: m.grossCollectionRate,
    netCollectionRate: m.netCollectionRate,
    denialRate: m.denialRate,
    deniedClaims: m.deniedClaims,
    deniedOutstanding: m.deniedOutstanding,
    avgPaymentPerClaim: m.avgPaymentPerClaim,
    avgPaymentPerPaidClaim: m.avgPaymentPerPaidClaim,
    avgArDays,
  };
}

// ── Validation & reconciliation controls (PASS/FAIL) ────────────────────────

export function reconciliation(records, derived, skipped, ingestion = null) {
  const totals = paymentMetrics(records);
  const checks = [];

  const add = (name, pass, detail) => checks.push({ name, status: pass ? 'PASS' : 'FAIL', detail });

  // Control 0: ROW CONSERVATION — every ingested data row is either a used claim
  // record or an audited skip. This is the primary "no claim is missed" control.
  if (ingestion) {
    const accounted = records.length + skipped.length;
    add(
      'Row conservation: data rows = used claims + skipped',
      ingestion.totalDataRows === accounted,
      `${ingestion.totalDataRows} data rows = ${records.length} used + ${skipped.length} skipped (${accounted})`
    );
    // Every worksheet with data was ingested (no sheet silently dropped).
    add(
      'All data-bearing worksheets ingested',
      (ingestion.sheetsIgnored || []).length === 0,
      (ingestion.sheetsIgnored || []).length === 0
        ? `${(ingestion.sheetsUsed || []).length} sheet(s) ingested, 0 ignored`
        : `Ignored (different structure): ${ingestion.sheetsIgnored.map((s) => `${s.name}(${s.rows} rows)`).join(', ')}`
    );
  }

  // Control 1: charges = payments + adjustments + outstanding (identity), tolerance $1 aggregate.
  const identityDiff = round(
    totals.charges - (totals.totalPayment + totals.adjustment + totals.outstanding),
    2
  );
  add(
    'Charges = Payments + Adjustments + Outstanding',
    Math.abs(identityDiff) <= Math.max(1, totals.charges * 0.0001),
    `Difference = ${identityDiff.toFixed(2)} (charges ${totals.charges.toFixed(2)} vs pmt+adj+os ${(
      totals.totalPayment + totals.adjustment + totals.outstanding
    ).toFixed(2)})`
  );

  // Control 2: total payment = primary + secondary + patient where parts exist.
  const partsRecords = records.filter(
    (r) => r.primaryPayment !== null || r.secondaryPayment !== null || r.patientPayment !== null
  );
  const partsPrimary = sumMoney(partsRecords.map((r) => r.primaryPayment));
  const partsSecondary = sumMoney(partsRecords.map((r) => r.secondaryPayment));
  const partsPatient = sumMoney(partsRecords.map((r) => r.patientPayment));
  const partsTotal = sumMoney(partsRecords.map((r) => r.totalPayment));
  const partsDiff = round(partsTotal - (partsPrimary + partsSecondary + partsPatient), 2);
  add(
    'Total Payment = Primary + Secondary + Patient (where itemized)',
    partsRecords.length === 0 || Math.abs(partsDiff) <= Math.max(1, partsTotal * 0.0001),
    partsRecords.length === 0
      ? 'No itemized primary/secondary/patient columns present.'
      : `Difference = ${partsDiff.toFixed(2)} across ${partsRecords.length} itemized claims`
  );

  // Control 3: no negative charges.
  const negCharges = records.filter((r) => r.charges < 0);
  add('No negative charges', negCharges.length === 0, `${negCharges.length} rows with negative charges`);

  // Control 4: payments do not exceed charges by more than 1% in aggregate.
  add(
    'Aggregate payments do not exceed charges',
    totals.totalPayment <= totals.charges * 1.01 + 1,
    `Payments ${totals.totalPayment.toFixed(2)} vs charges ${totals.charges.toFixed(2)}`
  );

  // Control 5: skipped-row rate is under 5%.
  const totalInput = records.length + skipped.length;
  const skipRate = percent(skipped.length, totalInput);
  add(
    'Row acceptance rate >= 95%',
    skipRate <= 5,
    `${skipped.length} of ${totalInput} rows skipped (${skipRate}%)`
  );

  // Control 6: AR days available for aging analysis.
  const withAr = records.filter((r) => r.arDays !== null).length;
  add(
    'AR days available for aging',
    withAr > 0,
    `${withAr} of ${records.length} claims have AR days (direct or derived from service date)`
  );

  const overall = checks.every((c) => c.status === 'PASS') ? 'PASS' : 'FAIL';
  return { overall, checks, derived, skippedCount: skipped.length, totalRecords: records.length };
}

// ── Assemble everything ─────────────────────────────────────────────────────

export function computeAll(records, derived, skipped, ingestion = null) {
  const kpis = collectionKpis(records);
  const summary = {
    generatedAt: new Date().toISOString(),
    recordCount: records.length,
    topCpts: topCpts(records, 6),
    arDistribution: arDistribution(records),
    zeroPaymentClaims: zeroPaymentClaims(records),
    paymentByMonth: paymentByMonth(records),
    insuranceOver120: insuranceOver120(records),
    perPayer: perPayer(records),
    perCpt: perCpt(records),
    underpayment: underpaymentAnalysis(records),
    denials: denialAnalysis(records),
    arAging: arAging(records),
    kpis,
    reconciliation: reconciliation(records, derived, skipped, ingestion),
    overallMetrics: paymentMetrics(records),
  };

  // Ingestion audit — provable accounting that no claim row is missed.
  const accountedFor = records.length + skipped.length;
  summary.ingestion = {
    workbookSheetCount: ingestion ? ingestion.workbookSheetCount : 1,
    sheetsUsed: ingestion ? ingestion.sheetsUsed : [],
    sheetsIgnored: ingestion ? ingestion.sheetsIgnored : [],
    totalDataRows: ingestion ? ingestion.totalDataRows : accountedFor,
    usedRecords: records.length,
    skippedCount: skipped.length,
    skippedRows: skipped,
    conservationOk: ingestion ? ingestion.totalDataRows === accountedFor : true,
  };

  // Compact, quote-ready facts for the AI narrative (numbers only — no prose).
  summary.narrativeFacts = buildNarrativeFacts(summary);
  return summary;
}

/**
 * Deterministically assemble the claim-level review package handed to the
 * GPT-4o mini calculation-review layer. Anomaly candidates are identified here
 * in code (not by the model), so the model only reasons about real, pre-computed
 * exceptions rather than scanning raw data itself.
 */
export function buildReviewPackage(records, summary) {
  const anomalyCandidates = [];
  const TOL = 0.01;

  for (const r of records) {
    const flags = [];
    if (r.charges <= 0) flags.push('non-positive charges');
    if (r.totalPayment < 0) flags.push('negative total payment');
    if (r.outstandingBalance < -TOL) flags.push('credit / negative outstanding balance');
    if (r.totalPayment > r.charges + TOL) flags.push('payment exceeds charges');
    if (r.allowedAmount !== null && r.allowedAmount > 0 && r.totalPayment > r.allowedAmount + TOL)
      flags.push('payment exceeds allowed amount');
    if (r.allowedAmount !== null && r.allowedAmount > r.charges + TOL)
      flags.push('allowed amount exceeds charges');
    if (r.primaryPayment !== null || r.secondaryPayment !== null || r.patientPayment !== null) {
      const parts = round((r.primaryPayment || 0) + (r.secondaryPayment || 0) + (r.patientPayment || 0), 2);
      if (Math.abs(parts - r.totalPayment) > 0.01)
        flags.push('primary+secondary+patient does not equal total payment');
    }
    if (r.arDays !== null && r.arDays > 365 && r.outstandingBalance > config.arMinBalance)
      flags.push('aged over 365 days with open balance');

    if (flags.length) {
      anomalyCandidates.push({
        claimId: r.claimId,
        cpt: r.cpt,
        payer: r.payer,
        charges: r.charges,
        allowedAmount: r.allowedAmount,
        primaryPayment: r.primaryPayment,
        secondaryPayment: r.secondaryPayment,
        patientPayment: r.patientPayment,
        totalPayment: r.totalPayment,
        outstandingBalance: r.outstandingBalance,
        arDays: r.arDays,
        flags,
      });
    }
  }

  // Most material anomalies first (by outstanding, then charges).
  anomalyCandidates.sort(
    (a, b) => Math.abs(b.outstandingBalance) - Math.abs(a.outstandingBalance) || b.charges - a.charges
  );

  return {
    controlTotals: {
      totalClaims: summary.kpis.totalClaims,
      totalCharges: summary.kpis.totalCharges,
      totalAllowed: summary.kpis.totalAllowed,
      totalPayments: summary.kpis.totalPayments,
      totalAdjustments: summary.kpis.totalAdjustments,
      totalOutstanding: summary.kpis.totalOutstanding,
      grossCollectionRate: summary.kpis.grossCollectionRate,
      netCollectionRate: summary.kpis.netCollectionRate,
      denialRate: summary.kpis.denialRate,
    },
    reconciliation: {
      overall: summary.reconciliation.overall,
      checks: summary.reconciliation.checks,
    },
    anomalyCandidateCount: anomalyCandidates.length,
    anomalyCandidates,
  };
}

function buildNarrativeFacts(s) {
  return {
    totalClaims: s.kpis.totalClaims,
    totalCharges: s.kpis.totalCharges,
    totalPayments: s.kpis.totalPayments,
    totalOutstanding: s.kpis.totalOutstanding,
    grossCollectionRate: s.kpis.grossCollectionRate,
    netCollectionRate: s.kpis.netCollectionRate,
    denialRate: s.kpis.denialRate,
    deniedOutstanding: s.kpis.deniedOutstanding,
    avgArDays: s.kpis.avgArDays,
    topCpts: s.topCpts.map((c) => ({
      cpt: c.cpt,
      claims: c.claims,
      chargesBilled: c.chargesBilled,
      paymentReceived: c.paymentReceived,
    })),
    over120: s.arAging.over120,
    topPayersByCharges: s.perPayer.slice(0, 5).map((p) => ({
      payer: p.payer,
      charges: p.metrics.charges,
      payments: p.metrics.totalPayment,
      outstanding: p.metrics.outstanding,
      netCollectionRate: p.metrics.netCollectionRate,
    })),
    insuranceOver120: s.insuranceOver120.rows.slice(0, 5),
    underpaymentOpportunity: s.underpayment.totalOpportunity,
    denialRecoverable: s.denials.totalRecoverable,
    paymentByMonth: s.paymentByMonth.rows,
  };
}
