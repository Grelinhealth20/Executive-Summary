import { CANONICAL_FIELDS, CANONICAL_KEYS, REQUIRED_KEYS } from './schema.js';
import { learningStore, normalizeHeader } from './learningStore.js';
import { aiMapColumns } from './openaiService.js';
import { config } from './config.js';
import { logger } from './logger.js';

// Produces a mapping { canonicalField -> rawHeader|null } using a layered strategy:
//   1. Known template recall (instant, from prior confirmed uploads)
//   2. Per-header learned associations (adaptive memory)
//   3. Deterministic synonym/heuristic matching
//   4. GPT-4.1 semantic mapping to fill remaining gaps
// then reinforces the learning store so future uploads get smarter.

function heuristicMatch(headers) {
  const mapping = Object.fromEntries(CANONICAL_KEYS.map((k) => [k, null]));
  const usedHeaders = new Set();
  const normHeaders = headers.map((h) => ({ raw: h, norm: normalizeHeader(h) }));

  // Phase 1: EXACT synonym match for EVERY field first. This must run globally
  // before any containment matching, so a specific header (e.g. "Payment Posted
  // Date") is claimed by its exact-match field before a broader field (e.g.
  // Total Payment, whose synonyms include "payment") can greedily absorb it.
  for (const key of CANONICAL_KEYS) {
    const field = CANONICAL_FIELDS[key];
    for (const { raw, norm } of normHeaders) {
      if (usedHeaders.has(raw)) continue;
      if (field.synonyms.some((s) => normalizeHeader(s) === norm)) {
        mapping[key] = raw;
        usedHeaders.add(raw);
        break;
      }
    }
  }

  // Phase 2: containment match for anything still unmapped.
  for (const key of CANONICAL_KEYS) {
    if (mapping[key]) continue;
    const field = CANONICAL_FIELDS[key];
    for (const { raw, norm } of normHeaders) {
      if (usedHeaders.has(raw)) continue;
      if (
        field.synonyms.some((s) => {
          const ns = normalizeHeader(s);
          return ns.length >= 3 && (norm.includes(ns) || ns.includes(norm));
        })
      ) {
        mapping[key] = raw;
        usedHeaders.add(raw);
        break;
      }
    }
  }

  return mapping;
}

function applyLearnedAssociations(headers, mapping, usedHeaders) {
  for (const key of CANONICAL_KEYS) {
    if (mapping[key]) continue;
    for (const header of headers) {
      if (usedHeaders.has(header)) continue;
      const suggestion = learningStore.suggestField(header);
      if (suggestion && suggestion.field === key) {
        mapping[key] = header;
        usedHeaders.add(header);
        break;
      }
    }
  }
}

export async function mapColumns(headers, sampleRows) {
  const trace = { source: [], aiUsed: false, aiConfidence: null, templateRecall: false };

  // 1. Template recall
  const template = learningStore.lookupTemplate(headers);
  let mapping = {};
  if (template && template.mapping) {
    // Only accept headers that still exist in this file.
    const headerSet = new Set(headers);
    for (const key of CANONICAL_KEYS) {
      const h = template.mapping[key];
      mapping[key] = h && headerSet.has(h) ? h : null;
    }
    trace.templateRecall = true;
    trace.source.push('learned-template');
  } else {
    mapping = Object.fromEntries(CANONICAL_KEYS.map((k) => [k, null]));
  }

  const usedHeaders = new Set(Object.values(mapping).filter(Boolean));

  // 2. Learned per-header associations
  applyLearnedAssociations(headers, mapping, usedHeaders);
  if (Object.values(mapping).some(Boolean)) trace.source.push('learned-associations');

  // 3. Heuristic synonym matching for anything still empty
  const heur = heuristicMatch(headers);
  for (const key of CANONICAL_KEYS) {
    if (!mapping[key] && heur[key] && !usedHeaders.has(heur[key])) {
      mapping[key] = heur[key];
      usedHeaders.add(heur[key]);
    }
  }
  trace.source.push('heuristics');

  // 4. AI fill for remaining gaps. Escalate to GPT whenever a required field is
  //    still missing OR there is both an unmapped canonical field and a leftover
  //    source column — i.e. a column the heuristics could not place (e.g. an
  //    unusually named patient-payment or adjustment column). This prevents
  //    real, financially material columns from being silently dropped, which
  //    would otherwise skew collection totals and break reconciliation.
  const missingRequired = REQUIRED_KEYS.filter((k) => !mapping[k]);
  const anyGaps = CANONICAL_KEYS.some((k) => !mapping[k]);
  const unusedHeaders = headers.filter((h) => !usedHeaders.has(h));
  // A leftover source column alongside an unmapped MONEY field is the signature
  // of a financially material column the heuristics failed to place — exactly
  // the case worth an AI call. Non-financial gaps (e.g. units) don't warrant one.
  const unmappedMoneyFields = CANONICAL_KEYS.filter(
    (k) => !mapping[k] && CANONICAL_FIELDS[k].type === 'money'
  );
  const shouldUseAi =
    config.openaiApiKey &&
    (missingRequired.length > 0 ||
      (unusedHeaders.length > 0 && unmappedMoneyFields.length > 0) ||
      (config.requireAiMapping && anyGaps));

  if (shouldUseAi) {
    try {
      const ai = await aiMapColumns(headers, sampleRows);
      trace.aiUsed = true;
      trace.aiConfidence = ai.confidence;
      trace.aiNotes = ai.notes;
      trace.source.push(config.openaiModel);
      for (const key of CANONICAL_KEYS) {
        if (!mapping[key] && ai.mapping[key] && !usedHeaders.has(ai.mapping[key])) {
          mapping[key] = ai.mapping[key];
          usedHeaders.add(ai.mapping[key]);
        }
      }
    } catch (err) {
      logger.warn('AI mapping failed, continuing with heuristic mapping', { error: err.message });
      trace.aiError = err.message;
      if (config.requireAiMapping) throw err;
    }
  }

  // Validate required fields are present.
  const stillMissing = REQUIRED_KEYS.filter((k) => !mapping[k]);
  if (stillMissing.length) {
    const labels = stillMissing.map((k) => CANONICAL_FIELDS[k].label);
    throw new Error(
      `Could not identify required column(s): ${labels.join(', ')}. ` +
        `Detected headers: ${headers.join(', ')}. ` +
        `Please rename the relevant column(s) or ensure an OpenAI key is configured for adaptive mapping.`
    );
  }

  // Reinforce learning for next time.
  learningStore.reinforce(headers, mapping);

  logger.info('Column mapping resolved', { mapping, trace });
  return { mapping, trace };
}
