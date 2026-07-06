import { config } from './config.js';

// Build the executive-summary email (both HTML and plain text) from computed data.
// Numbers come straight from the deterministic summary; narrative prose from GPT-4.1.

function money(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function int(n) {
  return Number(n || 0).toLocaleString('en-US');
}
function pct(n) {
  return Number(n || 0).toFixed(1) + '%';
}

function htmlTable(headers, rows, aligns = []) {
  const thead = headers
    .map((h, i) => `<th style="background:#1F3864;color:#fff;padding:8px 10px;text-align:${aligns[i] || 'left'};font-size:12px;border:1px solid #33456b;">${h}</th>`)
    .join('');
  const tbody = rows
    .map(
      (r, ri) =>
        `<tr style="background:${ri % 2 ? '#f7f9fc' : '#ffffff'};">` +
        r
          .map(
            (c, i) =>
              `<td style="padding:7px 10px;text-align:${aligns[i] || 'left'};font-size:12px;border:1px solid #e2e6ee;">${c}</td>`
          )
          .join('') +
        '</tr>'
    )
    .join('');
  return `<table style="border-collapse:collapse;width:100%;margin:6px 0 18px;">${`<tr>${thead}</tr>`}${tbody}</table>`;
}

function section(title) {
  return `<h3 style="color:#1F3864;font-family:Segoe UI,Arial,sans-serif;margin:22px 0 4px;border-bottom:2px solid #2A9D8F;padding-bottom:4px;">${title}</h3>`;
}

export function buildExecutiveEmail(summary, narrative, meta) {
  const s = summary;

  // ── HTML version ──
  const parts = [];
  parts.push(
    `<div style="font-family:Segoe UI,Arial,sans-serif;color:#20232a;max-width:860px;margin:auto;">`
  );
  parts.push(
    `<div style="background:#1F3864;color:#fff;padding:20px 24px;border-radius:6px 6px 0 0;">
      <div style="font-size:22px;font-weight:700;">Executive Summary — Revenue Cycle</div>
      <div style="font-size:13px;opacity:.85;margin-top:4px;">Prepared for ${meta.provider || 'Provider'} · ${new Date(s.generatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} · ${int(s.recordCount)} claims analyzed</div>
    </div>`
  );
  parts.push(`<div style="padding:8px 24px 24px;border:1px solid #e2e6ee;border-top:none;">`);

  if (narrative?.headline) {
    parts.push(
      `<p style="font-size:15px;font-weight:600;color:#2A9D8F;margin:16px 0 4px;">${narrative.headline}</p>`
    );
  }
  if (narrative?.overview) {
    parts.push(`<p style="font-size:13px;line-height:1.55;">${narrative.overview}</p>`);
  }

  // 1. Synopsis of Major CPT
  parts.push(section('Synopsis of Major CPT (Top 6 CPTs)'));
  parts.push(
    htmlTable(
      ['CPT', '# of Claims', 'Charges Billed', 'Payment Received', 'Avg Payment Received'],
      s.topCpts.map((c) => [c.cpt, int(c.claims), money(c.chargesBilled), money(c.paymentReceived), money(c.avgPaymentReceived)]),
      ['left', 'right', 'right', 'right', 'right']
    )
  );

  // 2. Overall AR Distribution
  parts.push(section(`Overall AR Distribution (Outstanding Balance &gt; $${config.arMinBalance})`));
  parts.push(
    htmlTable(
      ['A/R Days', '# of Claims', 'Total O/S', 'AR %'],
      s.arDistribution.rows.map((r) => [r.arDays, int(r.claims), money(r.totalOs), pct(r.arPercent)]),
      ['left', 'right', 'right', 'right']
    )
  );

  // 3. Claims with $0.00 payment
  parts.push(section('Claims with $0.00 Payment'));
  parts.push(
    htmlTable(
      ['A/R Days', '# of Claims', 'Total O/S', 'AR %'],
      s.zeroPaymentClaims.rows.map((r) => [r.arDays, int(r.claims), money(r.totalOs), pct(r.arPercent)]),
      ['left', 'right', 'right', 'right']
    )
  );

  // 4. Payment Posted by Month
  parts.push(section('Payment Posted by Month'));
  parts.push(
    htmlTable(
      ['Payment Posted Month', '# of Payments', 'Total Payment Received'],
      s.paymentByMonth.rows.map((r) => [r.month, int(r.payments), money(r.totalPaymentReceived)]),
      ['left', 'right', 'right']
    )
  );

  // 5. Insurance over 120 days
  parts.push(section('Insurance with Claims Over 120+ Days'));
  parts.push(
    htmlTable(
      ['Insurance', '# of Claims', 'Total O/S', 'AR %'],
      s.insuranceOver120.rows.map((r) => [r.insurance, int(r.claims), money(r.totalOs), pct(r.arPercent)]),
      ['left', 'right', 'right', 'right']
    )
  );

  if (narrative?.recommendations?.length) {
    parts.push(section('Recommended Actions'));
    parts.push(
      `<ul style="font-size:13px;line-height:1.6;">${narrative.recommendations.map((r) => `<li>${r}</li>`).join('')}</ul>`
    );
  }

  parts.push(
    `<p style="font-size:11px;color:#8a94a6;margin-top:24px;border-top:1px solid #e2e6ee;padding-top:10px;">All figures computed deterministically from the uploaded source file and reconciled (${s.reconciliation.overall}). Full detail is available in the attached Excel workbook.</p>`
  );
  parts.push(`</div></div>`);

  const html = parts.join('\n');

  // ── Plain-text version (from narrative + tables) ──
  const text = narrative?.emailBody
    ? narrative.emailBody
    : buildPlainText(s, narrative, meta);

  const subject = `Executive Summary — Revenue Cycle Report (${new Date(s.generatedAt).toLocaleDateString('en-US')})`;

  return { subject, html, text };
}

function buildPlainText(s, narrative, meta) {
  const L = [];
  L.push(`EXECUTIVE SUMMARY — REVENUE CYCLE`);
  L.push(`Prepared for ${meta.provider || 'Provider'} · ${int(s.recordCount)} claims`);
  L.push('');
  if (narrative?.headline) L.push(narrative.headline);
  if (narrative?.overview) L.push(narrative.overview);
  L.push('');
  L.push('SYNOPSIS OF MAJOR CPT (TOP 6)');
  s.topCpts.forEach((c) =>
    L.push(`  ${c.cpt} | ${int(c.claims)} claims | ${money(c.chargesBilled)} billed | ${money(c.paymentReceived)} paid | ${money(c.avgPaymentReceived)} avg`)
  );
  L.push('');
  L.push(`OVERALL AR DISTRIBUTION (O/S > $${config.arMinBalance})`);
  s.arDistribution.rows.forEach((r) =>
    L.push(`  ${r.arDays} | ${int(r.claims)} claims | ${money(r.totalOs)} | ${pct(r.arPercent)}`)
  );
  L.push('');
  L.push('CLAIMS WITH $0.00 PAYMENT');
  s.zeroPaymentClaims.rows.forEach((r) =>
    L.push(`  ${r.arDays} | ${int(r.claims)} claims | ${money(r.totalOs)} | ${pct(r.arPercent)}`)
  );
  L.push('');
  L.push('PAYMENT POSTED BY MONTH');
  s.paymentByMonth.rows.forEach((r) =>
    L.push(`  ${r.month} | ${int(r.payments)} payments | ${money(r.totalPaymentReceived)}`)
  );
  L.push('');
  L.push('INSURANCE WITH CLAIMS OVER 120+ DAYS');
  s.insuranceOver120.rows.forEach((r) =>
    L.push(`  ${r.insurance} | ${int(r.claims)} claims | ${money(r.totalOs)} | ${pct(r.arPercent)}`)
  );
  if (narrative?.recommendations?.length) {
    L.push('');
    L.push('RECOMMENDED ACTIONS');
    narrative.recommendations.forEach((r) => L.push(`  - ${r}`));
  }
  return L.join('\n');
}
