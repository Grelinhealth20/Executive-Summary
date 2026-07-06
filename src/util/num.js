// Deterministic numeric helpers. All money math is done in integer cents to avoid
// binary floating-point drift, then converted back to dollars for reporting.

/**
 * Parse an arbitrary cell value into a number of dollars.
 * Handles: "$1,234.56", "(45.00)" (accounting negative), "1234", 1234.5, "", null, "-".
 * Returns null when the value is genuinely absent/non-numeric so callers can
 * distinguish "0" from "missing".
 */
export function parseMoney(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  let s = String(value).trim();
  if (s === '' || s === '-' || s === '--' || s.toLowerCase() === 'n/a') return null;

  let negative = false;
  // Accounting-style parentheses => negative
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.trim().startsWith('-')) {
    negative = true;
  }

  // Strip currency symbols, thousands separators, spaces, stray characters.
  s = s.replace(/[^0-9.]/g, '');
  if (s === '' || s === '.') return null;

  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/** Parse a value into an integer (e.g. counts, AR days). Returns null if absent. */
export function parseInteger(value) {
  const n = parseMoney(value);
  if (n === null) return null;
  return Math.round(n);
}

/** Convert dollars to integer cents (banker-safe rounding to nearest cent). */
export function toCents(dollars) {
  if (dollars === null || dollars === undefined || !Number.isFinite(dollars)) return 0;
  return Math.round(dollars * 100);
}

/** Convert integer cents back to a dollars number rounded to 2dp. */
export function fromCents(cents) {
  return Math.round(cents) / 100;
}

/** Sum an array of dollar amounts precisely (via cents). null values are ignored. */
export function sumMoney(values) {
  let cents = 0;
  for (const v of values) {
    if (v === null || v === undefined) continue;
    cents += toCents(v);
  }
  return fromCents(cents);
}

/** Round a number to n decimal places deterministically. */
export function round(value, decimals = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/** Safe division: returns 0 when denominator is 0/absent. */
export function safeDivide(numerator, denominator) {
  if (!denominator) return 0;
  const r = numerator / denominator;
  return Number.isFinite(r) ? r : 0;
}

/** Percentage of part over whole, rounded to `decimals`. */
export function percent(part, whole, decimals = 2) {
  return round(safeDivide(part, whole) * 100, decimals);
}
