import ExcelJS from 'exceljs';
import { config } from '../config.js';
import {
  THEME, FMT, sheetName, titleBar, subHeading, writeTable, addDataBar, kpiCard, colLetter, borderAll,
} from './style.js';

// Claim-level detail column definition (used on payer/CPT/dedicated sheets).
const CLAIM_COLUMNS = [
  { header: 'Claim ID', key: 'claimId', width: 18, align: 'left' },
  { header: 'CPT', key: 'cpt', width: 10, align: 'center' },
  { header: 'Payer', key: 'payer', width: 26, align: 'left' },
  { header: 'Date of Service', key: 'serviceDate', width: 14, align: 'center', fmt: FMT.date },
  { header: 'Charges Billed', key: 'charges', width: 15, align: 'right', fmt: FMT.money, total: 'sum' },
  { header: 'Allowed Amount', key: 'allowedAmount', width: 15, align: 'right', fmt: FMT.money, total: 'sum' },
  { header: 'Primary Payment', key: 'primaryPayment', width: 15, align: 'right', fmt: FMT.money, total: 'sum' },
  { header: 'Secondary Payment', key: 'secondaryPayment', width: 15, align: 'right', fmt: FMT.money, total: 'sum' },
  { header: 'Patient Payment', key: 'patientPayment', width: 15, align: 'right', fmt: FMT.money, total: 'sum' },
  { header: 'Total Payment', key: 'totalPayment', width: 15, align: 'right', fmt: FMT.money, total: 'sum' },
  { header: 'Adjustment', key: 'adjustment', width: 14, align: 'right', fmt: FMT.money, total: 'sum' },
  { header: 'Outstanding', key: 'outstandingBalance', width: 14, align: 'right', fmt: FMT.money, total: 'sum' },
  { header: 'A/R Days', key: 'arDays', width: 10, align: 'center', fmt: FMT.days },
  { header: 'Payment Posted', key: 'paymentPostedDate', width: 14, align: 'center', fmt: FMT.date },
  { header: 'Denial Reason', key: 'denialReason', width: 24, align: 'left' },
];

function claimRows(records) {
  return records.map((r) => ({
    claimId: r.claimId,
    cpt: r.cpt,
    payer: r.payer,
    serviceDate: r.serviceDate,
    charges: r.charges,
    allowedAmount: r.allowedAmount,
    primaryPayment: r.primaryPayment,
    secondaryPayment: r.secondaryPayment,
    patientPayment: r.patientPayment,
    totalPayment: r.totalPayment,
    adjustment: r.adjustment,
    outstandingBalance: r.outstandingBalance,
    arDays: r.arDays,
    paymentPostedDate: r.paymentPostedDate,
    denialReason: r.denialReason,
  }));
}

// Metrics block rendered at the top of each payer/CPT sheet.
function metricsBlock(ws, startRow, metrics, span) {
  const rows = [
    ['# of Claims', metrics.claims, FMT.int],
    ['# of Paid Claims', metrics.paidClaims, FMT.int],
    ['# of Zero-Payment Claims', metrics.zeroPayClaims, FMT.int],
    ['Charges Billed', metrics.charges, FMT.money],
    ['Allowed Amount', metrics.allowed, FMT.money],
    ['Primary Payment', metrics.primaryPayment, FMT.money],
    ['Secondary Payment', metrics.secondaryPayment, FMT.money],
    ['Patient Payment', metrics.patientPayment, FMT.money],
    ['Total Payment', metrics.totalPayment, FMT.money],
    ['Adjustments', metrics.adjustment, FMT.money],
    ['Outstanding Balance', metrics.outstanding, FMT.money],
    ['Avg Payment / Claim', metrics.avgPaymentPerClaim, FMT.money],
    ['Avg Payment / Paid Claim', metrics.avgPaymentPerPaidClaim, FMT.money],
    ['Avg Payment* (excl. zero-balance)', metrics.avgPaymentExclZeroBalance, FMT.money],
    ['Gross Collection Rate', metrics.grossCollectionRate, FMT.pct],
    ['Net Collection Rate', metrics.netCollectionRate, FMT.pct],
    ['Denied Claims', metrics.deniedClaims, FMT.int],
    ['Denial Rate', metrics.denialRate, FMT.pct],
    ['Denied Outstanding', metrics.deniedOutstanding, FMT.money],
  ];
  let r = startRow;
  rows.forEach(([label, value, fmt], i) => {
    const lc = ws.getCell(r, 1);
    lc.value = label;
    lc.font = { bold: true, color: { argb: THEME.slate } };
    lc.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    lc.border = borderAll();
    ws.mergeCells(r, 1, r, 2);

    const vc = ws.getCell(r, 3);
    vc.value = value;
    vc.numFmt = fmt;
    vc.alignment = { vertical: 'middle', horizontal: 'right' };
    vc.font = { bold: true };
    vc.border = borderAll();
    if (i % 2 === 1) {
      lc.fill = vc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: THEME.zebra } };
    }
    r++;
  });
  return r + 1;
}

function footer(ws, row, span) {
  ws.mergeCells(row, 1, row, span);
  const c = ws.getCell(row, 1);
  c.value = '* Avg Payment (excl. zero-balance) averages payments across claims that still carry an outstanding balance. All figures computed deterministically; see the Read Me / Methodology tab.';
  c.font = { italic: true, size: 8, color: { argb: THEME.slate } };
  c.alignment = { wrapText: true, vertical: 'top' };
}

// ── Individual sheet builders ───────────────────────────────────────────────

function buildCover(wb, meta, narrative) {
  const ws = wb.addWorksheet('Cover', { properties: { tabColor: { argb: THEME.navy } } });
  ws.getColumn(1).width = 4;
  ws.getColumn(2).width = 30;
  ws.getColumn(3).width = 30;
  ws.getColumn(4).width = 30;
  ws.getColumn(5).width = 30;

  ws.mergeCells(2, 2, 4, 5);
  const t = ws.getCell(2, 2);
  t.value = 'Executive Summary & Revenue Cycle Report';
  t.font = { size: 24, bold: true, color: { argb: THEME.navy } };
  t.alignment = { vertical: 'middle', horizontal: 'left' };

  const info = [
    ['Prepared for', meta.provider || 'Provider'],
    ['Source file', meta.sourceFile || 'N/A'],
    ['Generated', new Date(meta.generatedAt).toLocaleString('en-US')],
    ['Claims analyzed', meta.recordCount],
    ['Processing engine', `${meta.model} (adaptive mapping) + deterministic calculation core`],
    ['Reconciliation', meta.reconciliationStatus],
  ];
  let r = 6;
  info.forEach(([k, v]) => {
    const kc = ws.getCell(r, 2);
    kc.value = k;
    kc.font = { bold: true, color: { argb: THEME.slate } };
    const vc = ws.getCell(r, 3);
    ws.mergeCells(r, 3, r, 5);
    vc.value = v;
    vc.alignment = { horizontal: 'left' };
    r++;
  });

  r += 1;
  if (narrative?.headline) {
    ws.mergeCells(r, 2, r, 5);
    const h = ws.getCell(r, 2);
    h.value = narrative.headline;
    h.font = { size: 13, bold: true, italic: true, color: { argb: THEME.teal } };
    h.alignment = { wrapText: true, vertical: 'top' };
    ws.getRow(r).height = 40;
  }
  ws.views = [{ showGridLines: false }];
  return ws;
}

function buildReadMe(wb, meta, mappingTrace, columnMapping) {
  const ws = wb.addWorksheet('Read Me · Methodology', { properties: { tabColor: { argb: THEME.slate } } });
  ws.getColumn(1).width = 3;
  ws.getColumn(2).width = 40;
  ws.getColumn(3).width = 80;
  let r = titleBar(ws, 1, 'Read Me / Methodology', 5);

  const sections = [
    ['Purpose', 'This workbook delivers a CFO-ready executive summary plus full revenue-cycle detail derived from the uploaded raw claims report.'],
    ['Calculation integrity', 'ALL financial figures are computed deterministically in code using integer-cent arithmetic (no floating-point drift). The GPT-4.1 model is used ONLY to (a) map raw column headers to canonical fields and (b) write the narrative from already-computed numbers. The model never performs arithmetic.'],
    ['Column mapping', `Mapping sources for this file: ${(mappingTrace.source || []).join(' → ')}. AI mapping used: ${mappingTrace.aiUsed ? `yes (confidence ${mappingTrace.aiConfidence})` : 'no'}. Recognized as known template: ${mappingTrace.templateRecall ? 'yes' : 'no'}.`],
    ['Adaptive learning', 'Each processed file reinforces a persistent learning store (header→field associations and full-template signatures), so recurring report layouts are recognized instantly and mapping accuracy improves over time.'],
    ['Total Payment', 'Taken directly from the source when present; otherwise derived as Primary + Secondary + Patient Payment.'],
    ['Outstanding Balance', 'Taken directly when present; otherwise derived as Charges − Total Payment − Adjustments.'],
    ['A/R Days', 'Taken directly when present; otherwise computed as (report date − Date of Service).'],
    ['AR Distribution', `Includes only claims with an outstanding balance greater than $${config.arMinBalance}, bucketed by A/R days: ${config.arBuckets.map((b) => b.label).join(', ')}.`],
    ['Top CPTs', 'The six CPT codes with the highest charges billed.'],
    ['Denials', 'A claim is treated as denied when it carries a denial/reason code, has zero payment, and retains an outstanding balance.'],
    ['Underpayment opportunity', 'For paid claims with a known allowed amount, the shortfall = Allowed − Total Payment (only positive shortfalls > $0.50 are reported).'],
    ['Gross Collection Rate', 'Total Payment ÷ Charges Billed.'],
    ['Net Collection Rate', 'Total Payment ÷ Allowed Amount when allowed amounts exist; otherwise Total Payment ÷ (Charges − Adjustments).'],
    ['Avg Payment* (excl. zero-balance)', 'Average of Total Payment across claims that still carry an outstanding balance.'],
    ['Reconciliation', 'PASS/FAIL controls verify accounting identities (e.g., Charges = Payments + Adjustments + Outstanding) within tolerance. See the Validation tab.'],
  ];
  sections.forEach(([k, v]) => {
    const kc = ws.getCell(r, 2);
    kc.value = k;
    kc.font = { bold: true, color: { argb: THEME.navy } };
    kc.alignment = { vertical: 'top', wrapText: true };
    const vc = ws.getCell(r, 3);
    vc.value = v;
    vc.alignment = { vertical: 'top', wrapText: true };
    ws.getRow(r).height = Math.max(18, Math.ceil(v.length / 90) * 15);
    r++;
  });

  r += 1;
  r = subHeading(ws, r, 'Resolved Column Mapping', 5);
  const mapRows = Object.entries(columnMapping).map(([field, header]) => ({
    field,
    header: header || '— (not present / derived) —',
  }));
  writeTable(
    ws,
    [
      { header: 'Canonical Field', key: 'field', width: 40, align: 'left' },
      { header: 'Mapped From Raw Column', key: 'header', width: 80, align: 'left' },
    ],
    mapRows,
    { startRow: r }
  );
  ws.views = [{ showGridLines: false }];
  return ws;
}

function buildDashboard(wb, s, narrative) {
  const ws = wb.addWorksheet('Executive Dashboard', { properties: { tabColor: { argb: THEME.teal } } });
  for (let c = 1; c <= 8; c++) ws.getColumn(c).width = 16;
  let r = titleBar(ws, 1, 'Executive Summary Dashboard', 8, 'CFO-ready revenue cycle overview');

  // KPI cards row
  const k = s.kpis;
  kpiCard(ws, r, 1, 'TOTAL CHARGES', k.totalCharges, FMT.money, THEME.navy);
  kpiCard(ws, r, 3, 'TOTAL PAYMENTS', k.totalPayments, FMT.money, THEME.teal);
  kpiCard(ws, r, 5, 'OUTSTANDING A/R', k.totalOutstanding, FMT.money, THEME.amber);
  kpiCard(ws, r, 7, 'NET COLLECTION', k.netCollectionRate, FMT.pct, THEME.green);
  r += 3;
  kpiCard(ws, r, 1, 'TOTAL CLAIMS', k.totalClaims, FMT.int, THEME.slate);
  kpiCard(ws, r, 3, 'GROSS COLLECTION', k.grossCollectionRate, FMT.pct, THEME.navyLight);
  kpiCard(ws, r, 5, 'DENIAL RATE', k.denialRate, FMT.pct, THEME.red);
  kpiCard(ws, r, 7, 'AVG A/R DAYS', k.avgArDays ?? 0, FMT.days, THEME.slate);
  r += 4;

  // Narrative
  if (narrative) {
    r = subHeading(ws, r, 'Executive Narrative', 8);
    const blocks = [
      ['Bottom line', narrative.headline],
      ['Overview', narrative.overview],
    ];
    blocks.forEach(([label, text]) => {
      if (!text) return;
      const lc = ws.getCell(r, 1);
      lc.value = label;
      lc.font = { bold: true, color: { argb: THEME.navy } };
      ws.mergeCells(r, 2, r, 8);
      const vc = ws.getCell(r, 2);
      vc.value = text;
      vc.alignment = { wrapText: true, vertical: 'top' };
      ws.getRow(r).height = Math.max(18, Math.ceil(text.length / 100) * 15);
      r++;
    });
    const lists = [
      ['Key Findings', narrative.keyFindings],
      ['Risks & Exposure', narrative.risks],
      ['Recommendations', narrative.recommendations],
    ];
    lists.forEach(([label, items]) => {
      if (!items || !items.length) return;
      r++;
      const hc = ws.getCell(r, 1);
      ws.mergeCells(r, 1, r, 8);
      hc.value = label;
      hc.font = { bold: true, color: { argb: THEME.teal }, size: 12 };
      r++;
      items.forEach((it) => {
        ws.mergeCells(r, 1, r, 8);
        const c = ws.getCell(r, 1);
        c.value = `•  ${it}`;
        c.alignment = { wrapText: true, vertical: 'top', indent: 1 };
        ws.getRow(r).height = Math.max(16, Math.ceil(String(it).length / 110) * 15);
        r++;
      });
    });
    r += 1;
  }

  // Top CPT chart (data bars)
  r = subHeading(ws, r, 'Synopsis of Major CPTs (Top 6 by Charges Billed)', 8);
  const cptCols = [
    { header: 'CPT', key: 'cpt', width: 12, align: 'center' },
    { header: '# of Claims', key: 'claims', width: 14, align: 'right', fmt: FMT.int, total: 'sum' },
    { header: 'Charges Billed', key: 'chargesBilled', width: 18, align: 'right', fmt: FMT.money, total: 'sum' },
    { header: 'Payment Received', key: 'paymentReceived', width: 18, align: 'right', fmt: FMT.money, total: 'sum' },
    { header: 'Avg Payment Received', key: 'avgPaymentReceived', width: 20, align: 'right', fmt: FMT.money },
  ];
  const cptTable = writeTable(ws, cptCols, s.topCpts, { startRow: r, totalRow: true });
  addDataBar(ws, 3, cptTable.firstDataRow, cptTable.lastDataRow, THEME.teal);
  r = cptTable.nextRow;

  // Insurance over 120 (data bars)
  r = subHeading(ws, r, 'Insurance with Claims Over 120+ Days', 8);
  const insCols = [
    { header: 'Insurance', key: 'insurance', width: 32, align: 'left' },
    { header: '# of Claims', key: 'claims', width: 14, align: 'right', fmt: FMT.int, total: 'sum' },
    { header: 'Total O/S', key: 'totalOs', width: 16, align: 'right', fmt: FMT.money, total: 'sum' },
    { header: 'AR %', key: 'arPercent', width: 12, align: 'right', fmt: FMT.pct },
  ];
  const insData = s.insuranceOver120.rows;
  if (insData.length) {
    const insTable = writeTable(ws, insCols, insData, { startRow: r, totalRow: true });
    addDataBar(ws, 3, insTable.firstDataRow, insTable.lastDataRow, THEME.amber);
    r = insTable.nextRow;
  } else {
    ws.getCell(r, 1).value = 'No claims over 120 days with a balance above threshold.';
    r += 2;
  }

  ws.views = [{ showGridLines: false, state: 'frozen', ySplit: 2 }];
  return ws;
}

function buildExecSummarySheet(wb, s) {
  const ws = wb.addWorksheet('Executive Summary', { properties: { tabColor: { argb: THEME.navy } } });
  for (let c = 1; c <= 6; c++) ws.getColumn(c).width = 18;
  ws.getColumn(1).width = 22;
  let r = titleBar(ws, 1, 'Executive Summary', 6, `Generated ${new Date(s.generatedAt).toLocaleString('en-US')}`);

  // 1. Synopsis of Major CPT
  r = subHeading(ws, r, 'Synopsis of Major CPT (Top 6 CPTs)', 6);
  r = writeTable(ws, [
    { header: 'CPT', key: 'cpt', width: 14, align: 'center' },
    { header: '# of Claims', key: 'claims', width: 14, align: 'right', fmt: FMT.int, total: 'sum' },
    { header: 'Charges Billed', key: 'chargesBilled', width: 18, align: 'right', fmt: FMT.money, total: 'sum' },
    { header: 'Payment Received', key: 'paymentReceived', width: 18, align: 'right', fmt: FMT.money, total: 'sum' },
    { header: 'Avg Payment Received', key: 'avgPaymentReceived', width: 20, align: 'right', fmt: FMT.money },
  ], s.topCpts, { startRow: r, totalRow: true }).nextRow;

  // 2. Overall AR Distribution
  r = subHeading(ws, r, `Overall AR Distribution (Outstanding Balance > $${config.arMinBalance})`, 6);
  r = writeArTable(ws, r, s.arDistribution);

  // 3. Claims with $0.00 payment
  r = subHeading(ws, r, 'Claims with $0.00 Payment', 6);
  r = writeArTable(ws, r, s.zeroPaymentClaims);

  // 4. Payment Posted by Month
  r = subHeading(ws, r, 'Payment Posted by Month', 6);
  r = writeTable(ws, [
    { header: 'Payment Posted Month', key: 'month', width: 22, align: 'left' },
    { header: '# of Payments', key: 'payments', width: 16, align: 'right', fmt: FMT.int, total: 'sum' },
    { header: 'Total Payment Received', key: 'totalPaymentReceived', width: 22, align: 'right', fmt: FMT.money, total: 'sum' },
  ], s.paymentByMonth.rows, { startRow: r, totalRow: true }).nextRow;

  // 5. Insurance over 120 days
  r = subHeading(ws, r, 'Insurance with Claims Over 120+ Days', 6);
  r = writeTable(ws, [
    { header: 'Insurance', key: 'insurance', width: 32, align: 'left' },
    { header: '# of Claims', key: 'claims', width: 14, align: 'right', fmt: FMT.int, total: 'sum' },
    { header: 'Total O/S', key: 'totalOs', width: 16, align: 'right', fmt: FMT.money, total: 'sum' },
    { header: 'AR %', key: 'arPercent', width: 12, align: 'right', fmt: FMT.pct },
  ], s.insuranceOver120.rows, { startRow: r, totalRow: true }).nextRow;

  ws.views = [{ showGridLines: false }];
  return ws;
}

function writeArTable(ws, startRow, table) {
  const res = writeTable(ws, [
    { header: 'A/R Days', key: 'arDays', width: 16, align: 'left' },
    { header: '# of Claims', key: 'claims', width: 14, align: 'right', fmt: FMT.int, total: 'sum' },
    { header: 'Total O/S', key: 'totalOs', width: 16, align: 'right', fmt: FMT.money, total: 'sum' },
    { header: 'AR %', key: 'arPercent', width: 12, align: 'right', fmt: FMT.pct },
  ], table.rows, { startRow, totalRow: true });
  addDataBar(ws, 3, res.firstDataRow, res.lastDataRow, THEME.navyLight);
  return res.nextRow;
}

function buildGroupSheet(wb, usedNames, title, tabColor, group) {
  const name = sheetName(title, usedNames);
  const ws = wb.addWorksheet(name, { properties: { tabColor: { argb: tabColor } } });
  let r = titleBar(ws, 1, title, CLAIM_COLUMNS.length, `${group.metrics.claims} claims`);

  // Claim-Level Detail is placed FIRST so the frozen split stays near the top of
  // the sheet (only the title + column header are frozen). This keeps the header
  // sticky while every claim row scrolls freely — previously the 18-row metrics
  // block pushed the frozen split down to row 25, which made the sheet feel stuck.
  r = subHeading(ws, r, 'Claim-Level Detail', CLAIM_COLUMNS.length);
  const table = writeTable(ws, CLAIM_COLUMNS, claimRows(group.records), {
    startRow: r,
    totalRow: true,
    zebra: true,
  });
  ws.autoFilter = {
    from: { row: table.headerRow, column: 1 },
    to: { row: table.headerRow, column: CLAIM_COLUMNS.length },
  };
  addDataBar(ws, 9, table.firstDataRow, table.lastDataRow, THEME.teal); // Total Payment
  addDataBar(ws, 11, table.firstDataRow, table.lastDataRow, THEME.amber); // Outstanding

  // Summary Metrics rendered BELOW the detail table.
  let r2 = subHeading(ws, table.nextRow, 'Summary Metrics', 3);
  r2 = metricsBlock(ws, r2, group.metrics, 3);
  footer(ws, r2, CLAIM_COLUMNS.length);

  // Freeze only the title + detail header (small split => fully scrollable).
  ws.views = [{ state: 'frozen', ySplit: table.headerRow, showGridLines: false }];
  return ws;
}

function buildPayersIndex(wb, s) {
  const ws = wb.addWorksheet('Payer Analysis', { properties: { tabColor: { argb: THEME.navyLight } } });
  let r = titleBar(ws, 1, 'Payer Analysis — All Payers', 10);
  const cols = [
    { header: 'Payer', key: 'payer', width: 32, align: 'left' },
    { header: '# Claims', key: 'claims', width: 12, align: 'right', fmt: FMT.int, total: 'sum' },
    { header: 'Charges', key: 'charges', width: 16, align: 'right', fmt: FMT.money, total: 'sum' },
    { header: 'Allowed', key: 'allowed', width: 16, align: 'right', fmt: FMT.money, total: 'sum' },
    { header: 'Total Payment', key: 'totalPayment', width: 16, align: 'right', fmt: FMT.money, total: 'sum' },
    { header: 'Outstanding', key: 'outstanding', width: 16, align: 'right', fmt: FMT.money, total: 'sum' },
    { header: 'Avg / Claim', key: 'avgPaymentPerClaim', width: 14, align: 'right', fmt: FMT.money },
    { header: 'Avg / Paid Claim', key: 'avgPaymentPerPaidClaim', width: 15, align: 'right', fmt: FMT.money },
    { header: 'Net Coll %', key: 'netCollectionRate', width: 12, align: 'right', fmt: FMT.pct },
    { header: 'Denial %', key: 'denialRate', width: 12, align: 'right', fmt: FMT.pct },
  ];
  const data = s.perPayer.map((p) => ({ payer: p.payer, ...p.metrics }));
  const table = writeTable(ws, cols, data, { startRow: r, totalRow: true });
  ws.autoFilter = { from: { row: table.headerRow, column: 1 }, to: { row: table.headerRow, column: cols.length } };
  addDataBar(ws, 5, table.firstDataRow, table.lastDataRow, THEME.teal);
  addDataBar(ws, 6, table.firstDataRow, table.lastDataRow, THEME.amber);
  ws.views = [{ state: 'frozen', ySplit: table.headerRow, showGridLines: false }];
  return ws;
}

function buildCptIndex(wb, s) {
  const ws = wb.addWorksheet('CPT Analysis', { properties: { tabColor: { argb: THEME.navyLight } } });
  let r = titleBar(ws, 1, 'CPT Analysis — All Procedure Codes', 10);
  const cols = [
    { header: 'CPT', key: 'cpt', width: 12, align: 'center' },
    { header: '# Claims', key: 'claims', width: 12, align: 'right', fmt: FMT.int, total: 'sum' },
    { header: 'Charges', key: 'charges', width: 16, align: 'right', fmt: FMT.money, total: 'sum' },
    { header: 'Allowed', key: 'allowed', width: 16, align: 'right', fmt: FMT.money, total: 'sum' },
    { header: 'Total Payment', key: 'totalPayment', width: 16, align: 'right', fmt: FMT.money, total: 'sum' },
    { header: 'Outstanding', key: 'outstanding', width: 16, align: 'right', fmt: FMT.money, total: 'sum' },
    { header: 'Avg / Claim', key: 'avgPaymentPerClaim', width: 14, align: 'right', fmt: FMT.money },
    { header: 'Avg / Paid Claim', key: 'avgPaymentPerPaidClaim', width: 15, align: 'right', fmt: FMT.money },
    { header: 'Net Coll %', key: 'netCollectionRate', width: 12, align: 'right', fmt: FMT.pct },
    { header: 'Denial %', key: 'denialRate', width: 12, align: 'right', fmt: FMT.pct },
  ];
  const data = s.perCpt.map((p) => ({ cpt: p.cpt, ...p.metrics }));
  const table = writeTable(ws, cols, data, { startRow: r, totalRow: true });
  ws.autoFilter = { from: { row: table.headerRow, column: 1 }, to: { row: table.headerRow, column: cols.length } };
  addDataBar(ws, 3, table.firstDataRow, table.lastDataRow, THEME.navyLight);
  ws.views = [{ state: 'frozen', ySplit: table.headerRow, showGridLines: false }];
  return ws;
}

function buildReconciliation(wb, s) {
  const ws = wb.addWorksheet('Validation', { properties: { tabColor: { argb: s.reconciliation.overall === 'PASS' ? THEME.green : THEME.red } } });
  for (let c = 1; c <= 3; c++) ws.getColumn(c).width = c === 1 ? 48 : c === 2 ? 12 : 70;
  let r = titleBar(ws, 1, `Validation & Reconciliation — ${s.reconciliation.overall}`, 3);

  const cols = [
    { header: 'Control', key: 'name', width: 48, align: 'left' },
    { header: 'Status', key: 'status', width: 12, align: 'center' },
    { header: 'Detail', key: 'detail', width: 70, align: 'left' },
  ];
  const table = writeTable(ws, cols, s.reconciliation.checks, { startRow: r });
  // Color PASS/FAIL cells
  for (let row = table.firstDataRow; row <= table.lastDataRow; row++) {
    const cell = ws.getCell(row, 2);
    const pass = cell.value === 'PASS';
    cell.font = { bold: true, color: { argb: pass ? THEME.green : THEME.red } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: pass ? THEME.greenLight : THEME.redLight } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  }
  r = table.nextRow;

  r = subHeading(ws, r, 'Derivation Log', 3);
  const derivRows = [
    { name: 'Total Payment derived from Primary + Secondary', status: '', detail: `${s.reconciliation.derived.totalPaymentFromParts} claims` },
    { name: 'Outstanding derived from Charges − Payment − Adjustment', status: '', detail: `${s.reconciliation.derived.outstandingFromChargesLessPaidAdj} claims` },
    { name: 'A/R Days derived from Date of Service', status: '', detail: `${s.reconciliation.derived.arDaysFromServiceDate} claims` },
    { name: 'Rows skipped (missing CPT or charges)', status: '', detail: `${s.reconciliation.skippedCount} rows` },
    { name: 'Total records analyzed', status: '', detail: `${s.reconciliation.totalRecords} claims` },
  ];
  writeTable(ws, cols, derivRows, { startRow: r });
  ws.views = [{ showGridLines: false }];
  return ws;
}

function buildKpis(wb, s) {
  const ws = wb.addWorksheet('Collection KPIs', { properties: { tabColor: { argb: THEME.green } } });
  ws.getColumn(1).width = 40;
  ws.getColumn(2).width = 22;
  let r = titleBar(ws, 1, 'Collection KPIs', 2);
  const k = s.kpis;
  const rows = [
    ['Total Claims', k.totalClaims, FMT.int],
    ['Paid Claims', k.paidClaims, FMT.int],
    ['Zero-Payment Claims', k.zeroPayClaims, FMT.int],
    ['Total Charges', k.totalCharges, FMT.money],
    ['Total Allowed', k.totalAllowed, FMT.money],
    ['Total Payments', k.totalPayments, FMT.money],
    ['Total Adjustments', k.totalAdjustments, FMT.money],
    ['Total Outstanding A/R', k.totalOutstanding, FMT.money],
    ['Gross Collection Rate', k.grossCollectionRate, FMT.pct],
    ['Net Collection Rate', k.netCollectionRate, FMT.pct],
    ['Denial Rate', k.denialRate, FMT.pct],
    ['Denied Claims', k.deniedClaims, FMT.int],
    ['Denied Outstanding', k.deniedOutstanding, FMT.money],
    ['Avg Payment / Claim', k.avgPaymentPerClaim, FMT.money],
    ['Avg Payment / Paid Claim', k.avgPaymentPerPaidClaim, FMT.money],
    ['Avg A/R Days', k.avgArDays ?? 0, FMT.days],
  ];
  rows.forEach(([label, value, fmt], i) => {
    const lc = ws.getCell(r, 1);
    lc.value = label;
    lc.font = { bold: true, color: { argb: THEME.slate } };
    lc.border = borderAll();
    lc.alignment = { indent: 1, vertical: 'middle' };
    const vc = ws.getCell(r, 2);
    vc.value = value;
    vc.numFmt = fmt;
    vc.font = { bold: true };
    vc.alignment = { horizontal: 'right' };
    vc.border = borderAll();
    if (i % 2 === 1) lc.fill = vc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: THEME.zebra } };
    r++;
  });
  ws.views = [{ showGridLines: false }];
  return ws;
}

function buildArAging(wb, s) {
  const ws = wb.addWorksheet('AR Aging', { properties: { tabColor: { argb: THEME.amber } } });
  for (let c = 1; c <= 4; c++) ws.getColumn(c).width = 18;
  let r = titleBar(ws, 1, 'A/R Aging Analysis', 4);
  r = writeArTable(ws, r, s.arAging);
  r = subHeading(ws, r, '120+ Day Rollup', 4);
  const cols = [
    { header: 'Category', key: 'category', width: 20, align: 'left' },
    { header: '# of Claims', key: 'claims', width: 16, align: 'right', fmt: FMT.int },
    { header: 'Total O/S', key: 'totalOs', width: 16, align: 'right', fmt: FMT.money },
    { header: 'AR %', key: 'arPercent', width: 12, align: 'right', fmt: FMT.pct },
  ];
  writeTable(ws, cols, [{ category: 'Over 120 Days', ...s.arAging.over120 }], { startRow: r });
  ws.views = [{ showGridLines: false }];
  return ws;
}

function buildUnderpayment(wb, s) {
  const ws = wb.addWorksheet('Underpayment Opportunity', { properties: { tabColor: { argb: THEME.gold } } });
  let r = titleBar(ws, 1, 'Underpayment Opportunity Analysis', 8,
    `Total identified underpayment opportunity: $${s.underpayment.totalOpportunity.toLocaleString('en-US', { minimumFractionDigits: 2 })} across ${s.underpayment.count} claims`);
  const cols = [
    { header: 'Claim ID', key: 'claimId', width: 18, align: 'left' },
    { header: 'CPT', key: 'cpt', width: 10, align: 'center' },
    { header: 'Payer', key: 'payer', width: 28, align: 'left' },
    { header: 'Allowed Amount', key: 'allowedAmount', width: 16, align: 'right', fmt: FMT.money, total: 'sum' },
    { header: 'Total Payment', key: 'totalPayment', width: 16, align: 'right', fmt: FMT.money, total: 'sum' },
    { header: 'Shortfall', key: 'shortfall', width: 16, align: 'right', fmt: FMT.money, total: 'sum' },
    { header: '% of Allowed', key: 'pctOfAllowed', width: 14, align: 'right', fmt: FMT.pct },
    { header: 'A/R Days', key: 'arDays', width: 10, align: 'center', fmt: FMT.days },
  ];
  if (s.underpayment.rows.length) {
    const table = writeTable(ws, cols, s.underpayment.rows, { startRow: r, totalRow: true });
    ws.autoFilter = { from: { row: table.headerRow, column: 1 }, to: { row: table.headerRow, column: cols.length } };
    addDataBar(ws, 6, table.firstDataRow, table.lastDataRow, THEME.gold);
    ws.views = [{ state: 'frozen', ySplit: table.headerRow, showGridLines: false }];
  } else {
    ws.getCell(r, 1).value = 'No underpayments detected (requires allowed-amount data with payment shortfalls).';
  }
  return ws;
}

function buildDenials(wb, s) {
  const ws = wb.addWorksheet('Denial Opportunity', { properties: { tabColor: { argb: THEME.red } } });
  let r = titleBar(ws, 1, 'Denial Opportunity Analysis', 7,
    `Total recoverable from denials: $${s.denials.totalRecoverable.toLocaleString('en-US', { minimumFractionDigits: 2 })} across ${s.denials.count} claims`);

  r = subHeading(ws, r, 'By Denial Reason', 7);
  if (s.denials.byReason.length) {
    const rt = writeTable(ws, [
      { header: 'Denial Reason', key: 'reason', width: 40, align: 'left' },
      { header: '# of Claims', key: 'claims', width: 14, align: 'right', fmt: FMT.int, total: 'sum' },
      { header: 'Outstanding', key: 'outstanding', width: 18, align: 'right', fmt: FMT.money, total: 'sum' },
    ], s.denials.byReason, { startRow: r, totalRow: true });
    addDataBar(ws, 3, rt.firstDataRow, rt.lastDataRow, THEME.red);
    r = rt.nextRow;

    r = subHeading(ws, r, 'Denied Claim Detail', 7);
    const cols = [
      { header: 'Claim ID', key: 'claimId', width: 18, align: 'left' },
      { header: 'CPT', key: 'cpt', width: 10, align: 'center' },
      { header: 'Payer', key: 'payer', width: 28, align: 'left' },
      { header: 'Charges', key: 'charges', width: 14, align: 'right', fmt: FMT.money, total: 'sum' },
      { header: 'Outstanding', key: 'outstandingBalance', width: 16, align: 'right', fmt: FMT.money, total: 'sum' },
      { header: 'Denial Reason', key: 'denialReason', width: 28, align: 'left' },
      { header: 'A/R Days', key: 'arDays', width: 10, align: 'center', fmt: FMT.days },
    ];
    const dt = writeTable(ws, cols, s.denials.rows, { startRow: r, totalRow: true });
    ws.autoFilter = { from: { row: dt.headerRow, column: 1 }, to: { row: dt.headerRow, column: cols.length } };
  } else {
    ws.getCell(r, 1).value = 'No denials detected in the uploaded data.';
  }
  ws.views = [{ showGridLines: false }];
  return ws;
}

// Data ingestion audit — proves every row is accounted for (used or skipped).
function buildIngestionAudit(wb, summary) {
  const ing = summary.ingestion;
  const tabColor = ing.conservationOk && ing.sheetsIgnored.length === 0 ? THEME.green : THEME.amber;
  const ws = wb.addWorksheet('Data Ingestion Audit', { properties: { tabColor: { argb: tabColor } } });
  for (let c = 1; c <= 6; c++) ws.getColumn(c).width = c === 1 ? 22 : 20;
  let r = titleBar(ws, 1, 'Data Ingestion Audit', 6,
    'Provable row conservation — every row in the upload is either used in calculations or listed here as skipped-with-reason.');

  // Conservation summary
  const rows = [
    ['Worksheets in file', ing.workbookSheetCount, FMT.int],
    ['Worksheets ingested', ing.sheetsUsed.length, FMT.int],
    ['Total data rows ingested', ing.totalDataRows, FMT.int],
    ['Rows used as claims', ing.usedRecords, FMT.int],
    ['Rows skipped (not billing lines)', ing.skippedCount, FMT.int],
    ['Conservation check (used + skipped = data rows)', ing.conservationOk ? 'PASS' : 'FAIL', null],
  ];
  rows.forEach(([label, value, fmt], i) => {
    const lc = ws.getCell(r, 1);
    ws.mergeCells(r, 1, r, 3);
    lc.value = label;
    lc.font = { bold: true, color: { argb: THEME.slate } };
    lc.alignment = { vertical: 'middle', indent: 1 };
    lc.border = borderAll();
    const vc = ws.getCell(r, 4);
    ws.mergeCells(r, 4, r, 6);
    vc.value = value;
    if (fmt) vc.numFmt = fmt;
    vc.font = { bold: true };
    vc.alignment = { horizontal: 'right' };
    vc.border = borderAll();
    if (typeof value === 'string') {
      const pass = value === 'PASS';
      vc.font = { bold: true, color: { argb: pass ? THEME.green : THEME.red } };
      vc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: pass ? THEME.greenLight : THEME.redLight } };
    }
    if (i % 2 === 1) lc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: THEME.zebra } };
    r++;
  });
  r += 1;

  // Sheets used
  r = subHeading(ws, r, 'Worksheets Ingested', 6);
  r = writeTable(ws, [
    { header: 'Worksheet', key: 'name', width: 40, align: 'left' },
    { header: 'Data Rows', key: 'rows', width: 16, align: 'right', fmt: FMT.int, total: 'sum' },
  ], ing.sheetsUsed, { startRow: r, totalRow: true }).nextRow;

  // Sheets ignored (different structure) — surfaced explicitly, never silent.
  if (ing.sheetsIgnored.length) {
    r = subHeading(ws, r, 'Worksheets NOT Ingested (different structure — review separately)', 6);
    r = writeTable(ws, [
      { header: 'Worksheet', key: 'name', width: 30, align: 'left' },
      { header: 'Data Rows', key: 'rows', width: 14, align: 'right', fmt: FMT.int },
      { header: 'Reason', key: 'reason', width: 60, align: 'left' },
    ], ing.sheetsIgnored, { startRow: r }).nextRow;
  }

  // Skipped rows detail (cap display for very large files, but count is exact).
  r = subHeading(ws, r, `Skipped Rows (${ing.skippedCount}) — with exact source location & reason`, 6);
  if (ing.skippedCount === 0) {
    ws.getCell(r, 1).value = 'No rows were skipped — every ingested data row became a claim.';
  } else {
    const shown = ing.skippedRows.slice(0, 5000).map((s) => ({
      sheet: s.sheet || '(primary)',
      rowNumber: s.rowNumber,
      reason: s.reason,
      rawCpt: s.rawCpt,
      rawCharges: s.rawCharges,
      rawPayer: s.rawPayer,
    }));
    const t = writeTable(ws, [
      { header: 'Sheet', key: 'sheet', width: 20, align: 'left' },
      { header: 'Row #', key: 'rowNumber', width: 10, align: 'right', fmt: FMT.int },
      { header: 'Reason', key: 'reason', width: 30, align: 'left' },
      { header: 'Raw CPT', key: 'rawCpt', width: 16, align: 'left' },
      { header: 'Raw Charges', key: 'rawCharges', width: 16, align: 'left' },
      { header: 'Raw Payer', key: 'rawPayer', width: 24, align: 'left' },
    ], shown, { startRow: r });
    ws.autoFilter = { from: { row: t.headerRow, column: 1 }, to: { row: t.headerRow, column: 6 } };
    if (ing.skippedCount > 5000) {
      ws.getCell(t.nextRow, 1).value = `Showing first 5,000 of ${ing.skippedCount} skipped rows.`;
    }
  }
  ws.views = [{ showGridLines: false }];
  return ws;
}

// Full claim-level master detail — every claim, no grouping/aggregation.
function buildClaimMasterDetail(wb, records) {
  const ws = wb.addWorksheet('Claim-Level Master Detail', { properties: { tabColor: { argb: THEME.teal } } });
  let r = titleBar(ws, 1, 'Claim-Level Master Detail', CLAIM_COLUMNS.length,
    `Every claim (${records.length}) — granular, ungrouped source of truth for all aggregates`);
  const table = writeTable(ws, CLAIM_COLUMNS, claimRows(records), {
    startRow: r,
    totalRow: true,
    zebra: true,
  });
  ws.autoFilter = {
    from: { row: table.headerRow, column: 1 },
    to: { row: table.headerRow, column: CLAIM_COLUMNS.length },
  };
  addDataBar(ws, 5, table.firstDataRow, table.lastDataRow, THEME.navyLight); // Charges
  addDataBar(ws, 9, table.firstDataRow, table.lastDataRow, THEME.teal); // Total Payment
  addDataBar(ws, 11, table.firstDataRow, table.lastDataRow, THEME.amber); // Outstanding
  footer(ws, table.nextRow, CLAIM_COLUMNS.length);
  ws.views = [{ state: 'frozen', ySplit: table.headerRow, showGridLines: false }];
  return ws;
}

// GPT-4o mini assurance review + deterministic claim-level anomaly candidates.
function buildAiAssurance(wb, s) {
  const review = s.aiReview;
  const pkg = s.reviewPackage;
  const tabColor = review
    ? review.assurance === 'PASS' ? THEME.green : review.assurance === 'FAIL' ? THEME.red : THEME.amber
    : THEME.slate;
  const ws = wb.addWorksheet('AI Assurance Review', { properties: { tabColor: { argb: tabColor } } });
  for (let c = 1; c <= 6; c++) ws.getColumn(c).width = c === 1 ? 20 : 24;
  let r = titleBar(ws, 1, 'AI Assurance Review (GPT-4o mini + Deterministic Engine)', 6,
    'AI reviews claim-level exceptions pre-identified by the deterministic engine. Deterministic figures remain authoritative.');

  if (review) {
    const cards = [
      ['Assurance Verdict', review.assurance],
      ['AI Confidence', `${Math.round((review.confidence || 0) * 100)}%`],
      ['Model', review.model],
    ];
    cards.forEach(([label, value], i) => {
      const lc = ws.getCell(r, 1);
      lc.value = label;
      lc.font = { bold: true, color: { argb: THEME.slate } };
      lc.border = borderAll();
      ws.mergeCells(r, 1, r, 2);
      const vc = ws.getCell(r, 3);
      ws.mergeCells(r, 3, r, 6);
      vc.value = value;
      vc.font = { bold: true };
      vc.border = borderAll();
      r++;
    });
    r++;
    const statements = [
      ['Assurance Statement', review.assuranceStatement],
      ['Control Assessment', review.controlAssessment],
    ];
    statements.forEach(([label, text]) => {
      if (!text) return;
      const lc = ws.getCell(r, 1);
      lc.value = label;
      lc.font = { bold: true, color: { argb: THEME.navy } };
      ws.mergeCells(r, 2, r, 6);
      const vc = ws.getCell(r, 2);
      vc.value = text;
      vc.alignment = { wrapText: true, vertical: 'top' };
      ws.getRow(r).height = Math.max(18, Math.ceil(text.length / 90) * 15);
      r++;
    });
    r++;

    if (review.findings?.length) {
      r = subHeading(ws, r, 'AI Findings (most severe first)', 6);
      writeTable(ws, [
        { header: 'Claim ID', key: 'claimId', width: 18, align: 'left' },
        { header: 'Severity', key: 'severity', width: 12, align: 'center' },
        { header: 'Issue', key: 'issue', width: 50, align: 'left' },
        { header: 'Recommendation', key: 'recommendation', width: 50, align: 'left' },
      ], review.findings, { startRow: r });
      r += review.findings.length + 3;
    } else {
      ws.getCell(r, 1).value = 'AI review returned no genuine issues.';
      r += 2;
    }
  } else {
    ws.getCell(r, 1).value = 'AI assurance review not available (no OpenAI key configured). Deterministic controls remain fully authoritative — see the Validation tab.';
    r += 2;
  }

  // Always show the deterministic claim-level anomaly candidates.
  r = subHeading(ws, r, `Deterministic Claim-Level Anomaly Candidates (${pkg?.anomalyCandidateCount || 0})`, 6);
  const candidates = (pkg?.anomalyCandidates || []).map((c) => ({
    claimId: c.claimId,
    cpt: c.cpt,
    payer: c.payer,
    charges: c.charges,
    totalPayment: c.totalPayment,
    outstandingBalance: c.outstandingBalance,
    flags: c.flags.join('; '),
  }));
  if (candidates.length) {
    const t = writeTable(ws, [
      { header: 'Claim ID', key: 'claimId', width: 18, align: 'left' },
      { header: 'CPT', key: 'cpt', width: 10, align: 'center' },
      { header: 'Payer', key: 'payer', width: 24, align: 'left' },
      { header: 'Charges', key: 'charges', width: 14, align: 'right', fmt: FMT.money },
      { header: 'Total Payment', key: 'totalPayment', width: 15, align: 'right', fmt: FMT.money },
      { header: 'Outstanding', key: 'outstandingBalance', width: 14, align: 'right', fmt: FMT.money },
      { header: 'Flags', key: 'flags', width: 46, align: 'left' },
    ], candidates, { startRow: r });
    ws.autoFilter = { from: { row: t.headerRow, column: 1 }, to: { row: t.headerRow, column: 7 } };
  } else {
    ws.getCell(r, 1).value = 'No claim-level anomalies detected by deterministic exception rules.';
  }
  ws.views = [{ showGridLines: false }];
  return ws;
}

// When per-entity sheets are capped, add an explanatory note to the index sheet
// so a reviewer knows every entity is still fully accounted for here.
function annotateCap(wb, sheetTitle, totalEntities, dedicatedSheetsMade) {
  if (totalEntities <= dedicatedSheetsMade) return;
  const ws = wb.getWorksheet(sheetTitle);
  if (!ws) return;
  const row = ws.rowCount + 2;
  ws.mergeCells(row, 1, row, 10);
  const c = ws.getCell(row, 1);
  c.value =
    `Note: ${totalEntities} total shown above. To keep the workbook performant, ${dedicatedSheetsMade} received a dedicated tab ` +
    `(highest charges first); all others are fully represented here and in the Claim-Level Master Detail.`;
  c.font = { italic: true, size: 9, color: { argb: THEME.amber } };
  c.alignment = { wrapText: true, vertical: 'top' };
}

// ── Orchestrator ────────────────────────────────────────────────────────────

export async function buildWorkbook(summary, narrative, meta, records = []) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Executive Report Generator';
  wb.created = new Date();
  wb.properties.company = meta.provider || '';

  buildCover(wb, {
    ...meta,
    recordCount: summary.recordCount,
    generatedAt: summary.generatedAt,
    reconciliationStatus: summary.reconciliation.overall,
  }, narrative);

  buildDashboard(wb, summary, narrative);
  buildExecSummarySheet(wb, summary);
  buildKpis(wb, summary);
  buildArAging(wb, summary);
  buildUnderpayment(wb, summary);
  buildDenials(wb, summary);
  buildReconciliation(wb, summary);
  buildIngestionAudit(wb, summary);
  buildAiAssurance(wb, summary);
  buildClaimMasterDetail(wb, records);
  buildPayersIndex(wb, summary);
  buildCptIndex(wb, summary);

  const usedNames = new Set(wb.worksheets.map((w) => w.name.toLowerCase()));

  // Dedicated CPT tabs (per spec) — always create in defined order, even if absent.
  for (const code of config.dedicatedCpts) {
    const group = summary.perCpt.find((g) => g.cpt === code);
    if (group) {
      buildGroupSheet(wb, usedNames, `CPT ${code}`, THEME.teal, group);
    } else {
      const ws = wb.addWorksheet(sheetName(`CPT ${code}`, usedNames), { properties: { tabColor: { argb: THEME.teal } } });
      titleBar(ws, 1, `CPT ${code}`, 4, 'No claims for this CPT in the uploaded data.');
      ws.views = [{ showGridLines: false }];
    }
  }

  // One sheet per CPT (all CPTs), excluding dedicated ones already rendered.
  // Capped at maxEntitySheets (highest charges first — perCpt is charge-sorted)
  // so a high-cardinality file cannot produce an unopenable workbook. Every CPT
  // still appears with full metrics on the CPT Analysis index + master detail.
  const cptGroups = summary.perCpt.filter((g) => !config.dedicatedCpts.includes(g.cpt));
  let cptSheetsMade = 0;
  for (const group of cptGroups) {
    if (cptSheetsMade >= config.maxEntitySheets) break;
    buildGroupSheet(wb, usedNames, `CPT ${group.cpt}`, THEME.navyLight, group);
    cptSheetsMade++;
  }

  // One sheet per payer (all payers), capped the same way.
  let payerSheetsMade = 0;
  for (const group of summary.perPayer) {
    if (payerSheetsMade >= config.maxEntitySheets) break;
    buildGroupSheet(wb, usedNames, `Payer ${group.payer}`, THEME.slate, group);
    payerSheetsMade++;
  }

  // If capping applied, annotate the index sheets so nothing looks missing.
  annotateCap(wb, 'CPT Analysis', cptGroups.length + config.dedicatedCpts.length, cptSheetsMade + config.dedicatedCpts.length);
  annotateCap(wb, 'Payer Analysis', summary.perPayer.length, payerSheetsMade);

  buildReadMe(wb, meta, meta.mappingTrace || {}, meta.columnMapping || {});

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
