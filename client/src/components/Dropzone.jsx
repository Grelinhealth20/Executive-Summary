import React, { useCallback, useRef, useState } from 'react';

const ACCEPT = '.xlsx,.xls,.xlsm,.csv';

export default function Dropzone({ file, onFile, disabled }) {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef(null);

  const handleFiles = useCallback(
    (files) => {
      if (disabled) return;
      if (files && files.length) onFile(files[0]);
    },
    [onFile, disabled]
  );

  return (
    <div
      className={`dropzone ${drag ? 'drag' : ''} ${file ? 'has-file' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        handleFiles(e.dataTransfer.files);
      }}
      onClick={() => !disabled && inputRef.current?.click()}
      role="button"
      tabIndex={0}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        style={{ display: 'none' }}
        onChange={(e) => handleFiles(e.target.files)}
      />
      <div className="dz-icon">📄</div>
      {file ? (
        <>
          <div className="dz-title">Ready to generate</div>
          <span className="file-chip">
            <strong>{file.name}</strong>
            <span className="dz-sub">({(file.size / 1024).toFixed(0)} KB)</span>
          </span>
          <div className="dz-sub" style={{ marginTop: 8 }}>Click to choose a different file</div>
        </>
      ) : (
        <>
          <div className="dz-title">Drag &amp; drop your raw report here</div>
          <div className="dz-sub">or click to browse — Excel (.xlsx, .xls, .xlsm) or CSV</div>
        </>
      )}
    </div>
  );
}
