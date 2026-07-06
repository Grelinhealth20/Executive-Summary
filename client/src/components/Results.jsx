import React, { useMemo, useState } from 'react';
import DataTable from './DataTable.jsx';
import KpiCards from './KpiCards.jsx';
import { money, moneyShort, int, pct } from '../format.js';

const moneyCol = (v) => money(v);
const intCol = (v) => int(v);
const pctCol = (v) => pct(v);

const SECTIONS = [
  { id: 'summary', label: 'Executive Summary', ico: '📈' },
  { id: 'financial', label: 'A/R & Opportunities', ico: '💰' },
  { id: 'assurance', label: 'Assurance Review', ico: '🛡️' },
  { id: 'validation', label: 'Validation', ico: '✔️' },
  { id: 'email', label: 'Provider Email', ico: '✉️' },
  { id: 'mapping', label: 'Data Mapping', ico: '🗂️' },
];

export default function Results({ result }) {
  const [tab, setTab] = useState('summary');
  const { summary, email, narrative, aiReview, reconciliation, meta, learning, stats } = result;

  const generated = summary.generatedAt ? new Date(summary.generatedAt) : new Date();
  const dateStr = generated.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const counts = {
    assurance: aiReview?.findings?.length || 0,
    validation: reconciliation.checks.filter((c) => c.status === 'FAIL').length,
  };

  return (
    <div className="report">
      {/* Masthead */}
      <div className="masthead">
        <div>
          <div className="eyebrow">Revenue Cycle Executive Report</div>
          <div className="provider">{meta.provider || 'Provider Practice'}</div>
          <div className="report-title">Executive Summary &amp; Revenue-Cycle Analysis</div>
          <div className="meta-line">
            <span className="mi">🗓 <b>{dateStr}</b></span>
            <span className="mi">📄 <b>{int(summary.recordCount)}</b> claims</span>
            <span className="mi">🏥 <b>{summary.payerCount}</b> payers</span>
            <span className="mi">🔖 <b>{summary.cptCount}</b> CPTs</span>
            <span className="mi">⚡ processed in <b>{(stats.elapsedMs / 1000).toFixed(1)}s</b></span>
          </div>
        </div>
        <div className="masthead-right">
          <span className={`recon-chip ${reconciliation.overall === 'PASS' ? 'pass' : 'fail'}`}>
            <span className="dot" />
            {reconciliation.overall === 'PASS' ? 'Reconciled — All Controls Passed' : 'Reconciliation Exceptions Found'}
          </span>
          <div className="masthead-actions">
            <a className="btn btn-primary btn-sm" href={result.downloadUrl} download={result.filename}>
              ⬇ Download Excel Workbook
            </a>
            <button className="btn btn-ghost btn-sm" onClick={() => window.print()}>🖨 Print</button>
          </div>
        </div>
      </div>

      {/* KPI scorecard */}
      <KpiCards kpis={summary.kpis} />

      {/* Section navigation */}
      <nav className="section-nav">
        {SECTIONS.map((s) => (
          <button key={s.id} className={`snav-btn ${tab === s.id ? 'active' : ''}`} onClick={() => setTab(s.id)}>
            <span className="snav-ico">{s.ico}</span>
            {s.label}
            {counts[s.id] > 0 && <span className="snav-count">{counts[s.id]}</span>}
          </button>
        ))}
      </nav>

      {tab === 'summary' && <ExecutiveSummary summary={summary} narrative={narrative} />}
      {tab === 'financial' && <AgingAndOpportunities summary={summary} />}
      {tab === 'assurance' && <Assurance aiReview={aiReview} summary={summary} />}
      {tab === 'validation' && <Validation reconciliation={reconciliation} ingestion={summary.ingestion} />}
      {tab === 'email' && <EmailPreview email={email} />}
      {tab === 'mapping' && <Mapping meta={meta} learning={learning} />}
    </div>
  );
}

function Section({ eyebrow, title, desc, right, children }) {
  return (
    <div className="rsection">
      <div className="rsection-head">
        <div>
          <div className="eyebrow">{eyebrow}</div>
          <h3>{title}</h3>
          {desc && <div className="rs-desc">{desc}</div>}
        </div>
        {right}
      </div>
      <div className="rsection-body">{children}</div>
    </div>
  );
}

/* ── Collections composition: where every billed dollar went ── */
function CompositionBar({ kpis }) {
  const total = kpis.totalCharges || 0;
  if (total <= 0) return null;
  const segs = [
    { key: 'primary', label: 'Insurance (Primary)', value: kpis.totalPrimaryPayments || 0, cls: 'primary', color: 'var(--teal)' },
    { key: 'secondary', label: 'Insurance (Secondary)', value: kpis.totalSecondaryPayments || 0, cls: 'secondary', color: '#2f7d8f' },
    { key: 'patient', label: 'Patient Payments', value: kpis.totalPatientPayments || 0, cls: 'patient', color: 'var(--gold)' },
    { key: 'adj', label: 'Adjustments / Write-offs', value: kpis.totalAdjustments || 0, cls: 'adj', color: '#8a94a6' },
    { key: 'os', label: 'Outstanding A/R', value: kpis.totalOutstanding || 0, cls: 'os', color: 'var(--navy-light)' },
  ].filter((s) => s.value > 0);
  const shown = segs.reduce((s, x) => s + x.value, 0);
  return (
    <>
      <div className="compbar">
        {segs.map((s) => {
          const w = Math.max((s.value / total) * 100, 0);
          return (
            <div
              key={s.key}
              className={`compbar-seg ${s.cls}`}
              style={{ flexBasis: `${w}%` }}
              title={`${s.label}: ${money(s.value)} (${pct((s.value / total) * 100)})`}
            >
              {w >= 9 ? pct((s.value / total) * 100) : ''}
            </div>
          );
        })}
      </div>
      <div className="comp-legend">
        {segs.map((s) => (
          <span className="cl" key={s.key}>
            <span className="sw" style={{ background: s.color }} />
            {s.label} — <strong className="mono">{money(s.value)}</strong>
          </span>
        ))}
      </div>
      <div className="muted-note">
        Composition of <strong>{money(total)}</strong> billed
        {shown < total - 0.5 && ` (unclassified: ${money(total - shown)})`}. Collected total ={' '}
        <strong>{money(kpis.totalPayments)}</strong>.
      </div>
    </>
  );
}

function ExecutiveSummary({ summary, narrative }) {
  return (
    <Section
      eyebrow="Section 01 · Overview"
      title="Executive Summary"
      desc="Board-ready synopsis of billing performance, collections, and outstanding receivables for the uploaded reporting period."
    >
      {narrative?.headline && (
        <div className="narrative-hero">
          <div className="nh-headline">{narrative.headline}</div>
          {narrative.overview && <div className="nh-overview">{narrative.overview}</div>}
        </div>
      )}

      <div className="block-title">Collections Composition</div>
      <CompositionBar kpis={summary.kpis} />

      <div className="block-title">Synopsis of Major CPT (Top 6 by Charges)</div>
      <DataTable
        columns={[
          { header: 'CPT', key: 'cpt' },
          { header: '# of Claims', key: 'claims', align: 'right', render: intCol, footer: intCol },
          { header: 'Charges Billed', key: 'chargesBilled', align: 'right', render: moneyCol, footer: moneyCol },
          { header: 'Payment Received', key: 'paymentReceived', align: 'right', render: moneyCol, footer: moneyCol },
          { header: 'Avg Payment', key: 'avgPaymentReceived', align: 'right', render: moneyCol },
        ]}
        rows={summary.topCpts}
        totals={sumRows(summary.topCpts, ['claims', 'chargesBilled', 'paymentReceived'])}
      />

      <div className="block-title">Overall A/R Distribution (Outstanding &gt; $10)</div>
      <ArTable table={summary.arDistribution} />

      <div className="block-title">Claims with $0.00 Payment</div>
      <ArTable table={summary.zeroPaymentClaims} />

      <div className="block-title">Payment Posted by Month</div>
      <DataTable
        columns={[
          { header: 'Payment Posted Month', key: 'month' },
          { header: '# of Payments', key: 'payments', align: 'right', render: intCol, footer: intCol },
          { header: 'Total Payment Received', key: 'totalPaymentReceived', align: 'right', render: moneyCol, footer: moneyCol },
        ]}
        rows={summary.paymentByMonth.rows}
        totals={summary.paymentByMonth.totals}
      />

      <div className="block-title">Insurance with Claims Over 120+ Days</div>
      <DataTable
        columns={[
          { header: 'Insurance', key: 'insurance' },
          { header: '# of Claims', key: 'claims', align: 'right', render: intCol, footer: intCol },
          { header: 'Total O/S', key: 'totalOs', align: 'right', render: moneyCol, footer: moneyCol },
          { header: 'A/R %', key: 'arPercent', align: 'right', render: pctCol },
        ]}
        rows={summary.insuranceOver120.rows}
        totals={summary.insuranceOver120.totals}
      />
    </Section>
  );
}

function ArTable({ table }) {
  return (
    <DataTable
      columns={[
        { header: 'A/R Days', key: 'arDays' },
        { header: '# of Claims', key: 'claims', align: 'right', render: intCol, footer: intCol },
        { header: 'Total O/S', key: 'totalOs', align: 'right', render: moneyCol, footer: moneyCol },
        { header: 'A/R %', key: 'arPercent', align: 'right', render: pctCol },
      ]}
      rows={table.rows}
      totals={table.totals}
    />
  );
}

function AgingAndOpportunities({ summary }) {
  return (
    <Section
      eyebrow="Section 02 · Receivables"
      title="A/R Aging &amp; Revenue Opportunities"
      desc="Aging of all outstanding balances and quantified, actionable recovery opportunities from underpayments and denials."
    >
      <div className="block-title">A/R Aging (All Outstanding)</div>
      <ArTable table={summary.arAging} />
      <div className="callout warn">
        <strong>120+ Day Rollup:</strong> {int(summary.arAging.over120.claims)} claims ·{' '}
        {money(summary.arAging.over120.totalOs)} outstanding ({pct(summary.arAging.over120.arPercent)} of A/R)
      </div>

      <div className="block-title">Quantified Opportunities</div>
      <div className="opp-grid">
        <div className="opp-card">
          <div className="opp-label">Underpayment Opportunity</div>
          <div className="opp-value">{money(summary.underpayment.totalOpportunity)}</div>
          <div className="opp-sub">{int(summary.underpayment.count)} paid claims below allowed amount</div>
        </div>
        <div className="opp-card red">
          <div className="opp-label">Denial Recoverable</div>
          <div className="opp-value">{money(summary.denials.totalRecoverable)}</div>
          <div className="opp-sub">{int(summary.denials.count)} denied claims with open balance</div>
        </div>
      </div>

      {summary.denials.byReason?.length > 0 && (
        <>
          <div className="block-title">Denials by Reason</div>
          <DataTable
            columns={[
              { header: 'Denial Reason', key: 'reason' },
              { header: '# of Claims', key: 'claims', align: 'right', render: intCol },
              { header: 'Outstanding', key: 'outstanding', align: 'right', render: moneyCol },
            ]}
            rows={summary.denials.byReason}
          />
        </>
      )}
    </Section>
  );
}

function Assurance({ aiReview, summary }) {
  const right = aiReview ? (
    <span className={`pill ${aiReview.assurance === 'PASS' ? 'pass' : aiReview.assurance === 'FAIL' ? 'fail' : 'review'}`}>
      {aiReview.assurance}
    </span>
  ) : null;

  if (!aiReview) {
    return (
      <Section eyebrow="Section 03 · Integrity" title="Assurance Review"
        desc="Independent claim-level review of the computed figures.">
        <div className="callout warn">
          The automated assurance review is offline. The deterministic engine still flagged{' '}
          <strong>{int(summary.anomalyCandidateCount)}</strong> claim-level anomaly candidate(s) — see the Excel
          <em> Assurance Review</em> tab. Deterministic controls remain fully authoritative.
        </div>
      </Section>
    );
  }

  const cls = aiReview.assurance === 'PASS' ? 'pass' : aiReview.assurance === 'FAIL' ? 'fail' : 'review';
  const icon = aiReview.assurance === 'PASS' ? '✅' : aiReview.assurance === 'FAIL' ? '⛔' : '⚠️';
  return (
    <Section
      eyebrow="Section 03 · Integrity"
      title="Assurance Review"
      desc="Independent claim-level integrity review. The review assesses consistency and flags data-quality risks — it never alters the numbers."
      right={right}
    >
      <div className={`verdict ${cls}`}>
        <div className="verdict-badge">{icon}</div>
        <div>
          <div className="v-status">{aiReview.assurance}</div>
          <div className="v-statement">{aiReview.assuranceStatement}</div>
          {aiReview.controlAssessment && <div className="v-detail">{aiReview.controlAssessment}</div>}
          <div className="v-meta">
            Confidence: {Math.round((aiReview.confidence || 0) * 100)}% · Deterministic anomaly candidates:{' '}
            {int(summary.anomalyCandidateCount)}
          </div>
        </div>
      </div>

      <div className="block-title">Claim-Level Findings</div>
      {aiReview.findings?.length ? (
        <DataTable
          columns={[
            { header: 'Claim ID', key: 'claimId' },
            { header: 'Severity', key: 'severity', render: (v) => <span className={`pill ${String(v || '').toLowerCase()}`}>{v}</span> },
            { header: 'Issue', key: 'issue' },
            { header: 'Recommendation', key: 'recommendation' },
          ]}
          rows={aiReview.findings}
        />
      ) : (
        <div className="empty-note">✓ The assurance review found no genuine issues.</div>
      )}
    </Section>
  );
}

function Validation({ reconciliation, ingestion }) {
  const passCount = reconciliation.checks.filter((c) => c.status === 'PASS').length;
  const right = (
    <span className={`pill ${reconciliation.overall === 'PASS' ? 'pass' : 'fail'}`}>
      {passCount}/{reconciliation.checks.length} PASSED
    </span>
  );
  return (
    <Section
      eyebrow="Section 04 · Controls"
      title="Validation &amp; Reconciliation"
      desc="Provable accounting controls. Every ingested row is either a used claim or an audited skip, and financial identities are reconciled to the cent."
      right={right}
    >
      {ingestion && (
        <>
          <div className="block-title">Row Conservation</div>
          <div className="kv-grid">
            <div className="kv"><div className="k">Data Rows</div><div className="v">{int(ingestion.totalDataRows)}</div></div>
            <div className="kv"><div className="k">Used Claims</div><div className="v">{int(ingestion.usedRecords)}</div></div>
            <div className="kv"><div className="k">Skipped (audited)</div><div className="v">{int(ingestion.skippedCount)}</div></div>
            <div className="kv"><div className="k">Worksheets Ingested</div><div className="v">{ingestion.sheetsUsed.length}/{ingestion.workbookSheetCount}</div></div>
          </div>
          <div className={`callout ${ingestion.conservationOk && ingestion.sheetsIgnored.length === 0 ? '' : 'danger'}`}>
            <span className={`pill ${ingestion.conservationOk ? 'pass' : 'fail'}`}>{ingestion.conservationOk ? 'BALANCED' : 'MISMATCH'}</span>{' '}
            {int(ingestion.totalDataRows)} data rows = {int(ingestion.usedRecords)} used + {int(ingestion.skippedCount)} skipped.
            {' '}Ingested: {ingestion.sheetsUsed.map((s) => `${s.name} (${int(s.rows)})`).join(', ')}
            {ingestion.sheetsIgnored.length > 0 && (
              <span style={{ color: 'var(--red)' }}> · ⚠ Not ingested (different structure): {ingestion.sheetsIgnored.map((s) => `${s.name} (${int(s.rows)})`).join(', ')}</span>
            )}
          </div>
          {ingestion.skippedCount > 0 && (
            <>
              <div className="block-title">Skipped Rows ({int(ingestion.skippedCount)}) — accounted for, not billing lines</div>
              <DataTable
                columns={[
                  { header: 'Sheet', key: 'sheet', render: (v) => v || '(primary)' },
                  { header: 'Row #', key: 'rowNumber', align: 'right', render: intCol },
                  { header: 'Reason', key: 'reason' },
                  { header: 'Raw CPT', key: 'rawCpt', render: (v) => (v == null ? '—' : String(v)) },
                  { header: 'Raw Charges', key: 'rawCharges', render: (v) => (v == null ? '—' : String(v)) },
                  { header: 'Raw Payer', key: 'rawPayer', render: (v) => (v == null ? '—' : String(v)) },
                ]}
                rows={ingestion.skippedRows}
              />
              {ingestion.skippedCount > ingestion.skippedRows.length && (
                <div className="muted-note">Showing first {ingestion.skippedRows.length}; full list in the Excel “Data Ingestion Audit” tab.</div>
              )}
            </>
          )}
        </>
      )}

      <div className="block-title">Reconciliation Controls</div>
      <DataTable
        columns={[
          { header: 'Status', key: 'status', render: (v) => <span className={`pill ${v === 'PASS' ? 'pass' : 'fail'}`}>{v}</span> },
          { header: 'Control', key: 'name' },
          { header: 'Detail', key: 'detail' },
        ]}
        rows={reconciliation.checks}
      />
      <div className="muted-note">
        {reconciliation.skippedCount} row(s) skipped · {reconciliation.totalRecords} claims analyzed · derived A/R days:{' '}
        {reconciliation.derived.arDaysFromServiceDate} · derived totals: {reconciliation.derived.totalPaymentFromParts}
      </div>
    </Section>
  );
}

// Copy to clipboard with a fallback for non-secure contexts where
// navigator.clipboard is unavailable (e.g. plain-http LAN access).
async function copyToClipboard(value) {
  const text = value || '';
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(ta);
  if (!ok) throw new Error('Copy command was rejected by the browser.');
}

function EmailPreview({ email }) {
  const [copied, setCopied] = useState(false);
  const [copiedText, setCopiedText] = useState(false);
  const [copyError, setCopyError] = useState('');
  const srcDoc = useMemo(() => email.html, [email.html]);

  const copyHtml = async () => {
    setCopyError('');
    try {
      await copyToClipboard(email.html);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
      setCopyError('Could not copy HTML to the clipboard.');
    }
  };
  const copyText = async () => {
    setCopyError('');
    try {
      await copyToClipboard(email.text);
      setCopiedText(true);
      setTimeout(() => setCopiedText(false), 1800);
    } catch {
      setCopiedText(false);
      setCopyError('Could not copy plain text to the clipboard.');
    }
  };

  return (
    <Section
      eyebrow="Section 05 · Communication"
      title="Provider Executive Email"
      desc="A ready-to-send executive summary email. Paste the HTML directly into Outlook or Gmail, or copy the plain-text version."
    >
      <div className="email-toolbar">
        <span className="subj-label">Subject</span>
        <span className="subj-text">{email.subject}</span>
        <span style={{ flex: 1 }} />
        <button className="btn btn-ghost btn-sm" onClick={copyText}>{copiedText ? '✓ Copied' : '📋 Copy plain text'}</button>
        <button className="btn btn-primary btn-sm" onClick={copyHtml}>{copied ? '✓ Copied' : '📋 Copy HTML'}</button>
      </div>
      {copyError && <div className="error-box" style={{ marginTop: 0, marginBottom: 12 }}>⚠ {copyError}</div>}
      <div className="email-frame">
        <iframe title="Executive Email Preview" srcDoc={srcDoc} sandbox="" />
      </div>
      <div className="muted-note">This HTML email can be pasted directly into Outlook / Gmail and shared with the provider.</div>
    </Section>
  );
}

// Friendly labels for the internal mapping-strategy tokens (never expose model ids).
const STRATEGY_LABELS = {
  'learned-template': 'Recognized known template',
  'learned-associations': 'Learned column associations',
  heuristics: 'Heuristic synonym match',
};
function strategyLabel(token) {
  return STRATEGY_LABELS[token] || 'AI semantic mapping';
}

function Mapping({ meta, learning }) {
  const rows = Object.entries(meta.columnMapping || {}).map(([field, header]) => ({
    field,
    header: header || '— (not present / derived) —',
  }));
  const trace = meta.mappingTrace || {};
  const strategy = (trace.source || []).map(strategyLabel);
  return (
    <Section
      eyebrow="Section 06 · Data Lineage"
      title="Adaptive Column Mapping"
      desc="How each raw column in your file was resolved to a canonical financial field. The system learns recurring layouts and improves over time."
    >
      <div className="callout">
        <strong>Mapping strategy:</strong> {strategy.length ? strategy.join(' → ') : 'Heuristic synonym match'}
        {trace.aiUsed && ` · AI confidence ${Math.round((trace.aiConfidence || 0) * 100)}%`}
        {trace.templateRecall && ' · matched a previously learned layout'}
      </div>
      <div className="block-title">Resolved Column Mapping</div>
      <DataTable
        columns={[
          { header: 'Canonical Field', key: 'field' },
          { header: 'Mapped From Raw Column', key: 'header' },
        ]}
        rows={rows}
      />
      <div className="muted-note">
        Adaptive learning: {learning.uploadsProcessed} uploads processed · {learning.knownTemplates} known templates ·{' '}
        {learning.learnedHeaders} learned header associations.
      </div>
    </Section>
  );
}

// ── helpers ──
function sumRows(rows, keys) {
  const totals = {};
  for (const k of keys) totals[k] = rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  return totals;
}
