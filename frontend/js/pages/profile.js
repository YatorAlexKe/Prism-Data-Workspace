async function loadProfile(tableName) {
  const el = document.getElementById('profile-content');
  el.innerHTML = '<div class="empty-state"><div class="empty-icon">⟳</div><div class="empty-text">Loading profile...</div></div>';
  try {
    const res = await fetch(`${API}/profile/${tableName}`);
    const d = await res.json();
    const q = d.quality_score;
    const qColor = q > 80 ? 'var(--green)' : q > 60 ? 'var(--yellow)' : 'var(--red)';

    el.innerHTML = `
      <div class="profile-header">
        <div>
          <div class="profile-title">${d.table_name}</div>
          <div class="profile-sub">${d.row_count} rows · ${d.col_count} columns · ${d.duplicate_rows} duplicates</div>
        </div>
        <div class="quality-ring-wrap">
          <div class="quality-score-num" style="color:${qColor}">${q}%</div>
          <div class="quality-label">Data Quality</div>
        </div>
      </div>
      ${d.warnings.length ? `<div class="warnings-block">${d.warnings.map(w => `<div class="warning-item">⚠ ${w}</div>`).join('')}</div>` : ''}
      <div class="section-title">Column Profiles</div>
      <div class="col-profile-grid">
        ${d.columns.map(c => `
          <div class="col-card">
            <div class="col-card-header">
              <span class="col-card-name">${c.name}</span>
              <span class="schema-col-type ct-${c.type === 'integer' || c.type === 'float' ? c.type : 'text'}">${c.type}</span>
            </div>
            <div class="col-stat"><span class="col-stat-label">Nulls</span><span class="col-stat-val" style="color:${c.null_pct > 20 ? 'var(--red)' : 'var(--text)'}">${c.null_count} (${c.null_pct}%)</span></div>
            <div class="col-stat"><span class="col-stat-label">Unique</span><span class="col-stat-val">${c.unique_count} (${c.unique_pct}%)</span></div>
            ${c.min !== undefined ? `
              <div class="col-stat"><span class="col-stat-label">Min</span><span class="col-stat-val">${c.min}</span></div>
              <div class="col-stat"><span class="col-stat-label">Max</span><span class="col-stat-val">${c.max}</span></div>
              <div class="col-stat"><span class="col-stat-label">Mean</span><span class="col-stat-val">${c.mean}</span></div>
            ` : ''}
            ${c.top_values ? `<div style="margin-top:8px;font-size:10px;color:var(--muted);font-family:var(--mono)">TOP VALUES</div>${c.top_values.map(v => `<div class="col-stat"><span class="col-stat-label" style="overflow:hidden;text-overflow:ellipsis;max-width:150px">${v.value}</span><span class="col-stat-val">${v.count}</span></div>`).join('')}` : ''}
            <div style="margin-top:8px">
              <div style="font-size:10px;color:var(--muted);font-family:var(--mono);margin-bottom:4px">QUALITY</div>
              <div class="quality-bar"><div class="quality-fill" style="width:${c.quality_score}%;background:${c.quality_score > 80 ? 'var(--green)' : c.quality_score > 60 ? 'var(--yellow)' : 'var(--red)'}"></div></div>
            </div>
          </div>`).join('')}
      </div>`;
  } catch (e) {
    el.innerHTML = `<div class="error-box">⚠ Failed to load profile: ${e.message}</div>`;
  }
}
