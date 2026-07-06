import { config, assertOpenAiConfigured } from './config.js';
import { CANONICAL_FIELDS, CANONICAL_KEYS } from './schema.js';
import { logger } from './logger.js';

// Direct OpenAI REST integration (no SDK). All calls go straight to the
// Chat Completions HTTP endpoint using the built-in fetch client, with a
// bounded timeout and transparent error handling.

/**
 * Low-level call to POST /v1/chat/completions. Returns the parsed JSON content
 * of the first choice. Throws a descriptive error on any non-2xx response.
 */
async function chatCompletion({ messages, temperature = 0, jsonMode = true }) {
  assertOpenAiConfigured();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.openaiTimeoutMs);

  let response;
  try {
    response = await fetch(`${config.openaiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: config.openaiModel,
        temperature,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
        messages,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`OpenAI request timed out after ${config.openaiTimeoutMs}ms.`);
    }
    throw new Error(`OpenAI request failed: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }

  const rawText = await response.text();

  if (!response.ok) {
    let detail = rawText;
    try {
      detail = JSON.parse(rawText)?.error?.message || rawText;
    } catch {
      /* keep raw text */
    }
    throw new Error(`OpenAI API error ${response.status}: ${detail}`);
  }

  let body;
  try {
    body = JSON.parse(rawText);
  } catch {
    throw new Error('OpenAI returned a non-JSON response body.');
  }

  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('OpenAI response contained no message content.');
  }
  return content;
}

/** Parse a JSON string the model returned; throw a labeled error otherwise. */
function parseModelJson(content, label) {
  try {
    return JSON.parse(content);
  } catch (err) {
    logger.error(`Failed to parse ${label} response`, { error: err.message });
    throw new Error(`${label} returned invalid JSON.`);
  }
}

/**
 * Ask GPT-4o mini to map raw column headers to canonical fields.
 * Returns { mapping: { canonicalField -> rawHeader|null }, confidence, notes }.
 *
 * The model NEVER computes financial figures — it only performs the semantic
 * task of matching column names, which is exactly where an LLM adds value and
 * where deterministic heuristics fail on unusual header wording.
 */
export async function aiMapColumns(headers, sampleRows) {
  const fieldGuide = CANONICAL_KEYS.map((k) => {
    const f = CANONICAL_FIELDS[k];
    return `- "${k}" (${f.label}, ${f.type}${f.required ? ', REQUIRED' : ''}): e.g. ${f.synonyms
      .slice(0, 6)
      .join(', ')}`;
  }).join('\n');

  const sample = sampleRows
    .slice(0, 5)
    .map((row, i) => `Row ${i + 1}: ${JSON.stringify(row)}`)
    .join('\n');

  const system = [
    'You are a data-integration specialist for U.S. medical-billing / revenue-cycle (RCM) reports.',
    'Your ONLY job is to map raw spreadsheet column headers to a fixed set of canonical fields.',
    'You must NOT invent, calculate, or transform any numeric values. You only match column names.',
    'Return strict JSON matching the requested schema. If no column fits a canonical field, use null.',
    'Never map two canonical fields to the same raw header unless truly unavoidable.',
  ].join(' ');

  const user = [
    'Canonical fields to fill:',
    fieldGuide,
    '',
    `Raw column headers (${headers.length}): ${JSON.stringify(headers)}`,
    '',
    'Sample data rows (values keyed by raw header):',
    sample,
    '',
    'Return JSON of the form:',
    '{ "mapping": { "<canonicalField>": "<exact raw header or null>", ... }, "confidence": 0-1, "notes": "short reasoning" }',
    'Include every canonical field key. Use the EXACT raw header string from the provided list, or null.',
  ].join('\n');

  const content = await chatCompletion({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0,
  });
  const parsed = parseModelJson(content, 'AI column mapping');

  // Validate: keep only headers that actually exist in the file.
  const headerSet = new Set(headers);
  const mapping = {};
  for (const key of CANONICAL_KEYS) {
    const val = parsed.mapping?.[key];
    mapping[key] = val && headerSet.has(val) ? val : null;
  }

  return {
    mapping,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.7,
    notes: typeof parsed.notes === 'string' ? parsed.notes : '',
  };
}

/**
 * Ask GPT-4o mini to write the executive narrative from the ALREADY-COMPUTED metrics.
 * The model receives only finished numbers and produces prose + recommendations.
 * It cannot alter the figures; the deterministic numbers remain the source of truth.
 */
export async function aiExecutiveNarrative(summary) {
  const system = [
    'You are a healthcare revenue-cycle (RCM) financial analyst writing an executive summary for a CFO / provider.',
    'You are given FINAL, AUTHORITATIVE metrics that were computed deterministically. Do not recompute or contradict them.',
    'Write a concise, professional, board-ready narrative. Be specific, cite the given numbers exactly, and give prioritized, actionable recommendations.',
    'Return strict JSON.',
  ].join(' ');

  const user = [
    'Here are the computed metrics (authoritative — quote these exact values):',
    JSON.stringify(summary.narrativeFacts, null, 2),
    '',
    'Return JSON:',
    '{',
    '  "headline": "one-sentence bottom line",',
    '  "overview": "2-4 sentence financial overview paragraph",',
    '  "keyFindings": ["3-6 bullet strings citing specific numbers"],',
    '  "risks": ["2-4 risk/exposure bullets"],',
    '  "recommendations": ["3-6 prioritized, concrete action bullets"],',
    '  "emailBody": "a clean plain-text executive email body suitable to send to the provider, incorporating the above"',
    '}',
  ].join('\n');

  const content = await chatCompletion({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.3,
  });
  const parsed = parseModelJson(content, 'AI narrative generation');
  return {
    headline: parsed.headline || '',
    overview: parsed.overview || '',
    keyFindings: Array.isArray(parsed.keyFindings) ? parsed.keyFindings : [],
    risks: Array.isArray(parsed.risks) ? parsed.risks : [],
    recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
    emailBody: parsed.emailBody || '',
  };
}

/**
 * GPT-4o mini calculation-review layer — integrated with the deterministic engine.
 *
 * The deterministic engine remains the sole source of truth for every number.
 * This layer feeds the model (a) the engine's control totals + reconciliation
 * controls and (b) a claim-level anomaly candidate set that was pre-identified
 * deterministically (payment > charges, allowed < payment, negative balances,
 * etc.). The model performs a claim-by-claim reasoning review and returns a
 * severity-ranked assurance report. It is explicitly instructed NOT to invent or
 * recompute totals — only to assess consistency and flag real data-quality risks.
 *
 * `reviewPackage` is produced by buildReviewPackage() in calculations.js.
 */
export async function aiCalculationReview(reviewPackage) {
  const system = [
    'You are a meticulous healthcare revenue-cycle (RCM) audit analyst reviewing computed financials at the CLAIM level.',
    'The numbers you receive were computed by a deterministic engine and are authoritative. You must NOT recompute or overwrite them.',
    'Your job: assess internal consistency, confirm the reconciliation controls make sense, and evaluate each flagged claim-level anomaly to judge whether it is a genuine data-quality or revenue-integrity issue.',
    'Be precise and conservative. Do not fabricate figures. Reference claim IDs exactly as given.',
    'Return strict JSON.',
  ].join(' ');

  const user = [
    'DETERMINISTIC CONTROL TOTALS (authoritative):',
    JSON.stringify(reviewPackage.controlTotals, null, 2),
    '',
    'RECONCILIATION CONTROLS (already evaluated by the engine):',
    JSON.stringify(reviewPackage.reconciliation, null, 2),
    '',
    `CLAIM-LEVEL ANOMALY CANDIDATES (${reviewPackage.anomalyCandidates.length}; pre-flagged deterministically):`,
    JSON.stringify(reviewPackage.anomalyCandidates.slice(0, 60), null, 2),
    '',
    'Return JSON of the form:',
    '{',
    '  "assurance": "PASS" | "REVIEW" | "FAIL",',
    '  "assuranceStatement": "1-2 sentence overall verdict on the integrity of the computed figures",',
    '  "controlAssessment": "short assessment of whether the reconciliation controls and totals are internally consistent",',
    '  "findings": [ { "claimId": "<id or ALL>", "severity": "high|medium|low", "issue": "what is wrong or risky", "recommendation": "concrete action" } ],',
    '  "confidence": 0-1',
    '}',
    'Rank findings most-severe first. If no genuine issues, return an empty findings array and assurance "PASS".',
  ].join('\n');

  const content = await chatCompletion({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0,
  });
  const parsed = parseModelJson(content, 'AI calculation review');
  return {
    assurance: ['PASS', 'REVIEW', 'FAIL'].includes(parsed.assurance) ? parsed.assurance : 'REVIEW',
    assuranceStatement: parsed.assuranceStatement || '',
    controlAssessment: parsed.controlAssessment || '',
    findings: Array.isArray(parsed.findings) ? parsed.findings : [],
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.7,
    model: config.openaiModel,
  };
}
