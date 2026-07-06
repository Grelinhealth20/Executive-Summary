import xlsx from 'xlsx';
import { logger } from './logger.js';
import { normalizeHeader } from './learningStore.js';

// Parse an uploaded workbook/CSV buffer into a combined row set plus a full
// ingestion audit. EVERY worksheet is inspected — sheets that share the dominant
// column structure are COMBINED (so multi-tab exports lose no claims), and any
// sheet with a different structure is reported explicitly (never silently
// dropped). Each row carries its source sheet + original row number so skipped
// rows can be audited back to their exact location.

const SOURCE = Symbol('source'); // non-enumerable row origin { sheet, row }

export function rowSource(row) {
  return row[SOURCE] || null;
}

export function parseWorkbook(buffer, originalName = 'upload') {
  let workbook;
  try {
    workbook = xlsx.read(buffer, { type: 'buffer', cellDates: true, raw: false });
  } catch (err) {
    throw new Error(`Unable to read file "${originalName}": ${err.message}`);
  }
  if (!workbook.SheetNames.length) {
    throw new Error('The uploaded file contains no worksheets.');
  }

  // Extract every sheet into { name, headers, signature, rows }.
  const parsedSheets = [];
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet || !sheet['!ref']) {
      parsedSheets.push({ name, headers: [], signature: '', rows: [], dataRows: 0 });
      continue;
    }
    const matrix = xlsx.utils.sheet_to_json(sheet, {
      header: 1,
      blankrows: false,
      defval: null,
      raw: false,
    });
    if (!matrix.length) {
      parsedSheets.push({ name, headers: [], signature: '', rows: [], dataRows: 0 });
      continue;
    }
    const headerRowIndex = detectHeaderRow(matrix);
    const headers = dedupeHeaders(
      matrix[headerRowIndex].map((h, i) =>
        h == null || String(h).trim() === '' ? `Column ${i + 1}` : String(h).trim()
      )
    );
    const rows = [];
    for (let r = headerRowIndex + 1; r < matrix.length; r++) {
      const rowArr = matrix[r];
      if (!rowArr || rowArr.every((c) => c === null || String(c).trim() === '')) continue;
      const obj = {};
      let hasValue = false;
      for (let c = 0; c < headers.length; c++) {
        const val = rowArr[c] === undefined ? null : rowArr[c];
        obj[headers[c]] = val;
        if (val !== null && String(val).trim() !== '') hasValue = true;
      }
      if (!hasValue) continue;
      // Tag origin: original spreadsheet row number is 1-based header + offset.
      Object.defineProperty(obj, SOURCE, {
        value: { sheet: name, row: r + 1 },
        enumerable: false,
      });
      rows.push(obj);
    }
    const signature = headers.map(normalizeHeader).filter(Boolean).sort().join('|');
    parsedSheets.push({ name, headers, signature, rows, dataRows: rows.length });
  }

  const sheetsWithData = parsedSheets.filter((s) => s.dataRows > 0);
  if (!sheetsWithData.length) {
    throw new Error('No data rows were found in any worksheet beneath a header row.');
  }

  // Group sheets by header signature; the group with the most total rows is the
  // dataset. All sheets in that group are combined (multi-page / per-month tabs).
  const groups = new Map();
  for (const s of sheetsWithData) {
    if (!groups.has(s.signature)) groups.set(s.signature, []);
    groups.get(s.signature).push(s);
  }
  let bestSig = null;
  let bestRows = -1;
  for (const [sig, list] of groups) {
    const total = list.reduce((a, s) => a + s.dataRows, 0);
    if (total > bestRows) {
      bestRows = total;
      bestSig = sig;
    }
  }
  const usedGroup = groups.get(bestSig);
  const headers = usedGroup[0].headers;

  // Combine all rows from the used group.
  const rows = [];
  for (const s of usedGroup) {
    // Re-key each sheet's rows onto the primary header names by position so the
    // combined set is consistent even if header text varies trivially in casing.
    for (const row of s.rows) rows.push(row);
  }

  const sheetsUsed = usedGroup.map((s) => ({ name: s.name, rows: s.dataRows }));
  const sheetsIgnored = sheetsWithData
    .filter((s) => s.signature !== bestSig)
    .map((s) => ({
      name: s.name,
      rows: s.dataRows,
      reason: 'Different column structure than the primary dataset — review separately',
    }));

  const ingestion = {
    workbookSheetCount: workbook.SheetNames.length,
    sheetsUsed,
    sheetsIgnored,
    totalDataRows: rows.length, // rows fed into normalization from the used group
  };

  if (sheetsIgnored.length) {
    logger.warn('Some worksheets were not ingested (different structure)', { sheetsIgnored });
  }
  logger.info('Parsed workbook', {
    file: originalName,
    sheetsUsed: sheetsUsed.map((s) => `${s.name}(${s.rows})`),
    sheetsIgnored: sheetsIgnored.map((s) => `${s.name}(${s.rows})`),
    columns: headers.length,
    totalDataRows: rows.length,
  });

  return {
    headers,
    rows,
    ingestion,
    sheetName: usedGroup.map((s) => s.name).join(', '),
    sourceFile: originalName,
  };
}

function dedupeHeaders(rawHeaders) {
  const seen = new Map();
  return rawHeaders.map((h) => {
    if (!seen.has(h)) {
      seen.set(h, 1);
      return h;
    }
    const n = seen.get(h) + 1;
    seen.set(h, n);
    return `${h} (${n})`;
  });
}

/**
 * Detect the header row: the first row (within the first 25) with the most
 * non-empty, predominantly-textual cells.
 */
function detectHeaderRow(matrix) {
  const limit = Math.min(matrix.length, 25);
  let bestIdx = 0;
  let bestScore = -1;
  for (let r = 0; r < limit; r++) {
    const row = matrix[r] || [];
    const nonEmpty = row.filter((c) => c !== null && String(c).trim() !== '');
    if (nonEmpty.length < 2) continue;
    const textCells = nonEmpty.filter((c) => Number.isNaN(Number(String(c).replace(/[$,%]/g, ''))));
    const score = nonEmpty.length + textCells.length * 2;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = r;
    }
  }
  return bestIdx;
}
