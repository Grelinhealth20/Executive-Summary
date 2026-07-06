import { config } from './config.js';
import { logger } from './logger.js';
import { parseWorkbook } from './parser.js';
import { mapColumns } from './columnMapper.js';
import { normalizeRows } from './normalize.js';
import { computeAll, buildReviewPackage } from './calculations.js';
import { aiExecutiveNarrative, aiCalculationReview } from './openaiService.js';
import { buildExecutiveEmail } from './emailBuilder.js';
import { buildWorkbook } from './excel/workbook.js';
import { learningStore } from './learningStore.js';

// End-to-end processing: raw file buffer -> { summary, narrative, email, workbook }.
// Every step is real; there is no mock data anywhere in this path.

export async function processReport(buffer, originalName, options = {}) {
  const started = Date.now();

  // 1. Parse (all same-structure sheets combined; ingestion audit produced)
  const { headers, rows, ingestion, sheetName, sourceFile } = parseWorkbook(buffer, originalName);

  // Guard: reject files above the configured row cap rather than risk an OOM.
  if (rows.length > config.maxRows) {
    throw new Error(
      `File contains ${rows.length.toLocaleString('en-US')} rows, which exceeds the configured limit of ` +
        `${config.maxRows.toLocaleString('en-US')}. Increase MAX_ROWS (and Node heap via --max-old-space-size) ` +
        `to process larger files, or split the report.`
    );
  }

  // 2. Map columns (learning + heuristics + GPT-4o mini)
  const { mapping, trace } = await mapColumns(headers, rows.slice(0, 8));

  // 3. Normalize into typed claim records
  const { records, derived, skipped } = normalizeRows(rows, mapping, { asOf: options.asOf || new Date() });
  if (!records.length) {
    throw new Error('No valid claim rows could be extracted after mapping. Verify the file contains CPT codes and charge amounts.');
  }

  // 4. Compute all metrics deterministically (with ingestion audit)
  const summary = computeAll(records, derived, skipped, ingestion);

  // 4b. Deterministic claim-level review package + GPT-4o mini assurance layer.
  const reviewPackage = buildReviewPackage(records, summary);
  summary.reviewPackage = reviewPackage;
  summary.aiReview = null;
  if (config.openaiApiKey) {
    try {
      summary.aiReview = await aiCalculationReview(reviewPackage);
    } catch (err) {
      logger.warn('AI calculation review failed; deterministic controls remain authoritative', { error: err.message });
    }
  }

  // 5. Executive narrative via GPT-4o mini (optional — degrades gracefully)
  let narrative = null;
  if (config.openaiApiKey) {
    try {
      narrative = await aiExecutiveNarrative(summary);
    } catch (err) {
      logger.warn('Narrative generation failed; continuing without AI prose', { error: err.message });
    }
  }

  const meta = {
    provider: options.provider || '',
    sourceFile,
    sheetName,
    model: config.openaiModel,
    generatedAt: summary.generatedAt,
    columnMapping: mapping,
    mappingTrace: trace,
  };

  // 6. Executive email (HTML + text)
  const email = buildExecutiveEmail(summary, narrative, meta);

  // 7. Excel workbook (includes full claim-level master detail — no summary-only grouping)
  const workbook = await buildWorkbook(summary, narrative, meta, records);

  const elapsedMs = Date.now() - started;
  logger.info('Report processed', {
    file: sourceFile,
    records: records.length,
    skipped: skipped.length,
    elapsedMs,
    reconciliation: summary.reconciliation.overall,
  });

  return {
    summary,
    narrative,
    email,
    workbook,
    meta,
    learning: learningStore.snapshot(),
    stats: { elapsedMs, recordCount: records.length, skippedCount: skipped.length },
  };
}
