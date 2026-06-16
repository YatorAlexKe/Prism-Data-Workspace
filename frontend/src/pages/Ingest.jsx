import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API } from '../api.js';
import { useApp } from '../AppContext.jsx';

// Ingest page — three tabs (File / URL+Google Sheets / Image OCR) sharing the
// same progress + result strip below them. Ports all logic from the old
// frontend/js/pages/ingest.js including the image-OCR form controls.
export default function Ingest() {
  const navigate = useNavigate();
  const { refreshDatasets, setCurrentTable, setSelectedTables } = useApp();

  const [tab, setTab] = useState('file');
  const [progress, setProgress] = useState(null); // string | null
  const [result, setResult] = useState(null);     // { ok, data } | { error } | null

  const showProgress = (msg) => { setProgress(msg); setResult(null); };
  const hideProgress = () => setProgress(null);

  const goQueryWith = (tableName) => {
    setSelectedTables([tableName]);
    setCurrentTable(tableName);
    navigate('/query');
  };
  const goProfileWith = (tableName) => {
    setCurrentTable(tableName);
    navigate('/profile');
  };

  return (
    <div className="page active">
      <div className="ingest-page">
        <div className="section-title" style={{ fontSize: 18, marginBottom: 16 }}>Import Data</div>

        <div className="ingest-tabs">
          <button className={`itab${tab === 'file' ? ' active' : ''}`} onClick={() => setTab('file')}>File Upload</button>
          <button className={`itab${tab === 'url' ? ' active' : ''}`} onClick={() => setTab('url')}>URL / Google Sheets</button>
          <button className={`itab${tab === 'image' ? ' active' : ''}`} onClick={() => setTab('image')}>Image (OCR)</button>
        </div>

        {tab === 'file' && <FilePanel onProgress={showProgress} onResult={setResult} onDone={hideProgress} refreshDatasets={refreshDatasets} />}
        {tab === 'url' && <UrlPanel onProgress={showProgress} onResult={setResult} onDone={hideProgress} refreshDatasets={refreshDatasets} />}
        {tab === 'image' && <ImagePanel onProgress={showProgress} onResult={setResult} onDone={hideProgress} refreshDatasets={refreshDatasets} />}

        {progress && (
          <div className="upload-progress" style={{ display: 'block' }}>
            <div className="progress-bar"></div>
            <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{progress}</div>
          </div>
        )}

        {result && (
          <div className="upload-result" style={{ display: 'block' }}>
            {result.error
              ? <div className="error-box">⚠ {result.error}</div>
              : <UploadResult data={result.data} extraNote={result.note} goQueryWith={goQueryWith} goProfileWith={goProfileWith} />}
          </div>
        )}
      </div>
    </div>
  );
}

// ───────── File upload panel ─────────
function FilePanel({ onProgress, onResult, onDone, refreshDatasets }) {
  const zoneRef = useRef(null);

  // Drag/drop wiring — equivalent to the old bindDropZone().
  useEffect(() => {
    const zone = zoneRef.current;
    if (!zone) return;
    const onOver = e => { e.preventDefault(); zone.classList.add('drag'); };
    const onLeave = () => zone.classList.remove('drag');
    const onDrop = e => {
      e.preventDefault();
      zone.classList.remove('drag');
      if (e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]);
    };
    zone.addEventListener('dragover', onOver);
    zone.addEventListener('dragleave', onLeave);
    zone.addEventListener('drop', onDrop);
    return () => {
      zone.removeEventListener('dragover', onOver);
      zone.removeEventListener('dragleave', onLeave);
      zone.removeEventListener('drop', onDrop);
    };
  }, []);

  const processFile = async (file) => {
    onProgress('Uploading and parsing ' + file.name + '...');
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch(`${API}/ingest/file`, { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Upload failed');
      onResult({ data });
      refreshDatasets();
    } catch (e) { onResult({ error: e.message }); }
    onDone();
  };

  return (
    // No onClick here — the <input> below is absolutely positioned to cover
    // the whole zone (see .ingest-zone input in ingest.css). Clicking the zone
    // already hits the input directly; programmatically calling .click() in an
    // onClick would re-trigger the picker AFTER the user selected a file
    // (because the click bubbles up), causing the picker to open twice.
    <div ref={zoneRef} className="ingest-zone">
      <input
        type="file"
        accept=".csv,.xlsx,.xls,.json"
        onChange={e => e.target.files[0] && processFile(e.target.files[0])}
      />
      <div className="ingest-icon">📂</div>
      <div className="ingest-label">Drop your file here or click to browse</div>
      <div className="ingest-sub" style={{ marginTop: 6 }}>Supports CSV · Excel (.xlsx) · JSON</div>
    </div>
  );
}

// ───────── URL + Google Sheets panel ─────────
function UrlPanel({ onProgress, onResult, onDone, refreshDatasets }) {
  const [url, setUrl] = useState('');
  const [gsheetUrl, setGsheetUrl] = useState('');
  const [gsheetTab, setGsheetTab] = useState('');
  const [serviceEmail, setServiceEmail] = useState(null);

  const handleUrlIngest = async () => {
    const u = url.trim();
    if (!u) return;
    onProgress('Fetching data from URL...');
    try {
      const res = await fetch(`${API}/ingest/url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: u }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed');
      onResult({ data });
      refreshDatasets();
    } catch (e) { onResult({ error: e.message }); }
    onDone();
  };

  const handleGSheetImport = async () => {
    const u = gsheetUrl.trim();
    const tab = gsheetTab.trim() || null;
    if (!u) { alert('Please enter a Google Sheets URL.'); return; }
    onProgress('Importing from Google Sheets...');
    try {
      const res = await fetch(`${API}/sheets/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: u, sheet_name: tab }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Import failed');
      onResult({ data });
      refreshDatasets();
    } catch (e) { onResult({ error: e.message }); }
    onDone();
  };

  const getServiceAccountEmail = async () => {
    try {
      const res = await fetch(`${API}/sheets/service-account-email`);
      const data = await res.json();
      setServiceEmail(data.email);
    } catch (e) {
      alert('Could not load service account email: ' + e.message);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div className="config-label" style={{ marginBottom: 6 }}>Import from URL</div>
        <div className="url-input-row">
          <input
            type="url"
            placeholder="https://... public CSV or JSON URL"
            style={{ fontSize: 13 }}
            value={url}
            onChange={e => setUrl(e.target.value)}
          />
          <button className="btn btn-primary" onClick={handleUrlIngest}>Import</button>
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--muted)' }}>
          For public URLs only. Use the section below for private Google Sheets.
        </div>
      </div>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 8 }}>
        <div className="config-label" style={{ marginBottom: 10 }}>Import from Google Sheets (Private)</div>
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>Google Sheets URL</div>
          <input
            type="url"
            placeholder="https://docs.google.com/spreadsheets/d/..."
            style={{ width: '100%', fontSize: 12 }}
            value={gsheetUrl}
            onChange={e => setGsheetUrl(e.target.value)}
          />
        </div>
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>Sheet Tab (optional)</div>
          <input
            type="text"
            placeholder="Sheet1"
            style={{ width: '100%', fontSize: 12 }}
            value={gsheetTab}
            onChange={e => setGsheetTab(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={handleGSheetImport}>Import from Google Sheets</button>
          <button className="btn btn-ghost btn-sm" onClick={getServiceAccountEmail}>View Service Account Email</button>
        </div>
        {serviceEmail && (
          <div style={{ marginTop: 10, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', fontFamily: 'var(--mono)', fontSize: 12 }}>
            <div style={{ color: 'var(--muted)', marginBottom: 4 }}>Share your Google Sheet with this email:</div>
            <div style={{ color: 'var(--green)', fontWeight: 600 }}>{serviceEmail}</div>
            <button
              className="btn btn-ghost btn-sm"
              style={{ marginTop: 8 }}
              onClick={(e) => { navigator.clipboard.writeText(serviceEmail); e.currentTarget.textContent = 'Copied!'; }}
            >Copy Email</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ───────── Image OCR panel ─────────
function ImagePanel({ onProgress, onResult, onDone, refreshDatasets }) {
  const zoneRef = useRef(null);

  const [isolateTable, setIsolateTable] = useState(true);
  const [hasHeader, setHasHeader] = useState(true);
  const [implicitRows, setImplicitRows] = useState(false);
  const [unwrapLines, setUnwrapLines] = useState(true);
  const [minConfidence, setMinConfidence] = useState('25');
  const [lang, setLang] = useState('eng');

  useEffect(() => {
    const zone = zoneRef.current;
    if (!zone) return;
    const onOver = e => { e.preventDefault(); zone.classList.add('drag'); };
    const onLeave = () => zone.classList.remove('drag');
    const onDrop = e => {
      e.preventDefault();
      zone.classList.remove('drag');
      if (e.dataTransfer.files[0]) processImage(e.dataTransfer.files[0]);
    };
    zone.addEventListener('dragover', onOver);
    zone.addEventListener('dragleave', onLeave);
    zone.addEventListener('drop', onDrop);
    return () => {
      zone.removeEventListener('dragover', onOver);
      zone.removeEventListener('dragleave', onLeave);
      zone.removeEventListener('drop', onDrop);
    };
  });

  const processImage = async (file) => {
    onProgress('Scanning ' + file.name + ' for tables...');
    const fd = new FormData();
    fd.append('file', file);
    fd.append('isolate_table', isolateTable ? 'true' : 'false');
    fd.append('has_header', hasHeader ? 'true' : 'false');
    fd.append('implicit_rows', implicitRows ? 'true' : 'false');
    fd.append('unwrap_lines', unwrapLines ? 'true' : 'false');
    if (minConfidence !== '') fd.append('min_confidence', minConfidence);
    if (lang.trim()) fd.append('lang', lang.trim());
    try {
      const res = await fetch(`${API}/ingest/image`, { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Image scan failed');
      const note = data.tables_found > 1
        ? `⚠ Found ${data.tables_found} tables in this image; showing table ${data.table_index + 1}.`
        : null;
      onResult({ data, note });
      refreshDatasets();
    } catch (e) { onResult({ error: e.message }); }
    onDone();
  };

  return (
    <div>
      {/* No onClick on the zone — the <input> below covers it absolutely
          (see .ingest-zone input in ingest.css). A redundant programmatic
          .click() would re-open the picker after a file is selected because
          the original click bubbles up from the input. */}
      <div ref={zoneRef} className="ingest-zone">
        <input
          type="file"
          accept="image/png,image/jpeg,image/bmp,image/tiff,image/webp"
          onChange={e => e.target.files[0] && processImage(e.target.files[0])}
        />
        <div className="ingest-icon">🖼</div>
        <div className="ingest-label">Drop an image of a table or click to browse</div>
        <div className="ingest-sub" style={{ marginTop: 6 }}>Supports PNG · JPG · BMP · TIFF · WebP</div>
      </div>

      <div style={{ marginTop: 12, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
               title="Auto-detect the table's bounding box and crop to it before OCR. Strips surrounding paragraph text. Disable for borderless tables (no rules to detect).">
          <input type="checkbox" checked={isolateTable} onChange={e => setIsolateTable(e.target.checked)} />
          Isolate table region
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={hasHeader} onChange={e => setHasHeader(e.target.checked)} />
          First row is header
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
               title="Only enable for borderless tables. For ruled tables (visible grid lines) this option splits wrapped cell content across multiple rows.">
          <input type="checkbox" checked={implicitRows} onChange={e => setImplicitRows(e.target.checked)} />
          Detect implicit rows
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
               title="Glue short lowercase fragments onto the preceding word so 'Manchest er' → 'Manchester' and 'Departme nt' → 'Department'. Disable if your data contains legitimate short-word phrases like 'yes no'.">
          <input type="checkbox" checked={unwrapLines} onChange={e => setUnwrapLines(e.target.checked)} />
          Heal wrapped text
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          Min confidence
          <input
            type="number" min="0" max="100" style={{ width: 55 }}
            value={minConfidence}
            onChange={e => setMinConfidence(e.target.value)}
            title="Cells below this OCR confidence (0-100) are dropped. Lower → captures more cells with more noise."
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          Language
          <input
            type="text" placeholder="eng" style={{ width: 80 }}
            value={lang}
            onChange={e => setLang(e.target.value)}
            title="Tesseract language code, e.g. eng, fra, deu, eng+fra (requires matching language pack installed)"
          />
        </label>
      </div>

      <div style={{ marginTop: 10, fontSize: 11, color: 'var(--muted)' }}>
        "Isolate table region" crops away surrounding text/paragraphs so they don't pollute the scan — turn off for borderless tables. Image is then grayscaled, contrast-stretched, and upscaled before OCR. Lower the confidence threshold to capture more cells (at the cost of more noise). Enable "Detect implicit rows" only for tables without visible row borders.
      </div>
    </div>
  );
}

// ───────── Shared upload result block ─────────
function UploadResult({ data, extraNote, goQueryWith, goProfileWith }) {
  const q = data.profile?.quality_score || 0;
  const qColor = q > 80 ? 'var(--green)' : q > 60 ? 'var(--yellow)' : 'var(--red)';
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 20 }}>✓</div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{data.original_filename}</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>
            {data.row_count} rows · {data.columns.length} columns · quality <span style={{ color: qColor }}>{q}%</span>
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="btn btn-primary btn-sm" onClick={() => goQueryWith(data.table_name)}>Query →</button>
          <button className="btn btn-blue btn-sm" onClick={() => goProfileWith(data.table_name)}>Profile →</button>
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {data.columns.map((c, i) => (
          <span key={i} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, padding: '3px 8px', fontFamily: 'var(--mono)', fontSize: 11 }}>
            {c.name} <span style={{ color: 'var(--muted)' }}>{c.type}</span>
          </span>
        ))}
      </div>
      {data.profile?.warnings?.length > 0 && (
        <div style={{ marginTop: 12 }}>
          {data.profile.warnings.map((w, i) => (
            <div key={i} style={{ fontSize: 12, color: 'var(--yellow)', marginTop: 4 }}>⚠ {w}</div>
          ))}
        </div>
      )}
      {extraNote && (
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--yellow)' }}>{extraNote}</div>
      )}
    </>
  );
}
