import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { logger } from './logger.js';

// Real, persistent adaptive-learning layer.
//
// Two things are learned across every upload the system processes:
//  1. header -> canonical-field associations (with confirmation counts), so a
//     header seen before is mapped instantly and confidently next time.
//  2. full header-set "signatures" -> a complete, proven mapping, so a report
//     with an identical layout is recognized as a known template.
//
// The store is a plain JSON file so it survives restarts and is auditable.

const EMPTY_STORE = {
  version: 1,
  createdAt: null,
  updatedAt: null,
  // normalizedHeader -> { field -> count }
  headerAssociations: {},
  // signatureHash -> { mapping, headers, uses, lastUsedAt }
  templates: {},
  stats: { uploadsProcessed: 0 },
};

function ensureDataDir() {
  if (!fs.existsSync(config.dataDir)) {
    fs.mkdirSync(config.dataDir, { recursive: true });
  }
}

function load() {
  ensureDataDir();
  try {
    if (fs.existsSync(config.learningStorePath)) {
      const raw = fs.readFileSync(config.learningStorePath, 'utf8');
      const parsed = JSON.parse(raw);
      return { ...structuredClone(EMPTY_STORE), ...parsed };
    }
  } catch (err) {
    logger.warn('Learning store unreadable, starting fresh', { error: err.message });
  }
  const fresh = structuredClone(EMPTY_STORE);
  fresh.createdAt = new Date().toISOString();
  return fresh;
}

function persist(store) {
  ensureDataDir();
  store.updatedAt = new Date().toISOString();
  const tmp = config.learningStorePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmp, config.learningStorePath); // atomic replace
}

export function normalizeHeader(h) {
  return String(h == null ? '' : h)
    .toLowerCase()
    .replace(/[\s_\-./#]+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
}

export function signatureOf(headers) {
  const norm = headers.map(normalizeHeader).filter(Boolean).sort();
  const hash = crypto.createHash('sha1').update(norm.join('|')).digest('hex');
  return hash;
}

class LearningStore {
  constructor() {
    this.store = load();
  }

  /** Best previously-learned field for a header, or null. */
  suggestField(header) {
    const key = normalizeHeader(header);
    const assoc = this.store.headerAssociations[key];
    if (!assoc) return null;
    let best = null;
    let bestCount = 0;
    for (const [field, count] of Object.entries(assoc)) {
      if (count > bestCount) {
        best = field;
        bestCount = count;
      }
    }
    return best ? { field: best, count: bestCount } : null;
  }

  /** A previously confirmed full-template mapping for this exact header set, or null. */
  lookupTemplate(headers) {
    const sig = signatureOf(headers);
    return this.store.templates[sig] || null;
  }

  /**
   * Reinforce learning after a mapping is produced/confirmed.
   * mapping: { canonicalField -> rawHeader }
   */
  reinforce(headers, mapping) {
    for (const [field, header] of Object.entries(mapping)) {
      if (!header) continue;
      const key = normalizeHeader(header);
      if (!key) continue;
      if (!this.store.headerAssociations[key]) this.store.headerAssociations[key] = {};
      this.store.headerAssociations[key][field] =
        (this.store.headerAssociations[key][field] || 0) + 1;
    }

    const sig = signatureOf(headers);
    const existing = this.store.templates[sig];
    this.store.templates[sig] = {
      mapping,
      headers,
      uses: (existing?.uses || 0) + 1,
      lastUsedAt: new Date().toISOString(),
    };
    this.store.stats.uploadsProcessed += 1;
    persist(this.store);
  }

  snapshot() {
    return {
      uploadsProcessed: this.store.stats.uploadsProcessed,
      knownTemplates: Object.keys(this.store.templates).length,
      learnedHeaders: Object.keys(this.store.headerAssociations).length,
      updatedAt: this.store.updatedAt,
    };
  }
}

// Singleton — one shared, continuously-improving brain for the process.
export const learningStore = new LearningStore();
