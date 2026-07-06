import React, { useEffect, useState } from 'react';
import Dropzone from './components/Dropzone.jsx';
import Results from './components/Results.jsx';
import { generateReport, getHealth } from './api.js';

export default function App() {
  const [file, setFile] = useState(null);
  const [provider, setProvider] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [health, setHealth] = useState(null);

  useEffect(() => {
    getHealth().then(setHealth).catch(() => setHealth({ status: 'down' }));
  }, []);

  const onGenerate = async () => {
    if (!file || busy) return;
    setBusy(true);
    setError('');
    setResult(null);
    setProgress(0);
    setPhase('Uploading file…');
    try {
      const res = await generateReport(file, provider, (p) => {
        setProgress(p);
        if (p >= 100) setPhase('Processing: mapping columns, computing metrics & AI review…');
      });
      setResult(res);
      setPhase('');
    } catch (err) {
      setError(err.message || 'Generation failed.');
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setFile(null);
    setResult(null);
    setError('');
    setProgress(0);
    setPhase('');
  };

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Executive Summary &amp; Report Generator</h1>
          <div className="sub">Enterprise revenue-cycle analytics · deterministic financial engine with automated assurance</div>
        </div>
        <div className="header-badges">
          {health && (
            <>
              <span className={`badge ${health.aiConfigured ? 'ok' : 'warn'}`}>
                {health.aiConfigured ? 'Assurance: active' : 'Assurance: offline'}
              </span>
              {health.learning && (
                <span className="badge">{health.learning.uploadsProcessed} reports learned</span>
              )}
            </>
          )}
        </div>
      </header>

      <div className="container">
        <div className="panel">
          <h2>Generate an Executive Report</h2>
          <p className="hint">
            Upload a raw claims / revenue-cycle report. The system maps columns adaptively, computes every
            figure deterministically at the claim level, runs an automated assurance review, and produces a
            CFO-ready executive summary email plus a fully formatted Excel workbook.
          </p>

          <div className="field">
            <label htmlFor="provider">Provider / Practice name (optional — appears on the report)</label>
            <input
              id="provider"
              type="text"
              placeholder="e.g. Grelin Health — Cardiology"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              disabled={busy}
            />
          </div>

          <Dropzone file={file} onFile={setFile} disabled={busy} />

          {busy && (
            <>
              <div className="progress">
                <span style={{ width: `${Math.max(progress, 8)}%` }} />
              </div>
              <div className="muted-note">{phase}</div>
            </>
          )}

          {error && <div className="error-box">⚠ {error}</div>}

          <div className="actions">
            <button className="btn btn-primary" onClick={onGenerate} disabled={!file || busy}>
              {busy ? <><span className="spinner" /> &nbsp;Generating…</> : 'Generate Report'}
            </button>
            {(file || result) && (
              <button className="btn btn-ghost" onClick={reset} disabled={busy}>
                Reset
              </button>
            )}
          </div>
        </div>

        {result && <Results result={result} />}
      </div>

      <footer className="footer">
        All financial figures are computed deterministically (integer-cent arithmetic) and reconciled with PASS/FAIL controls.
        Automated assurance performs adaptive column mapping, claim-level review, and narrative generation — it never alters the numbers.
      </footer>
    </div>
  );
}
