import { CANONICAL_FIELDS } from './schema.js';
import { parseMoney, parseInteger, round, sumMoney } from './util/num.js';
import { parseDate, daysBetween } from './util/dates.js';
import { rowSource } from './parser.js';

// Convert raw rows + column mapping into normalized, fully-typed claim records.
// Derives fields that are absent but computable (totalPayment, outstandingBalance,
// arDays), and flags each derivation so reconciliation can audit it.

function coerce(value, type) {
  switch (type) {
    case 'money':
      return parseMoney(value);
    case 'integer':
      return parseInteger(value);
    case 'date':
      return parseDate(value);
    case 'string':
    default: {
      if (value === null || value === undefined) return null;
      const s = String(value).trim();
      return s === '' ? null : s;
    }
  }
}

function cleanCpt(raw) {
  if (raw == null) return null;
  // CPT/HCPCS are 5 chars (e.g. 99214, G0463). Take first token, strip modifiers.
  const token = String(raw).trim().split(/[\s,;|]+/)[0];
  const m = token.match(/^[A-Za-z]?\d{4,5}[A-Za-z]?/);
  return (m ? m[0] : token).toUpperCase() || null;
}

function cleanPayer(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/\s+/g, ' ');
  return s === '' ? null : s;
}

export function normalizeRows(rows, mapping, options = {}) {
  const asOf = options.asOf || new Date();
  const records = [];
  const derived = {
    totalPaymentFromParts: 0,
    outstandingFromChargesLessPaidAdj: 0,
    arDaysFromServiceDate: 0,
  };
  const skipped = [];

  rows.forEach((row, index) => {
    const get = (field) => {
      const header = mapping[field];
      if (!header) return null;
      return coerce(row[header], CANONICAL_FIELDS[field].type);
    };

    const src = rowSource(row) || { sheet: '', row: index + 2 };
    const cpt = cleanCpt(get('cpt'));
    const payer = cleanPayer(get('payer')) || 'Unspecified Payer';
    const charges = get('charges');

    // A row must have a CPT and charges to be a valid billing line. Skipped rows
    // are recorded with their exact source location + reason (never silently
    // dropped) so ingestion is fully auditable.
    if (!cpt || charges === null) {
      const reasons = [];
      if (!cpt) reasons.push('missing/invalid CPT');
      if (charges === null) reasons.push('missing charge amount');
      skipped.push({
        sheet: src.sheet,
        rowNumber: src.row,
        reason: reasons.join(' & '),
        rawCpt: mapping.cpt ? row[mapping.cpt] ?? null : null,
        rawCharges: mapping.charges ? row[mapping.charges] ?? null : null,
        rawPayer: mapping.payer ? row[mapping.payer] ?? null : null,
      });
      return;
    }

    const primaryPayment = get('primaryPayment');
    const secondaryPayment = get('secondaryPayment');
    const patientPayment = get('patientPayment');
    let totalPayment = get('totalPayment');
    const allowedAmount = get('allowedAmount');
    const adjustment = get('adjustment');
    let outstandingBalance = get('outstandingBalance');
    let arDays = get('arDays');
    const serviceDate = get('serviceDate');
    const paymentPostedDate = get('paymentPostedDate');
    const denialReason = get('denialReason');
    const units = get('units');

    // Derive total payment if absent: sum of every collected component
    // (insurance primary + secondary + patient responsibility).
    let totalPaymentDerived = false;
    if (totalPayment === null) {
      if (primaryPayment !== null || secondaryPayment !== null || patientPayment !== null) {
        totalPayment = sumMoney([primaryPayment, secondaryPayment, patientPayment]);
        totalPaymentDerived = true;
        derived.totalPaymentFromParts++;
      } else {
        totalPayment = 0;
      }
    }

    // Derive outstanding balance if absent: charges - payments - adjustments.
    let outstandingDerived = false;
    if (outstandingBalance === null) {
      outstandingBalance = round(
        (charges || 0) - (totalPayment || 0) - (adjustment || 0),
        2
      );
      outstandingDerived = true;
      derived.outstandingFromChargesLessPaidAdj++;
    }

    // Derive AR days from service date if absent.
    let arDaysDerived = false;
    if (arDays === null && serviceDate) {
      arDays = daysBetween(serviceDate, asOf);
      arDaysDerived = true;
      derived.arDaysFromServiceDate++;
    }

    records.push({
      rowNumber: src.row,
      sourceSheet: src.sheet,
      claimId: get('claimId') || `ROW-${src.row}`,
      cpt,
      payer,
      charges: round(charges, 2),
      allowedAmount: allowedAmount === null ? null : round(allowedAmount, 2),
      primaryPayment: primaryPayment === null ? null : round(primaryPayment, 2),
      secondaryPayment: secondaryPayment === null ? null : round(secondaryPayment, 2),
      patientPayment: patientPayment === null ? null : round(patientPayment, 2),
      totalPayment: round(totalPayment || 0, 2),
      adjustment: adjustment === null ? null : round(adjustment, 2),
      outstandingBalance: round(outstandingBalance || 0, 2),
      arDays: arDays === null ? null : arDays,
      serviceDate,
      paymentPostedDate,
      denialReason,
      units: units === null ? null : units,
      _derived: { totalPaymentDerived, outstandingDerived, arDaysDerived },
    });
  });

  // Row conservation: every input row is either a record or an audited skip.
  return { records, derived, skipped, inputCount: rows.length };
}
