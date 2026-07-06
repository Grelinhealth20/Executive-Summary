// Shared executive theme + low-level worksheet helpers for ExcelJS.

export const THEME = {
  navy: 'FF1F3864',
  navyLight: 'FF2E4A78',
  slate: 'FF44546A',
  teal: 'FF2A9D8F',
  gold: 'FFE9C46A',
  green: 'FF2E7D32',
  greenLight: 'FFE2EFDA',
  red: 'FFC0392B',
  redLight: 'FFFCE4E4',
  amber: 'FFB7791F',
  amberLight: 'FFFFF2CC',
  grayHeader: 'FFF2F2F2',
  zebra: 'FFF7F9FC',
  white: 'FFFFFFFF',
  border: 'FFBFBFBF',
};

export const FMT = {
  money: '$#,##0.00',
  moneyWhole: '$#,##0',
  pct: '0.0"%"',
  pct2: '0.00"%"',
  int: '#,##0',
  days: '#,##0',
  date: 'mmm dd, yyyy',
};

const thin = (color = THEME.border) => ({ style: 'thin', color: { argb: color } });

export function borderAll(color) {
  return { top: thin(color), left: thin(color), bottom: thin(color), right: thin(color) };
}

/** Sanitize a string into a valid, unique Excel sheet name (<=31 chars). */
export function sheetName(base, usedNames) {
  let name = String(base || 'Sheet')
    .replace(/[\\/*?:[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 31);
  if (!name) name = 'Sheet';
  let candidate = name;
  let i = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    const suffix = ` (${i})`;
    candidate = name.slice(0, 31 - suffix.length) + suffix;
    i++;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

/** Big section title bar spanning `span` columns. Returns next row index. */
export function titleBar(ws, row, text, span = 6, subtitle = '') {
  ws.mergeCells(row, 1, row, span);
  const cell = ws.getCell(row, 1);
  cell.value = text;
  cell.font = { name: 'Calibri', size: 16, bold: true, color: { argb: THEME.white } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: THEME.navy } };
  cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(row).height = 28;

  if (subtitle) {
    ws.mergeCells(row + 1, 1, row + 1, span);
    const sub = ws.getCell(row + 1, 1);
    sub.value = subtitle;
    sub.font = { name: 'Calibri', size: 10, italic: true, color: { argb: THEME.slate } };
    sub.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    return row + 3;
  }
  return row + 2;
}

/** Section sub-heading (smaller banner). Returns next row. */
export function subHeading(ws, row, text, span = 6) {
  ws.mergeCells(row, 1, row, span);
  const cell = ws.getCell(row, 1);
  cell.value = text;
  cell.font = { name: 'Calibri', size: 12, bold: true, color: { argb: THEME.white } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: THEME.slate } };
  cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(row).height = 20;
  return row + 1;
}

/**
 * Write a table with a styled header row + data rows.
 * columns: [{ header, key, width, fmt, align, total }]
 * data: array of objects keyed by column.key
 * options: { startRow, totalRow: bool, zebra: bool }
 * Returns { nextRow, headerRow, firstDataRow, lastDataRow }.
 */
export function writeTable(ws, columns, data, options = {}) {
  const startRow = options.startRow || 1;
  const headerRow = startRow;

  columns.forEach((col, idx) => {
    const c = idx + 1;
    const cell = ws.getCell(headerRow, c);
    cell.value = col.header;
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: THEME.white } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: THEME.navyLight } };
    cell.alignment = { vertical: 'middle', horizontal: col.align || 'left', wrapText: true };
    cell.border = borderAll();
    const column = ws.getColumn(c);
    if (col.width) column.width = col.width;
  });
  ws.getRow(headerRow).height = 22;

  let r = headerRow + 1;
  const firstDataRow = r;
  data.forEach((row, i) => {
    columns.forEach((col, idx) => {
      const c = idx + 1;
      const cell = ws.getCell(r, c);
      cell.value = row[col.key] === undefined ? null : row[col.key];
      cell.alignment = { vertical: 'middle', horizontal: col.align || 'left' };
      if (col.fmt) cell.numFmt = col.fmt;
      cell.border = borderAll();
      if (options.zebra !== false && i % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: THEME.zebra } };
      }
    });
    r++;
  });
  const lastDataRow = r - 1;

  if (options.totalRow && data.length) {
    columns.forEach((col, idx) => {
      const c = idx + 1;
      const cell = ws.getCell(r, c);
      if (idx === 0) {
        cell.value = options.totalLabel || 'TOTAL';
      } else if (col.total === 'sum') {
        cell.value = { formula: `SUM(${colLetter(c)}${firstDataRow}:${colLetter(c)}${lastDataRow})` };
      } else if (typeof col.total === 'number') {
        cell.value = col.total;
      } else {
        cell.value = null;
      }
      cell.font = { bold: true, color: { argb: THEME.white } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: THEME.navy } };
      cell.alignment = { vertical: 'middle', horizontal: col.align || 'left' };
      if (col.fmt) cell.numFmt = col.fmt;
      cell.border = borderAll();
    });
    r++;
  }

  return { nextRow: r + 1, headerRow, firstDataRow, lastDataRow };
}

export function colLetter(n) {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Add an in-cell data-bar "chart" over a numeric column range (real Excel visualization). */
export function addDataBar(ws, colIndex, firstRow, lastRow, color = THEME.teal) {
  if (lastRow < firstRow) return;
  const ref = `${colLetter(colIndex)}${firstRow}:${colLetter(colIndex)}${lastRow}`;
  ws.addConditionalFormatting({
    ref,
    rules: [
      {
        type: 'dataBar',
        cfvo: [{ type: 'min' }, { type: 'max' }],
        color: { argb: color },
        gradient: true,
      },
    ],
  });
}

/** A KPI "card": label on top row, big value below, with colored fill. */
export function kpiCard(ws, row, col, label, value, fmt, fill = THEME.navy) {
  ws.mergeCells(row, col, row, col + 1);
  const l = ws.getCell(row, col);
  l.value = label;
  l.font = { size: 9, bold: true, color: { argb: THEME.white } };
  l.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
  l.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  l.border = borderAll(fill);

  ws.mergeCells(row + 1, col, row + 1, col + 1);
  const v = ws.getCell(row + 1, col);
  v.value = value;
  if (fmt) v.numFmt = fmt;
  v.font = { size: 16, bold: true, color: { argb: THEME.white } };
  v.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
  v.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  v.border = borderAll(fill);
  ws.getRow(row + 1).height = 26;
}
