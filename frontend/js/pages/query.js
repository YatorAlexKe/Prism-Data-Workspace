async function loadQueryTables() {
  try {
    const res = await fetch(`${API}/datasets`);
    const data = await res.json();
    allDatasets = data.datasets || [];
    renderTableSelector();
  } catch (e) { }
}

function renderTableSelector() {
  const el = document.getElementById('table-selector');
  if (!el) return;
  if (!allDatasets.length) {
    el.innerHTML = '<div style="font-size:11px;color:var(--muted);padding:8px;font-family:var(--mono)">No tables — import data first</div>';
    return;
  }
  el.innerHTML = allDatasets.map(d => `
    <div class="table-chip ${selectedTables.includes(d.table_name) ? 'selected' : ''}"
         onclick="toggleTableSelect('${d.table_name}')">
      <span style="font-family:var(--mono);font-size:11px">${d.table_name}</span>
      <span style="font-family:var(--mono);font-size:10px;color:var(--muted);margin-left:auto">${d.row_count}r</span>
      ${selectedTables.includes(d.table_name) ? '<span class="table-chip-check">✓</span>' : ''}
      <span class="table-chip-edit" title="Edit dataset"
            onclick="event.stopPropagation();openEditDataset('${d.table_name}')">✎</span>
    </div>
  `).join('');
}

function toggleTableSelect(name) {
  if (selectedTables.includes(name)) {
    selectedTables = selectedTables.filter(t => t !== name);
  } else {
    selectedTables.push(name);
  }
  currentTable = selectedTables[selectedTables.length - 1] || null;
  renderTableSelector();
  renderSchemaPanel();
  document.getElementById('run-query-btn').disabled = selectedTables.length === 0;
  loadTemplates();
}

async function renderSchemaPanel() {
  const panel = document.getElementById('schema-panel');
  if (!panel) return;
  if (!currentTable) {
    panel.innerHTML = '<div style="font-size:11px;color:var(--muted);font-family:var(--mono);padding:8px">Select a table</div>';
    return;
  }
  try {
    const res = await fetch(`${API}/schema/${currentTable}`);
    const data = await res.json();
    panel.innerHTML = data.columns.map(c => {
      const cls = c.type === 'integer' ? 'ct-integer' : c.type === 'float' ? 'ct-float' : c.type === 'datetime' ? 'ct-datetime' : 'ct-text';
      return `<div class="schema-col-row"><span class="schema-col-name">${c.name}</span><span class="schema-col-type ${cls}">${c.type}</span></div>`;
    }).join('');
  } catch (e) { }
}

function loadTemplates() {
  const list = document.getElementById('templates-list');
  if (!list) return;
  const templates = [
    "Show the first 10 rows",
    "Count total rows",
    "Show top 10 records by highest value",
    "List all unique values in each text column",
    "Find rows with missing values",
    "Show summary statistics for all numeric columns",
    "Group by the first text column and count",
    "Show rows where any value is above average"
  ];
  list.innerHTML = templates.map(t => `
    <div onclick="useTemplate('${t.replace(/'/g, "\\'")}')"
      style="padding:9px 14px;font-size:12px;color:var(--muted);cursor:pointer;border-bottom:1px solid var(--border);transition:all 0.15s"
      onmouseover="this.style.background='var(--surface3)';this.style.color='var(--text)'"
      onmouseout="this.style.background='';this.style.color='var(--muted)'">
      ${t}
    </div>
  `).join('');
}

function useTemplate(t) {
  document.getElementById('query-input').value = t;
  document.getElementById('templates-panel').style.display = 'none';
  templatesVisible = false;
}

function toggleTemplates() {
  templatesVisible = !templatesVisible;
  document.getElementById('templates-panel').style.display = templatesVisible ? 'block' : 'none';
}

async function runQuery() {
  const q = document.getElementById('query-input').value.trim();
  if (!q || selectedTables.length === 0) return;

  const llm = getLLMConfig();
  document.getElementById('query-loading').style.display = 'block';
  document.getElementById('run-query-btn').disabled = true;
  document.getElementById('results-tabs').style.display = 'none';
  document.getElementById('query-error').style.display = 'none';
  document.getElementById('join-suggestions').style.display = 'none';
  document.getElementById('results-content').innerHTML = '<div class="empty-state"><div class="empty-icon" style="animation:spin 1s linear infinite">⟳</div><div class="empty-text">Generating SQL...</div></div>';

  try {
    let url, body;
    if (selectedTables.length > 1) {
      url = `${API}/query/multi-table`;
      body = { table_names: selectedTables, question: q, ...llm };
    } else {
      url = `${API}/query`;
      body = { table_name: selectedTables[0], question: q, ...llm };
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Query failed');

    currentResult = data.result;
    currentSQL = data.sql;

    renderResults(data);
    loadHistoryCount();
  } catch (e) {
    document.getElementById('query-error').style.display = 'block';
    document.getElementById('query-error').innerHTML = `<div class="error-box">⚠ ${e.message}</div>`;
    document.getElementById('results-content').innerHTML = '';
  }

  document.getElementById('query-loading').style.display = 'none';
  document.getElementById('run-query-btn').disabled = false;
  document.getElementById('save-query-btn').disabled = !currentSQL;
}

function renderResults(data) {
  document.getElementById('results-tabs').style.display = 'flex';
  document.getElementById('save-query-btn').disabled = false;
  document.getElementById('export-csv-btn').style.display = 'inline-flex';
  document.getElementById('export-xlsx-btn').style.display = 'inline-flex';

  setupChart(data);
  switchResultTab('table');
}

function switchResultTab(tab) {
  document.querySelectorAll('.rtab').forEach((t, i) => t.classList.toggle('active', ['table', 'chart', 'sql'][i] === tab));
  const el = document.getElementById('results-content');

  if (tab === 'table') renderTable(el);
  else if (tab === 'chart') renderChart(el);
  else if (tab === 'sql') renderSQL(el);
}

function renderTable(el) {
  if (!currentResult) return;
  const meta = `<div class="result-meta"><span>Returned <span class="count">${currentResult.row_count}</span> rows</span><span>${currentResult.columns.length} columns</span></div>`;

  if (!currentResult.rows.length) {
    el.innerHTML = meta + '<div class="empty-state"><div class="empty-icon">∅</div><div class="empty-text">No rows returned</div></div>';
    return;
  }
  const cols = currentResult.columns.map(c => c.name || c);
  const headers = cols.map(c => `<th>${c}</th>`).join('');
  const rows = currentResult.rows.map(row => '<tr>' + cols.map(c => `<td title="${row[c]}">${row[c]}</td>`).join('') + '</tr>').join('');
  el.innerHTML = meta + `<div class="table-container"><table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderSQL(el) {
  el.innerHTML = `
    <div class="sql-block">
      <div class="sql-block-header">
        <span>Generated SQL</span>
        <button class="btn btn-ghost btn-sm" onclick="copySQL()">Copy</button>
      </div>
      <div class="sql-code">${highlightSQL(currentSQL)}</div>
    </div>`;
}

function setupChart(data) {
  chartSuggestion = data.chart_suggestion;
}

function renderChart(el) {
  if (!currentResult || !currentResult.rows.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">📊</div><div class="empty-text">No data to chart</div></div>';
    return;
  }

  const cols = currentResult.columns.map(c => c.name || c);
  const sug = chartSuggestion || { chart_type: 'bar', x_column: cols[0], y_column: cols[cols.length - 1] };

  const xOpts = cols.map(c => `<option value="${c}" ${c === sug.x_column ? 'selected' : ''}>${c}</option>`).join('');
  const yOpts = cols.map(c => `<option value="${c}" ${c === sug.y_column ? 'selected' : ''}>${c}</option>`).join('');
  const typeOpts = ['bar', 'line', 'scatter', 'pie', 'histogram'].map(t => `<option value="${t}" ${t === sug.chart_type ? 'selected' : ''}>${t}</option>`).join('');

  el.innerHTML = `
    <div class="chart-controls">
      <span class="ctrl-label">Type:</span>
      <select id="chart-type-sel" onchange="redrawChart()">${typeOpts}</select>
      <span class="ctrl-label">X:</span>
      <select id="chart-x-sel" onchange="redrawChart()">${xOpts}</select>
      <span class="ctrl-label">Y:</span>
      <select id="chart-y-sel" onchange="redrawChart()">${yOpts}</select>
      ${sug.reason ? `<span style="font-size:11px;color:var(--muted);font-family:var(--mono);margin-left:auto">💡 ${sug.reason}</span>` : ''}
    </div>
    <div id="chart-div"></div>`;

  drawChart(sug.chart_type, sug.x_column, sug.y_column);
}

function redrawChart() {
  drawChart(
    document.getElementById('chart-type-sel').value,
    document.getElementById('chart-x-sel').value,
    document.getElementById('chart-y-sel').value
  );
}

function drawChart(type, xCol, yCol) {
  if (!currentResult?.rows?.length) return;
  const xVals = currentResult.rows.map(r => r[xCol]);
  const yVals = currentResult.rows.map(r => parseFloat(r[yCol]) || 0);

  const layout = {
    paper_bgcolor: '#141720', plot_bgcolor: '#141720',
    font: { color: '#e2e8f0', family: 'IBM Plex Mono, monospace', size: 11 },
    margin: { t: 20, r: 20, b: 60, l: 60 },
    xaxis: { gridcolor: '#2a2e42', color: '#64748b', tickfont: { size: 10 } },
    yaxis: { gridcolor: '#2a2e42', color: '#64748b' },
    showlegend: false, height: 360
  };

  let trace;
  const c = '#4ade80';
  if (type === 'pie') {
    trace = { type: 'pie', labels: xVals, values: yVals, marker: { colors: ['#4ade80', '#60a5fa', '#a78bfa', '#fb923c', '#f87171', '#fbbf24'] }, textfont: { color: '#e2e8f0', size: 11 } };
    layout.margin = { t: 20, r: 20, b: 20, l: 20 };
  } else if (type === 'histogram') {
    trace = { type: 'histogram', x: xVals, marker: { color: c, opacity: 0.8 } };
  } else if (type === 'scatter') {
    trace = { type: 'scatter', x: xVals, y: yVals, mode: 'markers', marker: { color: c, size: 7, opacity: 0.8 } };
  } else if (type === 'line') {
    trace = { type: 'scatter', x: xVals, y: yVals, mode: 'lines+markers', line: { color: c, width: 2 }, marker: { color: c, size: 5 } };
  } else {
    trace = { type: 'bar', x: xVals, y: yVals, marker: { color: c, opacity: 0.85 } };
  }

  Plotly.newPlot('chart-div', [trace], layout, { responsive: true, displayModeBar: false });
}

function formatSQL(sql) {
  const keywords = ['SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY',
    'HAVING', 'LIMIT', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN',
    'JOIN', 'ON', 'UNION', 'WITH'];
  let formatted = sql.trim();
  keywords.forEach(kw => {
    formatted = formatted.replace(new RegExp(`\\s+${kw}\\b`, 'gi'), `\n${kw}`);
  });
  formatted = formatted.replace(/SELECT\s+/i, 'SELECT\n  ');
  formatted = formatted.replace(/,\s*/g, ',\n  ');
  return formatted.trim();
}

function highlightSQL(sql) {
  const formatted = formatSQL(sql);
  const kws = ['SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'LIMIT', 'HAVING',
    'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'ON', 'AS', 'AND', 'OR', 'NOT',
    'IN', 'LIKE', 'IS', 'NULL', 'DISTINCT', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
    'ASC', 'DESC', 'WITH', 'UNION', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX'];
  let r = formatted;
  kws.forEach(k => { r = r.replace(new RegExp(`\\b${k}\\b`, 'gi'), m => `<span class="kw">${m}</span>`); });
  return r;
}

function copySQL() {
  navigator.clipboard.writeText(currentSQL);
  const btn = document.querySelector('#results-content .btn-ghost');
  if (btn) { btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Copy', 2000); }
}

async function exportResults(format) {
  if (!currentSQL || !currentTable) return;

  const btn = format === 'xlsx'
    ? document.getElementById('export-xlsx-btn')
    : document.getElementById('export-csv-btn');

  const original = btn.textContent;
  btn.textContent = '...';
  btn.disabled = true;

  try {
    const res = await fetch(`${API}/query/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sql: currentSQL,
        table_name: currentTable,
        filename: `prism_${currentTable}_${new Date().toISOString().split('T')[0]}`,
        format: format
      })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Export failed');
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `prism_${currentTable}_${new Date().toISOString().split('T')[0]}.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    btn.textContent = '✓ Done';
    setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 2000);
  } catch (e) {
    alert('Export failed: ' + e.message);
    btn.textContent = original;
    btn.disabled = false;
  }
}

function clearQuery() {
  document.getElementById('query-input').value = '';
  document.getElementById('results-tabs').style.display = 'none';
  document.getElementById('query-error').style.display = 'none';
  document.getElementById('export-csv-btn').style.display = 'none';
  document.getElementById('export-xlsx-btn').style.display = 'none';
  document.getElementById('results-content').innerHTML = '<div class="empty-state"><div class="empty-icon">⚡</div><div class="empty-text">Run a query to see results</div></div>';
  currentResult = null; currentSQL = '';
  document.getElementById('save-query-btn').disabled = true;
}

async function detectJoins() {
  if (selectedTables.length < 2) {
    alert('Select at least 2 tables to detect JOINs.');
    return;
  }
  const llm = getLLMConfig();
  const res = await fetch(`${API}/schema/detect-joins`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ table_names: selectedTables, ...llm })
  });
  const data = await res.json();
  const el = document.getElementById('join-suggestions');
  el.style.display = 'block';

  if (!data.joins?.length) {
    el.innerHTML = '<div style="font-size:12px;color:var(--muted)">No obvious JOIN columns found between selected tables.</div>';
    return;
  }

  el.innerHTML = '<div style="font-size:11px;font-weight:600;margin-bottom:8px;color:var(--muted);font-family:var(--mono)">JOIN OPPORTUNITIES</div>' +
    data.joins.map(j => `
      <div class="join-card">
        <div class="join-card-header">
          <span style="color:var(--blue)">${j.table1}.${j.col1}</span>
          <span style="color:var(--muted)">→</span>
          <span style="color:var(--purple)">${j.table2}.${j.col2}</span>
          <span class="join-confidence conf-${j.confidence || 'medium'}">${j.confidence || 'medium'}</span>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="useJoinTemplate('${j.table1}','${j.col1}','${j.table2}','${j.col2}')">Use in query</button>
      </div>`).join('');
}

function useJoinTemplate(t1, c1, t2, c2) {
  document.getElementById('query-input').value = `Show all data joining ${t1} and ${t2} on ${c1} = ${c2}`;
}

async function openSaveModal() {
  if (!currentSQL) return;
  try {
    const res = await fetch(`${API}/projects`);
    const data = await res.json();
    const sel = document.getElementById('save-project');
    sel.innerHTML = '<option value="">No project</option>' + (data.projects || []).map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  } catch (e) { }
  document.getElementById('save-modal').classList.add('open');
}

function closeSaveModal() {
  document.getElementById('save-modal').classList.remove('open');
}

async function saveQuery() {
  const name = document.getElementById('save-name').value.trim();
  if (!name) { alert('Please enter a query name.'); return; }
  const projectId = document.getElementById('save-project').value || null;

  try {
    await fetch(`${API}/queries/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name, sql_query: currentSQL,
        question: document.getElementById('query-input').value,
        table_name: currentTable || '',
        project_id: projectId ? parseInt(projectId) : null,
        result_row_count: currentResult?.row_count || 0
      })
    });
    closeSaveModal();
    document.getElementById('save-name').value = '';
  } catch (e) { alert('Failed to save: ' + e.message); }
}

function initQueryPage() {
  loadQueryTables();
  const input = document.getElementById('query-input');
  if (input && !input.dataset.bound) {
    input.dataset.bound = '1';
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runQuery();
    });
  }
}

registerPageInit('query', initQueryPage);
