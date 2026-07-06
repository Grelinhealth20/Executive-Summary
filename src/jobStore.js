import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { logger } from './logger.js';

// Durable, disk-backed store for generated workbooks. Reports survive process
// restarts, do not accumulate in memory, and are swept after a TTL. Each job is
// a pair of files under <dataDir>/jobs: "<id>.xlsx" (the workbook) and
// "<id>.json" (metadata). Reads/writes are atomic (temp file + rename).

const TTL_MS = 30 * 60 * 1000; // 30 minutes
const JOBS_DIR = path.join(config.dataDir, 'jobs');

function ensureDir() {
  if (!fs.existsSync(JOBS_DIR)) fs.mkdirSync(JOBS_DIR, { recursive: true });
}

function sweep() {
  ensureDir();
  const now = Date.now();
  let files;
  try {
    files = fs.readdirSync(JOBS_DIR);
  } catch {
    return;
  }
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const metaPath = path.join(JOBS_DIR, f);
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (now - meta.createdAt > TTL_MS) {
        removeJob(meta.id);
      }
    } catch {
      // Corrupt/partial metadata — remove the pair.
      const id = path.basename(f, '.json');
      removeJob(id);
    }
  }
}

function removeJob(id) {
  for (const ext of ['.xlsx', '.json']) {
    const p = path.join(JOBS_DIR, id + ext);
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch (err) {
      logger.warn('Failed to remove expired job file', { file: p, error: err.message });
    }
  }
}

function atomicWrite(filePath, data) {
  const tmp = filePath + '.tmp-' + crypto.randomBytes(4).toString('hex');
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, filePath);
}

/** Persist a generated report. payload: { workbook: Buffer, filename, email }. */
export function putJob(payload) {
  ensureDir();
  sweep();
  const id = crypto.randomUUID();
  const xlsxPath = path.join(JOBS_DIR, id + '.xlsx');
  const metaPath = path.join(JOBS_DIR, id + '.json');

  atomicWrite(xlsxPath, payload.workbook);
  atomicWrite(
    metaPath,
    JSON.stringify({
      id,
      filename: payload.filename,
      email: payload.email,
      createdAt: Date.now(),
    })
  );
  return id;
}

/** Retrieve a job's workbook + metadata, or null if missing/expired. */
export function getJob(id) {
  // Reject anything that is not a plain UUID to prevent path traversal.
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  sweep();
  const xlsxPath = path.join(JOBS_DIR, id + '.xlsx');
  const metaPath = path.join(JOBS_DIR, id + '.json');
  try {
    if (!fs.existsSync(xlsxPath) || !fs.existsSync(metaPath)) return null;
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    if (Date.now() - meta.createdAt > TTL_MS) {
      removeJob(id);
      return null;
    }
    return { ...meta, workbook: fs.readFileSync(xlsxPath) };
  } catch (err) {
    logger.warn('Failed to read job', { id, error: err.message });
    return null;
  }
}

// Sweep on load in case a prior run left stale files.
sweep();
