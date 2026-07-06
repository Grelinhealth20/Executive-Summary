import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';

import { config } from './src/config.js';
import { logger } from './src/logger.js';
import { processReport } from './src/pipeline.js';
import { putJob, getJob } from './src/jobStore.js';
import { learningStore } from './src/learningStore.js';

const app = express();

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
      },
    },
  })
);
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(config.publicDir));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', apiLimiter);

const ALLOWED_EXT = new Set(['.xlsx', '.xls', '.xlsm', '.csv']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (ALLOWED_EXT.has(ext)) return cb(null, true);
    cb(new Error(`Unsupported file type "${ext}". Allowed: ${[...ALLOWED_EXT].join(', ')}`));
  },
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    model: config.openaiModel,
    aiConfigured: Boolean(config.openaiApiKey),
    learning: learningStore.snapshot(),
    time: new Date().toISOString(),
  });
});

app.get('/api/learning', (req, res) => {
  res.json(learningStore.snapshot());
});

app.post('/api/generate', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded. Attach a report file under the "file" field.' });
    }
    const provider = (req.body?.provider || '').toString().slice(0, 200);

    const result = await processReport(req.file.buffer, req.file.originalname, { provider });

    const downloadName = buildDownloadName(req.file.originalname);
    const jobId = putJob({ workbook: result.workbook, filename: downloadName, email: result.email });

    res.json({
      jobId,
      downloadUrl: `/api/download/${jobId}`,
      filename: downloadName,
      email: result.email,
      summary: toClientSummary(result.summary),
      narrative: result.narrative,
      meta: {
        provider: result.meta.provider,
        sourceFile: result.meta.sourceFile,
        model: result.meta.model,
        columnMapping: result.meta.columnMapping,
        mappingTrace: result.meta.mappingTrace,
      },
      learning: result.learning,
      stats: result.stats,
      reconciliation: result.summary.reconciliation,
      aiReview: result.summary.aiReview,
    });
  } catch (err) {
    logger.error('Generation failed', { error: err.message, stack: err.stack });
    res.status(422).json({ error: err.message });
  }
});

app.get('/api/download/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Report not found or expired. Please regenerate.' });
  }
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', `attachment; filename="${job.filename}"`);
  res.send(job.workbook);
});

// SPA fallback: serve the React app for any non-API GET route.
app.get(/^(?!\/api\/).*/, (req, res, next) => {
  if (req.method !== 'GET') return next();
  res.sendFile(path.join(config.publicDir, 'index.html'), (err) => {
    if (err) {
      res
        .status(500)
        .send('React client is not built yet. Run "npm run build" in the client directory.');
    }
  });
});

// Multer / body errors
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  if (err) {
    logger.error('Unhandled request error', { error: err.message });
    return res.status(400).json({ error: err.message });
  }
  next();
});

function buildDownloadName(original) {
  const base = path.basename(original || 'report', path.extname(original || '')).replace(/[^a-z0-9_\- ]/gi, '').trim() || 'report';
  const stamp = new Date().toISOString().slice(0, 10);
  return `Executive_Report_${base}_${stamp}.xlsx`;
}

// Trim the full server-side summary into a client-friendly payload.
function toClientSummary(s) {
  return {
    generatedAt: s.generatedAt,
    recordCount: s.recordCount,
    kpis: s.kpis,
    topCpts: s.topCpts,
    arDistribution: s.arDistribution,
    zeroPaymentClaims: s.zeroPaymentClaims,
    paymentByMonth: s.paymentByMonth,
    insuranceOver120: s.insuranceOver120,
    arAging: s.arAging,
    underpayment: { totalOpportunity: s.underpayment.totalOpportunity, count: s.underpayment.count },
    denials: { totalRecoverable: s.denials.totalRecoverable, count: s.denials.count, byReason: s.denials.byReason.slice(0, 10) },
    payerCount: s.perPayer.length,
    cptCount: s.perCpt.length,
    reconciliation: s.reconciliation,
    anomalyCandidateCount: s.reviewPackage ? s.reviewPackage.anomalyCandidateCount : 0,
    ingestion: {
      workbookSheetCount: s.ingestion.workbookSheetCount,
      sheetsUsed: s.ingestion.sheetsUsed,
      sheetsIgnored: s.ingestion.sheetsIgnored,
      totalDataRows: s.ingestion.totalDataRows,
      usedRecords: s.ingestion.usedRecords,
      skippedCount: s.ingestion.skippedCount,
      conservationOk: s.ingestion.conservationOk,
      // Cap the skipped-row detail sent to the browser; full list is in the Excel.
      skippedRows: s.ingestion.skippedRows.slice(0, 500),
    },
  };
}

// Startup readiness warnings (do not crash — the deterministic engine runs without AI).
if (!config.openaiApiKey) {
  logger.warn('OPENAI_API_KEY is not set — AI mapping, assurance review, and narrative are disabled. The deterministic engine remains fully operational.');
}
if (!fs.existsSync(config.publicDir)) {
  logger.warn('React client build not found — run "npm run build". The API still works.', {
    expected: config.publicDir,
  });
}

const server = app.listen(config.port, () => {
  logger.info(`Executive Report Generator listening on http://localhost:${config.port}`, {
    model: config.openaiModel,
    aiConfigured: Boolean(config.openaiApiKey),
    nodeEnv: process.env.NODE_ENV || 'development',
  });
});

// Graceful shutdown: stop accepting connections, drain, then exit.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Received ${signal} — shutting down gracefully`);
  server.close(() => {
    logger.info('HTTP server closed. Exiting.');
    process.exit(0);
  });
  // Force-exit if connections do not drain in time.
  setTimeout(() => {
    logger.warn('Forced shutdown after timeout');
    process.exit(1);
  }, 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Never let an unexpected error silently take the process down without a log.
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason: String(reason) });
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
});
