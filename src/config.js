import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..');

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function bool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

export const config = {
  port: num(process.env.PORT, 3000),
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  openaiBaseUrl: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
  openaiTimeoutMs: num(process.env.OPENAI_TIMEOUT_MS, 60000),
  maxUploadBytes: num(process.env.MAX_UPLOAD_MB, 50) * 1024 * 1024,
  // Hard cap on claim rows to keep memory bounded and predictable. Files above
  // this are rejected with a clear message rather than risking an OOM crash.
  maxRows: num(process.env.MAX_ROWS, 150000),
  // Cap on the number of dedicated per-payer / per-CPT sheets. Every payer and
  // CPT still appears (with full metrics) on the Payer Analysis / CPT Analysis
  // index sheets and in the Claim-Level Master Detail — this only limits how many
  // get their own tab, so a high-cardinality file cannot produce an unopenable
  // workbook with thousands of worksheets.
  maxEntitySheets: num(process.env.MAX_ENTITY_SHEETS, 75),
  arMinBalance: num(process.env.AR_MIN_BALANCE, 10),
  requireAiMapping: bool(process.env.REQUIRE_AI_MAPPING, false),
  dataDir: path.join(ROOT_DIR, 'data'),
  learningStorePath: path.join(ROOT_DIR, 'data', 'learning-store.json'),
  // Serve the built React app from client/dist.
  publicDir: path.join(ROOT_DIR, 'client', 'dist'),
  // CPT codes that get dedicated tabs in the workbook (per spec).
  dedicatedCpts: ['99214', '99215', '99495', '99496'],
  // AR aging buckets (inclusive lower, inclusive upper). null upper = open ended.
  arBuckets: [
    { label: '0-30', min: 0, max: 30 },
    { label: '31-60', min: 31, max: 60 },
    { label: '61-90', min: 61, max: 90 },
    { label: '91-120', min: 91, max: 120 },
    { label: '121-150', min: 121, max: 150 },
    { label: '151-180', min: 151, max: 180 },
    { label: '180+', min: 181, max: null },
  ],
};

export function assertOpenAiConfigured() {
  if (!config.openaiApiKey) {
    throw new Error(
      'OPENAI_API_KEY is not set. Open the .env file and paste your key on the OPENAI_API_KEY line.'
    );
  }
}
