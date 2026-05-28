async function loadDashboard() {
  try {
    const [dsRes, hRes, pRes, qRes] = await Promise.all([
      fetch(`${API}/datasets`), fetch(`${API}/query/history`),
      fetch(`${API}/projects`), fetch(`${API}/queries/saved`)
    ]);
    const ds = (await dsRes.json()).datasets || [];
    const hist = (await hRes.json()).history || [];
    const proj = (await pRes.json()).projects || [];
    const saved = (await qRes.json()).queries || [];

    allDatasets = ds;
    document.getElementById('stat-datasets').textContent = ds.length;
    document.getElementById('stat-queries').textContent = hist.length;
    document.getElementById('stat-saved').textContent = saved.length;
    document.getElementById('stat-projects').textContent = proj.length;
    document.getElementById('history-count').textContent = hist.length;

    document.getElementById('dashboard-datasets').innerHTML = ds.length
      ? ds.map(d => {
        const q = d.data_quality_score || 0;
        const qc = q > 80 ? 'var(--green)' : q > 60 ? 'var(--yellow)' : 'var(--red)';
        const fmtClass = `fmt-${d.file_format || 'csv'}`;
        return `<div class="dataset-card" onclick="goQueryWith('${d.table_name}')">
          <div class="dataset-card-name">
            <span>${d.name || d.table_name}</span>
            <span class="format-badge ${fmtClass}">${d.file_format || 'csv'}</span>
          </div>
          <div class="dataset-card-meta">
            <span>${d.row_count} rows</span>
            <span>${d.col_count} cols</span>
          </div>
          <div class="quality-bar"><div class="quality-fill" style="width:${q}%;background:${qc}"></div></div>
          <div class="dataset-card-actions">
            <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();goQueryWith('${d.table_name}')">Query</button>
            <button class="btn btn-blue btn-sm" onclick="event.stopPropagation();goProfileWith('${d.table_name}')">Profile</button>
            <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();openEditDataset('${d.table_name}')">✎ Edit</button>
          </div>
        </div>`;
      }).join('')
      : '<div style="color:var(--muted);font-size:13px;padding:20px 0">No datasets yet — <span style="color:var(--green);cursor:pointer" onclick="showPage(\'ingest\')">import one to get started</span></div>';

    document.getElementById('dashboard-history').innerHTML = hist.slice(0, 5).map(h => `
      <div class="history-item" onclick="replayQuery('${h.question?.replace(/'/g, "\\'") || ''}','${h.table_name}')">
        <div style="flex:1;min-width:0">
          <div class="hi-q">${h.question || '[Direct SQL]'}</div>
          <div class="hi-sql">${h.sql_query}</div>
        </div>
        <div class="hi-meta"><div>${h.row_count} rows</div></div>
      </div>`).join('') || '<div style="color:var(--muted);font-size:13px">No queries yet</div>';

    renderSidebarDatasets(ds);
  } catch (e) { }
}

registerPageInit('dashboard', loadDashboard);
