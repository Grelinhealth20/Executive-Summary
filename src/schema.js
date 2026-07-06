// Canonical claim schema. Every raw report — regardless of its column names — is
// mapped onto these fields. Each field carries synonyms used by the deterministic
// heuristic mapper and passed to GPT-4.1 as guidance for the adaptive mapper.

export const CANONICAL_FIELDS = {
  claimId: {
    label: 'Claim ID',
    type: 'string',
    required: false,
    synonyms: [
      'claim id', 'claim number', 'claim #', 'claim no', 'claimid', 'claim',
      'account', 'account number', 'acct', 'patient account', 'encounter', 'encounter id',
      'visit', 'visit id', 'reference', 'ref no', 'invoice', 'invoice number',
    ],
  },
  cpt: {
    label: 'CPT Code',
    type: 'string',
    required: true,
    synonyms: [
      'cpt', 'cpt code', 'cpt/hcpcs', 'hcpcs', 'procedure code', 'proc code',
      'procedure', 'service code', 'code', 'cpt4', 'cpt-4',
    ],
  },
  payer: {
    label: 'Insurance / Payer',
    type: 'string',
    required: true,
    synonyms: [
      'payer', 'payor', 'insurance', 'insurance name', 'insurance company', 'carrier',
      'plan', 'plan name', 'primary insurance', 'primary payer', 'responsible party',
      'ins', 'ins name', 'payer name',
    ],
  },
  charges: {
    label: 'Charges Billed',
    type: 'money',
    required: true,
    synonyms: [
      'charges', 'charge', 'charges billed', 'billed', 'billed amount', 'amount billed',
      'total charges', 'charge amount', 'gross charges', 'fee', 'billed charges',
    ],
  },
  allowedAmount: {
    label: 'Allowed Amount',
    type: 'money',
    required: false,
    synonyms: [
      'allowed', 'allowed amount', 'allowable', 'allowable amount', 'contracted amount',
      'contract amount', 'approved amount', 'allowed amt', 'expected', 'expected amount',
    ],
  },
  primaryPayment: {
    label: 'Primary (Insurance) Payment',
    type: 'money',
    required: false,
    synonyms: [
      'primary payment', 'primary paid', 'primary ins payment', 'insurance payment',
      'primary insurance payment', 'primary pmt', 'ins payment', 'ins pmt', 'ins paid',
      'insurance paid', 'insurance pmt', 'payer payment', 'payor payment', 'primary',
    ],
  },
  secondaryPayment: {
    label: 'Secondary Payment',
    type: 'money',
    required: false,
    synonyms: [
      'secondary payment', 'secondary paid', 'secondary ins payment', 'secondary pmt',
      'sec pmt', 'sec payment', 'secondary insurance payment', 'secondary',
    ],
  },
  // Patient responsibility actually collected (copay / coinsurance / patient paid).
  // Kept distinct from insurance payments so total collections are complete and
  // the charges = payments + adjustments + outstanding identity reconciles.
  patientPayment: {
    label: 'Patient Payment',
    type: 'money',
    required: false,
    synonyms: [
      'patient payment', 'patient paid', 'patient pmt', 'pt pmt', 'pt paid', 'pt payment',
      'patient responsibility paid', 'patient portion', 'patient pay', 'patient collected',
      'copay paid', 'co-pay paid', 'coinsurance paid', 'self pay', 'self-pay', 'guarantor payment',
    ],
  },
  totalPayment: {
    label: 'Total Payment',
    type: 'money',
    required: false,
    synonyms: [
      'payment', 'payments', 'paid', 'paid amount', 'total payment', 'total paid',
      'payment received', 'received', 'amount paid', 'total payments', 'net payment',
      'total collected', 'total collections', 'pmt', 'payment amount',
    ],
  },
  adjustment: {
    label: 'Adjustment / Write-off',
    type: 'money',
    required: false,
    synonyms: [
      'adjustment', 'adjustments', 'write off', 'write-off', 'writeoff', 'contractual adjustment',
      'contractual', 'adj', 'total adjustment',
    ],
  },
  outstandingBalance: {
    label: 'Outstanding Balance',
    type: 'money',
    required: false,
    synonyms: [
      'balance', 'outstanding', 'outstanding balance', 'o/s', 'os', 'ar', 'a/r',
      'ar balance', 'a/r balance', 'open balance', 'current balance', 'amount due',
      'insurance balance', 'patient balance', 'remaining balance', 'total o/s', 'os balance',
    ],
  },
  arDays: {
    label: 'A/R Days',
    type: 'integer',
    required: false,
    synonyms: [
      'ar days', 'a/r days', 'days', 'aging', 'aging days', 'age', 'days outstanding',
      'days in ar', 'days in a/r', 'claim age', 'dso',
    ],
  },
  serviceDate: {
    label: 'Date of Service',
    type: 'date',
    required: false,
    synonyms: [
      'dos', 'date of service', 'service date', 'svc date', 'from date', 'from dos',
      'service from', 'date', 'visit date', 'encounter date',
    ],
  },
  paymentPostedDate: {
    label: 'Payment Posted Date',
    type: 'date',
    required: false,
    synonyms: [
      'payment posted date', 'posted date', 'post date', 'payment date', 'paid date',
      'date posted', 'posting date', 'era date', 'deposit date', 'check date',
    ],
  },
  denialReason: {
    label: 'Denial Reason / Code',
    type: 'string',
    required: false,
    synonyms: [
      'denial', 'denial reason', 'denial code', 'denied', 'denial description',
      'carc', 'reason code', 'adjustment reason', 'status', 'claim status', 'remark',
      'remark code', 'rejection reason',
    ],
  },
  units: {
    label: 'Units',
    type: 'integer',
    required: false,
    synonyms: ['units', 'unit', 'qty', 'quantity', 'service units', 'days/units'],
  },
};

export const CANONICAL_KEYS = Object.keys(CANONICAL_FIELDS);

export const REQUIRED_KEYS = CANONICAL_KEYS.filter((k) => CANONICAL_FIELDS[k].required);
