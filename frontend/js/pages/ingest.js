function switchIngestTab(tab) {
  document.querySelectorAll('.itab').forEach((t, i) => t.classList.toggle('active', ['file', 'url'][i] === tab));
  document.getElementById('ingest-file-panel').style.display = tab === 'file' ? 'block' : 'none';
  document.getElementById('ingest-url-panel').style.display = tab === 'url' ? 'block' : 'none';
}

function handleFileSelect(e) {
  if (e.target.files[0]) processFile(e.target.files[0]);
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

// Drag-and-drop must be re-bound every time the ingest fragment is mounted
// (the elements are recreated on innerHTML injection).
function initIngestPage() {
  const ingestZone = document.getElementById('ingest-zone');
  if (!ingestZone || ingestZone.dataset.bound) return;
  ingestZone.dataset.bound = '1';
  ingestZone.addEventListener('dragover', e => {
    e.preventDefault();
    ingestZone.classList.add('drag');
  });
  ingestZone.addEventListener('dragleave', () => ingestZone.classList.remove('drag'));
  ingestZone.addEventListener('drop', e => {
    e.preventDefault();
    ingestZone.classList.remove('drag');
    if (e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]);
  });
}

registerPageInit('ingest', initIngestPage);
