// Date parsing + AR-day computation. Handles Excel serial dates, ISO strings,
// US MM/DD/YYYY, and common variants.

/**
 * Parse an arbitrary cell value into a JS Date (UTC-normalized to midnight),
 * or null if it cannot be interpreted as a date.
 */
export function parseDate(value) {
  if (value === null || value === undefined || value === '') return null;

  // Already a Date
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : stripTime(value);
  }

  // Excel serial number (days since 1899-12-30). Reasonable range ~ 20000..60000.
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 20 && value < 80000) {
      const ms = Math.round((value - 25569) * 86400 * 1000);
      const d = new Date(ms);
      return Number.isNaN(d.getTime()) ? null : stripTime(d);
    }
    return null;
  }

  const s = String(value).trim();
  if (s === '') return null;

  // Numeric string that is actually an Excel serial
  if (/^\d{4,6}$/.test(s)) {
    const serial = Number(s);
    if (serial > 20 && serial < 80000) {
      const ms = Math.round((serial - 25569) * 86400 * 1000);
      const d = new Date(ms);
      if (!Number.isNaN(d.getTime())) return stripTime(d);
    }
  }

  // ISO or native-parseable
  const native = new Date(s);
  if (!Number.isNaN(native.getTime())) return stripTime(native);

  // MM/DD/YYYY or MM-DD-YYYY or MM/DD/YY
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    let [, mm, dd, yy] = m;
    let year = Number(yy);
    if (year < 100) year += year < 50 ? 2000 : 1900;
    const d = new Date(Date.UTC(year, Number(mm) - 1, Number(dd)));
    if (!Number.isNaN(d.getTime())) return d;
  }

  return null;
}

function stripTime(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Whole days between two dates (asOf - from). Negative clamped to 0. */
export function daysBetween(fromDate, asOf = new Date()) {
  if (!fromDate) return null;
  const a = stripTime(asOf).getTime();
  const b = stripTime(fromDate).getTime();
  const diff = Math.floor((a - b) / 86400000);
  return diff < 0 ? 0 : diff;
}

/** Format a date as "YYYY-MM" for month grouping. */
export function toMonthKey(d) {
  if (!d) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** Human-readable month label, e.g. "Mar 2025". */
export function toMonthLabel(monthKey) {
  if (!monthKey) return 'Unknown';
  const [y, m] = monthKey.split('-').map(Number);
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[m - 1]} ${y}`;
}
