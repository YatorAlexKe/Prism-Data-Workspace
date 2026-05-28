function switchIngestTab(tab) {
  const tabs = ['file', 'url', 'image'];
  document.querySelectorAll('.itab').forEach((t, i) => t.classList.toggle('active', tabs[i] === tab));
  document.getElementById('ingest-file-panel').style.display = tab === 'file' ? 'block' : 'none';
  document.getElementById('ingest-url-panel').style.display = tab === 'url' ? 'block' : 'none';
  document.getElementById('ingest-image-panel').style.display = tab === 'image' ? 'block' : 'none';
}

function handleFileSelect(e) {
  if (e.target.files[0]) processFile(e.target.files[0]);
}

function handleImageSelect(e) {
  if (e.target.files[0]) processImage(e.target.files[0]);
}

async function processImage(file) {
  showProgress('Scanning ' + file.name + ' for tables...');
  const fd = new FormData();
  fd.append('file', file);

  const hasHeaderEl = document.getElementById('image-has-header');
  const implicitRowsEl = document.getElementById('image-implicit-rows');
  const minConfEl = document.getElementById('image-min-confidence');
  const langEl = document.getElementById('image-lang');
  if (hasHeaderEl) fd.append('has_header', hasHeaderEl.checked ? 'true' : 'false');
  if (implicitRowsEl) fd.append('implicit_rows', implicitRowsEl.checked ? 'true' : 'false');
  if (minConfEl && minConfEl.value !== '') fd.append('min_confidence', minConfEl.value);
  if (langEl && langEl.value.trim()) fd.append('lang', langEl.value.trim());

  try {
    const res = await fetch(`${API}/ingest/image`, { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Image scan failed');
    showUploadResult(data);
    if (data.tables_found > 1) {
      const el = document.getElementById('upload-result');
      el.insertAdjacentHTML('beforeend',
        `<div style="margin-top:10px;font-size:12px;color:var(--yellow)">⚠ Found ${data.tables_found} tables in this image; showing table ${data.table_index + 1}.</div>`);
    }
    refreshDatasets();
  } catch (e) { showUploadError(e.message); }
  hideProgress();
}

async function processFile(file) {
  showProgress('Uploading and parsing ' + file.name + '...');
  const fd = new FormData();
  fd.append('file', file);
  try {
    const res = await fetch(`${API}/ingest/file`, { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Upload failed');
    showUploadResult(data);
    refreshDatasets();
  } catch (e) { showUploadError(e.message); }
  hideProgress();
}

async function handleUrlIngest() {
  const url = document.getElementById('url-input').value.trim();
  if (!url) return;
  showProgress('Fetching data from URL...');
  try {
    const res = await fetch(`${API}/ingest/url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Failed');
    showUploadResult(data);
    refreshDatasets();
  } catch (e) { showUploadError(e.message); }
  hideProgress();
}

function showProgress(msg) {
  document.getElementById('upload-progress').style.display = 'block';
  document.getElementById('progress-text').textContent = msg;
  document.getElementById('upload-result').style.display = 'none';
}

function hideProgress() {
  document.getElementById('upload-progress').style.display = 'none';
}

function showUploadResult(data) {
  const el = document.getElementById('upload-result');
  el.style.display = 'block';
  const q = data.profile?.quality_score || 0;
  const qColor = q > 80 ? 'var(--green)' : q > 60 ? 'var(--yellow)' : 'var(--red)';
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
      <div style="font-size:20px">✓</div>
      <div>
        <div style="font-size:14px;font-weight:600">${data.original_filename}</div>
        <div style="font-family:var(--mono);font-size:11px;color:var(--muted)">${data.row_count} rows · ${data.columns.length} columns · quality <span style="color:${qColor}">${q}%</span></div>
      </div>
      <div style="margin-left:auto;display:flex;gap:8px">
        <button class="btn btn-primary btn-sm" onclick="goQueryWith('${data.table_name}')">Query →</button>
        <button class="btn btn-blue btn-sm" onclick="goProfileWith('${data.table_name}')">Profile →</button>
      </div>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:6px">
      ${data.columns.map(c => `<span style="background:var(--surface2);border:1px solid var(--border);border-radius:4px;padding:3px 8px;font-family:var(--mono);font-size:11px">${c.name} <span style="color:var(--muted)">${c.type}</span></span>`).join('')}
    </div>
    ${data.profile?.warnings?.length ? `<div style="margin-top:12px">${data.profile.warnings.map(w => `<div style="font-size:12px;color:var(--yellow);margin-top:4px">⚠ ${w}</div>`).join('')}</div>` : ''}
  `;
}

function showUploadError(msg) {
  const el = document.getElementById('upload-result');
  el.style.display = 'block';
  el.innerHTML = `<div class="error-box">⚠ ${msg}</div>`;
}

function bindDropZone(id, processor) {
  const zone = document.getElementById(id);
  if (!zone || zone.dataset.bound) return;
  zone.dataset.bound = '1';
  zone.addEventListener('dragover', e => {
    e.preventDefault();
    zone.classList.add('drag');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag');
    if (e.dataTransfer.files[0]) processor(e.dataTransfer.files[0]);
  });
}

// Drop zones must be re-bound every time the ingest fragment is mounted
// (the elements are recreated on innerHTML injection).
function initIngestPage() {
  bindDropZone('ingest-zone', processFile);
  bindDropZone('ingest-image-zone', processImage);
}

registerPageInit('ingest', initIngestPage);

async function handleGSheetImport() {
  const url = document.getElementById('gsheet-url').value.trim();
  const tab = document.getElementById('gsheet-tab').value.trim() || null;
  if (!url) { alert('Please enter a Google Sheets URL.'); return; }

  showProgress('Importing from Google Sheets...');
  try {
    const res = await fetch(`${API}/sheets/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, sheet_name: tab })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Import failed');
    showUploadResult(data);
    if (typeof refreshDatasets === 'function') refreshDatasets();
  } catch(e) { showUploadError(e.message); }
  hideProgress();
}

async function getServiceAccountEmail() {
  try {
    const res = await fetch(`${API}/sheets/service-account-email`);
    const data = await res.json();
    const el = document.getElementById('gsheet-email');
    el.style.display = 'block';
    el.innerHTML = `
      <div style="color:var(--muted);margin-bottom:4px">Share your Google Sheet with this email:</div>
      <div style="color:var(--green);font-weight:600">${data.email}</div>
      <button class="btn btn-ghost btn-sm" style="margin-top:8px" 
        onclick="navigator.clipboard.writeText('${data.email}');this.textContent='Copied!'">
        Copy Email
      </button>
    `;
  } catch(e) {
    alert('Could not load service account email: ' + e.message);
  }
}